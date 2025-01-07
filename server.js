const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server);
const port = 3000;

// Veritabanı bağlantısı
const db = new sqlite3.Database('voice_chat_database.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
        console.error('Veritabanı bağlantı hatası:', err);
    } else {
        console.log('Veritabanına bağlandı');
        
        // Tablo kontrolü ve oluşturma
        db.serialize(() => {
            // Admin tablosu
            db.run(`CREATE TABLE IF NOT EXISTS admin_table (
                admin_id INTEGER PRIMARY KEY AUTOINCREMENT,
                admin_name TEXT UNIQUE NOT NULL,
                admin_password TEXT NOT NULL
            )`).get("SELECT COUNT(*) as count FROM admin_table", [], (err, result) => {
                if (err) {
                    console.error('Admin tablosu kontrol hatası:', err);
                } else if (result.count === 0) {
                    // Sadece tablo boşsa admin hesabı oluştur
                    db.run("INSERT INTO admin_table (admin_name, admin_password) VALUES (?, ?)", 
                        ["admin", "admin123"], (err) => {
                        if (err) {
                            console.error('Varsayılan admin oluşturma hatası:', err);
                        } else {
                            console.log('Varsayılan admin hesabı oluşturuldu');
                        }
                    });
                }
            });
            
            // Kullanıcı tablosu
            db.run(`CREATE TABLE IF NOT EXISTS user_table (
                user_id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_name TEXT UNIQUE NOT NULL,
                user_mail TEXT UNIQUE NOT NULL,
                user_password TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`, (err) => {
                if (err) {
                    console.error('Kullanıcı tablosu oluşturma hatası:', err);
                } else {
                    console.log('Kullanıcı tablosu hazır');
                }
            });

            // Server (Oda) tablosu
            db.run(`CREATE TABLE IF NOT EXISTS server_table (
                server_id INTEGER PRIMARY KEY AUTOINCREMENT,
                server_name TEXT NOT NULL,
                server_password TEXT NOT NULL,
                server_description TEXT,
                max_users INTEGER DEFAULT 10,
                is_active BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_by INTEGER,
                FOREIGN KEY(created_by) REFERENCES user_table(user_id)
            )`, (err) => {
                if (err) {
                    console.error('Server tablosu oluşturma hatası:', err);
                } else {
                    console.log('Server tablosu hazır');
                }
            });

            // Server kullanıcıları tablosu
            db.run(`CREATE TABLE IF NOT EXISTS server_users (
                server_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (server_id, user_id),
                FOREIGN KEY (server_id) REFERENCES server_table(server_id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES user_table(user_id) ON DELETE CASCADE
            )`, (err) => {
                if (err) {
                    console.error('Server kullanıcıları tablosu oluşturma hatası:', err);
                } else {
                    console.log('Server kullanıcıları tablosu hazır');
                }
            });
        });
    }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// WebSocket bağlantıları
const connectedUsers = new Map(); // userId -> socket
const serverRooms = new Map();    // serverId -> Set(userId)
const userStreams = new Map();    // userId -> {audio: boolean, screen: boolean}

io.on('connection', (socket) => {
    console.log('Yeni bağlantı:', socket.id);
    
    // Kullanıcı server'a katıldı
    socket.on('joinServer', async ({ userId, username, serverId }) => {
        console.log(`${username} (${userId}) ${serverId} ID'li server'a katıldı`);
        
        // Kullanıcıyı socket ile eşle
        connectedUsers.set(userId, socket);
        
        // Kullanıcı stream durumunu başlat
        userStreams.set(userId, { audio: false });
        
        // Server odasını oluştur veya mevcut odaya ekle
        if (!serverRooms.has(serverId)) {
            serverRooms.set(serverId, new Set());
        }
        serverRooms.get(serverId).add(userId);
        
        // Socket'i odaya ekle
        socket.join(`server_${serverId}`);
        
        // Odadaki diğer kullanıcılara yeni kullanıcıyı bildir
        socket.to(`server_${serverId}`).emit('userJoined', {
            userId,
            username
        });
        
        // Yeni kullanıcıya odadaki mevcut kullanıcıları gönder
        const usersInRoom = [];
        for (const uid of serverRooms.get(serverId)) {
            if (uid !== userId) {
                const username = await getUsernameFromId(uid);
                if (username) {
                    const streams = userStreams.get(uid);
                    usersInRoom.push({ 
                        userId: uid, 
                        username,
                        streams
                    });
                }
            }
        }
        socket.emit('currentUsers', usersInRoom);

        // Tüm bağlı kullanıcılara server listesinin güncellendiğini bildir
        io.emit('serverListUpdated');
    });
    
    // WebRTC sinyali
    socket.on('signal', ({ targetId, signal }) => {
        console.log('Sinyal alındı:', signal.type || 'ICE candidate');
        const targetSocket = connectedUsers.get(targetId);
        if (targetSocket) {
            const sourceUserId = Array.from(connectedUsers.entries())
                .find(([_, s]) => s === socket)?.[0];
                
            if (sourceUserId) {
                // Stream durumunu güncelle
                if (signal.type === 'offer') {
                    const streams = userStreams.get(sourceUserId);
                    if (streams) {
                        streams.screen = signal.sdp.includes('screen');
                        userStreams.set(sourceUserId, streams);
                    }
                }
                
                // Sinyali hedef kullanıcıya ilet
                targetSocket.emit('signal', {
                    userId: sourceUserId,
                    signal
                });
            }
        } else {
            console.error('Hedef kullanıcı bulunamadı:', targetId);
            // Kaynak kullanıcıya hata bildir
            socket.emit('signalError', {
                targetId,
                error: 'Kullanıcı bulunamadı'
            });
        }
    });

    // Ekran paylaşımı durdu
    socket.on('screenShareStopped', ({ targetId }) => {
        const sourceUserId = Array.from(connectedUsers.entries())
            .find(([_, s]) => s === socket)?.[0];
            
        if (sourceUserId) {
            const streams = userStreams.get(sourceUserId);
            if (streams) {
                streams.screen = false;
                userStreams.set(sourceUserId, streams);
            }
        }
        
        const targetSocket = connectedUsers.get(targetId);
        if (targetSocket) {
            targetSocket.emit('screenShareStopped');
        }
    });

    // Ekran paylaşımı sinyali
    socket.on('screenShare', async ({ userId, type }) => {
        console.log('Ekran paylaşımı sinyali alındı:', { type, serverId });
        // Server odasındaki diğer kullanıcılara bildir
        socket.to(`server_${serverId}`).emit('screenShare', {
            userId,
            type
        });
    });

    // Ekran görüntüsü geldiğinde
    socket.on('screenData', ({ serverId, imageData }) => {
        console.log('Ekran görüntüsü alındı, diğer kullanıcılara gönderiliyor...');
        // Server odasındaki diğer kullanıcılara gönder
        socket.to(`server_${serverId}`).emit('screenData', { imageData });
    });

    // Ekran paylaşımı durduğunda
    socket.on('screenShareStopped', ({ serverId }) => {
        console.log('Ekran paylaşımı durdurma sinyali alındı');
        // Server odasındaki diğer kullanıcılara bildir
        socket.to(`server_${serverId}`).emit('screenShareStopped');
    });

    // Bağlantı koptu
    socket.on('disconnect', () => {
        console.log('Bağlantı koptu:', socket.id);
        
        const userId = Array.from(connectedUsers.entries())
            .find(([_, s]) => s === socket)?.[0];
            
        if (userId) {
            // Stream durumunu temizle
            userStreams.delete(userId);
            
            // Tüm server'lardan çıkar
            serverRooms.forEach((users, serverId) => {
                if (users.has(userId)) {
                    users.delete(userId);
                    socket.to(`server_${serverId}`).emit('userLeft', { userId });
                    if (users.size === 0) {
                        serverRooms.delete(serverId);
                    }
                }
            });
            
            connectedUsers.delete(userId);

            // Tüm bağlı kullanıcılara server listesinin güncellendiğini bildir
            io.emit('serverListUpdated');
        }
    });

    // Server'dan ayrılma
    socket.on('leaveServer', ({ userId, serverId }) => {
        handleUserLeave(userId, serverId);
        // Tüm bağlı kullanıcılara server listesinin güncellendiğini bildir
        io.emit('serverListUpdated');
    });

    // Sohbet mesajı geldiğinde
    socket.on('chatMessage', (message) => {
        // Mesajı aynı server'daki diğer kullanıcılara ilet
        socket.to(`server_${message.serverId}`).emit('chatMessage', message);
    });
});

// Kullanıcı ayrılma işlemleri
function handleUserLeave(userId, serverId) {
    const users = serverRooms.get(serverId);
    if (users) {
        users.delete(userId);
        if (users.size === 0) {
            serverRooms.delete(serverId);
        }
        
        const socket = connectedUsers.get(userId);
        if (socket) {
            socket.leave(`server_${serverId}`);
            socket.to(`server_${serverId}`).emit('userLeft', { userId });
        }
    }
}

// Kullanıcı adını ID'den al
async function getUsernameFromId(userId) {
    return new Promise((resolve, reject) => {
        const query = 'SELECT user_name FROM user_table WHERE user_id = ?';
        db.get(query, [userId], (err, row) => {
            if (err) {
                console.error('Kullanıcı adı sorgulama hatası:', err);
                reject(err);
            } else {
                resolve(row ? row.user_name : null);
            }
        });
    });
}

// Ana sayfa yönlendirmesi
app.get('/', (req, res) => {
    res.redirect('/login.html');
});

// Admin girişi
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    
    const query = `SELECT admin_id, admin_name FROM admin_table 
                  WHERE admin_name = ? AND admin_password = ?`;
    
    db.get(query, [username, password], (err, admin) => {
        if (err) {
            console.error('Admin giriş hatası:', err);
            res.status(500).json({ error: 'Veritabanı hatası' });
            return;
        }
        
        if (admin) {
            res.json({
                success: true,
                admin: {
                    id: admin.admin_id,
                    username: admin.admin_name,
                    token: 'dummy-token'
                }
            });
        } else {
            res.json({ success: false });
        }
    });
});

// Tüm kullanıcıları getir
app.get('/api/admin/users', (req, res) => {
    const query = `SELECT user_id, user_name, user_mail, created_at FROM user_table`;
    
    db.all(query, [], (err, users) => {
        if (err) {
            console.error('Kullanıcı listesi hatası:', err);
            res.status(500).json({ error: 'Veritabanı hatası' });
            return;
        }
        res.json({ success: true, users });
    });
});

// Kullanıcı güncelle
app.put('/api/admin/users/:id', (req, res) => {
    const userId = req.params.id;
    const { username, email, password } = req.body;
    
    let query, params;
    
    if (password && password.trim() !== '') {
        query = `UPDATE user_table 
                SET user_name = ?, user_mail = ?, user_password = ? 
                WHERE user_id = ?`;
        params = [username, email, password, userId];
    } else {
        query = `UPDATE user_table 
                SET user_name = ?, user_mail = ? 
                WHERE user_id = ?`;
        params = [username, email, userId];
    }
    
    db.run(query, params, function(err) {
        if (err) {
            console.error('Kullanıcı güncelleme hatası:', err);
            res.status(500).json({ error: 'Güncelleme hatası' });
            return;
        }
        res.json({ success: true });
    });
});

// Kullanıcı sil
app.delete('/api/admin/users/:id', (req, res) => {
    const userId = req.params.id;
    
    const query = `DELETE FROM user_table WHERE user_id = ?`;
    
    db.run(query, [userId], function(err) {
        if (err) {
            console.error('Kullanıcı silme hatası:', err);
            res.status(500).json({ error: 'Silme hatası' });
            return;
        }
        res.json({ success: true });
    });
});

// Giriş endpoint'i
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    const query = `SELECT user_id, user_name, user_mail FROM user_table 
                  WHERE user_name = ? AND user_password = ?`;
    
    db.get(query, [username, password], (err, user) => {
        if (err) {
            res.status(500).json({ error: 'Veritabanı hatası' });
            return;
        }
        
        if (user) {
            res.json({
                success: true,
                user: {
                    id: user.user_id,
                    username: user.user_name,
                    email: user.user_mail
                }
            });
        } else {
            res.json({ success: false });
        }
    });
});

// Kayıt endpoint'i
app.post('/api/register', (req, res) => {
    const { username, email, password } = req.body;
    
    // Önce kullanıcı adı ve email kontrolü
    const checkQuery = `SELECT user_name, user_mail FROM user_table 
                      WHERE user_name = ? OR user_mail = ?`;
    
    db.get(checkQuery, [username, email], (err, existingUser) => {
        if (err) {
            res.status(500).json({ error: 'Veritabanı hatası' });
            return;
        }
        
        if (existingUser) {
            if (existingUser.user_name === username) {
                res.json({ error: 'Bu kullanıcı adı zaten kullanılıyor!' });
            } else {
                res.json({ error: 'Bu e-posta adresi zaten kullanılıyor!' });
            }
            return;
        }
        
        // Yeni kullanıcı kaydı
        const insertQuery = `INSERT INTO user_table (user_name, user_mail, user_password) 
                           VALUES (?, ?, ?)`;
        
        db.run(insertQuery, [username, email, password], function(err) {
            if (err) {
                res.status(500).json({ error: 'Kayıt sırasında bir hata oluştu' });
                return;
            }
            res.json({ success: true });
        });
    });
});

// Server listesini getir (Admin için tüm bilgiler)
app.get('/api/admin/servers', (req, res) => {
    const query = `SELECT server_table.*, user_table.user_name as creator_name 
                  FROM server_table 
                  LEFT JOIN user_table ON server_table.created_by = user_table.user_id`;
    
    db.all(query, [], (err, servers) => {
        if (err) {
            console.error('Server listesi hatası:', err);
            res.status(500).json({ error: 'Veritabanı hatası' });
            return;
        }
        res.json({ success: true, servers });
    });
});

// Server oluştur (Admin)
app.post('/api/admin/servers', (req, res) => {
    const { name, password, description, maxUsers } = req.body;
    
    const query = `INSERT INTO server_table (server_name, server_password, server_description, max_users) 
                  VALUES (?, ?, ?, ?)`;
    
    db.run(query, [name, password, description, maxUsers], function(err) {
        if (err) {
            console.error('Server oluşturma hatası:', err);
            res.status(500).json({ error: 'Server oluşturma hatası' });
            return;
        }
        res.json({ success: true, serverId: this.lastID });
    });
});

// Server güncelle (Admin)
app.put('/api/admin/servers/:id', (req, res) => {
    const serverId = req.params.id;
    const { name, password, description, maxUsers, isActive } = req.body;
    
    const query = `UPDATE server_table 
                  SET server_name = ?, 
                      server_password = ?, 
                      server_description = ?, 
                      max_users = ?,
                      is_active = ?
                  WHERE server_id = ?`;
    
    db.run(query, [name, password, description, maxUsers, isActive, serverId], function(err) {
        if (err) {
            console.error('Server güncelleme hatası:', err);
            res.status(500).json({ error: 'Server güncelleme hatası' });
            return;
        }
        res.json({ success: true });
    });
});

// Server sil (Admin)
app.delete('/api/admin/servers/:id', (req, res) => {
    const serverId = req.params.id;
    
    const query = `DELETE FROM server_table WHERE server_id = ?`;
    
    db.run(query, [serverId], function(err) {
        if (err) {
            console.error('Server silme hatası:', err);
            res.status(500).json({ error: 'Server silme hatası' });
            return;
        }
        res.json({ success: true });
    });
});

// Aktif serverleri listele (Kullanıcılar için)
app.get('/api/servers', (req, res) => {
    const query = `SELECT server_id, server_name, server_description, max_users 
                  FROM server_table 
                  WHERE is_active = 1`;
    
    db.all(query, [], (err, servers) => {
        if (err) {
            console.error('Server listesi hatası:', err);
            res.status(500).json({ error: 'Veritabanı hatası' });
            return;
        }
        res.json({ success: true, servers });
    });
});

// Server'a giriş yap (Kullanıcılar için)
app.post('/api/servers/join', (req, res) => {
    const { serverId, password } = req.body;
    const authHeader = req.headers.authorization;
    
    console.log('Join isteği:', { serverId, authHeader });
    
    let userId;
    try {
        const authData = JSON.parse(authHeader);
        userId = authData.userId;
        console.log('Parsed userId:', userId);
    } catch (error) {
        console.error('Auth header parse hatası:', error);
        res.status(400).json({ success: false, error: 'Geçersiz oturum bilgisi' });
        return;
    }
    
    if (!userId) {
        res.status(401).json({ success: false, error: 'Oturum bilgisi bulunamadı' });
        return;
    }
    
    const query = `SELECT s.*, COUNT(u.user_id) as current_users
                  FROM server_table s
                  LEFT JOIN server_users u ON s.server_id = u.server_id
                  WHERE s.server_id = ? AND s.server_password = ? AND s.is_active = 1
                  GROUP BY s.server_id`;
    
    db.get(query, [serverId, password], (err, server) => {
        if (err) {
            console.error('Server sorgu hatası:', err);
            res.status(500).json({ error: 'Veritabanı hatası' });
            return;
        }
        
        if (!server) {
            res.json({ success: false, error: 'Geçersiz server ID veya şifre!' });
            return;
        }
        
        if (server.current_users >= server.max_users) {
            res.json({ success: false, error: 'Server dolu!' });
            return;
        }
        
        // Önce kullanıcının zaten server'da olup olmadığını kontrol et
        db.get('SELECT * FROM server_users WHERE server_id = ? AND user_id = ?', 
            [serverId, userId], (err, existingUser) => {
            if (err) {
                console.error('Kullanıcı kontrol hatası:', err);
                res.status(500).json({ error: 'Veritabanı hatası' });
                return;
            }
            
            if (existingUser) {
                res.json({ success: true, server }); // Zaten server'da
                return;
            }
            
            // Kullanıcıyı server'a ekle
            db.run('INSERT INTO server_users (server_id, user_id) VALUES (?, ?)',
                [serverId, userId], (err) => {
                if (err) {
                    console.error('Kullanıcı ekleme hatası:', err);
                    res.status(500).json({ error: 'Kullanıcı eklenirken hata oluştu' });
                    return;
                }
                console.log('Kullanıcı başarıyla eklendi:', { serverId, userId });
                res.json({ success: true, server });
            });
        });
    });
});

// Server'dan ayrılma endpoint'i
app.post('/api/servers/leave', (req, res) => {
    const { serverId } = req.body;
    const userId = JSON.parse(req.headers.authorization || '{}').userId;
    
    if (!userId) {
        res.json({ success: false, error: 'Oturum hatası!' });
        return;
    }
    
    db.run('DELETE FROM server_users WHERE server_id = ? AND user_id = ?',
        [serverId, userId], (err) => {
        if (err) {
            res.status(500).json({ error: 'Veritabanı hatası' });
            return;
        }
        res.json({ success: true });
    });
});

// Server'daki kullanıcı sayısını getir
app.get('/api/servers/:id/users', (req, res) => {
    const serverId = req.params.id;
    
    const query = `SELECT COUNT(*) as count FROM server_users WHERE server_id = ?`;
    
    db.get(query, [serverId], (err, result) => {
        if (err) {
            console.error('Kullanıcı sayısı sorgulama hatası:', err);
            res.status(500).json({ error: 'Veritabanı hatası' });
            return;
        }
        res.json({ success: true, count: result.count });
    });
});

// HTML5 History API desteği için tüm rotaları login.html'e yönlendir
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Uygulama kapatıldığında veritabanı bağlantısını kapat
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error('Veritabanı kapatma hatası:', err);
        } else {
            console.log('Veritabanı bağlantısı kapatıldı');
        }
        process.exit(0);
    });
});

// Sunucuyu başlat
server.listen(port, () => {
    console.log(`Sunucu http://localhost:${port} adresinde çalışıyor`);
}); 