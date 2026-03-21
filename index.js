const { Client, RemoteAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');

// Nuevas importaciones para la Base de Datos
const { PostgresStore } = require('wwebjs-postgres');
const { Client: PgClient } = require('pg');

const app = express();
app.use(express.json());

// 1. Configuramos la conexión a tu PostgreSQL (Render te dará la URL)
const pgClient = new PgClient({
    connectionString: process.env.DATABASE_URL, 
    ssl: { rejectUnauthorized: false } // Obligatorio para bases de datos en la nube
});

// 2. Conectamos a la BD antes de encender WhatsApp
pgClient.connect().then(() => {
    console.log('✅ Conectado a la base de datos PostgreSQL');
    
    const app = express();
    app.use(express.json());

    const dbConfig = {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    };

    // 2. Inicializamos el Store pasándole la configuración directamente
    const store = new PostgresStore({ 
        connectionConfig: dbConfig 
    });

    // 3. Ahora sí, procedemos con la lógica de WhatsApp
    console.log('⏳ Inicializando almacén de sesiones en PostgreSQL...');

    const client = new Client({
        authStrategy: new RemoteAuth({
            store: store,
            backupSyncIntervalMs: 300000
        }),
        puppeteer: {
            handleSIGINT: false, // Recomendado para entornos Docker/Render
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage', // Ayuda con la memoria en Render Free
            ],
            executablePath: '/usr/bin/google-chrome-stable' // Forzamos la ruta del Chrome que instalamos en el Dockerfile
        }
    });

    client.on('qr', (qr) => {
        console.log('\n📱 ESCANEA ESTE QR CON TU WHATSAPP');
        qrcode.generate(qr, { small: true });
    });

    client.on('ready', () => {
        console.log('✅ ¡WhatsApp está conectado y listo para enviar mensajes!');
    });

    // Nuevo evento: Te avisa cuando la sesión se guardó en tu base de datos
    client.on('remote_session_saved', () => {
        console.log('💾 Sesión guardada de forma segura en PostgreSQL');
    });

    client.on('disconnected', (reason) => {
        console.log('❌ WhatsApp se desconectó:', reason);
    });

    app.post('/send', async (req, res) => {
        const { phone, message } = req.body;
        if (!phone || !message) {
            return res.status(400).send({ error: 'Faltan datos (phone o message)' });
        }

        const chatId = `${phone}@c.us`;

        try {
            await client.sendMessage(chatId, message);
            console.log(`Mensaje enviado a ${phone}`);
            res.status(200).send({ status: 'enviado' });
        } catch (error) {
            console.error(`Error enviando a ${phone}:`, error);
            res.status(500).send({ error: 'Fallo al enviar el mensaje' });
        }
    });

    client.initialize();

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`🚀 Microservicio API corriendo en el puerto ${PORT}`);
    });
});