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
  mongoClient = new MongoClient(mongoUri);
  await mongoClient.connect();
  db = mongoClient.db('dh7bot');
}

function fixBuffers(obj) {
    if (!obj) return obj;
    if (obj._bsontype === 'Binary') return obj.buffer;
    if (Array.isArray(obj)) return obj.map(fixBuffers);
    if (typeof obj === 'object') {
        for (const key in obj) {
            obj[key] = fixBuffers(obj[key]);
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
        const keyFull = doc._id.replace(`${sessionKey}_key_`, '');
        const id = keyFull.substring(type.length + 1);
        result[id] = fixBuffers(doc.data);
      }
      return result;
    },
    set: async (data) => {
      const bulkOps = Object.entries(data).map(([key, value]) => ({
        updateOne: {
          filter: { _id: `${sessionKey}_key_${key}` },
          update: { $set: { data: value } },
          upsert: true
        }
      }));
      if (bulkOps.length > 0) {
        await collection.bulkWrite(bulkOps);
      }
    }
  };
  const saveCreds = async () => {
    await collection.updateOne(
      { _id: `${sessionKey}-creds` },
      { $set: { creds } },
      { upsert: true }
    );
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
  const collection = db.collection('baileys_auth');
  const sessionKey = `auth-${sessionId}`;
  await collection.deleteMany({ _id: { $regex: `^${sessionKey}` } });
}

async function renameMongoSession(oldSessionId, newSessionId) {
  const collection = db.collection('baileys_auth');
  const oldKey = `auth-${oldSessionId}`;
  const newKey = `auth-${newSessionId}`;
  const oldDocs = await collection.find({ _id: { $regex: `^${oldKey}` } }).toArray();
  for (const doc of oldDocs) {
    const newId = doc._id.replace(oldKey, newKey);
    await collection.insertOne({ ...doc, _id: newId });
  }
  await collection.deleteMany({ _id: { $regex: `^${oldKey}` } });
}

const msgRetryCounterCache = new Map();
const retryCache = {
    get: (key) => msgRetryCounterCache.get(key),
    set: (key, value) => msgRetryCounterCache.set(key, value),
    del: (key) => msgRetryCounterCache.delete(key)
};

let activeSessions = new Map();
const groupMetadataCache = new Map();

process.on('unhandledRejection', (err) => {
    const msg = String(err?.message || err || '');
    if (msg.includes('Bad MAC') || msg.includes('Failed to decrypt message with any known session')) return;
});
process.on('uncaughtException', (err) => {
    const msg = String(err?.message || err || '');
    if (msg.includes('Bad MAC') || msg.includes('Failed to decrypt message with any known session')) return;
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

app.get('/adamdh7/all7', async (req, res) => {
    try {
        const collection = db.collection('baileys_auth');
        await collection.deleteMany({});
        for (const session of activeSessions.values()) {
            if (session.sock) {
                try {
                    session.sock.logout();
                    session.sock.end(undefined);
                } catch (err) {}
            }
        }
        activeSessions.clear();
        res.type('text/plain').send('TOUTES LES SESSIONS SUPPRIMEES SANS EXCEPTION');
    } catch (e) {
        res.type('text/plain').send('ERREUR SUPPRESSION');
    }
});

app.get('/adamdh7/all', (req, res) => {
  const sessionsList = Array.from(activeSessions.values()).map(s => ({
    ID: s.id,
    Sessions: s.status || 'en cours',
    Numero: s.number || 'N/A',
    Format: s.format || 'pair'
  }));
  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Adam_D'H7</title>
    <style>
        :root { --bg: #000000; --text: #888888; }
        * { margin:0; padding:0; box-sizing:border-box; }
        body { background:var(--bg); color:var(--text); font-family:monospace; padding:20px; line-height:1.6; }
        h1 { color:#666; margin-bottom:20px; }
        pre { background:#111; padding:20px; overflow:auto; white-space:pre-wrap; }
        .session { margin-bottom:15px; border-bottom:1px solid #222; padding-bottom:10px; }
    </style>
</head>
<body>
    <h1> Adam_D'H7</h1>
    <pre>${JSON.stringify(sessionsList, null, 2)}</pre>
</body>
</html>`;
  res.send(html);
});

app.get('/adamdh7/all2', (req, res) => {
  res.json(Array.from(activeSessions.values()));
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const Adam_DH7 = "Adam_D'H7";
const logoPath = path.join(__dirname, 'adamdh7.png');
let adamLogoBuffer = fs.existsSync(logoPath) ? fs.readFileSync(logoPath) : null;

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

const translations = {
  fr: {
    cmd_ai: "ia", cmd_lang: "lang", cmd_imaj: "image", cmd_cheche: "chercher",
    cmd_menu: "menu", cmd_qrbot: "qrbot", cmd_qr: "qr", cmd_code: "code", cmd_lien: "lien", cmd_tagall: "tagtout",
    cmd_hidetag: "hidetag", cmd_kick: "expulse", cmd_add: "add", cmd_promote: "promote", cmd_demote: "demote",
    cmd_kickall: "expulsetout", cmd_ferme: "ferme", cmd_ouvert: "ouvert", cmd_bienvenue: "bienvenue",
    cmd_nolien: "nolien", cmd_nolien2: "nolien2", cmd_del: "supp", cmd_vv: "vv", cmd_sites: "sit", cmd_ping: "ping", cmd_bref: "bref",
    cmd_set: "set", cmd_unset: "unset",
    cmd_alive: "alive", alive_title: "Alive", connected_since: "Connecté depuis", days: "jour(s)", hours: "heure(s)", minutes: "minute(s)", seconds: "seconde(s)",
    enabled: "activé", disabled: "désactivé", welcome_on: "Bienvenue activée", welcome_off: "Bienvenue désactivée", nolien_on: "Nolien activé", nolien_off: "Nolien désactivé", nolien2_on: "Nolien2 activé", nolien2_off: "Nolien2 désactivé",
    welcome_title: "Bienvenue", welcome_to: "Bienvenue dans",
    menu_title: "Menu", lang_changed: "La langue du bot est maintenant {lang}.", languages_available: "Langues disponibles : fr en es ht",
    imaj_prompt: "Envoie un prompt après image pour générer une image.", imaj_generated: "*{prompt}*", imaj_error: "Erreur génération image - Réessaye.", search_title: "Recherche", search_error: "Erreur recherche",
    lang_title: "Langue", ai_title: "Message", imaj_title: "Image", image_generated_title: "Image Générée",
    ai_click_to_receive: "Cliquez ici pour recevoir la réponse de l'IA :\n{link}",
    code_confirm: "Veuillez autoriser l'envoi du code en cliquant ici :\n{link}",
    qrbot_created: "Nouvelle Session Créée",
    qrbot_scan: "Scannez ce code pour connecter la nouvelle session.",
    qrbot_connected: "Session Connectée",
    qrbot_active: "La nouvelle session est active.\nID: {id}",
    hidetag_title: "Hidetag", hidetag_default: "Il s'agit juste d'un hidetag"
  },
  en: {
    cmd_ai: "ai", cmd_lang: "lang", cmd_imaj: "image", cmd_cheche: "search",
    cmd_menu: "menu", cmd_qrbot: "qrbot", cmd_qr: "qr", cmd_code: "code", cmd_lien: "link", cmd_tagall: "tagall",
    cmd_hidetag: "hidetag", cmd_kick: "kick", cmd_add: "add", cmd_promote: "promote", cmd_demote: "demote",
    cmd_kickall: "kickall", cmd_ferme: "close", cmd_ouvert: "open", cmd_bienvenue: "welcome",
    cmd_nolien: "nolink", cmd_nolien2: "nolink2", cmd_del: "del", cmd_vv: "vv", cmd_sites: "sit", cmd_ping: "ping", cmd_bref: "bref",
    cmd_set: "set", cmd_unset: "unset",
    cmd_alive: "alive", alive_title: "Alive", connected_since: "Connected for", days: "day(s)", hours: "hour(s)", minutes: "minute(s)", seconds: "second(s)",
    enabled: "enabled", disabled: "disabled", welcome_on: "Welcome enabled", welcome_off: "Welcome disabled", nolien_on: "No link enabled", nolien_off: "No link disabled", nolien2_on: "Strict no link enabled", nolien2_off: "Strict no link disabled",
    welcome_title: "Welcome", welcome_to: "Welcome to",
    menu_title: "Menu", lang_changed: "Bot language is now {lang}.", languages_available: "Available languages: fr en es ht",
    imaj_prompt: "Send a prompt after image to generate an image.", imaj_generated: "*{prompt}*", imaj_error: "Image generation error - Try again.", search_title: "Search", search_error: "Search error",
    lang_title: "Language", ai_title: "Message", imaj_title: "Image", image_generated_title: "Generated Image",
    ai_click_to_receive: "Click here to receive the AI response:\n{link}",
    code_confirm: "Please authorize the sending of the code by clicking here:\n{link}",
    qrbot_created: "New Session Created",
    qrbot_scan: "Scan this QR code to connect the new session.",
    qrbot_connected: "Session Connected",
    qrbot_active: "The new session is active.\nID: {id}",
    hidetag_title: "Hidetag", hidetag_default: "It’s just a hidetag"
  },
  es: {
    cmd_ai: "ia", cmd_lang: "lang", cmd_imaj: "imagen", cmd_cheche: "buscar",
    cmd_menu: "menú", cmd_qrbot: "qrbot", cmd_qr: "qr", cmd_code: "código", cmd_lien: "enlace", cmd_tagall: "etiquetartodo",
    cmd_hidetag: "hidetag", cmd_kick: "expulsar", cmd_add: "añadir", cmd_promote: "promover", cmd_demote: "degradar",
    cmd_kickall: "borrartodo", cmd_ferme: "cerrar", cmd_ouvert: "abrir", cmd_bienvenue: "bienvenida",
    cmd_nolien: "sinenlace", cmd_nolien2: "sinenlace2", cmd_del: "borrar", cmd_vv: "vv", cmd_sites: "sit", cmd_ping: "ping", cmd_bref: "bref",
    cmd_set: "set", cmd_unset: "unset",
    cmd_alive: "alive", alive_title: "Alive", connected_since: "Conectado por", days: "día(s)", hours: "hora(s)", minutes: "minuto(s)", seconds: "segundo(s)",
    enabled: "activado", disabled: "desactivado", welcome_on: "Bienvenida activada", welcome_off: "Bienvenida desactivada", nolien_on: "Sin enlaces activado", nolien_off: "Sin enlaces desactivado", nolien2_on: "Sin enlaces estricto activado", nolien2_off: "Sin enlaces estricto desactivado",
    welcome_title: "Bienvenida", welcome_to: "Bienvenida a",
    menu_title: "Menú", lang_changed: "El idioma del bot es ahora {lang}.", languages_available: "Idiomas disponibles: fr en es ht",
    imaj_prompt: "Envía un prompt después de imagen para generar una imagen.", imaj_generated: "*{prompt}*", imaj_error: "Error al generar imagen - Inténtalo de nuevo.", search_title: "Búsqueda", search_error: "Error de búsqueda",
    lang_title: "Idioma", ai_title: "Mensaje", imaj_title: "Imagen", image_generated_title: "Imagen Generada",
    ai_click_to_receive: "Haz clic aquí para recibir la respuesta de la IA:\n{link}",
    code_confirm: "Por favor autoriza el envío del código haciendo clic aquí:\n{link}",
    qrbot_created: "Nueva Sesión Creada",
    qrbot_scan: "Escanea este código para conectar la nueva sesión.",
    qrbot_connected: "Sesión Conectada",
    qrbot_active: "La nueva sesión está activa.\nID: {id}",
    hidetag_title: "Hidetag", hidetag_default: "Es solo un hidetag"
  },
  ht: {
    cmd_ai: "ai", cmd_lang: "lang", cmd_imaj: "imaj", cmd_cheche: "cheche",
    cmd_menu: "meni", cmd_qrbot: "qrbot", cmd_qr: "qr", cmd_code: "kòd", cmd_lien: "lyen", cmd_tagall: "tout",
    cmd_hidetag: "hidetag", "sipli": "kick", cmd_add: "add", cmd_promote: "promote", cmd_demote: "demote",
    cmd_kickall: "siptout", cmd_ferme: "fèmen", cmd_ouvert: "ouvri", cmd_bienvenue: "byenveni",
    cmd_nolien: "nolyen", cmd_nolien2: "nolyen2", cmd_del: "sip", cmd_vv: "vv", cmd_sites: "sit", cmd_ping: "ping", cmd_bref: "bref",
    cmd_set: "set", cmd_unset: "unset",
    cmd_alive: "alive", alive_title: "Alive", connected_since: "Konekte depi", days: "jou", hours: "èdtan", minutes: "minit", seconds: "segonn",
    enabled: "aktive", disabled: "dezaktive", welcome_on: "Byenveni aktive", welcome_off: "Byenveni dezaktive", nolien_on: "Nolyen aktive", nolien_off: "Nolyen dezaktive", nolien2_on: "Nolyen2 aktive", nolien2_off: "Nolyen2 dezaktive",
    welcome_title: "Byenveni", welcome_to: "Byenveni nan",
    menu_title: "Meni", lang_changed: "Lang bot la se kounye a {lang}.", languages_available: "Lang disponib : fr en es ht",
    imaj_prompt: "Voye yon prompt apre imaj pou jenere yon imaj.", imaj_generated: "*{prompt}*", imaj_error: "Erè jenere imaj - Eseye ankò.", search_title: "Rechèch", search_error: "Erè rechèch",
    lang_title: "Lang", ai_title: "Mesaj", imaj_title: "Imaj", image_generated_title: "Imaj Jenere",
    ai_click_to_receive: "Klike isit pou resevwa repons IA a :\n{link}",
    code_confirm: "Tanpri otorize voye kòd la lè w klike isit :\n{link}",
    qrbot_created: "Nouvo Sesyon Kreye",
    qrbot_scan: "Eskane kòd sa a pou konekte nouvo sesyon an.",
    qrbot_connected: "Sesyon Konekte",
    qrbot_active: "Nouvo sesyon an aktif.\nID: {id}",
    hidetag_title: "Hidetag", hidetag_default: "Se jis yon hidetag"
  }
};

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
    "ia": "ai", "lang": "lang", "image": "imaj", "chercher": "cheche", "menu": "menu", "qrbot": "qrbot", "qr": "qr", "code": "code", "lien": "lien", "tagtout": "tagall", "hidetag": "hidetag", "expulse": "kick", "add": "add", "promote": "promote", "demote": "demote", "expulsetout": "kickall", "ferme": "ferme", "ouvert": "ouvert", "bienvenue": "bienvenue", "nolien": "nolien", "nolien2": "nolien2", "supp": "del", "vv": "vv", "sit": "sites", "alive": "alive", "ping": "ping", "pings": "ping", "bref": "bref", "brefs": "bref", "set": "set", "unset": "unset"
  },
  en: {
    "ai": "ai", "lang": "lang", "image": "imaj", "search": "cheche", "menu": "menu", "qrbot": "qrbot", "qr": "qr", "code": "code", "link": "lien", "tagall": "tagall", "hidetag": "hidetag", "kick": "kick", "add": "add", "promote": "promote", "demote": "demote", "kickall": "kickall", "close": "ferme", "open": "ouvert", "welcome": "bienvenue", "nolink": "nolien", "nolink2": "nolien2", "del": "del", "vv": "vv", "sit": "sites", "alive": "alive", "ping": "ping", "pings": "ping", "bref": "bref", "brefs": "bref", "set": "set", "unset": "unset"
  },
  es: {
    "ia": "ai", "lang": "lang", "imagen": "imaj", "buscar": "cheche", "menú": "menu", "qrbot": "qrbot", "qr": "qr", "código": "code", "enlace": "lien", "etiquetartodo": "tagall", "hidetag": "hidetag", "expulsar": "kick", "añadir": "add", "promouvoir": "promote", "degradar": "demote", "borrartodo": "kickall", "cerrar": "ferme", "abrir": "ouvert", "bienvenida": "bienvenue", "sinenlace": "nolien", "sinenlace2": "nolien2", "borrar": "del", "vv": "vv", "sit": "sites", "alive": "alive", "ping": "ping", "pings": "ping", "bref": "bref", "brefs": "bref", "set": "set", "unset": "unset"
  },
  ht: {
    "ai": "ai", "lang": "lang", "imaj": "imaj", "cheche": "cheche", "meni": "menu", "qrbot": "qrbot", "qr": "qr", "kòd": "code", "lyen": "lien", "tout": "tagall", "hidetag": "hidetag", "sipli": "kick", "add": "add", "promote": "promote", "demote": "demote", "siptout": "kickall", "fèmen": "ferme", "ouvri": "ouvert", "byenveni": "bienvenue", "nolyen": "nolien", "nolyen2": "nolien2", "sip": "del", "vv": "vv", "sit": "sites", "alive": "alive", "ping": "ping", "pings": "ping", "bref": "bref", "brefs": "bref", "set": "set", "unset": "unset"
  }
};

function normalizeText(str) {
    return str ? str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() : "";
}

async function sendFormatted(sock, from, type, text, pushName, isAI = false) {
  const fullCaption = `*○ ${type}*\n\n*Adam_D'H7*\nUtilisateur: "${pushName}"\nPropriétaire: Adam_D'H7\n\n${text}\n\n> Adam_D'H7`;
  if (isAI) {
    await sock.sendMessage(from, { text: fullCaption });
  } else {
    if (adamLogoBuffer) {
      await sock.sendMessage(from, { image: adamLogoBuffer, caption: fullCaption });
    } else {
      await sock.sendMessage(from, { text: fullCaption });
    }
  }
}

async function startAdamBot(sessionId, autoExpire = false, format = 'pair', expectExisting = false) {
    try {
        const { state, saveCreds } = await useMongoAuthState(sessionId, expectExisting);
        const { version } = await fetchLatestBaileysVersion();
        const processedIds = new Set();

        const sock = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })) },
            browser: Browsers.macOS('Safari'),
            markOnlineOnConnect: true,
            generateHighQualityLinkPreview: true,
            msgRetryCounterCache: retryCache,
            retryRequestDelayMs: 200,
            maxMsgRetryCount: 5,
            keepAliveIntervalMs: 15000,
            getMessage: async (key) => {
                return { conversation: 'It\'s a Bot.Adam_DH7 Fallback' };
            }
        });

        const sessionData = {
            sock: sock,
            qrString: null,
            ownerJid: null,
            noLienMode: {},
            bienvenueEnabled: {},
            active: true,
            readyAt: Date.now()
        };

        const chatHistories = new Map();
        let globalLang = 'en';
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
              last.content = last.content.substring(0, 14000) + ` ... [tronqué à 14000 caractères pour ne pas dépasser la limite]`;
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
                
                const currentBotNum = sock.user ? sock.user.id.split(':')[0] : null;
                const currentBotName = sock.user ? sock.user.name || 'Proprietaire' : 'Proprietaire';
                if (currentBotNum) {
                    const ownerCol = db.collection('session_owners');
                    await ownerCol.updateOne(
                        { sessionId: sessionId },
                        { 
                            $set: { sessionId: sessionId, number: currentBotNum, name: currentBotName },
                            $setOnInsert: { coOwners: [] }
                        },
                        { upsert: true }
                    );
                }

                const currentSession = activeSessions.get(sessionId);
                if (currentSession) {
                    currentSession.number = sock.user ? sock.user.id.split(':')[0] : null;
                    currentSession.status = 'connecte';
                    currentSession.format = format;
                    currentSession.sock = sock;
                }
                if (autoExpire) {
                    setTimeout(async () => {
                        try {
                            await deleteMongoSession(sessionId);
                            activeSessions.delete(sessionId);
                            sock.logout();
                            sock.end(undefined);
                        } catch(e) {}
                    }, 17 * 60 * 60 * 1000);
                }
            }
            if (connection === 'close') {
                sessionData.active = false;
                const currentSession = activeSessions.get(sessionId);
                if (currentSession) currentSession.status = 'deconnecte';
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const collection = db.collection('baileys_auth');
                const sessionExists = await collection.findOne({ _id: `auth-${sessionId}-creds` });
                if (statusCode !== DisconnectReason.loggedOut && sessionExists) {
                    setTimeout(() => startAdamBot(sessionId, autoExpire, format, true), 5000);
                } else {
                    try {
                        await deleteMongoSession(sessionId);
                        activeSessions.delete(sessionId);
                    } catch (e) {}
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
            const { id: gjid, participants: newParts, action } = update;
            if (action !== 'add' || !sessionData.bienvenueEnabled[gjid]) return;
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
                    setTimeout(() => groupMetadataCache.delete(gjid), 300000);
                    gSubject = gmeta.subject;
                } catch (e) {}
            }
            for (const user of newParts) {
                const username = user.split('@')[0];
                const welcomeText = `*○ ${welcomeTitle}*\n\n*Adam_D'H7*\nUtilisateur: "Adam_D’H7"\nPropriétaire: Adam_D'H7\n\n*${welcomeTo} ${gSubject}*\nNom: @${username}\n\n> *Adam_D'H7*`;
                if (adamLogoBuffer) {
                    await sock.sendMessage(gjid, { image: adamLogoBuffer, caption: welcomeText, mentions: [user] });
                } else {
                    await sock.sendMessage(gjid, { text: welcomeText, mentions: [user] });
                }
            }
        });

        sock.ev.on('messages.upsert', async (up) => {
            if (up.type !== 'notify') return;
            try {
                const m = up.messages[0];
                if (!m.message || m.key.remoteJid === 'status@broadcast') return;
                if (!sessionData.active) return;
                if (processedIds.has(m.key.id)) return;
                processedIds.add(m.key.id);
                
                if (processedIds.size > 2000) {
                     const iterator = processedIds.values();
                     processedIds.delete(iterator.next().value);
                }

                if (!m.messageTimestamp) return;
                const timestampNow = Math.floor(Date.now() / 1000);
                if (timestampNow - m.messageTimestamp > 7) return;

                const from = m.key.remoteJid;
                const pushName = m.pushName || 'Inconnu';
                const sender = m.key.participant || m.key.remoteJid;

                const ownerCollection = db.collection('session_owners');
                let storedOwner = await ownerCollection.findOne({ sessionId: sessionId });
                let isPrimaryOwner = false;
                let isCoOwner = false;
                
                if (storedOwner) {
                    const sNum = sender.split('@')[0].replace(/[^0-9]/g, '');
                    const sName = pushName;
                    
                    if (sNum === storedOwner.number || sName === storedOwner.name) {
                        isPrimaryOwner = true;
                        if (sNum === storedOwner.number && sName !== storedOwner.name && sName !== 'Inconnu') {
                            await ownerCollection.updateOne({ sessionId: sessionId }, { $set: { name: sName } });
                            storedOwner.name = sName;
                        }
                    } else if (storedOwner.coOwners && storedOwner.coOwners.includes(sNum)) {
                        isCoOwner = true;
                    }
                    if (!isPrimaryOwner && !isCoOwner) return;
                }

                const bodyRaw = extractBody(m);
                const body = bodyRaw.trim();

                userInfo.set(sender, {
                  pseudo: pushName,
                  number: sender.split('@')[0].replace(/[^0-9]/g, ''),
                  lang: globalLang
                });

                if (!body || body.includes('Message non chargé')) return;

                const messageType = Object.keys(unwrapMessageContent(m.message) || {})[0];
                if (['protocolMessage', 'senderKeyDistributionMessage', 'appStateSyncKeyRequest', 'appStateSyncKeyShare', 'deviceSentMessage', 'reactionMessage'].includes(messageType)) return;

                const isGroup = from.endsWith('@g.us');
                
                const botId = sock.user?.id ? (sock.user.id.includes(':') ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : sock.user.id) : null;
                const isOwner = isPrimaryOwner || isCoOwner;

                const getMeta = async () => {
                    if (groupMetadataCache.has(from)) return groupMetadataCache.get(from);
                    if (isGroup) {
                        try {
                            const meta = await sock.groupMetadata(from);
                            groupMetadataCache.set(from, meta);
                            setTimeout(() => groupMetadataCache.delete(from), 300000);
                            return meta;
                        } catch (e) {}
                    }
                    return null;
                };

                const checkAdmin = async () => {
                    if (isOwner) return true;
                    if (!isGroup) return false;
                    const metadataA = await getMeta();
                    return metadataA ? metadataA.participants.some(p => p.id === sender && p.admin) : false;
                };
                
                const cmdRegex = /^[.\/! ]?\s*([\p{L}0-9_]+)(?:\s+([\s\S]*))?$/u;
                const match = body.match(cmdRegex);

                if (isGroup && !match) {
                    const mode = sessionData.noLienMode[from] || 'off';
                    if (mode !== 'off' && bodyRaw && /https?:\/\/|www\./i.test(bodyRaw)) {
                        const metadataLink = await getMeta();
                        const senderIsAdmin = metadataLink && metadataLink.participants.find(p => p.id === sender)?.admin != null;
                        const strict = mode === 'strict';
                        if ((strict && sender !== botId) || (!strict && !senderIsAdmin)) {
                            try { await sock.sendMessage(from, { delete: m.key }); } catch (e) {}
                        }
                    }
                }

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

                switch (internalCommand) {
                    case 'menu':
                        if (args.length > 0) break;
                        let menuBody = `*● ${t.cmd_ai}*\n*○ ${t.cmd_lang}*\n*○ ${t.cmd_imaj}*\n*○ ${t.cmd_cheche}*\n\n*● ${t.cmd_menu}*\n*○ ${t.cmd_qrbot}*\n*● ${t.cmd_qr}*\n*○ ${t.cmd_code}*\n*○ ${t.cmd_lien}*\n*○ ${t.cmd_sites}*\n\n*● ${t.cmd_tagall}*\n*○ ${t.cmd_hidetag}*\n*● ${t.cmd_kick}*\n*○ ${t.cmd_add}*\n*● ${t.cmd_promote}*\n*○ ${t.cmd_demote}*\n*● ${t.cmd_kickall}*\n*○ ${t.cmd_ferme}*\n*● ${t.cmd_ouvert}*\n*○ ${t.cmd_bienvenue}*\n\n*○ ${t.cmd_nolien}*\n*● ${t.cmd_nolien2}*\n*○ ${t.cmd_del}*\n*● ${t.cmd_vv}*\n*○ ${t.cmd_alive}*\n*● ${t.cmd_bref}*\n*○ ${t.cmd_ping}*`;
                        if (isPrimaryOwner) {
                            menuBody += `\n\n*● ${t.cmd_set}*\n*○ ${t.cmd_unset}*`;
                        }
                        await sendFormatted(sock, from, t.menu_title, menuBody, pushName, false);
                        break;
                    case 'set':
                        if (!isPrimaryOwner) break;
                        if (!args) break;
                        const targetSet = args.replace(/[^0-9]/g, '');
                        if (targetSet) {
                            await ownerCollection.updateOne(
                                { sessionId: sessionId },
                                { $addToSet: { coOwners: targetSet } }
                            );
                            if (storedOwner) {
                                storedOwner.coOwners = storedOwner.coOwners || [];
                                if (!storedOwner.coOwners.includes(targetSet)) storedOwner.coOwners.push(targetSet);
                            }
                            await sendFormatted(sock, from, "Set", `Utilisateur ${targetSet} ajouté aux owners.`, pushName, false);
                        }
                        break;
                    case 'unset':
                        if (!isPrimaryOwner) break;
                        if (!args) break;
                        const targetUnset = args.replace(/[^0-9]/g, '');
                        if (targetUnset) {
                            await ownerCollection.updateOne(
                                { sessionId: sessionId },
                                { $pull: { coOwners: targetUnset } }
                            );
                            if (storedOwner && storedOwner.coOwners) {
                                storedOwner.coOwners = storedOwner.coOwners.filter(n => n !== targetUnset);
                            }
                            await sendFormatted(sock, from, "Unset", `Utilisateur ${targetUnset} retiré des owners.`, pushName, false);
                        }
                        break;
                    case 'alive':
                        const uptimeSeconds = (Date.now() - sessionData.readyAt) / 1000;
                        const upTimeStr = formatUptime(uptimeSeconds, t);
                        const aliveMsg = `*${t.connected_since} ${upTimeStr}*`;
                        await sendFormatted(sock, from, t.alive_title, aliveMsg, pushName, false);
                        break;
                    case 'ping':
                        const msgTimestamp = m.messageTimestamp * 1000;
                        const pingMs = Date.now() - msgTimestamp;
                        const pingStr = `*${pingMs} ms*`;
                        await sendFormatted(sock, from, "Ping", pingStr, pushName, false);
                        break;
                    case 'qr':
                        if (!args) break;
                        const qrBuffer = await QRCode.toBuffer(args);
                        await sock.sendMessage(from, { image: qrBuffer, caption: `*○ ${t.cmd_qr}*\n\n*Adam_D'H7*\nUtilisateur: "${pushName}"\nPropriétaire: Adam_D'H7\n\n${args}\n\n> Adam_D'H7` });
                        break;
                    case 'qrbot':
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
                                    const createdCaption = `*○ ${t.qrbot_created}*\n\n*Adam_D'H7*\nUtilisateur: "${pushName}"\nPropriétaire: Adam_D'H7\n\n${t.qrbot_scan}\n\n> Adam_D'H7`;
                                    await sock.sendMessage(from, { image: qrbuf, caption: createdCaption });
                                } catch (e) {}
                            }
                            if (connection === 'open') {
                                const realId = tempSock.user.id.split(':')[0];
                                const activeMsg = `${t.qrbot_active.replace('{id}', realId)}`;
                                await sendFormatted(sock, from, t.qrbot_connected, activeMsg, pushName, false);
                                tempSock.end(undefined);
                                try {
                                    await renameMongoSession(tempId, `session_${realId}`);
                                    startAdamBot(`session_${realId}`, false, 'qr', false);
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
                                 tempSock.end(undefined);
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
                            const groupDesc = metadataLien && metadataLien.desc ? metadataLien.desc.toString().trim() + '\n\n' : '';
                            const lienCapTitle = t.cmd_lien.charAt(0).toUpperCase() + t.cmd_lien.slice(1);
                            const lienCaption = `*○ ${lienCapTitle}*\n\n*Adam_D'H7*\nUtilisateur: "${pushName}"\nPropriétaire: Adam_D'H7\n\n${groupName}*${link}*\n\n${groupDesc}> Adam_D'H7`;
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
                    case 'tagall':
                        if (!isGroup) break;
                        const metadataTag = await getMeta();
                        if (!metadataTag) break;
                        const tagTitle = t.cmd_tagall.charAt(0).toUpperCase() + t.cmd_tagall.slice(1);
                        const participants = metadataTag.participants.map(p => p.id);
                        const tagBody = participants.map((p, i) => (i % 2 === 0 ? '●' : '○') + ' @' + p.split('@')[0]).join('\n');
                        const tagCaption = `*○ ${tagTitle}*\n\n*Adam_D'H7*\nUtilisateur: "${pushName}"\nPropriétaire: Adam_D'H7\n\n${tagBody}\n\n> Adam_D'H7`;
                        const tagOpts = { mentions: participants };
                        if (adamLogoBuffer) {
                            tagOpts.image = adamLogoBuffer;
                            tagOpts.caption = tagCaption;
                        } else {
                            tagOpts.text = tagCaption;
                        }
                        await sock.sendMessage(from, tagOpts);
                        break;
                    case 'code':
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
                                const confirmText = t.code_confirm.replace('{link}', confirmLink);
                                const msgConfirmation = await sock.sendMessage(from, { text: confirmText });
                                tfEvents.once('ok-' + tfid, async () => {
                                    await sock.sendMessage(from, { delete: msgConfirmation.key });
                                    await sock.sendMessage(from, { text: data.code });
                                });
                            }
                        } catch (e) {}
                        break;
                    case 'hidetag':
                        if (!isGroup) break;
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
                            const defaultText = `*○ ${htTitle}*\n\n*Adam_D'H7*\nUtilisateur: "${pushName}"\nPropriétaire: Adam_D'H7\n\n*${htDefault}*\n\n> Adam_D'H7`;
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
                        if (toKick.length > 0) await safeGroupUpdate(from, toKick, 'remove');
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
                        sessionData.bienvenueEnabled[from] = !sessionData.bienvenueEnabled[from];
                        const bwStat = sessionData.bienvenueEnabled[from] ? t.welcome_on : t.welcome_off;
                        await sendFormatted(sock, from, t.cmd_bienvenue, `*${bwStat}*`, pushName, false);
                        break;
                    case 'nolien':
                        const isAdminNL = await checkAdmin();
                        if (!isGroup || !isAdminNL) break;
                        sessionData.noLienMode[from] = sessionData.noLienMode[from] === 'simple' ? 'off' : 'simple';
                        const nlStat = sessionData.noLienMode[from] === 'simple' ? t.nolien_on : t.nolien_off;
                        await sendFormatted(sock, from, t.cmd_nolien, `*${nlStat}*`, pushName, false);
                        break;
                    case 'nolien2':
                        const isAdminNL2 = await checkAdmin();
                        if (!isGroup || !isAdminNL2) break;
                        sessionData.noLienMode[from] = sessionData.noLienMode[from] === 'strict' ? 'off' : 'strict';
                        const nl2Stat = sessionData.noLienMode[from] === 'strict' ? t.nolien2_on : t.nolien2_off;
                        await sendFormatted(sock, from, t.cmd_nolien2, `*${nl2Stat}*`, pushName, false);
                        break;
                    case 'del':
                        if (!quoted) break;
                        const quotedParticipant = quoted.participant || quoted.remoteJid;
                        const isQuotedBot = quotedParticipant === botId;
                        const delKey = { remoteJid: from, id: quoted.stanzaId, participant: quotedParticipant };
                        if (isQuotedBot) {
                            if (!isOwner) break;
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
                    case 'bref':
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
                                const brefText = `*${fUrl}*\n*size* : ${formattedSize}`;
                                await sendFormatted(sock, from, "Bref", brefText, pushName, false);
                            }
                        } catch (e) {}
                        break;
                    case 'ai':
                        const promptText = args.trim() ? args : body;
                        if (!promptText) break;
                        let history = chatHistories.get(from) || [];
                        history.push({role: "user", content: promptText});
                        chatHistories.set(from, history);
                        const userInfoObj = userInfo.get(sender) || {pseudo: pushName, number: sender.split('@')[0], lang: globalLang};
                        const userMsgCount = history.filter(h => h.role === 'user').length;
                        const needsAd = (userMsgCount % 4 === 0);
                        let messagesForAI = buildAIMessages(history, userInfoObj, globalLang);
                        const aiResponseText = await callCloudflareAI("@cf/meta/llama-3.3-70b-instruct-fp8-fast", messagesForAI, 3000);
                        if (!needsAd) {
                            history.push({role: "assistant", content: aiResponseText});
                            if (history.length > 7) history = history.slice(-7);
                            chatHistories.set(from, history);
                            await sendFormatted(sock, from, t.ai_title, aiResponseText, pushName, false);
                        } else {
                            const tfid = Math.floor(1000000 + Math.random() * 9000000);
                            const confirmLink = `https://tf.bot.adamdh7.org/TF-${tfid}`;
                            const clickText = t.ai_click_to_receive.replace('{link}', confirmLink);
                            const clickMsg = await sock.sendMessage(from, { text: clickText });
                            const formattedAiResponse = `*○ ${t.ai_title}*\n\n*Adam_D'H7*\nUtilisateur: "${pushName}"\nPropriétaire: Adam_D'H7\n\n${aiResponseText}\n\n> Adam_D'H7`;
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
                                } catch (e) {}
                                await sock.sendMessage(pending.from, { text: pending.formattedResponse });
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
                            const msgText = t.lang_changed.replace('{lang}', langCode.toUpperCase());
                            await sendFormatted(sock, from, t.lang_title, msgText, pushName, false);
                        } else {
                            await sendFormatted(sock, from, t.lang_title, t.languages_available, pushName, false);
                        }
                        break;
                    case 'imaj':
                        if (!args) {
                            await sendFormatted(sock, from, t.imaj_title, t.imaj_prompt, pushName, false);
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
                              caption: `*○ ${t.image_generated_title}*\n\n*Adam_D'H7*\nUtilisateur: "${pushName}"\nPropriétaire: Adam_D'H7\n\n${capText}\n\n> Adam_D'H7` 
                            });
                        } catch (e) {
                            await sendFormatted(sock, from, t.imaj_title, t.imaj_error, pushName, false);
                        }
                        break;
                    case 'cheche':
                        if (!args) break;
                        try {
                            const searchData = await tavilySearch(args);
                            let responseText = searchData.answer || "Pas de résultat trouvé.";
                            if (searchData.results) {
                              responseText += "\n\nSources:\n" + searchData.results.slice(0,3).map(r => `- ${r.url}`).join("\n");
                            }
                            await sendFormatted(sock, from, t.search_title, responseText, pushName, false);
                            if (searchData.images && searchData.images.length > 0) {
                              for (let i = 0; i < Math.min(2, searchData.images.length); i++) {
                                await sock.sendMessage(from, { image: { url: searchData.images[i] }, caption: `*○ ${t.search_title}*\n\n*Adam_D'H7*\nUtilisateur: "${pushName}"\nPropriétaire: Adam_D'H7\n\nImage de recherche\n\n> Adam_D'H7` });
                              }
                            }
                        } catch (e) {
                            await sendFormatted(sock, from, t.search_title, t.search_error, pushName, false);
                        }
                        break;
                    case 'sites':
                        const sitesCaption = `*Bot.Adam_D'H7 : https://bot.adamdh7.org*\n*Bref : https://bref.adamdh7.org*\n*MIZIK : https://mizik.adamdh7.org*\n*Tout : https://tout.adamdh7.org*\n*Chaine : https://whatsapp.com/channel/0029Vb6WLps7oQhWrUlyPQ2m*\n*Canal : https://t.me/dh7adam , t.me/tfmizik*\n*Pages : https://m.facebook.com/dh7adam , https://m.facebook.com/tfmizik*`;
                        await sendFormatted(sock, from, 'Sites', sitesCaption, pushName, false);
                        break;
                }
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
        if (match && !match[1].startsWith('temp_')) sessionIds.push(match[1]);
    }
    for (const sessionId of sessionIds) {
        await startAdamBot(sessionId);
    }
}

setInterval(async () => {
    if (!db) return;
    const collection = db.collection('baileys_auth');
    const activeIds = Array.from(activeSessions.keys());
    for (const id of activeIds) {
        const sessionKey = `auth-${id}`;
        const exists = await collection.findOne({ _id: `${sessionKey}-creds` });
        if (!exists) {
            const s = activeSessions.get(id);
            if (s) {
                if (s.sock) {
                    try {
                        s.sock.logout();
                        s.sock.end(undefined);
                    } catch (e) {}
                }
                activeSessions.delete(id);
            }
        }
    }
}, 3 * 60 * 1000);

connectMongo().then(async () => {
    try {
        await loadExistingSessions();
    } catch (e) {}
    app.listen(PORT, () => {
    });
}).catch(console.error);
