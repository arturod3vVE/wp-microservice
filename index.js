const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const QRCode = require('qrcode');

const app = express();
app.use(express.json());

let isReady = false;
let latestQr = null;

const client = new Client({
    authStrategy: new LocalAuth({ 
        dataPath: '/app/whatsapp_session' 
    }),
    puppeteer: {
        handleSIGINT: false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage', // CRÍTICO para Docker/Railway
            '--disable-gpu',           // WhatsApp no necesita tarjeta gráfica
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            // ⚠️ ELIMINAMOS --single-process QUE ESTABA CAUSANDO EL CRASH
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process',
            '--disable-site-isolation-trials',
            '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
        ],
        executablePath: '/usr/bin/google-chrome-stable'
    }
});

// --- SISTEMA DE COLA ANTI-BANEO ---
const messageQueue = [];
let isProcessingQueue = false;
let messagesSentInCurrentBatch = 0; // Contador para los descansos largos

async function processQueue() {
    if (isProcessingQueue || messageQueue.length === 0) return;
    isProcessingQueue = true;

    while (messageQueue.length > 0) {
        const { phone, message } = messageQueue.shift();
        const chatId = `${phone}@c.us`;

        try {
            console.log(`[Cola] 📦 Procesando envío para ${phone}... (Faltan ${messageQueue.length})`);

            const chat = await client.getChatById(chatId);
            
            await chat.sendStateTyping();
            let typingDelay = (message.length / 4) * 1000; 
            
            typingDelay = Math.max(3000, Math.min(typingDelay, 12000)); 
            
            typingDelay += (Math.random() * 2000);
            
            console.log(`✍️ Simulando escritura por ${(typingDelay/1000).toFixed(1)}s...`);
            await new Promise(r => setTimeout(r, typingDelay));
            await chat.clearState(); // Dejamos de escribir

            // 2. Enviar el mensaje real
            await client.sendMessage(chatId, message);
            console.log(`✅ Mensaje entregado a ${phone}`);
            
            messagesSentInCurrentBatch++;

            if (messagesSentInCurrentBatch >= 10 && messageQueue.length > 0) {
                const coffeeBreak = Math.floor(Math.random() * 120000) + 120000; // 2 a 4 min
                console.log(`☕ [ANTI-BAN] Descanso largo activado. Pausando por ${(coffeeBreak/60000).toFixed(1)} minutos...`);
                await new Promise(r => setTimeout(r, coffeeBreak));
                messagesSentInCurrentBatch = 0; 
            } 
            else if (messageQueue.length > 0) {
                const sleepTime = Math.floor(Math.random() * 25000) + 15000;
                console.log(`⏳ [ANTI-BAN] Respirando por ${(sleepTime / 1000).toFixed(1)}s antes del próximo chat...`);
                await new Promise(r => setTimeout(r, sleepTime));
            }

        } catch (error) {
            console.error(`❌ Error enviando a ${phone}:`, error.message);
        }
    }

    isProcessingQueue = false;
    messagesSentInCurrentBatch = 0; 
    console.log('🏁 La cola de mensajes está limpia y vacía.');
}

// --- EVENTOS DE WHATSAPP ---
client.on('qr', async (qr) => {
    isReady = false;
    latestQr = await QRCode.toDataURL(qr);
    console.log('✨ Nuevo QR generado. Entra a tu link terminado en /qr');
});

client.on('ready', () => {
    isReady = true;
    latestQr = null;
    console.log('✅ ¡WhatsApp Conectado y listo para trabajar!');
});

client.on('authenticated', () => console.log('🔓 Sesión Autenticada y guardada en el disco'));
client.on('auth_failure', (msg) => console.error('❌ Error de Autenticación:', msg));

// --- RUTAS WEB ---
app.get('/qr', (req, res) => {
    if (isReady) {
        return res.send(`
            <div style="text-align:center; font-family:sans-serif; margin-top:100px;">
                <h1 style="color:#128c7e;">✅ Sistema Operativo</h1>
                <p>CrumbCore está conectado a WhatsApp.</p>
            </div>
        `);
    }

    if (latestQr) {
        res.send(`
            <div style="text-align:center; font-family:sans-serif; margin-top:50px;">
                <h2 style="color:#128c7e;">Vincular WhatsApp</h2>
                <img src="${latestQr}" style="width:300px; border:5px solid white; box-shadow:0 0 10px rgba(0,0,0,0.1);">
                <p>La página se refresca cada 15s automáticamente.</p>
                <script>setTimeout(() => location.reload(), 15000);</script>
            </div>
        `);
    } else {
        res.send('<h3 style="text-align:center; margin-top:50px;">Cargando motor de WhatsApp... recarga en 5 segs.</h3>');
    }
});

// Endpoint MODIFICADO para limpiar el número antes de encolar
app.post('/send', (req, res) => {
    if (!isReady) return res.status(503).json({ error: 'WhatsApp Offline' });
    
    const { phone, message } = req.body;
    if (!phone || !message) return res.status(400).json({ error: 'Faltan datos' });

    const cleanPhone = phone.replace(/\D/g, '');

    messageQueue.push({ phone: cleanPhone, message });
    processQueue();

    res.status(200).json({ 
        status: 'queued', 
        detail: `Mensaje recibido. Posición en cola: ${messageQueue.length}` 
    });
});

client.initialize();
app.listen(process.env.PORT || 3000, () => console.log('🚀 Microservicio iniciado'));