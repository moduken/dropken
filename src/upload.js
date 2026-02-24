const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Blocked extensions at the backend level
const BLOCKED_EXTENSIONS = [
    '.exe', '.bat', '.cmd', '.sh', '.vbs', '.msi', '.dll', '.scr', '.pif', '.application', '.gadget', '.com', '.cpl', '.jar'
];

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const roomId = req.body.room_id || 'unassigned';
        const roomDir = path.join(uploadsDir, roomId);

        if (!fs.existsSync(roomDir)) {
            fs.mkdirSync(roomDir, { recursive: true });
        }
        cb(null, roomDir);
    },
    filename: (req, file, cb) => {
        // Create a unique filename: timestamp-originalName
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});

const fileFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (BLOCKED_EXTENSIONS.includes(ext)) {
        return cb(new Error('File extension not allowed for security reasons.'), false);
    }
    cb(null, true);
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    // No size limits as per requirements
});

module.exports = upload;
