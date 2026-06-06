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
  } catch (e) {}
}

const localProcessedCache = new Set();
const msgRetryCounterCache = new Map();
let activeSessions = new Map();
const groupMetadataCache = new Map();
const sessionOwnersCache = new Map();
const groupSettingsCache = new Map();

function fixBuffers(obj) {
    if (!obj) return obj;
    if (obj._bsontype === 'Binary' && obj.buffer) return Buffer.from(obj.buffer);
    if (obj instanceof Uint8Array) return Buffer.from(obj);
    if (Array.isArray(obj)) return obj.map(fixBuffers);
    if (typeof obj === 'object') {
        if (Buffer.isBuffer(obj)) return obj;
        if (obj.type === 'Buffer' && Array.isArray(obj.data)) return Buffer.from(obj.data);
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) obj[key] = fixBuffers(obj[key]);
        }
    }
    return obj;
}

async function useMongoAuthState(sessionId, expectExisting = false) {
  const collection = db.collection('baileys_auth');
  const sessionKey = `auth-${sessionId}`;
  let credsDoc = await collection.findOne({ _id: `${sessionKey}-creds` });
  
  if (expectExisting && !credsDoc) throw new Error("SessionNotExists");

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
          bulkOps.push({ deleteOne: { filter: { _id: dbId } } });
        } else {
          bulkOps.push({ updateOne: { filter: { _id: dbId }, update: { $set: { data: value } }, upsert: true } });
        }
      }
      if (bulkOps.length > 0) {
        try { await collection.bulkWrite(bulkOps); } catch (err) {}
      }
    }
  };
  const saveCreds = async () => {
    try { await collection.updateOne({ _id: `${sessionKey}-creds` }, { $set: { creds } }, { upsert: true }); } catch (e) {}
  };
  return { state: { creds, keys: keyStore }, saveCreds };
}

async function deleteMongoSession(sessionId) {
  try {
    const sessionKey = `auth-${sessionId}`;
    await db.collection('baileys_auth').deleteMany({ _id: { $regex: `^${sessionKey}` } });
    await db.collection('session_owners').deleteMany({ sessionId: sessionId });
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
    if (groupSettingsCache.has(cacheKey)) return groupSettingsCache.get(cacheKey);
    try {
        const doc = await db.collection('group_settings').findOne({ sessionId, gjid });
        const val = doc ? doc[key] : null;
        groupSettingsCache.set(cacheKey, val);
        return val;
    } catch (e) { return null; }
}

async function setGroupSetting(sessionId, gjid, key, value) {
    const cacheKey = `${sessionId}_${gjid}_${key}`;
    groupSettingsCache.set(cacheKey, value);
    try {
        await db.collection('group_settings').updateOne({ sessionId, gjid }, { $set: { [key]: value } }, { upsert: true });
    } catch (e) {}
}

const retryCacheMap = {
    get: (key) => msgRetryCounterCache.get(key),
    set: (key, value) => msgRetryCounterCache.set(key, value),
    del: (key) => msgRetryCounterCache.delete(key)
};

process.on('unhandledRejection', (err) => {});
process.on('uncaughtException', (err) => {});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const links_common = "Group Recruiting :\n*_https://chat.whatsapp.com/BZ5I3aVS6fz44ErAxFXTBg?mode=gi_t_*\n\nAdam_D'H7 channel : \n*_https://whatsapp.com/channel/0029Vb8R5JG23n3eDEPKGe37_*\n\nSite : \n*_https://adamdh7.org_*";

const translations = {
  fr: {
    cmd_ai: "ia", cmd_lang: "lang", cmd_imaj: "image", cmd_cheche: "chercher",
    cmd_menu: "menu", cmd_qrbot: "qrbot", cmd_qr: "qr", cmd_code: "code", cmd_lien: "lien", cmd_tagall: "tagtout",
    cmd_hidetag: "hidetag", cmd_kick: "expulse", cmd_add: "add", cmd_promote: "promote", cmd_demote: "demote",
    cmd_kickall: "expulsetout", cmd_kickall2: "expulsetout2", cmd_ferme: "ferme", cmd_ouvert: "ouvert", cmd_bienvenue: "bienvenue",
    cmd_nolien: "nolien", cmd_nolien2: "nolien2", cmd_del: "supp", cmd_vv: "vv", cmd_info: "info", cmd_ping: "ping", cmd_upload: "url",
    cmd_alive: "alive", alive_title: "Alive", connected_since: "Connecté depuis", days: "jour(s)", hours: "heure(s)", minutes: "minute(s)", seconds: "seconde(s)",
    enabled: "activé", disabled: "désactivé", welcome_on: "Bienvenue activée", welcome_off: "Bienvenue désactivée", nolien_on: "Nolien activé", nolien_off: "Nolien désactivé", nolien2_on: "Nolien2 activé", nolien2_off: "Nolien2 désactivé",
    welcome_title: "Bienvenue", welcome_to: "Bienvenue dans", menu_title: "Menu", lang_changed: "La langue du bot est maintenant {lang}.", languages_available: "Langues disponibles : fr en es ht",
    imaj_prompt: "Envoie un prompt après image pour générer une image.", imaj_generated: "*{prompt}*", imaj_error: "Erreur génération image - Réessaye.", search_title: "Recherche", search_error: "Erreur recherche",
    lang_title: "Langue", ai_title: "Message", imaj_title: "Image", image_generated_title: "Image Générée",
    ai_click_to_receive: "Cliquez ici pour recevoir la réponse de l'IA :\n*_{link}_*", code_confirm: "Veuillez autoriser l'envoi du code en cliquant ici :\n*_{link}_*",
    qrbot_created: "Nouvelle Session Créée", qrbot_scan: "Scannez ce code pour connecter la nouvelle session.", qrbot_connected: "Session Connectée", qrbot_active: "La nouvelle session est active.\nID: {id}",
    hidetag_title: "Hidetag", hidetag_default: "Il s'agit juste d'un hidetag",
    rules_text: "*REGLES & PHILOSOPHIE :*\n• Purge : Nous supprimons uniquement les groupes jugés inutiles au sein de notre propre organisation.\n• Entraide : Soutien et assistance réservés exclusivement aux membres de notre \"famille\".\n• Respect : Dû à tous. Nous ne tolérons aucun comportement méprisable.\n• Proposition : Notre objectif principal. Services contre rémunération. Nous fournissons ce qui est demandé, peu importe le service.",
    links_text: links_common, mode_changed_private: "Le bot est maintenant en mode PRIVE.", mode_changed_public: "Le bot est maintenant en mode PUBLIC.", already_private: "Le bot est déjà configuré en mode PRIVE.", already_public: "Le bot est déjà configuré en mode PUBLIC.",
    disconnect_17h_title: "Déconnexion (17h)", disconnect_17h_msg: "Votre session a été déconnectée car elle a atteint la limite de 17h.\nVeuillez vous reconnecter sur :\n*_https://bot.adamdh7.org_*",
    disconnect_sys_title: "Déconnexion Système", disconnect_sys_msg: "Vous avez été déconnecté. Une suppression totale des données et sessions a été initiée via le système."
  },
  en: {
    cmd_ai: "ai", cmd_lang: "lang", cmd_imaj: "image", cmd_cheche: "search",
    cmd_menu: "menu", cmd_qrbot: "qrbot", cmd_qr: "qr", cmd_code: "code", cmd_lien: "link", cmd_tagall: "tagall",
    cmd_hidetag: "hidetag", cmd_kick: "kick", cmd_add: "add", cmd_promote: "promote", cmd_demote: "demote",
    cmd_kickall: "kickall", cmd_kickall2: "kickall2", cmd_ferme: "close", cmd_ouvert: "open", cmd_bienvenue: "welcome",
    cmd_nolien: "nolink", cmd_nolien2: "nolink2", cmd_del: "del", cmd_vv: "vv", cmd_info: "info", cmd_ping: "ping", cmd_upload: "url",
    cmd_alive: "alive", alive_title: "Alive", connected_since: "Connected for", days: "day(s)", hours: "hour(s)", minutes: "minute(s)", seconds: "second(s)",
    enabled: "enabled", disabled: "disabled", welcome_on: "Welcome enabled", welcome_off: "Welcome disabled", nolien_on: "No link enabled", nolien_off: "No link disabled", nolien2_on: "Strict no link enabled", nolien2_off: "Strict no link disabled",
    welcome_title: "Welcome", welcome_to: "Welcome to", menu_title: "Menu", lang_changed: "Bot language is now {lang}.", languages_available: "Available languages: fr en es ht",
    imaj_prompt: "Send a prompt after image to generate an image.", imaj_generated: "*{prompt}*", imaj_error: "Image generation error - Try again.", search_title: "Search", search_error: "Search error",
    lang_title: "Language", ai_title: "Message", imaj_title: "Image", image_generated_title: "Generated Image",
    ai_click_to_receive: "Click here to receive the AI response:\n*_{link}_*", code_confirm: "Please authorize the sending of the code by clicking here:\n*_{link}_*",
    qrbot_created: "New Session Created", qrbot_scan: "Scan this QR code to connect the new session.", qrbot_connected: "Session Connected", qrbot_active: "The new session is active.\nID: {id}",
    hidetag_title: "Hidetag", hidetag_default: "It’s just a hidetag",
    rules_text: "*RULES & PHILOSOPHIE:*\n• Purge: We only delete groups deemed useless within our own organization.\n• Mutual Aid: Support and assistance reserved exclusively for members of our \"family\".\n• Respect: Due to all. We do not tolerate despicable behavior.\n• Proposition: Our main goal. Services for remuneration. We provide what is requested, regardless of the service.",
    links_text: links_common, mode_changed_private: "The bot is now in PRIVATE mode.", mode_changed_public: "The bot is now in PUBLIC mode.", already_private: "The bot is already in PRIVATE mode.", already_public: "The bot is already in PUBLIC mode.",
    disconnect_17h_title: "Disconnection (17h)", disconnect_17h_msg: "Your session has been disconnected because it reached the 17h limit.\nPlease reconnect at:\n*_https://bot.adamdh7.org_*",
    disconnect_sys_title: "System Disconnection", disconnect_sys_msg: "You have been disconnected. A total deletion of data and sessions has been initiated via the system."
  },
  es: {
    cmd_ai: "ia", cmd_lang: "lang", cmd_imaj: "imagen", cmd_cheche: "buscar",
    cmd_menu: "menú", cmd_qrbot: "qrbot", cmd_qr: "qr", cmd_code: "código", cmd_lien: "enlace", cmd_tagall: "etiquetartodo",
    cmd_hidetag: "hidetag", cmd_kick: "expulsar", cmd_add: "añadir", cmd_promote: "promover", cmd_demote: "degradar",
    cmd_kickall: "borrartodo", cmd_kickall2: "borrartodo2", cmd_ferme: "cerrar", cmd_ouvert: "abrir", cmd_bienvenue: "bienvenida",
    cmd_nolien: "sinenlace", cmd_nolien2: "sinenlace2", cmd_del: "borrar", cmd_vv: "vv", cmd_info: "info", cmd_ping: "ping", cmd_upload: "url",
    cmd_alive: "alive", alive_title: "Alive", connected_since: "Conectado por", days: "día(s)", hours: "hora(s)", minutes: "minuto(s)", seconds: "segundo(s)",
    enabled: "activado", disabled: "desactivado", welcome_on: "Bienvenida activada", welcome_off: "Bienvenida desactivada", nolien_on: "Sin enlaces activado", nolien_off: "Sin enlaces desactivado", nolien2_on: "Sin enlaces estricto activado", nolien2_off: "Sin enlaces estricto desactivado",
    welcome_title: "Bienvenida", welcome_to: "Bienvenida a", menu_title: "Menú", lang_changed: "El idioma del bot es ahora {lang}.", languages_available: "Idiomas disponibles: fr en es ht",
    imaj_prompt: "Envía un prompt después de imagen para generar una imagen.", imaj_generated: "*{prompt}*", imaj_error: "Error al generar imagen - Inténtalo de nuevo.", search_title: "Búsqueda", search_error: "Error de búsqueda",
    lang_title: "Idioma", ai_title: "Mensaje", imaj_title: "Imagen", image_generated_title: "Imagen Generada",
    ai_click_to_receive: "Haz clic aquí para recevoir la respuesta de la IA:\n*_{link}_*", code_confirm: "Por favor autoriza el envío del código haciendo clic aquí:\n*_{link}_*",
    qrbot_created: "Nueva Sesión Creada", qrbot_scan: "Escanea este código para conectar la nueva sesión.", qrbot_connected: "Sesión Conectada", qrbot_active: "La nueva sesión está activa.\nID: {id}",
    hidetag_title: "Hidetag", hidetag_default: "Es solo un hidetag",
    rules_text: "*REGLAS Y FILOSOFÍA:*\n• Purga: Solo eliminamos grupos considerados inútiles dentro de nuestra propia organización.\n• Ayuda Mutua: Apoyo y asistencia reservados exclusivamente para los miembros de nuestra \"familia\".\n• Respeto: Debido a todos. No toleramos comportamientos despreciables.\n• Proposición: Nuestro objetivo principal. Servicios por remuneración. Proporcionamos lo que se solicita, sin importar el servicio.",
    links_text: links_common, mode_changed_private: "El bot ahora está en modo PRIVADO.", mode_changed_public: "El bot ahora está en modo PÚBLICO.", already_private: "El bot ya está configurado en modo PRIVADO.", already_public: "El bot ya está configurado en modo PÚBLICO.",
    disconnect_17h_title: "Desconexión (17h)", disconnect_17h_msg: "Su sesión ha sido desconectada porque alcanzó el límite de 17h.\nPor favor, vuelva a conectarse en:\n*_https://bot.adamdh7.org_*",
    disconnect_sys_title: "Desconexión del Sistema", disconnect_sys_msg: "Ha sido desconectado. Se ha iniciado una eliminación total de datos y sesiones a través del sistema."
  },
  ht: {
    cmd_ai: "ai", cmd_lang: "lang", cmd_imaj: "imaj", cmd_cheche: "cheche",
    cmd_menu: "meni", cmd_qrbot: "qrbot", cmd_qr: "qr", cmd_code: "kòd", cmd_lien: "lyen", cmd_tagall: "tout",
    cmd_hidetag: "hidetag", cmd_kick: "kick", cmd_add: "add", cmd_promote: "promote", cmd_demote: "demote",
    cmd_kickall: "siptout", cmd_kickall2: "siptout2", cmd_ferme: "fèmen", cmd_ouvri: "ouvri", cmd_byenveni: "byenveni",
    cmd_nolien: "nolyen", cmd_nolien2: "nolyen2", cmd_del: "sip", cmd_vv: "vv", cmd_info: "info", cmd_ping: "ping", cmd_upload: "url",
    cmd_alive: "alive", alive_title: "Alive", connected_since: "Konekte depi", days: "jou", hours: "èdtan", minutes: "minit", seconds: "segonn",
    enabled: "aktive", disabled: "dezaktive", welcome_on: "Byenveni aktive", welcome_off: "Byenveni dezaktive", nolien_on: "Nolyen aktive", nolien_off: "Nolyen dezaktive", nolien2_on: "Nolyen2 aktive", nolien2_off: "Nolyen2 dezaktive",
    welcome_title: "Byenveni", welcome_to: "Byenveni nan", menu_title: "Meni", lang_changed: "Lang bot la se kounye a {lang}.", languages_available: "Lang disponib : fr en es ht",
    imaj_prompt: "Voye yon prompt apre imaj pou jenere yon imaj.", imaj_generated: "*{prompt}*", imaj_error: "Erè jenere imaj - Eseye ankò.", search_title: "Rechèch", search_error: "Erè rechèch",
    lang_title: "Lang", ai_title: "Mesaj", imaj_title: "Imaj", image_generated_title: "Imaj Jenere",
    ai_click_to_receive: "Klike isit pou resevwa repons IA a :\n*_{link}_*", code_confirm: "Tanpri otorize voye kòd la lè w klike isit :\n*_{link}_*",
    qrbot_created: "Nouvo Sesyon Kreye", qrbot_scan: "Eskane kòd sa a pou konekte nouvo sesyon an.", qrbot_connected: "Sesyon Konekte", qrbot_active: "Nouvo sesyon an aktif.\nID: {id}",
    hidetag_title: "Hidetag", hidetag_default: "Se jis yon hidetag",
    rules_text: "*RÈG AK FILOZOFI:*\n• Pij: Nou sèlman efase gwoup ki pa itil nan pwòp òganizasyon nou an.\n• Èd Mityèl: Sipò ak asistans rezève sèlman pou manm \"fanmi\" nou an.\n• Respè: Pou tout moun. Nou pa tolere konpòtman meprizan.\n• Pwopozisyon: Objektif prensipal nou. Sèvis pou lajan. Nou bay sa ki mande, kèlkeswa sèvis la.",
    links_text: links_common, mode_changed_private: "Bot la kounye a nan mòd PRIVE.", mode_changed_public: "Bot la kounye a nan mòd PIBLIK.", already_private: "Bot la deja configuré nan mòd PRIVE.", already_public: "Bot la deja configuré nan mòd PIBLIK.",
    disconnect_17h_title: "Dekoneksyon (17h)", disconnect_17h_msg: "Sesyon ou a dekonekte paske li rive nan limit 17è a.\nTanpri rekonekte sou :\n*_https://bot.adamdh7.org_*",
    disconnect_sys_title: "Dekoneksyon Sistèm", disconnect_sys_msg: "Ou te dekonekte. Yon efasman total done ak sesyon yo te inisye atravè sistèm nan."
  }
};

function buildCaption(type, text, hostName) {
    return `*Adam_D'H7*\n\n*${type}*\n\nUtilisateur : "${hostName}"\nProprietaire : Adam_D'H7\n\n${text}\n\n> *D’H7 | Tergene*`;
}

const logoPath = path.join(__dirname, 'adamdh7.png');
let adamLogoBuffer = fs.existsSync(logoPath) ? fs.readFileSync(logoPath) : null;

async function checkSessionLimits() {
    if (!db) return;
    try {
        const now = Date.now();
        const limit17h = 17 * 60 * 60 * 1000;
        const limit1h = 1 * 60 * 60 * 1000;
        for (const [id, s] of activeSessions.entries()) {
            const doc = sessionOwnersCache.get(id) || await db.collection('session_owners').findOne({ sessionId: id });
            if (doc && doc.connectedSince) {
                if (now - doc.connectedSince >= limit17h) {
                    if (s.sock && s.number) {
                        try {
                            const lang = (doc.lang && translations[doc.lang]) ? doc.lang : 'en';
                            const t = translations[lang];
                            const hostName = doc.Name || "Adam_D'H7";
                            const caption = buildCaption(t.disconnect_17h_title, t.disconnect_17h_msg, hostName);
                            if (adamLogoBuffer) {
                                await s.sock.sendMessage(s.number + '@s.whatsapp.net', { image: adamLogoBuffer, caption: caption });
                            } else {
                                await s.sock.sendMessage(s.number + '@s.whatsapp.net', { text: caption });
                            }
                            await new Promise(resolve => setTimeout(resolve, 7000));
                        } catch (e) {}
                        try {
                            s.sock.logout();
                            if (s.sock.ws) s.sock.ws.close();
                        } catch (e) {}
                    }
                    activeSessions.delete(id);
                    await deleteMongoSession(id);
                } else if (!s.lastRefresh || (now - s.lastRefresh >= limit1h)) {
                    s.lastRefresh = now;
                    if (s.sock && s.sock.ws) {
                        try { s.sock.ws.close(); } catch (e) {}
                    }
                }
            } else if (!s.lastRefresh) {
                s.lastRefresh = now;
            }
        }
    } catch (e) {}
}

app.use(async (req, res, next) => {
    await checkSessionLimits();
    next();
});

app.get('/adamdh7/all7', async (req, res) => {
    res.type('text/plain').send('PROCÉDURE DE SUPPRESSION TOTALE INITIALISÉE EN ARRIÈRE-PLAN. TOUT SERA EFFACÉ DANS QUELQUES SECONDES.');
    
    try {
        for (const [sId, session] of activeSessions.entries()) {
            if (session.sock && session.number) {
                try {
                    const doc = sessionOwnersCache.get(sId) || await db.collection('session_owners').findOne({ sessionId: sId });
                    const lang = (doc && doc.lang && translations[doc.lang]) ? doc.lang : 'en';
                    const t = translations[lang];
                    const hostName = doc && doc.Name ? doc.Name : "Adam_D'H7";
                    const caption = buildCaption(t.disconnect_sys_title, t.disconnect_sys_msg, hostName);
                    if (adamLogoBuffer) {
                        await session.sock.sendMessage(session.number + '@s.whatsapp.net', { image: adamLogoBuffer, caption: caption });
                    } else {
                        await session.sock.sendMessage(session.number + '@s.whatsapp.net', { text: caption });
                    }
                } catch (err) {}
            }
        }
        
        await new Promise(resolve => setTimeout(resolve, 7000));
        
        for (const [sId, session] of activeSessions.entries()) {
             try {
                session.sock.logout();
                if (session.sock.ws) session.sock.ws.close();
            } catch (err) {}
        }
        
        await db.collection('baileys_auth').deleteMany({});
        await db.collection('session_owners').deleteMany({});
        await db.collection('group_settings').deleteMany({});
        await db.collection('processed_messages').deleteMany({});
        sessionOwnersCache.clear();
        groupMetadataCache.clear();
        groupSettingsCache.clear();
        msgRetryCounterCache.clear();
        localProcessedCache.clear();
        activeSessions.clear();
    } catch (e) {}
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
      const now = Date.now();
      for (const s of activeSessions.values()) {
        let ownerDoc = sessionOwnersCache.get(s.id);
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
      const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>body { background: #000000; color: #FFFFFF; font-family: monospace; margin: 0; padding: 20px; white-space: pre-wrap; word-wrap: break-word; }</style></head><body>${JSON.stringify(sessionsList, null, 2)}</body></html>`;
      res.send(html);
  } catch (e) {
      res.status(500).send("Error rendering sessions statistics.");
  }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function callCloudflareAI(model, messages) {
  try {
    const accountId = "e2e0f4c1fba415b57bb562e3c7645877";
    const token = "cfut_0nlcDxkgaYuDCo8zswCwZDq881c3GN1jGWoxLwhG1674c944";
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
    const res = await fetch(url, { method: "POST", headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ messages: messages }) });
    if (!res.ok) throw new Error("AI error");
    const data = await res.json();
    return data.result && data.result.response ? data.result.response : "Désolé, erreur de réponse.";
  } catch (e) { return "Erreur lors de l'appel à l'IA."; }
}

async function tavilySearch(query) {
  try {
    const res = await fetch("https://api.tavily.com/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ api_key: "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", query: query, search_depth: "basic", include_images: true, include_answer: true, max_results: 5 }) });
    if (!res.ok) throw new Error();
    return await res.json();
  } catch (e) { return {answer: "Erreur de recherche Tavily."}; }
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

const commandMaps = {
  fr: { "ia": "ai", "lang": "lang", "image": "imaj", "chercher": "cheche", "menu": "menu", "qrbot": "qrbot", "qr": "qr", "code": "code", "lien": "lien", "tagtout": "tagall", "hidetag": "hidetag", "expulse": "kick", "add": "add", "promote": "promote", "demote": "demote", "expulsetout": "kickall", "expulsetout2": "kickall2", "ferme": "ferme", "ouvert": "ouvert", "bienvenue": "bienvenue", "nolien": "nolien", "nolien2": "nolien2", "supp": "del", "vv": "vv", "info": "info", "alive": "alive", "ping": "ping", "url": "url", "prive": "prive", "public": "public" },
  en: { "ai": "ai", "lang": "lang", "image": "imaj", "search": "cheche", "menu": "menu", "qrbot": "qrbot", "qr": "qr", "code": "code", "link": "lien", "tagall": "tagall", "hidetag": "hidetag", "kick": "kick", "add": "add", "promote": "promote", "demote": "demote", "kickall": "kickall", "kickall2": "kickall2", "close": "ferme", "open": "ouvert", "welcome": "bienvenue", "nolink": "nolien", "nolink2": "nolien2", "del": "del", "vv": "vv", "info": "info", "alive": "alive", "ping": "ping", "url": "url", "private": "prive", "public": "public" },
  es: { "ia": "ai", "lang": "lang", "imagen": "imaj", "buscar": "cheche", "menú": "menu", "qrbot": "qrbot", "qr": "qr", "código": "code", "enlace": "lien", "etiquetartodo": "tagall", "hidetag": "hidetag", "expulsar": "kick", "añadir": "add", "promover": "promote", "degradar": "demote", "borrartodo": "kickall", "borrartodo2": "kickall2", "cerrar": "ferme", "abrir": "ouvert", "bienvenida": "bienvenue", "sinenlace": "nolien", "sinenlace2": "nolien2", "borrar": "del", "vv": "vv", "info": "info", "alive": "alive", "ping": "ping", "url": "url", "privado": "prive", "publico": "public" },
  ht: { "ai": "ai", "lang": "lang", "imaj": "imaj", "cheche": "cheche", "meni": "menu", "qrbot": "qrbot", "qr": "qr", "kòd": "code", "lyen": "lien", "tout": "tagall", "hidetag": "hidetag", "sipli": "kick", "add": "add", "promote": "promote", "demote": "demote", "siptout": "kickall", "siptout2": "kickall2", "fèmen": "ferme", "ouvri": "ouvert", "byenveni": "bienvenue", "nolyen": "nolien", "nolyen2": "nolien2", "sip": "del", "vv": "vv", "info": "info", "alive": "alive", "ping": "ping", "url": "url", "prive": "prive", "piblik": "public" }
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
            if (s.sock.ws) s.sock.ws.close();
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
            msgRetryCounterCache: retryCacheMap,
            retryRequestDelayMs: 200,
            maxMsgRetryCount: 5,
            keepAliveIntervalMs: 10000,
            getMessage: async (key) => ({})
        });

        const chatHistories = new Map();
        let globalLang = 'en';
        
        try {
            const initialOwnerDoc = await db.collection('session_owners').findOne({ sessionId: sessionId });
            if (initialOwnerDoc && initialOwnerDoc.lang) globalLang = initialOwnerDoc.lang;
        } catch (e) {}

        const userInfo = new Map();
        const pendingAIResponses = new Map();

        const buildAIMessages = (hist, userInfoObj, botLang) => {
          let historyCopy = [...hist];
          const systemContent = `You are Adam_D'H7. Do not talk about internal information or other subjects about Yourself outside of your name. The user is: ${userInfoObj.pseudo || 'Unknown'} (number: ${userInfoObj.number || 'unknown'}). The conversation is in language: ${botLang}. Always respond in the language the user is using.`;
          let msgs = [ {role: "system", content: systemContent}, ...historyCopy ];
          const jsonStr = JSON.stringify(msgs);
          while (jsonStr.length > 17000 && historyCopy.length > 1) {
            historyCopy.shift();
            msgs = [ {role: "system", content: systemContent}, ...historyCopy ];
          }
          return msgs;
        };

        activeSessions.set(sessionId, {
            id: sessionId, number: null, format: format, status: 'initialisation',
            createdAt: Date.now(), lastRefresh: Date.now(), sock: sock, qrString: null
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            if (qr) {
                const currentSession = activeSessions.get(sessionId);
                if (currentSession) { currentSession.status = 'qr_disponible'; currentSession.qrString = qr; currentSession.sock = sock; }
            }
            if (connection === 'connecting') {
                const currentSession = activeSessions.get(sessionId);
                if (currentSession) currentSession.status = 'synchronisation';
            }
            if (connection === 'open') {
                try {
                    const groups = await sock.groupFetchAllParticipating();
                    for (const jid in groups) groupMetadataCache.set(jid, groups[jid]);
                } catch(e) {}
                
                const currentBotNum = sock.user ? sock.user.id.split(':')[0] : null;
                const currentBotName = sock.user ? sock.user.name || "Adam_D'H7" : "Adam_D'H7";
                if (currentBotNum) {
                    try {
                        const now = Date.now();
                        const existingRecord = await db.collection('session_owners').findOne({ sessionId: sessionId });
                        let finalRecord = existingRecord;
                        if (!existingRecord) {
                            const newOwner = { sessionId: sessionId, Number: currentBotNum, Name: currentBotName, connectedSince: now, mode: 'prive', lang: globalLang };
                            await db.collection('session_owners').updateOne({ sessionId: sessionId }, { $set: newOwner }, { upsert: true });
                            finalRecord = newOwner;
                        } else if (!existingRecord.connectedSince) {
                            await db.collection('session_owners').updateOne({ sessionId: sessionId }, { $set: { connectedSince: now } });
                            finalRecord.connectedSince = now;
                        }
                        sessionOwnersCache.set(sessionId, finalRecord);
                    } catch(e) {}
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
                const currentSession = activeSessions.get(sessionId);
                if (currentSession) currentSession.status = 'deconnecte';
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                
                try { sock.ev.removeAllListeners(); if (sock.ws) sock.ws.close(); } catch (e) {}

                if (statusCode === DisconnectReason.loggedOut || statusCode === 401 || statusCode === 405) {
                    try { await deleteMongoSession(sessionId); activeSessions.delete(sessionId); } catch (e) {}
                } else {
                    setTimeout(() => { startAdamBot(sessionId, autoExpire, format, true).catch(() => {}); }, 3000);
                }
            }
        });

        const safeGroupUpdate = async (jid, participants, action) => {
            try {
                const cleanParticipants = participants.map(p => p.includes('@') ? p : `${p.replace(/[^0-9]/g, '')}@s.whatsapp.net`);
                await sock.groupParticipantsUpdate(jid, cleanParticipants, action);
                return true;
            } catch (e) { return false; }
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
                let gSubject = "le groupe";
                if (groupMetadataCache.has(gjid)) {
                    gSubject = groupMetadataCache.get(gjid).subject || gSubject;
                } else {
                    try {
                        const gmeta = await sock.groupMetadata(gjid);
                        groupMetadataCache.set(gjid, gmeta);
                        gSubject = gmeta.subject;
                    } catch (e) {}
                }
                
                let sessionOwnerDoc = sessionOwnersCache.get(sessionId);
                const hostNameToDisplay = sessionOwnerDoc ? sessionOwnerDoc.Name || "Adam_D'H7" : "Adam_D'H7";
                const usernamesText = newParts.map(user => `@${user.split('@')[0]}`).join(', ');
                const welcomeText = buildCaption(tWelcome.welcome_title, `*${tWelcome.welcome_to} ${gSubject}*\n${usernamesText}`, hostNameToDisplay);
                
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
                const m = up.messages[0];
                if (m.messageStubType || !m.message || Object.keys(m.message).length === 0 || m.message.protocolMessage) return;
                if (m.key && m.key.remoteJid === 'status@broadcast') return;
                
                const timestampNow = Math.floor(Date.now() / 1000);
                if (m.messageTimestamp && (timestampNow - m.messageTimestamp > 45)) return;

                const msgId = m.key.id;
                if (localProcessedCache.has(msgId)) return;
                localProcessedCache.add(msgId);
                setTimeout(() => localProcessedCache.delete(msgId), 300000);
                
                try {
                    const processedCol = db.collection('processed_messages');
                    const isProcessed = await processedCol.findOne({ _id: msgId });
                    if (isProcessed) return;
                    await processedCol.updateOne({ _id: msgId }, { $set: { ts: Date.now() } }, { upsert: true });
                } catch(e) {}

                const bodyRaw = extractBody(m);
                const body = bodyRaw.trim();
                
                const ignoreTexts = ['Message non chargé', 'Waiting for this message', 'En attente de ce message'];
                if (ignoreTexts.some(text => body.includes(text))) return;

                const from = m.key.remoteJid;
                const isFromMe = m.key.fromMe;
                const pushName = m.pushName || 'Inconnu';
                const botId = sock.user?.id ? (sock.user.id.includes(':') ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : sock.user.id) : null;
                const sender = m.key.participant || m.key.remoteJid || (isFromMe ? botId : null);
                
                const isGroup = from.endsWith('@g.us');
                const messageType = Object.keys(unwrapMessageContent(m.message) || {})[0];

                let sOwnerTop = sessionOwnersCache.get(sessionId);
                if (!sOwnerTop) {
                    try {
                        sOwnerTop = await db.collection('session_owners').findOne({ sessionId: sessionId });
                        if (sOwnerTop) sessionOwnersCache.set(sessionId, sOwnerTop);
                    } catch(e){}
                }

                let isOwnerReal = false;
                let activeHostName = sOwnerTop ? (sOwnerTop.Name || "Adam_D'H7") : "Adam_D'H7";
                const sNum = sender ? sender.split('@')[0].replace(/[^0-9]/g, '') : '';

                if (isFromMe) {
                    isOwnerReal = true;
                    if (pushName !== 'Inconnu' && pushName !== activeHostName && sOwnerTop) {
                        sOwnerTop.Name = pushName;
                        try { await db.collection('session_owners').updateOne({ sessionId: sessionId }, { $set: { Name: pushName } }); } catch(e){}
                        activeHostName = pushName;
                    }
                } else if (sOwnerTop && sNum === sOwnerTop.Number) {
                    isOwnerReal = true;
                    if (pushName !== 'Inconnu' && pushName !== activeHostName) {
                        sOwnerTop.Name = pushName;
                        try { await db.collection('session_owners').updateOne({ sessionId: sessionId }, { $set: { Name: pushName } }); } catch(e){}
                        activeHostName = pushName;
                    }
                }

                const getMeta = async () => {
                    try {
                        if (groupMetadataCache.has(from)) return groupMetadataCache.get(from);
                        if (isGroup) {
                            const meta = await sock.groupMetadata(from).catch(() => null);
                            if (meta) { groupMetadataCache.set(from, meta); return meta; }
                        }
                    } catch (e) {} return null;
                };

                const checkAdmin = async () => {
                    try {
                        if (isOwnerReal) return true;
                        if (!isGroup) return false;
                        const metadataA = await getMeta();
                        return metadataA ? metadataA.participants.some(p => p.id === sender && p.admin) : false;
                    } catch (e) { return false; }
                };

                if (isGroup) {
                    try {
                        const antiLinkMode = await getGroupSetting(sessionId, from, 'noLien') || 'off';
                        if (antiLinkMode !== 'off') {
                            const metadata = await getMeta();
                            const senderIsAdmin = metadata?.participants?.some(p => p.id === sender && p.admin) || false;
                            const isStrict = antiLinkMode === 'strict';
                            let shouldDelete = false;

                            const actualType = Object.keys(unwrapMessageContent(m.message) || {})[0] || messageType;
                            const allowedTypes = ['conversation', 'extendedTextMessage', 'imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension'];

                            if (!allowedTypes.includes(actualType)) {
                                shouldDelete = true;
                            } else {
                                const linkRegex = /https?:\/\/[^\s]+|wa\.me|whatsapp\.com\/channel|chat\.whatsapp\.com/i;
                                if (linkRegex.test(bodyRaw)) shouldDelete = true;
                            }

                            if (shouldDelete) {
                                let canDelete = false;
                                if (isStrict) { if (sender !== botId && !isOwnerReal) canDelete = true; } 
                                else { if (!senderIsAdmin && sender !== botId && !isOwnerReal) canDelete = true; }

                                if (canDelete) {
                                    try { await sock.sendMessage(from, { delete: m.key }); } catch (e) {}
                                    return;
                                }
                            }
                        }
                    } catch (errGroupCheck) {}
                }

                let allowed = false;
                let botMode = sOwnerTop ? (sOwnerTop.mode || 'prive') : 'prive';
                if (botMode === 'public' || isOwnerReal) allowed = true;
                if (!allowed || !body) return;
                
                userInfo.set(sender, { pseudo: pushName, number: sender ? sender.split('@')[0].replace(/[^0-9]/g, '') : '', lang: globalLang });

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
                            if (normalizeText(alias) === normCmd) { internalCommand = intern; break; }
                        }
                    }
                    if (!internalCommand) {
                        for (const l of Object.keys(commandMaps)) {
                            if (l === globalLang) continue;
                            for (const [alias, intern] of Object.entries(commandMaps[l])) {
                                if (normalizeText(alias) === normCmd) { internalCommand = intern; break; }
                            }
                            if (internalCommand) break;
                        }
                    }
                }
                
                if (!internalCommand) return;

                try { await sock.readMessages([m.key]); await sock.sendPresenceUpdate('composing', from); } catch (e) {}

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
                                try { await db.collection('session_owners').updateOne({ sessionId: sessionId }, { $set: { mode: 'prive' } }); } catch(e){}
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
                                try { await db.collection('session_owners').updateOne({ sessionId: sessionId }, { $set: { mode: 'public' } }); } catch(e){}
                                sessionOwnersCache.set(sessionId, sOwnerTop);
                                await sendFormatted(sock, from, "Mode", t.mode_changed_public, pushName, false, activeHostName);
                            }
                            break;
                        case 'menu':
                            if (args.length > 0) break;
                            let menuBodyText = `*MENU ADAM_D'H7*\n\n*IA & RECHERCHE*\n*○ ia*\n*● lang*\n*○ image*\n*● chercher*\n\n*OUTILS & CODES*\n*○ menu*\n*● qrbot*\n*○ qr*\n*● code*\n*○ lien*\n*● info*\n\n*ADMINISTRATION*\n*○ tagtout*\n*● hidetag*\n*○ expulse*\n*● add*\n*○ promote*\n*● demote*\n*○ expulsetout*\n*● expulsetout2*\n*○ ferme*\n*● ouvert*\n*○ bienvenue*\n\n*SYSTEME & SECURITE*\n*○ nolien*\n*● nolien2*\n*○ supp*\n*● vv*\n*○ alive*\n*● url*\n*○ ping*\n*● prive*\n*○ public*`;
                            const menuCaption = buildCaption("Menu", `${t.links_text}\n\n${t.rules_text}\n\n${menuBodyText}`, activeHostName);
                            if (adamLogoBuffer) {
                                await sock.sendMessage(from, { image: adamLogoBuffer, caption: menuCaption });
                            } else {
                                await sock.sendMessage(from, { text: menuCaption });
                            }
                            break;
                        case 'info':
                            let descInfo = `*Informations du Bot Adam_D'H7*\n\nCe bot est concu pour repondre et assister l'utilisateur de maniere rapide. \n\n*Format des Messages :*\nTous les messages suivent un format precis affichant :\n- Le Type d'Action\n- Utilisateur effectuant la requete\n- Proprietaire de la session\n- Texte de reponse\n\n*Commandes Basiques :*\n- menu : Afficher toutes les commandes.\n- url : Repondre a un media pour creer un lien upload.\n- prive / public : Changer la securite du bot.\n- kickall2 : Expulser doucement la moitie des membres.\n\n${t.rules_text}`;
                            await sendFormatted(sock, from, 'Info', descInfo, pushName, false, activeHostName);
                            break;
                        case 'alive':
                            let uptimeStr = "0s";
                            if (sOwnerTop && sOwnerTop.connectedSince) {
                                uptimeStr = formatUptime((Date.now() - sOwnerTop.connectedSince) / 1000, t);
                            }
                            await sendFormatted(sock, from, t.alive_title, `*${t.connected_since} ${uptimeStr}*`, pushName, false, activeHostName);
                            break;
                        case 'ping':
                            const pingMs = Date.now() - (m.messageTimestamp * 1000);
                            await sendFormatted(sock, from, "Ping", `*${pingMs} ms*`, pushName, false, activeHostName);
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
                            let bFilename = mediaTarget.fileName || `file_${Date.now()}.bin`;
                            if (!mediaTarget.fileName) {
                                if (bType === 'image') bFilename = "image.jpg";
                                else if (bType === 'video') bFilename = "video.mp4";
                                else if (bType === 'audio') bFilename = "audio.mp3";
                            }
                            try {
                                const fData = new FormData();
                                fData.append("file", new Blob([bBuffer]), bFilename);
                                const bRes = await fetch("https://bref.adamdh7.org/upload", { method: "POST", body: fData });
                                const bJson = await bRes.json();
                                if (bJson.success || bJson.url) {
                                    const fUrl = bJson.fileUrl || bJson.url;
                                    const formattedSize = formatBytes(bBuffer.length);
                                    await sendFormatted(sock, from, "URL", `*_${fUrl}_*\n*Taille* : ${formattedSize}`, pushName, false, activeHostName);
                                }
                            } catch (e) {}
                            break;
                        case 'tagall':
                            const isAdminTA = await checkAdmin();
                            if (!isGroup || !isAdminTA) break;
                            const metadataTag = await getMeta();
                            if (!metadataTag) break;
                            const participants = metadataTag.participants.map(p => p.id);
                            const tagBody = participants.map((p, idx) => (idx % 2 === 0 ? '●' : '○') + ' @' + p.split('@')[0]).join('\n');
                            const tagCaption = buildCaption("Tagall", tagBody, activeHostName);
                            if (adamLogoBuffer) {
                                await sock.sendMessage(from, { image: adamLogoBuffer, caption: tagCaption, mentions: participants });
                            } else {
                                await sock.sendMessage(from, { text: tagCaption, mentions: participants });
                            }
                            break;
                        case 'kickall':
                            const isAdminKA = await checkAdmin();
                            if (!isGroup || !isAdminKA) break;
                            const metadataKA = await getMeta();
                            if (!metadataKA) break;
                            
                            const toKick = metadataKA.participants.filter(p => !p.admin && p.id !== botId).map(p => p.id);
                            if (toKick.length > 0) {
                                for (let i = 0; i < toKick.length; i += 100) {
                                    await safeGroupUpdate(from, toKick.slice(i, i + 100), 'remove');
                                    await sleep(1500); 
                                }
                            }
                            break;
                        case 'kickall2':
                            const isAdminKA2 = await checkAdmin();
                            if (!isGroup || !isAdminKA2) break;
                            const metadataKA2 = await getMeta();
                            if (!metadataKA2) break;
                            
                            let toKick2 = metadataKA2.participants.filter(p => !p.admin && p.id !== botId).map(p => p.id);
                            while (toKick2.length > 0) {
                                let halfAmount = Math.ceil(toKick2.length / 2);
                                let chunkToKick = toKick2.splice(0, halfAmount);
                                await safeGroupUpdate(from, chunkToKick, 'remove');
                                await sleep(2000); 
                            }
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
                        case 'ai':
                            const promptText = args.trim() ? args : body;
                            if (!promptText) break;
                            let history = chatHistories.get(from) || [];
                            history.push({role: "user", content: promptText});
                            chatHistories.set(from, history);
                            const userInfoObj = userInfo.get(sender) || {pseudo: pushName, number: sender ? sender.split('@')[0].replace(/[^0-9]/g, '') : '', lang: globalLang};
                            let messagesForAI = buildAIMessages(history, userInfoObj, globalLang);
                            const aiResponseText = await callCloudflareAI("@cf/meta/llama-3-8b-instruct", messagesForAI);
                            
                            history.push({role: "assistant", content: aiResponseText});
                            if (history.length > 7) history = history.slice(-7);
                            chatHistories.set(from, history);
                            await sendFormatted(sock, from, t.ai_title, aiResponseText, pushName, false, activeHostName);
                            break;
                        case 'nolien':
                        case 'nolien2':
                            const isAdminNL = await checkAdmin();
                            if (!isGroup || !isAdminNL) break;
                            const isStrict = internalCommand === 'nolien2';
                            const currentNL = await getGroupSetting(sessionId, from, 'noLien');
                            const targetMode = isStrict ? 'strict' : 'simple';
                            const newNL = currentNL === targetMode ? 'off' : targetMode;
                            await setGroupSetting(sessionId, from, 'noLien', newNL);
                            const statMsg = newNL === 'off' ? (isStrict ? t.nolien2_off : t.nolien_off) : (isStrict ? t.nolien2_on : t.nolien_on);
                            await sendFormatted(sock, from, isStrict ? t.cmd_nolien2 : t.cmd_nolien, `*${statMsg}*`, pushName, false, activeHostName);
                            break;
                    }
                } catch (cmdError) {}
            } catch (e) {}
        });
        return { sock: sock, qrString: null, active: true };
    } catch (err) {}
}

app.post('/get-code', async (req, res) => {
    const { number, method, autoExpire = false } = req.body;
    if (!method || (method === 'code' && !number)) return res.status(400).json({ error: 'Requête invalide' });
    
    const sId = `session_${Date.now()}`;
    const sess = await startAdamBot(sId, autoExpire, method === 'qr' ? 'qr' : 'pair', false);
    
    if (method === 'code') {
        try {
            let attempts = 0;
            while (attempts < 20 && !sess.sock.authState.creds.me) { await sleep(500); attempts++; }
            await sleep(2000);
            const code = await sess.sock.requestPairingCode(number.replace(/[^0-9]/g, ''));
            res.json({ code: code.match(/.{1,4}/g).join('-') });
        } catch (e) { res.status(500).json({ error: 'Échec code' }); }
    }
});

async function loadExistingSessions() {
    if (!db) return;
    try {
        const credsDocs = await db.collection('baileys_auth').find({ _id: { $regex: /^auth-.*-creds$/ } }).toArray();
        for (const doc of credsDocs) {
            const match = doc._id.match(/^auth-(.*)-creds$/);
            if (match && !match[1].startsWith('temp_')) {
                const c = fixBuffers(doc.creds);
                if (c && c.me) await startAdamBot(match[1]);
                else await deleteMongoSession(match[1]);
            }
        }
    } catch(e){}
}

setInterval(async () => {
    if (!db) return;
    try { await db.collection('processed_messages').deleteMany({ ts: { $lt: Date.now() - 24 * 3600 * 1000 } }); } catch(e){}
    await checkSessionLimits();
}, 2 * 60 * 1000);

connectMongo().then(async () => {
    await loadExistingSessions();
    app.listen(PORT, () => {});
}).catch(console.error);
