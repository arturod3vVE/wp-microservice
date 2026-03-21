const { Client, RemoteAuth } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const express = require('express');
const { PostgresStore } = require('wwebjs-postgres');
const { Client: PgClient } = require('pg');

const app = express();
app.use(express.json());

let latestQrImage = null;
let isReady = false; // Nueva variable para saber si ya estamos listos

const dbConfig = {
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
};

const pgClient = new PgClient(dbConfig);

pgClient.connect().then(() => {
    console.log('✅ Base de datos conectada');

    const store = new PostgresStore({ connectionConfig: dbConfig });

    const client = new Client({
        authStrategy: new RemoteAuth({
            store: store,
            backupSyncIntervalMs: 300000
        }),
        // OPTIMIZACIÓN DE PUPPETEER PARA RENDER FREE
        puppeteer: {
            handleSIGINT: false,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-extensions',
                '--no-first-run',
                '--no-zygote',
                '--single-process', // Crucial para ahorrar RAM en Render
            ],
            executablePath: '/usr/bin/google-chrome-stable'
        }
    });

    client.on('qr', async (qr) => {
        isReady = false;
        qrcodeTerminal.generate(qr, { small: true });
        try {
            latestQrImage = await QRCode.toDataURL(qr);
            console.log('✨ QR Actualizado - Listo para escaneo');
        } catch (err) {
            console.error('Error QR:', err);
        }
    });

    client.on('ready', () => {
        latestQrImage = null;
        isReady = true;
        console.log('✅ ¡WhatsApp Vinculado!');
    });

    // PÁGINA /QR OPTIMIZADA
    app.get('/qr', (req, res) => {
        if (isReady) {
            return res.send(`
                <div style="text-align:center; font-family:sans-serif; margin-top:100px;">
                    <h1 style="color:#128c7e;">✅ WhatsApp Conectado</h1>
                    <p>El sistema está operativo para CrumbCore.</p>
                </div>
            `);
        }

        if (latestQrImage) {
            res.send(`
                <html>
                    <head>
                        <meta http-equiv="refresh" content="15">
                        <style>
                            body { display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; font-family:sans-serif; background:#f0f2f5; margin:0; }
                            .card { background:white; padding:30px; border-radius:15px; box-shadow:0 4px 15px rgba(0,0,0,0.1); text-align:center; }
                            img { width:280px; border: 5px solid white; outline: 1px solid #ddd; }
                        </style>
                    </head>
                    <body>
                        <div class="card">
                            <h2 style="color:#128c7e; margin-bottom:5px;">Escanear Ahora</h2>
                            <p style="color:#666; font-size:0.9rem;">Refrescando automáticamente cada 15s...</p>
                            <img src="${latestQrImage}">
                            <p style="font-size:0.8rem; color:#999;">Si el teléfono dice "No se pudo vincular", espera el próximo refresco.</p>
                        </div>
                    </body>
                </html>
            `);
        } else {
            res.send('<div style="text-align:center; margin-top:100px;"><h3>Cargando navegador... espera 10 segundos y refresca.</h3></div>');
        }
    });

    app.post('/send', async (req, res) => {
        if (!isReady) return res.status(503).json({ error: 'WhatsApp no está listo' });
        const { phone, message } = req.body;
        try {
            await client.sendMessage(`${phone}@c.us`, message);
            res.status(200).json({ status: 'sent' });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    client.initialize();
    app.listen(process.env.PORT || 3000, () => console.log('🚀 Microservicio Online'));
});