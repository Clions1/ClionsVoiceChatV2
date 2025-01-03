const API_URL = 'http://localhost:3000/api';
const CURRENT_USER_KEY = 'clions_current_user';
let currentServer = null;
let socket = null;
let localStream = null;
let peerConnections = new Map(); // userId -> RTCPeerConnection

// Sayfa yüklendiğinde
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    loadServers();
    setupEventListeners();
    initializeWebSocket();

    // Dark mode durumunu kontrol et
    const currentTheme = localStorage.getItem('theme');
    if (currentTheme) {
        document.documentElement.setAttribute('data-theme', currentTheme);
        const checkbox = document.getElementById('checkbox');
        checkbox.checked = currentTheme === 'dark';
    }

    // Dark mode event listener'ı ekle
    const checkbox = document.getElementById('checkbox');
    checkbox.addEventListener('change', toggleDarkMode);
});

// WebSocket bağlantısını başlat
function initializeWebSocket() {
    socket = io('http://localhost:3000');
    
    socket.on('connect', () => {
        console.log('WebSocket bağlantısı kuruldu');
    });
    
    socket.on('userJoined', async ({ userId, username }) => {
        addUserToList(userId, username);
        // Yeni kullanıcı geldiğinde offer oluşturma işlemini userJoined'da yapmıyoruz
        if (userId !== getCurrentUserId()) {
            await createPeerConnection(userId);
        }
    });
    
    socket.on('userLeft', ({ userId }) => {
        removeUserFromList(userId);
        closePeerConnection(userId);
    });
    
    socket.on('currentUsers', async (users) => {
        const userList = document.getElementById('userList');
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
    });
    
    socket.on('signal', async ({ userId, signal }) => {
        try {
            console.log('Sinyal alındı:', signal.type || 'candidate', 'Kimden:', userId);
            let pc = peerConnections.get(userId);
            
            if (!pc) {
                console.log('Yeni bağlantı oluşturuluyor (sinyal üzerine)');
                pc = await createPeerConnection(userId);
                if (!pc) {
                    throw new Error('Bağlantı oluşturulamadı');
                }
            }
            
            if (signal.type === 'offer') {
                console.log('Offer alındı, answer oluşturuluyor');
                
                // Eğer halihazırda bir müzakere varsa, rollback yapalım
                if (pc.signalingState !== 'stable') {
                    console.log('Mevcut müzakere rollback yapılıyor');
                    await Promise.all([
                        pc.setLocalDescription({ type: 'rollback' }),
                        pc.setRemoteDescription(new RTCSessionDescription(signal))
                    ]);
                } else {
                    await pc.setRemoteDescription(new RTCSessionDescription(signal));
                }
                
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                
                socket.emit('signal', {
                    targetId: userId,
                    signal: answer
                });
                
                // Offer aldıktan ve answer gönderdikten sonra kendi offer'ımızı oluşturalım
                try {
                    const offer = await pc.createOffer({
                        offerToReceiveAudio: true,
                        offerToReceiveVideo: false
                    });
                    await pc.setLocalDescription(offer);
                    socket.emit('signal', {
                        targetId: userId,
                        signal: offer
                    });
                } catch (error) {
                    console.error('Karşı offer oluşturma hatası:', error);
                }
            } 
            else if (signal.type === 'answer') {
                console.log('Answer alındı, remote description ayarlanıyor');
                if (pc.signalingState === 'have-local-offer') {
                    await pc.setRemoteDescription(new RTCSessionDescription(signal));
                } else {
                    console.warn('Answer alındı ama signaling state uygun değil:', pc.signalingState);
                }
            } 
            else if (signal.candidate) {
                console.log('ICE adayı alındı:', signal.candidate.type);
                if (pc.remoteDescription) {
                    try {
                        await pc.addIceCandidate(new RTCIceCandidate(signal));
                        console.log('ICE adayı başarıyla eklendi');
                    } catch (error) {
                        console.error('ICE adayı eklenirken hata:', error);
                    }
                } else {
                    console.warn('Remote description olmadan ICE adayı alındı');
                }
            }
        } catch (error) {
            console.error('Sinyal işleme hatası:', error);
        }
    });
}

// Mevcut kullanıcı ID'sini al
function getCurrentUserId() {
    const currentUser = JSON.parse(localStorage.getItem(CURRENT_USER_KEY) || '{}');
    return currentUser.id;
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
            iceCandidatePoolSize: 10,
            bundlePolicy: 'max-bundle',
            rtcpMuxPolicy: 'require'
        });
        
        peerConnections.set(userId, pc);
        
        // Yerel ses akışını ekle
        if (localStream && localStream.getAudioTracks().length > 0) {
            console.log('Yerel ses akışı ekleniyor');
            const audioTrack = localStream.getAudioTracks()[0];
            console.log('Ses track durumu:', {
                enabled: audioTrack.enabled,
                muted: audioTrack.muted,
                readyState: audioTrack.readyState
            });
            
            try {
                const sender = pc.addTrack(audioTrack, localStream);
                console.log('Ses track\'i eklendi:', sender.track.enabled);
            } catch (error) {
                console.error('Ses track\'i eklenirken hata:', error);
                throw error;
            }
        } else {
            console.error('Yerel ses akışı veya ses track\'i bulunamadı!');
            throw new Error('Ses akışı yok');
        }
        
        // Uzak ses akışını al
        pc.ontrack = (event) => {
            console.log('Uzak ses akışı alındı:', event.streams[0].id);
            const audioId = `audio-${userId}`;
            let audio = document.getElementById(audioId);
            
            if (!audio) {
                audio = document.createElement('audio');
                audio.id = audioId;
                audio.autoplay = true;
                audio.controls = true;
                document.body.appendChild(audio);
                console.log('Yeni audio elementi oluşturuldu:', audioId);
            }
            
            audio.srcObject = event.streams[0];
            audio.volume = 1.0;
            
            audio.onplay = () => {
                console.log('Ses çalmaya başladı:', audioId);
            };
            
            audio.onloadedmetadata = () => {
                console.log('Audio metadata yüklendi:', audioId);
                audio.play().catch(e => console.error('Ses çalma hatası:', e));
            };
            
            audio.onerror = (e) => console.error('Ses hatası:', e);
        };
        
        // ICE adaylarını gönder
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('ICE adayı gönderiliyor:', event.candidate.type);
                socket.emit('signal', {
                    targetId: userId,
                    signal: event.candidate
                });
            } else {
                console.log('ICE toplama tamamlandı');
            }
        };
        
        // ICE toplama durumunu izle
        pc.onicegatheringstatechange = () => {
            console.log('ICE toplama durumu:', pc.iceGatheringState);
        };
        
        // ICE bağlantı durumunu izle
        pc.oniceconnectionstatechange = () => {
            console.log('ICE bağlantı durumu:', pc.iceConnectionState);
            switch (pc.iceConnectionState) {
                case 'checking':
                    console.log('ICE adayları kontrol ediliyor...');
                    break;
                case 'connected':
                    console.log('ICE bağlantısı başarılı');
                    break;
                case 'completed':
                    console.log('ICE bağlantısı tamamlandı');
                    break;
                case 'failed':
                    console.error('ICE bağlantısı başarısız oldu');
                    // Bağlantıyı yeniden dene
                    restartIce(userId);
                    break;
                case 'disconnected':
                    console.warn('ICE bağlantısı koptu, yeniden bağlanmaya çalışılıyor...');
                    restartIce(userId);
                    break;
                case 'closed':
                    console.log('ICE bağlantısı kapatıldı');
                    closePeerConnection(userId);
                    break;
            }
        };
        
        // Bağlantı durumu değişikliklerini izle
        pc.onconnectionstatechange = () => {
            console.log('Bağlantı durumu:', pc.connectionState);
            switch (pc.connectionState) {
                case 'new':
                    console.log('Bağlantı başlatılıyor...');
                    break;
                case 'connecting':
                    console.log('Bağlanılıyor...');
                    break;
                case 'connected':
                    console.log('Bağlantı başarılı');
                    break;
                case 'disconnected':
                    console.warn('Bağlantı koptu, yeniden bağlanmaya çalışılıyor...');
                    restartIce(userId);
                    break;
                case 'failed':
                    console.error('Bağlantı başarısız oldu');
                    restartIce(userId);
                    break;
                case 'closed':
                    console.log('Bağlantı kapatıldı');
                    closePeerConnection(userId);
                    break;
            }
        };
        
        // Müzakere gerektiğinde
        pc.onnegotiationneeded = async () => {
            try {
                console.log('Yeni müzakere başlatılıyor');
                const offer = await pc.createOffer({
                    offerToReceiveAudio: true,
                    offerToReceiveVideo: false,
                    voiceActivityDetection: true
                });
                await pc.setLocalDescription(offer);
                socket.emit('signal', {
                    targetId: userId,
                    signal: offer
                });
            } catch (error) {
                console.error('Müzakere hatası:', error);
            }
        };
        
        return pc;
    } catch (error) {
        console.error('Bağlantı oluşturma hatası:', error);
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
    }
    
    const audio = document.getElementById(`audio-${userId}`);
    if (audio) {
        audio.remove();
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
        li.className = 'list-group-item d-flex justify-content-between align-items-center';
        li.innerHTML = `
            <span>${username} ${isCurrentUser ? '(Ben)' : ''}</span>
            <div class="volume-control">
                <input type="range" min="0" max="100" value="100" 
                    onchange="adjustVolume('${userId}', this.value)"
                    oninput="adjustVolume('${userId}', this.value)"
                    ${isCurrentUser ? 'style="display: none;"' : ''}>
            </div>
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
        // Kullanıcı sayısını güncelle
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
                }
            });
            console.log('Mikrofon erişimi başarılı:', localStream.getAudioTracks()[0].enabled);
            
            // Test için ses çıkışını kontrol et
            const testAudio = new Audio();
            testAudio.srcObject = localStream;
            testAudio.muted = true;
            await testAudio.play();
            console.log('Test ses çalışıyor');
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
            
            // WebSocket ile server'a katıl
            socket.emit('joinServer', {
                userId: currentUser.id,
                username: currentUser.username,
                serverId: currentServer.server_id
            });
            
            // Ses sohbetini başlat
            await initializeVoiceChat();
        } else {
            alert(data.error || 'Server\'a katılırken bir hata oluştu!');
        }
    } catch (error) {
        console.error('Server\'a katılma hatası:', error);
        alert(error.message || 'Server\'a katılırken bir hata oluştu!');
        
        // Hata durumunda mikrofonu kapat
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localStream = null;
        }
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
            socket.emit('leaveServer', {
                userId: currentUser.id,
                serverId: currentServer.server_id
            });
            
            // Tüm bağlantıları temizle
            cleanupConnections();
            
            currentServer = null;
            document.getElementById('chatArea').style.display = 'none';
            document.getElementById('userList').innerHTML = '';
            // Sunucu listesini tekrar göster
            document.querySelector('.row.mb-4').style.display = 'block';
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
}

// Ses sohbeti başlat
async function initializeVoiceChat() {
    if (!localStream) {
        console.error('Yerel ses akışı bulunamadı!');
        return;
    }
    
    console.log('Ses sohbeti başlatılıyor');
    
    // Mikrofon durumu
    let isMuted = false;
    let isDeafened = false;

    // Mikrofon butonu
    const muteBtn = document.getElementById('muteBtn');
    muteBtn.onclick = () => {
        isMuted = !isMuted;
        muteBtn.innerHTML = isMuted ? 
            '<i class="fas fa-microphone-slash"></i>' : 
            '<i class="fas fa-microphone"></i>';
        
        // Mikrofon sesini aç/kapat
        localStream.getAudioTracks().forEach(track => {
            track.enabled = !isMuted;
            console.log('Mikrofon durumu:', !isMuted);
        });
    };

    // Kulaklık butonu
    const deafenBtn = document.getElementById('deafenBtn');
    deafenBtn.onclick = () => {
        isDeafened = !isDeafened;
        deafenBtn.innerHTML = isDeafened ? 
            '<i class="fas fa-headphones-alt"></i>' : 
            '<i class="fas fa-headphones"></i>';
        
        // Tüm kullanıcıların sesini aç/kapat
        document.querySelectorAll('audio').forEach(audio => {
            audio.muted = isDeafened;
            console.log(`${audio.id} sesi:`, !isDeafened);
        });
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
            <td>${server.server_name}</td>
            <td>${server.server_description || '-'}</td>
            <td>${currentUsers} / ${server.max_users}</td>
            <td>
                <button class="btn btn-primary join-server" data-id="${server.server_id}">
                    <i class="fas fa-sign-in-alt"></i> Katıl
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
    document.getElementById('logoutBtn').addEventListener('click', () => {
        localStorage.removeItem(CURRENT_USER_KEY);
        window.location.href = '/login.html';
    });

    // Server'a katıl
    document.getElementById('joinServerBtn').addEventListener('click', joinServer);

    // Server'dan ayrıl
    document.getElementById('leaveServer').addEventListener('click', leaveServer);

    // Dark mode durumunu kontrol et
    const currentTheme = localStorage.getItem('theme');
    if (currentTheme) {
        document.documentElement.setAttribute('data-theme', currentTheme);
        const checkbox = document.getElementById('checkbox');
        checkbox.checked = currentTheme === 'dark';
    }

    // Dark mode event listener'ı ekle
    const checkbox = document.getElementById('checkbox');
    checkbox.addEventListener('change', toggleDarkMode);
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