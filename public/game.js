const socket = io(); 

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const minimapCanvas = document.getElementById('minimap');
const ctxMini = minimapCanvas.getContext('2d');

const mainMenu = document.getElementById('main-menu');
const hud = document.getElementById('hud');
const scoreEl = document.getElementById('score');
const playBtn = document.getElementById('play-btn');
const nicknameInput = document.getElementById('nickname');

let W = window.innerWidth, H = window.innerHeight;
canvas.width = W; canvas.height = H;

// OYUN CONSTANTLARI
const MAP_SIZE = 4000; // Server ile aynı olmalı

// OYUN DURUMU
let players = {}; 
let foods = [];
let powerups = [];
let myId = null;
let myCamera = { x: 0, y: 0 };
let gameActive = false;

const mouse = { x: 0, y: 0 };
let isBoosting = false;

socket.on('connect', () => { myId = socket.id; });

playBtn.addEventListener('click', () => {
    const name = nicknameInput.value.trim() || "İsimsiz";
    socket.emit('joinGame', name);
    mainMenu.style.display = 'none';
    hud.style.display = 'block';
    gameActive = true;
});

// Serverdan gelen data (Snapshot)
socket.on('gameState', (data) => {
    // Array'i objeye çevir (daha kolay erişim için)
    let newPlayers = {};
    data.players.forEach(p => {
        newPlayers[p.id] = p;
        // Eğer client'ta bu oyuncu zaten varsa, hedefini güncelle
        if (players[p.id]) {
            players[p.id].serverX = p.x;
            players[p.id].serverY = p.y;
            players[p.id].serverAngle = p.angle;
            players[p.id].score = p.score;
            players[p.id].history = p.history;
            players[p.id].radius = p.radius;
        } else {
            // Yeni oyuncu
            p.serverX = p.x;
            p.serverY = p.y;
            p.serverAngle = p.angle;
            players[p.id] = p;
        }
    });

    // Oyundan çıkanları sil
    for (let id in players) {
        if (!newPlayers[id]) delete players[id];
    }
    
    foods = data.foods;
    powerups = data.powerups;
});

// YUMUŞATMA FONKSİYONLARI
function lerp(start, end, t) {
    return start * (1 - t) + end * t;
}

function lerpAngle(start, end, t) {
    let diff = end - start;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return start + diff * t;
}

// --- RENDER DÖNGÜSÜ (Hz BAĞIMSIZ) ---
let lastTime = 0;

function animate(timestamp) {
    requestAnimationFrame(animate);
    
    // Delta Time hesabı (saniye cinsinden)
    const dt = (timestamp - lastTime) / 1000;
    lastTime = timestamp;

    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, W, H);

    if (!myId || !players[myId]) return;

    const me = players[myId];

    // 1. İNTERPOLASYON (Hareket Fiziği)
    // Her karede sunucu pozisyonuna doğru "dt" bazlı yaklaşma
    // Bu sayede 144hz monitörde 144 kare, 60hz'de 60 kare hesaplanır ama hız aynı kalır.
    const LERP_FACTOR = 10 * dt; // Yumuşaklık ayarı (yaklaşık 0.16 @ 60fps)

    for (let id in players) {
        const p = players[id];
        if (p.serverX !== undefined) {
            p.x = lerp(p.x, p.serverX, LERP_FACTOR);
            p.y = lerp(p.y, p.serverY, LERP_FACTOR);
            p.angle = lerpAngle(p.angle, p.serverAngle, LERP_FACTOR);
        }
    }

    // Kamera Takibi
    myCamera.x = lerp(myCamera.x, me.x, LERP_FACTOR);
    myCamera.y = lerp(myCamera.y, me.y, LERP_FACTOR);

    // Çizim Başlangıcı
    ctx.save();
    ctx.translate(W / 2 - myCamera.x, H / 2 - myCamera.y);

    // Grid
    drawGrid();

    // Sınırlar
    ctx.strokeStyle = '#555'; ctx.lineWidth = 10;
    ctx.strokeRect(0, 0, MAP_SIZE, MAP_SIZE);

    // Yemler
    foods.forEach(f => {
        ctx.beginPath(); ctx.fillStyle = f.color;
        ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2); ctx.fill();
    });

    // Power-ups
    powerups.forEach(pu => {
        ctx.beginPath(); 
        ctx.fillStyle = pu.color;
        ctx.arc(pu.x, pu.y, pu.radius, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'white'; ctx.font = 'bold 12px Arial'; ctx.textAlign = 'center';
        ctx.fillText(pu.label, pu.x, pu.y + 4);
        
        // Etrafına halka (Görsellik)
        ctx.strokeStyle = 'white'; ctx.lineWidth = 2; ctx.stroke();
    });

    // Oyuncular
    // Skora göre sırala ki küçükler altta kalsın
    const sortedPlayers = Object.values(players).sort((a,b) => a.score - b.score);
    sortedPlayers.forEach(p => drawSnake(p));

    ctx.restore();

    // UI Güncelle
    if (gameActive) {
        scoreEl.innerText = Math.floor(me.score);
        sendInput();
        drawMiniMap(me);
    }
}

function drawSnake(p) {
    // Wormate stili boğum boğum çizim
    // History dizisi sunucudan geliyor
    if (!p.history) return;

    const segmentGap = 2; // Sıklık
    
    for (let i = 0; i < p.history.length; i += segmentGap) {
        const pos = p.history[i];
        ctx.beginPath();
        ctx.fillStyle = p.color;
        
        // Renk değişimi (Zebra deseni gibi basit bir stil için)
        // if (i % (segmentGap*2) === 0) ctx.fillStyle = adjustColor(p.color, -20);
        
        ctx.arc(pos.x, pos.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
    }
    
    // Kafa
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(0, 0, p.radius, 0, Math.PI*2); ctx.fill();

    // Gözler
    ctx.fillStyle = 'white';
    ctx.beginPath(); ctx.arc(8, -8, 6, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(8, 8, 6, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = 'black';
    ctx.beginPath(); ctx.arc(10, -8, 3, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(10, 8, 3, 0, Math.PI*2); ctx.fill();
    
    ctx.restore();

    // İsim
    ctx.fillStyle = 'white'; ctx.strokeStyle = 'black'; ctx.lineWidth = 3;
    ctx.font = 'bold 14px Arial'; ctx.textAlign = 'center';
    ctx.strokeText(p.nickname, p.x, p.y - p.radius - 10);
    ctx.fillText(p.nickname, p.x, p.y - p.radius - 10);
}

function drawMiniMap(me) {
    ctxMini.clearRect(0, 0, 150, 150);
    
    // Harita Arka Planı
    ctxMini.fillStyle = 'rgba(0,0,0,0.2)';
    ctxMini.beginPath(); ctxMini.arc(75, 75, 75, 0, Math.PI*2); ctxMini.fill();

    // Oyuncular (Nokta olarak)
    const scale = 150 / MAP_SIZE; // Haritayı 150px'e sığdır

    for(let id in players) {
        const p = players[id];
        const mx = p.x * scale;
        const my = p.y * scale;

        ctxMini.beginPath();
        if(id === myId) {
            ctxMini.fillStyle = '#00ff00'; // Ben (Yeşil)
            ctxMini.arc(mx, my, 4, 0, Math.PI*2);
        } else {
            ctxMini.fillStyle = '#ff0000'; // Düşmanlar (Kırmızı)
            ctxMini.arc(mx, my, 2, 0, Math.PI*2);
        }
        ctxMini.fill();
    }
}

function drawGrid() {
    ctx.strokeStyle = '#252535'; ctx.lineWidth = 2;
    // Kamera pozisyonuna göre offsetli grid (Sonsuz hissi için)
    // Basit grid
    for (let x = 0; x <= MAP_SIZE; x += 100) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, MAP_SIZE); ctx.stroke();
    }
    for (let y = 0; y <= MAP_SIZE; y += 100) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(MAP_SIZE, y); ctx.stroke();
    }
}

function sendInput() {
    const angle = Math.atan2(mouse.y - H/2, mouse.x - W/2);
    socket.emit('input', { angle, boosting: isBoosting });
}

window.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
window.addEventListener('mousedown', () => isBoosting = true);
window.addEventListener('mouseup', () => isBoosting = false);
window.addEventListener('resize', () => { W=window.innerWidth; H=window.innerHeight; canvas.width=W; canvas.height=H; });

// Başlat
requestAnimationFrame(animate);
