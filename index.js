const { Client, RemoteAuth } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal'); // El de la consola
const QRCode = require('qrcode'); // El nuevo para generar imágenes
const express = require('express');
const { PostgresStore } = require('wwebjs-postgres');
const { Client: PgClient } = require('pg');

const app = express();
app.use(express.json());

// Variable global para guardar la imagen del QR
let latestQrImage = null;

// ... (toda tu configuración de dbConfig y pgClient queda igual) ...

pgClient.connect().then(() => {
    const store = new PostgresStore({ client: pgClient });

    const client = new Client({
        authStrategy: new RemoteAuth({
            store: store,
            backupSyncIntervalMs: 300000
        }),
        puppeteer: {
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
            executablePath: '/usr/bin/google-chrome-stable'
        }
    });

    // EVENTO QR ACTUALIZADO
    client.on('qr', async (qr) => {
        // 1. Lo seguimos mostrando en consola por si acaso
        qrcodeTerminal.generate(qr, { small: true });
        
        // 2. Lo convertimos a una imagen Base64 para la web
        try {
            latestQrImage = await QRCode.toDataURL(qr);
            console.log('✅ Imagen QR generada. Disponible en /qr');
        } catch (err) {
            console.error('Error generando QR imagen:', err);
        }
    });

    client.on('ready', () => {
        latestQrImage = null; // Limpiamos el QR cuando ya se conectó
        console.log('✅ ¡WhatsApp Conectado!');
    });

    // --- NUEVA RUTA PARA VER EL QR EN EL NAVEGADOR ---
    app.get('/qr', (req, res) => {
        if (latestQrImage) {
            res.send(`
                <html>
                    <body style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; font-family:sans-serif; background:#f0f2f5;">
                        <div style="background:white; padding:40px; border-radius:20px; box-shadow: 0 10px 25px rgba(0,0,0,0.1); text-align:center;">
                            <h1 style="color:#128c7e;">Vincular CrumbCore</h1>
                            <p>Abre WhatsApp > Dispositivos vinculados > Vincular dispositivo</p>
                            <img src="${latestQrImage}" style="width:300px; margin:20px 0; border: 1px solid #ddd;">
                            <p style="color:#666; font-size:0.8rem;">La página se actualiza automáticamente</p>
                        </div>
                        <script>setTimeout(() => location.reload(), 30000);</script>
                    </body>
                </html>
            `);
        } else {
            res.send(`
                <html>
                    <body style="display:flex; align-items:center; justify-content:center; height:100vh; font-family:sans-serif; background:#f0f2f5;">
                        <div style="text-align:center;">
                            <h1>✅ WhatsApp ya está vinculado</h1>
                            <p>No es necesario escanear nada. El servicio está activo.</p>
                            <a href="/" style="color:#128c7e;">Volver al inicio</a>
                        </div>
                    </body>
                </html>
            `);
        }
    });

    // ... (tu app.post('/send') y el resto queda igual) ...
    
    client.initialize();
    
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`🚀 API en puerto ${PORT}`));
});