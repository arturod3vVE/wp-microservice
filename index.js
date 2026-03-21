const { Client, RemoteAuth } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const express = require('express');
const { PostgresStore } = require('wwebjs-postgres');
const { Client: PgClient } = require('pg');

const app = express();
app.use(express.json());

// Variable para guardar el QR y mostrarlo en la web
let latestQrImage = null;

// 1. Configuración de la base de datos (Render usa DATABASE_URL)
const dbConfig = {
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false // Requerido para conexiones seguras en Render/AWS
    }
};

// 2. Conectamos a Postgres antes de iniciar WhatsApp
const pgClient = new PgClient(dbConfig);

pgClient.connect().then(() => {
    console.log('✅ Conectado a la base de datos PostgreSQL');

    // Inicializamos el almacén de sesiones (usando la configuración de conexión)
    const store = new PostgresStore({ 
        connectionConfig: dbConfig 
    });

    // 3. Configuración del Cliente de WhatsApp
    const client = new Client({
        authStrategy: new RemoteAuth({
            store: store,
            backupSyncIntervalMs: 300000 // Respaldo cada 5 minutos
        }),
        puppeteer: {
            handleSIGINT: false,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-extensions'
            ],
            // En el Dockerfile instalamos Google Chrome en esta ruta:
            executablePath: '/usr/bin/google-chrome-stable'
        }
    });

    // --- EVENTOS DE WHATSAPP ---

    // Cuando llega un nuevo código QR
    client.on('qr', async (qr) => {
        // Lo mostramos en la consola de Render (por si acaso)
        qrcodeTerminal.generate(qr, { small: true });
        
        // Lo convertimos a una imagen para la ruta /qr
        try {
            latestQrImage = await QRCode.toDataURL(qr);
            console.log('✨ Nuevo código QR generado. Escanéalo en: /qr');
        } catch (err) {
            console.error('Error al generar imagen QR:', err);
        }
    });

    // Cuando la sesión se guarda con éxito en la DB
    client.on('remote_session_saved', () => {
        console.log('💾 Sesión de WhatsApp guardada en PostgreSQL');
    });

    // Cuando el cliente ya está listo para enviar mensajes
    client.on('ready', () => {
        latestQrImage = null; // Limpiamos el QR porque ya no hace falta
        console.log('✅ ¡WhatsApp está conectado y LISTO!');
    });

    client.on('authenticated', () => {
        console.log('🔓 Autenticado correctamente');
    });

    client.on('auth_failure', (msg) => {
        console.error('❌ Fallo de autenticación:', msg);
    });

    // --- RUTAS DEL MICROSERVICIO ---

    // Ruta para ver el QR cómodamente desde el navegador
    var connect = process.env.QR_URL;
    app.get(connect, (req, res) => {
        if (latestQrImage) {
            res.send(`
                <html>
                    <body style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; font-family:Arial, sans-serif; background:#f0f2f5; margin:0;">
                        <div style="background:white; padding:40px; border-radius:20px; box-shadow: 0 10px 25px rgba(0,0,0,0.1); text-align:center;">
                            <h1 style="color:#128c7e; margin-bottom:10px;">Vincular CrumbCore</h1>
                            <p style="color:#666;">Abre WhatsApp > Dispositivos vinculados > Vincular dispositivo</p>
                            <img src="${latestQrImage}" style="width:300px; margin:20px 0; border: 10px solid #fff; outline: 1px solid #eee;">
                            <p style="color:#999; font-size:0.8rem;">Esta página se refresca cada 30 segundos</p>
                        </div>
                        <script>setTimeout(() => location.reload(), 30000);</script>
                    </body>
                </html>
            `);
        } else {
            res.send(`
                <html>
                    <body style="display:flex; align-items:center; justify-content:center; height:100vh; font-family:Arial, sans-serif; background:#f0f2f5; margin:0;">
                        <div style="text-align:center; background:white; padding:40px; border-radius:20px; box-shadow: 0 10px 25px rgba(0,0,0,0.1);">
                            <h1 style="color:#128c7e;">✅ WhatsApp Conectado</h1>
                            <p>El servicio está activo y enviando mensajes.</p>
                            <p style="color:#666; font-size:0.9rem;">Si necesitas volver a vincular, reinicia el servidor en Render.</p>
                        </div>
                    </body>
                </html>
            `);
        }
    });

    // Ruta que llama Django para enviar el mensaje
    app.post('/send', async (req, res) => {
        const { phone, message } = req.body;

        if (!phone || !message) {
            return res.status(400).json({ error: 'Faltan parámetros: phone y message' });
        }

        try {
            const chatId = `${phone}@c.us`;
            await client.sendMessage(chatId, message);
            console.log(`📩 Mensaje enviado a: ${phone}`);
            res.status(200).json({ status: 'success', message: 'Mensaje enviado' });
        } catch (error) {
            console.error('❌ Error al enviar mensaje:', error);
            res.status(500).json({ status: 'error', detail: error.message });
        }
    });

    // Inicializamos el cliente de WhatsApp
    client.initialize();

    // Iniciamos el servidor Express
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`🚀 Servidor API escuchando en el puerto ${PORT}`);
    });

}).catch(err => {
    console.error('❌ Error fatal al conectar a PostgreSQL:', err);
});