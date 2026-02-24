const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Ensure data directory exists
const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'app.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL'); // Enable Write-Ahead Logging for better performance

function initDB() {
    // Users table
    db.prepare(`
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            room_id TEXT,
            is_host BOOLEAN DEFAULT 0,
            joined_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    // Ensure 'system' user exists for system messages
    db.prepare(`
        INSERT OR IGNORE INTO users (id, name, room_id, is_host)
        VALUES ('system', 'System', NULL, 0)
    `).run();

    // Rooms table
    db.prepare(`
        CREATE TABLE IF NOT EXISTS rooms (
            id TEXT PRIMARY KEY,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    // Messages table
    db.prepare(`
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            type TEXT NOT NULL, -- 'text', 'file', 'system'
            content TEXT NOT NULL,
            file_name TEXT,
            file_size INTEGER,
            file_thumbnail TEXT,
            url_metadata TEXT,
            is_pinned INTEGER DEFAULT 0,
            deleted_at DATETIME DEFAULT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (room_id) REFERENCES rooms (id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )
    `).run();

    // Dynamically added columns for existing databases
    try {
        db.prepare(`ALTER TABLE messages ADD COLUMN file_size INTEGER`).run();
    } catch (e) {
        // Column might already exist, ignore
    }

    try {
        db.prepare(`ALTER TABLE messages ADD COLUMN url_metadata TEXT`).run();
    } catch (e) {
        // Column might already exist, ignore
    }

    try {
        db.prepare(`ALTER TABLE messages ADD COLUMN file_thumbnail TEXT`).run();
    } catch (e) {
        // Column might already exist, ignore
    }

    try {
        db.prepare(`ALTER TABLE messages ADD COLUMN deleted_at DATETIME DEFAULT NULL`).run();
    } catch (e) {
        // Column might already exist, ignore
    }

    // Create indexes for faster queries
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_users_room ON users(room_id)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_messages_pinned ON messages(is_pinned)`).run();

    console.log('Database initialized successfully.');
}

// Immediately initialize on require
initDB();

module.exports = db;
