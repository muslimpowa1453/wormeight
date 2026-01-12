const socket = io(); 
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d', { alpha: false }); // Alpha false performans artırır

// --- HTML ELEMENTLERİ ---
const mainMenu = document.getElementById('main-menu');
const hud = document.getElementById('hud');
const scoreEl = document.getElementById('score');
const playBtn = document.getElementById('play-btn');
const nickInput = document.getElementById('nickname');

let W, H;
let camera = { x: 0, y: 0, z: 1 }; // z = zoom

// Oyun Verileri
let me = null;
let players = {};
let foods = [];
let mouse = { x: 0, y: 0 };
let isBoosting = false;

// --- GÖRSEL VARLIKLAR (RESİMSİZ WORMATE) ---
// Canvas üzerinde sanal "resimler" oluşturuyoruz (Cache Canvas)
const foodCache = {};

function createFoodAssets() {
    const types = ['candy', 'donut', 'cookie', 'cake'];
    types.forEach(type => {
        const c = document.createElement('canvas');
        c.width = 40; c.height = 40;
        const x = c.getContext('2d');
        const cx = 20, cy = 20;

        if(type === 'donut') {
            x.beginPath(); x.arc(cx, cy, 15, 0, Math.PI*2);
            x.fillStyle = '#FF69B4'; x.fill(); // Pembe
            x.beginPath(); x.arc(cx, cy, 6, 0, Math.PI*2);
            x.fillStyle = '#222'; x.fill(); // Delik (Arkaplan rengi olmalı aslında)
            // Süsler
            x.strokeStyle = '#FFF'; x.lineWidth = 2; 
            x.stroke(); 
        } else if (type === 'candy') {
            x.beginPath(); x.arc(cx, cy, 14, 0, Math.PI*2);
            x.fillStyle = '#FF4500'; x.fill();
            x.strokeStyle = '#FFF'; x.lineWidth = 4;
            x.beginPath(); x.moveTo(5,5); x.lineTo(35,35); x.stroke();
        } else {
            // Cookie
            x.beginPath(); x.arc(cx, cy, 14, 0, Math.PI*2);
            x.fillStyle = '#D2691E'; x.fill();
            x.fillStyle = '#3E2723'; 
            x.beginPath(); x.arc(cx-5, cy-5, 2, 0, Math.PI*2); x.fill();
            x.beginPath(); x.arc(cx+5, cy+5, 2, 0, Math.PI*2); x.fill();
        }
        foodCache[type] = c;
    });
}
createFoodAssets();

// --- BAŞLANGIÇ ---
playBtn.addEventListener('click', () => {
    socket.emit('joinGame', { 
        nick: nickInput.value || "Worm",
        skin: Math.floor(Math.random() * 3) // Rastgele skin
    });
    mainMenu.style.display = 'none';
    hud.style.display = 'block';
});

// --- VERİ ALIMI ---
socket.on('u', (pack) => {
    // Players Update
    let serverPlayers = {};
    pack.p.forEach(p => {
        serverPlayers[p.i] = p;
        if (!players[p.i]) {
            players[p.i] = p; // Yeni oyuncu
        } else {
            // Var olan oyuncuyu güncelle (Interpolasyon hedefi)
            players[p.i].tx = p.x;
            players[p.i].ty = p.y;
            players[p.i].ta = p.a;
            players[p.i].h = p.h; // History
            players[p.i].r = p.r;
            players[p.i].s = p.s;
        }
    });

    // Oyundan çıkanları sil
    for (let id in players) {
        if (!serverPlayers[id]) delete players[id];
    }

    foods = pack.f;
});

socket.on('connect', () => me = socket.id);

// --- RENDER LOOP ---
function lerp(start, end, t) { return start * (1-t) + end * t; }

function animate() {
    requestAnimationFrame(animate);

    // Ekranı temizle
    ctx.fillStyle = '#1a1a2e'; // Koyu mor arkaplan (Wormate stili)
    ctx.fillRect(0, 0, W, H);

    if (!me || !players[me]) return;

    const mySnake = players[me];

    // 1. İNTERPOLASYON (YUMUŞAK HAREKET)
    // Client tarafında fizik hesabı yaparak server gecikmesini gizle
    for (let id in players) {
        let p = players[id];
        if (p.tx !== undefined) {
            // Pozisyonu hedefe doğru %15 yaklaştır (Çok akıcı)
            p.x = lerp(p.x, p.tx, 0.15);
            p.y = lerp(p.y, p.ty, 0.15);
            
            // Açıyı düzelt
            let diff = p.ta - p.angle || 0;
            while (diff <= -Math.PI) diff += Math.PI * 2;
            while (diff > Math.PI) diff -= Math.PI * 2;
            p.angle = (p.angle || 0) + diff * 0.15;
        }
    }

    // 2. KAMERA VE ZOOM
    // Yılan büyüdükçe kamera uzaklaşır (Zoom out)
    let targetZoom = 150 / (mySnake.r + 100); // Dinamik Zoom Formülü
    if (targetZoom < 0.5) targetZoom = 0.5;
    if (targetZoom > 1.2) targetZoom = 1.2;
    camera.z = lerp(camera.z, targetZoom, 0.05);

    camera.x = lerp(camera.x, mySnake.x, 0.1);
    camera.y = lerp(camera.y, mySnake.y, 0.1);

    ctx.save();
    // Ekranın ortasına taşı
    ctx.translate(W/2, H/2);
    // Zoom yap
    ctx.scale(camera.z, camera.z);
    // Kamerayı oyuncu pozisyonuna odakla
    ctx.translate(-camera.x, -camera.y);

    // 3. ARKAPLAN GRİD (Sonsuzluk hissi için)
    drawGrid();
    drawBorders();

    // 4. YEMLER (Resim cache'inden çiz)
    for (let f of foods) {
        let img = foodCache[f.t] || foodCache['candy'];
        ctx.drawImage(img, f.x - f.r, f.y - f.r, f.r*2, f.r*2);
    }

    // 5. OYUNCULAR (Wormate Skinleri)
    // Skora göre sırala (Küçükler altta)
    let sorted = Object.values(players).sort((a,b) => a.s - b.s);
    
    for (let p of sorted) {
        drawSnake(ctx, p);
    }

    ctx.restore();

    // UI Güncelle
    scoreEl.innerText = mySnake.s;
    
    // Input Gönder
    sendInput();
}

function drawSnake(ctx, p) {
    if (!p.h || p.h.length === 0) return;

    // Yılan Boğumları (Wormate stili: Renkli çizgiler)
    // Gövdeyi çizmek için history noktalarını birleştirmek yerine
    // kalın bir stroke (çizgi) kullanacağız. Bu çok daha performanslıdır.
    
    // Skin Renkleri
    let colors = ['#ffcc00', '#ff0055', '#00ffcc'];
    let mainColor = colors[p.k % colors.length] || '#fff';
    let stripeColor = 'rgba(0,0,0,0.2)';

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    // Gövde (Dış çizgi / Gölge)
    ctx.beginPath();
    p.h.forEach((pos, i) => {
        if(i===0) ctx.moveTo(pos.x, pos.y);
        else ctx.lineTo(pos.x, pos.y);
    });
    // Kafayı da ekle
    ctx.lineTo(p.x, p.y);
    
    ctx.lineWidth = p.r * 2 + 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; // Gölge
    ctx.stroke();

    // Gövde (Ana Renk)
    ctx.lineWidth = p.r * 2;
    ctx.strokeStyle = mainColor;
    ctx.stroke();

    // Gövde (Desenler - Çizgiler)
    ctx.setLineDash([p.r, p.r]); // Kesik çizgilerle desen yap
    ctx.lineWidth = p.r * 1.5;
    ctx.strokeStyle = stripeColor;
    ctx.stroke();
    ctx.setLineDash([]); // Reset

    // KAFA
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);

    // Kafa yuvarlağı
    ctx.fillStyle = mainColor;
    ctx.beginPath(); ctx.arc(0, 0, p.r, 0, Math.PI*2); ctx.fill();

    // Gözler (Wormate stili büyük şaşkın gözler)
    let eyeOffset = p.r * 0.4;
    let eyeSize = p.r * 0.35;

    ctx.fillStyle = 'white';
    ctx.beginPath(); ctx.arc(eyeOffset, -eyeOffset, eyeSize, 0, Math.PI*2); ctx.fill(); // Sağ
    ctx.beginPath(); ctx.arc(eyeOffset, eyeOffset, eyeSize, 0, Math.PI*2); ctx.fill();  // Sol

    // Göz Bebekleri
    ctx.fillStyle = 'black';
    let pupilSize = eyeSize * 0.4;
    // Göz bebekleri fareye/hareket yönüne baksın
    ctx.beginPath(); ctx.arc(eyeOffset + 2, -eyeOffset, pupilSize, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(eyeOffset + 2, eyeOffset, pupilSize, 0, Math.PI*2); ctx.fill();

    ctx.restore();

    // İsim
    ctx.fillStyle = 'white';
    ctx.font = `bold ${Math.max(12, p.r)}px Arial`;
    ctx.textAlign = 'center';
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 3;
    ctx.strokeText(p.n, p.x, p.y - p.r - 10);
    ctx.fillText(p.n, p.x, p.y - p.r - 10);
}

function drawGrid() {
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 2;
    const gridSize = 100;
    
    // Sadece kamera alanını çiz (Performans)
    // Basit olması için geniş çiziyoruz
    for (let x = 0; x <= 4000; x += gridSize) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 4000); ctx.stroke();
    }
    for (let y = 0; y <= 4000; y += gridSize) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(4000, y); ctx.stroke();
    }
}

function drawBorders() {
    ctx.strokeStyle = '#ff3333';
    ctx.lineWidth = 20;
    ctx.strokeRect(0,0, 4000, 4000);
}

function sendInput() {
    const angle = Math.atan2(mouse.y - H/2, mouse.x - W/2);
    // 'a' = angle, 'b' = boosting (Kısaltma)
    socket.emit('input', { a: angle, b: isBoosting });
}

window.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
window.addEventListener('mousedown', () => isBoosting = true);
window.addEventListener('mouseup', () => isBoosting = false);
window.addEventListener('resize', () => { W=window.innerWidth; H=window.innerHeight; canvas.width=W; canvas.height=H; });

W=window.innerWidth; H=window.innerHeight; canvas.width=W; canvas.height=H;
requestAnimationFrame(animate);
