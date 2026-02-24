const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const db = require('./db');
const upload = require('./upload');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const fetch = require('node-fetch');
const sharp = require('sharp');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 1e8 // Allow larger websocket payloads if needed, though we use multer for files
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.static(path.join(__dirname, '../public')));
app.use('/uploads', express.static(path.join(__dirname, '../uploads'))); // Serve uploaded files statically
app.use(express.json());

// Helper function to extract basic device name from User-Agent
function parseUserAgent(ua) {
    if (!ua) return 'Unknown Device';
    let os = 'Unknown OS';
    let browser = 'Unknown Browser';

    if (ua.includes('Win')) os = 'Windows';
    else if (ua.includes('Mac')) os = 'MacOS';
    else if (ua.includes('Linux')) os = 'Linux';
    else if (ua.includes('Android')) os = 'Android';
    else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';

    if (ua.includes('Chrome')) browser = 'Chrome';
    else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari';
    else if (ua.includes('Firefox')) browser = 'Firefox';
    else if (ua.includes('Edge')) browser = 'Edge';

    return `${os} (${browser})`;
}

// API: Identify or Create User
app.post('/api/user/identify', (req, res) => {
    let { userId } = req.body;
    let user;

    if (userId) {
        user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    }

    if (!user) {
        userId = uuidv4();
        const ua = req.headers['user-agent'];
        const defaultName = parseUserAgent(ua);

        db.prepare(`
            INSERT INTO users (id, name, room_id, is_host)
            VALUES (?, ?, NULL, 0)
        `).run(userId, defaultName);

        user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    }

    res.json({ success: true, user });
});

// API: Update User Name
app.post('/api/user/rename', (req, res) => {
    const { userId, newName } = req.body;
    if (!userId || !newName) return res.status(400).json({ error: 'Missing data' });

    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(newName, userId);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

    // Broadcast name change to their room if they have one
    if (user && user.room_id) {
        io.to(user.room_id).emit('user_updated', user);
    }

    res.json({ success: true, user });
});

// API: Generate unique Pairing QR Code for "Show QR" (Invited device)
app.post('/api/qr/generate-pairing', async (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    // Use the userId as the pairing token for simplicity in this trusted flow
    // Device A will scan this and send an invite to this userId
    const pairingToken = `pairing:${userId}`;
    try {
        const qrCodeDataUrl = await QRCode.toDataURL(pairingToken);
        res.json({ success: true, qr: qrCodeDataUrl, token: pairingToken });
    } catch (err) {
        res.status(500).json({ error: 'Failed to generate QR' });
    }
});

// API: Generate Room Join QR Code for "Show QR" (Host device)
app.post('/api/qr/generate-room', async (req, res) => {
    const { roomId } = req.body;
    if (!roomId) return res.status(400).json({ error: 'Missing roomId' });

    // Domain would ideally be dynamically based on host header, but let's use a relative/flagged payload
    const joinPayload = `join_room:${roomId}`;
    try {
        const qrCodeDataUrl = await QRCode.toDataURL(joinPayload);
        res.json({ success: true, qr: qrCodeDataUrl });
    } catch (err) {
        res.status(500).json({ error: 'Failed to generate QR' });
    }
});


// API: Upload File
app.post('/api/upload', upload.single('file'), async (req, res) => {
    const { userId, room_id } = req.body;
    if (!userId || !room_id) return res.status(400).json({ error: 'Missing user or room' });
    if (!req.file) return res.status(400).json({ error: 'File rejected or not provided' });

    const fileName = req.file.originalname;
    const fileSize = req.file.size;
    const encodedFileName = encodeURIComponent(req.file.filename);
    const filePath = `/uploads/${room_id}/${encodedFileName}`; // Public URL path
    let fileThumbnail = null;

    // Check if image and generate thumbnail
    const isImage = fileName.match(/\.(jpg|jpeg|png|gif|webp)$/i);
    if (isImage) {
        try {
            const thumbFilename = `thumb_${req.file.filename}.webp`;
            const thumbPath = path.join(__dirname, '../uploads', room_id, thumbFilename);

            await sharp(req.file.path)
                .resize({ width: 400, withoutEnlargement: true })
                .webp({ quality: 80 })
                .toFile(thumbPath);

            fileThumbnail = `/uploads/${room_id}/${encodeURIComponent(thumbFilename)}`;
        } catch (err) {
            console.error('Thumbnail generation failed:', err);
            // Fallback to null thumbnail, original file still works
        }
    }

    // Save message to DB
    const result = db.prepare(`
        INSERT INTO messages (room_id, user_id, type, content, file_name, file_size, file_thumbnail, is_pinned)
        VALUES (?, ?, 'file', ?, ?, ?, ?, 0)
    `).run(room_id, userId, filePath, fileName, fileSize, fileThumbnail);

    const messageId = result.lastInsertRowid;
    const message = db.prepare(`
        SELECT m.*, u.name as user_name 
        FROM messages m 
        JOIN users u ON m.user_id = u.id 
        WHERE m.id = ?
    `).get(messageId);

    // Attach client_id if provided
    if (req.body.client_id) {
        message.client_id = req.body.client_id;
    }

    // Broadcast file message
    // Ensure room_id is primitive string and slightly delay to avoid blocking fetch response
    setTimeout(() => {
        io.to(String(room_id)).emit('new_message', message);
    }, 50);

    res.json({ success: true, message });
});


// API: Parse URL Metadata
app.post('/api/metadata', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'Missing url' });

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000); // 3-second timeout

        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
                'Accept': 'text/html'
            },
            signal: controller.signal
        });
        clearTimeout(timeout);

        if (!response.ok) throw new Error('Failed to fetch');

        const html = await response.text();

        let titleMatch = html.match(/<title>([^<]+)<\/title>/i);
        let title = titleMatch ? titleMatch[1].trim() : '';

        // Extract og:title if available to prefer it over the generic title tag
        let ogTitleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["'](.*?)["']/i);
        if (ogTitleMatch) title = ogTitleMatch[1].trim();

        let imageMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["'](.*?)["']/i);
        let image = imageMatch ? imageMatch[1].trim() : '';

        // Handle relative image URLs if domain isn't included
        if (image && !image.startsWith('http')) {
            try {
                const baseUrl = new URL(url);
                if (image.startsWith('//')) {
                    image = baseUrl.protocol + image;
                } else if (image.startsWith('/')) {
                    image = baseUrl.origin + image;
                } else {
                    image = baseUrl.origin + '/' + image;
                }
            } catch (e) { }
        }

        if (!title && !image) return res.json({ success: false });

        res.json({ success: true, metadata: { title, image } });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});


// --- Socket.io Real-time Logic ---
require('./socket')(io, db);

// Auto Cleanup Routine (Runs every hour)
setInterval(() => {
    try {
        // Find messages deleted more than 7 days ago
        const expiredMessages = db.prepare(`
            SELECT id, type, content, file_thumbnail 
            FROM messages 
            WHERE deleted_at IS NOT NULL 
            AND deleted_at < datetime('now', '-7 days')
        `).all();

        for (const msg of expiredMessages) {
            if (msg.type === 'file') {
                try {
                    const originalPath = path.join(__dirname, '..', msg.content);
                    if (fs.existsSync(originalPath)) fs.unlinkSync(originalPath);

                    if (msg.file_thumbnail) {
                        const thumbPath = path.join(__dirname, '..', msg.file_thumbnail);
                        if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
                    }
                } catch (e) { console.error('Error deleting physical file', e); }
            }

            // Hard delete from database
            db.prepare(`DELETE FROM messages WHERE id = ?`).run(msg.id);
        }

        if (expiredMessages.length > 0) {
            console.log(`[Auto Cleanup] Hard deleted ${expiredMessages.length} expired messages.`);
        }
    } catch (e) {
        console.error('[Auto Cleanup] Error:', e);
    }
}, 60 * 60 * 1000); // Check every hour

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT}`);
});
