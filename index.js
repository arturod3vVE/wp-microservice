const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = require('@whiskeysockets/baileys');
const express = require('express');
const QRCode = require('qrcode');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// 🗂️ DICCIONARIO DE SESIONES ACTIVAS
// Aquí guardaremos { sock, qr, status } para cada store_id
const sessions = new Map(); 

// Ruta base del volumen de Railway
const AUTH_DIR = '/app/baileys_auth_info';
if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

// --- ⚙️ MOTOR CREADOR DE SESIONES ---
async function initSession(storeId) {
    const sessionPath = path.join(AUTH_DIR, `store_${storeId}`);
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }), 
        browser: Browsers.macOS('Desktop')
    });

    // Guardamos la sesión en el mapa con estado inicial
    sessions.set(storeId, { sock, status: 'STARTING', qr: null });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        const currentSession = sessions.get(storeId);

        if (qr) {
            console.log(`✨ [Tienda ${storeId}] Nuevo QR generado.`);
            currentSession.qr = await QRCode.toDataURL(qr);
            currentSession.status = 'QR_READY';
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log(`❌ [Tienda ${storeId}] Conexión cerrada. ¿Reconectar?: ${shouldReconnect}`);
            
            if (shouldReconnect) {
                currentSession.status = 'RECONNECTING';
                setTimeout(() => initSession(storeId), 2000);
            } else {
                // El usuario cerró sesión desde su teléfono
                console.log(`🗑️ [Tienda ${storeId}] Sesión cerrada manualmente. Borrando datos...`);
                sessions.delete(storeId);
                fs.rmSync(sessionPath, { recursive: true, force: true });
            }
        } else if (connection === 'open') {
            console.log(`✅ [Tienda ${storeId}] ¡Conectado y listo!`);
            currentSession.status = 'CONNECTED';
            currentSession.qr = null; // Borramos el QR de la memoria
        }
    });

    // Evitar que el bot colapse si le envían un mensaje raro
    sock.ev.on('messages.upsert', () => {}); 
}

// --- 🔄 AUTO-ARRANQUE DE SESIONES GUARDADAS ---
// Cuando Railway se reinicie, leemos las carpetas y encendemos los bots
fs.readdirSync(AUTH_DIR).forEach(dir => {
    if (dir.startsWith('store_')) {
        const storeId = dir.split('_')[1];
        console.log(`🔄 Restaurando sesión para Tienda ${storeId}...`);
        initSession(storeId);
    }
});

// --- 🌐 ENDPOINTS DE LA API ---

// 1. Iniciar/Consultar el estado de una tienda específica
app.get('/session/:storeId', async (req, res) => {
    const { storeId } = req.params;
    
    if (!sessions.has(storeId)) {
        // Si no existe, la creamos en segundo plano
        initSession(storeId);
        return res.json({ status: 'STARTING', detail: 'Iniciando motor de WhatsApp...' });
    }

    const session = sessions.get(storeId);
    res.json({ status: session.status, qr: session.qr });
});

// 2. Cerrar sesión remotamente
app.delete('/session/:storeId', async (req, res) => {
    const { storeId } = req.params;
    if (sessions.has(storeId)) {
        const session = sessions.get(storeId);
        await session.sock.logout(); // Esto disparará el borrado de la carpeta
        res.json({ success: true, detail: 'Sesión cerrada exitosamente.' });
    } else {
        res.json({ success: false, detail: 'No hay sesión activa.' });
    }
});

// 3. Enviar mensaje usando LA CUENTA DE ESA TIENDA
app.post('/send', async (req, res) => {
    const { store_id, phone, message } = req.body;
    
    if (!store_id || !phone || !message) return res.status(400).json({ error: 'Faltan datos' });

    const session = sessions.get(String(store_id));
    
    if (!session || session.status !== 'CONNECTED') {
        return res.status(503).json({ error: 'El WhatsApp de esta tienda no está conectado.' });
    }

    const cleanPhone = phone.replace(/\D/g, '');
    const jid = `${cleanPhone}@s.whatsapp.net`;

    try {
        // En un futuro le inyectaremos la cola anti-baneo aquí mismo, 
        // pero vamos a probar la conexión multi-tenant directa primero.
        await session.sock.sendPresenceUpdate('composing', jid);
        await new Promise(r => setTimeout(r, 1500));
        await session.sock.sendPresenceUpdate('paused', jid);
        
        await session.sock.sendMessage(jid, { text: message });
        
        res.status(200).json({ status: 'sent', detail: 'Mensaje entregado' });
    } catch (error) {
        console.error(`❌ Error enviando a ${phone} desde tienda ${store_id}:`, error);
        res.status(500).json({ error: 'Fallo al enviar' });
    }
});

app.listen(process.env.PORT || 3000, () => console.log('🚀 API Multi-Tenant iniciada'));