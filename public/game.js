// Render sunucu adresin (Otomatik algılaması için window.location kullanıyoruz,
// böylece hem localhostta hem Render'da çalışır)
const socket = io(); 

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const onlineCountEl = document.getElementById('online-count');
const errorScreen = document.getElementById('error-screen');

let canvasWidth = window.innerWidth;
let canvasHeight = window.innerHeight;
canvas.width = canvasWidth;
canvas.height = canvasHeight;

// Kameranın takip edeceği oyuncu verisi
let myListId = null; 
let myX = 0;
let myY = 0;

// Mouse verisi
const mouse = { x: 0, y: 0 };
let isBoosting = false;

// --- SOCKET OLAYLARI ---

// Bağlandığında ID'mizi öğrenelim
socket.on('connect', () => {
    console.log("Sunucuya bağlandı!", socket.id);
    myListId = socket.id;
    errorScreen.style.display = 'none'; // Hata ekranını gizle
});

// Bağlantı hatası veya kopma
socket.on('disconnect', () => {
    console.log("Bağlantı koptu!");
    errorScreen.style.display = 'block'; // Hata ekranını göster
});

socket.on('connect_error', () => {
    errorScreen.style.display = 'block';
});

// Sunucudan her güncelleme geldiğinde (Oyun Döngüsü burasıdır)
socket.on('gameState', (state) => {
    // 1. Kendi oyuncumuzu bulalım (Kamera için)
    const me = state.players[socket.id];
    if (me) {
        myX = me.x;
        myY = me.y;
        scoreEl.innerText = Math.floor(me.score);
    }
    
    // Online sayısını güncelle
    onlineCountEl.innerText = Object.keys(state.players).length;

    // 2. Çizime Başla
    draw(state);
    
    // 3. Bizim inputumuzu sunucuya gönder
    sendInput();
});

// --- CLIENT MANTIĞI ---

window.addEventListener('resize', () => {
    canvasWidth = window.innerWidth;
    canvasHeight = window.innerHeight;
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
});

window.addEventListener('mousemove', (e) => {
    // Mouse pozisyonunu ekranın merkezine göre hesapla
    mouse.x = e.clientX - canvasWidth / 2;
    mouse.y = e.clientY - canvasHeight / 2;
});

window.addEventListener('mousedown', () => isBoosting = true);
window.addEventListener('mouseup', () => isBoosting = false);

function sendInput() {
    // Mouse açısını hesapla
    const angle = Math.atan2(mouse.y, mouse.x);
    // Sunucuya gönder
    socket.emit('input', {
        angle: angle,
        boosting: isBoosting
    });
}

// --- ÇİZİM FONKSİYONLARI ---

function draw(state) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Kamera Sistemi: Dünyayı oyuncunun tersine kaydır
    ctx.save();
    ctx.translate(canvasWidth / 2 - myX, canvasHeight / 2 - myY);

    // Grid Çiz (Referans olması için)
    drawGrid();
    
    // Sınırları Çiz
    ctx.strokeStyle = 'red';
    ctx.lineWidth = 10;
    ctx.strokeRect(0, 0, 3000, 3000); // 3000 server.js'deki MAP_SIZE ile aynı olmalı

    // Yemleri Çiz
    state.foods.forEach(f => {
        ctx.beginPath();
        ctx.fillStyle = f.color;
        ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2);
        ctx.fill();
    });

    // Oyuncuları Çiz
    for (const id in state.players) {
        const p = state.players[id];
        drawPlayer(p);
    }

    ctx.restore();
}

function drawPlayer(p) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    // Gövde (History'den çizilir)
    const length = 20 + Math.floor(p.score / 2);
    const segmentGap = 4;

    for (let i = 0; i < length; i++) {
        const index = p.history.length - 1 - (i * segmentGap);
        if (index < 0) break;
        
        const pos = p.history[index];
        ctx.beginPath();
        ctx.fillStyle = p.color;
        // Kafa biraz daha büyük
        ctx.arc(pos.x, pos.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
    }

    // İsim veya Göz (Sadece kafaya çiz)
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.fillStyle = 'white';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText("Oyuncu", 0, -25); // İsim etiketi
    ctx.restore();
}

function drawGrid() {
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    // Basit bir grid
    for (let x = 0; x <= 3000; x += 100) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 3000); ctx.stroke();
    }
    for (let y = 0; y <= 3000; y += 100) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(3000, y); ctx.stroke();
    }
}
