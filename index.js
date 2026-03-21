const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const QRCode = require('qrcode');

const app = express();
app.use(express.json());

let latestQr = null;
let isReady = false;

// Usamos LocalAuth apuntando al Volumen de Railway
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: '/app/whatsapp_session' // <--- Ruta de tu disco duro virtual
    }),
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
    },
    puppeteer: {
        handleSIGINT: false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--single-process',
            '--no-zygote'
        ],
        executablePath: '/usr/bin/google-chrome-stable'
    }
});

client.on('qr', async (qr) => {
    isReady = false;
    latestQr = await QRCode.toDataURL(qr);
    console.log('✨ Nuevo QR generado. Listo para escanear en /qr');
});

client.on('ready', () => {
    isReady = true;
    latestQr = null;
    console.log('✅ ¡WhatsApp Conectado y sesión guardada en el disco!');
});

client.on('authenticated', () => {
    console.log('🔓 Autenticación exitosa');
});

client.on('auth_failure', (msg) => {
    console.error('❌ Error de Autenticación:', msg);
});

// --- RUTAS ---
app.get('/qr', (req, res) => {
    if (isReady) {
        return res.send(`
            <div style="text-align:center; font-family:sans-serif; margin-top:100px;">
                <h1 style="color:#128c7e;">✅ WhatsApp Conectado</h1>
                <p>Tu sistema de CrumbCore ya está operativo.</p>
            </div>
        `);
    }

    if (latestQr) {
        res.send(`
            <html>
                <head>
                    <meta http-equiv="refresh" content="15">
                    <style>
                        body { display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; font-family:sans-serif; background:#f0f2f5; }
                        .card { background:white; padding:40px; border-radius:20px; box-shadow:0 10px 25px rgba(0,0,0,0.1); text-align:center; }
                        img { width:300px; margin:20px 0; border: 5px solid #fff; outline: 1px solid #ddd; }
                    </style>
                </head>
                <body>
                    <div class="card">
                        <h2 style="color:#128c7e;">Vincular WhatsApp</h2>
                        <img src="${latestQr}">
                        <p>La página se refresca sola cada 15s</p>
                    </div>
                </body>
            </html>
        `);
    } else {
        res.send('<h2 style="text-align:center; margin-top:50px;">Cargando... recarga en 5 segs.</h2>');
    }
});

app.post('/send', async (req, res) => {
    if (!isReady) return res.status(503).json({ error: 'WhatsApp Offline' });
    try {
        await client.sendMessage(`${req.body.phone}@c.us`, req.body.message);
        res.json({ status: 'sent' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

client.initialize();
app.listen(process.env.PORT || 3000, () => console.log('🚀 Microservicio QR iniciado'));