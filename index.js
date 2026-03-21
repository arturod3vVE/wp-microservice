const { Client, RemoteAuth } = require('whatsapp-web.js');
const express = require('express');
const { PostgresStore } = require('wwebjs-postgres');

const app = express();
app.use(express.json());

let isReady = false;

// 1. Verificación de la URL de la base de datos
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
    console.error('❌ ERROR: No se encontró la variable DATABASE_URL en Railway.');
    process.exit(1);
}

// 2. Configuración de conexión
const dbConfig = {
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false }
};

// 3. Inicializamos el Store (Aquí estaba el error, ahora está corregido)
const store = new PostgresStore({ 
    connectionConfig: dbConfig 
});

// 4. Configuración del Cliente de WhatsApp
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
            '--no-zygote',
            '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        ],
        executablePath: '/usr/bin/google-chrome-stable'
    }
});

client.on('ready', () => {
    isReady = true;
    console.log('✅ ¡WhatsApp Conectado y Listo!');
});

// RUTA PARA VINCULAR (Con el delay de seguridad para evitar el error 't')
app.get('/vincular', async (req, res) => {
    const phone = req.query.phone;
    if (!phone) return res.send('Falta el número: /vincular?phone=58412XXXXXXX');
    if (isReady) return res.send('✅ Ya estás conectado.');

    console.log(`⏳ Iniciando vinculación para ${phone}...`);

    try {
        // Esperamos 10 segundos para que la página cargue en Railway
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        console.log('📲 Solicitando código de 8 dígitos...');
        const code = await client.requestPairingCode(phone);
        
        res.send(`
            <div style="text-align:center; font-family:sans-serif; margin-top:50px;">
                <h1 style="color:#128c7e;">Código de Vinculación</h1>
                <div style="font-size:3.5rem; font-weight:bold; background:#e1f5fe; padding:20px; display:inline-block; border-radius:10px; border:3px solid #01579b; font-family:monospace;">
                    ${code}
                </div>
                <p style="margin-top:20px;">Introduce este código en tu celular ahora mismo.</p>
                <button onclick="location.reload()" style="margin-top:20px; padding:10px; cursor:pointer;">Generar otro código</button>
            </div>
        `);
    } catch (err) {
        console.error('Error al generar código:', err.message);
        res.send(`<h2>Error: ${err.message}</h2><p>Espera 10 segundos y recarga la página.</p>`);
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Microservicio escuchando en el puerto ${PORT}`);
});