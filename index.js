const express = require('express');
const app = express();
const pino = require('pino');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const {
    default: makeWASocket,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    DisconnectReason,
    Browsers,
    downloadContentFromMessage,
    initAuthCreds
} = require('@whiskeysockets/baileys');
const { MongoClient } = require('mongodb');

const PORT = process.env.PORT || 3000;
const tfEvents = new EventEmitter();

const mongoUri = 'mongodb+srv://adamdh7:Tchengy1@botadamdh7.lo27bbm.mongodb.net/?appName=botadamdh7';
let mongoClient;
let db;

let recentMsgsCache = [];
const groupSettingsCache = new Map();
const activeDel2UsersCache = new Map();
const msgRetryCounterCache = new Map();
const activeSessions = new Map();
const groupMetadataCache = new Map();
const sessionOwnersCache = new Map();
const lastRequestTime = new Map();
const processedLocalCache = new Set();
let isPurging = false;

const retryCache = {
    get: (key) => msgRetryCounterCache.get(key),
    set: (key, value) => msgRetryCounterCache.set(key, value),
    del: (key) => msgRetryCounterCache.delete(key)
};

async function connectMongo() {
  try {
    mongoClient = new MongoClient(mongoUri);
    await mongoClient.connect();
    db = mongoClient.db('dh7bot');
    try {
        await db.collection('baileys_auth').createIndex({ _id: 1 });
        await db.collection('processed_messages').createIndex({ ts: 1 });
        await db.collection('group_del2').createIndex({ sessionId: 1, gjid: 1, targetJid: 1 });
    } catch (e) {}
  } catch (e) {}
}

function fixBuffers(obj) {
    if (!obj) return obj;
    if (obj._bsontype === 'Binary' && obj.buffer) {
        return Buffer.from(obj.buffer);
    }
    if (obj instanceof Uint8Array) {
        return Buffer.from(obj);
    }
    if (Array.isArray(obj)) {
        return obj.map(fixBuffers);
    }
    if (typeof obj === 'object') {
        if (Buffer.isBuffer(obj)) return obj;
        if (obj.type === 'Buffer' && Array.isArray(obj.data)) {
            return Buffer.from(obj.data);
        }
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                obj[key] = fixBuffers(obj[key]);
            }
        }
    }
    return obj;
}

async function useMongoAuthState(sessionId, expectExisting = false) {
  const collection = db.collection('baileys_auth');
  const sessionKey = `auth-${sessionId}`;
  let credsDoc = await collection.findOne({ _id: `${sessionKey}-creds` });
  
  if (expectExisting && !credsDoc) {
      throw new Error("SessionNotExists");
  }

  let creds = credsDoc ? fixBuffers(credsDoc.creds) : initAuthCreds();
  
  const keyStore = {
    get: async (type, ids) => {
      const result = {};
      if (!ids || ids.length === 0) return result;
      const dbIds = ids.map((id) => `${sessionKey}_key_${type}-${id}`);
      const docs = await collection.find({ _id: { $in: dbIds } }).toArray();
      for (const doc of docs) {
        const prefix = `${sessionKey}_key_${type}-`;
        const id = doc._id.substring(prefix.length);
        result[id] = fixBuffers(doc.data);
      }
      return result;
    },
    set: async (data) => {
      const bulkOps = [];
      for (const [key, value] of Object.entries(data)) {
        const dbId = `${sessionKey}_key_${key}`;
        if (value === null || value === undefined) {
          bulkOps.push({
            deleteOne: {
              filter: { _id: dbId }
            }
          });
        } else {
          bulkOps.push({
            updateOne: {
              filter: { _id: dbId },
              update: { $set: { data: value } },
              upsert: true
            }
          });
        }
      }
      if (bulkOps.length > 0) {
        try {
          await collection.bulkWrite(bulkOps);
        } catch (err) {
          for (const op of bulkOps) {
            try {
              if (op.deleteOne) {
                await collection.deleteOne(op.deleteOne.filter);
              } else if (op.updateOne) {
                await collection.updateOne(op.updateOne.filter, op.updateOne.update, { upsert: true });
              }
            } catch (e) {}
          }
        }
      }
    }
  };
  const saveCreds = async () => {
    try {
      await collection.updateOne(
        { _id: `${sessionKey}-creds` },
        { $set: { creds } },
        { upsert: true }
      );
    } catch (e) {}
  };
  return {
    state: {
      creds,
      keys: keyStore
    },
    saveCreds
  };
}

async function deleteMongoSession(sessionId) {
  try {
    const collection = db.collection('baileys_auth');
    const sessionKey = `auth-${sessionId}`;
    await collection.deleteMany({ _id: { $regex: `^${sessionKey}` } });
    const ownerCol = db.collection('session_owners');
    await ownerCol.deleteMany({ sessionId: sessionId });
    sessionOwnersCache.delete(sessionId);
  } catch (e) {}
}

async function renameMongoSession(oldSessionId, newSessionId) {
  try {
    const collection = db.collection('baileys_auth');
    const oldKey = `auth-${oldSessionId}`;
    const newKey = `auth-${newSessionId}`;
    const oldDocs = await collection.find({ _id: { $regex: `^${oldKey}` } }).toArray();
    for (const doc of oldDocs) {
      const newId = doc._id.replace(oldKey, newKey);
      await collection.insertOne({ ...doc, _id: newId });
    }
    await collection.deleteMany({ _id: { $regex: `^${oldKey}` } });
  } catch (e) {}
}

async function getGroupSetting(sessionId, gjid, key) {
    const cacheKey = `${sessionId}_${gjid}_${key}`;
    if (groupSettingsCache.has(cacheKey)) {
        return groupSettingsCache.get(cacheKey);
    }
    try {
        const col = db.collection('group_settings');
        const doc = await col.findOne({ sessionId, gjid });
        const val = doc ? doc[key] : null;
        groupSettingsCache.set(cacheKey, val);
        return val;
    } catch (e) {
        return null;
    }
}

async function setGroupSetting(sessionId, gjid, key, value) {
    const cacheKey = `${sessionId}_${gjid}_${key}`;
    groupSettingsCache.set(cacheKey, value);
    try {
        const col = db.collection('group_settings');
        await col.updateOne({ sessionId, gjid }, { $set: { [key]: value } }, { upsert: true });
    } catch (e) {}
}

async function getDel2Targets(sessionId, gjid) {
    const cacheKey = `${sessionId}_${gjid}`;
    if (activeDel2UsersCache.has(cacheKey)) {
        return activeDel2UsersCache.get(cacheKey);
    }
    try {
        const col = db.collection('group_del2');
        const docs = await col.find({ sessionId, gjid }).toArray();
        const list = docs.map(d => d.targetJid);
        activeDel2UsersCache.set(cacheKey, list);
        return list;
    } catch (e) {
        return [];
    }
}

async function addDel2Target(sessionId, gjid, targetJid) {
    try {
        const col = db.collection('group_del2');
        await col.updateOne({ sessionId, gjid, targetJid }, { $set: { active: true } }, { upsert: true });
        const current = await getDel2Targets(sessionId, gjid);
        if (!current.includes(targetJid)) {
            current.push(targetJid);
            activeDel2UsersCache.set(`${sessionId}_${gjid}`, current);
        }
    } catch (e) {}
}

async function removeDel2Target(sessionId, gjid, targetJid) {
    try {
        const col = db.collection('group_del2');
        await col.deleteMany({ sessionId, gjid, targetJid });
        const current = await getDel2Targets(sessionId, gjid);
        const index = current.indexOf(targetJid);
        if (index > -1) {
            current.splice(index, 1);
            activeDel2UsersCache.set(`${sessionId}_${gjid}`, current);
        }
    } catch (e) {}
}

process.on('unhandledRejection', (err) => {
    const msg = String(err?.message || err || '');
    if (msg.includes('Bad MAC') || msg.includes('Failed to decrypt message') || msg.includes('No matching sessions')) return;
});
process.on('uncaughtException', (err) => {
    const msg = String(err?.message || err || '');
    if (msg.includes('Bad MAC') || msg.includes('Failed to decrypt message') || msg.includes('No matching sessions')) return;
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const links_common = "*Bot.Adam_D'H7* : https://bot.adamdh7.org\n*Bref* : https://bref.adamdh7.org\n*MIZIK* : https://mizik.adamdh7.org\n*Tout* : https://tout.adamdh7.org\n*Chaine* : https://whatsapp.com/channel/0029Vb6WLps7oQhWrUlyPQ2m\n*Canal* : https://t.me/dh7adam , t.me/tfmizik\n*Pages* : https://m.facebook.com/dh7adam , https://m.facebook.com/tfmizik";

const translations = {
  fr: {
    cmd_ai: "ia", cmd_lang: "lang", cmd_imaj: "image", cmd_cheche: "chercher",
    cmd_menu: "menu", cmd_qrbot: "qrbot", cmd_qr: "qr", cmd_code: "code", cmd_lien: "lien", cmd_tagall: "tagtout",
    cmd_hidetag: "hidetag", cmd_kick: "expulse", cmd_add: "add", cmd_promote: "promote", cmd_demote: "demote",
    cmd_kickall: "expulsetout", cmd_kickall2: "expulsetout2", cmd_ferme: "ferme", cmd_ouvert: "ouvert", cmd_bienvenue: "bienvenue",
    cmd_nolien: "nolien", cmd_nolien2: "nolien2", cmd_del: "del", cmd_del2: "del2", cmd_vv: "vv", cmd_sites: "sit", cmd_info: "info", cmd_ping: "ping", cmd_url: "url",
    cmd_alive: "alive", alive_title: "Alive", connected_since: "Connecté depuis", days: "jour(s)", hours: "heure(s)", minutes: "minute(s)", seconds: "seconde(s)",
    enabled: "activé", disabled: "désactivé", welcome_on: "Bienvenue activée", welcome_off: "Bienvenue désactivée", nolien_on: "Nolien activé", nolien_off: "Nolien désactivé", nolien2_on: "Nolien2 activé", nolien2_off: "Nolien2 désactivé",
    welcome_title: "Bienvenue", welcome_to: "Bienvenue dans",
    menu_title: "Menu", lang_changed: "La langue du bot est maintenant {lang}.", languages_available: "Langues disponibles : fr en es ht",
    imaj_prompt: "Envoie un prompt après image pour générer une image.", imaj_generated: "*{prompt}*", imaj_error: "Erreur génération image - Réessaye.", search_title: "Recherche", search_error: "Erreur recherche",
    lang_title: "Langue", ai_title: "Message", imaj_title: "Image", image_generated_title: "Image Générée",
    ai_click_to_receive: "Cliquez ici pour recevoir la réponse de l'IA :\n*_{link}_*",
    code_confirm: "Veuillez autoriser l'envoi du code en cliquant ici :\n*_{link}_*",
    qrbot_created: "Nouvelle Session Créée",
    qrbot_scan: "Scannez ce code pour connecter la nouvelle session.",
    qrbot_connected: "Session Connectée",
    qrbot_active: "La nouvelle session est active.\nID: {id}",
    hidetag_title: "Hidetag", hidetag_default: "Il s'agit juste d'un hidetag",
    links_text: links_common,
    mode_changed_private: "Le bot est maintenant en mode PRIVE.",
    mode_changed_public: "Le bot est maintenant en mode PUBLIC.",
    already_private: "Le bot est déjà configuré en mode PRIVE.",
    already_public: "Le bot est déjà configuré en mode PUBLIC.",
    disconnect_sys_title: "Déconnexion Système",
    disconnect_sys_msg: "Vous avez été déconnecté. Une suppression totale des données et sessions a été initiée via le système.",
    del2_activated: "La modération stricte a été activée pour @{user}. Tous les messages de cet utilisateur seront supprimés de manière instantanée.",
    del2_deactivated: "La modération stricte a été désactivée pour @{user}."
  },
  en: {
    cmd_ai: "ai", cmd_lang: "lang", cmd_imaj: "image", cmd_cheche: "search",
    cmd_menu: "menu", cmd_qrbot: "qrbot", cmd_qr: "qr", cmd_code: "code", cmd_lien: "link", cmd_tagall: "tagall",
    cmd_hidetag: "hidetag", cmd_kick: "kick", cmd_add: "add", cmd_promote: "promote", cmd_demote: "demote",
    cmd_kickall: "kickall", cmd_kickall2: "kickall2", cmd_ferme: "close", cmd_ouvert: "open", cmd_bienvenue: "welcome",
    cmd_nolien: "nolink", cmd_nolien2: "nolink2", cmd_del: "del", cmd_del2: "del2", cmd_vv: "vv", cmd_sites: "sit", cmd_info: "info", cmd_ping: "ping", cmd_url: "url",
    cmd_alive: "alive", alive_title: "Alive", connected_since: "Connected for", days: "day(s)", hours: "hour(s)", minutes: "minute(s)", seconds: "second(s)",
    enabled: "enabled", disabled: "disabled", welcome_on: "Welcome enabled", welcome_off: "Welcome disabled", nolien_on: "No link enabled", nolien_off: "No link disabled", nolien2_on: "Strict no link enabled", nolien2_off: "Strict no link disabled",
    welcome_title: "Welcome", welcome_to: "Welcome to",
    menu_title: "Menu", lang_changed: "Bot language is now {lang}.", languages_available: "Available languages: fr en es ht",
    imaj_prompt: "Send a prompt after image to generate an image.", imaj_generated: "*{prompt}*", imaj_error: "Image generation error - Try again.", search_title: "Search", search_error: "Search error",
    lang_title: "Language", ai_title: "Message", imaj_title: "Image", image_generated_title: "Generated Image",
    ai_click_to_receive: "Click here to receive the AI response:\n*_{link}_*",
    code_confirm: "Please authorize the sending of the code by clicking here:\n*_{link}_*",
    qrbot_created: "New Session Created",
    qrbot_scan: "Scan this QR code to connect the new session.",
    qrbot_connected: "Session Connected",
    qrbot_active: "The new session is active.\nID: {id}",
    hidetag_title: "Hidetag", hidetag_default: "It’s just a hidetag",
    links_text: links_common,
    mode_changed_private: "The bot is now in PRIVATE mode.",
    mode_changed_public: "The bot is now in PUBLIC mode.",
    already_private: "The bot is already in PRIVATE mode.",
    already_public: "The bot is already in PUBLIC mode.",
    disconnect_sys_title: "System Disconnection",
    disconnect_sys_msg: "You have been disconnected. A total deletion of data and sessions has been initiated via the system.",
    del2_activated: "Strict moderation has been activated for @{user}. All incoming messages from this user will be deleted immediately.",
    del2_deactivated: "Strict moderation has been deactivated for @{user}."
  },
  es: {
    cmd_ai: "ia", cmd_lang: "lang", cmd_imaj: "imagen", cmd_cheche: "buscar",
    cmd_menu: "menú", cmd_qrbot: "qrbot", cmd_qr: "qr", cmd_code: "código", cmd_lien: "enlace", cmd_tagall: "etiquetartodo",
    cmd_hidetag: "hidetag", cmd_kick: "expulsar", cmd_add: "añadir", cmd_promote: "promover", cmd_demote: "degradar",
    cmd_kickall: "borrartodo", cmd_kickall2: "borrartodo2", cmd_ferme: "cerrar", cmd_ouvert: "abrir", cmd_bienvenue: "bienvenida",
    cmd_nolien: "sinenlace", cmd_nolien2: "sinenlace2", cmd_del: "del", cmd_del2: "del2", cmd_vv: "vv", cmd_sites: "sit", cmd_info: "info", cmd_ping: "ping", cmd_url: "url",
    cmd_alive: "alive", alive_title: "Alive", connected_since: "Conectado por", days: "día(s)", hours: "hora(s)", minutes: "minuto(s)", seconds: "segundo(s)",
    enabled: "activado", disabled: "desactivado", welcome_on: "Bienvenida activada", welcome_off: "Bienvenida desactivada", nolien_on: "Sin enlaces activado", nolien_off: "Sin enlaces desactivado", nolien2_on: "Sin enlaces estricto activado", nolien2_off: "Sin enlaces estricto desactivado",
    welcome_title: "Bienvenida", welcome_to: "Bienvenida a",
    menu_title: "Menú", lang_changed: "El idioma del bot es ahora {lang}.", languages_available: "Idiomas disponibles: fr en es ht",
    imaj_prompt: "Envía un prompt después de imagen para generar una imagen.", imaj_generated: "*{prompt}*", imaj_error: "Error al generar imagen - Inténtalo de nuevo.", search_title: "Búsqueda", search_error: "Error de búsqueda",
    lang_title: "Idioma", ai_title: "Mensaje", imaj_title: "Imagen", image_generated_title: "Imagen Generada",
    ai_click_to_receive: "Haz clic aquí para recevoir la respuesta de la IA:\n*_{link}_*",
    code_confirm: "Por favor autoriza el envío del código haciendo clic aquí:\n*_{link}_*",
    qrbot_created: "Nueva Sesión Creada",
    qrbot_scan: "Escanea este código para conectar la nueva sesión.",
    qrbot_connected: "Sesión Conectada",
    qrbot_active: "La nueva sesión está activa.\nID: {id}",
    hidetag_title: "Hidetag", hidetag_default: "Es solo un hidetag",
    links_text: links_common,
    mode_changed_private: "El bot ahora está en modo PRIVADO.",
    mode_changed_public: "El bot ahora está en modo PÚBLICO.",
    already_private: "El bot ya está configurado en modo PRIVADO.",
    already_public: "El bot ya está configurado en modo PÚBLICO.",
    disconnect_sys_title: "Desconexión del Sistema",
    disconnect_sys_msg: "Ha sido desconectado. Se ha iniciado una eliminación total de datos y sesiones a través del sistema.",
    del2_activated: "Se ha activado la moderación estricta para @{user}. Todos los mensajes entrantes de este usuario serán eliminados de inmediato.",
    del2_deactivated: "Se ha desactivado la moderación estricta para @{user}."
  },
  ht: {
    cmd_ai: "ai", cmd_lang: "lang", cmd_imaj: "imaj", cmd_cheche: "cheche",
    cmd_menu: "meni", cmd_qrbot: "qrbot", cmd_qr: "qr", cmd_code: "kòd", cmd_lien: "lyen", cmd_tagall: "tout",
    cmd_hidetag: "hidetag", cmd_kick: "kick", cmd_add: "add", cmd_promote: "promote", cmd_demote: "demote",
    cmd_kickall: "siptout", cmd_kickall2: "siptout2", cmd_ferme: "fèmen", cmd_ouvri: "ouvri", cmd_bienvenue: "byenveni",
    cmd_nolien: "nolyen", cmd_nolien2: "nolyen2", cmd_del: "del", cmd_del2: "del2", cmd_vv: "vv", cmd_sites: "sit", cmd_info: "info", cmd_ping: "ping", cmd_url: "url",
    cmd_alive: "alive", alive_title: "Alive", connected_since: "Konekte depi", days: "jou", hours: "èdtan", minutes: "minit", seconds: "segonn",
    enabled: "aktive", disabled: "dezaktive", welcome_on: "Byenveni aktive", welcome_off: "Byenveni dezaktive", nolien_on: "Nolyen aktive", nolien_off: "Nolyen dezaktive", nolien2_on: "Nolyen2 aktive", nolien2_off: "Nolyen2 dezaktive",
    welcome_title: "Byenveni", welcome_to: "Byenveni nan",
    menu_title: "Meni", lang_changed: "Lang bot la se kounye a {lang}.", languages_available: "Lang disponib : fr en es ht",
    imaj_prompt: "Voye yon prompt apre imaj pou jenere yon imaj.", imaj_generated: "*{prompt}*", imaj_error: "Erè jenere imaj - Eseye ankò.", search_title: "Rechèch", search_error: "Erè rechèch",
    lang_title: "Lang", ai_title: "Mesaj", imaj_title: "Imaj", image_generated_title: "Imaj Jenere",
    ai_click_to_receive: "Klike isit pou resevwa repons IA a :\n*_{link}_*",
    code_confirm: "Tanpri otorize voye kòd la lè w klike isit :\n*_{link}_*",
    qrbot_created: "Nouvo Sesyon Kreye",
    qrbot_scan: "Eskane kòd sa a pou konekte nouvo sesyon an.",
    qrbot_connected: "Sesyon Konekte",
    qrbot_active: "Nouvo sesyon an aktif.\nID: {id}",
    hidetag_title: "Hidetag", hidetag_default: "Se jis yon hidetag",
    links_text: links_common,
    mode_changed_private: "Bot la kounye a nan mòd PRIVE.",
    mode_changed_public: "Bot la kounye a nan mòd PIBLIK.",
    already_private: "Bot la deja configuré nan mòd PRIVE.",
    already_public: "Bot la deja configuré nan mòd PIBLIK.",
    disconnect_sys_title: "Dekoneksyon Sistèm",
    disconnect_sys_msg: "Ou te dekonekte. Yon efasman total done ak sesyon yo te inisye atravè sistèm nan.",
    del2_activated: "Modération estrik aktive pou @{user}. Tout mesaj moun sa a voye ap siprime touswit.",
    del2_deactivated: "Modération estrik dezaktive pou @{user}."
  }
};

function buildCaption(type, text, hostName) {
    return `*○ ${type}*\n\n*Adam_D'H7*\nUtilisateur : "${hostName}"\nPropriétaire : Adam_D'H7\n\n${text}\n\n> *Adam_D'H7*`;
}

const logoPath = path.join(__dirname, 'adamdh7.png');
let adamLogoBuffer = fs.existsSync(logoPath) ? fs.readFileSync(logoPath) : null;

async function checkSessionLimits() {
    if (!db) return;
    try {
        const now = Date.now();
        const limit1h = 1 * 60 * 60 * 1000;
        for (const [id, s] of activeSessions.entries()) {
            if (!s.lastRefresh || (now - s.lastRefresh >= limit1h)) {
                s.lastRefresh = now;
                if (s.sock) {
                    try {
                        await s.sock.sendPresenceUpdate('available');
                    } catch (e) {}
                    if (s.sock.ws && s.sock.ws.readyState === 1) {
                        try {
                            s.sock.ev.emit('connection.update', { connection: 'open', lastDisconnect: null });
                        } catch (e) {}
                    } else {
                        try { s.sock.ws.close(); } catch (e) {}
                    }
                }
            }
        }
    } catch (e) {}
}

async function checkAndRefreshSession70(sessionId) {
    const session = activeSessions.get(sessionId);
    if (!session) return;
    const now = Date.now();
    const minutes70 = 70 * 60 * 1000;
    if (!session.lastResetTime || (now - session.lastResetTime >= minutes70)) {
        session.lastResetTime = now;
        session.status = 'synchronisation';
        try {
            if (session.sock) {
                session.sock.ev.removeAllListeners();
                if (session.sock.ws) {
                    session.sock.ws.close();
                }
            }
        } catch (e) {}
        setTimeout(() => {
            startAdamBot(sessionId, false, session.format || 'pair', true).catch(() => {});
        }, 1000);
    }
}

app.use(async (req, res, next) => {
    await checkSessionLimits();
    for (const sId of activeSessions.keys()) {
        await checkAndRefreshSession70(sId);
    }
    next();
});

app.get('/sitemap.xml', (req, res) => {
    res.sendFile(path.join(__dirname, 'sitemap.xml'));
});
app.get('/manifest.json', (req, res) => {
    res.sendFile(path.join(__dirname, 'manifest.json'));
});
app.get('/sw.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'sw.js'));
});
app.get('/Adam_DH7', (req, res) => res.type('text/plain').send("It’s me Adam_DH7"));
app.get('/ok', (req, res) => res.send('ok'));
app.get('/TF-:id', (req, res) => {
    tfEvents.emit('ok-' + req.params.id);
    res.redirect('https://www.profitablecpmratenetwork.com/ak0xgm6xu?key=96856a216ee758b70d6c8303e964e86b');
});

app.get('/list2', (req, res) => {
    if (isPurging) {
        return res.type('text/plain').send('SUPPRESSION DEJA EN COURS.');
    }
    isPurging = true;
    res.type('text/plain').send('SUPPRESSION EN COURS. LES SESSIONS ET DONNEES SERONT EFFACEES SOUS PEU.');
    (async () => {
        try {
            const ownerCol = db.collection('session_owners');
            for (const [sId, session] of activeSessions.entries()) {
                if (session.sock && session.number) {
                    try {
                        const doc = await ownerCol.findOne({ sessionId: sId });
                        const lang = (doc && doc.lang && translations[doc.lang]) ? doc.lang : 'en';
                        const t = translations[lang];
                        const hostName = doc && doc.Name ? doc.Name : "Adam_D'H7";
                        const caption = buildCaption(t.disconnect_sys_title, t.disconnect_sys_msg, hostName);
                        if (adamLogoBuffer) {
                            await session.sock.sendMessage(session.number + '@s.whatsapp.net', { image: adamLogoBuffer, caption: caption });
                        } else {
                            await session.sock.sendMessage(session.number + '@s.whatsapp.net', { text: caption });
                        }
                        await new Promise(resolve => setTimeout(resolve, 2500));
                    } catch (err) {}
                    try {
                        session.sock.logout();
                        if (session.sock.ws) session.sock.ws.close();
                    } catch (err) {}
                }
            }
            await db.collection('baileys_auth').deleteMany({});
            await db.collection('session_owners').deleteMany({});
            await db.collection('group_settings').deleteMany({});
            await db.collection('processed_messages').deleteMany({});
            await db.collection('group_del2').deleteMany({});
            sessionOwnersCache.clear();
            groupMetadataCache.clear();
            groupSettingsCache.clear();
            msgRetryCounterCache.clear();
            activeSessions.clear();
            activeDel2UsersCache.clear();
            processedLocalCache.clear();
        } catch (e) {}
        isPurging = false;
    })();
});

function getUptimeString(ms) {
    let seconds = Math.floor(ms / 1000);
    let d = Math.floor(seconds / (3600*24));
    let h = Math.floor((seconds % (3600*24)) / 3600);
    let m = Math.floor((seconds % 3600) / 60);
    let s = Math.floor(seconds % 60);
    let parts = [];
    if(d > 0) parts.push(`${d}j`);
    if(h > 0) parts.push(`${h}h`);
    if(m > 0) parts.push(`${m}m`);
    if(s > 0) parts.push(`${s}s`);
    if (parts.length === 0) parts.push(`0s`);
    return parts.join(' ');
}

app.get('/list', async (req, res) => {
  try {
      const sessionsList = [];
      const ownerCol = db.collection('session_owners');
      const now = Date.now();
      for (const s of activeSessions.values()) {
        let ownerDoc = sessionOwnersCache.get(s.id);
        if (!ownerDoc) {
            ownerDoc = await ownerCol.findOne({ sessionId: s.id });
            if (ownerDoc) sessionOwnersCache.set(s.id, ownerDoc);
        }
        let aliveStr = "0s";
        if (ownerDoc && ownerDoc.connectedSince) {
            aliveStr = getUptimeString(now - ownerDoc.connectedSince);
        } else if (s.createdAt) {
            aliveStr = getUptimeString(now - s.createdAt);
        }
        sessionsList.push({
          ID: s.id,
          Sessions: s.status || 'connecte',
          Numero: s.number || 'N/A',
          Name: ownerDoc ? (ownerDoc.Name || "Adam_D'H7") : "Adam_D'H7",
          Format: s.format || 'pair',
          Mode: ownerDoc ? (ownerDoc.mode || 'prive') : 'prive',
          Alive: aliveStr
        });
      }
      const html = `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { background: #000000; color: #FFFFFF; font-family: monospace; margin: 0; padding: 20px; white-space: pre-wrap; word-wrap: break-word; }
    </style>
</head>
<body>${JSON.stringify(sessionsList, null, 2)}</body>
</html>`;
      res.send(html);
  } catch (e) {
      res.status(500).send("Error rendering sessions statistics.");
  }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const Adam_DH7 = "Adam_D'H7";

async function callCloudflareAI(model, messages, maxTokens = 3000) {
  try {
    const accountId = "c754bf19fa1b21106a6885e3be79274e";
    const token = "cfut_PxZCBwgwkUnnh38zccPPUSy4K5E6zYDc9xiUwcqc05395e5a";
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messages: messages,
        max_tokens: maxTokens
      })
    });
    if (!res.ok) throw new Error("AI error");
    const data = await res.json();
    return data.result && data.result.response ? data.result.response : "Désolé, erreur de réponse.";
  } catch (e) {
    return "Erreur lors de l'appel à l'IA.";
  }
}

async function tavilySearch(query) {
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        api_key: "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",
        query: query,
        search_depth: "basic",
        include_images: true,
        include_answer: true,
        max_results: 5
      })
    });
    if (!res.ok) throw new Error();
    return await res.json();
  } catch (e) {
    return {answer: "Erreur de recherche Tavily."};
  }
}

function formatUptime(seconds, t) {
    let d = Math.floor(seconds / (3600*24));
    let h = Math.floor((seconds % (3600*24)) / 3600);
    let m = Math.floor((seconds % 3600) / 60);
    let s = Math.floor(seconds % 60);
    let parts = [];
    if(d > 0) parts.push(`${d} ${t.days}`);
    if(h > 0) parts.push(`${h} ${t.hours}`);
    if(m > 0) parts.push(`${m} ${t.minutes}`);
    if(s > 0) parts.push(`${s} ${t.seconds}`);
    if (parts.length === 0) parts.push(`0 ${t.seconds}`);
    return parts.join(', ');
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function normalizePhoneNumber(number) {
    return String(number || '').replace(/[^0-9]/g, '');
}

function unwrapMessageContent(message) {
    let msg = message || {};
    if (msg.ephemeralMessage?.message) msg = msg.ephemeralMessage.message;
    if (msg.viewOnceMessage?.message) msg = msg.viewOnceMessage.message;
    if (msg.viewOnceMessageV2?.message) msg = msg.viewOnceMessageV2.message;
    if (msg.viewOnceMessageV2Extension?.message) msg = msg.viewOnceMessageV2Extension.message;
    return msg;
}

function extractBody(m) {
    const msg = unwrapMessageContent(m?.message);
    return msg.conversation || msg.extendedTextMessage?.text || msg.imageMessage?.caption || msg.videoMessage?.caption || msg.documentMessage?.caption || msg.buttonsResponseMessage?.selectedButtonId || msg.listResponseMessage?.singleSelectReply?.selectedRowId || '';
}

function waitForConnectionOpen(sock, timeoutMs = 45000) {
    return new Promise((resolve, reject) => {
        if (sock?.user?.id) {
            resolve(true);
            return;
        }
        let done = false;
        const timer = setTimeout(() => {
            if (done) return;
            done = true;
            sock.ev.off('connection.update', handler);
            reject(new Error('Timeout'));
        }, timeoutMs);
        const handler = (u) => {
            if (u?.connection === 'open') {
                if (done) return;
                done = true;
                clearTimeout(timer);
                sock.ev.off('connection.update', handler);
                resolve(true);
            }
        };
        sock.ev.on('connection.update', handler);
    });
}

function waitForQr(sock, timeoutMs = 45000) {
    return new Promise((resolve, reject) => {
        let done = false;
        const timer = setTimeout(() => {
            if (done) return;
            done = true;
            sock.ev.off('connection.update', handler);
            reject(new Error('Timeout'));
        }, timeoutMs);
        const handler = (u) => {
            if (u?.qr) {
                if (done) return;
                done = true;
                clearTimeout(timer);
                sock.ev.off('connection.update', handler);
                resolve(u.qr);
            }
        };
        sock.ev.on('connection.update', handler);
    });
}

const commandMaps = {
  fr: {
    "ia": "ai", "lang": "lang", "image": "imaj", "chercher": "cheche", "menu": "menu", "qrbot": "qrbot", "qr": "qr", "code": "code", "lien": "lien", "tagtout": "tagall", "hidetag": "hidetag", "expulse": "kick", "add": "add", "promote": "promote", "demote": "demote", "expulsetout": "kickall", "expulsetout2": "kickall2", "ferme": "ferme", "ouvert": "ouvert", "bienvenue": "bienvenue", "nolien": "nolien", "nolien2": "nolien2", "del": "del", "del2": "del2", "vv": "vv", "sit": "sites", "info": "info", "alive": "alive", "ping": "ping", "pings": "ping", "url": "url", "urls": "url", "prive": "prive", "public": "public"
  },
  en: {
    "ai": "ai", "lang": "lang", "image": "imaj", "search": "cheche", "menu": "menu", "qrbot": "qrbot", "qr": "qr", "code": "code", "link": "lien", "tagall": "tagall", "hidetag": "hidetag", "kick": "kick", "add": "add", "promote": "promote", "demote": "demote", "kickall": "kickall", "kickall2": "kickall2", "close": "ferme", "open": "ouvert", "welcome": "bienvenue", "nolink": "nolien", "nolink2": "nolien2", "del": "del", "del2": "del2", "vv": "vv", "sit": "sites", "info": "info", "alive": "alive", "ping": "ping", "pings": "ping", "url": "url", "urls": "url", "private": "prive", "public": "public"
  },
  es: {
    "ia": "ai", "lang": "lang", "imagen": "imaj", "buscar": "cheche", "menú": "menu", "qrbot": "qrbot", "qr": "qr", "código": "code", "enlace": "lien", "etiquetartodo": "tagall", "hidetag": "hidetag", "expulsar": "kick", "añadir": "add", "promouvoir": "promote", "degradar": "demote", "borrartodo": "kickall", "borrartodo2": "kickall2", "cerrar": "ferme", "abrir": "ouvert", "bienvenida": "bienvenue", "sinenlace": "nolien", "sinenlace2": "nolien2", "del": "del", "del2": "del2", "vv": "vv", "sit": "sites", "info": "info", "alive": "alive", "ping": "ping", "pings": "ping", "url": "url", "urls": "url", "privado": "prive", "publico": "public"
  },
  ht: {
    "ai": "ai", "lang": "lang", "imaj": "imaj", "cheche": "cheche", "meni": "menu", "qrbot": "qrbot", "qr": "qr", "kòd": "code", "lyen": "lien", "tout": "tagall", "hidetag": "hidetag", "sipli": "kick", "add": "add", "promote": "promote", "demote": "demote", "siptout": "kickall", "siptout2": "kickall2", "fèmen": "ferme", "ouvri": "ouvert", "byenveni": "bienvenue", "nolyen": "nolien", "nolyen2": "nolien2", "del": "del", "del2": "del2", "vv": "vv", "sit": "sites", "info": "info", "alive": "alive", "ping": "ping", "pings": "ping", "url": "url", "urls": "url", "prive": "prive", "piblik": "public"
  }
};

function normalizeText(str) {
    return str ? str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() : "";
}

async function sendFormatted(sock, from, type, text, pushName, isAI = false, hostName = "Adam_D'H7") {
  const fullCaption = buildCaption(type, text, hostName);
  try {
    if (isAI) {
      await sock.sendMessage(from, { text: fullCaption });
    } else {
      if (adamLogoBuffer) {
        await sock.sendMessage(from, { image: adamLogoBuffer, caption: fullCaption });
      } else {
        await sock.sendMessage(from, { text: fullCaption });
      }
    }
  } catch (e) {}
}

function cleanupSocket(sessionId) {
    const s = activeSessions.get(sessionId);
    if (s && s.sock) {
        try {
            s.sock.ev.removeAllListeners();
            if (s.sock.ws) {
                s.sock.ws.close();
            }
        } catch (e) {}
    }
}

async function startAdamBot(sessionId, autoExpire = false, format = 'pair', expectExisting = false) {
    try {
        cleanupSocket(sessionId);
        const { state, saveCreds } = await useMongoAuthState(sessionId, expectExisting);
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })) },
            browser: Browsers.macOS('Safari'),
            markOnlineOnConnect: true,
            generateHighQualityLinkPreview: true,
            msgRetryCounterCache: retryCache,
            retryRequestDelayMs: 250,
            maxMsgRetryCount: 8,
            keepAliveIntervalMs: 15000,
            getMessage: async (key) => {
                return {};
            }
        });

        const sessionData = {
            sock: sock,
            qrString: null,
            ownerJid: null,
            active: true,
            readyAt: Date.now()
        };

        const chatHistories = new Map();
        
        let globalLang = 'en';
        const ownerColInitial = db.collection('session_owners');
        const initialOwnerDoc = await ownerColInitial.findOne({ sessionId: sessionId });
        if (initialOwnerDoc && initialOwnerDoc.lang) {
            globalLang = initialOwnerDoc.lang;
        } else {
            globalLang = 'en';
        }

        const userInfo = new Map();
        const pendingAIResponses = new Map();

        const buildAIMessages = (hist, userInfoObj, botLang) => {
          let historyCopy = [...hist];
          const systemContent = `You are Adam_D’H7. Do not talk about internal information or other subjects about Yourself outside of your name. The user is: ${userInfoObj.pseudo || 'Unknown'} (number: ${userInfoObj.number || 'unknown'}). The conversation is in language: ${botLang}. Always respond in the language the user is using.`;
          let msgs = [
            {role: "system", content: systemContent},
            ...historyCopy
          ];
          const jsonStr = JSON.stringify(msgs);
          while (jsonStr.length > 17000 && historyCopy.length > 1) {
            historyCopy.shift();
            msgs = [
              {role: "system", content: systemContent},
              ...historyCopy
            ];
          }
          if (JSON.stringify(msgs).length > 17000 && historyCopy.length > 0) {
            const last = {...historyCopy[historyCopy.length - 1]};
            if (last.content && last.content.length > 14000) {
              last.content = last.content.substring(0, 14000) + ` ... [tronqué]`;
            }
            msgs = [
              {role: "system", content: systemContent},
              last
            ];
          }
          return msgs;
        };

        const existingSessionRecord = activeSessions.get(sessionId);
        activeSessions.set(sessionId, {
            id: sessionId,
            number: existingSessionRecord ? existingSessionRecord.number : null,
            format: format,
            status: 'initialisation',
            createdAt: existingSessionRecord ? existingSessionRecord.createdAt : Date.now(),
            lastRefresh: Date.now(),
            lastResetTime: existingSessionRecord ? (existingSessionRecord.lastResetTime || Date.now()) : Date.now(),
            sock: sock,
            qrString: null
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            if (qr) {
                sessionData.qrString = qr;
                const currentSession = activeSessions.get(sessionId);
                if (currentSession) {
                    currentSession.status = 'qr_disponible';
                    currentSession.qrString = qr;
                    currentSession.sock = sock;
                }
            }
            if (connection === 'connecting') {
                const currentSession = activeSessions.get(sessionId);
                if (currentSession) currentSession.status = 'synchronisation';
            }
            if (connection === 'open') {
                const botId = sock.user.id.includes(':') ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : sock.user.id;
                sessionData.ownerJid = botId;
                sessionData.active = true;
                sessionData.readyAt = Date.now();
                
                sock.groupFetchAllParticipating()
                    .then((groups) => {
                        for (const jid in groups) {
                            groupMetadataCache.set(jid, groups[jid]);
                        }
                    })
                    .catch(() => {});
                
                const currentBotNum = sock.user ? sock.user.id.split(':')[0] : null;
                const currentBotName = sock.user ? sock.user.name || "Adam_D'H7" : "Adam_D'H7";
                if (currentBotNum) {
                    const ownerCol = db.collection('session_owners');
                    const now = Date.now();
                    const existingRecord = await ownerCol.findOne({ sessionId: sessionId });
                    let finalRecord = existingRecord;
                    if (!existingRecord) {
                        const matchingBackup = await ownerCol.findOne({ Number: currentBotNum });
                        if (matchingBackup) {
                            finalRecord = {
                                ...matchingBackup,
                                sessionId: sessionId,
                                connectedSince: now
                            };
                            await ownerCol.updateOne(
                                { sessionId: sessionId },
                                { $set: finalRecord },
                                { upsert: true }
                            );
                            await ownerCol.deleteOne({ _id: matchingBackup._id });
                        } else {
                            const newOwner = { sessionId: sessionId, Number: currentBotNum, Name: currentBotName, connectedSince: now, mode: 'prive', lang: globalLang };
                            await ownerCol.updateOne(
                                { sessionId: sessionId },
                                { $set: newOwner },
                                { upsert: true }
                            );
                            finalRecord = newOwner;
                        }
                    } else if (!existingRecord.connectedSince) {
                        await ownerCol.updateOne(
                            { sessionId: sessionId },
                            { $set: { connectedSince: now } }
                        );
                        finalRecord.connectedSince = now;
                    }
                    sessionOwnersCache.set(sessionId, finalRecord);
                }

                const currentSession = activeSessions.get(sessionId);
                if (currentSession) {
                    currentSession.number = sock.user ? sock.user.id.split(':')[0] : null;
                    currentSession.status = 'connecte';
                    currentSession.format = format;
                    currentSession.sock = sock;
                }
            }
            if (connection === 'close') {
                sessionData.active = false;
                const currentSession = activeSessions.get(sessionId);
                if (currentSession) currentSession.status = 'deconnecte';
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                
                try {
                    sock.ev.removeAllListeners();
                    if (sock.ws) sock.ws.close();
                } catch (e) {}

                if (statusCode === DisconnectReason.loggedOut || statusCode === 401 || statusCode === 405) {
                    try {
                        const currentRecord = activeSessions.get(sessionId);
                        const numToBackup = currentRecord ? currentRecord.number : null;
                        if (numToBackup) {
                            const ownerCol = db.collection('session_owners');
                            const docToBackup = await ownerCol.findOne({ sessionId: sessionId });
                            if (docToBackup) {
                                await ownerCol.updateOne(
                                    { Number: numToBackup },
                                    { $set: docToBackup },
                                    { upsert: true }
                                );
                            }
                        }
                        await deleteMongoSession(sessionId);
                        activeSessions.delete(sessionId);
                    } catch (e) {}
                } else {
                    setTimeout(() => {
                        startAdamBot(sessionId, autoExpire, format, true).catch(() => {});
                    }, 5000);
                }
            }
        });

        const safeGroupUpdate = async (jid, participants, action) => {
            try {
                const cleanParticipants = participants.map(p => p.includes('@') ? p : `${p.replace(/[^0-9]/g, '')}@s.whatsapp.net`);
                await sock.groupParticipantsUpdate(jid, cleanParticipants, action);
                return true;
            } catch (e) {
                return false;
            }
        };

        const resolveTargets = async (arg, m) => {
            const ctx = m.message?.extendedTextMessage?.contextInfo;
            if (ctx?.mentionedJid?.length) return ctx.mentionedJid;
            if (ctx?.participant) return [ctx.participant];
            if (arg) return [arg.replace(/[^0-9]/g, '') + '@s.whatsapp.net'];
            return [];
        };

        sock.ev.on('group-participants.update', async (update) => {
            try {
                const { id: gjid, participants: newParts, action } = update;
                const isBienvenue = await getGroupSetting(sessionId, gjid, 'bienvenue');
                if (action !== 'add' || !isBienvenue || !newParts || newParts.length === 0) return;
                const tWelcome = translations[globalLang] || translations.ht;
                const welcomeTitle = tWelcome.welcome_title || "Bienvenue";
                const welcomeTo = tWelcome.welcome_to || "Welcome to";
                let gSubject = "le groupe";
                if (groupMetadataCache.has(gjid)) {
                    gSubject = groupMetadataCache.get(gjid).subject || gSubject;
                } else {
                    try {
                        const gmeta = await sock.groupMetadata(gjid);
                        groupMetadataCache.set(gjid, gmeta);
                        setTimeout(() => groupMetadataCache.delete(gjid), 7000);
                        gSubject = gmeta.subject;
                    } catch (e) {}
                }
                
                const ownerCol = db.collection('session_owners');
                let sessionOwnerDoc = sessionOwnersCache.get(sessionId);
                if (!sessionOwnerDoc) {
                    sessionOwnerDoc = await ownerCol.findOne({ sessionId: sessionId });
                    if (sessionOwnerDoc) sessionOwnersCache.set(sessionId, sessionOwnerDoc);
                }
                const hostNameToDisplay = sessionOwnerDoc ? sessionOwnerDoc.Name || "Adam_D'H7" : "Adam_D'H7";

                const usernamesText = newParts.map(user => `@${user.split('@')[0]}`).join(', ');
                const welcomeText = buildCaption(welcomeTitle, `*${welcomeTo} ${gSubject}*\n${usernamesText}`, hostNameToDisplay);
                if (adamLogoBuffer) {
                    await sock.sendMessage(gjid, { image: adamLogoBuffer, caption: welcomeText, mentions: newParts });
                } else {
                    await sock.sendMessage(gjid, { text: welcomeText, mentions: newParts });
                }
            } catch (e) {}
        });

        sock.ev.on('messages.upsert', async (up) => {
            if (up.type !== 'notify') return;
            
            for (const m of up.messages) {
                if (m.messageStubType) continue;
                if (!m.message || Object.keys(m.message).length === 0) continue;
                if (m.message.protocolMessage) continue;
                if (m.message.messageContextInfo?.deviceListMetadata) continue;
                if (m.key && m.key.remoteJid === 'status@broadcast') continue;

                const msgId = m.key.id;
                if (processedLocalCache.has(msgId)) return;
                processedLocalCache.add(msgId);
                if (processedLocalCache.size > 2000) {
                    const arr = Array.from(processedLocalCache);
                    processedLocalCache.delete(arr[0]);
                }

                const senderId = m.key.participant || m.key.remoteJid;
                recentMsgsCache.push({
                    id: msgId,
                    from: m.key.remoteJid,
                    sender: senderId,
                    ts: m.messageTimestamp || Math.floor(Date.now() / 1000)
                });
                if (recentMsgsCache.length > 200) recentMsgsCache.shift();

                setImmediate(async () => {
                    try {
                        const timestampNow = Math.floor(Date.now() / 1000);
                        if (m.messageTimestamp && (timestampNow - m.messageTimestamp > 120)) return;

                        const from = m.key.remoteJid;
                        const isFromMe = m.key.fromMe;
                        const pushName = m.pushName || 'Inconnu';
                        const botId = sock.user?.id ? (sock.user.id.includes(':') ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : sock.user.id) : null;
                        const sender = m.key.participant || m.key.remoteJid || (isFromMe ? botId : null);
                        
                        const isGroup = from.endsWith('@g.us') || from.endsWith('@s.whatsapp.net');
                        const isChannel = from.endsWith('@newsletter');
                        const messageType = Object.keys(unwrapMessageContent(m.message) || {})[0];

                        const ownerColTop = db.collection('session_owners');
                        let sOwnerTop = sessionOwnersCache.get(sessionId);
                        if (!sOwnerTop) {
                            sOwnerTop = await ownerColTop.findOne({ sessionId: sessionId });
                            if (sOwnerTop) sessionOwnersCache.set(sessionId, sOwnerTop);
                        }

                        let isOwnerReal = false;
                        let activeHostName = sOwnerTop ? (sOwnerTop.Name || "Adam_D'H7") : "Adam_D'H7";
                        const sNum = sender ? sender.split('@')[0].replace(/[^0-9]/g, '') : '';
                        const sName = pushName;

                        if (isFromMe) {
                            isOwnerReal = true;
                            if (sName !== 'Inconnu' && sName !== '' && sName !== activeHostName && sOwnerTop) {
                                sOwnerTop.Name = sName;
                                await ownerColTop.updateOne({ sessionId: sessionId }, { $set: { Name: sName } }, { upsert: true });
                                activeHostName = sName;
                            }
                        } else if (sOwnerTop) {
                            if (sNum === sOwnerTop.Number) {
                                isOwnerReal = true;
                                if (sName !== 'Inconnu' && sName !== '' && sName !== activeHostName) {
                                    sOwnerTop.Name = sName;
                                    await ownerColTop.updateOne({ sessionId: sessionId }, { $set: { Name: sName } });
                                    activeHostName = sName;
                                }
                            } else if (sName === sOwnerTop.Name) {
                                isOwnerReal = true;
                            }
                        }

                        if (isGroup && sender && sender !== botId && !isOwnerReal) {
                            try {
                                const del2List = await getDel2Targets(sessionId, from);
                                if (del2List.includes(sender)) {
                                    await sock.sendMessage(from, { delete: m.key });
                                    return;
                                }
                            } catch (e) {}
                        }

                        const getMeta = async () => {
                            try {
                                if (groupMetadataCache.has(from)) return groupMetadataCache.get(from);
                                if (isGroup && !from.endsWith('@s.whatsapp.net')) {
                                    const meta = await sock.groupMetadata(from).catch(() => null);
                                    if (meta) {
                                        groupMetadataCache.set(from, meta);
                                        return meta;
                                    }
                                }
                            } catch (e) {}
                            return null;
                        };

                        const checkAdmin = async () => {
                            try {
                                if (isOwnerReal) return true;
                                if (!isGroup || from.endsWith('@s.whatsapp.net')) return false;
                                const metadataA = await getMeta();
                                return metadataA ? metadataA.participants.some(p => p.id === sender && p.admin) : false;
                            } catch (e) {
                                return false;
                            }
                        };

                        if (isGroup && !from.endsWith('@s.whatsapp.net')) {
                            try {
                                const antiLinkMode = await getGroupSetting(sessionId, from, 'noLien') || 'off';
                                if (antiLinkMode !== 'off') {
                                    const metadata = await getMeta();
                                    const senderIsAdmin = metadata?.participants?.some(p => p.id === sender && (p.admin === 'admin' || p.admin === 'superadmin')) || false;
                                    const isStrict = antiLinkMode === 'strict';
                                    let shouldDelete = false;

                                    const msgContent = unwrapMessageContent(m.message);
                                    const actualType = Object.keys(msgContent || {})[0] || messageType;

                                    const allowedTypes = [
                                        'conversation', 'extendedTextMessage', 'imageMessage', 'videoMessage',
                                        'audioMessage', 'documentMessage', 'stickerMessage', 'viewOnceMessage',
                                        'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'reactionMessage', 
                                        'protocolMessage', 'pollCreationMessage', 'pollCreationMessageV2', 
                                        'pollCreationMessageV3', 'pollUpdateMessage', 'senderKeyDistributionMessage', 
                                        'messageContextInfo', 'deviceSentMessage'
                                    ];

                                    if (!allowedTypes.includes(actualType)) {
                                        shouldDelete = true;
                                    } else {
                                        const bodyRawStr = extractBody(m);
                                        const linkRegex = /https?:\/\/[^\s]+|wa\.me|whatsapp\.com\/channel|chat\.whatsapp\.com/i;
                                        if (linkRegex.test(bodyRawStr)) {
                                            shouldDelete = true;
                                        }
                                    }

                                    if (shouldDelete) {
                                        let canDelete = false;
                                        if (isStrict) {
                                            if (sender !== botId && !isOwnerReal) canDelete = true;
                                        } else {
                                            if (!senderIsAdmin && sender !== botId && !isOwnerReal) canDelete = true;
                                        }

                                        if (canDelete) {
                                            try {
                                                await sock.sendMessage(from, { delete: m.key });
                                            } catch (e) {}
                                            return;
                                        }
                                    }
                                }
                            } catch (errGroupCheck) {}
                        }

                        const processedCol = db.collection('processed_messages');
                        const isProcessed = await processedCol.findOne({ _id: msgId });
                        if (isProcessed) return;
                        await processedCol.updateOne({ _id: msgId }, { $set: { ts: Date.now() } }, { upsert: true });

                        let allowed = false;
                        let botMode = sOwnerTop ? (sOwnerTop.mode || 'prive') : 'prive';
                        
                        if (botMode === 'public') {
                            allowed = true;
                        } else if (isOwnerReal) {
                            allowed = true;
                        }

                        const bodyRaw = extractBody(m);
                        const body = bodyRaw.trim();

                        if (!allowed) return;
                        if (!body) return;
                        
                        const ignoreTexts = [
                            'Message non chargé', 
                            'Waiting for this message', 
                            'En attente de ce message', 
                            'Ceci pourrait prendre un peu de temps',
                            'This may take a while'
                        ];
                        if (ignoreTexts.some(text => body.includes(text))) return;

                        userInfo.set(sender, {
                          pseudo: pushName,
                          number: sender ? sender.split('@')[0].replace(/[^0-9]/g, '') : '',
                          lang: globalLang
                        });

                        const cmdRegex = /^[.\/! ]?\s*([\p{L}0-9_]+)(?:\s+([\s\S]*))?$/u;
                        const match = body.match(cmdRegex);

                        if (!match) return;

                        let command = match[1].toLowerCase();
                        let args = match[2] ? match[2].trim() : '';

                        let internalCommand = null;
                        if (command === 'lang') {
                            internalCommand = 'lang';
                        } else {
                            const normCmd = normalizeText(command);
                            const currentMap = commandMaps[globalLang];
                            if (currentMap) {
                                for (const [alias, intern] of Object.entries(currentMap)) {
                                    if (normalizeText(alias) === normCmd) {
                                        internalCommand = intern;
                                        break;
                                    }
                                }
                            }
                            if (!internalCommand) {
                                for (const l of Object.keys(commandMaps)) {
                                    if (l === globalLang) continue;
                                    const mapL = commandMaps[l];
                                    for (const [alias, intern] of Object.entries(mapL)) {
                                        if (normalizeText(alias) === normCmd) {
                                            internalCommand = intern;
                                            break;
                                        }
                                    }
                                    if (internalCommand) break;
                                }
                            }
                        }
                        
                        if (!internalCommand) return;

                        await checkAndRefreshSession70(sessionId);

                        const userQueueKey = `${sessionId}_${sender}`;
                        const nowTime = Date.now();
                        const lastReq = lastRequestTime.get(userQueueKey) || 0;
                        if (nowTime - lastReq < 800) {
                            return; 
                        }
                        lastRequestTime.set(userQueueKey, nowTime);

                        (async () => {
                            try {
                                try { await sock.readMessages([m.key]); } catch (e) {}
                                try { await sock.sendPresenceUpdate('composing', from); } catch (e) {}

                                const quoted = m.message?.extendedTextMessage?.contextInfo;
                                const quotedMessage = quoted?.quotedMessage;
                                const t = translations[globalLang] || translations.ht;

                                let isCancelled = false;
                                const timeoutExecute = new Promise((_, reject) => {
                                    setTimeout(() => {
                                        isCancelled = true;
                                        reject(new Error('TimeoutExceeded'));
                                    }, 120000);
                                });

                                const safeSendFormatted = async (...sendArgs) => {
                                    if (isCancelled) return;
                                    return await sendFormatted(...sendArgs);
                                };

                                const commandExecute = async () => {
                                    switch (internalCommand) {
                                        case 'prive':
                                            if (!isOwnerReal) break;
                                            if (sOwnerTop.mode === 'prive') {
                                                await safeSendFormatted(sock, from, "Mode", t.already_private, pushName, false, activeHostName);
                                            } else {
                                                sOwnerTop.mode = 'prive';
                                                await db.collection('session_owners').updateOne({ sessionId: sessionId }, { $set: { mode: 'prive' } });
                                                sessionOwnersCache.set(sessionId, sOwnerTop);
                                                await safeSendFormatted(sock, from, "Mode", t.mode_changed_private, pushName, false, activeHostName);
                                            }
                                            break;
                                        case 'public':
                                            if (!isOwnerReal) break;
                                            if (sOwnerTop.mode === 'public') {
                                                await safeSendFormatted(sock, from, "Mode", t.already_public, pushName, false, activeHostName);
                                            } else {
                                                sOwnerTop.mode = 'public';
                                                await db.collection('session_owners').updateOne({ sessionId: sessionId }, { $set: { mode: 'public' } });
                                                sessionOwnersCache.set(sessionId, sOwnerTop);
                                                await safeSendFormatted(sock, from, "Mode", t.mode_changed_public, pushName, false, activeHostName);
                                            }
                                            break;
                                        case 'menu':
                                            if (args.length > 0) break;
                                            let menuBodyText = `*● ${t.cmd_ai}*\n*○ ${t.cmd_lang}*\n*○ ${t.cmd_imaj}*\n*○ ${t.cmd_cheche}*\n\n*● ${t.cmd_menu}*\n*○ ${t.cmd_qrbot}*\n*● ${t.cmd_qr}*\n*○ ${t.cmd_code}*\n*○ ${t.cmd_lien}*\n*○ ${t.cmd_sites}*\n*○ ${t.cmd_info}*\n\n*● ${t.cmd_tagall}*\n*○ ${t.cmd_hidetag}*\n*● ${t.cmd_kick}*\n*○ ${t.cmd_add}*\n*● ${t.cmd_promote}*\n*○ ${t.cmd_demote}*\n*● ${t.cmd_kickall}*\n*● ${t.cmd_kickall2}*\n*○ ${t.cmd_ferme}*\n*● ${t.cmd_ouvert}*\n*○ ${t.cmd_bienvenue}*\n\n*○ ${t.cmd_nolien}*\n*● ${t.cmd_nolien2}*\n*○ ${t.cmd_del}*\n*● ${t.cmd_del2}*\n*● ${t.cmd_vv}*\n*○ ${t.cmd_alive}*\n*● ${t.cmd_url}*\n*○ ${t.cmd_ping}*`;
                                            await safeSendFormatted(sock, from, t.menu_title, menuBodyText, pushName, false, activeHostName);
                                            break;
                                        case 'info':
                                            let infoBodyText = '';
                                            if (globalLang === 'fr') {
                                                infoBodyText = `*● IA & RECHERCHE*\n*○ ${t.cmd_ai}* : Interroger l'Intelligence Artificielle pour obtenir des réponses textuelles détaillées.\n*○ ${t.cmd_lang}* : Modifier la langue de configuration du bot.\n*○ ${t.cmd_imaj}* : Générer une image numérique à partir d'une description textuelle.\n*○ ${t.cmd_cheche}* : Effectuer des recherches approfondies sur le web.\n\n*● UTILITAIRES & SYSTEME*\n*○ ${t.cmd_menu}* : Afficher l'arborescence complète et la liste de toutes les commandes.\n*○ ${t.cmd_qrbot}* : Initier et lier une nouvelle sous-session via code QR.\n*○ ${t.cmd_qr}* : Convertir un texte ou un lien spécifié en code QR scannable.\n*○ ${t.cmd_code}* : Générer ou vérifier un code d'autorisation système.\n*○ ${t.cmd_lien}* : Obtenir le lien d'invitation officiel.\n*○ ${t.cmd_sites}* : Consulter les sites officiels.\n*○ ${t.cmd_info}* : Fournir les informations explicatives d'utilisation de chaque commande.\n\n*● LOGISTIQUE DE GROUPE*\n*○ ${t.cmd_tagall}* : Mentionner explicitement tous les membres (Admin uniquement).\n*○ ${t.cmd_hidetag}* : Diffuser un message en mentionnant secrètement tous les membres.\n*○ ${t.cmd_kick}* : Retirer un membre spécifique du groupe actuel.\n*○ ${t.cmd_add}* : Ajouter un numéro de téléphone directement au groupe.\n*○ ${t.cmd_promote}* : Élever un membre régulier au rang d'administrateur.\n*○ ${t.cmd_demote}* : Rétrograder un administrateur existant au statut de membre.\n*○ ${t.cmd_kickall}* : Procéder à une expulsion globale de tous les non-administrateurs.\n*○ ${t.cmd_kickall2}* : Exécuter une méthode d'expulsion collective secondaire.\n*○ ${t.cmd_ferme}* : Restreindre l'envoi de messages uniquement aux administrateurs.\n*○ ${t.cmd_ouvert}* : Autoriser l'envoi de messages à tous les membres.\n*○ ${t.cmd_bienvenue}* : Activer ou désactiver les messages d'accueil automatiques.\n\n*● SECURITE & MODERATION*\n*○ ${t.cmd_nolien}* : Activer ou désactiver la modération automatique simple des liens.\n*○ ${t.cmd_nolien2}* : Appliquer une sécurité stricte (anti-lien) avec suppression immédiate.\n*○ ${t.cmd_del}* : Supprimer un ou plusieurs messages (albums/médias groupés) en y répondant.\n*○ ${t.cmd_del2}* : Activer/désactiver la suppression instantanée de TOUS les messages d'un utilisateur spécifié (Anti-spam absolu).\n*○ ${t.cmd_vv}* : Afficher les fichiers configurés en vue unique (View Once).\n*○ ${t.cmd_alive}* : Consulter l'état opérationnel et le temps d'activité global du bot.\n*○ ${t.cmd_url}* : Héberger et convertir un média local en un lien URL public.\n*○ ${t.cmd_ping}* : Évaluer la latence de traitement actuelle.`;
                                            } else if (globalLang === 'en') {
                                                infoBodyText = `*● AI & SEARCH*\n*○ ${t.cmd_ai}* : Query Artificial Intelligence to obtain detailed textual answers.\n*○ ${t.cmd_lang}* : Change the bot's default configuration language.\n*○ ${t.cmd_imaj}* : Generate a digital image from a textual description.\n*○ ${t.cmd_cheche}* : Perform deep searches on the web.\n\n*● UTILITIES & SYSTEM*\n*○ ${t.cmd_menu}* : Display the comprehensive tree and list of all active commands.\n*○ ${t.cmd_qrbot}* : Initiate and link a new sub-session using a QR code.\n*○ ${t.cmd_qr}* : Convert a specified text or hyperlink into a scannable QR code.\n*○ ${t.cmd_code}* : Generate or verify a system authentication validation code.\n*○ ${t.cmd_lien}* : Get the official group invitation link.\n*○ ${t.cmd_sites}* : Visit our official web pages.\n*○ ${t.cmd_info}* : Provide detailed descriptions regarding each command's usage.\n\n*● GROUP ADMINISTRATION*\n*○ ${t.cmd_tagall}* : Explicitly mention every individual member within the group (Admin only).\n*○ ${t.cmd_hidetag}* : Broadcast a message to all members silently without visible tags.\n*○ ${t.cmd_kick}* : Dismiss and remove a participant from the current group.\n*○ ${t.cmd_add}* : Directly add a phone number to the current group.\n*○ ${t.cmd_promote}* : Elevate a regular participant to group administrator status.\n*○ ${t.cmd_demote}* : Demote an existing administrator back to standard member status.\n*○ ${t.cmd_kickall}* : Execute a mass eviction of all non-administrator members from the group.\n*○ ${t.cmd_kickall2}* : Trigger an alternative collective secondary mass eviction.\n*○ ${t.cmd_ferme}* : Restrict chat permissions to group administrators exclusively.\n*○ ${t.cmd_ouvert}* : Open chat permissions to allow all members to broadcast messages.\n*○ ${t.cmd_bienvenue}* : Toggle the activation status of automated group welcome greetings.\n\n*● SECURITY & MODERATION*\n*○ ${t.cmd_nolien}* : Toggle simple automated moderation for external links.\n*○ ${t.cmd_nolien2}* : Enforce strict anti-link security protocol with instant deletion.\n*○ ${t.cmd_del}* : Remove one or multiple messages (albums/grouped media) by replying to it.\n*○ ${t.cmd_del2}* : Toggle instant automatic deletion of ALL messages from a specified user (Absolute Anti-spam).\n*○ ${t.cmd_vv}* : Intercept and retrieve media sent under the view-once restriction.\n*○ ${t.cmd_alive}* : Inspect active operational status and overall system uptime.\n*○ ${t.cmd_url}* : Host and convert a local chat media file into a public URL link.\n*○ ${t.cmd_ping}* : Measure the network latency and processing speed of the core system.`;
                                            } else if (globalLang === 'es') {
                                                infoBodyText = `*● IA & BÚSQUEDA*\n*○ ${t.cmd_ai}* : Consultar a la Inteligencia Artificial para obtener respuestas textuales.\n*○ ${t.cmd_lang}* : Modificar el idioma de configuración predeterminado del bot.\n*○ ${t.cmd_imaj}* : Generar una imagen digital a partir de una descripción de texto.\n*○ ${t.cmd_cheche}* : Realizar búsquedas avanzadas en la web.\n\n*● UTILIDADES & SISTEMA*\n*○ ${t.cmd_menu}* : Mostrar la lista completa de comandos activos disponibles.\n*○ ${t.cmd_qrbot}* : Iniciar y vincular una nueva subsesión mediante código QR.\n*○ ${t.cmd_qr}* : Convertir un texto o enlace en un código QR escaneable.\n*○ ${t.cmd_code}* : Generar o verificar un código de validación del sistema.\n*○ ${t.cmd_lien}* : Obtener el enlace de invitación oficial.\n*○ ${t.cmd_sites}* : Consultar los sitios web oficiales.\n*○ ${t.cmd_info}* : Proporcionar explicaciones de uso detalladas para cada comando.\n\n*● ADMINISTRACIÓN DE GRUPOS*\n*○ ${t.cmd_tagall}* : Mencionar a todos los miembros del grupo actual (Solo administradores).\n*○ ${t.cmd_hidetag}* : Difundir un de forma invisible a todos los miembros.\n*○ ${t.cmd_kick}* : Eliminar a un participante específico del grupo.\n*○ ${t.cmd_add}* : Agregar un número de teléfono directamente al grupo.\n*○ ${t.cmd_promote}* : Ascender a un participante al rango de administrador.\n*○ ${t.cmd_demote}* : Degradar a un administrador al estado de miembro común.\n*○ ${t.cmd_kickall}* : Expulsar de forma masiva a todos los no administradores.\n*○ ${t.cmd_kickall2}* : Ejecutar un método de purga masiva secundaria.\n*○ ${t.cmd_ferme}* : Restringir los permisos de chat solo a los administradores.\n*○ ${t.cmd_ouvert}* : Abrir los permisos de chat para todos los miembros.\n*○ ${t.cmd_bienvenue}* : Activar o desactivar los mensajes automatizados de bienvenida.\n\n*● SEGURIDAD & MODERACIÓN*\n*○ ${t.cmd_nolien}* : Activar o desactivar moderación simple de enlaces externos.\n*○ ${t.cmd_nolien2}* : Aplicar una política estricta de seguridad anti-enlaces con eliminación instantánea.\n*○ ${t.cmd_del}* : Eliminar uno o varios mensajes (álbumes/multimedia) respondiendo directamente.\n*○ ${t.cmd_del2}* : Activar/desactivar la eliminación instantánea de TODOS los mensajes de un usuario (Anti-spam absoluto).\n*○ ${t.cmd_vv}* : Interceptar y recuperar archivos multimedia enviados en modo de una sola vista.\n*○ ${t.cmd_alive}* : Consultar el estado operativo actual y tiempo de actividad del bot.\n*○ ${t.cmd_url}* : Alojar y convertir un archivo multimedia local en un enlace URL público.\n*○ ${t.cmd_ping}* : Medir la latencia de red y velocidad de procesamiento del sistema.`;
                                            } else {
                                                infoBodyText = `*● AI AK RECHÈCH*\n*○ ${t.cmd_ai}* : Poze Entèlijans Atifisyèl la kesyon pou jwenn repons tèks ki byen detaye.\n*○ ${t.cmd_lang}* : Chanje lang konfigirasyon bot la itilize.\n*○ ${t.cmd_imaj}* : Jenere yon imaj nimerik apati yon deskripsyon an tèks.\n*○ ${t.cmd_cheche}* : Fè gwo rechèch sou entènèt la.\n\n*● OUTI AK SISTÈM*\n*○ ${t.cmd_menu}* : Afiche lis konplè ak tout kòmandman ki disponib yo.\n*○ ${t.cmd_qrbot}* : Kreye ak konekte yon nouvo sous-sesyon avèk kòd QR.\n*○ ${t.cmd_qr}* : Konvèti yon tèks oswa lyen an kòd QR ki ka eskane.\n*○ ${t.cmd_code}* : Jenere oswa verifye kòd validasyon pou otorizasyon sistèm lan.\n*○ ${t.cmd_lien}* : Jwenn lyen envitasyon ofisyèl gwoup la.\n*○ ${t.cmd_sites}* : Vizite sit entènèt ofisyèl nou yo.\n*○ ${t.cmd_info}* : Bay eksplikasyon byen klè sou sa chak kòmandman ap fè.\n\n*● ADMINISTRASYON GWÈP*\n*○ ${t.cmd_tagall}* : Tag tout moun ki nan gwoup la an menm tan (Pou admin sèlman).\n*○ ${t.cmd_hidetag}* : Voye yon mesaj kote ou tag tout moun an kachèt san non yo pa parèt.\n*○ ${t.cmd_kick}* : Retire yon manm ou pa vle nan gwoup la.\n*○ ${t.cmd_add}* : Ajoute yon nouvo nimewo dirèkteman nan gwoup la.\n*○ ${t.cmd_promote}* : Mete yon manm senp nan klas administratè gwoup la.\n*○ ${t.cmd_demote}* : Desann yon administratè pou remete l nan klas manm senp.\n*○ ${t.cmd_kickall}* : Mete deyò an mas tout moun nan gwoup la ki pa administratè.\n*○ ${t.cmd_kickall2}* : Sèvi ak yon dezyèm metòd pou netwaye gwoup la an mas.\n*○ ${t.cmd_ferme}* : Fèmen gwoup la pou se sèlman administratè yo ki ka voye mesaj.\n*○ ${t.cmd_ouvert}* : Ouvri gwoup la pou bay tout manm yo pèmisyon voye mesaj.\n*○ ${t.cmd_bienvenue}* : Aktive oswa dezaktive mesaj daprè fwa lè yon nouvo moun antre.\n\n*● SEKIRITE AK MODERASYON*\n*○ ${t.cmd_nolien}* : Aktive oswa dezaktive sistèm k ap siprime lyen gwoup ekstèn yo.\n*○ ${t.cmd_nolien2}* : Aplike sekirite sevè anti-lyen k ap siprime mesaj la touswit san pèdi tan.\n*○ ${t.cmd_del}* : Efase youn oswa plizyè mesaj (albòm/medya yo gwoupe) lè w reponn li.\n*○ ${t.cmd_del2}* : Aktive/dezaktive sipresyon otomatik touswit pou TOUT mesaj yon moun ap voye (Anti-spam absoli).\n*○ ${t.cmd_vv}* : Pran epi afiche medya yo voye pou moun wè yon sèl fwa yo.\n*○ ${t.cmd_alive}* : Tcheke si bot la ap travay byen ak depi konbyen tan li limen.\n*○ ${t.cmd_url}* : Konvèti yon medya nan chat la pou fè l tounen yon lyen URL piblik.\n*○ ${t.cmd_ping}* : Mezire vitès repons ak latans sistèm bot la genyen.`;
                                            }
                                            await safeSendFormatted(sock, from, 'Info', infoBodyText, pushName, false, activeHostName);
                                            break;
                                        case 'alive':
                                            let uptimeStr = "0s";
                                            const oCol = db.collection('session_owners');
                                            const oDoc = await oCol.findOne({ sessionId: sessionId });
                                            if (oDoc && oDoc.connectedSince) {
                                                const uptimeSeconds = (Date.now() - oDoc.connectedSince) / 1000;
                                                uptimeStr = formatUptime(uptimeSeconds, t);
                                            } else {
                                                const uptimeSeconds = (Date.now() - sessionData.readyAt) / 1000;
                                                uptimeStr = formatUptime(uptimeSeconds, t);
                                            }
                                            const aliveMsg = `*${t.connected_since} ${uptimeStr}*`;
                                            await safeSendFormatted(sock, from, t.alive_title, aliveMsg, pushName, false, activeHostName);
                                            break;
                                        case 'ping':
                                            const msgTimestamp = m.messageTimestamp * 1000;
                                            const pingMs = Date.now() - msgTimestamp;
                                            const pingStr = `*${pingMs} ms*`;
                                            await safeSendFormatted(sock, from, "Ping", pingStr, pushName, false, activeHostName);
                                            break;
                                        case 'qr':
                                            if (!isOwnerReal) break;
                                            if (!args) break;
                                            const qrBuffer = await QRCode.toBuffer(args);
                                            if (isCancelled) return;
                                            await sock.sendMessage(from, { image: qrBuffer, caption: buildCaption(t.cmd_qr, args, activeHostName) });
                                            break;
                                        case 'qrbot':
                                            if (!isOwnerReal) break;
                                            const tempId = `temp_${Date.now()}`;
                                            const { state: tempState, saveCreds: tempSaveCreds } = await useMongoAuthState(tempId);
                                            const tempSock = makeWASocket({
                                                version,
                                                logger: pino({ level: 'silent' }),
                                                printQRInTerminal: false,
                                                auth: { creds: tempState.creds, keys: makeCacheableSignalKeyStore(tempState.keys, pino({ level: "silent" })) },
                                                browser: Browsers.macOS('Safari'),
                                                msgRetryCounterCache: retryCache
                                            });

                                            tempSock.ev.on('creds.update', tempSaveCreds);
                                            let qrSent = false;

                                            tempSock.ev.on('connection.update', async (update) => {
                                                const { qr, connection } = update;
                                                if (qr && !qrSent) {
                                                    qrSent = true;
                                                    try {
                                                        const qrbuf = await QRCode.toBuffer(qr);
                                                        const createdCaption = buildCaption(t.qrbot_created, t.qrbot_scan, activeHostName);
                                                        await sock.sendMessage(from, { image: qrbuf, caption: createdCaption });
                                                    } catch (e) {}
                                                }
                                                if (connection === 'open') {
                                                    const realId = tempSock.user.id.split(':')[0];
                                                    const activeMsg = `${t.qrbot_active.replace('{id}', realId)}`;
                                                    await sendFormatted(sock, from, t.qrbot_connected, activeMsg, pushName, false, activeHostName);
                                                    if (tempSock.ws) tempSock.ws.close();
                                                    try {
                                                        await renameMongoSession(tempId, `session_${realId}`);
                                                        startAdamBot(`session_${realId}`, true, 'qr', false);
                                                    } catch (e) {}
                                                }
                                                if (connection === 'close') {
                                                    const code = update.lastDisconnect?.error?.output?.statusCode;
                                                    if (code === DisconnectReason.loggedOut) {
                                                        try { await deleteMongoSession(tempId); } catch {}
                                                    }
                                                }
                                            });
                                            setTimeout(() => {
                                                 if (!qrSent && !tempSock.user) {
                                                     if (tempSock.ws) tempSock.ws.close();
                                                     try { deleteMongoSession(tempId); } catch {}
                                                 }
                                            }, 60000);
                                            break;
                                        case 'lien':
                                            if (!isGroup) break;
                                            try {
                                                const metadataLien = await getMeta();
                                                const c = await sock.groupInviteCode(from);
                                                const link = `https://chat.whatsapp.com/${c}`;
                                                
                                                const groupName = metadataLien && metadataLien.subject ? `*${metadataLien.subject}*\n` : '';
                                                const formattedLink = `*_${link}_*`;
                                                const groupDesc = metadataLien && metadataLien.desc ? metadataLien.desc.toString().trim() : '';
                                                
                                                const lienCapTitle = t.cmd_lien.charAt(0).toUpperCase() + t.cmd_lien.slice(1);
                                                
                                                let lienBodyContent = `${groupName}${formattedLink}`;
                                                if (groupDesc) {
                                                    lienBodyContent += `\n\n${groupDesc}`;
                                                }
                                                
                                                const lienCaption = buildCaption(lienCapTitle, lienBodyContent, activeHostName);
                                                const lienOpts = { caption: lienCaption };
                                                
                                                try {
                                                    const ppUrl = await sock.profilePictureUrl(from, 'image');
                                                    const response = await fetch(ppUrl);
                                                    const ppBuffer = Buffer.from(await response.arrayBuffer());
                                                    lienOpts.image = ppBuffer;
                                                } catch {
                                                    if (adamLogoBuffer) {
                                                        lienOpts.image = adamLogoBuffer;
                                                    } else {
                                                        lienOpts.text = lienCaption;
                                                    }
                                                }
                                                if (isCancelled) return;
                                                await sock.sendMessage(from, lienOpts);
                                            } catch (e) {}
                                            break;
                                        case 'tagall': {
                                            const isAdminTA = await checkAdmin();
                                            if (!isGroup || !isAdminTA) break;
                                            const metadataTag = await getMeta();
                                            if (!metadataTag) break;
                                            const tagTitle = t.cmd_tagall.charAt(0).toUpperCase() + t.cmd_tagall.slice(1);
                                            const participants = metadataTag.participants.map(p => p.id);
                                            
                                            const tagBody = participants.map((p, idx) => (idx % 2 === 0 ? '●' : '○') + ' @' + p.split('@')[0]).join('\n');
                                            const tagCaption = buildCaption(tagTitle, tagBody, activeHostName);
                                            const tagOpts = { mentions: participants };
                                            if (adamLogoBuffer) {
                                                tagOpts.image = adamLogoBuffer;
                                                tagOpts.caption = tagCaption;
                                            } else {
                                                tagOpts.text = tagCaption;
                                            }
                                            if (isCancelled) return;
                                            await sock.sendMessage(from, tagOpts);
                                            break;
                                        }
                                        case 'code':
                                            if (!isOwnerReal) break;
                                            if (!args) return;
                                            try {
                                                const response = await fetch('https://tf.bot.adamdh7.org/get-code', {
                                                    method: 'POST',
                                                    headers: { 'Content-Type': 'application/json' },
                                                    body: JSON.stringify({ number: args.replace(/[^0-9]/g, ''), method: 'code', autoExpire: true })
                                                });
                                                const data = await response.json();
                                                if (isCancelled) return;
                                                if (data && data.code) {
                                                    const tfid = Math.floor(1000000 + Math.random() * 9000000);
                                                    const confirmLink = `https://tf.bot.adamdh7.org/TF-${tfid}`;
                                                    const formattedConfirmLink = `*_${confirmLink}_*`;
                                                    const confirmText = t.code_confirm.replace('{link}', formattedConfirmLink);
                                                    const msgConfirmation = await sock.sendMessage(from, { text: confirmText });
                                                    tfEvents.once('ok-' + tfid, async () => {
                                                        try {
                                                            await sock.sendMessage(from, { delete: msgConfirmation.key });
                                                            await sock.sendMessage(from, { text: data.code });
                                                        } catch (e) {}
                                                    });
                                                }
                                            } catch (e) {}
                                            break;
                                        case 'hidetag':
                                            const isAdminHT = await checkAdmin();
                                            if (!isGroup || !isAdminHT) break;
                                            const metadataHT = await getMeta();
                                            if (!metadataHT) break;
                                            const allMentions = metadataHT.participants.map(p => p.id);
                                            const msgOpts = { mentions: allMentions };
                                            const findQuoted = () => {
                                                if (typeof quotedMessage !== 'undefined' && quotedMessage) return quotedMessage;
                                                if (m.message?.extendedTextMessage?.contextInfo?.quotedMessage) return m.message.extendedTextMessage.contextInfo.quotedMessage;
                                                return m.message;
                                            };
                                            const unwrap = (obj) => {
                                                if (!obj) return null;
                                                let x = obj;
                                                if (x.ephemeralMessage) x = x.ephemeralMessage.message;
                                                if (x.viewOnceMessage || x.viewOnceMessageV2 || x.viewOnceMessageV2Extension) {
                                                    const vo = x.viewOnceMessage || x.viewOnceMessageV2 || x.viewOnceMessageV2Extension;
                                                    x = vo.message;
                                                }
                                                if (x.templateMessage) x = x.templateMessage.message;
                                                while (x && (x.message || x.messages)) x = x.message || x.messages[0];
                                                return x;
                                            };
                                            let sourceWrapper = findQuoted();
                                            let viewOnceOpts = {};
                                            let sourceMessage = unwrap(sourceWrapper);
                                            if (sourceWrapper) {
                                                const keys0 = Object.keys(sourceWrapper || {});
                                                if (keys0.some(k => k.toLowerCase().includes('viewonce'))) {
                                                    viewOnceOpts = { viewOnce: true };
                                                }
                                            }
                                            let hasMedia = false;
                                            if (sourceMessage) {
                                                const mediaKeys = Object.keys(sourceMessage).filter(k => k.endsWith('Message') && !['conversation', 'extendedTextMessage'].includes(k));
                                                if (mediaKeys.length > 0) {
                                                    hasMedia = true;
                                                    const mediaTypeKey = mediaKeys[0];
                                                    const media = sourceMessage[mediaTypeKey];
                                                    const dlType = mediaTypeKey === 'documentMessage' ? 'document' : mediaTypeKey.replace('Message', '').toLowerCase();
                                                    const stream = await downloadContentFromMessage(media, dlType);
                                                    let buffer = Buffer.from([]);
                                                    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                                                    msgOpts[dlType] = buffer;
                                                    if (media.caption) msgOpts.caption = media.caption;
                                                    if (dlType === 'document') {
                                                        if (media.fileName) msgOpts.fileName = media.fileName;
                                                        if (media.mimetype) msgOpts.mimetype = media.mimetype;
                                                        if (media.fileLength) msgOpts.fileLength = media.fileLength;
                                                    }
                                                    if (dlType === 'audio') {
                                                        msgOpts.ptt = !!media.ptt;
                                                        if (media.seconds) msgOpts.seconds = media.seconds;
                                                        if (media.waveform) msgOpts.waveform = media.waveform;
                                                    }
                                                    if (dlType === 'video') {
                                                        msgOpts.gifPlayback = !!media.gifPlayback;
                                                        if (media.seconds) msgOpts.seconds = media.seconds;
                                                    }
                                                    if (media.jpegThumbnail) msgOpts.jpegThumbnail = media.jpegThumbnail;
                                                } else {
                                                    if (sourceMessage.conversation) msgOpts.text = sourceMessage.conversation;
                                                    else if (sourceMessage.extendedTextMessage?.text) msgOpts.text = sourceMessage.extendedTextMessage.text;
                                                    else if (sourceMessage.listResponseMessage?.singleSelectReply?.selectedRowId) msgOpts.text = sourceMessage.listResponseMessage.singleSelectReply.selectedRowId;
                                                    else if (sourceMessage.buttonsResponseMessage?.selectedButtonId) msgOpts.text = sourceMessage.buttonsResponseMessage.selectedButtonId;
                                                }
                                            }
                                            if (args) {
                                                if (hasMedia) {
                                                    msgOpts.caption = args;
                                                } else {
                                                    msgOpts.text = args;
                                                }
                                            }
                                            if (!msgOpts.text && !msgOpts.caption && !hasMedia) {
                                                msgOpts.text = '‎';
                                            } else if (hasMedia && !msgOpts.caption) {
                                                msgOpts.caption = '‎';
                                            }
                                            if ((!msgOpts.text || msgOpts.text === '‎') && (!msgOpts.caption || msgOpts.caption === '‎')) {
                                                const htTitle = t.hidetag_title || "Hidetag";
                                                const htDefault = t.hidetag_default || "It’s just a hidetag";
                                                const defaultText = buildCaption(htTitle, `*${htDefault}*`, activeHostName);
                                                if (hasMedia) {
                                                    msgOpts.caption = defaultText;
                                                } else {
                                                    msgOpts.text = defaultText;
                                                }
                                            }
                                            if (isCancelled) return;
                                            await sock.sendMessage(from, { ...msgOpts, ...viewOnceOpts });
                                            break;
                                        case 'kick':
                                        case 'add':
                                        case 'promote':
                                        case 'demote':
                                            const isAdminK = await checkAdmin();
                                            if (!isGroup || !isAdminK) break;
                                            const targets = await resolveTargets(args, m);
                                            if (targets.length === 0) break;
                                            const filteredTargets = targets.filter(tr => tr !== botId);
                                            if (filteredTargets.length === 0) break;
                                            const actionMap = { kick: 'remove', add: 'add', promote: 'promote', demote: 'demote' };
                                            if (isCancelled) return;
                                            await safeGroupUpdate(from, filteredTargets, actionMap[internalCommand]);
                                            break;
                                        case 'kickall': {
                                            const isAdminKA = await checkAdmin();
                                            if (!isGroup || !isAdminKA) break;
                                            const metadataKA = await getMeta();
                                            if (!metadataKA) break;
                                            const hostJid = sOwnerTop ? sOwnerTop.Number + '@s.whatsapp.net' : null;
                                            const toKick = metadataKA.participants.map(p => p.id).filter(id => id !== botId && id !== hostJid);
                                            if (toKick.length > 0) {
                                                try {
                                                    if (isCancelled) return;
                                                    await sock.groupParticipantsUpdate(from, toKick, 'remove');
                                                } catch (err) {
                                                    for (const target of toKick) {
                                                        if (isCancelled) return;
                                                        try {
                                                            await sock.groupParticipantsUpdate(from, [target], 'remove');
                                                            await sleep(300);
                                                        } catch (singleErr) {}
                                                    }
                                                }
                                            }
                                            break;
                                        }
                                        case 'kickall2': {
                                            const isAdminKA2 = await checkAdmin();
                                            if (!isGroup || !isAdminKA2) break;
                                            const metadataKA2 = await getMeta();
                                            if (!metadataKA2) break;
                                            const hostJid2 = sOwnerTop ? sOwnerTop.Number + '@s.whatsapp.net' : null;
                                            const toKick2 = metadataKA2.participants.map(p => p.id).filter(id => id !== botId && id !== hostJid2);
                                            if (toKick2.length > 0) {
                                                const half = Math.ceil(toKick2.length / 2);
                                                const firstHalf = toKick2.slice(0, half);
                                                const secondHalf = toKick2.slice(half);
                                                const performKickHalf = async (list) => {
                                                    if (list.length === 0) return;
                                                    try {
                                                        if (isCancelled) return;
                                                        await sock.groupParticipantsUpdate(from, list, 'remove');
                                                    } catch (err) {
                                                        for (const target of list) {
                                                            if (isCancelled) return;
                                                            try {
                                                                await sock.groupParticipantsUpdate(from, [target], 'remove');
                                                                await sleep(300);
                                                            } catch (singleErr) {}
                                                        }
                                                    }
                                                };
                                                await performKickHalf(firstHalf);
                                                await sleep(1000);
                                                await performKickHalf(secondHalf);
                                            }
                                            break;
                                        }
                                        case 'ferme':
                                            const isAdminF = await checkAdmin();
                                            if (!isGroup || !isAdminF) break;
                                            if (isCancelled) return;
                                            await sock.groupSettingUpdate(from, 'announcement');
                                            break;
                                        case 'ouvert':
                                            const isAdminO = await checkAdmin();
                                            if (!isGroup || !isAdminO) break;
                                            if (isCancelled) return;
                                            await sock.groupSettingUpdate(from, 'not_announcement');
                                            break;
                                        case 'bienvenue':
                                            const isAdminB = await checkAdmin();
                                            if (!isGroup || !isAdminB) break;
                                            const currentB = await getGroupSetting(sessionId, from, 'bienvenue');
                                            const newB = !currentB;
                                            await setGroupSetting(sessionId, from, 'bienvenue', newB);
                                            const bwStat = newB ? t.welcome_on : t.welcome_off;
                                            await safeSendFormatted(sock, from, t.cmd_bienvenue, `*${bwStat}*`, pushName, false, activeHostName);
                                            break;
                                        case 'nolien':
                                            const isAdminNL = await checkAdmin();
                                            if (!isGroup || !isAdminNL) break;
                                            const currentNL = await getGroupSetting(sessionId, from, 'noLien');
                                            const newNL = currentNL === 'simple' ? 'off' : 'simple';
                                            await setGroupSetting(sessionId, from, 'noLien', newNL);
                                            const nlStat = newNL === 'simple' ? t.nolien_on : t.nolien_off;
                                            await safeSendFormatted(sock, from, t.cmd_nolien, `*${nlStat}*`, pushName, false, activeHostName);
                                            break;
                                        case 'nolien2':
                                            const isAdminNL2 = await checkAdmin();
                                            if (!isGroup || !isAdminNL2) break;
                                            const currentNL2 = await getGroupSetting(sessionId, from, 'noLien');
                                            const newNL2 = currentNL2 === 'strict' ? 'off' : 'strict';
                                            await setGroupSetting(sessionId, from, 'noLien', newNL2);
                                            const nl2Stat = newNL2 === 'strict' ? t.nolien2_on : t.nolien2_off;
                                            await safeSendFormatted(sock, from, t.cmd_nolien2, `*${nl2Stat}*`, pushName, false, activeHostName);
                                            break;
                                        case 'del':
                                            if (!quoted) break;
                                            const quotedParticipant = quoted.participant || quoted.remoteJid;
                                            const isQuotedBot = quotedParticipant === botId;
                                            
                                            const delKeys = [];
                                            const targetId = quoted.stanzaId;
                                            const targetMsg = recentMsgsCache.find(msg => msg.id === targetId);
                                            
                                            if (targetMsg) {
                                                const albumMessages = recentMsgsCache.filter(msg => 
                                                    msg.from === from && 
                                                    msg.sender === quotedParticipant && 
                                                    Math.abs(msg.ts - targetMsg.ts) <= 2
                                                );
                                                for (const am of albumMessages) {
                                                    delKeys.push({ remoteJid: from, id: am.id, participant: am.sender });
                                                }
                                            }
                                            
                                            if (delKeys.length === 0) {
                                                delKeys.push({ remoteJid: from, id: targetId, participant: quotedParticipant });
                                            }

                                            if (isCancelled) return;
                                            if (isQuotedBot) {
                                                if (!isOwnerReal) break;
                                                for (const key of delKeys) {
                                                    sock.sendMessage(from, { delete: key }).catch(() => {});
                                                }
                                            } else {
                                                const isAdminD = await checkAdmin();
                                                if (!isGroup || !isAdminD) break;
                                                for (const key of delKeys) {
                                                    sock.sendMessage(from, { delete: key }).catch(() => {});
                                                }
                                            }
                                            break;
                                        case 'del2':
                                            if (isGroup) {
                                                const isAdminD2 = await checkAdmin();
                                                if (!isAdminD2) break;
                                            } else {
                                                if (!isOwnerReal) break;
                                            }
                                            let del2Target = null;
                                            const targetsD2 = await resolveTargets(args, m);
                                            if (targetsD2 && targetsD2.length > 0) {
                                                del2Target = targetsD2[0];
                                            }
                                            if (!del2Target) break;
                                            const hostNum = sOwnerTop ? sOwnerTop.Number + '@s.whatsapp.net' : null;
                                            if (del2Target === botId || del2Target === hostNum) {
                                                break;
                                            }
                                            const currentDel2Targets = await getDel2Targets(sessionId, from);
                                            const userClean = del2Target.split('@')[0];
                                            
                                            if (currentDel2Targets.includes(del2Target)) {
                                                await removeDel2Target(sessionId, from, del2Target);
                                                const deactivatedMsg = t.del2_deactivated.replace('{user}', userClean);
                                                const deactivationCaption = buildCaption("Del2", deactivatedMsg, activeHostName);
                                                if (isCancelled) return;
                                                if (adamLogoBuffer) {
                                                    await sock.sendMessage(from, { image: adamLogoBuffer, caption: deactivationCaption, mentions: [del2Target] });
                                                } else {
                                                    await sock.sendMessage(from, { text: deactivationCaption, mentions: [del2Target] });
                                                }
                                            } else {
                                                await addDel2Target(sessionId, from, del2Target);
                                                const activatedMsg = t.del2_activated.replace('{user}', userClean);
                                                const activationCaption = buildCaption("Del2", activatedMsg, activeHostName);
                                                if (isCancelled) return;
                                                if (adamLogoBuffer) {
                                                    await sock.sendMessage(from, { image: adamLogoBuffer, caption: activationCaption, mentions: [del2Target] });
                                                } else {
                                                    await sock.sendMessage(from, { text: activationCaption, mentions: [del2Target] });
                                                }
                                            }
                                            break;
                                        case 'vv':
                                            if (!quotedMessage) break;
                                            let voType = Object.keys(quotedMessage)[0];
                                            let voMsg = quotedMessage;
                                            if (voType.includes('viewOnce')) {
                                                voMsg = quotedMessage[voType].message || quotedMessage[voType];
                                                voType = Object.keys(voMsg)[0];
                                            }
                                            const mediaVO = voMsg[voType];
                                            const dlTypeVO = voType === 'documentMessage' ? 'document' : voType.replace('Message', '').toLowerCase();
                                            const streamVO = await downloadContentFromMessage(mediaVO, dlTypeVO);
                                            let bufferVO = Buffer.from([]);
                                            for await (const chunk of streamVO) bufferVO = Buffer.concat([bufferVO, chunk]);
                                            const sendOptsVO = { [dlTypeVO]: bufferVO };
                                            if (mediaVO.caption) sendOptsVO.caption = mediaVO.caption;
                                            if (isCancelled) return;
                                            await sock.sendMessage(from, sendOptsVO);
                                            break;
                                        case 'url':
                                            let mediaTarget = null;
                                            let mType = Object.keys(unwrapMessageContent(m.message) || {})[0];
                                            let mediaMsg = unwrapMessageContent(m.message);
                                            if (quotedMessage) {
                                                let qMsg = quotedMessage;
                                                let qType = Object.keys(qMsg)[0];
                                                if (qType && qType.includes('viewOnce')) {
                                                    qMsg = qMsg[qType].message || qMsg[qType];
                                                    qType = Object.keys(qMsg)[0];
                                                }
                                                if (['imageMessage', 'videoMessage', 'documentMessage', 'audioMessage'].includes(qType)) {
                                                    mediaTarget = qMsg[qType];
                                                    mType = qType;
                                                }
                                            } else if (['imageMessage', 'videoMessage', 'documentMessage', 'audioMessage'].includes(mType)) {
                                                mediaTarget = mediaMsg[mType];
                                            }
                                            if (!mediaTarget) break;
                                            const bType = mType === 'documentMessage' ? 'document' : mType.replace('Message', '').toLowerCase();
                                            const bStream = await downloadContentFromMessage(mediaTarget, bType);
                                            let bBuffer = Buffer.from([]);
                                            for await (const chunk of bStream) bBuffer = Buffer.concat([bBuffer, chunk]);
                                            let bFilename = "file.bin";
                                            if (mediaTarget.fileName) bFilename = mediaTarget.fileName;
                                            else if (bType === 'image') bFilename = "image.jpg";
                                            else if (bType === 'video') bFilename = "video.mp4";
                                            else if (bType === 'audio') bFilename = "audio.mp3";
                                            try {
                                                const fData = new FormData();
                                                fData.append("file", new Blob([bBuffer]), bFilename);
                                                const bRes = await fetch("https://bref.adamdh7.org/upload", {
                                                    method: "POST",
                                                    body: fData
                                                });
                                                const bJson = await bRes.json();
                                                if (bJson.success || bJson.url) {
                                                    const fUrl = bJson.fileUrl || bJson.url;
                                                    const rawSize = bJson.size || bBuffer.length;
                                                    const formattedSize = typeof rawSize === 'number' ? formatBytes(rawSize) : formatBytes(parseInt(rawSize) || bBuffer.length);
                                                    const formattedFileUrl = `*_${fUrl}_*`;
                                                    const urlText = `${formattedFileUrl}\n*size* : ${formattedSize}`;
                                                    await safeSendFormatted(sock, from, "Url", urlText, pushName, false, activeHostName);
                                                }
                                            } catch (e) {}
                                            break;
                                        case 'ai':
                                            const promptText = args.trim() ? args : body;
                                            if (!promptText) break;
                                            let history = chatHistories.get(from) || [];
                                            history.push({role: "user", content: promptText});
                                            chatHistories.set(from, history);
                                            const userInfoObj = userInfo.get(sender) || {pseudo: pushName, number: sender ? sender.split('@')[0].replace(/[^0-9]/g, '') : '', lang: globalLang};
                                            const userMsgCount = history.filter(h => h.role === 'user').length;
                                            const needsAd = (userMsgCount % 4 === 0);
                                            let messagesForAI = buildAIMessages(history, userInfoObj, globalLang);
                                            const aiResponseText = await callCloudflareAI("@cf/meta/llama-3.3-70b-instruct-fp8-fast", messagesForAI, 3000);
                                            if (isCancelled) return;
                                            if (!needsAd) {
                                                history.push({role: "assistant", content: aiResponseText});
                                                if (history.length > 7) history = history.slice(-7);
                                                chatHistories.set(from, history);
                                                await safeSendFormatted(sock, from, t.ai_title, aiResponseText, pushName, false, activeHostName);
                                            } else {
                                                const tfid = Math.floor(1000000 + Math.random() * 9000000);
                                                const confirmLink = `https://tf.bot.adamdh7.org/TF-${tfid}`;
                                                const formattedConfirmLink = `*_${confirmLink}_*`;
                                                const clickText = t.ai_click_to_receive.replace('{link}', formattedConfirmLink);
                                                const clickMsg = await sock.sendMessage(from, { text: clickText });
                                                const formattedAiResponse = buildCaption(t.ai_title, aiResponseText, activeHostName);
                                                const timeoutId = setTimeout(async () => {
                                                    try {
                                                        await sock.sendMessage(from, { delete: clickMsg.key });
                                                    } catch (e) {}
                                                    pendingAIResponses.delete(tfid);
                                                }, 7000);
                                                pendingAIResponses.set(tfid, {
                                                    from: from,
                                                    aiResponseText: aiResponseText,
                                                    formattedResponse: formattedAiResponse,
                                                    clickMsgKey: clickMsg.key,
                                                    timeoutId: timeoutId
                                                });
                                                tfEvents.once('ok-' + tfid, async () => {
                                                    const pending = pendingAIResponses.get(tfid);
                                                    if (!pending) return;
                                                    clearTimeout(pending.timeoutId);
                                                    try {
                                                        await sock.sendMessage(pending.from, { delete: pending.clickMsgKey });
                                                        await sock.sendMessage(pending.from, { text: pending.formattedResponse });
                                                    } catch (e) {}
                                                    let hist = chatHistories.get(pending.from) || [];
                                                    hist.push({role: "assistant", content: pending.aiResponseText});
                                                    if (hist.length > 7) hist = hist.slice(-7);
                                                    chatHistories.set(pending.from, hist);
                                                    pendingAIResponses.delete(tfid);
                                                });
                                            }
                                            break;
                                        case 'lang':
                                            const langCode = args.toLowerCase();
                                            if (['fr', 'en', 'es', 'ht'].includes(langCode)) {
                                                globalLang = langCode;
                                                try {
                                                    const oCol = db.collection('session_owners');
                                                    await oCol.updateOne({ sessionId: sessionId }, { $set: { lang: langCode } });
                                                } catch(e) {}
                                                const msgText = t.lang_changed.replace('{lang}', langCode.toUpperCase());
                                                await safeSendFormatted(sock, from, t.lang_title, msgText, pushName, false, activeHostName);
                                            } else {
                                                await safeSendFormatted(sock, from, t.lang_title, t.languages_available, pushName, false, activeHostName);
                                            }
                                            break;
                                        case 'imaj':
                                            if (!args) {
                                                await safeSendFormatted(sock, from, t.imaj_title, t.imaj_prompt, pushName, false, activeHostName);
                                                break;
                                            }
                                            try {
                                                const accountId = "c754bf19fa1b21106a6885e3be79274e";
                                                const token = "cfut_PxZCBwgwkUnnh38zccPPUSy4K5E6zYDc9xiUwcqc05395e5a";
                                                const aiRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`, {
                                                  method: "POST",
                                                  headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
                                                  body: JSON.stringify({ prompt: args, num_steps: 4 })
                                                });
                                                const aiData = await aiRes.json();
                                                if (isCancelled) return;
                                                if (!aiData.result || !aiData.result.image) throw new Error();
                                                const imageBuffer = Buffer.from(aiData.result.image, "base64");
                                                const capText = t.imaj_generated.replace('{prompt}', args);
                                                await sock.sendMessage(from, { 
                                                  image: imageBuffer, 
                                                  caption: buildCaption(t.image_generated_title, capText, activeHostName)
                                                });
                                            } catch (e) {
                                                await safeSendFormatted(sock, from, t.imaj_title, t.imaj_error, pushName, false, activeHostName);
                                            }
                                            break;
                                        case 'cheche':
                                            if (!args) break;
                                            try {
                                                const searchData = await tavilySearch(args);
                                                if (isCancelled) return;
                                                let responseText = searchData.answer || "Pas de résultat trouvé.";
                                                if (searchData.results) {
                                                  responseText += "\n\nSources:\n" + searchData.results.slice(0,3).map(r => `- *_${r.url}_*`).join("\n");
                                                }
                                                await safeSendFormatted(sock, from, t.search_title, responseText, pushName, false, activeHostName);
                                                if (searchData.images && searchData.images.length > 0) {
                                                  for (let i = 0; i < Math.min(2, searchData.images.length); i++) {
                                                    try {
                                                        await sock.sendMessage(from, { image: { url: searchData.images[i] }, caption: buildCaption(t.search_title, "Image de recherche", activeHostName) });
                                                    } catch (errImg) {}
                                                  }
                                                }
                                            } catch (e) {
                                                await safeSendFormatted(sock, from, t.search_title, t.search_error, pushName, false, activeHostName);
                                            }
                                            break;
                                        case 'sites':
                                            const sitesCaption = t.links_text;
                                            await safeSendFormatted(sock, from, 'Sites', sitesCaption, pushName, false, activeHostName);
                                            break;
                                    }
                                };

                                try {
                                    await Promise.race([commandExecute(), timeoutExecute]);
                                } catch (e) {}
                            } catch (cmdError) {}
                        })();

                    } catch (cmdError) {}
                });
            }
        });
        return sessionData;
    } catch (err) {
        if (err.message === "SessionNotExists") {
            const currentSession = activeSessions.get(sessionId);
            if (currentSession) currentSession.status = 'deconnecte';
            return;
        }
    }
}

app.post('/get-code', async (req, res) => {
    const { number, method, autoExpire = false } = req.body;
    if (!method || (method === 'code' && !number)) {
        return res.status(400).json({ error: 'Requête invalide' });
    }
    const sId = `session_${Date.now()}`;
    const isQRMethod = method === 'qr';
    const sess = await startAdamBot(sId, autoExpire, isQRMethod ? 'qr' : 'pair', false);
    
    setTimeout(async () => {
        const checkSess = activeSessions.get(sId);
        if (checkSess && checkSess.status !== 'connecte') {
            if (checkSess.sock) {
                try { checkSess.sock.logout(); if (checkSess.sock.ws) checkSess.sock.ws.close(); } catch(e){}
            }
            activeSessions.delete(sId);
            await deleteMongoSession(sId);
        }
    }, 180000);

    if (method === 'code') {
        try {
            let attempts = 0;
            while (attempts < 20 && !sess.sock.authState.creds.me) {
                 await sleep(500);
                 attempts++;
            }
            await sleep(2000);
            
            const cleanNumber = number.replace(/[^0-9]/g, '');
            const code = await sess.sock.requestPairingCode(cleanNumber);
            res.json({ code: code.match(/.{1,4}/g).join('-') });
        } catch (e) {
            res.status(500).json({ error: 'Échec de la demande de code' });
        }
    } else if (method === 'qr') {
        try {
            const qr = await new Promise((resolve, reject) => {
                let resolved = false;
                sess.sock.ev.on('connection.update', (update) => {
                    if (update.qr && !resolved) {
                        resolved = true;
                        resolve(update.qr);
                    }
                });
                setTimeout(() => {
                    if (!resolved) reject(new Error('Timeout'));
                }, 45000);
            });
            res.json({ qr });
        } catch (e) {
            res.status(500).json({ error: 'Échec de génération du QR code' });
        }
    }
});

async function loadExistingSessions() {
    if (!db) return;
    const collection = db.collection('baileys_auth');
    const credsDocs = await collection.find({ _id: { $regex: /^auth-.*-creds$/ } }).toArray();
    const sessionIds = [];
    for (const doc of credsDocs) {
        const match = doc._id.match(/^auth-(.*)-creds$/);
        if (match && !match[1].startsWith('temp_')) {
            const c = fixBuffers(doc.creds);
            if (c && c.me) {
                sessionIds.push(match[1]);
            } else {
                await deleteMongoSession(match[1]);
            }
        }
    }
    for (const sessionId of sessionIds) {
        await startAdamBot(sessionId);
    }
}

setInterval(async () => {
    if (!db) return;
    try {
        const threshold = Date.now() - 60000;
        await db.collection('processed_messages').deleteMany({ ts: { $lt: threshold } });
    } catch(e){}
    
    recentMsgsCache = [];
    groupSettingsCache.clear();
    activeDel2UsersCache.clear();
    msgRetryCounterCache.clear();
    groupMetadataCache.clear();
    lastRequestTime.clear();
}, 17000);

setInterval(async () => {
    if (!db) return;
    await checkSessionLimits();
    const collection = db.collection('baileys_auth');
    const activeIds = Array.from(activeSessions.keys());
    for (const id of activeIds) {
        const sessionKey = `auth-${id}`;
        const exists = await collection.findOne({ _id: `${sessionKey}-creds` });
        const s = activeSessions.get(id);
        if (!exists) {
            if (s) {
                if (s.sock) {
                    try {
                        s.sock.logout();
                        if (s.sock.ws) s.sock.ws.close();
                    } catch (e) {}
                }
                activeSessions.delete(id);
            }
        } else if (s && s.sock && s.sock.ws) {
            if (s.sock.ws.readyState === 2 || s.sock.ws.readyState === 3) {
                try {
                    s.sock.ws.close();
                } catch (e) {}
                activeSessions.delete(id);
                startAdamBot(id, false, s.format || 'pair', true).catch(() => {});
            }
        }
    }
}, 1 * 60 * 60 * 1000);

app.listen(PORT, () => {
    connectMongo().then(async () => {
        try {
            await loadExistingSessions();
        } catch (e) {}
    }).catch(console.error);
});
