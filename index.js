const { Client, RemoteAuth } = require('whatsapp-web.js');
const express = require('express');
const { PostgresStore } = require('wwebjs-postgres');
const { Client: PgClient } = require('pg');

const app = express();
app.use(express.json());

let isReady = false;

const dbConfig = {
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
};

const pgClient = new PgClient(dbConfig);

pgClient.connect().then(() => {
    console.log('✅ Base de datos conectada');
    const store = new PostgresStore({ client: pgClient });

    const client = new Client({
        authStrategy: new RemoteAuth({
            store: store,
            backupSyncIntervalMs: 300000
        }),
        // Forzamos una versión de WA Web que sabemos que funciona con códigos
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
                // USER AGENT: Engañamos a WhatsApp para que crea que somos un Chrome real en Windows
                '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
            ],
            executablePath: '/usr/bin/google-chrome-stable'
        }
    });

    client.on('ready', () => {
        isReady = true;
        console.log('✅ ¡WhatsApp Conectado!');
    });

    // RUTA DE VINCULACIÓN MEJORADA
    app.get('/vincular', async (req, res) => {
        const phone = req.query.phone;
        if (!phone) return res.send('Falta el número: /vincular?phone=58412XXXXXXX');
        if (isReady) return res.send('✅ Ya estás conectado.');

        console.log(`⏳ Generando código para ${phone}...`);

        try {
            // TRUCO: Esperamos 5 segundos antes de pedir el código para que la página "respire"
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            const code = await client.requestPairingCode(phone);
            
            res.send(`
                <div style="text-align:center; font-family:sans-serif; margin-top:50px;">
                    <h1 style="color:#128c7e;">Código de Vinculación</h1>
                    <div style="font-size:3rem; font-weight:bold; letter-spacing:5px; background:#e1f5fe; padding:20px; display:inline-block; border-radius:10px; border:2px solid #01579b;">
                        ${code}
                    </div>
                    <p style="margin-top:20px;">Introdúcelo en tu WhatsApp (Dispositivos vinculados > Vincular con número)</p>
                </div>
            `);
        } catch (err) {
            console.error('Error detallado:', err);
            res.send(`
                <div style="text-align:center; font-family:sans-serif; margin-top:50px;">
                    <h2 style="color:red;">Error de sincronización</h2>
                    <p>WhatsApp rechazó la petición (Error: ${err.message}).</p>
                    <p><b>Causa probable:</b> El servidor gratuito de Render es lento para cargar la interfaz.</p>
                    <button onclick="location.reload()">Reintentar ahora</button>
                </div>
            `);
        }
    });

    app.post('/send', async (req, res) => {
        if (!isReady) return res.status(503).json({ error: 'Offline' });
        try {
            await client.sendMessage(`${req.body.phone}@c.us`, req.body.message);
            res.json({ status: 'ok' });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    client.initialize();
    app.listen(process.env.PORT || 3000);
});