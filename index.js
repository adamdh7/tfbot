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
    downloadContentFromMessage
} = require('@whiskeysockets/baileys');

const PORT = process.env.PORT || 3000;
const tfEvents = new EventEmitter();

const sessionDirRoot = path.join(__dirname, 'auth_sessions');
if (!fs.existsSync(sessionDirRoot)) {
    fs.mkdirSync(sessionDirRoot, { recursive: true });
}

const msgRetryCounterCache = new Map();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/sitemap.xml', (req, res) => res.sendFile(path.join(__dirname, 'sitemap.xml')));
app.get('/manifest.json', (req, res) => res.sendFile(path.join(__dirname, 'manifest.json')));
app.get('/sw.js', (req, res) => res.sendFile(path.join(__dirname, 'sw.js')));
app.get('/Adam_DH7', (req, res) => res.type('text/plain').send("It’s me Adam_DH7"));

app.get('/TF-:id', (req, res) => {
    tfEvents.emit('ok-' + req.params.id);
    res.redirect('https://www.profitablecpmratenetwork.com/ak0xgm6xu?key=96856a216ee758b70d6c8303e964e86b');
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
        :root { --bg-dark: #000000; --text-main: #ffffff; --text-muted: #888888; --border: #333333; --glass: #111111; }
        * { margin:0; padding:0; box-sizing:border-box; -webkit-tap-highlight-color:transparent; touch-action:pan-y; }
        body { background-color:var(--bg-dark); color:var(--text-main); font-family:'Outfit',sans-serif; height:100vh; width:100vw; overflow:hidden; display:flex; flex-direction:column; align-items:center; justify-content:center; -webkit-user-select:none; user-select:none; }
        .app-container { width:100%; height:100%; max-width:500px; display:flex; flex-direction:column; position:relative; padding:env(safe-area-inset-top) 24px env(safe-area-inset-bottom) 24px; }
        .header { text-align:center; margin-top:4vh; margin-bottom:2vh; position:relative; }
        .header-top { display:flex; justify-content:center; align-items:center; position:relative; margin-bottom:16px; }
        .logo-area { width:80px; height:80px; border-radius:20px; overflow:hidden; border:1px solid var(--border); cursor:pointer; }
        .logo-area img { width:100%; height:100%; object-fit:cover; }
        .menu-icon { position:absolute; right:20px; cursor:pointer; }
        .menu-icon svg { width:30px; height:30px; fill:#ffffff; }
        h1 { font-size:28px; font-weight:700; color:#ffffff; }
        .status-badge { display:inline-flex; align-items:center; gap:6px; background:var(--glass); padding:6px 12px; border-radius:20px; font-size:12px; color:#ffffff; border:1px solid var(--border); margin-top:10px; cursor:pointer; }
        .main-content { flex:1; display:flex; flex-direction:column; justify-content:center; gap:20px; }
        .input-wrapper { background:var(--glass); border-radius:16px; padding:2px; border:1px solid var(--border); }
        .input-inner { background:#000000; border-radius:14px; display:flex; align-items:center; padding:16px; }
        .input-inner i { color:var(--text-muted); margin-right:12px; }
        input { background:transparent; border:none; color:#ffffff; font-size:18px; width:100%; outline:none; font-family:'Outfit',sans-serif; -webkit-user-select:auto; user-select:auto; }
        .action-grid { display:grid; grid-template-columns:1fr 1fr; gap:15px; margin-top:10px; }
        .btn { border:1px solid var(--border); padding:18px; border-radius:16px; font-size:16px; font-weight:600; cursor:pointer; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; font-family:'Outfit',sans-serif; background:#ffffff; color:#000000; }
        .btn-secondary { background:#000000; color:#ffffff; }
        .output-area { background:#000000; border:1px solid var(--border); border-radius:20px; padding:20px; margin-top:20px; text-align:center; display:none; }
        .code-box { font-family:'Courier New',monospace; font-size:32px; color:#ffffff; letter-spacing:4px; margin:15px 0; font-weight:bold; word-break:break-all; }
        .loader-container { display:none; justify-content:center; padding:20px; }
        .spinner { width:40px; height:40px; border:3px solid #333; border-radius:50%; border-top-color:#ffffff; animation:spin 0.8s linear infinite; }
        #qr-container { background:#ffffff; padding:15px; border-radius:12px; display:inline-block; margin-top:15px; }
        .notification { position:fixed; bottom:20px; left:50%; transform:translateX(-50%); background:#000000; color:#ffffff; padding:12px 24px; border-radius:10px; font-size:14px; font-weight:600; opacity:0; z-index:9999; transition:opacity 0.3s; pointer-events:none; }
        .view-overlay { position:fixed; top:0; left:0; width:100vw; height:100vh; background:#000000; z-index:1000; display:none; flex-direction:column; padding:40px 24px; overflow-y:auto; }
        .view-overlay h2 { margin-bottom:30px; text-align:center; font-size:24px; }
        .menu-item { padding:20px; border:1px solid var(--border); border-radius:12px; margin-bottom:15px; text-align:center; font-size:18px; font-weight:600; cursor:pointer; background:#111111; }
        .lang-btn { padding:15px; border:1px solid var(--border); border-radius:10px; margin-bottom:10px; text-align:center; background:#000000; cursor:pointer; }
        .info-container { width:100%; text-align:left; color:#cccccc; font-size:14px; line-height:1.8; margin-bottom:20px; }
        .points-header { font-size:20px; text-align:center; margin-bottom:40px; }
        .btn-clicks { background:#ffffff; color:#000000; padding:20px; border-radius:12px; text-align:center; font-weight:bold; font-size:18px; cursor:pointer; border:none; width:100%; }
        @keyframes spin { 100% { transform:rotate(360deg); } }
    </style>
</head>
<body>
    <div class="app-container" id="view-home">
        <header class="header">
            <div class="header-top">
                <div class="logo-area" onclick="navigate('info')"><img src="https://adamdh7.org/adamdh7.png" alt="Adam Logo" onerror="this.src='https://via.placeholder.com/80/ffffff/000000?text=A'"></div>
                <div class="menu-icon" onclick="navigate('menu')"><svg viewBox="0 0 24 24"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg></div>
            </div>
            <div class="status-badge" onclick="navigate('info')"><span>It's me Adam_D'H7</span></div>
        </header>
        <main class="main-content">
            <div class="input-wrapper">
                <div class="input-inner">
                    <i class="fas fa-phone-alt"></i>
                    <input type="text" id="phone" placeholder="18493154886" inputmode="numeric">
                </div>
            </div>
            <div class="action-grid">
                <button class="btn" onclick="handleAction('code')"><i class="fas fa-key"></i><span class="tr-code">Code Pair</span></button>
                <button class="btn btn-secondary" onclick="handleAction('qr')"><i class="fas fa-qrcode"></i><span class="tr-qr">Scan QR</span></button>
            </div>
            <div class="loader-container" id="loader"><div class="spinner"></div></div>
            <div class="output-area" id="output">
                <div id="qr-container" style="display:none;"></div>
                <div id="code-text" class="code-box" style="display:none;"></div>
                <div class="copy-hint tr-copy" id="hint-text">Appuyez pour copier</div>
            </div>
        </main>
    </div>

    <div class="view-overlay" id="view-menu"><h2 class="tr-menu-title">Menu</h2><div class="menu-item tr-menu-lang" onclick="navigate('langues')">Langues</div><div class="menu-item tr-menu-info" onclick="navigate('info')">Info</div><div class="menu-item tr-menu-points" onclick="navigate('points')">Points</div></div>
    <div class="view-overlay" id="view-langues"><h2 class="tr-lang-title">Langues</h2><div class="lang-btn" onclick="setLang('fr')">Français</div><div class="lang-btn" onclick="setLang('en')">English</div><div class="lang-btn" onclick="setLang('es')">Español</div><div class="lang-btn" onclick="setLang('ht')">Kreyòl Ayisyen</div></div>
    <div class="view-overlay" id="view-info"><h2 class="tr-info-title">Info</h2><div class="info-container" id="info-content"></div></div>
    <div class="view-overlay" id="view-points"><div class="points-header tr-points-header">Tu as 0 points</div><button class="btn-clicks tr-clicks" onclick="openAd()">Clicks</button></div>
    <div class="notification" id="notif"></div>

    <script>
        const i18n = { /* même i18n que avant (inchangé) */ };
        let currentLang = localStorage.getItem('lang') || (['fr','en','es','ht'].includes(navigator.language.slice(0,2)) ? navigator.language.slice(0,2) : 'ht');
        let userPoints = parseInt(localStorage.getItem('points')) || 0;
        let clickTime = 0; let pendingAction = null;
        const ui = { phone: document.getElementById('phone'), loader: document.getElementById('loader'), output: document.getElementById('output'), qr: document.getElementById('qr-container'), code: document.getElementById('code-text'), hint: document.getElementById('hint-text'), notif: document.getElementById('notif'), infoContent: document.getElementById('info-content') };
        function updateUI() { /* même updateUI que avant */ }
        function setLang(l) { currentLang = l; localStorage.setItem('lang', l); updateUI(); navigate('home'); }
        function navigate(view) { /* même navigate que avant */ }
        function showNotif(msg, isError = false) { /* même showNotif */ }
        function openAd() { /* même openAd */ }
        document.addEventListener('visibilitychange', () => { /* même visibilitychange */ });
        async function handleAction(type) { /* même handleAction que avant */ }
        window.onload = updateUI;
    </script>
</body>
</html>`;

app.get('/', (req, res) => res.send(htmlContent));

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const Adam_DH7 = "Adam_D'H7";
const logoPath = path.join(__dirname, 'adamdh7.png');
let adamLogoBuffer = null;

async function callCloudflareAI(model, messages, maxTokens = 3000) { /* même fonction */ }
async function tavilySearch(query) { /* même fonction */ }

const translations = { /* même translations que dans le code précédent (fr, en, es, ht) */ };

const commandMaps = { /* même commandMaps que dans le code précédent */ };

function normalizeText(str) {
    return str ? str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() : "";
}

async function sendFormatted(sock, from, type, text, lang, isAI = false) {
  const fullCaption = `*○ ${type}*\n${text}\n\n> ${Adam_DH7}`;
  if (isAI) {
    await sock.sendMessage(from, { text: fullCaption });
  } else {
    if (!adamLogoBuffer && fs.existsSync(logoPath)) adamLogoBuffer = fs.readFileSync(logoPath);
    if (adamLogoBuffer) {
      await sock.sendMessage(from, { image: adamLogoBuffer, caption: fullCaption });
    } else {
      await sock.sendMessage(from, { text: fullCaption });
    }
  }
}

async function startAdamBot(sessionId, autoExpire = false) {
    const sessionDir = path.join(__dirname, 'auth_sessions', sessionId);
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();
    const botStartTime = Math.floor(Date.now() / 1000);
    const processedIds = new Set();

    const sock = makeWASocket({ /* même configuration que avant */ });

    const sessionData = { sock, qrString: null, ownerJid: null, noLienMode: {}, bienvenueEnabled: {} };
    const chatHistories = new Map();
    let globalLang = 'en';   // ← langue par défaut prédéfinie en anglais comme demandé

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => { /* même connection.update */ });

    const safeGroupUpdate = async (jid, participants, action) => { /* même safeGroupUpdate */ };
    const resolveTargets = async (arg, m) => { /* même resolveTargets */ };

    sock.ev.on('group-participants.update', async (update) => { /* même bienvenue */ });

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

            if (!body || body.includes('Message non chargé')) return;

            const messageType = Object.keys(m.message || {})[0];
            if (['protocolMessage','senderKeyDistributionMessage','appStateSyncKeyRequest','appStateSyncKeyShare','deviceSentMessage','reactionMessage'].includes(messageType)) return;

            const isGroup = from.endsWith('@g.us');
            let metadata = isGroup ? await sock.groupMetadata(from) : null;
            const botId = sock.user?.id ? (sock.user.id.includes(':') ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : sock.user.id) : null;
            const isOwner = sender === botId;
            const isAdmin = isGroup ? metadata?.participants.some(p => p.id === sender && p.admin) || isOwner : false;

            const cmdRegex = /^([.]?)\s*([\p{L}0-9_]+)(?:\s+(.*))?$/u;
            const match = body.match(cmdRegex);

            if (isGroup && !match) {
                const mode = sessionData.noLienMode[from] || 'off';
                if (mode !== 'off' && /https?:\/\/|www\./i.test(bodyRaw)) {
                    const senderIsAdmin = metadata.participants.find(p => p.id === sender)?.admin != null;
                    const strict = mode === 'strict';
                    if ((strict && sender !== botId) || (!strict && !senderIsAdmin)) {
                        await sock.sendMessage(from, { delete: m.key });
                    }
                }
            }

            if (!match) return;

            let command = match[2].toLowerCase();
            let args = match[3] ? match[3].trim() : '';

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

            const quoted = m.message?.extendedTextMessage?.contextInfo;
            const quotedMessage = quoted?.quotedMessage;

            // ====================== TRANSLATIONS UNIQUES ======================
            const t = translations[globalLang] || translations.ht;   // ← déclaré UNE SEULE fois ici

            switch (internalCommand) {
                case 'menu':
                    if (args.length > 0) break;
                    const menuCaption = `*○ ${t.menu_title}*\n\n*${Adam_DH7}*\nUtilisateur: "${pushName}"\nPropriétaire: ${Adam_DH7}\n\n*● ${t.cmd_ai}*\n*○ ${t.cmd_lang}*\n*○ ${t.cmd_imaj}*\n*○ ${t.cmd_cheche}*\n\n*● ${t.cmd_menu}*\n*○ ${t.cmd_qrbot}*\n*● ${t.cmd_qr}*\n*○ ${t.cmd_code}*\n*○ ${t.cmd_lien}*\n\n*● ${t.cmd_tagall}*\n*○ ${t.cmd_hidetag}*\n*● ${t.cmd_kick}*\n*○ ${t.cmd_add}*\n*● ${t.cmd_promote}*\n*○ ${t.cmd_demote}*\n*● ${t.cmd_kickall}*\n*○ ${t.cmd_ferme}*\n*● ${t.cmd_ouvert}*\n*○ ${t.cmd_bienvenue}*\n\n*○ ${t.cmd_nolien}*\n*● ${t.cmd_nolien2}*\n*○ ${t.cmd_del}*\n*● ${t.cmd_vv}*\n\n> *${Adam_DH7}*`;
                    const menuOpts = {};
                    if (!adamLogoBuffer && fs.existsSync(logoPath)) adamLogoBuffer = fs.readFileSync(logoPath);
                    if (adamLogoBuffer) { menuOpts.image = adamLogoBuffer; menuOpts.caption = menuCaption; }
                    else menuOpts.text = menuCaption;
                    await sock.sendMessage(from, menuOpts);
                    break;

                case 'qr':
                    if (!args) break;
                    const qrBuffer = await QRCode.toBuffer(args);
                    await sock.sendMessage(from, { image: qrBuffer, caption: args });
                    break;

                case 'qrbot': /* même qrbot que avant */ break;

                case 'lien': /* même lien que avant */ break;

                case 'tagall':
                    if (!isGroup || !isAdmin) break;
                    const tagTitle = t.cmd_tagall.charAt(0).toUpperCase() + t.cmd_tagall.slice(1);
                    const participants = metadata.participants.map(p => p.id);
                    const tagCaption = `*○ ${tagTitle}*\n\n*${Adam_DH7}*\nUtilisateur: ${pushName}\n\n${participants.map((p, i) => (i % 2 === 0 ? '●' : '○') + ' @' + p.split('@')[0]).join('\n')}\n\n> *${Adam_DH7}*`;
                    const tagOpts = { mentions: participants };
                    if (!adamLogoBuffer && fs.existsSync(logoPath)) adamLogoBuffer = fs.readFileSync(logoPath);
                    if (adamLogoBuffer) { tagOpts.image = adamLogoBuffer; tagOpts.caption = tagCaption; }
                    else tagOpts.text = tagCaption;
                    await sock.sendMessage(from, tagOpts);
                    break;

                case 'code': /* même code que avant */ break;
                case 'hidetag': /* même hidetag que avant */ break;
                case 'kick':
                case 'add':
                case 'promote':
                case 'demote': /* même */ break;
                case 'kickall': /* même */ break;
                case 'ferme': /* même */ break;
                case 'ouvert': /* même */ break;
                case 'bienvenue': /* même */ break;
                case 'nolien': /* même */ break;
                case 'nolien2': /* même */ break;
                case 'del': /* même */ break;
                case 'vv': /* même */ break;

                case 'ai':
                    const promptText = args.trim() ? args : body;
                    if (!promptText) break;
                    let history = chatHistories.get(from) || [];
                    history.push({role: "user", content: promptText});
                    if (history.length > 7) history = history.slice(-7);
                    let messages = [{role: "system", content: "You are Adam_D’H7, do not talk about internal information or other subjects about Yourself outside of your name." }, ...history];
                    while (JSON.stringify(messages).length > 17000 && history.length > 1) {
                      history.shift();
                      messages = [{role: "system", content: "You are Adam_D’H7, do not talk about internal information or other subjects about Yourself outside of your name." }, ...history];
                    }
                    const aiResponseText = await callCloudflareAI("@cf/meta/llama-3.3-70b-instruct-fp8-fast", messages, 3000);
                    const formattedAiResponse = `*○ ${t.ai_title}*\n${aiResponseText}\n\n> ${Adam_DH7}`;
                    await sock.sendMessage(from, { text: formattedAiResponse });
                    history.push({role: "assistant", content: aiResponseText});
                    if (history.length > 7) history = history.slice(-7);
                    chatHistories.set(from, history);
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
                          method: "POST", headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
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
            }
        } catch (e) {}
    });

    return sessionData;
}

const loadExistingSessions = async () => {
    if (!fs.existsSync(sessionDirRoot)) return;
    const dirs = fs.readdirSync(sessionDirRoot);
    const sessionDirs = dirs.filter(dir => fs.statSync(path.join(sessionDirRoot, dir)).isDirectory());
    for (const sessionId of sessionDirs) await startAdamBot(sessionId);
};

app.post('/get-code', async (req, res) => { /* même /get-code que avant */ });

loadExistingSessions().catch(e => {});
app.listen(PORT);
