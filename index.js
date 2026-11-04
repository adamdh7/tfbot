const express = require('express');
const app = express();
const pino = require('pino');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    DisconnectReason,
    delay
} = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- SECTION 1 : INTERFACE UTILISATEUR (HTML/CSS/JS) ---
const htmlContent = `
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Adam_D’H7 Bot Linker</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
    <style>
        body {
            background-color: #0d0d0d;
            color: #e0e0e0;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            flex-direction: column;
        }
        .container {
            background-color: #1a1a1a;
            padding: 40px;
            border-radius: 15px;
            box-shadow: 0 0 20px rgba(0, 255, 127, 0.1);
            text-align: center;
            max-width: 400px;
            width: 100%;
            border: 1px solid #333;
        }
        h2 { margin-bottom: 20px; color: #fff; font-weight: 600; }
        p { font-size: 14px; color: #aaa; margin-bottom: 25px; }
        .input-group { margin-bottom: 20px; text-align: left; }
        label { font-size: 12px; color: #00ff7f; display: block; margin-bottom: 5px; text-transform: uppercase; }
        input[type="text"] {
            width: 100%; padding: 12px; background-color: #252525;
            border: 1px solid #333; border-radius: 8px; color: #fff;
            font-size: 16px; outline: none; transition: border-color 0.3s;
        }
        input[type="text"]:focus { border-color: #00ff7f; }
        button {
            width: 100%; padding: 12px; background-color: #00ff7f;
            color: #000; border: none; border-radius: 8px; font-size: 16px;
            font-weight: bold; cursor: pointer; transition: transform 0.2s; margin-top: 10px;
        }
        button:hover { background-color: #00cc66; transform: translateY(-2px); }
        button.secondary { background-color: #333; color: #fff; }
        button.secondary:hover { background-color: #444; }
        
        #result-area { margin-top: 30px; display: none; }
        .code-display {
            font-family: 'Courier New', monospace; font-size: 24px; letter-spacing: 3px;
            color: #00ff7f; background: #000; padding: 15px; border-radius: 8px;
            border: 1px dashed #00ff7f; margin-top: 10px; word-break: break-all;
        }
        #qr-area { 
            margin-top: 20px; display: none; justify-content: center; 
            background: #fff; padding: 10px; border-radius: 8px;
        }
        .loader {
            border: 3px solid #f3f3f3; border-radius: 50%; border-top: 3px solid #00ff7f;
            width: 20px; height: 20px; animation: spin 1s linear infinite;
            display: inline-block; vertical-align: middle; margin-left: 10px;
        }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    </style>
</head>
<body>

    <div class="container">
        <h2>Link Device</h2>
        <p>Entrez votre numéro pour le Code ou laissez vide pour le QR.</p>
        
        <div class="input-group">
            <label>Numéro de téléphone</label>
            <input type="text" id="phoneNumber" placeholder="Ex: 33612345678">
        </div>

        <button id="submitBtn" onclick="startProcess('code')">Obtenir Code de Jumelage</button>
        <button id="qrBtn" class="secondary" onclick="startProcess('qr')">Afficher QR Code</button>

        <div id="result-area">
            <div id="text-instruction" class="instructions">Entrez ce code sur WhatsApp :</div>
            <div id="codeDisplay" class="code-display"></div>
        </div>

        <div id="qr-area"></div>
    </div>

    <script>
        async function startProcess(type) {
            const phoneInput = document.getElementById('phoneNumber');
            const resultArea = document.getElementById('result-area');
            const codeDisplay = document.getElementById('codeDisplay');
            const qrArea = document.getElementById('qr-area');
            const btn = document.getElementById('submitBtn');
            const qrBtn = document.getElementById('qrBtn');

            // Reset UI
            resultArea.style.display = 'none';
            qrArea.style.display = 'none';
            qrArea.innerHTML = ""; // Clear old QR

            let number = phoneInput.value.replace(/[^0-9]/g, "");

            if (type === 'code' && number.length < 5) {
                alert("Veuillez entrer un numéro valide.");
                return;
            }

            // UI Loading
            if (type === 'code') btn.innerHTML = 'Génération... <div class="loader"></div>';
            else qrBtn.innerHTML = 'Chargement QR... <div class="loader"></div>';

            try {
                const response = await fetch('/get-code', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ number: (type === 'code' ? number : ""), method: type })
                });

                const data = await response.json();

                // Gestion Code
                if (data.code) {
                    codeDisplay.innerText = data.code;
                    document.getElementById('text-instruction').innerText = "Entrez ce code sur WhatsApp :";
                    resultArea.style.display = 'block';
                } 
                
                // Gestion QR Code
                if (data.qr) {
                    qrArea.style.display = 'flex';
                    // Génération du QR via la librairie JS
                    new QRCode(document.getElementById("qr-area"), {
                        text: data.qr,
                        width: 180,
                        height: 180
                    });
                }

                if (data.error) {
                    alert("Erreur: " + data.error);
                }

            } catch (error) {
                console.error(error);
                alert("Erreur serveur.");
            } finally {
                btn.innerHTML = 'Obtenir Code de Jumelage';
                qrBtn.innerHTML = 'Afficher QR Code';
            }
        }
    </script>
</body>
</html>
`;

app.get('/', (req, res) => {
    res.send(htmlContent);
});

// --- SECTION 2 : LOGIQUE BAILEYS ---

let sock;
let qrString = null; // Stocker le QR string temporairement

async function startBot(phoneNumber, res = null, method = 'code') {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false, // On gère le QR manuellement pour le frontend
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
        },
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        markOnlineOnConnect: true,
    });

    // 1. Si on veut le Pairing Code
    if (method === 'code' && phoneNumber && !sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(phoneNumber);
                if (res) res.json({ code: code?.match(/.{1,4}/g)?.join("-") || code });
            } catch (e) {
                if (res) res.json({ error: "Erreur Pairing" });
            }
        }, 3000);
    } 
    
    // 2. Si on veut le QR Code (Pas de numéro)
    // On écoute l'event update pour choper le QR string
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            qrString = qr; // Sauvegarde le string QR
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('Connexion établie !');
        }
    });

    // Petite attente pour envoyer le QR si c'est la méthode demandée
    if (method === 'qr' && !sock.authState.creds.registered) {
        setTimeout(() => {
            if (qrString) {
                if (res) res.json({ qr: qrString });
            } else {
                if (res) res.json({ error: "QR pas encore prêt, réessayez." });
            }
        }, 4000);
    } else if (res && sock.authState.creds.registered) {
        res.json({ error: "Déjà connecté !" });
    }

    sock.ev.on('creds.update', saveCreds);

    // --- SECTION 3 : RÉPONSE PARTOUT ---
    
    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg.message) return;
            
            // NOTE: msg.key.fromMe n'est PAS filtré, donc il répond à tes propres messages aussi.

            const type = Object.keys(msg.message)[0];
            const body = (type === 'conversation') ? msg.message.conversation :
                         (type === 'imageMessage') ? msg.message.imageMessage.caption :
                         (type === 'videoMessage') ? msg.message.videoMessage.caption :
                         (type === 'extendedTextMessage') ? msg.message.extendedTextMessage.text : '';

            const text = body.toLowerCase().trim();
            
            // Commande Menu
            if (text === 'menu' || text === '.menu') {
                await sock.sendMessage(msg.key.remoteJid, { 
                    text: "It’s me Adam_D’H7" 
                }, { quoted: msg });
            }

        } catch (e) {
            console.log("Erreur message:", e);
        }
    });
}

// Endpoint unique
app.post('/get-code', async (req, res) => {
    const { number, method } = req.body;
    
    // Si méthode QR, on s'assure que le socket est lancé pour générer le QR
    // Si méthode Code, on lance avec le numéro
    await startBot(number, res, method);
});

app.listen(PORT, () => {
    console.log(`Serveur UI lancé sur http://localhost:${PORT}`);
    startBot(); // Lancement initial
});
