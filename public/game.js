// --- ÖNEMLİ: BURAYA KENDİ RENDER LİNKİNİ YAZ ---
// Sondaki '/' işaretini koyma. Örn: 'https://wormeight.onrender.com'
const SERVER_URL = 'https://wormeight.onrender.com'; 

const socket = io(SERVER_URL); 

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d', { alpha: false });

const mainMenu = document.getElementById('main-menu');
const hud = document.getElementById('hud');
const scoreEl = document.getElementById('score-val');
const playBtn = document.getElementById('play-btn');
const nickInput = document.getElementById('nickname');
const connectionStatus = document.getElementById('connection-status');

let W, H;
let camera = { x: 0, y: 0, z: 1 };
let me = null;
let players = {};
let foods = [];
let mouse = { x: 0, y: 0 };
let isBoosting = false;

// --- GÖRSELLER (SKIN VE YEMLER) ---
const foodCache = {};
function createAssets() {
    const types = ['candy', 'donut', 'cookie', 'cake'];
    types.forEach(t => {
        const c = document.createElement('canvas');
        c.width=40; c.height=40; 
        const x=c.getContext('2d');
        x.translate(20,20);
        if(t==='donut') {
            x.beginPath(); x.arc(0,0,15,0,7); x.fillStyle='#FF69B4'; x.fill();
            x.beginPath(); x.arc(0,0,6,0,7); x.fillStyle='#1a1a2e'; x.fill();
            x.strokeStyle='#FFF'; x.lineWidth=2; x.stroke();
        } else if(t==='cake') {
            x.fillStyle='#8B4513'; x.fillRect(-10,-10,20,20);
            x.fillStyle='#FF4500'; x.beginPath(); x.arc(0,-10,3,0,7); x.fill();
        } else {
            x.beginPath(); x.arc(0,0,12,0,7); x.fillStyle=t==='candy'?'#FFD700':'#e91e63'; x.fill();
        }
        foodCache[t] = c;
    });
}
createAssets();

// --- BAĞLANTI OLAYLARI ---
socket.on('connect', () => {
    console.log("Sunucuya bağlandı!");
    connectionStatus.innerText = "Sunucuya Bağlandı! Oynamaya Hazır.";
    connectionStatus.style.color = "#00ff00";
    playBtn.disabled = false;
    playBtn.style.opacity = "1";
    playBtn.innerText = "OYNA";
    me = socket.id;
});

socket.on('connect_error', () => {
    connectionStatus.innerText = "Sunucu aranıyor... (Render uyanıyor olabilir)";
    connectionStatus.style.color = "#ffcc00";
    playBtn.disabled = true;
    playBtn.style.opacity = "0.5";
});

playBtn.addEventListener('click', () => {
    if(!socket.connected) return;
    socket.emit('joinGame', { 
        nick: nickInput.value || "Worm",
        skin: Math.floor(Math.random() * 5)
    });
    mainMenu.style.display = 'none';
    hud.style.display = 'block';
});

socket.on('u', (pack) => {
    // Oyuncuları güncelle
    let presentIds = {};
    pack.p.forEach(p => {
        presentIds[p.i] = true;
        if(!players[p.i]) {
            players[p.i] = p; // Yeni
        } else {
            players[p.i].tx = p.x; // Hedef X
            players[p.i].ty = p.y; // Hedef Y
            players[p.i].ta = p.a; // Hedef Açı
            players[p.i].h = p.h;  // Kuyruk
            players[p.i].r = p.r;
            players[p.i].s = p.s;
        }
    });
    for(let id in players) if(!presentIds[id]) delete players[id];
    foods = pack.f;
});

// --- RENDER DÖNGÜSÜ ---
function lerp(s, e, t) { return s * (1-t) + e * t; }

function draw() {
    requestAnimationFrame(draw);
    ctx.fillStyle = '#1a1a2e'; ctx.fillRect(0,0,W,H);

    // Eğer oyunda değilsek veya henüz bağlanmadıysak menü arkasında grid dönsün
    let targetX = W/2, targetY = H/2;
    if(me && players[me]) {
        const p = players[me];
        // İnterpolasyon
        if(p.tx) {
            p.x = lerp(p.x, p.tx, 0.15);
            p.y = lerp(p.y, p.ty, 0.15);
            let d = p.ta - p.angle;
            while(d <= -Math.PI) d+=Math.PI*2; while(d>Math.PI) d-=Math.PI*2;
            p.angle += d*0.15;
        }
        targetX = p.x; targetY = p.y;
        
        // Zoom
        let tz = Math.max(0.5, Math.min(1.2, 150/(p.r+80)));
        camera.z = lerp(camera.z, tz, 0.05);
    } else {
        // Menüde arka plan yavaşça kaysın
        targetX = Math.cos(Date.now()/5000)*500 + 2000;
        targetY = Math.sin(Date.now()/5000)*500 + 2000;
    }

    camera.x = lerp(camera.x, targetX, 0.1);
    camera.y = lerp(camera.y, targetY, 0.1);

    ctx.save();
    ctx.translate(W/2, H/2);
    ctx.scale(camera.z, camera.z);
    ctx.translate(-camera.x, -camera.y);

    drawGrid();
    
    // Sınırlar
    ctx.strokeStyle='#330000'; ctx.lineWidth=50; ctx.strokeRect(0,0,4000,4000);

    // Yemler
    foods.forEach(f => {
        let img = foodCache[f.t] || foodCache['candy'];
        ctx.drawImage(img, f.x-f.r, f.y-f.r, f.r*2, f.r*2);
    });

    // Oyuncular
    Object.values(players).sort((a,b)=>a.s-b.s).forEach(p => drawSnake(p));

    ctx.restore();

    if(me && players[me]) {
        scoreEl.innerText = players[me].s;
        let angle = Math.atan2(mouse.y - H/2, mouse.x - W/2);
        socket.emit('input', { a: angle, b: isBoosting });
    }
}

function drawSnake(p) {
    if(!p.h || p.h.length<2) return;
    const colors = [['#FF9800','#F57C00'], ['#E91E63','#C2185B'], ['#00BCD4','#0097A7'], ['#8BC34A','#689F38'], ['#9C27B0','#7B1FA2']];
    const skin = colors[p.k % colors.length] || colors[0];

    ctx.lineCap='round'; ctx.lineJoin='round';
    
    // Gölge
    ctx.beginPath();
    p.h.forEach((pos,i)=>i==0?ctx.moveTo(pos.x,pos.y+5):ctx.lineTo(pos.x,pos.y+5));
    ctx.lineTo(p.x, p.y+5);
    ctx.lineWidth=p.r*2; ctx.strokeStyle='rgba(0,0,0,0.2)'; ctx.stroke();

    // Gövde
    ctx.beginPath();
    p.h.forEach((pos,i)=>i==0?ctx.moveTo(pos.x,pos.y):ctx.lineTo(pos.x,pos.y));
    ctx.lineTo(p.x, p.y);
    
    ctx.lineWidth=p.r*2; ctx.strokeStyle=skin[0]; ctx.stroke();
    
    // Desen
    ctx.lineWidth=p.r*1.2; ctx.strokeStyle=skin[1]; 
    ctx.setLineDash([20,20]); ctx.stroke(); ctx.setLineDash([]);

    // Kafa
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.angle);
    ctx.fillStyle=skin[0]; ctx.beginPath(); ctx.arc(0,0,p.r,0,7); ctx.fill();
    
    // Gözler
    ctx.fillStyle='white'; 
    ctx.beginPath(); ctx.arc(p.r*0.4, -p.r*0.4, p.r*0.35, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(p.r*0.4, p.r*0.4, p.r*0.35, 0, 7); ctx.fill();
    ctx.fillStyle='black';
    ctx.beginPath(); ctx.arc(p.r*0.5, -p.r*0.4, p.r*0.15, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(p.r*0.5, p.r*0.4, p.r*0.15, 0, 7); ctx.fill();
    ctx.restore();

    // İsim
    ctx.fillStyle='white'; ctx.strokeStyle='black'; ctx.lineWidth=3;
    ctx.font=`bold ${Math.max(14, p.r)}px Fredoka One`; ctx.textAlign='center';
    ctx.strokeText(p.n, p.x, p.y-p.r-5); ctx.fillText(p.n, p.x, p.y-p.r-5);
}

function drawGrid() {
    ctx.strokeStyle='rgba(255,255,255,0.05)'; ctx.lineWidth=2;
    for(let i=0; i<=4000; i+=100) {
        ctx.beginPath(); ctx.moveTo(i,0); ctx.lineTo(i,4000); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0,i); ctx.lineTo(4000,i); ctx.stroke();
    }
}

window.onmousemove=e=>{mouse.x=e.clientX; mouse.y=e.clientY;};
window.onmousedown=()=>isBoosting=true; window.onmouseup=()=>isBoosting=false;
window.onresize=()=>{W=window.innerWidth;H=window.innerHeight;canvas.width=W;canvas.height=H;};
window.onresize();
draw();
