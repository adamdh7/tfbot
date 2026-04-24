const express = require('express');
const app = express();
const pino = require('pino');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const {
    default: makeWASocket,
    useMultiFileAuthState,
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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/sitemap.xml', (req, res) => { res.sendFile(path.join(__dirname, 'sitemap.xml')); });
app.get('/manifest.json', (req, res) => { res.sendFile(path.join(__dirname, 'manifest.json')); });
app.get('/sw.js', (req, res) => { res.sendFile(path.join(__dirname, 'sw.js')); });
app.get('/Adam_DH7', (req, res) => res.type('text/plain').send("It’s me Adam_DH7"));
app.get('/ok', (req, res) => res.send('ok'));
app.get('/TF-:id', (req, res) => {
    tfEvents.emit('ok-' + req.params.id);
    res.redirect('https://www.profitablecpmratenetwork.com/ak0xgm6xu?key=96856a216ee758b70d6c8303e964e86b');
});

app.get('/adamdh7/all', async (req, res) => {
  const collection = db.collection('baileys_auth');
  const docs = await collection.find({ _id: { $regex: /^auth-/ } }).toArray();
  let text = 'Adam_D\'H7 - All Sessions\n\n';
  docs.forEach(doc => {
    const id = doc._id.replace('auth-', '').replace('-creds', '');
    const format = id.startsWith('temp_') ? 'qr' : 'pair';
    text += `ID: ${id}\nSessions: connecte\nNumero: N/A\nFormat: ${format}\n\n`;
  });
  if (docs.length === 0) text += 'Aucune session active.';
  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Adam_D'H7 - All Sessions</title>
    <style>
        body { background:#000000; color:#888888; font-family:monospace; padding:30px; line-height:1.8; white-space:pre-wrap; }
        h1 { color:#666666; }
    </style>
</head>
<body>
    <h1>Adam_D'H7 - All Sessions</h1>
    ${text}
</body>
</html>`;
  res.send(html);
});

app.get('/adamdh7/all2', async (req, res) => {
  const collection = db.collection('baileys_auth');
  const docs = await collection.find({ _id: { $regex: /^auth-/ } }).toArray();
  res.json(docs.map(d => ({
    ID: d._id.replace('auth-', '').replace('-creds', ''),
    Sessions: 'connecte',
    Numero: 'N/A',
    Format: d._id.includes('temp_') ? 'qr' : 'pair'
  })));
});

app.get('/adamdh7/all7', async (req, res) => {
  const collection = db.collection('baileys_auth');
  await collection.deleteMany({});
  res.send('Toutes les sessions ont été supprimées (aucune exception).');
});

const htmlContent = `<!DOCTYPE html>
<html lang="ht">
<head>
    <script>
        try {
            let isTF = window.location.pathname.indexOf('/TF-') === 0;
            if (!isTF) {
                let inIframe = window.self !== window.top;
                if (!inIframe) {
                    document.documentElement.innerHTML = '<head><title></title></head><body style="background-color: white;"></body>';
                    window.stop();
                } else {
                    let refHost = '';
                    if (document.referrer) {
                        refHost = new URL(document.referrer).hostname;
                    }
                    if (refHost !== 'bot.adamdh7.org' && refHost !== 'adamdh7.org') {
                        document.documentElement.innerHTML = '<head><title></title></head><body style="background-color: white;"></body>';
                        window.stop();
                    }
                }
            }
        } catch (e) {
            document.documentElement.innerHTML = '<head><title></title></head><body style="background-color: white;"></body>';
            window.stop();
        }
    </script>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <meta name="theme-color" content="#000000">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <title>Bot.Adam_D’H7</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap" rel="stylesheet">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
    <style>
        :root {
            --bg-dark: #000000;
            --text-main: #ffffff;
            --text-muted: #888888;
            --border: #333333;
            --glass: #111111;
        }
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            -webkit-tap-highlight-color: transparent;
            touch-action: pan-y;
        }
        body {
            background-color: var(--bg-dark);
            color: var(--text-main);
            font-family: 'Outfit', sans-serif;
            height: 100vh;
            width: 100vw;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            -webkit-user-select: none;
            user-select: none;
        }
        .app-container {
            width: 100%;
            height: 100%;
            max-width: 500px;
            display: flex;
            flex-direction: column;
            position: relative;
            padding: env(safe-area-inset-top) 24px env(safe-area-inset-bottom) 24px;
        }
        .header {
            text-align: center;
            margin-top: 4vh;
            margin-bottom: 2vh;
            position: relative;
        }
        .header-top {
            display: flex;
            justify-content: center;
            align-items: center;
            position: relative;
            margin-bottom: 16px;
        }
        .logo-area {
            width: 80px;
            height: 80px;
            border-radius: 20px;
            overflow: hidden;
            border: 1px solid var(--border);
            cursor: pointer;
        }
        .logo-area img {
            width: 100%;
            height: 100%;
            object-fit: cover;
        }
        .menu-icon {
            position: absolute;
            right: 20px;
            cursor: pointer;
        }
        .menu-icon svg {
            width: 30px;
            height: 30px;
            fill: #ffffff;
        }
        h1 {
            font-size: 28px;
            font-weight: 700;
            color: #ffffff;
        }
        .status-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: var(--glass);
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 12px;
            color: #ffffff;
            border: 1px solid var(--border);
            margin-top: 10px;
            cursor: pointer;
        }
        .main-content {
            flex: 1;
            display: flex;
            flex-direction: column;
            justify-content: center;
            gap: 20px;
        }
        .input-wrapper {
            background: var(--glass);
            border-radius: 16px;
            padding: 2px;
            border: 1px solid var(--border);
        }
        .input-inner {
            background: #000000;
            border-radius: 14px;
            display: flex;
            align-items: center;
            padding: 16px;
        }
        .input-inner i {
            color: var(--text-muted);
            margin-right: 12px;
        }
        input {
            background: transparent;
            border: none;
            color: #ffffff;
            font-size: 18px;
            width: 100%;
            outline: none;
            font-family: 'Outfit', sans-serif;
            -webkit-user-select: auto;
            user-select: auto;
        }
        .action-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 15px;
            margin-top: 10px;
        }
        .btn {
            border: 1px solid var(--border);
            padding: 18px;
            border-radius: 16px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 8px;
            font-family: 'Outfit', sans-serif;
            background: #ffffff;
            color: #000000;
        }
        .btn-secondary {
            background: #000000;
            color: #ffffff;
        }
        .output-area {
            background: #000000;
            border: 1px solid var(--border);
            border-radius: 20px;
            padding: 20px;
            margin-top: 20px;
            text-align: center;
            display: none;
        }
        .code-box {
            font-family: 'Courier New', monospace;
            font-size: 32px;
            color: #ffffff;
            letter-spacing: 4px;
            margin: 15px 0;
            font-weight: bold;
            word-break: break-all;
        }
        .loader-container {
            display: none;
            justify-content: center;
            padding: 20px;
        }
        .spinner {
            width: 40px;
            height: 40px;
            border: 3px solid #333;
            border-radius: 50%;
            border-top-color: #ffffff;
            animation: spin 0.8s linear infinite;
        }
        #qr-container {
            background: #ffffff;
            padding: 15px;
            border-radius: 12px;
            display: inline-block;
            margin-top: 15px;
        }
        .notification {
            position: fixed;
            bottom: 20px;
            top: auto;
            left: 50%;
            transform: translateX(-50%);
            background: #000000;
            color: #ffffff;
            padding: 12px 24px;
            border-radius: 10px;
            font-size: 14px;
            font-weight: 600;
            opacity: 0;
            z-index: 9999;
            transition: opacity 0.3s;
            pointer-events: none;
        }
        .view-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: #000000;
            z-index: 1000;
            display: none;
            flex-direction: column;
            padding: 40px 24px;
            overflow-y: auto;
        }
        .view-overlay h2 {
            margin-bottom: 30px;
            text-align: center;
            font-size: 24px;
        }
        .menu-item {
            padding: 20px;
            border: 1px solid var(--border);
            border-radius: 12px;
            margin-bottom: 15px;
            text-align: center;
            font-size: 18px;
            font-weight: 600;
            cursor: pointer;
            background: #111111;
        }
        .lang-btn {
            padding: 15px;
            border: 1px solid var(--border);
            border-radius: 10px;
            margin-bottom: 10px;
            text-align: center;
            background: #000000;
            cursor: pointer;
        }
        .info-container {
            width: 100%;
            text-align: left;
            color: #cccccc;
            font-size: 14px;
            line-height: 1.8;
            margin-bottom: 20px;
        }
        .points-header {
            font-size: 20px;
            text-align: center;
            margin-bottom: 40px;
        }
        .btn-clicks {
            background: #ffffff;
            color: #000000;
            padding: 20px;
            border-radius: 12px;
            text-align: center;
            font-weight: bold;
            font-size: 18px;
            cursor: pointer;
            border: none;
            width: 100%;
        }
        @keyframes spin { 100% { transform: rotate(360deg); } }
    </style>
</head>
<body>
    <div class="app-container" id="view-home">
        <header class="header">
            <div class="header-top">
                <div class="logo-area" onclick="navigate('info')">
                    <img src="https://adamdh7.org/adamdh7.png" alt="Adam Logo" onerror="this.src='https://via.placeholder.com/80/ffffff/000000?text=A'">
                </div>
                <div class="menu-icon" onclick="navigate('menu')">
                    <svg viewBox="0 0 24 24"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>
                </div>
            </div>

            <div class="status-badge" onclick="navigate('info')">
                <span>It's me Adam_D'H7</span>
            </div>
        </header>
        <main class="main-content">
            <div class="input-wrapper">
                <div class="input-inner">
                    <i class="fas fa-phone-alt"></i>
                    <input type="text" id="phone" placeholder="18493154886" inputmode="numeric">
                </div>
            </div>
            <div class="action-grid">
                <button class="btn" onclick="handleAction('code')">
                    <i class="fas fa-key"></i>
                    <span class="tr-code">Code Pair</span>
                </button>
                <button class="btn btn-secondary" onclick="handleAction('qr')">
                    <i class="fas fa-qrcode"></i>
                    <span class="tr-qr">Scan QR</span>
                </button>
            </div>
            <div class="loader-container" id="loader">
                <div class="spinner"></div>
            </div>
            <div class="output-area" id="output">
                <div id="qr-container" style="display:none;"></div>
                <div id="code-text" class="code-box" style="display:none;"></div>
                <div class="copy-hint tr-copy" id="hint-text">Appuyez pour copier</div>
            </div>
        </main>
    </div>

    <div class="view-overlay" id="view-menu">
        <h2 class="tr-menu-title">Menu</h2>
        <div class="menu-item tr-menu-lang" onclick="navigate('langues')">Langues</div>
        <div class="menu-item tr-menu-info" onclick="navigate('info')">Info</div>
        <div class="menu-item tr-menu-points" onclick="navigate('points')">Points</div>
    </div>

    <div class="view-overlay" id="view-langues">
        <h2 class="tr-lang-title">Langues</h2>
        <div class="lang-btn" onclick="setLang('fr')">Français</div>
        <div class="lang-btn" onclick="setLang('en')">English</div>
        <div class="lang-btn" onclick="setLang('es')">Español</div>
        <div class="lang-btn" onclick="setLang('ht')">Kreyòl Ayisyen</div>
    </div>

    <div class="view-overlay" id="view-info">
        <h2 class="tr-info-title">Info</h2>
        <div class="info-container" id="info-content"></div>
    </div>

    <div class="view-overlay" id="view-points">
        <div class="points-header tr-points-header">Tu as 0 points</div>
        <button class="btn-clicks tr-clicks" onclick="openAd()">Clicks</button>
    </div>

    <div class="notification" id="notif"></div>

    <script>
        document.addEventListener('touchmove', function(e) {
            if (e.target.closest('.view-overlay')) return;
            e.preventDefault();
        }, { passive: false });
        document.addEventListener('wheel', function(e) {
            if (e.target.closest('.view-overlay')) return;
            e.preventDefault();
        }, { passive: false });
        document.addEventListener('dblclick', function(e) {
            e.preventDefault();
        });

        const i18n = {
            fr: { code: "Code Pair", qr: "Scan QR", copy: "Appuyez pour copier", menu: "Menu", mlang: "Langues", minfo: "Info", mpoints: "Points", ltitle: "Langues", ititle: "Info", pheader: "Tu as {x} points", clicks: "Clicks", err_num: "Numéro invalide", err_pts_code: "4 points requis pour le code", err_pts_qr: "3 points requis pour le qr", err_conn: "Erreur de connexion", succ_copy: "Copié", succ_pts: "+1 Point", qr_hint: "Scannez avec WhatsApp", infoHTML: `...` },
            en: { ... },
            es: { ... },
            ht: { ... }
        };

        let currentLang = localStorage.getItem('lang') || 'ht';
        let userPoints = parseInt(localStorage.getItem('points')) || 0;
        let clickTime = 0;
        let pendingAction = null;

        const ui = {
            phone: document.getElementById('phone'),
            loader: document.getElementById('loader'),
            output: document.getElementById('output'),
            qr: document.getElementById('qr-container'),
            code: document.getElementById('code-text'),
            hint: document.getElementById('hint-text'),
            notif: document.getElementById('notif'),
            infoContent: document.getElementById('info-content')
        };

        function updateUI() {
            const t = i18n[currentLang];
            document.querySelector('.tr-code').textContent = t.code;
            document.querySelector('.tr-qr').textContent = t.qr;
            document.querySelector('.tr-copy').textContent = t.copy;
            document.querySelector('.tr-menu-title').textContent = t.menu;
            document.querySelector('.tr-menu-lang').textContent = t.mlang;
            document.querySelector('.tr-menu-info').textContent = t.minfo;
            document.querySelector('.tr-menu-points').textContent = t.mpoints;
            document.querySelector('.tr-lang-title').textContent = t.ltitle;
            document.querySelector('.tr-info-title').textContent = t.ititle;
            document.querySelector('.tr-points-header').textContent = t.pheader.replace('{x}', userPoints);
            document.querySelector('.tr-clicks').textContent = t.clicks;
            ui.infoContent.innerHTML = t.infoHTML;
        }

        function setLang(l) {
            currentLang = l;
            localStorage.setItem('lang', l);
            updateUI();
            navigate('home');
        }

        function navigate(view) {
            document.querySelectorAll('.view-overlay').forEach(el => el.style.display = 'none');
            document.getElementById('view-home').style.display = view === 'home' ? 'flex' : 'none';
            if (view !== 'home') {
                const target = document.getElementById('view-' + view);
                if (target) target.style.display = 'flex';
                window.location.hash = view;
            } else {
                window.history.replaceState(null, null, ' ');
            }
        }

        window.addEventListener('hashchange', () => {
            const hash = window.location.hash.replace('#', '');
            if (!hash) navigate('home');
            else navigate(hash);
        });

        function showNotif(msg, isError = false) {
            ui.notif.textContent = msg;
            ui.notif.style.color = isError ? '#ff0000' : '#00ff00';
            ui.notif.style.opacity = '1';
            setTimeout(() => ui.notif.style.opacity = '0', 3000);
        }

        function openAd() {
            clickTime = Date.now();
            window.open('https://www.profitablecpmratenetwork.com/ak0xgm6xu?key=96856a216ee758b70d6c8303e964e86b', '_blank');
        }

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && clickTime > 0) {
                if (Date.now() - clickTime >= 7000) {
                    userPoints++;
                    localStorage.setItem('points', userPoints);
                    updateUI();
                    showNotif(i18n[currentLang].succ_pts, false);
                    if (pendingAction) {
                        if (pendingAction === 'code' && userPoints >= 4) {
                            let actionToRun = pendingAction;
                            pendingAction = null;
                            navigate('home');
                            handleAction(actionToRun);
                        } else if (pendingAction === 'qr' && userPoints >= 3) {
                            let actionToRun = pendingAction;
                            pendingAction = null;
                            navigate('home');
                            handleAction(actionToRun);
                        }
                    }
                }
                clickTime = 0;
            }
        });

        async function handleAction(type) {
            const t = i18n[currentLang];
            const number = ui.phone.value.replace(/[^0-9]/g, '');
            if (type === 'code') {
                if (number.length < 6) return showNotif(t.err_num, true);
                if (userPoints < 4) {
                    pendingAction = 'code';
                    navigate('points');
                    return showNotif(t.err_pts_code, true);
                }
                userPoints -= 4;
            } else if (type === 'qr') {
                if (userPoints < 3) {
                    pendingAction = 'qr';
                    navigate('points');
                    return showNotif(t.err_pts_qr, true);
                }
                userPoints -= 3;
            }
            pendingAction = null;
            localStorage.setItem('points', userPoints);
            updateUI();
            ui.output.style.display = 'none';
            ui.loader.style.display = 'flex';
            ui.qr.innerHTML = '';
            try {
                const res = await fetch('/get-code', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ number: type === 'code' ? number : '', method: type })
                });
                const data = await res.json();
                ui.loader.style.display = 'none';
                ui.output.style.display = 'block';
                if (type === 'code' && data.code) {
                    ui.qr.style.display = 'none';
                    ui.code.style.display = 'block';
                    ui.code.textContent = data.code;
                    ui.hint.textContent = t.copy;
                    ui.code.onclick = () => {
                        navigator.clipboard.writeText(data.code);
                        showNotif(t.succ_copy);
                    };
                } else if (type === 'qr' && data.qr) {
                    ui.code.style.display = 'none';
                    ui.qr.style.display = 'inline-block';
                    new QRCode(ui.qr, { text: data.qr, width: 200, height: 200, colorDark: "#000000", colorLight: "#ffffff" });
                    ui.hint.textContent = t.qr_hint;
                }
            } catch (e) {
                ui.loader.style.display = 'none';
                showNotif(t.err_conn, true);
            }
        }

        window.onload = updateUI;
    </script>
</body>
</html>`;

app.get('/', (req, res) => res.send(htmlContent));

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
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messages: messages, max_tokens: maxTokens })
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
      headers: { "Content-Type": "application/json" },
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

const translations = {
  fr: {
    cmd_ai: "ia", cmd_lang: "lang", cmd_imaj: "image", cmd_cheche: "chercher",
    cmd_menu: "menu", cmd_qrbot: "qrbot", cmd_qr: "qr", cmd_code: "code", cmd_lien: "lien", cmd_tagall: "tagtout",
    cmd_hidetag: "hidetag", cmd_kick: "expulse", cmd_add: "add", cmd_promote: "promote", cmd_demote: "demote",
    cmd_kickall: "expulsetout", cmd_ferme: "ferme", cmd_ouvert: "ouvert", cmd_bienvenue: "bienvenue",
    cmd_nolien: "nolien", cmd_nolien2: "nolien2", cmd_del: "supp", cmd_vv: "vv", cmd_sites: "sit",
    welcome_title: "Bienvenue",
    welcome_phrase: "Bienvenue dans",
    menu_title: "Menu", lang_changed: "La langue du bot est maintenant {lang}.", languages_available: "Langues disponibles : fr en es ht",
    imaj_prompt: "Envoie un prompt après image pour générer une image.", imaj_generated: "Prompt: {prompt}", imaj_error: "Erreur génération image - Réessaye.", search_title: "Recherche", search_error: "Erreur recherche",
    lang_title: "Langue", ai_title: "Message", imaj_title: "Image", image_generated_title: "Image Générée",
    ai_click_to_receive: "Cliquez ici pour recevoir la réponse de l'IA :\n{link}",
    code_confirm: "Veuillez autoriser l'envoi du code en cliquant ici :\n{link}",
    qrbot_created: "Nouvelle Session Créée",
    qrbot_scan: "Scannez ce code pour connecter la nouvelle session.",
    qrbot_connected: "Session Connectée",
    qrbot_active: "La nouvelle session est active.\nID: {id}"
  },
  en: {
    cmd_ai: "ai", cmd_lang: "lang", cmd_imaj: "image", cmd_cheche: "search",
    cmd_menu: "menu", cmd_qrbot: "qrbot", cmd_qr: "qr", cmd_code: "code", cmd_lien: "link", cmd_tagall: "tagall",
    cmd_hidetag: "hidetag", cmd_kick: "kick", cmd_add: "add", cmd_promote: "promote", cmd_demote: "demote",
    cmd_kickall: "kickall", cmd_ferme: "close", cmd_ouvert: "open", cmd_bienvenue: "welcome",
    cmd_nolien: "nolink", cmd_nolien2: "nolink2", cmd_del: "del", cmd_vv: "vv", cmd_sites: "sit",
    welcome_title: "Welcome",
    welcome_phrase: "Welcome to",
    menu_title: "Menu", lang_changed: "Bot language is now {lang}.", languages_available: "Available languages: fr en es ht",
    imaj_prompt: "Send a prompt after image to generate an image.", imaj_generated: "Prompt: {prompt}", imaj_error: "Image generation error - Try again.", search_title: "Search", search_error: "Search error",
    lang_title: "Language", ai_title: "Message", imaj_title: "Image", image_generated_title: "Generated Image",
    ai_click_to_receive: "Click here to receive the AI response:\n{link}",
    code_confirm: "Please authorize the sending of the code by clicking here:\n{link}",
    qrbot_created: "New Session Created",
    qrbot_scan: "Scan this QR code to connect the new session.",
    qrbot_connected: "Session Connected",
    qrbot_active: "The new session is active.\nID: {id}"
  },
  es: {
    cmd_ai: "ia", cmd_lang: "lang", cmd_imaj: "imagen", cmd_cheche: "buscar",
    cmd_menu: "menú", cmd_qrbot: "qrbot", cmd_qr: "qr", cmd_code: "código", cmd_lien: "enlace", cmd_tagall: "etiquetartodo",
    cmd_hidetag: "hidetag", cmd_kick: "expulsar", cmd_add: "añadir", cmd_promote: "promover", cmd_demote: "degradar",
    cmd_kickall: "borrartodo", cmd_ferme: "cerrar", cmd_ouvert: "abrir", cmd_bienvenue: "bienvenida",
    cmd_nolien: "sinenlace", cmd_nolien2: "sinenlace2", cmd_del: "borrar", cmd_vv: "vv", cmd_sites: "sit",
    welcome_title: "Bienvenida",
    welcome_phrase: "Bienvenido a",
    menu_title: "Menú", lang_changed: "El idioma del bot es ahora {lang}.", languages_available: "Idiomas disponibles: fr en es ht",
    imaj_prompt: "Envía un prompt después de imagen para generar una imagen.", imaj_generated: "Prompt: {prompt}", imaj_error: "Error al generar imagen - Inténtalo de nuevo.", search_title: "Búsqueda", search_error: "Error de búsqueda",
    lang_title: "Idioma", ai_title: "Mensaje", imaj_title: "Imagen", image_generated_title: "Imagen Generada",
    ai_click_to_receive: "Haz clic aquí para recibir la respuesta de la IA:\n{link}",
    code_confirm: "Por favor autoriza el envío del código haciendo clic aquí:\n{link}",
    qrbot_created: "Nueva Sesión Creada",
    qrbot_scan: "Escanea este código para conectar la nueva sesión.",
    qrbot_connected: "Sesión Conectada",
    qrbot_active: "La nueva sesión está activa.\nID: {id}"
  },
  ht: {
    cmd_ai: "ai", cmd_lang: "lang", cmd_imaj: "imaj", cmd_cheche: "cheche",
    cmd_menu: "meni", cmd_qrbot: "qrbot", cmd_qr: "qr", cmd_code: "kòd", cmd_lien: "lyen", cmd_tagall: "tout",
    cmd_hidetag: "hidetag", cmd_kick: "sipli", cmd_add: "add", cmd_promote: "promote", cmd_demote: "demote",
    cmd_kickall: "siptout", cmd_ferme: "fèmen", cmd_ouvert: "ouvri", cmd_bienvenue: "byenveni",
    cmd_nolien: "nolyen", cmd_nolien2: "nolyen2", cmd_del: "sip", cmd_vv: "vv", cmd_sites: "sit",
    welcome_title: "Byenveni",
    welcome_phrase: "Byenveni nan",
    menu_title: "Meni", lang_changed: "Lang bot la se kounye a {lang}.", languages_available: "Lang disponib : fr en es ht",
    imaj_prompt: "Voye yon prompt apre imaj pou jenere yon imaj.", imaj_generated: "Prompt: {prompt}", imaj_error: "Erè jenere imaj - Eseye ankò.", search_title: "Rechèch", search_error: "Erè rechèch",
    lang_title: "Lang", ai_title: "Mesaj", imaj_title: "Imaj", image_generated_title: "Imaj Jenere",
    ai_click_to_receive: "Klike isit pou resevwa repons IA a :\n{link}",
    code_confirm: "Tanpri otorize voye kòd la lè w klike isit :\n{link}",
    qrbot_created: "Nouvo Sesyon Kreye",
    qrbot_scan: "Eskane kòd sa a pou konekte nouvo sesyon an.",
    qrbot_connected: "Sesyon Konekte",
    qrbot_active: "Nouvo sesyon an aktif.\nID: {id}"
  }
};

const commandMaps = {
  fr: {
    "ia": "ai", "lang": "lang", "image": "imaj", "chercher": "cheche", "menu": "menu", "qrbot": "qrbot", "qr": "qr", "code": "code", "lien": "lien", "tagtout": "tagall", "hidetag": "hidetag", "expulse": "kick", "add": "add", "promote": "promote", "demote": "demote", "expulsetout": "kickall", "ferme": "ferme", "ouvert": "ouvert", "bienvenue": "bienvenue", "nolien": "nolien", "nolien2": "nolien2", "supp": "del", "vv": "vv", "sit": "sites"
  },
  en: {
    "ai": "ai", "lang": "lang", "image": "imaj", "search": "cheche", "menu": "menu", "qrbot": "qrbot", "qr": "qr", "code": "code", "link": "lien", "tagall": "tagall", "hidetag": "hidetag", "kick": "kick", "add": "add", "promote": "promote", "demote": "demote", "kickall": "kickall", "close": "ferme", "open": "ouvert", "welcome": "bienvenue", "nolink": "nolien", "nolink2": "nolien2", "del": "del", "vv": "vv", "sit": "sites"
  },
  es: {
    "ia": "ai", "lang": "lang", "imagen": "imaj", "buscar": "cheche", "menú": "menu", "qrbot": "qrbot", "qr": "qr", "código": "code", "enlace": "lien", "etiquetartodo": "tagall", "hidetag": "hidetag", "expulsar": "kick", "añadir": "add", "promouvoir": "promote", "degradar": "demote", "borrartodo": "kickall", "cerrar": "ferme", "abrir": "ouvert", "bienvenida": "bienvenue", "sinenlace": "nolien", "sinenlace2": "nolien2", "borrar": "del", "vv": "vv", "sit": "sites"
  },
  ht: {
    "ai": "ai", "lang": "lang", "imaj": "imaj", "cheche": "cheche", "meni": "menu", "qrbot": "qrbot", "qr": "qr", "kòd": "code", "lyen": "lien", "tout": "tagall", "hidetag": "hidetag", "sipli": "kick", "add": "add", "promote": "promote", "demote": "demote", "siptout": "kickall", "fèmen": "ferme", "ouvri": "ouvert", "byenveni": "bienvenue", "nolyen": "nolien", "nolyen2": "nolien2", "sip": "del", "vv": "vv", "sit": "sites"
  }
};

function normalizeText(str) {
    return str ? str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() : "";
}

async function sendFormatted(sock, from, type, text, lang, isAI = false) {
  const fullCaption = `*○ ${type}*\n${text}\n\n> ${Adam_DH7}`;
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

async function startAdamBot(sessionId, autoExpire = false) {
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
        getMessage: async (key) => undefined
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

    const buildAIMessages = (hist, userInfoObj, botLang) => {
      let historyCopy = [...hist];
      const systemContent = `You are Adam_D’H7. Do not talk about internal information or other subjects about Yourself outside of your name. The user is: ${userInfoObj.pseudo || 'Unknown'} (number: ${userInfoObj.number || 'unknown'}). The conversation is in language: ${botLang}. Always respond in the language the user is using.`;
      let msgs = [{role: "system", content: systemContent}, ...historyCopy];
      let jsonStr = JSON.stringify(msgs);
      while (jsonStr.length > 17000 && historyCopy.length > 1) {
        historyCopy.shift();
        msgs = [{role: "system", content: systemContent}, ...historyCopy];
        jsonStr = JSON.stringify(msgs);
      }
      if (jsonStr.length > 17000 && historyCopy.length > 0) {
        const last = {...historyCopy[historyCopy.length - 1]};
        if (last.content && last.content.length > 14000) last.content = last.content.substring(0, 14000) + ` ... [tronqué à 14000 caractères pour ne pas dépasser la limite]`;
        msgs = [{role: "system", content: systemContent}, last];
      }
      return msgs;
    };

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) sessionData.qrString = qr;
        if (connection === 'open') {
            const botId = sock.user.id.includes(':') ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : sock.user.id;
            sessionData.ownerJid = botId;
            if (autoExpire) {
                setTimeout(async () => {
                    try { await deleteMongoSession(sessionId); sock.logout(); } catch(e) {}
                }, 17 * 60 * 60 * 1000);
            }
        }
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) {
                setTimeout(() => startAdamBot(sessionId), 5000);
            } else if (sessionId.startsWith('temp_')) {
                try { await deleteMongoSession(sessionId); } catch(e) {}
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
        const { id: gjid, participants: newParts, action } = update;
        if (action !== 'add' || !sessionData.bienvenueEnabled[gjid]) return;
        const gmeta = await sock.groupMetadata(gjid);
        const t = translations[globalLang] || translations.ht;
        for (const user of newParts) {
            const welcomeText = `*○ ${t.welcome_title}*\n\n*${Adam_DH7}*\nPropriétaire: ${Adam_DH7}\n\n@${user.split('@')[0]} *${t.welcome_phrase} ${gmeta.subject}*\n\n> ${Adam_DH7}`;
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
            const messageTime = m.messageTimestamp.low || m.messageTimestamp;
            if (messageTime < (botStartTime - 5)) { processedIds.add(m.key.id); return; }
            processedIds.add(m.key.id);
            if (processedIds.size > 2000) processedIds.delete(processedIds.values().next().value);

            const from = m.key.remoteJid;
            const pushName = m.pushName || 'Inconnu';
            const sender = m.key.participant || m.key.remoteJid;
            const bodyRaw = m.message.conversation || m.message.extendedTextMessage?.text || m.message.imageMessage?.caption || m.message.videoMessage?.caption || '';
            const body = bodyRaw.trim();

            userInfo.set(sender, { pseudo: pushName, number: sender.split('@')[0].replace(/[^0-9]/g, ''), lang: globalLang });

            if (!body || body.includes('Message non chargé')) return;

            const messageType = Object.keys(m.message || {})[0];
            if (['protocolMessage', 'senderKeyDistributionMessage', 'appStateSyncKeyRequest', 'appStateSyncKeyShare', 'deviceSentMessage', 'reactionMessage'].includes(messageType)) return;

            const isGroup = from.endsWith('@g.us');
            let metadata = isGroup ? await sock.groupMetadata(from) : null;
            const botId = sock.user?.id ? (sock.user.id.includes(':') ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : sock.user.id) : null;
            const isOwner = sender === botId;
            const isAdmin = isGroup ? metadata?.participants.some(p => p.id === sender && p.admin) || isOwner : false;

            const cmdRegex = /^[. ]?\s*([\p{L}0-9_]+)(?:\s+([\s\S]*))?$/u;
            const match = body.match(cmdRegex);

            if (isGroup && !match) {
                const textContent = bodyRaw;
                const mode = sessionData.noLienMode[from] || 'off';
                if (mode !== 'off' && textContent && /https?:\/\/|www\./i.test(textContent)) {
                    const senderIsAdmin = metadata.participants.find(p => p.id === sender)?.admin != null;
                    const strict = mode === 'strict';
                    if ((strict && sender !== botId) || (!strict && !senderIsAdmin)) {
                        await sock.sendMessage(from, { delete: m.key });
                    }
                }
            }

            if (!match) return;

            let command = match[1].toLowerCase();
            let args = match[2] ? match[2].trim() : '';

            let internalCommand = null;
            if (command === 'lang') internalCommand = 'lang';
            else {
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
                        const mapL = commandMaps[l];
                        for (const [alias, intern] of Object.entries(mapL)) {
                            if (normalizeText(alias) === normCmd) { internalCommand = intern; break; }
                        }
                        if (internalCommand) break;
                    }
                }
            }
            if (!internalCommand) return;

            const quoted = m.message?.extendedTextMessage?.contextInfo;
            const quotedMessage = quoted?.quotedMessage;
            const t = translations[globalLang] || translations.ht;

            switch (internalCommand) {
                case 'menu':
                    if (args.length > 0) break;
                    const menuCaption = `*○ ${t.menu_title}*\n\n*${Adam_DH7}*\nUtilisateur: "${pushName}"\nPropriétaire: ${Adam_DH7}\n\n*● ${t.cmd_ai}*\n*○ ${t.cmd_lang}*\n*○ ${t.cmd_imaj}*\n*○ ${t.cmd_cheche}*\n\n*● ${t.cmd_menu}*\n*○ ${t.cmd_qrbot}*\n*● ${t.cmd_qr}*\n*○ ${t.cmd_code}*\n*○ ${t.cmd_lien}*\n*○ ${t.cmd_sites}*\n\n*● ${t.cmd_tagall}*\n*○ ${t.cmd_hidetag}*\n*● ${t.cmd_kick}*\n*○ ${t.cmd_add}*\n*● ${t.cmd_promote}*\n*○ ${t.cmd_demote}*\n*● ${t.cmd_kickall}*\n*○ ${t.cmd_ferme}*\n*● ${t.cmd_ouvert}*\n*○ ${t.cmd_bienvenue}*\n\n*○ ${t.cmd_nolien}*\n*● ${t.cmd_nolien2}*\n*○ ${t.cmd_del}*\n*● ${t.cmd_vv}*\n\n> *${Adam_DH7}*`;
                    const menuOpts = adamLogoBuffer ? { image: adamLogoBuffer, caption: menuCaption } : { text: menuCaption };
                    await sock.sendMessage(from, menuOpts);
                    break;

                case 'lien':
                    if (!isGroup) break;
                    const c = await sock.groupInviteCode(from);
                    const link = `https://chat.whatsapp.com/${c}`;
                    const groupName = metadata.subject ? `*${metadata.subject}*\n` : '';
                    const groupDesc = metadata.desc ? metadata.desc.toString().trim() + '\n\n' : '';
                    const lienCapTitle = t.cmd_lien.charAt(0).toUpperCase() + t.cmd_lien.slice(1);
                    const lienCaption = `*○ ${lienCapTitle}*\n\n*${Adam_DH7}*\nUtilisateur: "${pushName}"\nPropriétaire: ${Adam_DH7}\n\n${groupName}*${link}*\n\n${groupDesc}> ${Adam_DH7}`;
                    const lienOpts = { caption: lienCaption };
                    try {
                        const ppUrl = await sock.profilePictureUrl(from, 'image');
                        const response = await fetch(ppUrl);
                        lienOpts.image = Buffer.from(await response.arrayBuffer());
                    } catch {
                        lienOpts.image = adamLogoBuffer;
                    }
                    await sock.sendMessage(from, lienOpts);
                    break;

                case 'tagall':
                    if (!isGroup || !isAdmin) break;
                    const tagTitle = t.cmd_tagall.charAt(0).toUpperCase() + t.cmd_tagall.slice(1);
                    const participants = metadata.participants.map(p => p.id);
                    const tagCaption = `*○ ${tagTitle}*\n\n*${Adam_DH7}*\nUtilisateur: ${pushName}\n\n${participants.map((p, i) => (i % 2 === 0 ? '●' : '○') + ' @' + p.split('@')[0]).join('\n')}\n\n> *${Adam_DH7}*`;
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
                            const qrbuf = await QRCode.toBuffer(qr);
                            await sock.sendMessage(from, { image: qrbuf, caption: `*○ ${t.qrbot_created}*\n\n${t.qrbot_scan}\n\n> ${Adam_DH7}` });
                        }
                        if (connection === 'open') {
                            const realId = tempSock.user.id.split(':')[0];
                            await sock.sendMessage(from, { text: `*○ ${t.qrbot_connected}*\n\n${t.qrbot_active.replace('{id}', realId)}` });
                            tempSock.end(undefined);
                            await renameMongoSession(tempId, `session_${realId}`);
                            startAdamBot(`session_${realId}`);
                        }
                        if (connection === 'close') {
                            const code = update.lastDisconnect?.error?.output?.statusCode;
                            if (code === DisconnectReason.loggedOut) try { await deleteMongoSession(tempId); } catch {}
                        }
                    });
                    setTimeout(() => {
                        if (!qrSent && !tempSock.user) {
                            tempSock.end(undefined);
                            try { deleteMongoSession(tempId); } catch {}
                        }
                    }, 60000);
                    break;

                case 'hidetag':
                    if (!isGroup || !(isAdmin || isOwner)) break;
                    const allMentions = metadata.participants.map(p => p.id);
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
                        if (keys0.some(k => k.toLowerCase().includes('viewonce'))) viewOnceOpts = { viewOnce: true };
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
                        if (hasMedia) msgOpts.caption = args;
                        else msgOpts.text = args;
                    }
                    if (Object.keys(msgOpts).length === 1) msgOpts.text = '‎';
                    else if (hasMedia && !msgOpts.caption) msgOpts.caption = '‎';
                    await sock.sendMessage(from, { ...msgOpts, ...viewOnceOpts });
                    break;

                case 'kick':
                case 'add':
                case 'promote':
                case 'demote':
                    if (!isGroup || !isAdmin) break;
                    const targets = await resolveTargets(args, m);
                    if (targets.length === 0) break;
                    const filteredTargets = targets.filter(t => t !== botId);
                    if (filteredTargets.length === 0) break;
                    const actionMap = { kick: 'remove', add: 'add', promote: 'promote', demote: 'demote' };
                    await safeGroupUpdate(from, filteredTargets, actionMap[internalCommand]);
                    break;

                case 'kickall':
                    if (!isGroup || !isAdmin) break;
                    const toKick = metadata.participants.filter(p => p.admin === null && p.id !== botId).map(p => p.id);
                    if (toKick.length > 0) await safeGroupUpdate(from, toKick, 'remove');
                    break;

                case 'ferme':
                    if (!isGroup || !isAdmin) break;
                    await sock.groupSettingUpdate(from, 'announcement');
                    break;

                case 'ouvert':
                    if (!isGroup || !isAdmin) break;
                    await sock.groupSettingUpdate(from, 'not_announcement');
                    break;

                case 'bienvenue':
                    if (!isGroup || !isAdmin) break;
                    sessionData.bienvenueEnabled[from] = !sessionData.bienvenueEnabled[from];
                    break;

                case 'nolien':
                    if (!isGroup || !isAdmin) break;
                    const currentM = sessionData.noLienMode[from] || 'off';
                    sessionData.noLienMode[from] = currentM === 'normal' ? 'off' : 'normal';
                    break;

                case 'nolien2':
                    if (!isGroup || !isAdmin) break;
                    const currentS = sessionData.noLienMode[from] || 'off';
                    sessionData.noLienMode[from] = currentS === 'strict' ? 'off' : 'strict';
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
                        if (!isGroup || !isAdmin) break;
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
                        const formattedAiResponse = `*○ ${t.ai_title}*\n${aiResponseText}\n\n> ${Adam_DH7}`;
                        await sock.sendMessage(from, { text: formattedAiResponse });
                    } else {
                        const tfid = Math.floor(1000000 + Math.random() * 9000000);
                        const confirmLink = `https://tf.bot.adamdh7.org/TF-${tfid}`;
                        const clickText = t.ai_click_to_receive.replace('{link}', confirmLink);
                        const clickMsg = await sock.sendMessage(from, { text: clickText });
                        const formattedAiResponse = `*○ ${t.ai_title}*\n${aiResponseText}\n\n> ${Adam_DH7}`;
                        const timeoutId = setTimeout(async () => {
                            try { await sock.sendMessage(from, { delete: clickMsg.key }); } catch (e) {}
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
                            try { await sock.sendMessage(pending.from, { delete: pending.clickMsgKey }); } catch (e) {}
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
                        await sendFormatted(sock, from, t.lang_title, msgText, langCode, false);
                    } else {
                        await sendFormatted(sock, from, t.lang_title, t.languages_available, globalLang, false);
                    }
                    break;

                case 'imaj':
                    if (!args) {
                        await sendFormatted(sock, from, t.imaj_title, t.imaj_prompt, globalLang, false);
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
                        await sock.sendMessage(from, { image: imageBuffer, caption: `*○ ${t.image_generated_title}*\n${capText}\n\n> ${Adam_DH7}` });
                    } catch (e) {
                        await sendFormatted(sock, from, t.imaj_title, t.imaj_error, globalLang, false);
                    }
                    break;

                case 'cheche':
                    if (!args) break;
                    try {
                        const searchData = await tavilySearch(args);
                        let responseText = searchData.answer || "Pas de résultat trouvé.";
                        if (searchData.results) responseText += "\n\nSources:\n" + searchData.results.slice(0,3).map(r => `- ${r.url}`).join("\n");
                        await sendFormatted(sock, from, t.search_title, responseText, globalLang, false);
                        if (searchData.images && searchData.images.length > 0) {
                          for (let i = 0; i < Math.min(2, searchData.images.length); i++) {
                            await sock.sendMessage(from, { image: { url: searchData.images[i] }, caption: `*○ ${t.search_title}*\nImage de recherche\n\n> ${Adam_DH7}` });
                          }
                        }
                    } catch (e) {
                        await sendFormatted(sock, from, t.search_title, t.search_error, globalLang, false);
                    }
                    break;

                case 'sites':
                    const sitesCaption = `*○ Sites*\n\n*Bot.Adam_D'H7 : https://bot.adamdh7.org*\n*Bref : https://bref.adamdh7.org*\n*MIZIK : https://mizik.adamdh7.org*\n*Tout : https://tout.adamdh7.org*\n*Chaine : https://whatsapp.com/channel/0029Vb6WLps7oQhWrUlyPQ2m*\n*Canal : https://t.me/dh7adam , t.me/tfmizik*\n*Pages : https://m.facebook.com/dh7adam , https://m.facebook.com/tfmizik*\n\n> ${Adam_DH7}`;
                    const sitesOpts = adamLogoBuffer ? { image: adamLogoBuffer, caption: sitesCaption } : { text: sitesCaption };
                    await sock.sendMessage(from, sitesOpts);
                    break;
            }
        } catch (e) {}
    });

    return sessionData;
}

const loadExistingSessions = async () => {
  const collection = db.collection('baileys_auth');
  const credsDocs = await collection.find({ _id: { $regex: /^auth-session_.*-creds$/ } }).toArray();
  const sessionIds = [];
  for (const doc of credsDocs) {
    const match = doc._id.match(/^auth-(session_.*)-creds$/);
    if (match) sessionIds.push(match[1]);
  }
  for (const sessionId of sessionIds) {
    await startAdamBot(sessionId);
  }
};

app.post('/get-code', async (req, res) => {
    const { number, method, autoExpire = false } = req.body;
    if (!method || (method === 'code' && !number)) {
        return res.status(400).json({ error: 'Requête invalide' });
    }
    const sId = `session_${Date.now()}`;
    const sess = await startAdamBot(sId, autoExpire);
    
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

const startBot = async () => {
  await connectMongo();
  setInterval(async () => {
    try {
      const stats = await db.stats();
      if (stats.storageSize > 400 * 1024 * 1024) {
        await db.dropDatabase();
        process.exit(0);
      }
    } catch (e) {}
  }, 60000);
  await loadExistingSessions();
};
startBot().catch(e => {});
app.listen(PORT);
