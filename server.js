const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
// Sıkıştırma ayarı ile bant genişliği tasarrufu
const io = new Server(server, { 
    cors: { origin: "*" },
    perMessageDeflate: true 
});
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// --- OPTİMİZE EDİLMİŞ AYARLAR ---
const MAP_SIZE = 4000;
const TICK_RATE = 15; // 15 TPS idealdir (Client bunu 60/144 FPS'e tamamlar)
const BASE_SPEED = 5;

let players = {};
let foods = [];
const FOOD_COUNT = 400;

// Şeker Tipleri (Wormate benzeri)
const FOOD_TYPES = ['candy', 'donut', 'cookie', 'cake'];

function spawnFood() {
    foods.push({
        id: Math.random().toString(36).substr(2, 5), // Kısa ID
        x: Math.round(Math.random() * MAP_SIZE),
        y: Math.round(Math.random() * MAP_SIZE),
        r: Math.floor(Math.random() * 5 + 5), // Radius
        t: FOOD_TYPES[Math.floor(Math.random() * FOOD_TYPES.length)], // Type
        c: Math.floor(Math.random() * 0xFFFFFF) // Renk (Integer olarak tutuyoruz, daha az yer kaplar)
    });
}

// Başlangıç Yemleri
for (let i = 0; i < FOOD_COUNT; i++) spawnFood();

io.on('connection', (socket) => {
    socket.on('joinGame', (data) => {
        players[socket.id] = {
            id: socket.id,
            nick: data.nick.substring(0, 12) || "Guest",
            skin: data.skin || 1, // Yılan deseni ID'si
            x: Math.random() * MAP_SIZE,
            y: Math.random() * MAP_SIZE,
            angle: Math.random() * 6.28,
            targetAngle: 0,
            score: 0,
            speed: BASE_SPEED,
            radius: 20, // Başlangıç kalınlığı
            history: [],
            boosting: false
        };
        // Kuyruk başlangıcı
        for(let i=0; i<10; i++) {
            players[socket.id].history.push({x: players[socket.id].x, y: players[socket.id].y});
        }
    });

    socket.on('input', (data) => {
        if(players[socket.id]) {
            players[socket.id].targetAngle = data.a; // 'angle' yerine 'a' (Veri tasarrufu)
            players[socket.id].boosting = data.b;    // 'boosting' yerine 'b'
        }
    });

    socket.on('disconnect', () => delete players[socket.id]);
});

setInterval(() => {
    let pack = { p: [], f: [] }; // Players, Foods (Kısaltılmış)

    for (const id in players) {
        const p = players[id];
        
        // 1. Wormate Fiziği: Büyüdükçe yavaş dön
        let turnSpeed = 0.15;
        if(p.score > 1000) turnSpeed = 0.1;
        if(p.score > 5000) turnSpeed = 0.05;

        let diff = p.targetAngle - p.angle;
        while (diff <= -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        
        if (Math.abs(diff) < turnSpeed) p.angle = p.targetAngle;
        else p.angle += Math.sign(diff) * turnSpeed;

        // 2. Hızlanma
        let currentSpeed = p.speed;
        if (p.boosting && p.score > 10) {
            currentSpeed *= 1.8;
            p.score -= 0.5; // Hızlı puan kaybı
            p.radius = 20 + Math.sqrt(p.score/10); // Hızlanırken biraz incelme efekti eklenebilir ama şimdilik sabit
        } else {
            // Boyut hesabı (Wormate mantığı: Skor arttıkça kalınlaş)
            p.radius = 20 + Math.floor(p.score / 500); 
            if(p.radius > 60) p.radius = 60; // Maksimum kalınlık
        }

        p.x += Math.cos(p.angle) * currentSpeed;
        p.y += Math.sin(p.angle) * currentSpeed;

        // Harita Sınırı (Yumuşak çarpma yerine kayma)
        p.x = Math.max(0, Math.min(MAP_SIZE, p.x));
        p.y = Math.max(0, Math.min(MAP_SIZE, p.y));

        // Kuyruk Mantığı (History)
        // Her tick'te değil, hareket ettikçe kayıt al (Daha pürüzsüz)
        p.history.push({ x: p.x, y: p.y });
        
        // Kuyruk uzunluğu skora bağlı
        const targetLen = 10 + Math.floor(p.score / 10);
        // Çok fazla nokta tutma, sadece gerekli olanları tut
        if (p.history.length > targetLen * 3) p.history.shift();

        // Yem Yeme (Basit Collision)
        // Performans için sadece yakındaki yemleri kontrol et (Grid sistemi gerekir ama şimdilik düz döngü)
        for (let i = foods.length - 1; i >= 0; i--) {
            const f = foods[i];
            const dist = Math.hypot(p.x - f.x, p.y - f.y);
            // Yılan kafası + Yem yarıçapı
            if (dist < p.radius + f.r) {
                p.score += 10; // Her yem 10 puan
                foods.splice(i, 1);
                spawnFood();
            }
        }

        // --- VERİ PAKETLEME (Veri tasarrufu için isimleri kısalttık ve sayıları yuvarladık) ---
        pack.p.push({
            i: p.id,
            x: Math.round(p.x * 10) / 10, // 1 ondalık hane yeterli
            y: Math.round(p.y * 10) / 10,
            a: Math.round(p.angle * 100) / 100,
            r: p.radius,
            s: Math.floor(p.score),
            h: p.history.filter((_, i) => i % 3 === 0).map(h => ({ x: Math.round(h.x), y: Math.round(h.y) })), // Her 3 noktadan 1'ini gönder (History sıkıştırma)
            n: p.nick,
            k: p.skin // Skin ID
        });
    }

    // Yemleri sadece değiştikleri zaman göndermek daha iyi olurdu ama şimdilik full gönderiyoruz
    // (Bunu optimize etmek için 'delta compression' gerekir, ileri seviye)
    pack.f = foods;

    io.emit('u', pack); // 'update' yerine 'u' (Event ismini bile kısalttık)

}, 1000 / TICK_RATE);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Sunucu ${PORT} portunda`));
