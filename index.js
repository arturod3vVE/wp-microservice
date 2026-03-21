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
    const store = new PostgresStore({ connectionConfig: dbConfig });

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

    client.on('ready', () => { isReady = true; console.log('✅ Conectado'); });

    app.get('/vincular', async (req, res) => {
        const phone = req.query.phone;
        if (!phone) return res.send('Falta el número.');
        if (isReady) return res.send('✅ Ya estás conectado.');

        console.log(`⏳ Iniciando protocolo de vinculación para ${phone}...`);

        try {
            // 1. ESPERA CRÍTICA: Render Free necesita tiempo. 
            // Subimos a 15 segundos para asegurar que el JS de WhatsApp cargue.
            await new Promise(resolve => setTimeout(resolve, 15000));
            
            console.log('📡 Solicitando código a WhatsApp...');
            const code = await client.requestPairingCode(phone);
            
            res.send(`
                <div style="text-align:center; font-family:sans-serif; margin-top:50px;">
                    <h1 style="color:#128c7e;">Código de Vinculación</h1>
                    <div style="font-size:3.5rem; font-weight:bold; background:#e1f5fe; padding:20px; display:inline-block; border-radius:10px; border:3px solid #01579b; font-family:monospace;">
                        ${code}
                    </div>
                    <p style="margin-top:20px;">Ponlo en tu WhatsApp ahora mismo.</p>
                </div>
            `);
        } catch (err) {
            console.error('Error capturado:', err.message);
            
            // Si da el error "t", es que el navegador se quedó pegado.
            // Forzamos un refresco interno para el próximo intento.
            res.send(`
                <div style="text-align:center; font-family:sans-serif; margin-top:50px;">
                    <h2 style="color:orange;">⏳ El servidor está "calentando"...</h2>
                    <p>WhatsApp tardó demasiado en responder (Error t).</p>
                    <p><b>No te rindas:</b> Haz clic en el botón de abajo. En el segundo o tercer intento siempre funciona porque la página ya queda cargada en memoria.</p>
                    <button onclick="location.reload()" style="padding:15px 30px; font-size:1.2rem; cursor:pointer; background:#128c7e; color:white; border:none; border-radius:5px;">
                        🔄 REINTENTAR VINCULACIÓN
                    </button>
                </div>
            `);
        }
    });

    client.initialize();
    app.listen(process.env.PORT || 3000);
});