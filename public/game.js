// Render Sunucu Adresin (Kendi Render adresini buraya tam yazmazsan yerelde çalışır ama renderda sorun olmaz)
// Eğer otomatik algılamasını istiyorsan boş bırak: const socket = io();
const socket = io(); 

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const mainMenu = document.getElementById('main-menu');
const hud = document.getElementById('hud');
const scoreEl = document.getElementById('score');
const playBtn = document.getElementById('play-btn');
const nicknameInput = document.getElementById('nickname');

// Tam Ekran Canvas
let W = window.innerWidth, H = window.innerHeight;
canvas.width = W; canvas.height = H;

// OYUN DURUMU (CLIENT SIDE)
let players = {}; // Sunucudan gelen ham veri
let clientPlayers = {}; // Ekranda çizdiğimiz yumuşatılmış veri
let foods = [];
let myCamera = { x: 0, y: 0 };
let myId = null;
let gameActive = false;

// Mouse
const mouse = { x: 0, y: 0 };
let isBoosting = false;

// --- BAĞLANTI ---
socket.on('connect', () => {
    console.log("Sunucuya bağlandı!");
    myId = socket.id;
});

// Oyuna Başla Butonu
playBtn.addEventListener('click', () => {
    const name = nicknameInput.value.trim() || "İsimsiz";
    socket.emit('joinGame', name);
    mainMenu.style.display = 'none';
    hud.style.display = 'block';
    gameActive = true;
});

// --- VERİ ALIMI VE İNTERPOLASYON ---
socket.on('gameState', (serverData) => {
    // Yemleri direkt al (hareket etmedikleri için sorun yok)
    foods = serverData.foods;

    // Oyuncuları eşle
    for (let id in serverData.players) {
        const sPlayer = serverData.players[id];
        
        // Eğer bu oyuncuyu ilk kez görüyorsak client listesine ekle
        if (!clientPlayers[id]) {
            clientPlayers[id] = sPlayer;
        } else {
            // Var olan oyuncunun sadece HEDEFİNİ güncelle, pozisyonunu direkt değiştirme!
            clientPlayers[id].targetX = sPlayer.x;
            clientPlayers[id].targetY = sPlayer.y;
            clientPlayers[id].score = sPlayer.score;
            clientPlayers[id].angle = sPlayer.angle;
            clientPlayers[id].history = sPlayer.history; // Kuyruk da yumuşatılabilir ama şimdilik direkt alalım
            clientPlayers[id].radius = sPlayer.radius;
            clientPlayers[id].nickname = sPlayer.nickname;
        }
    }

    // Oyundan çıkanları sil
    for (let id in clientPlayers) {
        if (!serverData.players[id]) delete clientPlayers[id];
    }
});

// --- YUMUŞATMA (LERP) FONKSİYONU ---
// a: şu anki konum, b: hedef konum, t: hız (0.0 ile 1.0 arası)
function lerp(start, end, t) {
    return start * (1 - t) + end * t;
}

// --- RENDER DÖNGÜSÜ (60+ FPS) ---
function animate() {
    requestAnimationFrame(animate);

    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, W, H);

    if (!myId || !clientPlayers[myId]) return; // Karakter henüz yüklenmediyse çizme

    const me = clientPlayers[myId];

    // 1. Pozisyon Yumuşatma (Lag Giderici)
    // Her karede, karakteri sunucunun dediği yere doğru %10 yaklaştırıyoruz.
    // Bu, takılmaları yok eder ve hareketi akıcı yapar.
    for (let id in clientPlayers) {
        const p = clientPlayers[id];
        if (p.targetX !== undefined) {
            p.x = lerp(p.x, p.targetX, 0.1); // 0.1 değeri akıcılık katsayısıdır
            p.y = lerp(p.y, p.targetY, 0.1);
        }
    }

    // 2. Kamera Takibi (Yumuşak)
    myCamera.x = lerp(myCamera.x, me.x, 0.1);
    myCamera.y = lerp(myCamera.y, me.y, 0.1);

    ctx.save();
    // Kamerayı merkeze al
    ctx.translate(W / 2 - myCamera.x, H / 2 - myCamera.y);

    // Grid (Referans Çizgileri)
    drawGrid();

    // Sınırlar
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 10;
    ctx.strokeRect(0, 0, 3000, 3000);

    // Yemler
    foods.forEach(f => {
        ctx.beginPath();
        ctx.fillStyle = f.color;
        ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2);
        ctx.fill();
    });

    // Oyuncular
    for (let id in clientPlayers) {
        const p = clientPlayers[id];
        drawSnake(p);
    }

    ctx.restore();

    // UI Güncelle
    if(gameActive) {
        scoreEl.innerText = Math.floor(me.score);
        sendInput(); // Servera yönümüzü bildir
    }
}

function drawSnake(p) {
    // Kuyruk
    if (p.history) {
        for (let i = 0; i < p.history.length; i+=2) { // Performans için her 2. parçayı çiz
            const pos = p.history[i];
            ctx.beginPath();
            ctx.fillStyle = p.color;
            ctx.arc(pos.x, pos.y, p.radius, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // Kafa
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
    ctx.fill();

    // Gözler
    ctx.fillStyle = 'white';
    ctx.beginPath(); ctx.arc(8, -6, 5, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(8, 6, 5, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = 'black';
    ctx.beginPath(); ctx.arc(10, -6, 2, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(10, 6, 2, 0, Math.PI*2); ctx.fill();
    
    ctx.restore();

    // İsim
    ctx.fillStyle = 'white';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(p.nickname, p.x, p.y - p.radius - 10);
}

function drawGrid() {
    ctx.strokeStyle = '#2a2a40';
    ctx.lineWidth = 2;
    for (let x = 0; x <= 3000; x += 100) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 3000); ctx.stroke();
    }
    for (let y = 0; y <= 3000; y += 100) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(3000, y); ctx.stroke();
    }
}

// Input Gönderimi
function sendInput() {
    const angle = Math.atan2(mouse.y - H/2, mouse.x - W/2);
    socket.emit('input', { angle, boosting: isBoosting });
}

window.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
window.addEventListener('mousedown', () => isBoosting = true);
window.addEventListener('mouseup', () => isBoosting = false);
window.addEventListener('resize', () => { W=window.innerWidth; H=window.innerHeight; canvas.width=W; canvas.height=H; });

// Animasyonu Başlat
animate();
