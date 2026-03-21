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
        // Forzamos una versión específica que es famosa por ser estable con códigos
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
                '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
            ],
            executablePath: '/usr/bin/google-chrome-stable'
        }
    });

    client.on('ready', () => {
        isReady = true;
        console.log('✅ ¡WhatsApp Conectado!');
    });

    app.get('/vincular', async (req, res) => {
        const phone = req.query.phone;
        if (!phone) return res.send('Falta el número.');
        if (isReady) return res.send('✅ Ya estás conectado.');

        console.log(`⏳ Iniciando vinculación para ${phone}...`);

        try {
            // 1. ESPERA ACTIVA: Esperamos a que el selector del QR o el botón de vincular existan
            const page = client.pupPage;
            if (page) {
                console.log('📡 Esperando que WhatsApp Web cargue el DOM...');
                await page.waitForSelector('canvas', { timeout: 60000 }).catch(() => console.log('Timeout canvas, procediendo...'));
            }

            // 2. PEQUEÑO DELAY EXTRA: Para que los scripts internos se asienten
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            console.log('📲 Solicitando código...');
            const code = await client.requestPairingCode(phone);
            
            res.send(`
                <div style="text-align:center; font-family:sans-serif; margin-top:50px;">
                    <h1 style="color:#128c7e;">Código de Vinculación</h1>
                    <div style="font-size:3.5rem; font-weight:bold; background:#e1f5fe; padding:20px; display:inline-block; border-radius:10px; border:3px solid #01579b; font-family:monospace;">
                        ${code}
                    </div>
                    <p style="margin-top:20px;">Introduce este código en tu WhatsApp ahora.</p>
                </div>
            `);
        } catch (err) {
            console.error('Error capturado:', err.message);
            res.send(`
                <div style="text-align:center; font-family:sans-serif; margin-top:50px;">
                    <h2 style="color:orange;">☕ El servidor está procesando...</h2>
                    <p>WhatsApp devolvió un error temporal (${err.message}).</p>
                    <p><b>Qué hacer:</b> Espera 10 segundos y presiona el botón "Reintentar".</p>
                    <button onclick="location.reload()" style="padding:15px 30px; background:#128c7e; color:white; border:none; border-radius:5px; cursor:pointer; font-size:1.1rem;">
                        🔄 REINTENTAR VINCULACIÓN
                    </button>
                </div>
            `);
        }
    });

    client.initialize();
    app.listen(process.env.PORT || 3000);
});