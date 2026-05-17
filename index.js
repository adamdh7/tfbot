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
  const ownerCol = db.collection('session_owners');
  await ownerCol.deleteMany({ sessionId: sessionId });
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

process.on('unhandledRejection', (err) => {});
process.on('uncaughtException', (err) => {});

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
        const ownerCol = db.collection('session_owners');
        await ownerCol.deleteMany({});
        for (const session of activeSessions.values()) {
            if (session.sock) {
                try {
                    session.sock.logout();
                    if (session.sock.ws) session.sock.ws.close();
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

async function executeWithRetry(action, maxRetries = 3) {
    let attempts = 0;
    while (attempts < maxRetries) {
        try {
            return await action();
        } catch (e) {
            attempts++;
            if (attempts >= maxRetries) throw e;
            await sleep(1500);
        }
    }
}

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
    qrbot_connected: "Session Connected",
    qrbot_active: "La nouvelle session est active.\nID: {id}",
    hidetag_title: "Hidetag", hidetag_default: "Il s'agit juste d'un hidetag"
  },
  en: {
    cmd_ai: "ai", cmd_lang: "lang", cmd_imaj: "image", cmd_cheche: "search",
    cmd_menu: "menu", cmd_qrbot: "qrbot", cmd_qr: "qr", cmd_code: "code", cmd_lien: "link", cmd_tagall: "tagall",
    cmd_hidetag: "hidetag", cmd_kick: "kick", cmd_add: "add", cmd_promote: "promote", cmd_demote: "demote",
    cmd_kickall: "kickall", cmd_ferme: "close", cmd_ouvert: "open", cmd_bienvenue: "welcome",
    cmd_nolien: "nolink", cmd_nolien2: "nolink2", cmd_del: "del", cmd_vv: "vv", cmd_sites: "sit", cmd_ping: "ping", cmd_bref: "bref",
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
    cmd_alive: "alive", alive_title: "Alive", connected_since: "Conectado por", days: "día(s)", hours: "hora(s)", minutes: "minuto(s)", seconds: "segundo(s)",
    enabled: "activado", disabled: "desactivado", welcome_on: "Bienvenida activada", welcome_off: "Bienvenida desactivada", nolien_on: "Sin enlaces activado", nolien_off: "Sin enlaces desactivado", nolien2_on: "Sin enlaces estricto activado", nolien2_off: "Sin enlaces estricto desactivado",
    welcome_title: "Bienvenida", welcome_to: "Bienvenida a",
    menu_title: "Menú", lang_changed: "El idioma del bot es ahora {lang}.", languages_available: "Idiomas disponibles: fr en es ht",
    imaj_prompt: "Envía un prompt después de imagen para generar una imagen.", imaj_generated: "*{prompt}*", imaj_error: "Error al generar imagen - Inténtalo de nuevo.", search_title: "Búsqueda", search_error: "Error de búsqueda",
    lang_title: "Idioma", ai_title: "Mensaje", imaj_title: "Imagen", image_generated_title: "Imagen Generada",
    ai_click_to_receive: "Haz clic aquí para recibir la respuesta de la IA:\n{link}",
    code_confirm: "Por favor autoriza el envío del código haciendo clic aquí:\n{link}",
    qrbot_created: "Nueva Sesión Creada",
    qrbot_scan: "Escanea este código para conectar la nueva session.",
    qrbot_connected: "Sesión Conectada",
    qrbot_active: "La nueva sesión está activa.\nID: {id}",
    hidetag_title: "Hidetag", hidetag_default: "Es solo un hidetag"
  },
  ht: {
    cmd_ai: "ai", cmd_lang: "lang", cmd_imaj: "imaj", cmd_cheche: "cheche",
    cmd_menu: "meni", cmd_qrbot: "qrbot", cmd_qr: "qr", cmd_code: "kòd", cmd_lien: "lyen", cmd_tout: "tagall",
    cmd_hidetag: "hidetag", "sipli": "kick", cmd_add: "add", cmd_promote: "promote", cmd_demote: "demote",
    cmd_kickall: "siptout", cmd_ferme: "fèmen", cmd_ouvri: "ouvri", cmd_bienvenue: "bienvenue",
    cmd_nolien: "nolien", cmd_nolien2: "nolien2", cmd_del: "sip", cmd_vv: "vv", cmd_sites: "sit", cmd_ping: "ping", cmd_bref: "bref",
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
    "ia": "ai", "lang": "lang", "image": "imaj", "chercher": "cheche", "menu": "menu", "qrbot": "qrbot", "qr": "qr", "code": "code", "lien": "lien", "tagtout": "tagall", "hidetag": "hidetag", "expulse": "kick", "add": "add", "promote": "promote", "demote": "demote", "expulsetout": "kickall", "ferme": "ferme", "ouvert": "ouvert", "bienvenue": "bienvenue", "nolien": "nolien", "nolien2": "nolien2", "supp": "del", "vv": "vv", "sit": "sites", "alive": "alive", "ping": "ping", "pings": "ping", "bref": "bref", "brefs": "bref"
  },
  en: {
    "ai": "ai", "lang": "lang", "image": "imaj", "search": "cheche", "menu": "menu", "qrbot": "qrbot", "qr": "qr", "code": "code", "link": "lien", "tagall": "tagall", "hidetag": "hidetag", "kick": "kick", "add": "add", "promote": "promote", "demote": "demote", "kickall": "kickall", "close": "ferme", "open": "ouvert", "welcome": "bienvenue", "nolink": "nolien", "nolink2": "nolien2", "del": "del", "vv": "vv", "sit": "sites", "alive": "alive", "ping": "ping", "pings": "ping", "bref": "bref", "brefs": "bref"
  },
  es: {
    "ia": "ai", "lang": "lang", "imagen": "imaj", "buscar": "cheche", "menú": "menu", "qrbot": "qrbot", "qr": "qr", "código": "code", "enlace": "lien", "etiquetartodo": "tagall", "hidetag": "hidetag", "expulsar": "kick", "añadir": "add", "promouvoir": "promote", "degradar": "demote", "borrartodo": "kickall", "cerrar": "ferme", "abrir": "ouvert", "bienvenida": "bienvenue", "sinenlace": "nolien", "sinenlace2": "nolien2", "borrar": "del", "vv": "vv", "sit": "sites", "alive": "alive", "ping": "ping", "pings": "ping", "bref": "bref", "brefs": "bref"
  },
  ht: {
    "ai": "ai", "lang": "lang", "imaj": "imaj", "cheche": "cheche", "meni": "menu", "qrbot": "qrbot", "qr": "qr", "kòd": "code", "lyen": "lien", "tout": "tagall", "hidetag": "hidetag", "sipli": "kick", "add": "add", "promote": "promote", "demote": "demote", "siptout": "kickall", "fèmen": "ferme", "ouvri": "ouvert", "byenveni": "bienvenue", "nolyen": "nolien", "nolyen2": "nolien2", "sip": "del", "vv": "vv", "sit": "sites", "alive": "alive", "ping": "ping", "pings": "ping", "bref": "bref", "brefs": "bref"
  }
};

function normalizeText(str) {
    return str ? str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() : "";
}

async function sendFormatted(sock, from, type, text, pushName, isAI = false, hostName = "Adam_D'H7") {
  const fullCaption = `*○ ${type}*\n\n*Adam_D'H7*\nUtilisateur: "${pushName}"\nPropriétaire: ${hostName}\n\n${text}\n\n> Adam_D'H7`;
  await executeWithRetry(async () => {
    if (isAI) {
      await sock.sendMessage(from, { text: fullCaption });
    } else {
      if (adamLogoBuffer) {
        await sock.sendMessage(from, { image: adamLogoBuffer, caption: fullCaption });
      } else {
        await sock.sendMessage(from, { text: fullCaption });
      }
    }
  });
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
            auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })) },
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

        const configCollection = db.collection('group_configs');
        const loadConfigs = async () => {
            const list = await configCollection.find({ sessionId }).toArray();
            for (const item of list) {
                if (item.noLienMode !== undefined) sessionData.noLienMode[item.jid] = item.noLienMode;
                if (item.bienvenueEnabled !== undefined) sessionData.bienvenueEnabled[item.jid] = item.bienvenueEnabled;
            }
        };

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
                
                await loadConfigs();
                
                const currentBotNum = sock.user ? sock.user.id.split(':')[0] : null;
                const currentBotName = sock.user ? sock.user.name || "Adam_D'H7" : "Adam_D'H7";
                if (currentBotNum) {
                    const ownerCol = db.collection('session_owners');
                    const existingOwner = await ownerCol.findOne({ sessionId: sessionId });
                    if (!existingOwner) {
                        await ownerCol.updateOne(
                            { sessionId: sessionId },
                            { $set: { sessionId: sessionId, Number: currentBotNum, Name: "Adam_D'H7" } },
                            { upsert: true }
                        );
                    } else if (!existingOwner.Number) {
                        await ownerCol.updateOne(
                            { sessionId: sessionId },
                            { $set: { Number: currentBotNum } }
                        );
                    }
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
                            if (sock.ws) sock.ws.close();
                        } catch(e) {}
                    }, 17 * 60 * 60 * 1000);
                }
            }
            if (connection === 'close') {
                sessionData.active = false;
                const currentSession = activeSessions.get(sessionId);
                if (currentSession) currentSession.status = 'deconnecte';
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                
                try {
                    if (sock.ws) sock.ws.close();
                } catch (e) {}

                if (statusCode === DisconnectReason.loggedOut) {
                    try {
                        await deleteMongoSession(sessionId);
                        activeSessions.delete(sessionId);
                    } catch (e) {}
                } else {
                    setTimeout(() => startAdamBot(sessionId, autoExpire, format, true), 5000);
                }
            }
        });

        const safeGroupUpdate = async (jid, participants, action) => {
            try {
                const cleanParticipants = participants.map(p => p.includes('@') ? p : `${p.replace(/[^0-9]/g, '')}@s.whatsapp.net`);
                await executeWithRetry(async () => {
                    await sock.groupParticipantsUpdate(jid, cleanParticipants, action);
                });
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
            const ownerCol = db.collection('session_owners');
            const sessionOwnerDoc = await ownerCol.findOne({ sessionId: sessionId });
            const hostNameToDisplay = sessionOwnerDoc ? sessionOwnerDoc.Name || "Adam_D'H7" : "Adam_D'H7";
            for (const user of newParts) {
                const username = user.split('@')[0];
                const welcomeText = `*○ ${welcomeTitle}*\n\n*Adam_D'H7*\nUtilisateur: "Adam_D’H7"\nPropriétaire: ${hostNameToDisplay}\n\n*${welcomeTo} ${gSubject}*\nNom: @${username}\n\n> *Adam_D'H7*`;
                await executeWithRetry(async () => {
                    if (adamLogoBuffer) {
                        await sock.sendMessage(gjid, { image: adamLogoBuffer, caption: welcomeText, mentions: [user] });
                    } else {
                        await sock.sendMessage(gjid, { text: welcomeText, mentions: [user] });
                    }
                });
            }
        });

        sock.ev.on('messages.upsert', async (up) => {
            if (up.type !== 'notify') return;
            try {
                const m = up.messages[0];
                if (!m.message || m.key.remoteJid === 'status@broadcast') return;
                const timestampNow = Math.floor(Date.now() / 1000);
                if (m.messageTimestamp && (timestampNow - m.messageTimestamp > 777)) return;
                if (!sessionData.active) return;
                if (processedIds.has(m.key.id)) return;
                processedIds.add(m.key.id);
                if (processedIds.size > 2000) {
                    const iterator = processedIds.values();
                    processedIds.delete(iterator.next().value);
                }
                const from = m.key.remoteJid;
                const pushName = m.pushName || 'Inconnu';
                const sender = m.key.participant || m.key.remoteJid;
                let activeHostName = "Adam_D'H7";
                const ownerCollection = db.collection('session_owners');
                let storedOwner = await ownerCollection.findOne({ sessionId: sessionId });
                
                const sNum = sender.split('@')[0].replace(/[^0-9]/g, '');
                const sName = pushName;
                
                if (storedOwner) {
                    activeHostName = storedOwner.Name || "Adam_D'H7";
                    let allowed = false;
                    if (sNum === storedOwner.Number || sName === "Adam_D'H7") {
                        allowed = true;
                        if (sNum === storedOwner.Number && sName !== storedOwner.Name && sName !== 'Inconnu' && sName !== "Adam_D'H7") {
                            await ownerCollection.updateOne({ sessionId: sessionId }, { $set: { Name: sName } });
                            storedOwner.Name = sName;
                            activeHostName = sName;
                        }
                    }
                    if (!allowed) return;
                } else {
                    if (sName === "Adam_D'H7" && sNum) {
                        await ownerCollection.updateOne(
                            { sessionId: sessionId },
                            { $set: { sessionId: sessionId, Number: sNum, Name: "Adam_D'H7" } },
                            { upsert: true }
                        );
                        activeHostName = "Adam_D'H7";
                    } else {
                        return;
                    }
                }

                const bodyRaw = extractBody(m);
                const body = bodyRaw.trim();
                userInfo.set(sender, { pseudo: pushName, number: sender.split('@')[0].replace(/[^0-9]/g, ''), lang: globalLang });
                if (!body || body.includes('Message non chargé')) return;
                const messageType = Object.keys(unwrapMessageContent(m.message) || {})[0];
                if (['protocolMessage', 'senderKeyDistributionMessage', 'appStateSyncKeyRequest', 'appStateSyncKeyShare', 'deviceSentMessage', 'reactionMessage'].includes(messageType)) return;
                const isGroup = from.endsWith('@g.us');

                if (isGroup && sessionData.noLienMode[from] && !m.key.fromMe) {
                    const containsLink = /(https?:\/\/[^\s]+)/gi.test(body) || body.includes('wa.me') || body.includes('whatsapp.com');
                    if (containsLink) {
                        let isSenderAdmin = false;
                        try {
                            if (!groupMetadataCache.has(from)) {
                                const gmeta = await sock.groupMetadata(from);
                                groupMetadataCache.set(from, gmeta);
                                setTimeout(() => groupMetadataCache.delete(from), 300000);
                            }
                            const metadata = groupMetadataCache.get(from);
                            isSenderAdmin = metadata?.participants?.some(p => p.id === sender && (p.admin === 'admin' || p.admin === 'superadmin'));
                        } catch (e) {}
                        
                        if (!isSenderAdmin) {
                            try {
                                await executeWithRetry(async () => {
                                    await sock.sendMessage(from, { delete: m.key });
                                });
                            } catch (e) {}
                            if (sessionData.noLienMode[from] === 'strict') {
                                await safeGroupUpdate(from, [sender], 'remove');
                            }
                            return;
                        }
                    }
                }

                const prefix = '/';
                if (!body.startsWith(prefix)) {
                    if (!isGroup && !m.key.fromMe) {
                        if (!chatHistories.has(from)) chatHistories.set(from, []);
                        const hist = chatHistories.get(from);
                        hist.push({ role: "user", content: body });
                        if (hist.length > 20) hist.shift();
                        const uInfo = userInfo.get(sender) || { pseudo: pushName, number: sender.split('@')[0].replace(/[^0-9]/g, '') };
                        const aiMessages = buildAIMessages(hist, uInfo, globalLang);
                        const aiResponse = await callCloudflareAI("@cf/meta/llama-3-8b-instruct", aiMessages);
                        hist.push({ role: "assistant", content: aiResponse });
                        const tAI = translations[globalLang] || translations.ht;
                        await sendFormatted(sock, from, tAI.ai_title || "Message", aiResponse, pushName, true, activeHostName);
                    }
                    return;
                }

                const args = body.slice(prefix.length).trim().split(/ +/);
                const cmdNameNormalized = normalizeText(args.shift());
                const textArg = args.join(' ');
                const currentLangMap = commandMaps[globalLang] || commandMaps.en;
                const canonicalCmd = currentLangMap[cmdNameNormalized];
                if (!canonicalCmd) return;
                const t = translations[globalLang] || translations.ht;

                if (canonicalCmd === 'menu') {
                    const menuLines = Object.keys(currentLangMap).map(c => `${prefix}${c}`);
                    await sendFormatted(sock, from, t.menu_title, menuLines.join('\n'), pushName, false, activeHostName);
                } else if (canonicalCmd === 'lang') {
                    if (!textArg) {
                        await sendFormatted(sock, from, t.lang_title, t.languages_available, pushName, false, activeHostName);
                    } else {
                        const targetLang = textArg.toLowerCase().trim();
                        if (translations[targetLang]) {
                            globalLang = targetLang;
                            const newT = translations[globalLang];
                            await sendFormatted(sock, from, newT.lang_title, newT.lang_changed.replace('{lang}', targetLang), pushName, false, activeHostName);
                        } else {
                            await sendFormatted(sock, from, t.lang_title, t.languages_available, pushName, false, activeHostName);
                        }
                    }
                } else if (canonicalCmd === 'bienvenue') {
                    if (!isGroup) return;
                    const status = textArg.toLowerCase().trim();
                    if (status === 'on') {
                        sessionData.bienvenueEnabled[from] = true;
                        await configCollection.updateOne({ sessionId, jid: from }, { $set: { bienvenueEnabled: true } }, { upsert: true });
                        await sendFormatted(sock, from, t.welcome_title, t.welcome_on, pushName, false, activeHostName);
                    } else if (status === 'off') {
                        sessionData.bienvenueEnabled[from] = false;
                        await configCollection.updateOne({ sessionId, jid: from }, { $set: { bienvenueEnabled: false } }, { upsert: true });
                        await sendFormatted(sock, from, t.welcome_title, t.welcome_off, pushName, false, activeHostName);
                    }
                } else if (canonicalCmd === 'nolien') {
                    if (!isGroup) return;
                    sessionData.noLienMode[from] = true;
                    await configCollection.updateOne({ sessionId, jid: from }, { $set: { noLienMode: true } }, { upsert: true });
                    await sendFormatted(sock, from, t.nolien_on, t.nolien_on, pushName, false, activeHostName);
                } else if (canonicalCmd === 'nolien2') {
                    if (!isGroup) return;
                    sessionData.noLienMode[from] = 'strict';
                    await configCollection.updateOne({ sessionId, jid: from }, { $set: { noLienMode: 'strict' } }, { upsert: true });
                    await sendFormatted(sock, from, t.nolien2_on, t.nolien2_on, pushName, false, activeHostName);
                } else if (canonicalCmd === 'kick') {
                    if (!isGroup) return;
                    const targets = await resolveTargets(textArg, m);
                    if (targets.length > 0) {
                        await safeGroupUpdate(from, targets, 'remove');
                    }
                } else if (canonicalCmd === 'add') {
                    if (!isGroup) return;
                    const targets = await resolveTargets(textArg, m);
                    if (targets.length > 0) {
                        await safeGroupUpdate(from, targets, 'add');
                    }
                } else if (canonicalCmd === 'promote') {
                    if (!isGroup) return;
                    const targets = await resolveTargets(textArg, m);
                    if (targets.length > 0) {
                        await safeGroupUpdate(from, targets, 'promote');
                    }
                } else if (canonicalCmd === 'demote') {
                    if (!isGroup) return;
                    const targets = await resolveTargets(textArg, m);
                    if (targets.length > 0) {
                        await safeGroupUpdate(from, targets, 'demote');
                    }
                } else if (canonicalCmd === 'kickall') {
                    if (!isGroup) return;
                    try {
                        const metadata = await sock.groupMetadata(from);
                        const botNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                        const targets = metadata.participants.map(p => p.id).filter(id => id !== botNumber && id !== sender);
                        if (targets.length > 0) {
                            await safeGroupUpdate(from, targets, 'remove');
                        }
                    } catch (e) {}
                } else if (canonicalCmd === 'ferme') {
                    if (!isGroup) return;
                    await executeWithRetry(async () => {
                        await sock.groupSettingUpdate(from, 'announcement');
                    });
                } else if (canonicalCmd === 'ouvert') {
                    if (!isGroup) return;
                    await executeWithRetry(async () => {
                        await sock.groupSettingUpdate(from, 'not_announcement');
                    });
                } else if (canonicalCmd === 'del') {
                    if (m.message?.extendedTextMessage?.contextInfo?.stanzaId) {
                        const targetKey = {
                            remoteJid: from,
                            fromMe: m.message.extendedTextMessage.contextInfo.participant === sock.user.id.split(':')[0] + '@s.whatsapp.net',
                            id: m.message.extendedTextMessage.contextInfo.stanzaId,
                            participant: m.message.extendedTextMessage.contextInfo.participant
                        };
                        try {
                            await executeWithRetry(async () => {
                                await sock.sendMessage(from, { delete: targetKey });
                            });
                        } catch (e) {}
                    }
                } else if (canonicalCmd === 'hidetag') {
                    if (!isGroup) return;
                    try {
                        const metadata = await sock.groupMetadata(from);
                        const jids = metadata.participants.map(p => p.id);
                        const mentionText = textArg || t.hidetag_default;
                        await executeWithRetry(async () => {
                            await sock.sendMessage(from, { text: mentionText, mentions: jids });
                        });
                    } catch (e) {}
                } else if (canonicalCmd === 'ping') {
                    const startPing = Date.now();
                    const pingText = `Ping: ${Date.now() - startPing}ms`;
                    await sendFormatted(sock, from, 'Ping', pingText, pushName, false, activeHostName);
                } else if (canonicalCmd === 'alive') {
                    const uptimeSec = Math.floor((Date.now() - sessionData.readyAt) / 1000);
                    const aliveMsg = `${t.connected_since} : ${formatUptime(uptimeSec, t)}`;
                    await sendFormatted(sock, from, t.alive_title, aliveMsg, pushName, false, activeHostName);
                } else if (canonicalCmd === 'cheche') {
                    if (!textArg) return;
                    const searchRes = await tavilySearch(textArg);
                    await sendFormatted(sock, from, t.search_title, searchRes.answer || t.search_error, pushName, false, activeHostName);
                } else if (canonicalCmd === 'ai') {
                    if (!textArg) return;
                    if (!chatHistories.has(from)) chatHistories.set(from, []);
                    const hist = chatHistories.get(from);
                    hist.push({ role: "user", content: textArg });
                    if (hist.length > 20) hist.shift();
                    const uInfo = userInfo.get(sender) || { pseudo: pushName, number: sender.split('@')[0].replace(/[^0-9]/g, '') };
                    const aiMessages = buildAIMessages(hist, uInfo, globalLang);
                    const aiResponse = await callCloudflareAI("@cf/meta/llama-3-8b-instruct", aiMessages);
                    hist.push({ role: "assistant", content: aiResponse });
                    await sendFormatted(sock, from, t.ai_title, aiResponse, pushName, true, activeHostName);
                } else if (canonicalCmd === 'imaj') {
                    if (!textArg) {
                        await sendFormatted(sock, from, t.imaj_title, t.imaj_prompt, pushName, false, activeHostName);
                        return;
                    }
                    try {
                        const imgModel = "@cf/bytedance/stable-diffusion-xl-lightning";
                        const accountId = "c754bf19fa1b21106a6885e3be79274e";
                        const token = "cfut_PxZCBwgwkUnnh38zccPPUSy4K5E6zYDc9xiUwcqc05395e5a";
                        const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${imgModel}`;
                        const response = await fetch(url, {
                            method: "POST",
                            headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
                            body: JSON.stringify({ prompt: textArg })
                        });
                        if (!response.ok) throw new Error();
                        const buffer = Buffer.from(await response.arrayBuffer());
                        const captionText = t.imaj_generated.replace('{prompt}', textArg);
                        await executeWithRetry(async () => {
                            await sock.sendMessage(from, { image: buffer, caption: captionText });
                        });
                    } catch (err) {
                        await sendFormatted(sock, from, t.imaj_title, t.imaj_error, pushName, false, activeHostName);
                    }
                } else if (canonicalCmd === 'qrbot') {
                    const newSessionId = 'temp_' + Math.random().toString(36).substring(2, 11);
                    await sendFormatted(sock, from, t.qrbot_created, t.qrbot_scan, pushName, false, activeHostName);
                    startAdamBot(newSessionId, true, 'qr', false).then(async (result) => {
                        if (result && result.qr) {
                            const qrBuffer = await QRCode.toBuffer(result.qr);
                            await executeWithRetry(async () => {
                                await sock.sendMessage(from, { image: qrBuffer, caption: t.qrbot_scan });
                            });
                            const opened = await waitForConnectionOpen(result.sock, 50000).catch(() => false);
                            if (opened) {
                                const finalId = result.sock.user.id.split(':')[0];
                                await renameMongoSession(newSessionId, finalId);
                                const currentS = activeSessions.get(newSessionId);
                                if (currentS) {
                                    currentS.id = finalId;
                                    currentS.status = 'connecte';
                                    activeSessions.set(finalId, currentS);
                                    activeSessions.delete(newSessionId);
                                }
                                await sendFormatted(sock, from, t.qrbot_connected, t.qrbot_active.replace('{id}', finalId), pushName, false, activeHostName);
                            }
                        }
                    }).catch(() => {});
                } else if (canonicalCmd === 'code') {
                    const newSessionId = 'temp_' + Math.random().toString(36).substring(2, 11);
                    startAdamBot(newSessionId, true, 'pair', false).then(async (result) => {
                        const qrCodeString = await waitForQr(result.sock, 30000).catch(() => null);
                        if (qrCodeString) {
                            const pairCode = await result.sock.requestPairingCode(textArg.replace(/[^0-9]/g, '')).catch(() => null);
                            if (pairCode) {
                                await sendFormatted(sock, from, 'Code', `Votre code de couplage est : *${pairCode}*`, pushName, false, activeHostName);
                                const opened = await waitForConnectionOpen(result.sock, 50000).catch(() => false);
                                if (opened) {
                                    const finalId = result.sock.user.id.split(':')[0];
                                    await renameMongoSession(newSessionId, finalId);
                                    const currentS = activeSessions.get(newSessionId);
                                    if (currentS) {
                                        currentS.id = finalId;
                                        currentS.status = 'connecte';
                                        activeSessions.set(finalId, currentS);
                                        activeSessions.delete(newSessionId);
                                    }
                                    await sendFormatted(sock, from, t.qrbot_connected, t.qrbot_active.replace('{id}', finalId), pushName, false, activeHostName);
                                }
                            }
                        }
                    }).catch(() => {});
                }
            } catch (err) {}
        });

        const initResult = { sock, qr: null };
        const qrString = await waitForQr(sock, 4000).catch(() => null);
        initResult.qr = qrString || sessionData.qrString;
        return initResult;
    } catch (e) {
        throw e;
    }
}

async function startAllSavedSessions() {
    if (!db) return;
    const collection = db.collection('baileys_auth');
    const credsDocs = await collection.find({ _id: { $regex: /-creds$/ } }).toArray();
    const sessionIds = [];
    for (const doc of credsDocs) {
        const match = doc._id.match(/^auth-(.*)-creds$/);
        if (match && !match[1].startsWith('temp_')) sessionIds.push(match[1]);
    }
    for (const sessionId of sessionIds) {
        await startAdamBot(sessionId).catch(() => {});
    }
}

setInterval(async () => {
    if (!db) return;
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

connectMongo().then(() => {
    app.listen(PORT, () => {
        startAllSavedSessions();
    });
}).catch(() => {});
