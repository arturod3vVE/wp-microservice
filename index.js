const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = require('@whiskeysockets/baileys');
const express = require('express');
const QRCode = require('qrcode');
const pino = require('pino');

const app = express();
app.use(express.json());

let sock;
let isReady = false;
let latestQr = null;

// --- 🛡️ SISTEMA DE COLA ANTI-BANEO 🛡️ ---
const messageQueue = [];
let isProcessingQueue = false;
let messagesSentInCurrentBatch = 0;

async function processQueue() {
    if (isProcessingQueue || messageQueue.length === 0) return;
    isProcessingQueue = true;

    while (messageQueue.length > 0) {
        const { phone, message, storeNameSafe } = messageQueue.shift();
        const jid = `${phone}@s.whatsapp.net`; // Formato estricto de Baileys

        try {
            console.log(`[Cola] 📦 Procesando envío para ${phone}... (Faltan ${messageQueue.length})`);

            // 1. Simular "Escribiendo..."
            await sock.sendPresenceUpdate('composing', jid);
            
            let typingDelay = (message.length / 4) * 1000; 
            typingDelay = Math.max(3000, Math.min(typingDelay, 12000)); 
            typingDelay += (Math.random() * 2000);
            
            console.log(`✍️ Simulando escritura por ${(typingDelay/1000).toFixed(1)}s...`);
            await new Promise(r => setTimeout(r, typingDelay));
            
            // 2. Dejar de escribir
            await sock.sendPresenceUpdate('paused', jid);

            // 3. Enviar el mensaje real
            const finalMessage = `👋 ¡Hola!\n🧁 *${storeNameSafe}* te informa:\n\n${message}`;
            await sock.sendMessage(jid, { text: finalMessage });
            console.log(`✅ Mensaje entregado a ${phone}`);
            
            messagesSentInCurrentBatch++;

            // 4. Descansos Inteligentes
            if (messagesSentInCurrentBatch >= 10 && messageQueue.length > 0) {
                const coffeeBreak = Math.floor(Math.random() * 120000) + 120000;
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
            console.error(`❌ Error enviando a ${phone}:`, error.message || error);
        }
    }

    isProcessingQueue = false;
    messagesSentInCurrentBatch = 0; 
    console.log('🏁 La cola de mensajes está limpia y vacía.');
}

// --- ⚙️ SISTEMA CENTRAL DE BAILEYS ---
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');
    
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`[Sistema] Usando WA v${version.join('.')} (Última: ${isLatest})`);

    sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }), 
        browser: Browsers.macOS('Desktop')
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('✨ Nuevo QR generado. Entra a tu endpoint /qr');
            latestQr = await QRCode.toDataURL(qr);
            isReady = false;
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('❌ Conexión cerrada. ¿Reconectando?:', shouldReconnect);
            isReady = false;
            
            if (shouldReconnect) {
                setTimeout(() => { connectToWhatsApp(); }, 2000);
            } else {
                console.log('⚠️ Sesión cerrada. Debes borrar "baileys_auth_info" para escanear de nuevo.');
            }
        } else if (connection === 'open') {
            console.log('✅ ¡Baileys Conectado y listo para volar! 🚀');
            isReady = true;
            latestQr = null;
        }
    });
}

connectToWhatsApp();

// --- 🌐 RUTAS WEB ---
app.get('/qr', (req, res) => {
    if (isReady) {
        return res.send(`<div style="text-align:center; font-family:sans-serif; margin-top:100px;"><h1 style="color:#128c7e;">✅ Sistema Operativo</h1><p>CrumbCore está conectado a WhatsApp usando Baileys.</p></div>`);
    }

    if (latestQr) {
        res.send(`<div style="text-align:center; font-family:sans-serif; margin-top:50px;"><h2 style="color:#128c7e;">Vincular WhatsApp (Baileys)</h2><img src="${latestQr}" style="width:300px; border:5px solid white; box-shadow:0 0 10px rgba(0,0,0,0.1);"><p>La página se refresca cada 15s automáticamente.</p><script>setTimeout(() => location.reload(), 15000);</script></div>`);
    } else {
        res.send('<h3 style="text-align:center; margin-top:50px;">Cargando motor ligero... recarga en 5 segs.</h3>');
    }
});

app.post('/send', async (req, res) => {
    if (!isReady) return res.status(503).json({ error: 'WhatsApp Offline' });
    
    const { phone, message, store_name } = req.body;
    if (!phone || !message) return res.status(400).json({ error: 'Faltan datos' });

    const cleanPhone = phone.replace(/\D/g, '');
    const storeNameSafe = store_name || 'CrumbCore';
    
    // Mandamos a la cola
    messageQueue.push({ phone: cleanPhone, message, storeNameSafe });
    processQueue();

    res.status(200).json({ status: 'queued', detail: `Mensaje recibido. Posición en cola: ${messageQueue.length}` });
});

app.listen(process.env.PORT || 3000, () => console.log('🚀 Microservicio Baileys iniciado en el puerto 3000'));