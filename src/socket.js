const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

module.exports = function (io, db) {
    // Utility to log a system message
    function addSystemMessage(roomId, content) {
        // user_id = 'system'
        const sysId = 'system';

        // Prevent foreign key constraint errors if room was destroyed
        const roomExists = db.prepare('SELECT id FROM rooms WHERE id = ?').get(roomId);
        if (!roomExists) return;

        const result = db.prepare(`
            INSERT INTO messages (room_id, user_id, type, content, is_pinned)
            VALUES (?, ?, 'system', ?, 0)
        `).run(roomId, sysId, content);

        const msg = db.prepare(`SELECT * FROM messages WHERE id = ?`).get(result.lastInsertRowid);
        io.to(roomId).emit('new_message', msg);
    }

    io.on('connection', (socket) => {
        console.log('User connected:', socket.id);

        // 1. Join Room (Scan QR Join or Click Create)
        socket.on('join_room', ({ userId, roomId }) => {
            if (!userId) return;

            let finalRoomId = roomId;

            // If no roomId provided, we create a new room
            if (!finalRoomId) {
                finalRoomId = `room-${uuidv4()}`;
                db.prepare('INSERT INTO rooms (id) VALUES (?)').run(finalRoomId);

                // User becomes host
                db.prepare(`
                    UPDATE users SET room_id = ?, is_host = 1, joined_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `).run(finalRoomId, userId);

                socket.join(finalRoomId);
                addSystemMessage(finalRoomId, 'Room created.');
            } else {
                // Joining existing room
                const roomExists = db.prepare('SELECT id FROM rooms WHERE id = ?').get(finalRoomId);
                if (!roomExists) {
                    socket.emit('error', 'Room does not exist.');
                    return;
                }

                const existingUser = db.prepare('SELECT room_id, is_host FROM users WHERE id = ?').get(userId);
                const isAlreadyInRoom = existingUser && existingUser.room_id === finalRoomId;

                if (!isAlreadyInRoom) {
                    // Check if they need to leave a previous room first
                    if (existingUser && existingUser.room_id) {
                        handleUserLeave(userId, false, '', true); // soft leave to swap rooms
                    }

                    db.prepare(`
                        UPDATE users SET room_id = ?, is_host = 0, joined_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                    `).run(finalRoomId, userId);

                    const user = db.prepare('SELECT name FROM users WHERE id = ?').get(userId);
                    addSystemMessage(finalRoomId, `${user.name} joined the room.`);
                }

                socket.join(finalRoomId);
            }

            // Send updated room state to all in room
            broadcastRoomState(finalRoomId);
        });

        // 2. Chat Messaging
        socket.on('send_message', ({ userId, content, url_metadata }) => {
            const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
            if (!user || !user.room_id) return;

            const rId = user.room_id;
            const metadataStr = url_metadata ? JSON.stringify(url_metadata) : null;

            const result = db.prepare(`
                INSERT INTO messages (room_id, user_id, type, content, url_metadata, is_pinned)
                VALUES (?, ?, 'text', ?, ?, 0)
            `).run(rId, userId, content, metadataStr);

            const message = db.prepare(`
                SELECT m.*, u.name as user_name 
                FROM messages m 
                JOIN users u ON m.user_id = u.id 
                WHERE m.id = ?
            `).get(result.lastInsertRowid);

            io.to(rId).emit('new_message', message);
        });

        // 3. Pin toggle
        socket.on('toggle_pin', ({ userId, messageId }) => {
            const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
            if (!msg) return;

            const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
            if (!user || user.room_id !== msg.room_id) return; // Only users in the same room can pin

            const newPinState = msg.is_pinned ? 0 : 1;
            db.prepare('UPDATE messages SET is_pinned = ? WHERE id = ?').run(newPinState, messageId);

            // Fetch explicitly and broadcast update
            const updatedMsg = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
            io.to(msg.room_id).emit('message_updated', updatedMsg);
        });

        // 4. Leave/Empty logic
        socket.on('leave_room', ({ userId }) => {
            handleUserLeave(userId);
        });

        socket.on('disconnect', () => {
            // Hard to reliably track user id via disconnect in this simple architecture, 
            // relying on frontend 'unload' event to trigger 'leave_room'. 
            // Socket disconnection doesn't necessarily mean leaving a permanent room.
        });

        // 5. Kick logic
        socket.on('kick_member', ({ actionUserId, targetUserId }) => {
            const actioner = db.prepare('SELECT * FROM users WHERE id = ?').get(actionUserId);
            const target = db.prepare('SELECT * FROM users WHERE id = ?').get(targetUserId);

            if (!actioner || !target || actioner.room_id !== target.room_id) return;

            // Only host can kick the host (impossible). Members CANNOT kick host.
            if (target.is_host && !actioner.is_host) {
                socket.emit('error', 'You cannot kick the Host.');
                return;
            }

            // Valid kick
            io.to(target.room_id).emit('user_kicked', { userId: targetUserId }); // Tell that specific frontend to reset
            handleUserLeave(targetUserId, true, actioner.name);
        });

        // 6. Pairing Invite logic (A invites B via Token)
        socket.on('invite_paired_device', ({ hostId, targetToken }) => {
            const hostUser = db.prepare('SELECT room_id FROM users WHERE id = ?').get(hostId);
            if (!hostUser || !hostUser.room_id) return;

            // token looks like: pairing:UUID
            const targetId = targetToken.replace('pairing:', '');

            // Force the target user into the host's room via socket emit directed to everyone
            // Since we don't map socket.id to userId persistently here, we broadcast a "pull_in" event
            // to all clients. The specific client with 'targetId' will respond by joining.
            io.emit('force_join_room', { targetUserId: targetId, roomId: hostUser.room_id });
        });

        // 7. Pagination
        socket.on('load_more_messages', ({ roomId, beforeId, limit = 20 }) => {
            const msg = db.prepare('SELECT created_at, id FROM messages WHERE id = ?').get(beforeId);
            if (!msg) return;

            const messages = db.prepare(`
                SELECT * FROM (
                    SELECT m.*, u.name as user_name 
                    FROM messages m 
                    LEFT JOIN users u ON m.user_id = u.id 
                    WHERE m.room_id = ? AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?))
                    ORDER BY m.created_at DESC, m.id DESC
                    LIMIT ?
                ) ORDER BY created_at ASC, id ASC
            `).all(roomId, msg.created_at, msg.created_at, msg.id, limit);

            socket.emit('more_messages_loaded', messages);
        });

        // 8. Delete Messages
        socket.on('soft_delete_messages', ({ userId, messageIds }) => {
            const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
            if (!user || !user.room_id || !messageIds || messageIds.length === 0) return;

            const placeholders = messageIds.map(() => '?').join(',');

            if (user.is_host) {
                // Feature 1: Host performs Hard Delete directly
                // Find files to delete from disk
                const msgs = db.prepare(`SELECT * FROM messages WHERE id IN (${placeholders}) AND room_id = ?`).all(...messageIds, user.room_id);
                msgs.forEach(m => {
                    if (m.type === 'file') {
                        // m.content is expected to be `/uploads/{roomId}/{filename}`
                        // m.file_thumbnail is expected to be `/uploads/{roomId}/{thumbFilename}`
                        try {
                            if (m.content) {
                                const filePath = path.join(__dirname, '..', decodeURIComponent(m.content));
                                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                            }
                            if (m.file_thumbnail) {
                                const thumbPath = path.join(__dirname, '..', decodeURIComponent(m.file_thumbnail));
                                if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
                            }
                        } catch (e) { console.error('Error deleting file', e); }
                    }
                });

                db.prepare(`DELETE FROM messages WHERE id IN (${placeholders}) AND room_id = ?`).run(...messageIds, user.room_id);
                io.to(user.room_id).emit('messages_hard_deleted', { messageIds });
            } else {
                // Feature 2: Regular user performs Soft Delete on ANY message in the room
                db.prepare(`UPDATE messages SET deleted_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders}) AND room_id = ?`).run(...messageIds, user.room_id);
                io.to(user.room_id).emit('messages_deleted', { messageIds });
            }
        });

        // 9. Restore Messages (Host only)
        socket.on('restore_messages', ({ userId, messageIds }) => {
            const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
            if (!user || !user.is_host || !user.room_id || !messageIds || messageIds.length === 0) return;

            const placeholders = messageIds.map(() => '?').join(',');
            db.prepare(`UPDATE messages SET deleted_at = NULL WHERE id IN (${placeholders}) AND room_id = ?`).run(...messageIds, user.room_id);

            io.to(user.room_id).emit('messages_restored', { messageIds });
        });

        // 10. Restore All Messages (Host only)
        socket.on('restore_all_messages', ({ userId }) => {
            const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
            if (!user || !user.is_host || !user.room_id) return;

            db.prepare(`UPDATE messages SET deleted_at = NULL WHERE room_id = ? AND deleted_at IS NOT NULL`).run(user.room_id);
            io.to(user.room_id).emit('all_messages_restored');
        });

        // --- Helpers ---
        function broadcastRoomState(roomId) {
            const members = db.prepare('SELECT id, name, is_host FROM users WHERE room_id = ?').all(roomId);
            const messages = db.prepare(`
                SELECT * FROM (
                    SELECT m.*, u.name as user_name 
                    FROM messages m 
                    LEFT JOIN users u ON m.user_id = u.id 
                    WHERE m.room_id = ?
                    ORDER BY m.created_at DESC, m.id DESC
                    LIMIT 20
                ) ORDER BY created_at ASC, id ASC
            `).all(roomId);

            const pinnedMessages = db.prepare(`
                SELECT m.*, u.name as user_name 
                FROM messages m 
                LEFT JOIN users u ON m.user_id = u.id 
                WHERE m.room_id = ? AND m.is_pinned = 1
                ORDER BY m.created_at ASC, m.id ASC
            `).all(roomId);

            io.to(roomId).emit('room_data', { roomId, members, messages, pinnedMessages });
        }

        function handleUserLeave(userId, wasKicked = false, kickerName = '', isSwapping = false) {
            const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
            if (!user || !user.room_id) return;

            const rId = user.room_id;
            const uname = user.name;
            const wasHost = user.is_host;

            // Remove from room
            db.prepare('UPDATE users SET room_id = NULL, is_host = 0 WHERE id = ?').run(userId);

            // Note: because socket.id map isn't kept here, we can't reliably socket.leave(rId).
            // But frontend handles routing back to home.

            // Send notification
            if (wasKicked) {
                addSystemMessage(rId, `${uname} was kicked by ${kickerName}.`);
            } else {
                addSystemMessage(rId, `${uname} left the room.`);
            }

            // Check if room is empty
            const remaining = db.prepare('SELECT * FROM users WHERE room_id = ? ORDER BY joined_at ASC').all(rId);

            if (remaining.length === 0) {
                // 💥 Destroy the room completely
                db.prepare('DELETE FROM rooms WHERE id = ?').run(rId);
                // Messages are cascade-deleted by foreign key

                // Clean up files manually
                const roomUploadDir = path.join(__dirname, '../uploads', rId);
                if (fs.existsSync(roomUploadDir)) {
                    fs.rmSync(roomUploadDir, { recursive: true, force: true });
                }
                console.log(`Room ${rId} and files destroyed.`);
            } else if (wasHost) {
                // Transfer host to longest-tenured member
                const newHost = remaining[0];
                db.prepare('UPDATE users SET is_host = 1 WHERE id = ?').run(newHost.id);
                addSystemMessage(rId, `${newHost.name} is now the Host.`);
                broadcastRoomState(rId);
            } else {
                // Room still active, update state
                broadcastRoomState(rId);
            }
        }
    });
};
