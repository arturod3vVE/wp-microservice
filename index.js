const { Client, RemoteAuth } = require('whatsapp-web.js');
const express = require('express');
const { PostgresStore } = require('wwebjs-postgres');
const QRCode = require('qrcode');

const app = express();
app.use(express.json());

let latestQr = null;
let isReady = false;

const dbConfig = {
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
};

const store = new PostgresStore({ connectionConfig: dbConfig });

const client = new Client({
    authStrategy: new RemoteAuth({
        store: store,
        backupSyncIntervalMs: 300000
    }),
    // FIJAR VERSIÓN: Evita que la librería intente "adivinar" la versión y refresque la página
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
            '--no-zygote',
            // ESTAS TRES LÍNEAS SOLUCIONAN EL ERROR "Execution context destroyed"
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process',
            '--disable-site-isolation-trials'
        ],
        executablePath: '/usr/bin/google-chrome-stable'
    }
});

client.on('qr', async (qr) => {
    isReady = false;
    latestQr = await QRCode.toDataURL(qr);
    console.log('✨ Nuevo QR generado.');
});

client.on('ready', () => {
    isReady = true;
    latestQr = null;
    console.log('✅ ¡WhatsApp Conectado!');
});

// Agregamos un log para ver si la sesión se recupera de la DB
client.on('remote_session_saved', () => {
    console.log('💾 Sesión guardada en Postgres');
});

app.get('/qr', (req, res) => {
    if (isReady) return res.send('<h1>✅ Conectado</h1>');
    if (latestQr) return res.send(`<img src="${latestQr}" style="width:300px;">`);
    res.send('Cargando... Refresca en 5 segundos.');
});

app.post('/send', async (req, res) => {
    if (!isReady) return res.status(503).json({ error: 'Offline' });
    try {
        await client.sendMessage(`${req.body.phone}@c.us`, req.body.message);
        res.json({ status: 'sent' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

client.initialize();
app.listen(process.env.PORT || 3000);