const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const path = require('path');

// Client dosyalarını (public klasörü) dışarıya sun
app.use(express.static(path.join(__dirname, 'public')));

// Ana sayfa isteğinde index.html'i gönder
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- OYUN DEĞİŞKENLERİ ---
const MAP_SIZE = 3000;
const players = {}; // Bağlı oyuncular
const foods = [];
const FOOD_COUNT = 300;

// Rastgele renk üretici
function randomColor() {
    const colors = ['#ff0055', '#ffcc00', '#00ffcc', '#aa00ff', '#55ff00'];
    return colors[Math.floor(Math.random() * colors.length)];
}

// Başlangıç yemlerini oluştur
for (let i = 0; i < FOOD_COUNT; i++) {
    foods.push({
        id: Math.random().toString(36).substr(2, 9),
        x: Math.random() * MAP_SIZE,
        y: Math.random() * MAP_SIZE,
        radius: Math.random() * 5 + 5,
        color: randomColor()
    });
}

// --- SOCKET.IO BAĞLANTILARI ---
io.on('connection', (socket) => {
    console.log('Bir oyuncu bağlandı: ' + socket.id);

    // Yeni oyuncu oluştur
    players[socket.id] = {
        id: socket.id,
        x: MAP_SIZE / 2 + (Math.random() * 500 - 250),
        y: MAP_SIZE / 2 + (Math.random() * 500 - 250),
        radius: 15,
        angle: 0,
        score: 0,
        speed: 3,
        history: [], // Kuyruk için
        color: randomColor()
    };

    // Oyuncu hareket verisi (input) aldığımızda
    socket.on('input', (data) => {
        const player = players[socket.id];
        if (player) {
            player.angle = data.angle;
            player.boosting = data.boosting;
        }
    });

    // Bağlantı koparsa
    socket.on('disconnect', () => {
        console.log('Oyuncu ayrıldı: ' + socket.id);
        delete players[socket.id];
    });
});

// --- OYUN DÖNGÜSÜ (SERVER TICK) ---
// Saniyede 60 kare (60 FPS) ile sunucuda hesaplama yapıyoruz
setInterval(() => {
    // Tüm oyuncuları güncelle
    for (const id in players) {
        const p = players[id];

        // Hızlanma (Boost) Mantığı
        if (p.boosting && p.score > 10) {
            p.speed = 6;
            p.score -= 0.1; // Hızlanırken küçülme
        } else {
            p.speed = 3;
        }

        // Hareket
        p.x += Math.cos(p.angle) * p.speed;
        p.y += Math.sin(p.angle) * p.speed;

        // Harita Sınırları
        if (p.x < 0) p.x = 0;
        if (p.x > MAP_SIZE) p.x = MAP_SIZE;
        if (p.y < 0) p.y = 0;
        if (p.y > MAP_SIZE) p.y = MAP_SIZE;

        // Kuyruk Geçmişi (History)
        p.history.push({ x: p.x, y: p.y });
        const targetLength = 20 + Math.floor(p.score / 2);
        if (p.history.length > targetLength * 5) { // Basit buffer
            p.history.shift();
        }

        // Yem Yeme Kontrolü (Basit çarpışma)
        // Not: Performans için normalde QuadTree kullanılır ama şimdilik döngü yeterli.
        for (let i = foods.length - 1; i >= 0; i--) {
            const f = foods[i];
            const dist = Math.hypot(p.x - f.x, p.y - f.y);
            
            if (dist < p.radius + f.radius) {
                p.score += 1;
                // Yemi sil ve yenisini rastgele bir yere koy
                foods[i] = {
                    id: Math.random().toString(36).substr(2, 9),
                    x: Math.random() * MAP_SIZE,
                    y: Math.random() * MAP_SIZE,
                    radius: Math.random() * 5 + 5,
                    color: randomColor()
                };
            }
        }
    }

    // Oyun durumunu tüm clientlara gönder (Broadcasting)
    io.emit('gameState', {
        players: players,
        foods: foods
    });

}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Sunucu çalışıyor: Port ${PORT}`);
});
