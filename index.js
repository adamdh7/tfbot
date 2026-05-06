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
  db = mongoClient.db('botadamdh7');
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

async function useMongoAuthState(sessionId) {
  const collection = db.collection('baileys_auth');
  const sessionKey = `auth-${sessionId}`;
  let credsDoc = await collection.findOne({ _id: `${sessionKey}-creds` });
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

async function sessionExistsInMongo(sessionId) {
  const collection = db.collection('baileys_auth');
  const sessionKey = `auth-${sessionId}`;
  const doc = await collection.findOne({ _id: `${sessionKey}-creds` });
  return !!doc;
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
    return data.result && data.result.response ? data.result.response : "**Désolé, erreur de réponse**.";
  } catch (e) {
    return "**Erreur lors de l'appel à l'IA**.";
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
    return {answer: "**Erreur de recherche Tavily**."};
  }
}

const translations = {
  fr: {
    cmd_ai: "ia", cmd_lang: "lang", cmd_imaj: "image", cmd_cheche: "chercher",
    cmd_menu: "menu", cmd_qrbot: "qrbot", cmd_qr: "qr", cmd_code: "code", cmd_lien: "lien", cmd_tagall: "tagtout",
    cmd_hidetag: "hidetag", cmd_kick: "expulse", cmd_add: "add", cmd_promote: "promote", cmd_demote: "demote",
    cmd_kickall: "expulsetout", cmd_ferme: "ferme", cmd_ouvert: "ouvert", cmd_bienvenue: "bienvenue",
    cmd_nolien: "nolien", cmd_nolien2: "nolien2", cmd_del: "supp", cmd_vv: "vv", cmd_sites: "sit", cmd_alive: "alive",
    welcome_title: "Bienvenue dans",
    menu_title: "Menu", lang_changed: "**La langue du bot est maintenant** {lang}.", languages_available: "**Langues disponibles** : **fr en es ht**",
    imaj_prompt: "**Envoie un prompt après image pour générer une image**.", imaj_generated: "**{prompt}**", imaj_error: "**Erreur génération image** - **Réessaye**.", search_title: "Recherche", search_error: "**Erreur recherche**",
    lang_title: "Langue", ai_title: "Message", imaj_title: "Image", image_generated_title: "Image Générée",
    ai_click_to_receive: "**Cliquez ici pour recevoir la réponse de l'IA** :\n{link}",
    code_confirm: "**Veuillez autoriser l'envoi du code en cliquant ici** :\n{link}",
    qrbot_created: "Nouvelle Session Créée",
    qrbot_scan: "**Veuillez autoriser l'affichage du QR en cliquant ici** :\n{link}",
    qrbot_connected: "Session Connectée",
    qrbot_active: "**La nouvelle session est active**.\n**ID**: {id}",
    welcome_activated: "● **Bienvenue activé**",
    welcome_deactivated: "○ **Bienvenue désactivé**",
    nolien_activated: "● **Anti-lien activé**",
    nolien_deactivated: "○ **Anti-lien désactivé**",
    nolien2_activated: "● **Anti-lien strict activé**",
    nolien2_deactivated: "○ **Anti-lien strict désactivé**",
    alive_title: "Alive",
    alive_connected: "Connecté depuis"
  },
  en: {
    cmd_ai: "ai", cmd_lang: "lang", cmd_imaj: "image", cmd_cheche: "search",
    cmd_menu: "menu", cmd_qrbot: "qrbot", cmd_qr: "qr", cmd_code: "code", cmd_lien: "link", cmd_tagall: "tagall",
    cmd_hidetag: "hidetag", cmd_kick: "kick", cmd_add: "add", cmd_promote: "promote", cmd_demote: "demote",
    cmd_kickall: "kickall", cmd_ferme: "close", cmd_ouvert: "open", cmd_bienvenue: "welcome",
    cmd_nolien: "nolink", cmd_nolien2: "nolink2", cmd_del: "del", cmd_vv: "vv", cmd_sites: "sit", cmd_alive: "alive",
    welcome_title: "Welcome to",
    menu_title: "Menu", lang_changed: "**Bot language is now** {lang}.", languages_available: "**Available languages**: **fr en es ht**",
    imaj_prompt: "**Send a prompt after image to generate an image**.", imaj_generated: "**{prompt}**", imaj_error: "**Image generation error** - **Try again**.", search_title: "Search", search_error: "**Search error**",
    lang_title: "Language", ai_title: "Message", imaj_title: "Image", image_generated_title: "Generated Image",
    ai_click_to_receive: "**Click here to receive the AI response**:\n{link}",
    code_confirm: "**Please authorize the sending of the code by clicking here**:\n{link}",
    qrbot_created: "New Session Created",
    qrbot_scan: "**Please authorize the QR display by clicking here**:\n{link}",
    qrbot_connected: "Session Connected",
    qrbot_active: "**The new session is active**.\n**ID**: {id}",
    welcome_activated: "● **Welcome activated**",
    welcome_deactivated: "○ **Welcome deactivated**",
    nolien_activated: "● **Anti-link activated**",
    nolien_deactivated: "○ **Anti-link deactivated**",
    nolien2_activated: "● **Strict anti-link activated**",
    nolien2_deactivated: "○ **Strict anti-link deactivated**",
    alive_title: "Alive",
    alive_connected: "Connected for"
  },
  es: {
    cmd_ai: "ia", cmd_lang: "lang", cmd_imaj: "imagen", cmd_cheche: "buscar",
    cmd_menu: "menú", cmd_qrbot: "qrbot", cmd_qr: "qr", cmd_code: "código", cmd_lien: "enlace", cmd_tagall: "etiquetartodo",
    cmd_hidetag: "hidetag", cmd_kick: "expulsar", cmd_add: "añadir", cmd_promote: "promover", cmd_demote: "degradar",
    cmd_kickall: "borrartodo", cmd_ferme: "cerrar", cmd_ouvert: "abrir", cmd_bienvenue: "bienvenida",
    cmd_nolien: "sinenlace", cmd_nolien2: "sinenlace2", cmd_del: "borrar", cmd_vv: "vv", cmd_sites: "sit", cmd_alive: "vivo",
    welcome_title: "Bienvenida en",
    menu_title: "Menú", lang_changed: "**El idioma del bot es ahora** {lang}.", languages_available: "**Idiomas disponibles**: **fr en es ht**",
    imaj_prompt: "**Envía un prompt después de imagen para generar una imagen**.", imaj_generated: "**{prompt}**", imaj_error: "**Error al generar imagen** - **Inténtalo de nuevo**.", search_title: "Búsqueda", search_error: "**Error de búsqueda**",
    lang_title: "Idioma", ai_title: "Mensaje", imaj_title: "Imagen", image_generated_title: "Imagen Generada",
    ai_click_to_receive: "**Haz clic aquí para recibir la respuesta de la IA**:\n{link}",
    code_confirm: "**Por favor autoriza el envío del código haciendo clic aquí**:\n{link}",
    qrbot_created: "Nueva Sesión Creada",
    qrbot_scan: "**Por favor autoriza la visualización del QR haciendo clic aquí**:\n{link}",
    qrbot_connected: "Sesión Conectada",
    qrbot_active: "**La nueva sesión está activa**.\n**ID**: {id}",
    welcome_activated: "● **Bienvenida activada**",
    welcome_deactivated: "○ **Bienvenida desactivada**",
    nolien_activated: "● **Anti-enlace activado**",
    nolien_deactivated: "○ **Anti-enlace desactivado**",
    nolien2_activated: "● **Anti-enlace estricto activado**",
    nolien2_deactivated: "○ **Anti-enlace estricto desactivado**",
    alive_title: "Vivo",
    alive_connected: "Conectado desde hace"
  },
  ht: {
    cmd_ai: "ai", cmd_lang: "lang", cmd_imaj: "imaj", cmd_cheche: "cheche",
    cmd_menu: "meni", cmd_qrbot: "qrbot", cmd_qr: "qr", cmd_code: "kòd", cmd_lien: "lyen", cmd_tagall: "tout",
    cmd_hidetag: "hidetag", cmd_kick: "sipli", cmd_add: "add", cmd_promote: "promote", cmd_demote: "demote",
    cmd_kickall: "siptout", cmd_ferme: "fèmen", cmd_ouvert: "ouvri", cmd_bienvenue: "byenveni",
    cmd_nolien: "nolyen", cmd_nolien2: "nolyen2", cmd_del: "sip", cmd_vv: "vv", cmd_sites: "sit", cmd_alive: "viv",
    welcome_title: "Byenveni nan",
    menu_title: "Meni", lang_changed: "**Lang bot la se kounye a** {lang}.", languages_available: "**Lang disponib** : **fr en es ht**",
    imaj_prompt: "**Voye yon prompt apre imaj pou jenere yon imaj**.", imaj_generated: "**{prompt}**", imaj_error: "**Erè jenere imaj** - **Eseye ankò**.", search_title: "Rechèch", search_error: "**Erè rechèch**",
    lang_title: "Lang", ai_title: "Mesaj", imaj_title: "Imaj", image_generated_title: "Imaj Jenere",
    ai_click_to_receive: "**Klike isit pou resevwa repons IA a** :\n{link}",
    code_confirm: "**Tanpri otorize voye kòd la lè w klike isit** :\n{link}",
    qrbot_created: "Nouvo Sesyon Kreye",
    qrbot_scan: "**Tanpri otorize ekspozisyon QR la lè w klike isit** :\n{link}",
    qrbot_connected: "Sesyon Konekte",
    qrbot_active: "**Nouvo sesyon an aktif**.\n**ID**: {id}",
    welcome_activated: "● **Byenveni aktive**",
    welcome_deactivated: "○ **Byenveni dezaktive**",
    nolien_activated: "● **Anti-lyen aktive**",
    nolien_deactivated: "○ **Anti-lyen dezaktive**",
    nolien2_activated: "● **Anti-lyen strik aktive**",
    nolien2_deactivated: "○ **Anti-lyen strik dezaktive**",
    alive_title: "Viv",
    alive_connected: "Konekte depi"
  }
};

const commandMaps = {
  fr: {
    "ia": "ai", "lang": "lang", "image": "imaj", "chercher": "cheche", "menu": "menu", "qrbot": "qrbot", "qr": "qr", "code": "code", "lien": "lien", "tagtout": "tagall", "hidetag": "hidetag", "expulse": "kick", "add": "add", "promote": "promote", "demote": "demote", "expulsetout": "kickall", "ferme": "ferme", "ouvert": "ouvert", "bienvenue": "bienvenue", "nolien": "nolien", "nolien2": "nolien2", "supp": "del", "vv": "vv", "sit": "sites", "alive": "alive"
  },
  en: {
    "ai": "ai", "lang": "lang", "image": "imaj", "search": "cheche", "menu": "menu", "qrbot": "qrbot", "qr": "qr", "code": "code", "link": "lien", "tagall": "tagall", "hidetag": "hidetag", "kick": "kick", "add": "add", "promote": "promote", "demote": "demote", "kickall": "kickall", "close": "ferme", "open": "ouvert", "welcome": "bienvenue", "nolink": "nolien", "nolink2": "nolien2", "del": "del", "vv": "vv", "sit": "sites", "alive": "alive"
  },
  es: {
    "ia": "ai", "lang": "lang", "imagen": "imaj", "buscar": "cheche", "menú": "menu", "qrbot": "qrbot", "qr": "qr", "código": "code", "enlace": "lien", "etiquetartodo": "tagall", "hidetag": "hidetag", "expulsar": "kick", "añadir": "add", "promouvoir": "promote", "degradar": "demote", "borrartodo": "kickall", "cerrar": "ferme", "abrir": "ouvert", "bienvenida": "bienvenue", "sinenlace": "nolien", "sinenlace2": "nolien2", "borrar": "del", "vv": "vv", "sit": "sites", "vivo": "alive"
  },
  ht: {
    "ai": "ai", "lang": "lang", "imaj": "imaj", "cheche": "cheche", "meni": "menu", "qrbot": "qrbot", "qr": "qr", "kòd": "code", "lyen": "lien", "tout": "tagall", "hidetag": "hidetag", "sipli": "kick", "add": "add", "promote": "promote", "demote": "demote", "siptout": "kickall", "fèmen": "ferme", "ouvri": "ouvert", "byenveni": "bienvenue", "nolyen": "nolien", "nolyen2": "nolien2", "sip": "del", "vv": "vv", "sit": "sites", "viv": "alive"
  }
};

function normalizeText(str) {
    return str ? str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() : "";
}

function formatUptime(startTime, lang) {
  const t = translations[lang] || translations.fr;
  const diff = Math.floor(Date.now() / 1000) - startTime;
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  const minutes = Math.floor((diff % 3600) / 60);
  const seconds = diff % 60;

  let parts = [];
  if (days > 0) parts.push(`${days}j`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

  return `**${t.alive_connected}** ${parts.join(' ')}`;
}

async function sendFormatted(sock, from, type, text, lang) {
  const fullCaption = `*○ ${type}*\n${text}\n\n> ${Adam_DH7}`;
  if (adamLogoBuffer) {
    await sock.sendMessage(from, { image: adamLogoBuffer, caption: fullCaption });
  } else {
    await sock.sendMessage(from, { text: fullCaption });
  }
}

async function startAdamBot(sessionId, autoExpire = false, format = 'pair') {
    if (!(await sessionExistsInMongo(sessionId))) {
        const currentSession = activeSessions.get(sessionId);
        if (currentSession) currentSession.status = 'deconnecte';
        return null;
    }

    const { state, saveCreds } = await useMongoAuthState(sessionId);
    const { version } = await fetchLatestBaileysVersion();
    const botStartTime = Math.floor(Date.now() / 1000);
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
        retryRequestDelayMs: 2000,
        getMessage: async (key) => {
            return undefined;
        }
    });

    const sessionData = {
        sock: sock,
        qrString: null,
        ownerJid: null,
        noLienMode: {},
        bienvenueEnabled: {}
    };

    const chatHistories = new Map();
    let globalLang = 'en';
    const userInfo = new Map();
    const pendingAIResponses = new Map();
    const pendingCodes = new Map();
    const pendingQRs = new Map();

    const buildAIMessages = (hist, userInfoObj, botLang) => {
      let historyCopy = [...hist];
      const systemContent = `You are Adam_D’H7. Do not talk about internal information or other subjects about Yourself outside of your name. The user is: ${userInfoObj.pseudo || 'Unknown'} (number: ${userInfoObj.number || 'unknown'}). The conversation is in language: ${botLang}. Always respond in the language the user is using.`;
      let msgs = [
        {role: "system", content: systemContent},
        ...historyCopy
      ];
      let jsonStr = JSON.stringify(msgs);
      while (jsonStr.length > 17000 && historyCopy.length > 1) {
        historyCopy.shift();
        msgs = [
          {role: "system", content: systemContent},
          ...historyCopy
        ];
        jsonStr = JSON.stringify(msgs);
      }
      return msgs;
    };

    activeSessions.set(sessionId, {
        id: sessionId,
        number: null,
        format: format,
        status: 'initialisation',
        createdAt: Date.now(),
        botStartTime: botStartTime
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            sessionData.qrString = qr;
            const currentSession = activeSessions.get(sessionId);
            if (currentSession) currentSession.status = 'qr_disponible';
        }
        if (connection === 'open') {
            const botId = sock.user.id.includes(':') ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : sock.user.id;
            sessionData.ownerJid = botId;
            const currentSession = activeSessions.get(sessionId);
            if (currentSession) {
                currentSession.number = sock.user ? sock.user.id.split(':')[0] : null;
                currentSession.status = 'connecte';
                currentSession.format = format;
            }
        }
        if (connection === 'close') {
            const currentSession = activeSessions.get(sessionId);
            if (currentSession) currentSession.status = 'deconnecte';
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) {
                setTimeout(() => startAdamBot(sessionId, autoExpire, format), 5000);
            }
        }
    });

    sock.ev.on('group-participants.update', async (update) => {
        const { id: gjid, participants: newParts, action } = update;
        if (action !== 'add' || !sessionData.bienvenueEnabled[gjid]) return;
        const gmeta = await sock.groupMetadata(gjid);
        const tWelcome = translations[globalLang] || translations.ht;
        const welcomeTitle = tWelcome.welcome_title || "Bienvenue";
        for (const user of newParts) {
            const welcomeText = `*○ ${welcomeTitle}*\n\n*${Adam_DH7}*\n**Propriétaire**: ${Adam_DH7}\n\n@${user.split('@')[0]} *${welcomeTitle}* **${gmeta.subject}**\n\n> ${Adam_DH7}`;
            if (adamLogoBuffer) {
                await sock.sendMessage(gjid, { image: adamLogoBuffer, caption: welcomeText, mentions: [user] });
            } else {
                await sock.sendMessage(gjid, { text: welcomeText, mentions: [user] });
            }
        }
    });

    sock.ev.on('messages.upsert', async (up) => {
        try {
            const m = up.messages[0];
            if (!m.message || m.key.remoteJid === 'status@broadcast') return;
            if (processedIds.has(m.key.id)) return;

            const currentSession = activeSessions.get(sessionId);
            if (!currentSession || currentSession.status !== 'connecte') return;

            const messageTime = m.messageTimestamp.low || m.messageTimestamp; 
            if (messageTime < (botStartTime - 5)) {
                processedIds.add(m.key.id);
                return;
            }
            processedIds.add(m.key.id);

            const from = m.key.remoteJid;
            const pushName = m.pushName || 'Inconnu';
            const sender = m.key.participant || m.key.remoteJid;
            const bodyRaw = m.message.conversation || m.message.extendedTextMessage?.text || m.message.imageMessage?.caption || m.message.videoMessage?.caption || '';
            const body = bodyRaw.trim();

            userInfo.set(sender, { pseudo: pushName, number: sender.split('@')[0].replace(/[^0-9]/g, ''), lang: globalLang });

            if (!body) return;

            const isGroup = from.endsWith('@g.us');
            let metadata = isGroup ? await sock.groupMetadata(from) : null;
            const botId = sock.user?.id ? (sock.user.id.includes(':') ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : sock.user.id) : null;
            const isOwner = sender === botId;
            const isAdmin = isGroup ? metadata?.participants.some(p => p.id === sender && p.admin) || isOwner : false;
            
            const cmdRegex = /^[. ]?\s*([\p{L}0-9_]+)(?:\s+([\s\S]*))?$/u;
            const match = body.match(cmdRegex);

            if (isGroup && !match) {
                const mode = sessionData.noLienMode[from] || 'off';
                if (mode !== 'off' && /https?:\/\/|www\./i.test(bodyRaw)) {
                    const senderIsAdmin = metadata.participants.find(p => p.id === sender)?.admin != null;
                    if ((mode === 'strict' && !isOwner) || (mode === 'normal' && !senderIsAdmin)) {
                        await sock.sendMessage(from, { delete: m.key });
                    }
                }
            }

            if (!match) return;

            let command = match[1].toLowerCase();
            let args = match[2] ? match[2].trim() : '';
            let internalCommand = null;

            const normCmd = normalizeText(command);
            for (const l of Object.keys(commandMaps)) {
                const mapL = commandMaps[l];
                for (const [alias, intern] of Object.entries(mapL)) {
                    if (normalizeText(alias) === normCmd) {
                        internalCommand = intern;
                        break;
                    }
                }
                if (internalCommand) break;
            }

            if (!internalCommand) return;
            const t = translations[globalLang] || translations.ht;
            const quoted = m.message?.extendedTextMessage?.contextInfo;

            switch (internalCommand) {
                case 'menu':
                    const menuCaption = `*○ ${t.menu_title}*\n\n*${Adam_DH7}*\n**Utilisateur**: "${pushName}"\n**Propriétaire**: ${Adam_DH7}\n\n*● ${t.cmd_ai}*\n*○ ${t.cmd_lang}*\n*○ ${t.cmd_imaj}*\n*○ ${t.cmd_cheche}*\n\n*● ${t.cmd_menu}*\n*○ ${t.cmd_qrbot}*\n*● ${t.cmd_qr}*\n*○ ${t.cmd_code}*\n*○ ${t.cmd_lien}*\n*○ ${t.cmd_sites}*\n\n*● ${t.cmd_tagall}*\n*○ ${t.cmd_hidetag}*\n*● ${t.cmd_kick}*\n*○ ${t.cmd_add}*\n*● ${t.cmd_promote}*\n*○ ${t.cmd_demote}*\n*● ${t.cmd_kickall}*\n*○ ${t.cmd_ferme}*\n*● ${t.cmd_ouvert}*\n*○ ${t.cmd_bienvenue}*\n\n*○ ${t.cmd_nolien}*\n*● ${t.cmd_nolien2}*\n*○ ${t.cmd_del}*\n*● ${t.cmd_vv}*\n*○ ${t.cmd_alive}*\n\n> *${Adam_DH7}*`;
                    if (adamLogoBuffer) await sock.sendMessage(from, { image: adamLogoBuffer, caption: menuCaption });
                    else await sock.sendMessage(from, { text: menuCaption });
                    break;

                case 'alive':
                    await sendFormatted(sock, from, t.alive_title, formatUptime(botStartTime, globalLang), globalLang);
                    break;

                case 'qr':
                    if (!args) break;
                    const qrGen = await QRCode.toBuffer(args);
                    await sock.sendMessage(from, { image: qrGen, caption: `**${args}**` });
                    break;

                case 'qrbot':
                    const tempIdQ = `temp_${Date.now()}`;
                    const tfidQ = Math.floor(1000000 + Math.random() * 9000000);
                    const confirmLinkQ = `https://tf.bot.adamdh7.org/TF-${tfidQ}`;
                    const scanText = t.qrbot_scan.replace('{link}', confirmLinkQ);
                    const msgQ = await sock.sendMessage(from, { text: scanText });
                    
                    tfEvents.once('ok-' + tfidQ, async () => {
                        await sock.sendMessage(from, { delete: msgQ.key });
                        const { state: tS, saveCreds: tSC } = await useMongoAuthState(tempIdQ);
                        const tSock = makeWASocket({ auth: { creds: tS.creds, keys: makeCacheableSignalKeyStore(tS.keys, pino({ level: "silent" })) }, browser: Browsers.macOS('Safari') });
                        tSock.ev.on('creds.update', tSC);
                        tSock.ev.on('connection.update', async (u) => {
                            if (u.qr) {
                                const qb = await QRCode.toBuffer(u.qr);
                                await sock.sendMessage(from, { image: qb, caption: `*○ ${t.qrbot_created}*\n\n> ${Adam_DH7}` });
                            }
                            if (u.connection === 'open') {
                                const rId = tSock.user.id.split(':')[0];
                                await sock.sendMessage(from, { text: `*○ ${t.qrbot_connected}*\n\n${t.qrbot_active.replace('{id}', rId)}` });
                                tSock.end();
                                await renameMongoSession(tempIdQ, `session_${rId}`);
                                startAdamBot(`session_${rId}`);
                            }
                        });
                    });
                    break;

                case 'code':
                    if (!args) break;
                    const cleanN = args.replace(/[^0-9]/g, '');
                    const tfidC = Math.floor(1000000 + Math.random() * 9000000);
                    const confirmLinkC = `https://tf.bot.adamdh7.org/TF-${tfidC}`;
                    const confirmTextC = t.code_confirm.replace('{link}', confirmLinkC);
                    const msgC = await sock.sendMessage(from, { text: confirmTextC });
                    
                    tfEvents.once('ok-' + tfidC, async () => {
                        await sock.sendMessage(from, { delete: msgC.key });
                        const tempIdC = `temp_${Date.now()}`;
                        const { state: tS, saveCreds: tSC } = await useMongoAuthState(tempIdC);
                        const tSock = makeWASocket({ auth: { creds: tS.creds, keys: makeCacheableSignalKeyStore(tS.keys, pino({ level: "silent" })) }, browser: Browsers.macOS('Safari') });
                        tSock.ev.on('creds.update', tSC);
                        await sleep(3000);
                        const cCode = await tSock.requestPairingCode(cleanN);
                        await sock.sendMessage(from, { text: `**${cCode.match(/.{1,4}/g).join('-')}**` });
                        tSock.ev.on('connection.update', async (u) => {
                           if (u.connection === 'open') {
                               const rId = tSock.user.id.split(':')[0];
                               await renameMongoSession(tempIdC, `session_${rId}`);
                               startAdamBot(`session_${rId}`);
                               tSock.end();
                           }
                        });
                    });
                    break;

                case 'ai':
                    const pText = args || body;
                    let hist = chatHistories.get(from) || [];
                    hist.push({role: "user", content: pText});
                    const uObj = userInfo.get(sender);
                    const aiRes = await callCloudflareAI("@cf/meta/llama-3.3-70b-instruct-fp8-fast", buildAIMessages(hist, uObj, globalLang));
                    hist.push({role: "assistant", content: aiRes});
                    chatHistories.set(from, hist.slice(-10));
                    await sock.sendMessage(from, { text: `*○ ${t.ai_title}*\n${aiRes}\n\n> ${Adam_DH7}` });
                    break;

                case 'lang':
                    const lC = args.toLowerCase();
                    if (['fr', 'en', 'es', 'ht'].includes(lC)) {
                        globalLang = lC;
                        await sendFormatted(sock, from, t.lang_title, t.lang_changed.replace('{lang}', lC.toUpperCase()), lC);
                    } else await sendFormatted(sock, from, t.lang_title, t.languages_available, globalLang);
                    break;

                case 'imaj':
                    if (!args) { await sendFormatted(sock, from, t.imaj_title, t.imaj_prompt, globalLang); break; }
                    try {
                        const accountId = "c754bf19fa1b21106a6885e3be79274e";
                        const token = "cfut_PxZCBwgwkUnnh38zccPPUSy4K5E6zYDc9xiUwcqc05395e5a";
                        const iRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`, {
                          method: "POST",
                          headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
                          body: JSON.stringify({ prompt: args, num_steps: 4 })
                        });
                        const iData = await iRes.json();
                        const iBuf = Buffer.from(iData.result.image, "base64");
                        await sock.sendMessage(from, { image: iBuf, caption: `*○ ${t.image_generated_title}*\n**${args}**\n\n> ${Adam_DH7}` });
                    } catch (e) { await sendFormatted(sock, from, t.imaj_title, t.imaj_error, globalLang); }
                    break;

                case 'cheche':
                    if (!args) break;
                    const sD = await tavilySearch(args);
                    await sendFormatted(sock, from, t.search_title, sD.answer, globalLang);
                    break;

                case 'sites':
                    const sCap = `*○ Sites*\n\n**Bot.Adam_D'H7** : https://bot.adamdh7.org\n**Bref** : https://bref.adamdh7.org\n**MIZIK** : https://mizik.adamdh7.org\n**Tout** : https://tout.adamdh7.org\n**Chaine** : https://whatsapp.com/channel/0029Vb6WLps7oQhWrUlyPQ2m\n\n> ${Adam_DH7}`;
                    await sock.sendMessage(from, { image: adamLogoBuffer, caption: sCap });
                    break;

                case 'bienvenue':
                    if (!isAdmin) break;
                    sessionData.bienvenueEnabled[from] = !sessionData.bienvenueEnabled[from];
                    await sendFormatted(sock, from, t.cmd_bienvenue, sessionData.bienvenueEnabled[from] ? t.welcome_activated : t.welcome_deactivated, globalLang);
                    break;
            }
        } catch (e) {}
    });

    return sessionData;
}

const loadExistingSessions = async () => {
  const collection = db.collection('baileys_auth');
  const docs = await collection.find({ _id: { $regex: /^auth-session_.*-creds$/ } }).toArray();
  for (const doc of docs) {
    const sId = doc._id.match(/^auth-(session_.*)-creds$/)[1];
    await startAdamBot(sId);
  }
};

const startBot = async () => {
  await connectMongo();
  await loadExistingSessions();
};

startBot().catch(e => {});
app.listen(PORT);
