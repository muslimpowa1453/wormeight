const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server, { cors: { origin: "*" } });
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- OYUN AYARLARI ---
const MAP_SIZE = 3000;
const TICK_RATE = 20; // Saniyede 20 güncelleme (Daha az veri, daha az lag)
const players = {};
const foods = [];
const FOOD_COUNT = 300;

function randomColor() {
    const colors = ['#ff0055', '#ffcc00', '#00ffcc', '#aa00ff', '#55ff00', '#ff5500'];
    return colors[Math.floor(Math.random() * colors.length)];
}

// Yemleri oluştur
for (let i = 0; i < FOOD_COUNT; i++) {
    foods.push({
        id: Math.random().toString(36).substr(2, 9),
        x: Math.random() * MAP_SIZE,
        y: Math.random() * MAP_SIZE,
        radius: Math.random() * 5 + 5,
        color: randomColor()
    });
}

io.on('connection', (socket) => {
    console.log('Bağlandı:', socket.id);

    // Oyuncu oyuna "Başla" dediğinde
    socket.on('joinGame', (nickname) => {
        players[socket.id] = {
            id: socket.id,
            nickname: nickname || "Misafir", // İsim yoksa Misafir
            x: Math.random() * MAP_SIZE,
            y: Math.random() * MAP_SIZE,
            radius: 15,
            angle: 0,
            score: 0,
            speed: 3,
            history: [],
            color: randomColor(),
            boosting: false
        };
        // Kuyruk başlangıcı
        for(let i=0; i<20; i++) players[socket.id].history.push({x: players[socket.id].x, y: players[socket.id].y});
    });

    socket.on('input', (data) => {
        const player = players[socket.id];
        if (player) {
            player.targetAngle = data.angle; // Hedef açı
            player.boosting = data.boosting;
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
    });
});

// --- OYUN DÖNGÜSÜ ---
setInterval(() => {
    for (const id in players) {
        const p = players[id];

        // Açıyı yumuşak döndür (Server tarafı basit dönüş)
        if (p.targetAngle !== undefined) p.angle = p.targetAngle;

        // Boost Mantığı
        if (p.boosting && p.score > 10) {
            p.speed = 6;
            p.score -= 0.1;
        } else {
            p.speed = 3;
        }

        // Hareket
        p.x += Math.cos(p.angle) * p.speed;
        p.y += Math.sin(p.angle) * p.speed;

        // Harita Sınırları
        p.x = Math.max(0, Math.min(MAP_SIZE, p.x));
        p.y = Math.max(0, Math.min(MAP_SIZE, p.y));

        // Kuyruk Güncelleme
        p.history.push({ x: p.x, y: p.y });
        const targetLength = 20 + Math.floor(p.score / 2);
        if (p.history.length > targetLength * 5) p.history.shift();

        // Yem Yeme
        for (let i = foods.length - 1; i >= 0; i--) {
            const f = foods[i];
            const dist = Math.hypot(p.x - f.x, p.y - f.y);
            if (dist < p.radius + f.radius) {
                p.score += 1;
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

    io.emit('gameState', { players, foods });

}, 1000 / TICK_RATE);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Sunucu ${PORT} portunda çalışıyor`));
