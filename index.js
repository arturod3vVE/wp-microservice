const { Client, RemoteAuth } = require('whatsapp-web.js');
const express = require('express');
const { PostgresStore } = require('wwebjs-postgres');
const QRCode = require('qrcode');

const app = express();
app.use(express.json());

let latestQr = null;
let isReady = false;

// 1. Configuración de la base de datos
const dbConfig = {
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
};

const store = new PostgresStore({ connectionConfig: dbConfig });

// 2. Cliente de WhatsApp con Persistencia
const client = new Client({
    authStrategy: new RemoteAuth({
        store: store,
        backupSyncIntervalMs: 300000
    }),
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

// 3. Captura del QR
client.on('qr', async (qr) => {
    isReady = false;
    console.log('✨ Nuevo QR generado. List para escanear.');
    // Convertimos el texto del QR en una imagen Base64 para mostrarla en la web
    latestQr = await QRCode.toDataURL(qr);
});

client.on('ready', () => {
    isReady = true;
    latestQr = null;
    console.log('✅ ¡WhatsApp Conectado Exitosamente!');
});

client.on('authenticated', () => console.log('🔓 Sesión Autenticada'));
client.on('auth_failure', (msg) => console.error('❌ Error de Autenticación:', msg));

// --- RUTAS WEB ---

// Página para ver el QR
app.get('/qr', (req, res) => {
    if (isReady) {
        return res.send(`
            <div style="text-align:center; font-family:sans-serif; margin-top:100px;">
                <h1 style="color:#128c7e;">✅ WhatsApp Conectado</h1>
                <p>Tu sistema de CrumbCore ya está operativo.</p>
                <a href="/status">Ver Estado</a>
            </div>
        `);
    }

    if (latestQr) {
        res.send(`
            <html>
                <head>
                    <meta http-equiv="refresh" content="20">
                    <title>Vincular WhatsApp - CrumbCore</title>
                    <style>
                        body { display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; font-family:sans-serif; background:#f0f2f5; margin:0; }
                        .card { background:white; padding:40px; border-radius:20px; box-shadow:0 10px 25px rgba(0,0,0,0.1); text-align:center; }
                        img { width:300px; margin:20px 0; border: 10px solid #fff; box-shadow: 0 0 10px rgba(0,0,0,0.05); }
                        .loader { color: #666; font-size: 0.9rem; }
                    </style>
                </head>
                <body>
                    <div class="card">
                        <h2 style="color:#128c7e;">Vincular WhatsApp</h2>
                        <p>Escanea este código desde WhatsApp > Dispositivos vinculados</p>
                        <img src="${latestQr}">
                        <p class="loader">La página se refresca automáticamente cada 20s...</p>
                    </div>
                </body>
            </html>
        `);
    } else {
        res.send(`
            <div style="text-align:center; font-family:sans-serif; margin-top:100px;">
                <h2>Cargando WhatsApp Web...</h2>
                <p>Espera unos segundos y refresca la página.</p>
                <script>setTimeout(() => location.reload(), 5000);</script>
            </div>
        `);
    }
});

app.get('/status', (req, res) => {
    res.json({ 
        connected: isReady, 
        message: isReady ? "WhatsApp is ready" : "WhatsApp is disconnected" 
    });
});

// Endpoint para que Django envíe mensajes
app.post('/send', async (req, res) => {
    if (!isReady) return res.status(503).json({ error: 'WhatsApp no está listo' });
    const { phone, message } = req.body;
    try {
        const chatId = `${phone}@c.us`;
        await client.sendMessage(chatId, message);
        res.json({ status: 'sent' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

client.initialize();
app.listen(process.env.PORT || 3000, () => console.log('🚀 Microservicio QR listo en Railway'));