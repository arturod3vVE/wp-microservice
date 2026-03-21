const { Client, RemoteAuth } = require('whatsapp-web.js');
const express = require('express');
const { PostgresStore } = require('wwebjs-postgres');
const { Client: PgClient } = require('pg');

const app = express();
app.use(express.json());

let isReady = false;

// 1. Configuración de la base de datos
const dbConfig = {
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
};

const pgClient = new PgClient(dbConfig);

// Conectamos a Postgres
pgClient.connect().then(() => {
    console.log('✅ Base de datos conectada');

    // CORRECCIÓN AQUÍ: Usamos connectionConfig en lugar de client
    const store = new PostgresStore({ 
        connectionConfig: dbConfig 
    });

    const client = new Client({
        authStrategy: new RemoteAuth({
            store: store,
            backupSyncIntervalMs: 300000
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
                '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
            ],
            executablePath: '/usr/bin/google-chrome-stable'
        }
    });

    client.on('ready', () => {
        isReady = true;
        console.log('✅ ¡WhatsApp Conectado!');
    });

    // RUTA DE VINCULACIÓN (Con delay para evitar Error 't')
    app.get('/vincular', async (req, res) => {
        const phone = req.query.phone;
        if (!phone) return res.send('Falta el número: /vincular?phone=58412XXXXXXX');
        if (isReady) return res.send('✅ Ya estás conectado.');

        console.log(`⏳ Generando código para ${phone}...`);

        try {
            // Esperamos 5 segundos para que WhatsApp Web cargue bien
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            const code = await client.requestPairingCode(phone);
            
            res.send(`
                <div style="text-align:center; font-family:sans-serif; margin-top:50px;">
                    <h1 style="color:#128c7e;">Código de Vinculación</h1>
                    <div style="font-size:3rem; font-weight:bold; letter-spacing:5px; background:#e1f5fe; padding:20px; display:inline-block; border-radius:10px; border:2px solid #01579b;">
                        ${code}
                    </div>
                    <p style="margin-top:20px; color:#666;">Introduce este código en tu WhatsApp:</p>
                    <p><b>Dispositivos vinculados > Vincular con número de teléfono</b></p>
                    <button onclick="location.reload()" style="margin-top:20px; padding:10px; cursor:pointer;">Generar otro código</button>
                </div>
            `);
        } catch (err) {
            console.error('Error detallado:', err);
            res.send(`<h2>Error: ${err.message}</h2><p>Intenta refrescar la página en 10 segundos.</p>`);
        }
    });

    app.post('/send', async (req, res) => {
        if (!isReady) return res.status(503).json({ error: 'WhatsApp Offline' });
        try {
            await client.sendMessage(`${req.body.phone}@c.us`, req.body.message);
            res.json({ status: 'ok' });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    client.initialize();
    app.listen(process.env.PORT || 3000, () => console.log('🚀 Microservicio escuchando...'));

}).catch(err => {
    console.error('❌ Error al conectar a la DB:', err);
});