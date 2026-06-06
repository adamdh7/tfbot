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

async function connectMongo() {
  try {
    mongoClient = new MongoClient(mongoUri);
    await mongoClient.connect();
    db = mongoClient.db('dh7bot');
    try {
        await db.collection('baileys_auth').createIndex({ _id: 1 });
        await db.collection('processed_messages').createIndex({ ts: 1 }, { expireAfterSeconds: 86400 });
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

const groupSettingsCache = new Map();

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

const msgRetryCounterCache = new Map();
const retryCache = {
    get: (key) => msgRetryCounterCache.get(key),
    set: (key, value) => msgRetryCounterCache.set(key, value),
    del: (key) => msgRetryCounterCache.delete(key)
};

let activeSessions = new Map();
const groupMetadataCache = new Map();
const sessionOwnersCache = new Map();

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
    cmd_nolien: "nolien", cmd_nolien2: "nolien2", cmd_del: "supp", cmd_vv: "vv", cmd_sites: "sit", cmd_info: "info", cmd_ping: "ping", cmd_url: "url",
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
    info_body: "Voici les informations du bot Adam_D'H7 :\n\n• *Image* : Génère une image selon votre prompt.\n• *Format Caption* : Titre, Utilisateur, Propriétaire et Texte.\n• *Menu* : Liste des commandes.\n• *Tagall* : Mentionne tous les membres.\n• *Kickall* : Expulse tout le monde.\n• *Kickall2* : Expulse la moitié de la moitié de la moitié.\n• *Info* : Affiche ce message explicatif.\n• *Url* : Héberge votre média en lien URL."
  },
  en: {
    cmd_ai: "ai", cmd_lang: "lang", cmd_imaj: "image", cmd_cheche: "search",
    cmd_menu: "menu", cmd_qrbot: "qrbot", cmd_qr: "qr", cmd_code: "code", cmd_lien: "link", cmd_tagall: "tagall",
    cmd_hidetag: "hidetag", cmd_kick: "kick", cmd_add: "add", cmd_promote: "promote", cmd_demote: "demote",
    cmd_kickall: "kickall", cmd_kickall2: "kickall2", cmd_ferme: "close", cmd_ouvert: "open", cmd_bienvenue: "welcome",
    cmd_nolien: "nolink", cmd_nolien2: "nolink2", cmd_del: "del", cmd_vv: "vv", cmd_sites: "sit", cmd_info: "info", cmd_ping: "ping", cmd_url: "url",
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
    info_body: "Here is the Adam_D'H7 bot info:\n\n• *Image*: Generates an image based on your prompt.\n• *Caption Format*: Title, User, Owner, and Text.\n• *Menu*: Command list.\n• *Tagall*: Mentions all members.\n• *Kickall*: Removes everyone.\n• *Kickall2*: Removes half of half of half.\n• *Info*: Shows this explanatory message.\n• *Url*: Hosts your media as a URL link."
  },
  es: {
    cmd_ai: "ia", cmd_lang: "lang", cmd_imaj: "imagen", cmd_cheche: "buscar",
    cmd_menu: "menú", cmd_qrbot: "qrbot", cmd_qr: "qr", cmd_code: "código", cmd_lien: "enlace", cmd_tagall: "etiquetartodo",
    cmd_hidetag: "hidetag", cmd_kick: "expulsar", cmd_add: "añadir", cmd_promote: "promover", cmd_demote: "degradar",
    cmd_kickall: "borrartodo", cmd_kickall2: "borrartodo2", cmd_ferme: "cerrar", cmd_ouvert: "abrir", cmd_bienvenue: "bienvenida",
    cmd_nolien: "sinenlace", cmd_nolien2: "sinenlace2", cmd_del: "borrar", cmd_vv: "vv", cmd_sites: "sit", cmd_info: "info", cmd_ping: "ping", cmd_url: "url",
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
    info_body: "Aquí está la información del bot Adam_D'H7:\n\n• *Imagen*: Genera una imagen según tu prompt.\n• *Formato de Título*: Título, Usuario, Propietario y Texto.\n• *Menú*: Lista de comandos.\n• *Etiquetartodo*: Menciona a todos los miembros.\n• *Borrartodo*: Elimina a todos.\n• *Borrartodo2*: Elimina la mitad de la mitad de la mitad.\n• *Info*: Muestra este mensaje explicativo.\n• *Url*: Aloja tu multimedia como enlace URL."
  },
  ht: {
    cmd_ai: "ai", cmd_lang: "lang", cmd_imaj: "imaj", cmd_cheche: "cheche",
    cmd_menu: "meni", cmd_qrbot: "qrbot", cmd_qr: "qr", cmd_code: "kòd", cmd_lien: "lyen", cmd_tagall: "tout",
    cmd_hidetag: "hidetag", cmd_kick: "kick", cmd_add: "add", cmd_promote: "promote", cmd_demote: "demote",
    cmd_kickall: "siptout", cmd_kickall2: "siptout2", cmd_ferme: "fèmen", cmd_ouvert: "ouvri", cmd_bienvenue: "byenveni",
    cmd_nolien: "nolyen", cmd_nolien2: "nolyen2", cmd_del: "sip", cmd_vv: "vv", cmd_sites: "sit", cmd_info: "info", cmd_ping: "ping", cmd_url: "url",
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
    info_body: "Men enfòmasyon bot Adam_D'H7 la:\n\n• *Imaj*: Jenere yon imaj selon prompt ou.\n• *Fòma Caption*: Tit, Itilizatè, Pwopriyetè ak Tèks.\n• *Meni*: Lis kòmand yo.\n• *Tout*: Mansyone tout manm yo.\n• *Siptout*: Retire tout moun.\n• *Siptout2*: Retire mwatye nan mwatye nan mwatye.\n• *Info*: Montre mesaj eksplikasyon sa a.\n• *Url*: Mete medya ou an lyen URL."
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
                if (s.sock && s.sock.ws) {
                    try { s.sock.ws.close(); } catch (e) {}
                }
            }
        }
    } catch (e) {}
}

app.use(async (req, res, next) => {
    await checkSessionLimits();
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

app.get('/adamdh7/all7', (req, res) => {
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
                        await new Promise(resolve => setTimeout(resolve, 7000));
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
            sessionOwnersCache.clear();
            groupMetadataCache.clear();
            groupSettingsCache.clear();
            msgRetryCounterCache.clear();
            activeSessions.clear();
        } catch (e) {}
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

app.get('/adamdh7/all', async (req, res) => {
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

app.get('/adamdh7/all2', (req, res) => {
  res.json(Array.from(activeSessions.values()));
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
    "ia": "ai", "lang": "lang", "image": "imaj", "chercher": "cheche", "menu": "menu", "qrbot": "qrbot", "qr": "qr", "code": "code", "lien": "lien", "tagtout": "tagall", "hidetag": "hidetag", "expulse": "kick", "add": "add", "promote": "promote", "demote": "demote", "expulsetout": "kickall", "expulsetout2": "kickall2", "ferme": "ferme", "ouvert": "ouvert", "bienvenue": "bienvenue", "nolien": "nolien", "nolien2": "nolien2", "supp": "del", "vv": "vv", "sit": "sites", "info": "info", "alive": "alive", "ping": "ping", "pings": "ping", "url": "url", "urls": "url", "prive": "prive", "public": "public"
  },
  en: {
    "ai": "ai", "lang": "lang", "image": "imaj", "search": "cheche", "menu": "menu", "qrbot": "qrbot", "qr": "qr", "code": "code", "link": "lien", "tagall": "tagall", "hidetag": "hidetag", "kick": "kick", "add": "add", "promote": "promote", "demote": "demote", "kickall": "kickall", "kickall2": "kickall2", "close": "ferme", "open": "ouvert", "welcome": "bienvenue", "nolink": "nolien", "nolink2": "nolien2", "del": "del", "vv": "vv", "sit": "sites", "info": "info", "alive": "alive", "ping": "ping", "pings": "ping", "url": "url", "urls": "url", "private": "prive", "public": "public"
  },
  es: {
    "ia": "ai", "lang": "lang", "imagen": "imaj", "buscar": "cheche", "menú": "menu", "qrbot": "qrbot", "qr": "qr", "código": "code", "enlace": "lien", "etiquetartodo": "tagall", "hidetag": "hidetag", "expulsar": "kick", "añadir": "add", "promouvoir": "promote", "degradar": "demote", "borrartodo": "kickall", "borrartodo2": "kickall2", "cerrar": "ferme", "abrir": "ouvert", "bienvenida": "bienvenue", "sinenlace": "nolien", "sinenlace2": "nolien2", "borrar": "del", "vv": "vv", "sit": "sites", "info": "info", "alive": "alive", "ping": "ping", "pings": "ping", "url": "url", "urls": "url", "privado": "prive", "publico": "public"
  },
  ht: {
    "ai": "ai", "lang": "lang", "imaj": "imaj", "cheche": "cheche", "meni": "menu", "qrbot": "qrbot", "qr": "qr", "kòd": "code", "lyen": "lien", "tout": "tagall", "hidetag": "hidetag", "sipli": "kick", "add": "add", "promote": "promote", "demote": "demote", "siptout": "kickall", "siptout2": "kickall2", "fèmen": "ferme", "ouvri": "ouvert", "byenveni": "bienvenue", "nolyen": "nolien", "nolyen2": "nolien2", "sip": "del", "vv": "vv", "sit": "sites", "info": "info", "alive": "alive", "ping": "ping", "pings": "ping", "url": "url", "urls": "url", "prive": "prive", "piblik": "public"
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
            logger: pino({ level: 'error' }),
            printQRInTerminal: false,
            auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "error" })) },
            browser: Browsers.macOS('Safari'),
            markOnlineOnConnect: true,
            generateHighQualityLinkPreview: true,
            msgRetryCounterCache: retryCache,
            retryRequestDelayMs: 200,
            maxMsgRetryCount: 5,
            keepAliveIntervalMs: 10000,
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

        activeSessions.set(sessionId, {
            id: sessionId,
            number: null,
            format: format,
            status: 'initialisation',
            createdAt: Date.now(),
            lastRefresh: Date.now(),
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
                        const newOwner = { sessionId: sessionId, Number: currentBotNum, Name: currentBotName, connectedSince: now, mode: 'prive', lang: globalLang };
                        await ownerCol.updateOne(
                            { sessionId: sessionId },
                            { $set: newOwner },
                            { upsert: true }
                        );
                        finalRecord = newOwner;
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
                        await deleteMongoSession(sessionId);
                        activeSessions.delete(sessionId);
                    } catch (e) {}
                } else {
                    setTimeout(() => {
                        startAdamBot(sessionId, autoExpire, format, true).catch(() => {});
                    }, 3000);
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
            try {
                await checkSessionLimits();

                const m = up.messages[0];
                if (m.messageStubType) return;
                if (!m.message || Object.keys(m.message).length === 0) return;
                if (m.message.protocolMessage) return;
                if (m.message.messageContextInfo?.deviceListMetadata) return;
                if (m.key && m.key.remoteJid === 'status@broadcast') return;
                
                const timestampNow = Math.floor(Date.now() / 1000);
                if (m.messageTimestamp && (timestampNow - m.messageTimestamp > 45)) return;

                const bodyRaw = extractBody(m);
                const body = bodyRaw.trim();
                
                const ignoreTexts = [
                    'Message non chargé', 
                    'Waiting for this message', 
                    'En attente de ce message', 
                    'Ceci pourrait prendre un peu de temps',
                    'This may take a while'
                ];
                if (ignoreTexts.some(text => body.includes(text))) return;

                const from = m.key.remoteJid;
                const isFromMe = m.key.fromMe;
                const pushName = m.pushName || 'Inconnu';
                const botId = sock.user?.id ? (sock.user.id.includes(':') ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : sock.user.id) : null;
                const sender = m.key.participant || m.key.remoteJid || (isFromMe ? botId : null);
                
                const isGroup = from.endsWith('@g.us');
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

                const getMeta = async () => {
                    try {
                        if (groupMetadataCache.has(from)) return groupMetadataCache.get(from);
                        if (isGroup) {
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
                        if (!isGroup) return false;
                        const metadataA = await getMeta();
                        return metadataA ? metadataA.participants.some(p => p.id === sender && p.admin) : false;
                    } catch (e) {
                        return false;
                    }
                };

                if (isGroup) {
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
                                const linkRegex = /https?:\/\/[^\s]+|wa\.me|whatsapp\.com\/channel|chat\.whatsapp\.com/i;
                                if (linkRegex.test(bodyRaw)) {
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

                const msgId = m.key.id;
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

                if (!allowed) return;
                if (!body) return;
                
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

                try { await sock.readMessages([m.key]); } catch (e) {}
                try { await sock.sendPresenceUpdate('composing', from); } catch (e) {}

                const quoted = m.message?.extendedTextMessage?.contextInfo;
                const quotedMessage = quoted?.quotedMessage;
                const t = translations[globalLang] || translations.ht;

                await sleep(Math.floor(Math.random() * 800) + 500);

                try {
                    switch (internalCommand) {
                        case 'prive':
                            if (!isOwnerReal) break;
                            if (sOwnerTop.mode === 'prive') {
                                await sendFormatted(sock, from, "Mode", t.already_private, pushName, false, activeHostName);
                            } else {
                                sOwnerTop.mode = 'prive';
                                await db.collection('session_owners').updateOne({ sessionId: sessionId }, { $set: { mode: 'prive' } });
                                sessionOwnersCache.set(sessionId, sOwnerTop);
                                await sendFormatted(sock, from, "Mode", t.mode_changed_private, pushName, false, activeHostName);
                            }
                            break;
                        case 'public':
                            if (!isOwnerReal) break;
                            if (sOwnerTop.mode === 'public') {
                                await sendFormatted(sock, from, "Mode", t.already_public, pushName, false, activeHostName);
                            } else {
                                sOwnerTop.mode = 'public';
                                await db.collection('session_owners').updateOne({ sessionId: sessionId }, { $set: { mode: 'public' } });
                                sessionOwnersCache.set(sessionId, sOwnerTop);
                                await sendFormatted(sock, from, "Mode", t.mode_changed_public, pushName, false, activeHostName);
                            }
                            break;
                        case 'menu':
                            if (args.length > 0) break;
                            let menuBodyText = "";
                            if (globalLang === 'fr') {
                                menuBodyText = `*● ${t.cmd_ai}*\n*○ ${t.cmd_lang}*\n*○ ${t.cmd_imaj}*\n*○ ${t.cmd_cheche}*\n\n*● ${t.cmd_menu}*\n*○ ${t.cmd_qrbot}*\n*● ${t.cmd_qr}*\n*○ ${t.cmd_code}*\n*○ ${t.cmd_lien}*\n*○ ${t.cmd_sites}*\n*○ ${t.cmd_info}*\n\n*● ${t.cmd_tagall}*\n*○ ${t.cmd_hidetag}*\n*● ${t.cmd_kick}*\n*○ ${t.cmd_add}*\n*● ${t.cmd_promote}*\n*○ ${t.cmd_demote}*\n*● ${t.cmd_kickall}*\n*● ${t.cmd_kickall2}*\n*○ ${t.cmd_ferme}*\n*● ${t.cmd_ouvert}*\n*○ ${t.cmd_bienvenue}*\n\n*○ ${t.cmd_nolien}*\n*● ${t.cmd_nolien2}*\n*○ ${t.cmd_del}*\n*● ${t.cmd_vv}*\n*○ ${t.cmd_alive}*\n*● ${t.cmd_url}*\n*○ ${t.cmd_ping}*`;
                            } else if (globalLang === 'en') {
                                menuBodyText = `*● ${t.cmd_ai}*\n*○ ${t.cmd_lang}*\n*○ ${t.cmd_imaj}*\n*○ ${t.cmd_cheche}*\n\n*● ${t.cmd_menu}*\n*○ ${t.cmd_qrbot}*\n*● ${t.cmd_qr}*\n*○ ${t.cmd_code}*\n*○ ${t.cmd_lien}*\n*○ ${t.cmd_sites}*\n*○ ${t.cmd_info}*\n\n*● ${t.cmd_tagall}*\n*○ ${t.cmd_hidetag}*\n*● ${t.cmd_kick}*\n*○ ${t.cmd_add}*\n*● ${t.cmd_promote}*\n*○ ${t.cmd_demote}*\n*● ${t.cmd_kickall}*\n*● ${t.cmd_kickall2}*\n*○ ${t.cmd_ferme}*\n*● ${t.cmd_ouvert}*\n*○ ${t.cmd_bienvenue}*\n\n*○ ${t.cmd_nolien}*\n*● ${t.cmd_nolien2}*\n*○ ${t.cmd_del}*\n*● ${t.cmd_vv}*\n*○ ${t.cmd_alive}*\n*● ${t.cmd_url}*\n*○ ${t.cmd_ping}*`;
                            } else if (globalLang === 'es') {
                                menuBodyText = `*● ${t.cmd_ai}*\n*○ ${t.cmd_lang}*\n*○ ${t.cmd_imaj}*\n*○ ${t.cmd_cheche}*\n\n*● ${t.cmd_menu}*\n*○ ${t.cmd_qrbot}*\n*● ${t.cmd_qr}*\n*○ ${t.cmd_code}*\n*○ ${t.cmd_lien}*\n*○ ${t.cmd_sites}*\n*○ ${t.cmd_info}*\n\n*● ${t.cmd_tagall}*\n*○ ${t.cmd_hidetag}*\n*● ${t.cmd_kick}*\n*○ ${t.cmd_add}*\n*● ${t.cmd_promote}*\n*○ ${t.cmd_demote}*\n*● ${t.cmd_kickall}*\n*● ${t.cmd_kickall2}*\n*○ ${t.cmd_ferme}*\n*● ${t.cmd_ouvert}*\n*○ ${t.cmd_bienvenue}*\n\n*○ ${t.cmd_nolien}*\n*● ${t.cmd_nolien2}*\n*○ ${t.cmd_del}*\n*● ${t.cmd_vv}*\n*○ ${t.cmd_alive}*\n*● ${t.cmd_url}*\n*○ ${t.cmd_ping}*`;
                            } else {
                                menuBodyText = `*● ${t.cmd_ai}*\n*○ ${t.cmd_lang}*\n*○ ${t.cmd_imaj}*\n*○ ${t.cmd_cheche}*\n\n*● ${t.cmd_menu}*\n*○ ${t.cmd_qrbot}*\n*● ${t.cmd_qr}*\n*○ ${t.cmd_code}*\n*○ ${t.cmd_lien}*\n*○ ${t.cmd_sites}*\n*○ ${t.cmd_info}*\n\n*● ${t.cmd_tagall}*\n*○ ${t.cmd_hidetag}*\n*● ${t.cmd_kick}*\n*○ ${t.cmd_add}*\n*● ${t.cmd_promote}*\n*○ ${t.cmd_demote}*\n*● ${t.cmd_kickall}*\n*● ${t.cmd_kickall2}*\n*○ ${t.cmd_ferme}*\n*● ${t.cmd_ouvert}*\n*○ ${t.cmd_bienvenue}*\n\n*○ ${t.cmd_nolien}*\n*● ${t.cmd_nolien2}*\n*○ ${t.cmd_del}*\n*● ${t.cmd_vv}*\n*○ ${t.cmd_alive}*\n*● ${t.cmd_url}*\n*○ ${t.cmd_ping}*`;
                            }
                            await sendFormatted(sock, from, t.menu_title, menuBodyText, pushName, false, activeHostName);
                            break;
                        case 'info':
                            const infoBody = t.info_body;
                            await sendFormatted(sock, from, 'Info', infoBody, pushName, false, activeHostName);
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
                            await sendFormatted(sock, from, t.alive_title, aliveMsg, pushName, false, activeHostName);
                            break;
                        case 'ping':
                            const msgTimestamp = m.messageTimestamp * 1000;
                            const pingMs = Date.now() - msgTimestamp;
                            const pingStr = `*${pingMs} ms*`;
                            await sendFormatted(sock, from, "Ping", pingStr, pushName, false, activeHostName);
                            break;
                        case 'qr':
                            if (!isOwnerReal) break;
                            if (!args) break;
                            const qrBuffer = await QRCode.toBuffer(args);
                            await sock.sendMessage(from, { image: qrBuffer, caption: buildCaption(t.cmd_qr, args, activeHostName) });
                            break;
                        case 'qrbot':
                            if (!isOwnerReal) break;
                            const tempId = `temp_${Date.now()}`;
                            const { state: tempState, saveCreds: tempSaveCreds } = await useMongoAuthState(tempId);
                            const tempSock = makeWASocket({
                                version,
                                logger: pino({ level: 'error' }),
                                printQRInTerminal: false,
                                auth: { creds: tempState.creds, keys: makeCacheableSignalKeyStore(tempState.keys, pino({ level: "error" })) },
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
                            await safeGroupUpdate(from, filteredTargets, actionMap[internalCommand]);
                            break;
                        case 'kickall':
                            const isAdminKA = await checkAdmin();
                            if (!isGroup || !isAdminKA) break;
                            const metadataKA = await getMeta();
                            if (!metadataKA) break;
                            const toKick = metadataKA.participants.filter(p => p.admin === null && p.id !== botId).map(p => p.id);
                            if (toKick.length > 0) {
                                for (let i = 0; i < toKick.length; i += 5) {
                                    const chunk = toKick.slice(i, i + 5);
                                    await safeGroupUpdate(from, chunk, 'remove');
                                    await sleep(1500); 
                                }
                            }
                            break;
                        case 'kickall2':
                            const isAdminKA2 = await checkAdmin();
                            if (!isGroup || !isAdminKA2) break;
                            const metadataKA2 = await getMeta();
                            if (!metadataKA2) break;
                            const toKick2 = metadataKA2.participants.filter(p => p.admin === null && p.id !== botId).map(p => p.id);
                            if (toKick2.length > 0) {
                                const fractionCount = Math.max(1, Math.floor(toKick2.length / 7));
                                const fractionToKick = toKick2.slice(0, fractionCount);
                                for (let i = 0; i < fractionToKick.length; i +=  7) {
                                    const chunk = fractionToKick.slice(i, i + 7);
                                    await safeGroupUpdate(from, chunk, 'remove');
                                    await sleep(1500);
                                }
                            }
                            break;
                        case 'ferme':
                            const isAdminF = await checkAdmin();
                            if (!isGroup || !isAdminF) break;
                            await sock.groupSettingUpdate(from, 'announcement');
                            break;
                        case 'ouvert':
                            const isAdminO = await checkAdmin();
                            if (!isGroup || !isAdminO) break;
                            await sock.groupSettingUpdate(from, 'not_announcement');
                            break;
                        case 'bienvenue':
                            const isAdminB = await checkAdmin();
                            if (!isGroup || !isAdminB) break;
                            const currentB = await getGroupSetting(sessionId, from, 'bienvenue');
                            const newB = !currentB;
                            await setGroupSetting(sessionId, from, 'bienvenue', newB);
                            const bwStat = newB ? t.welcome_on : t.welcome_off;
                            await sendFormatted(sock, from, t.cmd_bienvenue, `*${bwStat}*`, pushName, false, activeHostName);
                            break;
                        case 'nolien':
                            const isAdminNL = await checkAdmin();
                            if (!isGroup || !isAdminNL) break;
                            const currentNL = await getGroupSetting(sessionId, from, 'noLien');
                            const newNL = currentNL === 'simple' ? 'off' : 'simple';
                            await setGroupSetting(sessionId, from, 'noLien', newNL);
                            const nlStat = newNL === 'simple' ? t.nolien_on : t.nolien_off;
                            await sendFormatted(sock, from, t.cmd_nolien, `*${nlStat}*`, pushName, false, activeHostName);
                            break;
                        case 'nolien2':
                            const isAdminNL2 = await checkAdmin();
                            if (!isGroup || !isAdminNL2) break;
                            const currentNL2 = await getGroupSetting(sessionId, from, 'noLien');
                            const newNL2 = currentNL2 === 'strict' ? 'off' : 'strict';
                            await setGroupSetting(sessionId, from, 'noLien', newNL2);
                            const nl2Stat = newNL2 === 'strict' ? t.nolien2_on : t.nolien2_off;
                            await sendFormatted(sock, from, t.cmd_nolien2, `*${nl2Stat}*`, pushName, false, activeHostName);
                            break;
                        case 'del':
                            if (!quoted) break;
                            const quotedParticipant = quoted.participant || quoted.remoteJid;
                            const isQuotedBot = quotedParticipant === botId;
                            const delKey = { remoteJid: from, id: quoted.stanzaId, participant: quotedParticipant };
                            if (isQuotedBot) {
                                if (!isOwnerReal) break;
                                await sock.sendMessage(from, { delete: delKey });
                            } else {
                                const isAdminD = await checkAdmin();
                                if (!isGroup || !isAdminD) break;
                                await sock.sendMessage(from, { delete: delKey });
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
                                    await sendFormatted(sock, from, "Url", urlText, pushName, false, activeHostName);
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
                            if (!needsAd) {
                                history.push({role: "assistant", content: aiResponseText});
                                if (history.length > 7) history = history.slice(-7);
                                chatHistories.set(from, history);
                                await sendFormatted(sock, from, t.ai_title, aiResponseText, pushName, false, activeHostName);
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
                                await sendFormatted(sock, from, t.lang_title, msgText, pushName, false, activeHostName);
                            } else {
                                await sendFormatted(sock, from, t.lang_title, t.languages_available, pushName, false, activeHostName);
                            }
                            break;
                        case 'imaj':
                            if (!args) {
                                await sendFormatted(sock, from, t.imaj_title, t.imaj_prompt, pushName, false, activeHostName);
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
                                if (!aiData.result || !aiData.result.image) throw new Error();
                                const imageBuffer = Buffer.from(aiData.result.image, "base64");
                                const capText = t.imaj_generated.replace('{prompt}', args);
                                await sock.sendMessage(from, { 
                                  image: imageBuffer, 
                                  caption: buildCaption(t.image_generated_title, capText, activeHostName)
                                });
                            } catch (e) {
                                await sendFormatted(sock, from, t.imaj_title, t.imaj_error, pushName, false, activeHostName);
                            }
                            break;
                        case 'cheche':
                            if (!args) break;
                            try {
                                const searchData = await tavilySearch(args);
                                let responseText = searchData.answer || "Pas de résultat trouvé.";
                                if (searchData.results) {
                                  responseText += "\n\nSources:\n" + searchData.results.slice(0,3).map(r => `- *_${r.url}_*`).join("\n");
                                }
                                await sendFormatted(sock, from, t.search_title, responseText, pushName, false, activeHostName);
                                if (searchData.images && searchData.images.length > 0) {
                                  for (let i = 0; i < Math.min(2, searchData.images.length); i++) {
                                    try {
                                        await sock.sendMessage(from, { image: { url: searchData.images[i] }, caption: buildCaption(t.search_title, "Image de recherche", activeHostName) });
                                    } catch (errImg) {}
                                  }
                                }
                            } catch (e) {
                                await sendFormatted(sock, from, t.search_title, t.search_error, pushName, false, activeHostName);
                            }
                            break;
                        case 'sites':
                            const sitesCaption = t.links_text;
                            await sendFormatted(sock, from, 'Sites', sitesCaption, pushName, false, activeHostName);
                            break;
                    }
                } catch (cmdError) {}
            } catch (e) {
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
        await db.collection('processed_messages').deleteMany({ ts: { $lt: Date.now() - 24 * 3600 * 1000 } });
    } catch(e){}
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
}, 2 * 60 * 1000);

connectMongo().then(async () => {
    try {
        await loadExistingSessions();
    } catch (e) {}
    app.listen(PORT, () => {
    });
}).catch(console.error);
