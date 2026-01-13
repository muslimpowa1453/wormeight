const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

console.log(`WormEight Sunucusu ${PORT} portunda başlatıldı.`);

// Oyun Durumu
const players = new Map();
let foodItems = [];
const MAP_RADIUS = 3000;
const MAX_FOOD = 500;

// Başlangıç Yemlerini Üret
generateFood(300);

wss.on('connection', (ws) => {
    const id = Math.random().toString(36).substring(2, 9);
    let playerInfo = { id, x: 0, y: 0, angle: 0, score: 10, name: "Guest", skin: 0, width: 24 };

    // İlk bağlantıda ID ve mevcut yemleri gönder
    ws.send(JSON.stringify({
        type: 'init',
        id: id,
        food: foodItems
    }));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'update') {
                // Oyuncu Hareket Güncellemesi
                playerInfo = { ...playerInfo, ...data };
                playerInfo.lastUpdate = Date.now();
                players.set(id, playerInfo);
            }

            if (data.type === 'eat') {
                // Yem Yeme İsteği
                const foodId = data.foodId;
                const index = foodItems.findIndex(f => f.id === foodId);
                
                if (index !== -1) {
                    // Yemi sil ve herkese bildir
                    foodItems.splice(index, 1);
                    broadcast({ type: 'food_eaten', id: foodId });
                    
                    // Yeni yem üret
                    if (foodItems.length < MAX_FOOD) {
                        const newFood = createSingleFood();
                        foodItems.push(newFood);
                        broadcast({ type: 'food_new', item: newFood });
                    }
                }
            }
            
            if (data.type === 'die') {
                players.delete(id);
                broadcast({ type: 'player_left', id: id });
            }

        } catch (e) {
            console.error("Mesaj hatası:", e);
        }
    });

    ws.on('close', () => {
        players.delete(id);
        broadcast({ type: 'player_left', id: id });
    });
});

// Oyun Döngüsü (Saniyede 20 kez güncelleme gönderir)
setInterval(() => {
    const playerList = [];
    players.forEach(p => {
        // Hareketsiz veya kopmuş oyuncuları temizle (10sn timeout)
        if (Date.now() - p.lastUpdate > 10000) {
            players.delete(p.id);
        } else {
            // Sıkıştırılmış veri gönder (Bant genişliği tasarrufu)
            // [id, x, y, angle, score, skin, width, history_sample, name]
            playerList.push({
                id: p.id,
                n: p.name,
                x: Math.round(p.x),
                y: Math.round(p.y),
                a: parseFloat(p.angle.toFixed(2)),
                s: Math.floor(p.score),
                sk: p.skin,
                w: p.width,
                h: p.history ? p.history.filter((_, i) => i % 4 === 0) : [] // Kuyruğu sıkıştır
            });
        }
    });

    if (playerList.length > 0) {
        broadcast({ type: 'tick', players: playerList });
    }
}, 50);

function broadcast(data) {
    const msg = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(msg);
        }
    });
}

function generateFood(count) {
    for (let i = 0; i < count; i++) {
        foodItems.push(createSingleFood());
    }
}

function createSingleFood() {
    const types = ['donut', 'cake', 'candy'];
    const r = Math.random() * MAP_RADIUS;
    const a = Math.random() * Math.PI * 2;
    return {
        id: Math.random().toString(36).substr(2, 9),
        x: Math.round(Math.cos(a) * r),
        y: Math.round(Math.sin(a) * r),
        type: Math.random() < 0.05 ? 'powerup' : 'food',
        kind: types[Math.floor(Math.random() * types.length)], // Görsel tipi
        pType: ['speed', 'magnet', '2x', '5x'][Math.floor(Math.random() * 4)], // Powerup tipi
        val: Math.floor(Math.random() * 5) + 1,
        color: `hsl(${Math.floor(Math.random() * 360)}, 80%, 60%)`
    };
}
