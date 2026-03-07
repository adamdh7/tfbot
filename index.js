const express = require('express');
const app = express();
const pino = require('pino');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    DisconnectReason,
    Browsers,
    downloadContentFromMessage,
    jidDecode
} = require('@whiskeysockets/baileys');

const PORT = process.env.PORT || 3000;

const sessionDirRoot = path.join(__dirname, 'auth_sessions');
if (!fs.existsSync(sessionDirRoot)) {
    fs.mkdirSync(sessionDirRoot, { recursive: true });
}

const msgRetryCounterCache = new Map();

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

const htmlContent = `<!DOCTYPE html>
<html lang="ht">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <meta name="theme-color" content="#000000">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="description" content="Liez votre session Adam_D’H7 en toute sécurité via Code de couplage ou QR Code.">
    <meta name="keywords" content="Bot WhatsApp, Adam_DH7, adam dh7, pairing WhatsApp, code couplage WhatsApp, QR code WhatsApp, bot MD, Baileys WhatsApp, multi device WhatsApp">
    <meta name="author" content="Adam_DH7">
    <meta name="robots" content="index, follow">
    <meta property="og:title" content="Bot">
    <meta property="og:description" content="Système d'appairage rapide pour Bot WhatsApp.">
    <meta property="og:image" content="https://adamdh7.org/adamdh7.png">
    <meta property="og:type" content="website">
    <meta property="og:url" content="https://bot.adamdh7.org/">
    <meta property="og:locale" content="ht_HT">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="Bot.Adam_D’H7">
    <meta name="twitter:description" content="Liez votre session Adam_D’H7 en toute sécurité via Code de couplage ou QR Code.">
    <meta name="twitter:image" content="https://adamdh7.org/adamdh7.png">
    <link rel="canonical" href="https://bot.adamdh7.org" />
    <meta name="apple-mobile-web-app-title" content="Bot">
    <link rel="apple-touch-icon" href="https://adamdh7.org/adamdh7.png">
    <link rel="icon" type="image/png" sizes="512x512" href="https://adamdh7.org/adamdh7.png">
    <title>Bot.Adam_D’H7</title>
    <link rel="manifest" href="manifest.json">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap" rel="stylesheet">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "name": "Bot",
      "url": "https://bot.adamdh7.org",
      "description": "Système sécurisé de couplage pour le bot WhatsApp Adam_D’H7 via QR Code ou code de pairing."
    }
    </script>
    <style>
        :root {
            --primary: #00ff9d;
            --primary-glow: rgba(0, 255, 157, 0.4);
            --bg-dark: #050505;
            --glass: rgba(255, 255, 255, 0.03);
            --border: rgba(255, 255, 255, 0.08);
            --text-main: #ffffff;
            --text-muted: #888888;
        }
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            -webkit-tap-highlight-color: transparent;
        }
        body {
            background-color: var(--bg-dark);
            background-image: 
                radial-gradient(circle at 10% 20%, rgba(0, 255, 157, 0.05) 0%, transparent 40%),
                radial-gradient(circle at 90% 80%, rgba(0, 100, 255, 0.05) 0%, transparent 40%);
            color: var(--text-main);
            font-family: 'Outfit', sans-serif;
            height: 100vh;
            width: 100vw;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
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
            animation: fadeInDown 0.8s ease;
        }
        .logo-area {
            width: 80px;
            height: 80px;
            margin: 0 auto 16px;
            border-radius: 20px;
            overflow: hidden;
            box-shadow: 0 0 30px var(--primary-glow);
            border: 1px solid var(--border);
        }
        .logo-area img {
            width: 100%;
            height: 100%;
            object-fit: cover;
        }
        h1 {
            font-size: 28px;
            font-weight: 700;
            letter-spacing: -0.5px;
            background: linear-gradient(to right, #fff, #aaa);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .status-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: var(--glass);
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 12px;
            color: var(--primary);
            border: 1px solid var(--border);
            margin-top: 10px;
        }
        .status-dot {
            width: 6px;
            height: 6px;
            background: var(--primary);
            border-radius: 50%;
            box-shadow: 0 0 10px var(--primary);
        }
        .main-content {
            flex: 1;
            display: flex;
            flex-direction: column;
            justify-content: center;
            gap: 20px;
            animation: fadeIn 1s ease;
        }
        .input-wrapper {
            position: relative;
            background: var(--glass);
            border-radius: 16px;
            padding: 2px;
            transition: 0.3s;
        }
        .input-wrapper:focus-within {
            background: linear-gradient(90deg, var(--primary), transparent);
            box-shadow: 0 0 20px rgba(0, 255, 157, 0.1);
        }
        .input-inner {
            background: #0a0a0a;
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
            color: #fff;
            font-size: 18px;
            width: 100%;
            outline: none;
            font-family: 'Outfit', sans-serif;
        }
        input::placeholder {
            color: #333;
        }
        .action-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 15px;
            margin-top: 10px;
        }
        .btn {
            border: none;
            padding: 18px;
            border-radius: 16px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 8px;
            font-family: 'Outfit', sans-serif;
        }
        .btn-primary {
            background: var(--primary);
            color: #000;
            box-shadow: 0 5px 20px rgba(0, 255, 157, 0.2);
        }
        .btn-primary:active {
            transform: scale(0.96);
        }
        .btn-secondary {
            background: var(--glass);
            color: #fff;
            border: 1px solid var(--border);
        }
        .btn-secondary:active {
            background: rgba(255,255,255,0.1);
        }
        .output-area {
            background: #000;
            border: 1px solid var(--border);
            border-radius: 20px;
            padding: 20px;
            margin-top: 20px;
            text-align: center;
            display: none;
            animation: slideUp 0.4s ease;
        }
        .code-box {
            font-family: 'Courier New', monospace;
            font-size: 32px;
            color: var(--primary);
            letter-spacing: 4px;
            margin: 15px 0;
            font-weight: bold;
            text-shadow: 0 0 15px var(--primary-glow);
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
            border: 3px solid rgba(255,255,255,0.1);
            border-radius: 50%;
            border-top-color: var(--primary);
            animation: spin 0.8s linear infinite;
        }
        #qr-container {
            background: #fff;
            padding: 15px;
            border-radius: 12px;
            display: inline-block;
            margin-top: 15px;
        }
        .copy-hint {
            color: var(--text-muted);
            font-size: 12px;
            margin-top: 10px;
        }
        .notification {
            position: fixed;
            bottom: 30px;
            left: 50%;
            transform: translateX(-50%) translateY(100px);
            background: #1a1a1a;
            border: 1px solid var(--primary);
            color: var(--primary);
            padding: 12px 24px;
            border-radius: 50px;
            font-size: 14px;
            font-weight: 500;
            opacity: 0;
            transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            z-index: 100;
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        }
        .notification.show {
            transform: translateX(-50%) translateY(0);
            opacity: 1;
        }
        @keyframes spin { 100% { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes fadeInDown { from { opacity: 0; transform: translateY(-20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
    </style>
</head>
<body>
    <div class="app-container">
        <header class="header">
            <div class="logo-area">
                <img src="https://adamdh7.org/adamdh7.png" alt="Adam Logo" onerror="this.src='https://via.placeholder.com/80/00ff9d/000000?text=A'">
            </div>
            <h1>Bot.Adam_D'H7</h1>
            <div class="status-badge">
                <div class="status-dot"></div>
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
                <button class="btn btn-primary" onclick="handleAction('code')">
                    <i class="fas fa-key"></i>
                    <span>Code Pair</span>
                </button>
                <button class="btn btn-secondary" onclick="handleAction('qr')">
                    <i class="fas fa-qrcode"></i>
                    <span>Scan QR</span>
                </button>
            </div>

            <div class="loader-container" id="loader">
                <div class="spinner"></div>
            </div>

            <div class="output-area" id="output">
                <div id="qr-container" style="display:none;"></div>
                <div id="code-text" class="code-box" style="display:none;"></div>
                <div class="copy-hint" id="hint-text">Appuyez pour copier</div>
            </div>
        </main>
    </div>

    <div class="notification" id="notif"></div>

    <script>
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('./sw.js')
                    .then(() => console.log('SW Ready'))
                    .catch(err => console.log('SW Fail', err));
            });
        }

        const ui = {
            phone: document.getElementById('phone'),
            loader: document.getElementById('loader'),
            output: document.getElementById('output'),
            qr: document.getElementById('qr-container'),
            code: document.getElementById('code-text'),
            hint: document.getElementById('hint-text'),
            notif: document.getElementById('notif')
        };

        function showNotif(msg, isError = false) {
            ui.notif.textContent = msg;
            ui.notif.style.borderColor = isError ? '#ff4444' : '#00ff9d';
            ui.notif.style.color = isError ? '#ff4444' : '#00ff9d';
            ui.notif.classList.add('show');
            setTimeout(() => ui.notif.classList.remove('show'), 3000);
        }

        async function handleAction(type) {
            const number = ui.phone.value.replace(/[^0-9]/g, '');
            
            if (type === 'code' && number.length < 6) {
                showNotif('Numéro invalide', true);
                return;
            }

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
                    ui.hint.textContent = 'Appuyez sur le code pour copier';
                    ui.code.onclick = () => {
                        navigator.clipboard.writeText(data.code);
                        showNotif('Code copié dans le presse-papier');
                    };
                } else if (type === 'qr' && data.qr) {
                    ui.code.style.display = 'none';
                    ui.qr.style.display = 'inline-block';
                    new QRCode(ui.qr, {
                        text: data.qr,
                        width: 200,
                        height: 200
                    });
                    ui.hint.textContent = 'Scannez avec WhatsApp > Appareils liés';
                }

            } catch (e) {
                ui.loader.style.display = 'none';
                showNotif('Erreur de connexion', true);
            }
        }
    </script>
    <script src="https://pl28576790.effectivegatecpm.com/9b/ad/a1/9bada1e2e08256dd61b7915bfcd7e142.js"></script>
<script src="https://pl28576794.effectivegatecpm.com/8d/ef/89/8def89c1e5f244766adfce310401fdaf.js"></script>
</body>
</html>`;

app.get('/', (req, res) => res.send(htmlContent));

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const Adam_DH7 = "Adam_D'H7";
const logoPath = path.join(__dirname, 'adamdh7.png');
let adamLogoBuffer = null;

async function startAdamBot(sessionId) {
    const sessionDir = path.join(__dirname, 'auth_sessions', sessionId);
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();
    
    // --- MISE A JOUR : TEMPS DE DEMARRAGE ---
    // Enregistre l'heure (en secondes) à laquelle le bot démarre pour filtrer les vieux messages
    const botStartTime = Math.floor(Date.now() / 1000);
    
    // --- MISE A JOUR : STOCKAGE MEMOIRE DES ID TRAITES ---
    // Un Set simple pour stocker les IDs des messages déjà vus pendant cette session
    const processedIds = new Set();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })) },
        browser: Browsers.ubuntu('Chrome'),
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: true,
        msgRetryCounterCache,
        retryRequestDelayMs: 2000,
        getMessage: async (key) => {
            return { conversation: 'Message non chargé' };
        }
    });

    const sessionData = {
        sock: sock,
        qrString: null,
        ownerJid: null,
        noLienMode: {},
        bienvenueEnabled: {}
    };

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) sessionData.qrString = qr;
        if (connection === 'open') {
            const botId = sock.user.id.includes(':') ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : sock.user.id;
            sessionData.ownerJid = botId;
            console.log(`Session ${sessionId} connectée : ${sessionData.ownerJid}`);
        }
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) {
                console.log(`Déconnexion inattendue pour ${sessionId}, reconnexion dans 5 secondes...`);
                setTimeout(() => startAdamBot(sessionId), 5000);
            } else {
                try {
                    if (sessionId.startsWith('temp_')) {
                        fs.rmSync(sessionDir, { recursive: true, force: true });
                    }
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
            console.error(`[ERREUR WHATSAPP 500] Action: ${action} sur ${jid}`, e.message);
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
        const gmeta = await sock.groupMetadata(gjid);
        for (const user of newParts) {
            const welcomeText = `*○ Bienvenue*

*${Adam_DH7}*
Propriétaire: ${Adam_DH7}

@${user.split('@')[0]} *Bienvenue dans ${gmeta.subject}*

> D’H7 | Tergene`;
            await sock.sendMessage(gjid, { text: welcomeText, mentions: [user] });
        }
    });

    sock.ev.on('messages.upsert', async (up) => {
        try {
            const m = up.messages[0];
            if (!m.message || m.key.remoteJid === 'status@broadcast') return;

            // --- MISE A JOUR : VERIFICATION ANTI-DOUBLON ---
            // Si l'ID du message est déjà dans notre liste de traités, on arrête tout de suite.
            if (processedIds.has(m.key.id)) return;

            // --- MISE A JOUR : VERIFICATION DU TEMPS (IGNORE LES VIEUX MESSAGES) ---
            // Récupère le timestamp du message (en secondes)
            const messageTime = m.messageTimestamp.low || m.messageTimestamp; 
            // Si le message est plus vieux que le démarrage du bot (avec une marge de sécurité de 5s pour décalage), on l'ignore.
            if (messageTime < (botStartTime - 5)) {
                // On le marque quand même comme traité pour ne plus le vérifier
                processedIds.add(m.key.id);
                return;
            }

            // Si le message est valide (récent), on l'ajoute à la liste des traités
            processedIds.add(m.key.id);

            // Petit nettoyage du Set pour éviter qu'il ne grossisse indéfiniment (garde max 2000 IDs)
            if (processedIds.size > 2000) {
                 const iterator = processedIds.values();
                 processedIds.delete(iterator.next().value);
            }
            // ----------------------------------------------------

            const from = m.key.remoteJid;
            const pushName = m.pushName || 'Inconnu';
            const sender = m.key.participant || m.key.remoteJid;
            const body = (m.message.conversation || m.message.extendedTextMessage?.text || m.message.imageMessage?.caption || m.message.videoMessage?.caption || '').trim();
            const isGroup = from.endsWith('@g.us');
            let metadata = isGroup ? await sock.groupMetadata(from) : null;
            const isAdmin = isGroup ? metadata?.participants.some(p => p.id === sender && p.admin) : false;
            
            const botId = sock.user?.id ? (sock.user.id.includes(':') ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : sock.user.id) : null;
            const isOwner = sender === botId;
            
            const cmdRegex = /^([.]?)\s*([a-zA-Z0-9]+)(?:\s+(.*))?$/;
            const match = body.match(cmdRegex);

            if (isGroup && !match) {
                const textContent = m.message?.conversation || m.message?.extendedTextMessage?.text || m.message?.imageMessage?.caption || m.message?.videoMessage?.caption || m.message?.documentMessage?.caption || '';
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

            const command = match[2].toLowerCase();
            const args = match[3] ? match[3].trim() : '';
            
            const quoted = m.message?.extendedTextMessage?.contextInfo;
            const quotedMessage = quoted?.quotedMessage;

            switch (command) {
                case 'menu':
                    if (args.length > 0) break;
                    
                    const menuCaption = `*○ Menu*

*${Adam_DH7}*
Utilisateur: "${pushName}"
Propriétaire: ${Adam_DH7}

*● menu*
*○ qrbot*
*● qr*
*○code*

*○ lien*
*● tagall*
*○ hidetag*
*● kick*
*○ add*
*● promote*
*○ demote*
*● kickall*
*○ ferme*
*● ouvert*
*○ bienvenue*

*○ nolien*
*● nolien2*
*○ del*
*● vv*

> *${Adam_DH7}*`;

                    const menuOpts = {};
                    if (!adamLogoBuffer && fs.existsSync(logoPath)) {
                        adamLogoBuffer = fs.readFileSync(logoPath);
                    }
                    if (adamLogoBuffer) {
                        menuOpts.image = adamLogoBuffer;
                        menuOpts.caption = menuCaption;
                    } else {
                        menuOpts.text = menuCaption;
                    }
                    await sock.sendMessage(from, menuOpts);
                    break;

                case 'qr':
                    if (!args) break;
                    const qrBuffer = await QRCode.toBuffer(args);
                    await sock.sendMessage(from, { image: qrBuffer, caption: args });
                    break;

                case 'qrbot':
                    const tempId = `temp_${Date.now()}`;
                    const tempSessionPath = path.join(sessionDirRoot, tempId);
                    
                    const { state: tempState, saveCreds: tempSaveCreds } = await useMultiFileAuthState(tempSessionPath);
                    
                    const tempSock = makeWASocket({
                        version,
                        logger: pino({ level: 'silent' }),
                        printQRInTerminal: false,
                        auth: { creds: tempState.creds, keys: makeCacheableSignalKeyStore(tempState.keys, pino({ level: "silent" })) },
                        browser: Browsers.ubuntu('Chrome')
                    });

                    tempSock.ev.on('creds.update', tempSaveCreds);
                    
                    let qrSent = false;

                    tempSock.ev.on('connection.update', async (update) => {
                        const { qr, connection } = update;
                        
                        if (qr && !qrSent) {
                            qrSent = true;
                            try {
                                const qrbuf = await QRCode.toBuffer(qr);
                                await sock.sendMessage(from, { 
                                    image: qrbuf, 
                                    caption: `*○ Nouvelle Session Créée*\n\nScannez ce code pour connecter la nouvelle session.\n\n> ${Adam_DH7}` 
                                });
                            } catch (e) {
                                console.error(e);
                            }
                        }

                        if (connection === 'open') {
                            await sock.sendMessage(from, { text: `*○ Session Connectée*\n\nLa nouvelle session est active.\nID: ${tempSock.user.id.split(':')[0]}` });
                            const realId = tempSock.user.id.split(':')[0];
                            const realPath = path.join(sessionDirRoot, `session_${realId}`);
                            
                            tempSock.end(undefined);
                            
                            try {
                                if (fs.existsSync(realPath)) fs.rmSync(realPath, { recursive: true, force: true });
                                fs.renameSync(tempSessionPath, realPath);
                                startAdamBot(`session_${realId}`);
                            } catch (e) {
                                console.error('Erreur déplacement session', e);
                            }
                        }

                        if (connection === 'close') {
                            const code = update.lastDisconnect?.error?.output?.statusCode;
                            if (code === DisconnectReason.loggedOut) {
                                try { fs.rmSync(tempSessionPath, { recursive: true, force: true }); } catch {}
                            }
                        }
                    });
                    
                    setTimeout(() => {
                         if (!qrSent && !tempSock.user) {
                             tempSock.end(undefined);
                             try { fs.rmSync(tempSessionPath, { recursive: true, force: true }); } catch {}
                         }
                    }, 60000);
                    break;

                case 'lien':
                    if (!isGroup) break;
                    const code = await sock.groupInviteCode(from);
                    const link = `https://chat.whatsapp.com/${code}`;
                    const lienCaption = `*○ Lien*

*${Adam_DH7}*
Utilisateur: "${pushName}"
Propriétaire: ${Adam_DH7}

*${link}*

> ${Adam_DH7}`;

                    const lienOpts = { caption: lienCaption };
                    try {
                        const ppUrl = await sock.profilePictureUrl(from, 'image');
                        const response = await fetch(ppUrl);
                        const ppBuffer = Buffer.from(await response.arrayBuffer());
                        lienOpts.image = ppBuffer;
                    } catch {
                        if (!adamLogoBuffer && fs.existsSync(logoPath)) {
                            adamLogoBuffer = fs.readFileSync(logoPath);
                        }
                        if (adamLogoBuffer) {
                            lienOpts.image = adamLogoBuffer;
                        } else {
                            lienOpts.text = lienCaption;
                        }
                    }
                    await sock.sendMessage(from, lienOpts);
                    break;

                case 'tagall':
                    if (!isGroup || !isAdmin) break;
                    const participants = metadata.participants.map(p => p.id);
                    const tagCaption = `*○ Tagall*

*${Adam_DH7}*
Utilisateur: ${pushName}

${participants.map(p => `○ @${p.split('@')[0]}`).join('\n')}

> *${Adam_DH7}*`;

                    const tagOpts = { mentions: participants };
                    if (!adamLogoBuffer && fs.existsSync(logoPath)) {
                        adamLogoBuffer = fs.readFileSync(logoPath);
                    }
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
        const response = await fetch('https://dh7bot.onrender.com/get-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                number: args.replace(/[^0-9]/g, ''), 
                method: 'code' 
            })
        });
        const data = await response.json();
        if (data && data.code) {
            await sock.sendMessage(from, { text: data.code });
        }
    } catch (e) {
        console.error(e);
    }
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

                    if (Object.keys(msgOpts).length === 1) {
                        msgOpts.text = '‎';
                    } else if (hasMedia && !msgOpts.caption) {
                        msgOpts.caption = '‎';
                    }

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
                    await safeGroupUpdate(from, filteredTargets, actionMap[command]);
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

                    if (!isGroup) {
                        if (isQuotedBot) {
                            await sock.sendMessage(from, { delete: delKey });
                        }
                    } else {
                         if (!isAdmin) break;
                         
                         if (isQuotedBot) {
                             if (sender === botId) {
                                 await sock.sendMessage(from, { delete: delKey });
                             }
                         } else {
                             await sock.sendMessage(from, { delete: delKey });
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
                    await sock.sendMessage(from, sendOptsVO);
                    break;
            }
        } catch (e) { console.error(e); }
    });

    return sessionData;
}

const loadExistingSessions = async () => {
    if (!fs.existsSync(sessionDirRoot)) return;
    const dirs = fs.readdirSync(sessionDirRoot);
    const sessionDirs = dirs.filter(dir => {
        const fullPath = path.join(sessionDirRoot, dir);
        return fs.statSync(fullPath).isDirectory();
    });
    for (const sessionId of sessionDirs) {
        console.log(`Chargement de la session existante : ${sessionId}`);
        await startAdamBot(sessionId);
    }
};

app.post('/get-code', async (req, res) => {
    const { number, method } = req.body;
    if (!method || (method === 'code' && !number)) {
        return res.status(400).json({ error: 'Requête invalide' });
    }
    const sId = `session_${Date.now()}`;
    const sess = await startAdamBot(sId);
    
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
            console.error(e);
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

loadExistingSessions().catch(err => console.error('Erreur lors du chargement des sessions', err));
app.listen(PORT, () => console.log(`Serveur actif sur le port ${PORT}`));
