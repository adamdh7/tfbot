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

app.get('/TF-:id', (req, res) => {
    tfEvents.emit('ok-' + req.params.id);
    res.redirect('https://www.profitablecpmratenetwork.com/ak0xgm6xu?key=96856a216ee758b70d6c8303e964e86b');
});

const htmlContent = `<!DOCTYPE html>
<html lang="ht">
<head>
    <script>
        if ((window.location.hostname === 'tf.bot.adamdh7.org' || window.location.hostname === 'dh7bot.onrender.com') && window.location.pathname === '/') {
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
        .info-text {
            font-size: 14px;
            line-height: 1.6;
            color: #cccccc;
            margin-bottom: 20px;
            text-align: justify;
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
        <div class="info-text tr-info-p1"></div>
        <div class="info-text tr-info-p2"></div>
        <div class="info-text tr-info-p3"></div>
        <div class="info-text tr-info-p4"></div>
        <div class="info-text tr-info-p5"></div>
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
            fr: {
                code: "Code Pair", qr: "Scan QR", copy: "Appuyez pour copier", menu: "Menu", 
                mlang: "Langues", minfo: "Info", mpoints: "Points", ltitle: "Langues", 
                ititle: "Info", pheader: "Tu as {x} points", clicks: "Clicks",
                err_num: "Numéro invalide", err_pts_code: "4 points requis pour le code",
                err_pts_qr: "3 points requis pour le qr", err_conn: "Erreur de connexion",
                succ_copy: "Copié", succ_pts: "+1 Point", qr_hint: "Scannez avec WhatsApp",
                info1: "Bienvenue sur le système de liaison. Cette interface permet de connecter votre appareil de manière stable pour profiter des fonctionnalités en toute simplicité.",
                info2: "Les sessions ont une durée de vie optimisée pour garantir sécurité et performance. Le système se charge de tout de façon transparente.",
                info3: "L'accès aux options nécessite des points : 4 points pour un Code Pair et 3 points pour un QR Code. Ce système garantit une utilisation équitable.",
                info4: "Pour obtenir vos points, cliquez sur le bouton de génération et restez sur la page affichée pendant au moins 7 secondes. Une exploration active valide votre point.",
                info5: "Une fois connecté, tapez la commande de menu pour découvrir une multitude d'outils inattendus et pratiques. Laissez-vous surprendre par tout ce que le bot a à offrir !"
            },
            en: {
                code: "Pair Code", qr: "Scan QR", copy: "Tap to copy", menu: "Menu", 
                mlang: "Languages", minfo: "Info", mpoints: "Points", ltitle: "Languages", 
                ititle: "Info", pheader: "You have {x} points", clicks: "Clicks",
                err_num: "Invalid number", err_pts_code: "4 points required for code",
                err_pts_qr: "3 points required for QR", err_conn: "Connection error",
                succ_copy: "Copied", succ_pts: "+1 Point", qr_hint: "Scan with WhatsApp",
                info1: "Welcome to the linking system. This interface connects your device securely to ensure a smooth and stable experience.",
                info2: "Sessions have an optimized lifespan for maximum security and performance. The system manages them gracefully.",
                info3: "Accessing features requires points: 4 for a Pair Code and 3 for a QR Code. This ensures fair usage for everyone.",
                info4: "To earn points, click the button and stay on the provided page for at least 7 seconds. Active browsing helps validate it.",
                info5: "Once connected, type the menu command to discover a variety of surprising and practical tools. We let you explore its full potential!"
            },
            es: {
                code: "Código Pair", qr: "Escanear QR", copy: "Toca para copiar", menu: "Menú", 
                mlang: "Idiomas", minfo: "Info", mpoints: "Puntos", ltitle: "Idiomas", 
                ititle: "Info", pheader: "Tienes {x} puntos", clicks: "Clics",
                err_num: "Número inválido", err_pts_code: "4 puntos requeridos para el código",
                err_pts_qr: "3 puntos requeridos para el QR", err_conn: "Error de conexión",
                succ_copy: "Copiado", succ_pts: "+1 Punto", qr_hint: "Escanea con WhatsApp",
                info1: "Bienvenido al sistema de vinculación. Esta interfaz conecta tu dispositivo de forma segura para una experiencia fluida.",
                info2: "Las sesiones tienen una duración optimizada para garantizar seguridad y rendimiento, gestionándose de forma automática.",
                info3: "El acceso requiere puntos: 4 para un Código Pair y 3 para un QR. Este sistema asegura un uso justo.",
                info4: "Para obtener puntos, haz clic y permanece en la página al menos 7 segundos. Navegar activamente asegura la validación.",
                info5: "Una vez conectado, usa el comando de menú para descubrir herramientas increíbles. ¡Te invitamos a explorar todo lo que ofrece!"
            },
            ht: {
                code: "Kòd Pè", qr: "Eskane QR", copy: "Klike pou kopye", menu: "Meni", 
                mlang: "Lang", minfo: "Enfòmasyon", mpoints: "Pwen", ltitle: "Lang", 
                ititle: "Enfòmasyon", pheader: "Ou gen {x} pwen", clicks: "Klike",
                err_num: "Nimewo pa bon", err_pts_code: "4 pwen nesesè pou kòd la",
                err_pts_qr: "3 pwen nesesè pou qr la", err_conn: "Erè koneksyon",
                succ_copy: "Kopye", succ_pts: "+1 Pwen", qr_hint: "Eskane ak WhatsApp",
                info1: "Byenveni sou sistèm koneksyon an. Entèfas sa a konekte aparèy ou an san pwoblèm pou yon bon eksperyans.",
                info2: "Sesyon yo gen yon dire ki fikse pou garanti sekirite w. Sistèm nan jere sa otomatikman.",
                info3: "Ou dwe gen pwen pou w itilize opsyon yo: 4 pwen pou Kòd Pè, 3 pwen pou QR. Sa pèmèt tout moun jwenn aksè.",
                info4: "Pou jwenn pwen, klike epi rete sou paj la pou pi piti 7 segonn. Navige sou li ap ede valide pwen an pi vit.",
                info5: "Lè w fin konekte, tape kòmand meni an pou w wè yon pakèt zouti ki ap siprann ou. Al dekouvri yo ou menm!"
            }
        };

        let currentLang = localStorage.getItem('lang');
        if (!currentLang) {
            const navL = navigator.language.slice(0, 2);
            currentLang = ['fr', 'en', 'es', 'ht'].includes(navL) ? navL : 'ht';
        }
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
            notif: document.getElementById('notif')
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
            document.querySelector('.tr-info-p1').textContent = t.info1;
            document.querySelector('.tr-info-p2').textContent = t.info2;
            document.querySelector('.tr-info-p3').textContent = t.info3;
            document.querySelector('.tr-info-p4').textContent = t.info4;
            document.querySelector('.tr-info-p5').textContent = t.info5;
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
let adamLogoBuffer = null;

async function startAdamBot(sessionId) {
    const sessionDir = path.join(__dirname, 'auth_sessions', sessionId);
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();
    const botStartTime = Math.floor(Date.now() / 1000);
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
            return { conversation: 'Damn' };
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
            setTimeout(() => {
                try {
                    fs.rmSync(sessionDir, { recursive: true, force: true });
                    sock.logout();
                } catch(e) {}
            }, 17 * 60 * 60 * 1000);
        }
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) {
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
            const welcomeText = `*○ Bienvenue*\n\n*${Adam_DH7}*\nPropriétaire: ${Adam_DH7}\n\n@${user.split('@')[0]} *Bienvenue dans ${gmeta.subject}*\n\n> D’H7 | Tergene`;
            await sock.sendMessage(gjid, { text: welcomeText, mentions: [user] });
        }
    });

    sock.ev.on('messages.upsert', async (up) => {
        try {
            const m = up.messages[0];
            if (!m.message || m.key.remoteJid === 'status@broadcast') return;
            if (processedIds.has(m.key.id)) return;
            const messageTime = m.messageTimestamp.low || m.messageTimestamp; 
            if (messageTime < (botStartTime - 5)) {
                processedIds.add(m.key.id);
                return;
            }
            processedIds.add(m.key.id);
            if (processedIds.size > 2000) {
                 const iterator = processedIds.values();
                 processedIds.delete(iterator.next().value);
            }

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
                    const menuCaption = `*○ Menu*\n\n*${Adam_DH7}*\nUtilisateur: "${pushName}"\nPropriétaire: ${Adam_DH7}\n\n*● menu*\n*○ qrbot*\n*● qr*\n*○ code*\n\n*○ lien*\n*● tagall*\n*○ hidetag*\n*● kick*\n*○ add*\n*● promote*\n*○ demote*\n*● kickall*\n*○ ferme*\n*● ouvert*\n*○ bienvenue*\n\n*○ nolien*\n*● nolien2*\n*○ del*\n*● vv*\n\n> *${Adam_DH7}*`;
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
                                await sock.sendMessage(from, { image: qrbuf, caption: `*○ Nouvelle Session Créée*\n\nScannez ce code pour connecter la nouvelle session.\n\n> ${Adam_DH7}` });
                            } catch (e) {}
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
                            } catch (e) {}
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
                    const c = await sock.groupInviteCode(from);
                    const link = `https://chat.whatsapp.com/${c}`;
                    const lienCaption = `*○ Lien*\n\n*${Adam_DH7}*\nUtilisateur: "${pushName}"\nPropriétaire: ${Adam_DH7}\n\n*${link}*\n\n> ${Adam_DH7}`;
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
                    const tagCaption = `*○ Tagall*\n\n*${Adam_DH7}*\nUtilisateur: ${pushName}\n\n${participants.map(p => `○ @${p.split('@')[0]}`).join('\n')}\n\n> *${Adam_DH7}*`;
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
                        const response = await fetch('https://tf.bot.adamdh7.org/get-code', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ number: args.replace(/[^0-9]/g, ''), method: 'code' })
                        });
                        const data = await response.json();
                        if (data && data.code) {
                            const tfid = Math.floor(1000000 + Math.random() * 9000000);
                            const confirmLink = `https://tf.bot.adamdh7.org/TF-${tfid}`;
                            const msgConfirmation = await sock.sendMessage(from, { text: `Veuillez autoriser l'envoi du code en cliquant ici :\n${confirmLink}` });
                            tfEvents.once('ok-' + tfid, async () => {
                                await sock.sendMessage(from, { delete: msgConfirmation.key });
                                await sock.sendMessage(from, { text: data.code });
                            });
                        }
                    } catch (e) {}
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
        } catch (e) {}
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

loadExistingSessions().catch(e => {});
app.listen(PORT);
