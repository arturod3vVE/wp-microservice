const { default: makeWASocket, DisconnectReason, fetchLatestBaileysVersion, Browsers, BufferJSON, initAuthCreds } = require('@whiskeysockets/baileys');
const { MongoClient } = require('mongodb');
const express = require('express');
const QRCode = require('qrcode');
const pino = require('pino');

const app = express();
app.use(express.json());

const MONGO_URI = process.env.MONGO_URI; // Configura esto en Render
const client = new MongoClient(MONGO_URI);
let db;

const sessions = new Map();

// --- 🛠️ ADAPTADOR DE MONGODB PARA BAILEYS ---
async function useMongoDBAuthState(storeId) {
    const collection = db.collection(`session_${storeId}`);

    const writeData = (data, id) => {
        return collection.replaceOne({ _id: id }, JSON.parse(JSON.stringify(data, BufferJSON.replacer)), { upsert: true });
    };

    const readData = async (id) => {
        try {
            const data = await collection.findOne({ _id: id });
            return JSON.parse(JSON.stringify(data), BufferJSON.reviver);
        } catch (error) { return null; }
    };

    const removeData = async (id) => {
        try { await collection.deleteOne({ _id: id }); } catch (error) { }
    };

    const creds = (await readData('creds')) || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(ids.map(async (id) => {
                        let value = await readData(`${type}-${id}`);
                        if (type === 'app-state-sync-key' && value) {
                            value = proto.Message.AppStateSyncKeyData.fromObject(value);
                        }
                        data[id] = value;
                    }));
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const sId = `${category}-${id}`;
                            tasks.push(value ? writeData(value, sId) : removeData(sId));
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: () => writeData(creds, 'creds')
    };
}

// --- ⚙️ MOTOR CREADOR DE SESIONES ---
async function initSession(storeId) {
    const { state, saveCreds } = await useMongoDBAuthState(storeId);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: Browsers.macOS('Desktop')
    });

    sessions.set(storeId, { sock, status: 'STARTING', qr: null });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        const currentSession = sessions.get(storeId);

        if (qr) {
            currentSession.qr = await QRCode.toDataURL(qr);
            currentSession.status = 'QR_READY';
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                setTimeout(() => initSession(storeId), 3000);
            } else {
                sessions.delete(storeId);
                await db.collection(`session_${storeId}`).drop();
            }
        } else if (connection === 'open') {
            currentSession.status = 'CONNECTED';
            currentSession.qr = null;
        }
    });
}

// --- 🚀 INICIO DEL SERVIDOR ---
async function startServer() {
    await client.connect();
    db = client.db('whatsapp_bot');
    console.log('✅ Conectado a MongoDB Atlas');

    // Restaurar sesiones automáticas desde la DB
    const collections = await db.listCollections().toArray();
    for (const col of collections) {
        if (col.name.startsWith('session_')) {
            const storeId = col.name.replace('session_', '');
            initSession(storeId);
        }
    }

    app.listen(process.env.PORT || 3000, () => console.log('🚀 API lista'));
}

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

startServer();