const API_URL = 'http://localhost:3000/api';
const CURRENT_USER_KEY = 'clions_current_user';
let currentServer = null;
let socket = null;
let localStream = null;
let peerConnections = new Map(); // userId -> RTCPeerConnection

// Sohbet mesajlarını saklamak için
let chatMessages = [];

// Ses ve mikrofon durumları
let isMuted = false;
let isDeafened = false;
let notificationSound;
let enterChannelSound;
let outChannelSound;

// Sayfa yüklendiğinde
document.addEventListener('DOMContentLoaded', () => {
    // Sesleri yükle
    notificationSound = new Audio('notification.mp3');
    enterChannelSound = new Audio('enter_channel.mp3');
    outChannelSound = new Audio('out_channel.mp3');
    
    notificationSound.load();
    enterChannelSound.load();
    outChannelSound.load();

    checkAuth();
    loadServers();
    setupEventListeners();
    
    // WebSocket bağlantısını başlat
    initializeWebSocket();

    // Dark mode durumunu kontrol et
    const currentTheme = localStorage.getItem('theme');
    if (currentTheme) {
        document.documentElement.setAttribute('data-theme', currentTheme);
        const checkbox = document.getElementById('checkbox');
        if (checkbox) {
            checkbox.checked = currentTheme === 'dark';
        }
    }

    // Dark mode event listener'ı ekle
    const checkbox = document.getElementById('checkbox');
    if (checkbox) {
        checkbox.addEventListener('change', toggleDarkMode);
    }

    // Sohbet formu için event listener
    const chatForm = document.getElementById('chatForm');
    const messageInput = document.getElementById('messageInput');
    
    if (chatForm && messageInput) {
        chatForm.addEventListener('submit', (e) => {
            e.preventDefault();
            
            const message = messageInput.value.trim();
            if (message && socket) {
                const currentUser = JSON.parse(localStorage.getItem(CURRENT_USER_KEY));
                const messageData = {
                    userId: currentUser.id,
                    username: currentUser.username,
                    text: message,
                    timestamp: new Date().toISOString(),
                    serverId: currentServer.server_id
                };
                
                // Mesajı gönder
                socket.emit('chatMessage', messageData);
                
                // Mesajı hemen göster
                addMessageToChat(messageData);
                
                // Input'u temizle
                messageInput.value = '';
            }
        });
    }
});

// WebSocket bağlantısını başlat
function initializeWebSocket() {
    try {
        if (!socket) {
            socket = io('http://localhost:3000');
            
            socket.on('connect', () => {
                console.log('WebSocket bağlantısı kuruldu');
            });
            
            // Server listesi güncellendiğinde
            socket.on('serverListUpdated', () => {
                // Eğer bir server'da değilsek listeyi güncelle
                if (!currentServer) {
                    // Mevcut server listesini temizle
                    const serverList = document.getElementById('serverList');
                    if (serverList) {
                        serverList.innerHTML = '';
                    }
                    // Server listesini yeniden yükle
                    loadServers();
                }
            });
            
            socket.on('userJoined', async ({ userId, username }) => {
                console.log('Yeni kullanıcı katıldı:', username);
                addUserToList(userId, username);
                
                // Server'da olanlara giriş sesi çal
                if (currentServer && !isDeafened) {
                    try {
                        enterChannelSound.currentTime = 0;
                        enterChannelSound.play().catch(e => {
                            console.error('Giriş sesi çalma hatası:', e);
                        });
                    } catch (error) {
                        console.error('Giriş sesi hatası:', error);
                    }
                }
                
                try {
                    const pc = await createPeerConnection(userId);
                    if (pc) {
                        const offer = await pc.createOffer({
                            offerToReceiveAudio: true,
                            offerToReceiveVideo: false
                        });
                        await pc.setLocalDescription(offer);
                        
                        socket.emit('signal', {
                            targetId: userId,
                            signal: pc.localDescription
                        });
                    }
                } catch (error) {
                    console.error('Offer oluşturma hatası:', error);
                }
            });
            
            socket.on('userLeft', ({ userId }) => {
                removeUserFromList(userId);
                closePeerConnection(userId);
                
                // Server'da olanlara çıkış sesi çal
                if (currentServer && !isDeafened) {
                    try {
                        outChannelSound.currentTime = 0;
                        outChannelSound.play().catch(e => {
                            console.error('Çıkış sesi çalma hatası:', e);
                        });
                    } catch (error) {
                        console.error('Çıkış sesi hatası:', error);
                    }
                }
            });
            
            socket.on('currentUsers', async (users) => {
                const userList = document.getElementById('userList');
                if (userList) {
                    userList.innerHTML = '';
                    const currentUser = JSON.parse(localStorage.getItem(CURRENT_USER_KEY));
                    
                    // Önce kendimizi ekleyelim
                    addUserToList(currentUser.id, currentUser.username);
                    
                    // Diğer kullanıcıları ekleyelim
                    for (const user of users) {
                        if (user.userId !== currentUser.id) {
                            addUserToList(user.userId, user.username);
                            await createPeerConnection(user.userId);
                        }
                    }
                }
            });
            
            socket.on('signal', async ({ userId, signal }) => {
                try {
                    let pc = peerConnections.get(userId);
                    
                    if (!pc) {
                        pc = await createPeerConnection(userId);
                        if (!pc) return;
                    }

                    if (signal.type === 'offer') {
                        if (pc.signalingState !== 'stable') {
                            console.log('Signaling durumu stabil değil, rollback yapılıyor...');
                            await Promise.all([
                                pc.setLocalDescription({ type: 'rollback' }),
                                pc.setRemoteDescription(signal)
                            ]);
                        } else {
                            await pc.setRemoteDescription(signal);
                        }
                        
                        const answer = await pc.createAnswer();
                        await pc.setLocalDescription(answer);
                        
                        socket.emit('signal', {
                            targetId: userId,
                            signal: pc.localDescription
                        });
                    }
                    else if (signal.type === 'answer') {
                        if (pc.signalingState === 'have-local-offer') {
                            await pc.setRemoteDescription(signal);
                        } else {
                            console.log('Answer için yanlış durum:', pc.signalingState);
                        }
                    }
                    else if (signal.candidate) {
                        try {
                            if (pc.remoteDescription) {
                                await pc.addIceCandidate(signal);
                            } else {
                                if (!pc.pendingCandidates) pc.pendingCandidates = [];
                                pc.pendingCandidates.push(signal);
                            }
                        } catch (error) {
                            console.error('ICE aday ekleme hatası:', error);
                        }
                    }

                    if (pc.remoteDescription && pc.pendingCandidates) {
                        const candidates = pc.pendingCandidates;
                        pc.pendingCandidates = [];
                        for (const candidate of candidates) {
                            try {
                                await pc.addIceCandidate(candidate);
                            } catch (error) {
                                console.error('Bekleyen ICE aday ekleme hatası:', error);
                            }
                        }
                    }
                } catch (error) {
                    console.error('Sinyal işleme hatası:', error);
                }
            });

            socket.on('chatMessage', (message) => {
                addMessageToChat(message);
            });
        }
    } catch (error) {
        console.error('WebSocket bağlantı hatası:', error);
    }
}

// Mevcut kullanıcı ID'sini al
function getCurrentUserId() {
    const currentUser = JSON.parse(localStorage.getItem(CURRENT_USER_KEY) || '{}');
    return currentUser.id;
}

// Ses elementlerini yönet
function handleAudioElement(userId, track) {
    try {
        const audioId = `audio-${userId}`;
        let audio = document.getElementById(audioId);
        
        // Eğer element yoksa oluştur
        if (!audio) {
            audio = document.createElement('audio');
            audio.id = audioId;
            audio.autoplay = true;
            audio.style.display = 'none'; // Gizli olsun
            document.body.appendChild(audio);
            console.log('Yeni ses elementi oluşturuldu:', audioId);
        }

        // Stream'i ayarla
        const stream = new MediaStream([track]);
        audio.srcObject = stream;
        
        // Ses elementini oynat
        const playPromise = audio.play();
        if (playPromise !== undefined) {
            playPromise.catch(error => {
                console.warn('Ses oynatma hatası:', error);
                // Kullanıcı etkileşimi gerekiyorsa
                if (error.name === 'NotAllowedError') {
                    console.log('Ses için kullanıcı etkileşimi gerekiyor');
                    // Ses elementini görünür yap ve kullanıcıya bildir
                    audio.style.display = 'block';
                }
            });
        }
    } catch (error) {
        console.error('Ses elementi yönetim hatası:', error);
    }
}

// Ses elementini temizle
function cleanupAudioElement(userId) {
    try {
        const audioId = `audio-${userId}`;
        const audio = document.getElementById(audioId);
        if (audio) {
            audio.pause();
            audio.srcObject = null;
            audio.remove();
            console.log('Ses elementi temizlendi:', audioId);
        }
    } catch (error) {
        console.error('Ses elementi temizleme hatası:', error);
    }
}

// WebRTC bağlantısı oluştur
async function createPeerConnection(userId) {
    if (userId === getCurrentUserId()) return null;
    
    let pc = peerConnections.get(userId);
    if (pc) {
        console.log('Bağlantı zaten var:', userId);
        return pc;
    }
    
    try {
        console.log('Yeni WebRTC bağlantısı oluşturuluyor:', userId);
        
        pc = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
                {
                    urls: 'turn:numb.viagenie.ca',
                    username: 'webrtc@live.com',
                    credential: 'muazkh'
                }
            ],
            iceCandidatePoolSize: 10
        });
        
        peerConnections.set(userId, pc);

        // Ses akışını ekle
        if (localStream) {
            localStream.getTracks().forEach(track => {
                pc.addTrack(track, localStream);
                console.log('Track eklendi:', track.kind);
            });
        }

        // Uzak akışları al
        pc.ontrack = (event) => {
            console.log('Yeni track alındı:', event.track.kind, event.track.id);
            const stream = event.streams[0];

            if (event.track.kind === 'audio' && !event.track.label.includes('screen')) {
                handleAudioElement(userId, event.track);
            } 
            else if (event.track.kind === 'video' || event.track.label.includes('screen')) {
                // DOM elementlerini güvenli bir şekilde al
                const elements = {
                    screenVideo: document.getElementById('screenVideo'),
                    screenShareArea: document.getElementById('screenShareArea'),
                    screenPreview: document.getElementById('screenPreview'),
                    screenViewer: document.getElementById('screenViewer')
                };

                // Eğer herhangi bir element eksikse işlemi durdur
                if (Object.values(elements).some(el => !el)) {
                    console.error('Gerekli video elementleri bulunamadı');
                    return;
                }

                // Yeni bir MediaStream oluştur
                const screenStream = new MediaStream();
                screenStream.addTrack(event.track);
                
                // Eğer ses track'i varsa onu da ekle
                stream.getAudioTracks().forEach(audioTrack => {
                    if (audioTrack.label.includes('screen')) {
                        screenStream.addTrack(audioTrack);
                    }
                });
                
                elements.screenVideo.srcObject = screenStream;
                elements.screenPreview.style.display = 'none';
                elements.screenViewer.style.display = 'block';
                elements.screenShareArea.style.display = 'block';

                // Ses kontrollerini göster
                const volumeControl = document.querySelector('#screenShareArea .volume-control');
                if (volumeControl) {
                    volumeControl.style.display = 'flex';
                    
                    const screenAudioVolume = document.getElementById('screenAudioVolume');
                    if (screenAudioVolume) {
                        screenAudioVolume.oninput = (e) => {
                            elements.screenVideo.volume = e.target.value / 100;
                        };
                    }
                }
            }
        };

        // Bağlantı kapatıldığında
        pc.onconnectionstatechange = () => {
            console.log(`Bağlantı durumu (${userId}):`, pc.connectionState);
            if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
                cleanupAudioElement(userId);
            }
        };

        // ICE adaylarını gönder
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('ICE adayı bulundu');
                socket.emit('signal', {
                    targetId: userId,
                    signal: event.candidate
                });
            }
        };

        return pc;
    } catch (error) {
        console.error('Bağlantı oluşturma hatası:', error);
        cleanupAudioElement(userId);
        closePeerConnection(userId);
        return null;
    }
}

// ICE bağlantısını yeniden başlat
async function restartIce(userId) {
    const pc = peerConnections.get(userId);
    if (!pc) return;
    
    try {
        console.log('ICE bağlantısı yeniden başlatılıyor:', userId);
        
        // ICE yeniden başlatma özelliğini kullan
        const offer = await pc.createOffer({ iceRestart: true });
        await pc.setLocalDescription(offer);
        
        socket.emit('signal', {
            targetId: userId,
            signal: offer
        });
    } catch (error) {
        console.error('ICE yeniden başlatma hatası:', error);
        closePeerConnection(userId);
    }
}

// WebRTC bağlantısını kapat
function closePeerConnection(userId) {
    const pc = peerConnections.get(userId);
    if (pc) {
        pc.close();
        peerConnections.delete(userId);
        cleanupAudioElement(userId);
    }
}

// Kullanıcıyı listeye ekle
function addUserToList(userId, username) {
    const userList = document.getElementById('userList');
    const currentUser = JSON.parse(localStorage.getItem(CURRENT_USER_KEY));
    const isCurrentUser = userId === currentUser.id;
    
    if (!document.getElementById(`user-${userId}`)) {
        const li = document.createElement('li');
        li.id = `user-${userId}`;
        li.className = 'list-group-item';
        li.innerHTML = `
            <span>${username} ${isCurrentUser ? '(Ben)' : ''}</span>
            ${isCurrentUser ? '' : `
            <div class="volume-control">
                <input type="range" min="0" max="100" value="100" 
                    title="Ses Seviyesi"
                    onchange="adjustVolume('${userId}', this.value)"
                    oninput="adjustVolume('${userId}', this.value)">
            </div>
            `}
        `;
        userList.appendChild(li);
    }
    
    // Kullanıcı sayısını güncelle
    updateUserCount();
}

// Kullanıcı sayısını güncelle
function updateUserCount() {
    const userCount = document.getElementById('userList').children.length;
    const userCountElement = document.getElementById('userCount');
    if (userCountElement) {
        userCountElement.textContent = `(${userCount} Kullanıcı)`;
    }
}

// Kullanıcıyı listeden kaldır
function removeUserFromList(userId) {
    const userElement = document.getElementById(`user-${userId}`);
    if (userElement) {
        userElement.remove();
        updateUserCount();
    }
}

// Kullanıcının ses seviyesini ayarla
function adjustVolume(userId, value) {
    const audio = document.getElementById(`audio-${userId}`);
    if (audio) {
        const volume = value / 100;
        audio.volume = volume;
        console.log(`${userId} kullanıcısının ses seviyesi: ${volume}`);
        
        // Ses seviyesi göstergesini güncelle
        const volumeControl = document.querySelector(`#user-${userId} .volume-control input`);
        if (volumeControl) {
            volumeControl.value = value;
            
            // Ses seviyesine göre stil değişiklikleri
            if (volume === 0) {
                volumeControl.style.opacity = '0.5';
            } else {
                volumeControl.style.opacity = '1';
            }
        }
    }
}

// Server'a katıl
async function joinServer() {
    const serverId = document.getElementById('selectedServerId').value;
    const password = document.getElementById('serverPassword').value;

    try {
        // Önce mikrofon erişimi iste
        try {
            console.log('Mikrofon erişimi isteniyor...');
            localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    channelCount: 1
                },
                video: false
            });
            console.log('Mikrofon erişimi başarılı:', localStream.getAudioTracks()[0].enabled);
            
            // Ses kontrollerini başlat
            initializeVoiceChat();
        } catch (error) {
            console.error('Mikrofon erişim hatası:', error);
            alert('Mikrofon erişimi reddedildi! Ses sohbeti için mikrofon izni gereklidir.');
            return;
        }

        const currentUser = JSON.parse(localStorage.getItem(CURRENT_USER_KEY));
        if (!currentUser || !currentUser.id) {
            throw new Error('Oturum bilgisi bulunamadı');
        }

        const response = await fetch(`${API_URL}/servers/join`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': JSON.stringify({ userId: currentUser.id })
            },
            body: JSON.stringify({ serverId, password })
        });

        const data = await response.json();
        if (data.success) {
            currentServer = data.server;
            const modal = bootstrap.Modal.getInstance(document.getElementById('joinServerModal'));
            modal.hide();
            showChatArea();
            
            // WebSocket bağlantısını başlat
            initializeWebSocket();
            
            // WebSocket ile server'a katıl
            if (socket) {
                socket.emit('joinServer', {
                    userId: currentUser.id,
                    username: currentUser.username,
                    serverId: currentServer.server_id
                });
            } else {
                throw new Error('WebSocket bağlantısı kurulamadı');
            }
        } else {
            alert(data.error || 'Server\'a katılırken bir hata oluştu!');
        }
    } catch (error) {
        console.error('Server\'a katılma hatası:', error);
        alert(error.message || 'Server\'a katılırken bir hata oluştu!');
    }
}

// Server'dan ayrıl
async function leaveServer() {
    if (!confirm('Server\'dan ayrılmak istediğinize emin misiniz?')) return;
    
    try {
        const currentUser = JSON.parse(localStorage.getItem(CURRENT_USER_KEY));
        const response = await fetch(`${API_URL}/servers/leave`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': JSON.stringify({ userId: currentUser.id })
            },
            body: JSON.stringify({ serverId: currentServer.server_id })
        });

        const data = await response.json();
        if (data.success) {
            // WebSocket ile ayrılma bilgisi gönder
            if (socket) {
                socket.emit('leaveServer', {
                    userId: currentUser.id,
                    serverId: currentServer.server_id
                });
            }
            
            // Tüm bağlantıları temizle
            cleanupConnections();
            
            currentServer = null;
            document.getElementById('chatArea').style.display = 'none';
            document.getElementById('userList').innerHTML = '';
            // Sunucu listesini tekrar göster
            document.querySelector('.row.mb-4').style.display = 'block';
            
            // Server listesi WebSocket event'i ile güncellenecek
        } else {
            alert(data.error || 'Server\'dan ayrılırken bir hata oluştu!');
        }
    } catch (error) {
        console.error('Server\'dan ayrılma hatası:', error);
        alert('Server\'dan ayrılırken bir hata oluştu!');
    }
}

// Tüm bağlantıları temizle
function cleanupConnections() {
    // WebRTC bağlantılarını kapat
    peerConnections.forEach((pc, userId) => {
        closePeerConnection(userId);
    });
    peerConnections.clear();
    
    // Mikrofonu kapat
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    // Audio elementlerini temizle
    document.querySelectorAll('audio').forEach(audio => audio.remove());
    
    // Butonları sıfırla
    const muteBtn = document.getElementById('muteBtn');
    const deafenBtn = document.getElementById('deafenBtn');
    
    if (muteBtn) {
        muteBtn.classList.remove('active');
        muteBtn.innerHTML = '<i class="fas fa-microphone"></i>';
    }
    
    if (deafenBtn) {
        deafenBtn.classList.remove('active');
        deafenBtn.innerHTML = '<i class="fas fa-headphones"></i>';
    }
    
    isMuted = false;
    isDeafened = false;
}

// Ses kontrollerini başlat
function initializeVoiceChat() {
    const muteBtn = document.getElementById('muteBtn');
    const deafenBtn = document.getElementById('deafenBtn');

    // Başlangıç durumlarını ayarla
    muteBtn.classList.add('active');
    muteBtn.innerHTML = '<i class="fas fa-microphone"></i>';
    
    deafenBtn.classList.add('active');
    deafenBtn.innerHTML = '<i class="fas fa-headphones"></i>';

    // Event listener'ları ekle
    muteBtn.onclick = () => {
        if (localStream) {
            const audioTrack = localStream.getAudioTracks()[0];
            if (audioTrack) {
                isMuted = !isMuted;
                audioTrack.enabled = !isMuted;
                
                muteBtn.innerHTML = isMuted ? 
                    '<i class="fas fa-microphone-slash"></i>' : 
                    '<i class="fas fa-microphone"></i>';
                muteBtn.classList.toggle('active', !isMuted);
                
                console.log('Mikrofon durumu:', !isMuted);
            }
        }
    };

    deafenBtn.onclick = () => {
        isDeafened = !isDeafened;
        
        // Tüm ses elementlerini bul ve seslerini kapat/aç
        document.querySelectorAll('audio').forEach(audio => {
            if (audio.id !== 'notificationSound' && 
                audio.id !== 'enterChannelSound' && 
                audio.id !== 'outChannelSound') {
                audio.muted = isDeafened;
            }
        });
        
        deafenBtn.innerHTML = isDeafened ? 
            '<i class="fas fa-headphones-alt"></i>' : 
            '<i class="fas fa-headphones"></i>';
        deafenBtn.classList.toggle('active', !isDeafened);
        
        console.log('Ses durumu:', !isDeafened);
    };
}

// Kullanıcı kontrolü
function checkAuth() {
    const currentUser = localStorage.getItem(CURRENT_USER_KEY);
    if (!currentUser) {
        window.location.href = '/login.html';
        return;
    }

    const user = JSON.parse(currentUser);
    document.getElementById('currentUsername').textContent = user.username;
}

// Server listesini yükle
async function loadServers() {
    try {
        const response = await fetch(`${API_URL}/servers`);
        const data = await response.json();

        if (data.success) {
            renderServers(data.servers);
        } else {
            throw new Error(data.error || 'Serverler yüklenirken bir hata oluştu!');
        }
    } catch (error) {
        console.error('Server listesi hatası:', error);
        alert('Serverler yüklenirken bir hata oluştu!');
    }
}

// Serverleri tabloya ekle
async function renderServers(servers) {
    const serverList = document.getElementById('serverList');
    serverList.innerHTML = '';

    for (const server of servers) {
        // Server'daki kullanıcı sayısını al
        const response = await fetch(`${API_URL}/servers/${server.server_id}/users`);
        const data = await response.json();
        const currentUsers = data.success ? data.count : 0;

        const row = document.createElement('tr');
        row.innerHTML = `
            <td data-label="Server Adı">
                <div class="server-name">${server.server_name}</div>
            </td>
            <td data-label="Açıklama">
                <div class="server-description">${server.server_description || '-'}</div>
            </td>
            <td data-label="Kullanıcılar">
                <div class="user-count">
                    <i class="fas fa-users"></i>
                    ${currentUsers} / ${server.max_users}
                </div>
            </td>
            <td data-label="İşlem">
                <button class="btn btn-join join-server" data-id="${server.server_id}">
                    <i class="fas fa-sign-in-alt me-2"></i>
                    Katıl
                </button>
            </td>
        `;
        serverList.appendChild(row);
    }

    // Katılma butonları için event listener
    document.querySelectorAll('.join-server').forEach(button => {
        button.addEventListener('click', () => {
            const serverId = button.getAttribute('data-id');
            openJoinServerModal(serverId);
        });
    });
}

// Server'a katılma modalını aç
function openJoinServerModal(serverId) {
    document.getElementById('selectedServerId').value = serverId;
    document.getElementById('serverPassword').value = '';
    const modal = new bootstrap.Modal(document.getElementById('joinServerModal'));
    modal.show();
}

// Event listener'ları ayarla
function setupEventListeners() {
    // Çıkış yap
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            localStorage.removeItem(CURRENT_USER_KEY);
            window.location.href = '/login.html';
        });
    }

    // Server'a katıl
    const joinServerBtn = document.getElementById('joinServerBtn');
    if (joinServerBtn) {
        joinServerBtn.addEventListener('click', joinServer);
    }

    // Server'dan ayrıl
    const leaveServerBtn = document.getElementById('leaveServer');
    if (leaveServerBtn) {
        leaveServerBtn.addEventListener('click', leaveServer);
    }

    // Dark mode durumunu kontrol et
    const currentTheme = localStorage.getItem('theme');
    if (currentTheme) {
        document.documentElement.setAttribute('data-theme', currentTheme);
        const checkbox = document.getElementById('checkbox');
        if (checkbox) {
            checkbox.checked = currentTheme === 'dark';
        }
    }

    // Dark mode event listener'ı ekle
    const checkbox = document.getElementById('checkbox');
    if (checkbox) {
        checkbox.addEventListener('change', toggleDarkMode);
    }
}

// Sohbet alanını göster
function showChatArea() {
    document.getElementById('currentServerName').textContent = currentServer.server_name;
    document.getElementById('chatArea').style.display = 'block';
    // Sunucu listesini gizle
    document.querySelector('.row.mb-4').style.display = 'none';
    
    // Kullanıcı sayısı için span ekle
    const serverNameElement = document.getElementById('currentServerName');
    if (!document.getElementById('userCount')) {
        const userCountSpan = document.createElement('span');
        userCountSpan.id = 'userCount';
        userCountSpan.className = 'ms-2';
        serverNameElement.appendChild(userCountSpan);
    }
}

// Dark mode toggle fonksiyonu
function toggleDarkMode() {
    const checkbox = document.getElementById('checkbox');
    if (checkbox.checked) {
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
    } else {
        document.documentElement.setAttribute('data-theme', 'light');
        localStorage.setItem('theme', 'light');
    }
}

// Mesajı sohbete ekle
function addMessageToChat(message) {
    const chatMessages = document.getElementById('chatMessages');
    const currentUser = JSON.parse(localStorage.getItem(CURRENT_USER_KEY));
    const isCurrentUser = message.userId === currentUser.id;
    
    // Eğer mesaj başkasından geldiyse ve sayfa aktif değilse bildirim sesi çal
    if (!isCurrentUser && document.hidden) {
        try {
            notificationSound.currentTime = 0; // Sesi başa sar
            notificationSound.play().catch(e => {
                console.error('Bildirim sesi çalma hatası:', e);
            });
        } catch (error) {
            console.error('Bildirim sesi hatası:', error);
        }
    }
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${isCurrentUser ? 'sent' : 'received'}`;
    
    // XSS koruması için mesajı temizle
    const cleanText = message.text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    
    messageDiv.innerHTML = `
        <div class="sender">${isCurrentUser ? 'Ben' : message.username}</div>
        <div class="content">${cleanText}</div>
        <div class="time">${new Date(message.timestamp).toLocaleTimeString('tr-TR', {
            hour: '2-digit',
            minute: '2-digit'
        })}</div>
    `;
    
    chatMessages.appendChild(messageDiv);
    
    // Otomatik kaydırma
    requestAnimationFrame(() => {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    });
}

// Ekran paylaşımını başlat/durdur
async function toggleScreenShare() {
    const screenShareBtn = document.getElementById('screenShareBtn');
    const screenShareArea = document.getElementById('screenShareArea');
    const previewVideo = document.getElementById('previewVideo');
    const screenPreview = document.getElementById('screenPreview');
    const screenViewer = document.getElementById('screenViewer');

    if (!isScreenSharing) {
        try {
            console.log('Ekran paylaşımı başlatılıyor...');
            // Ekran paylaşımını başlat
            screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    cursor: "always",
                    frameRate: 30
                },
                audio: true
            });

            console.log('Ekran paylaşımı stream alındı:', screenStream.getTracks().map(t => t.kind));

            screenTrack = screenStream.getVideoTracks()[0];
            
            // Paylaşan kişi için önizleme göster
            previewVideo.srcObject = screenStream;
            screenPreview.style.display = 'block';
            screenViewer.style.display = 'none';

            // Tüm peer bağlantılarına ekran paylaşımını ekle
            for (const [userId, pc] of peerConnections) {
                console.log('Ekran paylaşımı track\'i peer bağlantısına ekleniyor:', userId);
                screenStream.getTracks().forEach(track => {
                    pc.addTrack(track, screenStream);
                });
            }

            // Ekran paylaşımı durduğunda
            screenTrack.onended = () => {
                console.log('Ekran paylaşımı kullanıcı tarafından durduruldu');
                stopScreenShare();
            };

            screenShareBtn.classList.add('active');
            screenShareArea.style.display = 'block';
            isScreenSharing = true;

            // Diğer kullanıcılara ekran paylaşımının başladığını bildir
            socket.emit('screenShare', {
                type: 'start',
                serverId: currentServer.server_id
            });

        } catch (error) {
            console.error('Ekran paylaşımı hatası:', error);
            alert('Ekran paylaşımı başlatılamadı!');
        }
    } else {
        stopScreenShare();
    }
}

// Ekran paylaşımını durdur
function stopScreenShare() {
    if (screenStream) {
        screenStream.getTracks().forEach(track => {
            track.stop();
            // Tüm peer bağlantılarından track'i kaldır
            peerConnections.forEach(pc => {
                const senders = pc.getSenders();
                const sender = senders.find(s => s.track === track);
                if (sender) {
                    pc.removeTrack(sender);
                }
            });
        });
        screenStream = null;
        screenTrack = null;
    }

    const screenShareBtn = document.getElementById('screenShareBtn');
    const screenShareArea = document.getElementById('screenShareArea');
    const previewVideo = document.getElementById('previewVideo');
    const screenVideo = document.getElementById('screenVideo');

    previewVideo.srcObject = null;
    screenVideo.srcObject = null;
    screenShareBtn.classList.remove('active');
    screenShareArea.style.display = 'none';
    isScreenSharing = false;

    // Diğer kullanıcılara ekran paylaşımının durduğunu bildir
    socket.emit('screenShareStopped', {
        serverId: currentServer.server_id
    });
}

