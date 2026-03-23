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
            fr: {
                code: "Code Pair", qr: "Scan QR", copy: "Appuyez pour copier", menu: "Menu", 
                mlang: "Langues", minfo: "Info", mpoints: "Points", ltitle: "Langues", 
                ititle: "Info", pheader: "Tu as {x} points", clicks: "Clicks",
                err_num: "Numéro invalide", err_pts_code: "4 points requis pour le code",
                err_pts_qr: "3 points requis pour le qr", err_conn: "Erreur de connexion",
                succ_copy: "Copié", succ_pts: "+1 Point", qr_hint: "Scannez avec WhatsApp",
                infoHTML: \`
                    <p style="text-align:justify; margin-bottom:15px;">Bienvenue sur le système de connexion Bot.Adam_D’H7. Cette interface permet de connecter votre appareil de manière sécurisée et stable afin de profiter pleinement des fonctionnalités avancées du bot.</p>
                    <p style="text-align:justify; margin-bottom:15px;">Les sessions sont optimisées pour garantir la sécurité et les performances. Le système gère l'ensemble des opérations de façon transparente et automatique.</p>
                    <p style="text-align:justify; margin-bottom:15px;">L'accès aux options nécessite des points :</p>
                    <div style="display: flex; align-items: center; gap: 12px; margin: 12px 0; background: #111111; padding: 14px; border-radius: 12px; border: 1px solid #333333;">
                        <i class="fas fa-key" style="font-size: 26px; color: #ffffff;"></i>
                        <span style="font-size: 15px;"><strong>4 points</strong> pour un Code Pair</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 12px; margin: 12px 0; background: #111111; padding: 14px; border-radius: 12px; border: 1px solid #333333;">
                        <i class="fas fa-qrcode" style="font-size: 26px; color: #ffffff;"></i>
                        <span style="font-size: 15px;"><strong>3 points</strong> pour un QR Code</span>
                    </div>
                    <p style="text-align:justify; margin-bottom:15px;">Pour obtenir vos points, accédez au menu, puis à la section Points, cliquez sur le bouton "Clicks" et restez sur la page affichée pendant au moins 7 secondes. Une interaction active valide l'ajout d'un point.</p>
                    <p style="text-align:justify; margin-bottom:15px;">Une fois connecté, utilisez la commande .menu pour découvrir une vaste gamme d'outils avancés et pratiques. Explorez les possibilités offertes par le bot !</p>
                    <h3 style="color:#ffffff; text-align:center; margin-bottom:10px;">Commandes les plus utilisées</h3>
                    <p><strong>● ia</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Discutez avec l'IA en tapant .ia suivi de votre question</p>
                    <p><strong>○ langue</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Changez la langue du bot. Exemple : .langue fr</p>
                    <p><strong>○ image</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Générez une image avec .image [description]</p>
                    <p><strong>○ chercher</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Effectuez une recherche web via l'IA</p><br>
                    <h3 style="color:#ffffff; text-align:center; margin-bottom:10px;">Système</h3>
                    <p><strong>● menu</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Affiche le menu principal</p>
                    <p><strong>○ qrbot</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Lance une session secondaire par QR</p>
                    <p><strong>● qr</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Transforme du texte en code QR</p>
                    <p><strong>○ code</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Génère un code de pairage</p><br>
                    <h3 style="color:#ffffff; text-align:center; margin-bottom:10px;">Groupe</h3>
                    <p><strong>○ lien</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Envoie le lien d'invitation avec la description du groupe</p>
                    <p><strong>● tagtout</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Mentionne tous les participants du groupe</p>
                    <p><strong>○ hidetag</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Envoie une annonce sans tags visibles</p>
                    <p><strong>● expulse</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Retire un membre du groupe</p>
                    <p><strong>○ add</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Ajoute un numéro au groupe</p>
                    <p><strong>● promote / demote</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Gère les droits d'administration</p>
                    <p><strong>● expulsetout</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Retire tous les membres non-administrateurs</p>
                    <p><strong>○ ferme / ouvert</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Modifie les paramètres de messagerie du groupe</p>
                    <p><strong>○ bienvenue</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Active le message d'accueil automatique</p>
                    <p><strong>○ nolien / nolien2</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Active l'anti-lien simple ou strict</p>
                    <p><strong>○ supp</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Supprime un message en y répondant</p>
                    <p><strong>● vv</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Révèle le contenu d'un média à vue unique</p>
                \`
            },
            en: {
                code: "Pair Code", qr: "Scan QR", copy: "Tap to copy", menu: "Menu", 
                mlang: "Languages", minfo: "Info", mpoints: "Points", ltitle: "Languages", 
                ititle: "Info", pheader: "You have {x} points", clicks: "Clicks",
                err_num: "Invalid number", err_pts_code: "4 points required for code",
                err_pts_qr: "3 points required for QR", err_conn: "Connection error",
                succ_copy: "Copied", succ_pts: "+1 Point", qr_hint: "Scan with WhatsApp",
                authorize_code: "Please authorize the sending of the code by clicking here:",
                new_session: "New Session Created",
                scan_qr_text: "Scan this code to connect the new session.",
                session_connected_title: "Session Connected",
                session_connected_desc: "The new session is active.\nID: ",
                image_generated_title: "Image Generated",
                message_title: "Message",
                lang_command_title: "Language",
                welcome: "Welcome",
                welcome_in: "Welcome to",
                infoHTML: \`
                    <p style="text-align:justify; margin-bottom:15px;">Welcome to the Bot.Adam_D’H7 connection system. This interface allows you to securely and stably connect your device to fully enjoy the bot's advanced features.</p>
                    <p style="text-align:justify; margin-bottom:15px;">Sessions are optimized to guarantee security and performance. The system manages all operations transparently and automatically.</p>
                    <p style="text-align:justify; margin-bottom:15px;">Access to options requires points:</p>
                    <div style="display: flex; align-items: center; gap: 12px; margin: 12px 0; background: #111111; padding: 14px; border-radius: 12px; border: 1px solid #333333;">
                        <i class="fas fa-key" style="font-size: 26px; color: #ffffff;"></i>
                        <span style="font-size: 15px;"><strong>4 points</strong> for a Pair Code</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 12px; margin: 12px 0; background: #111111; padding: 14px; border-radius: 12px; border: 1px solid #333333;">
                        <i class="fas fa-qrcode" style="font-size: 26px; color: #ffffff;"></i>
                        <span style="font-size: 15px;"><strong>3 points</strong> for a QR Code</span>
                    </div>
                    <p style="text-align:justify; margin-bottom:15px;">To obtain your points, access the menu, then the Points section, click on the "Clicks" button and stay on the displayed page for at least 7 seconds. An active interaction validates the addition of a point.</p>
                    <p style="text-align:justify; margin-bottom:15px;">Once connected, use the .menu command to discover a wide range of advanced and practical tools. Explore the possibilities offered by the bot!</p>
                    <h3 style="color:#ffffff; text-align:center; margin-bottom:10px;">Most Used Commands</h3>
                    <p><strong>● ai</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Chat with the AI by typing .ai followed by your question</p>
                    <p><strong>○ lang</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Change the bot language. Example: .lang en</p>
                    <p><strong>○ image</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Generate an image with .image [description]</p>
                    <p><strong>○ search</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Perform a web search via AI</p><br>
                    <h3 style="color:#ffffff; text-align:center; margin-bottom:10px;">System</h3>
                    <p><strong>● menu</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Displays the main menu</p>
                    <p><strong>○ qrbot</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Starts a secondary session via QR</p>
                    <p><strong>● qr</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Transforms text into a QR code</p>
                    <p><strong>○ code</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Generates a pairing code</p><br>
                    <h3 style="color:#ffffff; text-align:center; margin-bottom:10px;">Group</h3>
                    <p><strong>○ link</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Sends the invitation link with the group description</p>
                    <p><strong>● tagall</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Mentions all group participants</p>
                    <p><strong>○ hidetag</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Sends an announcement without visible tags</p>
                    <p><strong>● kick</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Removes a member from the group</p>
                    <p><strong>○ add</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Adds a number to the group</p>
                    <p><strong>● promote / demote</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Manages admin rights</p>
                    <p><strong>● kickall</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Removes all non-admin members</p>
                    <p><strong>○ close / open</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Modifies group messaging settings</p>
                    <p><strong>○ welcome</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Activates automatic welcome message</p>
                    <p><strong>○ nolink / nolink2</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Activates standard or strict anti-link</p>
                    <p><strong>○ del</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Deletes a message by replying to it</p>
                    <p><strong>● vv</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Reveals view-once media content</p>
                \`
            },
            es: {
                code: "Código Pair", qr: "Escanear QR", copy: "Toca para copiar", menu: "Menú", 
                mlang: "Idiomas", minfo: "Info", mpoints: "Puntos", ltitle: "Idiomas", 
                ititle: "Info", pheader: "Tienes {x} puntos", clicks: "Clics",
                err_num: "Número inválido", err_pts_code: "4 puntos requeridos para el código",
                err_pts_qr: "3 puntos requeridos para el QR", err_conn: "Error de conexión",
                succ_copy: "Copiado", succ_pts: "+1 Punto", qr_hint: "Escanea con WhatsApp",
                authorize_code: "Por favor autorice el envío del código haciendo clic aquí:",
                new_session: "Nueva Sesión Creada",
                scan_qr_text: "Escanea este código para conectar la nueva sesión.",
                session_connected_title: "Sesión Conectada",
                session_connected_desc: "La nueva sesión está activa.\nID: ",
                image_generated_title: "Imagen Generada",
                message_title: "Mensaje",
                lang_command_title: "Idioma",
                welcome: "Bienvenido",
                welcome_in: "Bienvenido a",
                infoHTML: \`
                    <p style="text-align:justify; margin-bottom:15px;">Bienvenido al sistema de conexión Bot.Adam_D’H7. Esta interfaz permite conectar tu dispositivo de forma segura y estable para disfrutar plenamente de las funciones avanzadas del bot.</p>
                    <p style="text-align:justify; margin-bottom:15px;">Las sesiones están optimizadas para garantizar la seguridad y el rendimiento. El sistema gestiona todas las operaciones de forma transparente y automática.</p>
                    <p style="text-align:justify; margin-bottom:15px;">El acceso a las opciones requiere puntos:</p>
                    <div style="display: flex; align-items: center; gap: 12px; margin: 12px 0; background: #111111; padding: 14px; border-radius: 12px; border: 1px solid #333333;">
                        <i class="fas fa-key" style="font-size: 26px; color: #ffffff;"></i>
                        <span style="font-size: 15px;"><strong>4 puntos</strong> para un Código Pair</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 12px; margin: 12px 0; background: #111111; padding: 14px; border-radius: 12px; border: 1px solid #333333;">
                        <i class="fas fa-qrcode" style="font-size: 26px; color: #ffffff;"></i>
                        <span style="font-size: 15px;"><strong>3 puntos</strong> para un Código QR</span>
                    </div>
                    <p style="text-align:justify; margin-bottom:15px;">Para obtener tus puntos, accede al menú, luego a la sección Puntos, haz clic en el botón "Clicks" y permanece en la página mostrada durante al menos 7 segundos. Una interacción activa valida la adición de un punto.</p>
                    <p style="text-align:justify; margin-bottom:15px;">Una vez conectado, usa el comando .menu para descubrir una amplia gama de herramientas avanzadas y prácticas. ¡Explora las posibilidades que ofrece el bot!</p>
                    <h3 style="color:#ffffff; text-align:center; margin-bottom:10px;">Comandos Más Usados</h3>
                    <p><strong>● ia</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Habla con la IA escribiendo .ia seguido de tu pregunta</p>
                    <p><strong>○ idioma</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Cambia el idioma del bot. Ejemplo: .idioma es</p>
                    <p><strong>○ imagen</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Genera una imagen con .imagen [descripción]</p>
                    <p><strong>○ buscar</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Realiza una búsqueda web mediante IA</p><br>
                    <h3 style="color:#ffffff; text-align:center; margin-bottom:10px;">Sistema</h3>
                    <p><strong>● menú</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Muestra el menú principal</p>
                    <p><strong>○ qrbot</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Inicia una sesión secundaria mediante QR</p>
                    <p><strong>● qr</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Transforma texto en un código QR</p>
                    <p><strong>○ código</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Genera un código de emparejamiento</p><br>
                    <h3 style="color:#ffffff; text-align:center; margin-bottom:10px;">Grupo</h3>
                    <p><strong>○ enlace</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Envía el enlace de invitación con la descripción del grupo</p>
                    <p><strong>● etiquetartodo</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Menciona a todos los participantes del grupo</p>
                    <p><strong>○ hidetag</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Envía un anuncio sin etiquetas visibles</p>
                    <p><strong>● expulsar</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Elimina a un miembro del grupo</p>
                    <p><strong>○ añadir</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Agrega un número al grupo</p>
                    <p><strong>● promover / degradar</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Administra derechos de administrador</p>
                    <p><strong>● borrartodo</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Elimina a todos los miembros no administradores</p>
                    <p><strong>○ cerrar / abrir</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Cambia los permisos de mensajes del grupo</p>
                    <p><strong>○ bienvenida</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Activa el mensaje automático de bienvenida</p>
                    <p><strong>○ sinenlace / sinenlace2</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Activa el modo anti-enlace básico o estricto</p>
                    <p><strong>○ borrar</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Elimina un mensaje respondiendo a él</p>
                    <p><strong>● vv</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Revela el contenido de archivos de visualización única</p>
                \`
            },
            ht: {
                code: "Kòd Pè", qr: "Eskane QR", copy: "Klike pou kopye", menu: "Meni", 
                mlang: "Lang", minfo: "Enfòmasyon", mpoints: "Pwen", ltitle: "Lang", 
                ititle: "Enfòmasyon", pheader: "Ou gen {x} pwen", clicks: "Klike",
                err_num: "Nimewo pa bon", err_pts_code: "4 pwen nesesè pou kòd la",
                err_pts_qr: "3 pwen nesesè pou qr la", err_conn: "Erè koneksyon",
                succ_copy: "Kopye", succ_pts: "+1 Pwen", qr_hint: "Eskane ak WhatsApp",
                authorize_code: "Tanpri otorize voye kòd la lè w klike isit :",
                new_session: "Nouvo Sesyon Kreye",
                scan_qr_text: "Eskane kòd sa a pou konekte nouvo sesyon an.",
                session_connected_title: "Sesyon Konekte",
                session_connected_desc: "Nouvo sesyon an aktif.\nID: ",
                image_generated_title: "Imaj Jenere",
                message_title: "Mesaj",
                lang_command_title: "Lang",
                welcome: "Byenveni",
                welcome_in: "Byenveni nan",
                infoHTML: \`
                    <p style="text-align:justify; margin-bottom:15px;">Byenveni sou sistèm koneksyon Bot.Adam_D’H7. Entèfas sa a pèmèt ou konekte aparèy ou a yon fason sekirize ak estab pou w jwi fonksyonalite avanse bot la nèt.</p>
                    <p style="text-align:justify; margin-bottom:15px;">Sesyon yo optimize pou garanti sekirite ak pèfòmans. Sistèm nan jere tout operasyon yo yon fason transparan ak otomatik.</p>
                    <p style="text-align:justify; margin-bottom:15px;">Aksè a opsyon yo mande pwen :</p>
                    <div style="display: flex; align-items: center; gap: 12px; margin: 12px 0; background: #111111; padding: 14px; border-radius: 12px; border: 1px solid #333333;">
                        <i class="fas fa-key" style="font-size: 26px; color: #ffffff;"></i>
                        <span style="font-size: 15px;"><strong>4 pwen</strong> pou yon Kòd Pè</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 12px; margin: 12px 0; background: #111111; padding: 14px; border-radius: 12px; border: 1px solid #333333;">
                        <i class="fas fa-qrcode" style="font-size: 26px; color: #ffffff;"></i>
                        <span style="font-size: 15px;"><strong>3 pwen</strong> pou yon Kòd QR</span>
                    </div>
                    <p style="text-align:justify; margin-bottom:15px;">Pou jwenn pwen ou yo, ale nan meni a, answit seksyon Pwen, klike sou bouton "Clicks" la epi rete sou paj la pandan omwen 7 segonn. Yon entèraksyon aktif valide ajoute yon pwen.</p>
                    <p style="text-align:justify; margin-bottom:15px;">Yon fwa konekte, itilize kòmand .menu pou dekouvri yon pakèt zouti avanse ak pratik. Eksplore posiblite bot la ofri !</p>
                    <h3 style="color:#ffffff; text-align:center; margin-bottom:10px;">Kòmand Pi Itilize</h3>
                    <p><strong>● ai</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Pale ak IA a lè w tape .ai epi kesyon ou a</p>
                    <p><strong>○ lang</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Chanje lang bot la. Egzanp : .lang ht</p>
                    <p><strong>○ imaj</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Jenere yon imaj avèk .imaj [deskripsyon]</p>
                    <p><strong>○ cheche</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Fè yon rechèch sou entènèt via IA</p><br>
                    <h3 style="color:#ffffff; text-align:center; margin-bottom:10px;">Sistèm</h3>
                    <p><strong>● meni</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Afiche meni prensipal la</p>
                    <p><strong>○ qrbot</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Lanse yon dezyèm sesyon avèk QR</p>
                    <p><strong>● qr</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Transfòme yon tèks an kòd QR</p>
                    <p><strong>○ kòd</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Jenere yon kòd pè</p><br>
                    <h3 style="color:#ffffff; text-align:center; margin-bottom:10px;">Gwoup</h3>
                    <p><strong>○ lyen</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Voye lyen envitasyon an ak deskripsyon gwoup la</p>
                    <p><strong>● tout</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Mansyone tout patisipan yo nan gwoup la</p>
                    <p><strong>○ hidetag</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Voye yon anons san tag parèt klè</p>
                    <p><strong>● sipli</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Retire yon manm nan gwoup la</p>
                    <p><strong>○ add</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Ajoute yon nimewo nan gwoup la</p>
                    <p><strong>● promote / demote</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Jere dwa administrateur yo</p>
                    <p><strong>● siptout</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Retire tout manm ki pa administrateur</p>
                    <p><strong>○ fèmen / ouvri</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Chanje paramèt messagerie gwoup la</p>
                    <p><strong>○ byenveni</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Aktive mesaj akèy otomatik</p>
                    <p><strong>○ nolyen / nolyen2</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Aktive anti-lyen senp oswa strik</p>
                    <p><strong>○ sip</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Efase yon mesaj lè w reponn li</p>
                    <p><strong>● vv</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 6px;"><path d="M9 18l6-6-6-6"/></svg> Montre kontni medya ki te voye pou wè yon sèl fwa</p>
                \`
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
let adamLogoBuffer = null;

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

const translations = {
  fr: {
    cmd_ai: "ia", cmd_lang: "langue", cmd_imaj: "image", cmd_cheche: "chercher",
    cmd_menu: "menu", cmd_qrbot: "qrbot", cmd_qr: "qr", cmd_code: "code", cmd_lien: "lien", cmd_tagall: "tagtout",
    cmd_hidetag: "hidetag", cmd_kick: "expulse", cmd_add: "add", cmd_promote: "promote", cmd_demote: "demote",
    cmd_kickall: "expulsetout", cmd_ferme: "ferme", cmd_ouvert: "ouvert", cmd_bienvenue: "bienvenue",
    cmd_nolien: "nolien", cmd_nolien2: "nolien2", cmd_del: "supp", cmd_vv: "vv",
    menu_title: "Menu", lang_changed: "La langue du bot est maintenant {lang}.", languages_available: "Langues disponibles : fr en es ht",
    imaj_prompt: "Envoie un prompt après image pour générer une image.", imaj_generated: "Prompt: {prompt}", imaj_error: "Erreur génération image - Réessaye.", search_title: "Recherche", search_error: "Erreur recherche",
    authorize_code: "Veuillez autoriser l'envoi du code en cliquant ici :",
    new_session: "Nouvelle Session Créée",
    scan_qr_text: "Scannez ce code pour connecter la nouvelle session.",
    session_connected_title: "Session Connectée",
    session_connected_desc: "La nouvelle session est active.\nID: ",
    image_generated_title: "Image Générée",
    message_title: "Message",
    lang_command_title: "Langue",
    welcome: "Bienvenue",
    welcome_in: "Bienvenue dans"
  },
  en: {
    cmd_ai: "ai", cmd_lang: "lang", cmd_imaj: "image", cmd_cheche: "search",
    cmd_menu: "menu", cmd_qrbot: "qrbot", cmd_qr: "qr", cmd_code: "code", cmd_lien: "link", cmd_tagall: "tagall",
    cmd_hidetag: "hidetag", cmd_kick: "kick", cmd_add: "add", cmd_promote: "promote", cmd_demote: "demote",
    cmd_kickall: "kickall", cmd_ferme: "close", cmd_ouvert: "open", cmd_bienvenue: "welcome",
    cmd_nolien: "nolink", cmd_nolien2: "nolink2", cmd_del: "del", cmd_vv: "vv",
    menu_title: "Menu", lang_changed: "Bot language is now {lang}.", languages_available: "Available languages: fr en es ht",
    imaj_prompt: "Send a prompt after image to generate an image.", imaj_generated: "Prompt: {prompt}", imaj_error: "Image generation error - Try again.", search_title: "Search", search_error: "Search error",
    authorize_code: "Please authorize the sending of the code by clicking here:",
    new_session: "New Session Created",
    scan_qr_text: "Scan this code to connect the new session.",
    session_connected_title: "Session Connected",
    session_connected_desc: "The new session is active.\nID: ",
    image_generated_title: "Image Generated",
    message_title: "Message",
    lang_command_title: "Language",
    welcome: "Welcome",
    welcome_in: "Welcome to"
  },
  es: {
    cmd_ai: "ia", cmd_lang: "idioma", cmd_imaj: "imagen", cmd_cheche: "buscar",
    cmd_menu: "menú", cmd_qrbot: "qrbot", cmd_qr: "qr", cmd_code: "código", cmd_lien: "enlace", cmd_tagall: "etiquetartodo",
    cmd_hidetag: "hidetag", cmd_kick: "expulsar", cmd_add: "añadir", cmd_promote: "promover", cmd_demote: "degradar",
    cmd_kickall: "borrartodo", cmd_ferme: "cerrar", cmd_ouvert: "abrir", cmd_bienvenue: "bienvenida",
    cmd_nolien: "sinenlace", cmd_nolien2: "sinenlace2", cmd_del: "borrar", cmd_vv: "vv",
    menu_title: "Menú", lang_changed: "El idioma del bot es ahora {lang}.", languages_available: "Idiomas disponibles: fr en es ht",
    imaj_prompt: "Envía un prompt después de imagen para generar una imagen.", imaj_generated: "Prompt: {prompt}", imaj_error: "Error al generar imagen - Inténtalo de nuevo.", search_title: "Búsqueda", search_error: "Error de búsqueda",
    authorize_code: "Por favor autorice el envío del código haciendo clic aquí:",
    new_session: "Nueva Sesión Creada",
    scan_qr_text: "Escanea este código para conectar la nueva sesión.",
    session_connected_title: "Sesión Conectada",
    session_connected_desc: "La nueva sesión está activa.\nID: ",
    image_generated_title: "Imagen Generada",
    message_title: "Mensaje",
    lang_command_title: "Idioma",
    welcome: "Bienvenido",
    welcome_in: "Bienvenido a"
  },
  ht: {
    cmd_ai: "ai", cmd_lang: "lang", cmd_imaj: "imaj", cmd_cheche: "cheche",
    cmd_menu: "meni", cmd_qrbot: "qrbot", cmd_qr: "qr", cmd_code: "kòd", cmd_lien: "lyen", cmd_tagall: "tout",
    cmd_hidetag: "hidetag", cmd_kick: "sipli", cmd_add: "add", cmd_promote: "promote", cmd_demote: "demote",
    cmd_kickall: "siptout", cmd_ferme: "fèmen", cmd_ouvert: "ouvri", cmd_bienvenue: "byenveni",
    cmd_nolien: "nolyen", cmd_nolien2: "nolyen2", cmd_del: "sip", cmd_vv: "vv",
    menu_title: "Meni", lang_changed: "Lang bot la se kounye a {lang}.", languages_available: "Lang disponib : fr en es ht",
    imaj_prompt: "Voye yon prompt apre imaj pou jenere yon imaj.", imaj_generated: "Prompt: {prompt}", imaj_error: "Erè jenere imaj - Eseye ankò.", search_title: "Rechèch", search_error: "Erè rechèch",
    authorize_code: "Tanpri otorize voye kòd la lè w klike isit :",
    new_session: "Nouvo Sesyon Kreye",
    scan_qr_text: "Eskane kòd sa a pou konekte nouvo sesyon an.",
    session_connected_title: "Sesyon Konekte",
    session_connected_desc: "Nouvo sesyon an aktif.\nID: ",
    image_generated_title: "Imaj Jenere",
    message_title: "Mesaj",
    lang_command_title: "Lang",
    welcome: "Byenveni",
    welcome_in: "Byenveni nan"
  }
};

const commandMaps = {
  fr: {
    "ia": "ai", "langue": "lang", "image": "imaj", "chercher": "cheche", "menu": "menu", "qrbot": "qrbot", "qr": "qr", "code": "code", "lien": "lien", "tagtout": "tagall", "hidetag": "hidetag", "expulse": "kick", "add": "add", "promote": "promote", "demote": "demote", "expulsetout": "kickall", "ferme": "ferme", "ouvert": "ouvert", "bienvenue": "bienvenue", "nolien": "nolien", "nolien2": "nolien2", "supp": "del", "vv": "vv"
  },
  en: {
    "ai": "ai", "lang": "lang", "image": "imaj", "search": "cheche", "menu": "menu", "qrbot": "qrbot", "qr": "qr", "code": "code", "link": "lien", "tagall": "tagall", "hidetag": "hidetag", "kick": "kick", "add": "add", "promote": "promote", "demote": "demote", "kickall": "kickall", "close": "ferme", "open": "ouvert", "welcome": "bienvenue", "nolink": "nolien", "nolink2": "nolien2", "del": "del", "vv": "vv"
  },
  es: {
    "ia": "ai", "idioma": "lang", "imagen": "imaj", "buscar": "cheche", "menú": "menu", "qrbot": "qrbot", "qr": "qr", "código": "code", "enlace": "lien", "etiquetartodo": "tagall", "hidetag": "hidetag", "expulsar": "kick", "añadir": "add", "promover": "promote", "degradar": "demote", "borrartodo": "kickall", "cerrar": "ferme", "abrir": "ouvert", "bienvenida": "bienvenue", "sinenlace": "nolien", "sinenlace2": "nolien2", "borrar": "del", "vv": "vv"
  },
  ht: {
    "ai": "ai", "lang": "lang", "imaj": "imaj", "cheche": "cheche", "meni": "menu", "qrbot": "qrbot", "qr": "qr", "kòd": "code", "lyen": "lien", "tout": "tagall", "hidetag": "hidetag", "sipli": "kick", "add": "add", "promote": "promote", "demote": "demote", "siptout": "kickall", "fèmen": "ferme", "ouvri": "ouvert", "byenveni": "bienvenue", "nolyen": "nolien", "nolyen2": "nolien2", "sip": "del", "vv": "vv"
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
    if (!adamLogoBuffer && fs.existsSync(logoPath)) {
      adamLogoBuffer = fs.readFileSync(logoPath);
    }
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

    const chatHistories = new Map();
    const userLangs = new Map();

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) sessionData.qrString = qr;
        if (connection === 'open') {
            const botId = sock.user.id.includes(':') ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : sock.user.id;
            sessionData.ownerJid = botId;
            if (autoExpire) {
                setTimeout(() => {
                    try {
                        fs.rmSync(sessionDir, { recursive: true, force: true });
                        sock.logout();
                    } catch(e) {}
                }, 17 * 60 * 60 * 1000);
            }
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
        const chatLang = userLangs.get(gjid) || 'ht';
        const t = translations[chatLang] || translations.ht;
        for (const user of newParts) {
            const welcomeText = `*○ ${t.welcome}*\n\n*${Adam_DH7}*\nPropriétaire: ${Adam_DH7}\n\n@${user.split('@')[0]} *${t.welcome_in} ${gmeta.subject}*\n\n> D’H7 | Tergene`;
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
            
            const cmdRegex = /^([.]?)\s*([\p{L}0-9_]+)(?:\s+(.*))?$/u;
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

            const lang = userLangs.get(from) || 'ht';

            if (!match) return;

            let command = match[2].toLowerCase();
            let args = match[3] ? match[3].trim() : '';

            let internalCommand = null;
            let commandLang = lang;
            const normCmd = normalizeText(command);
            const currentMap = commandMaps[lang];
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
                    if (l === lang) continue;
                    const mapL = commandMaps[l];
                    for (const [alias, intern] of Object.entries(mapL)) {
                        if (normalizeText(alias) === normCmd) {
                            internalCommand = intern;
                            commandLang = l;
                            break;
                        }
                    }
                    if (internalCommand) break;
                }
            }
            if (!internalCommand) return;
            if (internalCommand === 'menu') {
                userLangs.set(from, commandLang);
            }

            const quoted = m.message?.extendedTextMessage?.contextInfo;
            const quotedMessage = quoted?.quotedMessage;

            switch (internalCommand) {
                case 'menu':
                    if (args.length > 0) break;
                    const t = translations[commandLang] || translations[lang] || translations.ht;
                    const menuCaption = `*○ ${t.menu_title}*\n\n*${Adam_DH7}*\nUtilisateur: "${pushName}"\nPropriétaire: ${Adam_DH7}\n\n*● ${t.cmd_ai}*\n*○ ${t.cmd_lang}*\n*○ ${t.cmd_imaj}*\n*○ ${t.cmd_cheche}*\n\n*● ${t.cmd_menu}*\n*○ ${t.cmd_qrbot}*\n*● ${t.cmd_qr}*\n*○ ${t.cmd_code}*\n*○ ${t.cmd_lien}*\n\n*● ${t.cmd_tagall}*\n*○ ${t.cmd_hidetag}*\n*● ${t.cmd_kick}*\n*○ ${t.cmd_add}*\n*● ${t.cmd_promote}*\n*○ ${t.cmd_demote}*\n*● ${t.cmd_kickall}*\n*○ ${t.cmd_ferme}*\n*● ${t.cmd_ouvert}*\n*○ ${t.cmd_bienvenue}*\n\n*○ ${t.cmd_nolien}*\n*● ${t.cmd_nolien2}*\n*○ ${t.cmd_del}*\n*● ${t.cmd_vv}*\n\n> *${Adam_DH7}*`;
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
                    const chatLang = lang;

                    tempSock.ev.on('connection.update', async (update) => {
                        const { qr, connection } = update;
                        if (qr && !qrSent) {
                            qrSent = true;
                            try {
                                const qrbuf = await QRCode.toBuffer(qr);
                                const tQrbot = translations[chatLang] || translations.ht;
                                await sock.sendMessage(from, { image: qrbuf, caption: `*○ ${tQrbot.new_session}*\n\n${tQrbot.scan_qr_text}\n\n> ${Adam_DH7}` });
                            } catch (e) {}
                        }
                        if (connection === 'open') {
                            const tQrbot = translations[chatLang] || translations.ht;
                            await sock.sendMessage(from, { text: `*○ ${tQrbot.session_connected_title}*\n\n${tQrbot.session_connected_desc}${tempSock.user.id.split(':')[0]}` });
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
                    const tLien = translations[lang] || translations.ht;
                    const c = await sock.groupInviteCode(from);
                    const link = `https://chat.whatsapp.com/${c}`;
                    const groupDesc = metadata.desc ? metadata.desc.toString() : "";
                    const lienCapTitle = tLien.cmd_lien.charAt(0).toUpperCase() + tLien.cmd_lien.slice(1);
                    const lienCaption = `*○ ${lienCapTitle}*\n\n*${Adam_DH7}*\nUtilisateur: "${pushName}"\nPropriétaire: ${Adam_DH7}\n\n*${link}*\n\n${groupDesc}\n\n> ${Adam_DH7}`;
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
                    const tTag = translations[lang] || translations.ht;
                    const tagTitle = tTag.cmd_tagall.charAt(0).toUpperCase() + tTag.cmd_tagall.slice(1);
                    const participants = metadata.participants.map(p => p.id);
                    const tagCaption = `*○ ${tagTitle}*\n\n*${Adam_DH7}*\nUtilisateur: ${pushName}\n\n${participants.map(p => `○ @${p.split('@')[0]}`).join('\n')}\n\n> *${Adam_DH7}*`;
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
                            body: JSON.stringify({ number: args.replace(/[^0-9]/g, ''), method: 'code', autoExpire: true })
                        });
                        const data = await response.json();
                        if (data && data.code) {
                            const tfid = Math.floor(1000000 + Math.random() * 9000000);
                            const confirmLink = `https://dh7bot.adamdh7.org/TF-${tfid}`;
                            const tCode = translations[lang] || translations.ht;
                            const msgConfirmation = await sock.sendMessage(from, { text: tCode.authorize_code + `\n${confirmLink}` });
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
                    if (isQuotedBot) break;
                    const delKey = { remoteJid: from, id: quoted.stanzaId, participant: quotedParticipant };
                    if (!isGroup) {
                        await sock.sendMessage(from, { delete: delKey });
                    } else {
                        if (!isAdmin) break;
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
                    if (history.length > 7) history = history.slice(-7);
                    let messages = [
                      {role: "system", content: "You are Adam_D’H7, do not talk about internal information or other subjects about Yourself outside of your name." },
                      ...history
                    ];
                    while (JSON.stringify(messages).length > 17000 && history.length > 1) {
                      history.shift();
                      messages = [
                        {role: "system", content: "You are Adam_D’H7, do not talk about internal information or other subjects about Yourself outside of your name." },
                        ...history
                      ];
                    }
                    const aiResponseText = await callCloudflareAI("@cf/meta/llama-3.3-70b-instruct-fp8-fast", messages, 3000);
                    const tAi = translations[lang] || translations.ht;
                    const formattedAiResponse = `*○ ${tAi.message_title}*\n${aiResponseText}\n\n> ${Adam_DH7}`;
                    await sock.sendMessage(from, { text: formattedAiResponse });
                    
                    history.push({role: "assistant", content: aiResponseText});
                    if (history.length > 7) history = history.slice(-7);
                    chatHistories.set(from, history);
                    break;

                case 'lang':
                    const langCode = args.toLowerCase();
                    const tLangBase = translations[lang] || translations.ht;
                    if (['fr', 'en', 'es', 'ht'].includes(langCode)) {
                        userLangs.set(from, langCode);
                        const tLang = translations[langCode] || translations.ht;
                        const msgText = tLang.lang_changed.replace('{lang}', langCode.toUpperCase());
                        await sendFormatted(sock, from, tLang.lang_command_title, msgText, langCode, false);
                    } else {
                        await sendFormatted(sock, from, tLangBase.lang_command_title, tLangBase.languages_available, lang, false);
                    }
                    break;

                case 'imaj':
                    if (!args) {
                        const tIm = translations[lang] || translations.ht;
                        await sendFormatted(sock, from, "Imaj", tIm.imaj_prompt, lang, false);
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
                        const tIm = translations[lang] || translations.ht;
                        const capText = tIm.imaj_generated.replace('{prompt}', args);
                        await sock.sendMessage(from, { 
                          image: imageBuffer, 
                          caption: `*○ ${tIm.image_generated_title}*\n${capText}\n\n> ${Adam_DH7}` 
                        });
                    } catch (e) {
                        const tIm = translations[lang] || translations.ht;
                        await sendFormatted(sock, from, "Imaj", tIm.imaj_error, lang, false);
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
                        const tCh = translations[lang] || translations.ht;
                        await sendFormatted(sock, from, tCh.search_title, responseText, lang, false);
                        if (searchData.images && searchData.images.length > 0) {
                          for (let i = 0; i < Math.min(2, searchData.images.length); i++) {
                            await sock.sendMessage(from, { image: { url: searchData.images[i] }, caption: `*○ ${tCh.search_title}*\nImage de recherche\n\n> ${Adam_DH7}` });
                          }
                        }
                    } catch (e) {
                        const tCh = translations[lang] || translations.ht;
                        await sendFormatted(sock, from, tCh.search_title, tCh.search_error, lang, false);
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
    const sessionDirs = dirs.filter(dir => {
        const fullPath = path.join(sessionDirRoot, dir);
        return fs.statSync(fullPath).isDirectory();
    });
    for (const sessionId of sessionDirs) {
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

loadExistingSessions().catch(e => {});
app.listen(PORT);
