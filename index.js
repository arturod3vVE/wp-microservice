const { Client, RemoteAuth } = require('whatsapp-web.js');
const express = require('express');
const { PostgresStore } = require('wwebjs-postgres');
const { Client: PgClient } = require('pg');

const app = express();
app.use(express.json());

let pairingCode = null; // Aquí guardaremos el código de 8 dígitos
let isReady = false;

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
        // ESTO ES LO QUE SOLUCIONA EL ERROR:
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
                '--single-process'
            ],
            executablePath: '/usr/bin/google-chrome-stable'
        }
    });

    // 1. EVENTO QR: Si no quieres usar código, el QR sigue ahí en la consola
    client.on('qr', (qr) => {
        isReady = false;
        console.log('--- NUEVO QR DISPONIBLE ---');
    });

    client.on('ready', () => {
        isReady = true;
        pairingCode = null;
        console.log('✅ ¡WhatsApp Vinculado y Listo!');
    });

    // --- RUTA PARA PEDIR EL CÓDIGO DE TELÉFONO ---
    // Uso: https://tu-app.onrender.com/vincular?phone=584121234567
    app.get('/vincular', async (req, res) => {
        const phone = req.query.phone;
        
        if (!phone) {
            return res.send('Error: Debes poner tu número así: /vincular?phone=58412XXXXXXX');
        }

        if (isReady) return res.send('✅ Ya estás vinculado.');

        try {
            // Esta es la magia: pedimos el código de 8 dígitos al servidor de WhatsApp
            pairingCode = await client.requestPairingCode(phone);
            
            res.send(`
                <div style="text-align:center; font-family:sans-serif; margin-top:50px;">
                    <h1 style="color:#128c7e;">Código de Vinculación</h1>
                    <p>Introduce este código en tu teléfono:</p>
                    <div style="font-size:3rem; font-weight:bold; letter-spacing:5px; background:#e1f5fe; padding:20px; display:inline-block; border-radius:10px; border:2px solid #01579b;">
                        ${pairingCode}
                    </div>
                    <div style="margin-top:30px; text-align:left; display:inline-block; max-width:400px;">
                        <p><strong>Pasos en tu celular:</strong></p>
                        <ol>
                            <li>Abre WhatsApp.</li>
                            <li>Ajustes / Configuración.</li>
                            <li>Dispositivos vinculados.</li>
                            <li>Vincular un dispositivo.</li>
                            <li>Toca en <b>"Vincular con el número de teléfono"</b> (abajo).</li>
                            <li>Escribe el código de arriba.</li>
                        </ol>
                    </div>
                </div>
            `);
        } catch (err) {
            res.send('Error al generar código: ' + err.message);
        }
    });

    app.get('/status', (req, res) => {
        res.json({ connected: isReady });
    });

    app.post('/send', async (req, res) => {
        if (!isReady) return res.status(503).json({ error: 'WhatsApp Offline' });
        const { phone, message } = req.body;
        try {
            await client.sendMessage(`${phone}@c.us`, message);
            res.json({ status: 'ok' });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    client.initialize();
    app.listen(process.env.PORT || 3000, () => console.log('🚀 API Online'));
});