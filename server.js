const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server, { cors: { origin: "*" } });
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// --- OYUN AYARLARI ---
const MAP_SIZE = 4000; // Harita biraz daha büyük olsun
const TICK_RATE = 20;  // Server 20 FPS çalışır (Client 60+ FPS interpole eder)
const TURN_SPEED = 0.15; // Dönüş hızı (Radyan/Tick)
const BASE_SPEED = 4;

let players = {};
let foods = [];
let powerups = [];
const FOOD_COUNT = 500;
const POWERUP_COUNT = 20;

// Power-up Tipleri ve Süreleri (Saniye cinsinden tick hesabı için x20 ile çarpılacak serverda)
const POWERUP_TYPES = [
    { type: 'agility', color: '#00FF00', duration: 40, label: 'AE' }, // "ae" = Agility/Manevra sandım
    { type: 'x2',      color: '#FF00FF', duration: 60, label: '2x' },
    { type: 'x5',      color: '#FF0000', duration: 40, label: '5x' },
    { type: 'x10',     color: '#FFA500', duration: 20, label: '10x' },
    { type: 'speed',   color: '#00FFFF', duration: 40, label: 'HIZ' },
    { type: 'magnet',  color: '#0000FF', duration: 40, label: 'MIK' }
];

function randomColor() { return '#' + Math.floor(Math.random()*16777215).toString(16); }

// Başlangıç nesneleri
for (let i = 0; i < FOOD_COUNT; i++) spawnFood();
for (let i = 0; i < POWERUP_COUNT; i++) spawnPowerup();

function spawnFood() {
    foods.push({
        id: Math.random().toString(36).substr(2, 9),
        x: Math.random() * MAP_SIZE,
        y: Math.random() * MAP_SIZE,
        radius: Math.random() * 5 + 5,
        color: randomColor(),
        value: 1
    });
}

function spawnPowerup() {
    const type = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
    powerups.push({
        id: Math.random().toString(36).substr(2, 9),
        x: Math.random() * MAP_SIZE,
        y: Math.random() * MAP_SIZE,
        radius: 25, // Power-up daha büyük görünür
        type: type.type,
        color: type.color,
        label: type.label,
        duration: type.duration * 1000 // ms cinsinden
    });
}

io.on('connection', (socket) => {
    socket.on('joinGame', (nickname) => {
        players[socket.id] = {
            id: socket.id,
            nickname: nickname || "Misafir",
            x: Math.random() * MAP_SIZE,
            y: Math.random() * MAP_SIZE,
            radius: 15,
            angle: Math.random() * Math.PI * 2,
            targetAngle: 0,
            score: 0,
            speed: BASE_SPEED,
            history: [],
            color: randomColor(),
            boosting: false,
            // Efektler
            effects: {
                agility: 0, multiplier: 1, speed: 0, magnet: 0
            }
        };
        // Kuyruk başlat
        for(let i=0; i<20; i++) players[socket.id].history.push({x: players[socket.id].x, y: players[socket.id].y});
    });

    socket.on('input', (data) => {
        const p = players[socket.id];
        if (p) {
            p.targetAngle = data.angle;
            p.boosting = data.boosting;
        }
    });

    socket.on('disconnect', () => delete players[socket.id]);
});

// --- OYUN DÖNGÜSÜ ---
setInterval(() => {
    for (const id in players) {
        const p = players[id];
        
        // 1. Açısal Dönüş Fiziği (Yumuşak Dönüş)
        let diff = p.targetAngle - p.angle;
        // Açıyı -PI ile +PI arasına normalize et
        while (diff <= -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        
        // Dönüş hızı (Agility varsa daha hızlı dön)
        let turnSpeed = TURN_SPEED * (p.effects.agility > Date.now() ? 2 : 1);
        
        if (Math.abs(diff) < turnSpeed) p.angle = p.targetAngle;
        else p.angle += Math.sign(diff) * turnSpeed;

        // 2. Hız ve Boost
        let currentSpeed = p.effects.speed > Date.now() ? BASE_SPEED * 1.5 : BASE_SPEED;
        
        if (p.boosting && p.score > 10) {
            currentSpeed *= 2;
            p.score -= 0.1; // Skor harca
        }
        
        // Hareket
        p.x += Math.cos(p.angle) * currentSpeed;
        p.y += Math.sin(p.angle) * currentSpeed;

        // Harita Sınırları
        p.x = Math.max(0, Math.min(MAP_SIZE, p.x));
        p.y = Math.max(0, Math.min(MAP_SIZE, p.y));

        // Kuyruk
        p.history.push({ x: p.x, y: p.y });
        const targetLength = 20 + Math.floor(p.score / 2);
        if (p.history.length > targetLength * 5) p.history.shift();

        // 3. Mıknatıs Mantığı
        let magnetRange = p.radius + 10;
        if (p.effects.magnet > Date.now()) magnetRange = 300; // Mıknatıs varsa çekim alanı devasa

        // Yem Kontrolü
        for (let i = foods.length - 1; i >= 0; i--) {
            const f = foods[i];
            const dist = Math.hypot(p.x - f.x, p.y - f.y);

            // Mıknatıs Çekimi
            if (dist < magnetRange && dist > p.radius) {
                // Yemi oyuncuya çek
                const angleToPlayer = Math.atan2(p.y - f.y, p.x - f.x);
                f.x += Math.cos(angleToPlayer) * 10; // Çekim hızı
                f.y += Math.sin(angleToPlayer) * 10;
            }

            // Yeme
            if (dist < p.radius + f.radius) {
                // Skor çarpanı kontrolü
                let multiplier = 1;
                if (p.effects.multiplier > 1 && p.effects.multiplier_time > Date.now()) {
                    multiplier = p.effects.multiplier;
                }
                
                p.score += f.value * multiplier;
                foods.splice(i, 1);
                spawnFood();
            }
        }

        // 4. Power-up Kontrolü
        for (let i = powerups.length - 1; i >= 0; i--) {
            const pu = powerups[i];
            const dist = Math.hypot(p.x - pu.x, p.y - pu.y);
            
            if (dist < p.radius + pu.radius) {
                const endTime = Date.now() + pu.duration;
                
                if (pu.type === 'agility') p.effects.agility = endTime;
                if (pu.type === 'speed') p.effects.speed = endTime;
                if (pu.type === 'magnet') p.effects.magnet = endTime;
                if (pu.type === 'x2') { p.effects.multiplier = 2; p.effects.multiplier_time = endTime; }
                if (pu.type === 'x5') { p.effects.multiplier = 5; p.effects.multiplier_time = endTime; }
                if (pu.type === 'x10') { p.effects.multiplier = 10; p.effects.multiplier_time = endTime; }

                powerups.splice(i, 1);
                spawnPowerup(); // Yenisini oluştur
            }
        }
    }

    // State Gönder
    // Veriyi küçültmek için sadece gerekli alanları gönderiyoruz
    const pack = {
        players: Object.values(players).map(p => ({
            id: p.id, x: p.x, y: p.y, angle: p.angle, radius: p.radius, 
            score: p.score, nickname: p.nickname, history: p.history, color: p.color
        })),
        foods: foods,
        powerups: powerups
    };
    
    io.emit('gameState', pack);

}, 1000 / TICK_RATE);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Sunucu ${PORT} portunda çalışıyor`));
