const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const QRCode = require('qrcode');

const app = express();
app.use(express.json());

let isReady = false;
let latestQr = null;

// --- SISTEMA DE COLA ANTI-BANEO ---
const messageQueue = [];
let isProcessingQueue = false;

async function processQueue() {
    // Si ya estamos procesando o la cola está vacía, no hacemos nada
    if (isProcessingQueue || messageQueue.length === 0) return;
    
    isProcessingQueue = true;

    while (messageQueue.length > 0) {
        // Sacamos el primer mensaje de la fila
        const { phone, message } = messageQueue.shift();
        const chatId = `${phone}@c.us`;

        try {
            console.log(`[Cola] Procesando mensaje para ${phone}... Quedan ${messageQueue.length} en espera.`);

            // 1. Simular que un humano está escribiendo (Opcional pero muy efectivo)
            const chat = await client.getChatById(chatId);
            await chat.sendStateTyping();

            // 2. Tiempo aleatorio "escribiendo" (entre 2 y 4 segundos)
            const typingDelay = Math.floor(Math.random() * 2000) + 2000;
            await new Promise(r => setTimeout(r, typingDelay));

            // 3. Enviar el mensaje real
            await client.sendMessage(chatId, message);
            console.log(`✅ Mensaje enviado con éxito a ${phone}`);

            // 4. Pausa de "Respiro" Anti-Ban ANTES de procesar el siguiente mensaje
            // Solo pausamos si quedan más mensajes en la fila
            if (messageQueue.length > 0) {
                // Pausa aleatoria entre 8 y 15 segundos
                const sleepTime = Math.floor(Math.random() * 7000) + 8000;
                console.log(`⏳ Anti-Ban: Esperando ${sleepTime / 1000}s para el próximo envío...`);
                await new Promise(r => setTimeout(r, sleepTime));
            }

        } catch (error) {
            console.error(`❌ Error enviando a ${phone}:`, error.message);
        }
    }

    isProcessingQueue = false;
    console.log('🏁 Todos los mensajes en la cola han sido enviados.');
}
// ----------------------------------

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: '/app/whatsapp_session' }),
    puppeteer: {
        handleSIGINT: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--single-process'],
        executablePath: '/usr/bin/google-chrome-stable'
    }
});

client.on('qr', async (qr) => {
    isReady = false;
    latestQr = await QRCode.toDataURL(qr);
});

client.on('ready', () => {
    isReady = true;
    latestQr = null;
    console.log('✅ ¡WhatsApp Conectado y listo para encolar!');
    
    // Si el servidor se reinició y había mensajes guardados (opcional avanzado),
    // aquí podrías retomar, pero por ahora en memoria es suficiente.
});

// Endpoint MODIFICADO para usar la cola
app.post('/send', (req, res) => {
    if (!isReady) return res.status(503).json({ error: 'WhatsApp Offline' });

    const { phone, message } = req.body;
    
    if (!phone || !message) {
        return res.status(400).json({ error: 'Faltan datos' });
    }

    // 1. Añadimos a la fila
    messageQueue.push({ phone, message });

    // 2. Avisamos al procesador que revise la fila
    processQueue();

    // 3. Le respondemos a Django INMEDIATAMENTE. 
    // Django no tiene que esperar 15 segundos a que el mensaje se envíe.
    res.status(200).json({ 
        status: 'queued', 
        detail: `Mensaje encolado. Posición: ${messageQueue.length}` 
    });
});

client.initialize();
app.listen(process.env.PORT || 3000, () => console.log('🚀 Microservicio iniciado'));