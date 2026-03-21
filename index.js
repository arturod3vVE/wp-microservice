const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');

const app = express();
app.use(express.json()); // Para poder recibir datos en formato JSON desde Django

// Inicializamos el cliente. LocalAuth guarda la sesión para no escanear el QR cada vez que reinicies
const client = new Client({
    authStrategy: new LocalAuth()
});

// Evento 1: Generar el código QR en la terminal
client.on('qr', (qr) => {
    console.log('\n=========================================');
    console.log('📱 ESCANEA ESTE QR CON TU WHATSAPP');
    console.log('=========================================\n');
    qrcode.generate(qr, { small: true });
});

// Evento 2: Confirmación de conexión exitosa
client.on('ready', () => {
    console.log('✅ ¡WhatsApp está conectado y listo para enviar mensajes!');
});

// Evento 3: Manejo de desconexiones
client.on('disconnected', (reason) => {
    console.log('❌ WhatsApp se desconectó:', reason);
});

// CREAMOS EL ENDPOINT PARA DJANGO
app.post('/send', async (req, res) => {
    const { phone, message } = req.body;

    if (!phone || !message) {
        return res.status(400).send({ error: 'Faltan datos (phone o message)' });
    }

    // WhatsApp requiere que el número termine en @c.us
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

// Arrancamos el cliente de WhatsApp
client.initialize();

// Arrancamos el servidor API en el puerto 3000
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`🚀 Microservicio API corriendo en http://localhost:${PORT}`);
});