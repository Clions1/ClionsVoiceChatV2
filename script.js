// Mevcut kullanıcı bilgilerini al
const currentUser = checkCurrentUser();
if (!currentUser) {
    window.location.href = 'login.html';
}

// Kullanıcı adını göster
document.getElementById('currentUsername').textContent = currentUser.username;

// Çıkış butonunu ayarla
document.getElementById('logoutBtn').addEventListener('click', logout);

// PeerJS bağlantısını kur
const peer = new Peer(currentUser.username);
const startCallButton = document.getElementById("startCall");
const muteButton = document.getElementById("muteButton");
const friendIdInput = document.getElementById("friendIdInput");
const myIdDisplay = document.getElementById("myId");
const participantList = document.getElementById("participantList");
const localAudio = document.getElementById("localAudio");

let localStream;
let isMuted = false;
let participants = {}; 
let connections = {}; 

function addAudioElement(participantId, stream) {
    const audioElement = document.createElement("audio");
    audioElement.autoplay = true;
    audioElement.id = `audio-${participantId}`;
    audioElement.srcObject = stream;
    document.body.appendChild(audioElement);

    if (!participants[participantId]) {
        updateParticipants(participantId, "Bağlı");
    }
    renderParticipants();
}

function removeAudioElement(participantId) {
    const audioElement = document.getElementById(`audio-${participantId}`);
    if (audioElement) {
        document.body.removeChild(audioElement);
    }
}

navigator.mediaDevices.getUserMedia({ audio: true })
    .then(stream => {
        localStream = stream;
        localAudio.srcObject = stream;
    })
    .catch(err => console.error("Mikrofon hatası:", err));

peer.on("open", id => {
    myIdDisplay.textContent = id;
    updateParticipants(id, "Bağlı");
});

peer.on("call", call => {
    call.answer(localStream);

    call.on("stream", remoteStream => {
        addAudioElement(call.peer, remoteStream);
    });

    call.on("close", () => {
        removeAudioElement(call.peer);
    });

    connections[call.peer] = call; 
});

peer.on("connection", conn => {
    connections[conn.peer] = conn;

    conn.on("open", () => {
        conn.send({
            type: "updateParticipants",
            participants,
        });
    });

    conn.on("data", data => {
        console.log("Gelen veri:", data);
        if (data.type === "screenShareStop") {
            console.log("Ekran paylaşımı durdurma mesajı alındı, gönderen:", data.from);
            
            stopScreenShareDisplay();

            const screenConnId = data.from + '_screen';
            if (connections[screenConnId]) {
                if (typeof connections[screenConnId].close === 'function') {
                    connections[screenConnId].close();
                }
                delete connections[screenConnId];
            }
        } else if (data.type === "updateParticipants") {
            participants = data.participants;
            renderParticipants();
        } else if (data.type === "join") {
            updateParticipants(data.id, "Bağlı");
        } else if (data.type === "leave") {
            removeParticipant(data.id);
        }
    });

    conn.on("close", () => {
        removeParticipant(conn.peer);
        removeAudioElement(conn.peer);
        delete connections[conn.peer];
    });
});

function updateParticipants(id, status) {
    participants[id] = status;
    renderParticipants();
    broadcastParticipantList();
}

function removeParticipant(id) {
    if (participants[id]) {
        delete participants[id];
        renderParticipants();
        broadcastParticipantList();
    }
}

function renderParticipants() {
    participantList.innerHTML = "";
    for (let id in participants) {
        const li = document.createElement("li");
        li.id = `participant-${id}`;
        li.className = "list-group-item d-flex justify-content-between align-items-center";

        const participantInfo = document.createElement("span");
        participantInfo.textContent = `${id} - ${participants[id]}`;

        const volumeControl = document.createElement("input");
        volumeControl.type = "range";
        volumeControl.min = "0";
        volumeControl.max = "100";
        volumeControl.step = "1";
        volumeControl.value = "100";
        volumeControl.className = "volume-control";
        volumeControl.title = `Ses Seviyesi: ${id}`;

        volumeControl.addEventListener("input", () => {
            const audioElement = document.getElementById(`audio-${id}`);
            if (audioElement) {
                audioElement.volume = volumeControl.value / 100;
            }
        });

        const volumeLabel = document.createElement("span");
        volumeLabel.className = "volume-label";
        volumeLabel.textContent = "100%";

        volumeControl.addEventListener("input", () => {
            const audioElement = document.getElementById(`audio-${id}`);
            if (audioElement) {
                const volume = volumeControl.value;
                audioElement.volume = volume / 100;
                volumeLabel.textContent = `${volume}%`;
            }
        });

        const controlWrapper = document.createElement("div");
        controlWrapper.className = "d-flex align-items-center gap-2";
        controlWrapper.appendChild(volumeControl);
        controlWrapper.appendChild(volumeLabel);

        li.appendChild(participantInfo);
        li.appendChild(controlWrapper);
        participantList.appendChild(li);

        const audioElement = document.getElementById(`audio-${id}`);
        if (audioElement) {
            volumeControl.value = audioElement.volume * 100;
            volumeLabel.textContent = `${Math.round(audioElement.volume * 100)}%`;
        }
    }
}

function broadcastParticipantList() {
    const participantData = {
        type: "updateParticipants",
        participants,
    };
    for (let connId in connections) {
        const conn = connections[connId];
        if (conn.open) {
            conn.send(participantData);
        }
    }
}

startCallButton.addEventListener("click", () => {
    const friendId = friendIdInput.value.trim();
    if (!friendId) {
        alert("Lütfen bir kullanıcı adı girin!");
        return;
    }

    const call = peer.call(friendId, localStream);
    connections[friendId] = call; 

    call.on("stream", remoteStream => {
        addAudioElement(friendId, remoteStream);
    });

    call.on("close", () => {
        removeAudioElement(friendId);
        delete connections[friendId];
    });

    const conn = peer.connect(friendId);
    conn.on("open", () => {
        conn.send({ type: "join", id: peer.id });
        connections[friendId] = conn;
        updateParticipants(friendId, "Bağlı");
    });

    conn.on("close", () => {
        removeParticipant(friendId);
        removeAudioElement(friendId);
    });
});

muteButton.addEventListener("click", () => {
    if (localStream) {
        localStream.getAudioTracks().forEach(track => track.enabled = isMuted);
        isMuted = !isMuted;
        muteButton.textContent = isMuted ? "Mikrofonu Aç" : "Mikrofonu Kapat";
    }
});

window.addEventListener("unload", () => {
    for (let id in connections) {
        connections[id].send({ type: "leave", id: peer.id });
        connections[id].close();
    }
    peer.disconnect();
});

// Ekran paylaşımı kodları...
const startScreenShareButton = document.getElementById("startScreenShare");
const stopScreenShareButton = document.getElementById("stopScreenShare");
const fullscreenButton = document.getElementById("fullscreenButton");
const screenShareVideo = document.getElementById("screenShareVideo");

let screenStream = null;

startScreenShareButton.addEventListener('click', async () => {
    try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                width: { ideal: 1920, max: 1920 },
                height: { ideal: 1080, max: 1080 },
                frameRate: { ideal: 30, max: 60 },
                displaySurface: "monitor"
            },
            audio: {
                autoGainControl: false,
                echoCancellation: false,
                noiseSuppression: false,
                channelCount: 2,
                sampleRate: 48000,
                sampleSize: 16,
                latency: 0
            }
        });

        const screenShareWindow = document.getElementById('screenShareWindow');
        screenShareWindow.classList.add('active');
        setTimeout(() => screenShareWindow.style.display = 'block', 0);

        const audioTracks = screenStream.getAudioTracks();
        if (audioTracks.length > 0) {
            const audioTrack = audioTracks[0];
            const constraints = {
                channelCount: { ideal: 2, min: 2 },
                sampleRate: { ideal: 48000, min: 44100 },
                sampleSize: { ideal: 16, min: 16 },
                echoCancellation: false,
                autoGainControl: false,
                noiseSuppression: false,
                latency: { ideal: 0, max: 0.02 }
            };
            
            try {
                await audioTrack.applyConstraints(constraints);
            } catch (e) {
                console.warn('Gelişmiş ses ayarları uygulanamadı:', e);
            }
        }

        screenShareVideo.srcObject = screenStream;
        await screenShareVideo.play();

        for (let peerId in connections) {
            const call = peer.call(peerId, screenStream, {
                metadata: { 
                    type: 'screen',
                    audioConfig: {
                        highQuality: true,
                        stereo: true
                    }
                }
            });
            
            if (call.peerConnection) {
                const sender = call.peerConnection.getSenders().find(s => s.track.kind === 'audio');
                if (sender) {
                    const params = sender.getParameters();
                    params.encodings = [{
                        maxBitrate: 256000,
                        stereo: true,
                        dtx: false,
                        priority: 'high'
                    }];
                    await sender.setParameters(params);
                }
            }

            call.on('error', error => {
                console.error('Ekran paylaşımı gönderme hatası:', error);
            });
        }

        startScreenShareButton.disabled = true;
        stopScreenShareButton.disabled = false;

        screenStream.getVideoTracks()[0].addEventListener('ended', () => {
            stopScreenShare();
        });
    } catch (error) {
        console.error('Ekran paylaşımı başlatılamadı:', error);
        alert('Ekran paylaşımı başlatılamadı: ' + error.message);
    }
});

stopScreenShareButton.addEventListener('click', stopScreenShare);

function stopScreenShare() {
    if (screenStream) {
        screenStream.getTracks().forEach(track => {
            track.stop();
        });
        screenShareVideo.srcObject = null;
        startScreenShareButton.disabled = false;
        stopScreenShareButton.disabled = true;

        stopScreenShareDisplay();

        for (let peerId in connections) {
            const connection = connections[peerId];
            if (!peerId.includes('_screen') && connection && typeof connection.send === 'function') {
                connection.send({
                    type: "screenShareStop",
                    from: peer.id
                });
            }
        }

        for (let connId in connections) {
            if (connId.endsWith('_screen')) {
                const connection = connections[connId];
                if (connection && typeof connection.close === 'function') {
                    connection.close();
                    delete connections[connId];
                }
            }
        }
    }
}

function stopScreenShareDisplay() {
    const screenShareWindow = document.getElementById('screenShareWindow');
    if (screenShareWindow) {
        screenShareVideo.srcObject = null;
        screenShareWindow.classList.remove('active');
        setTimeout(() => {
            screenShareWindow.style.display = 'none';
        }, 300);
    }
}

peer.on('call', call => {
    if (call.metadata && call.metadata.type === 'screen') {
        call.answer(null);
        const screenShareWindow = document.getElementById('screenShareWindow');
        screenShareWindow.classList.add('active');
        setTimeout(() => screenShareWindow.style.display = 'block', 0);

        connections[call.peer + '_screen'] = call;
    } else {
        call.answer(localStream);
    }
    
    call.on('stream', remoteStream => {
        console.log('Uzak stream alındı:', remoteStream);
        if (remoteStream.getVideoTracks().length > 0) {
            screenShareVideo.srcObject = remoteStream;
            screenShareVideo.play().catch(e => console.error('Video oynatma hatası:', e));
        } else {
            addAudioElement(call.peer, remoteStream);
        }
    });

    call.on('close', () => {
        console.log("Call kapandı, metadata:", call.metadata);
        if (call.metadata && call.metadata.type === 'screen') {
            stopScreenShareDisplay();
            delete connections[call.peer + '_screen'];
        }
    });
});

// Dark mode için yeni kod
const toggleSwitch = document.querySelector('.theme-switch input[type="checkbox"]');

function switchTheme(e) {
    if (e.target.checked) {
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
    } else {
        document.documentElement.removeAttribute('data-theme');
        localStorage.setItem('theme', 'light');
    }    
}

const currentTheme = localStorage.getItem('theme');
if (currentTheme) {
    if (currentTheme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        toggleSwitch.checked = true;
    } else {
        document.documentElement.removeAttribute('data-theme');
        toggleSwitch.checked = false;
    }
}

toggleSwitch.addEventListener('change', switchTheme);

// Video kontrolleri
const video = document.getElementById('screenShareVideo');
const playPauseBtn = document.getElementById('playPauseBtn');
const timeSlider = document.getElementById('timeSlider');
const timeDisplay = document.getElementById('timeDisplay');
const muteBtn = document.getElementById('muteBtn');
const volumeSlider = document.getElementById('volumeSlider');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const videoContainer = document.querySelector('.video-container');

fullscreenBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
        if (videoContainer.requestFullscreen) {
            videoContainer.requestFullscreen();
        } else if (videoContainer.webkitRequestFullscreen) {
            videoContainer.webkitRequestFullscreen();
        } else if (videoContainer.msRequestFullscreen) {
            videoContainer.msRequestFullscreen();
        }
        fullscreenBtn.innerHTML = '<i class="fas fa-compress"></i>';
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        } else if (document.msExitFullscreen) {
            document.msExitFullscreen();
        }
        fullscreenBtn.innerHTML = '<i class="fas fa-expand"></i>';
    }
});

document.addEventListener('fullscreenchange', updateFullscreenButton);
document.addEventListener('webkitfullscreenchange', updateFullscreenButton);
document.addEventListener('mozfullscreenchange', updateFullscreenButton);
document.addEventListener('MSFullscreenChange', updateFullscreenButton);

function updateFullscreenButton() {
    if (document.fullscreenElement) {
        fullscreenBtn.innerHTML = '<i class="fas fa-compress"></i>';
    } else {
        fullscreenBtn.innerHTML = '<i class="fas fa-expand"></i>';
    }
}

playPauseBtn.addEventListener('click', () => {
    if (video.paused) {
        video.play();
        playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
    } else {
        video.pause();
        playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
    }
});

video.addEventListener('timeupdate', () => {
    const percent = (video.currentTime / video.duration) * 100;
    timeSlider.value = percent;
    
    const currentMinutes = Math.floor(video.currentTime / 60);
    const currentSeconds = Math.floor(video.currentTime % 60);
    const durationMinutes = Math.floor(video.duration / 60) || 0;
    const durationSeconds = Math.floor(video.duration % 60) || 0;
    
    timeDisplay.textContent = `${String(currentMinutes).padStart(2, '0')}:${String(currentSeconds).padStart(2, '0')} / ${String(durationMinutes).padStart(2, '0')}:${String(durationSeconds).padStart(2, '0')}`;
});

timeSlider.addEventListener('change', () => {
    const time = (timeSlider.value / 100) * video.duration;
    video.currentTime = time;
});

muteBtn.addEventListener('click', () => {
    if (video.muted) {
        video.muted = false;
        muteBtn.innerHTML = '<i class="fas fa-volume-up"></i>';
        volumeSlider.value = video.volume * 100;
    } else {
        video.muted = true;
        muteBtn.innerHTML = '<i class="fas fa-volume-mute"></i>';
        volumeSlider.value = 0;
    }
});

volumeSlider.addEventListener('input', () => {
    video.volume = volumeSlider.value / 100;
    if (video.volume === 0) {
        muteBtn.innerHTML = '<i class="fas fa-volume-mute"></i>';
        video.muted = true;
    } else {
        muteBtn.innerHTML = '<i class="fas fa-volume-up"></i>';
        video.muted = false;
    }
});

video.addEventListener('play', () => {
    playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
});

video.addEventListener('pause', () => {
    playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
});