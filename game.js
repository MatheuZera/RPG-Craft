// game.js (CLIENTE - 2 JOGADORES TECLADO, MIRA AUTOMÁTICA)
const gameCanvas = document.getElementById('gameCanvas');
const ctx = gameCanvas.getContext('2d');
const messagesContainer = document.getElementById('messages');

// --- Conexão e Estado Local ---
const socket = io(); 
let myPlayerId = null; 
let allPlayers = {}; 
let serverProjectiles = {}; 
let serverObstacles = []; 
let mapWidth = 1000; 
let mapHeight = 750; 
let cameraX = 0; 
let cameraY = 0; 
let gameRunning = false;
const ARROW_SIZE = 10;
const PLAYER_SIZE = 30;

// --- Input (Teclado) ---
let keysToSend = { up: false, down: false, left: false, right: false, sprint: false };
let attackSent = false; // Flag para um único ataque por pressionamento
let playerNumber = 0; 

// Mapeamento de Teclas
const INPUT_MAP = {
    P1: {
        up: ['w'], down: ['s'], left: ['a'], right: ['d'], sprint: ['f'], shoot: ['c']
    },
    P2: {
        up: ['arrowup'], down: ['arrowdown'], left: ['arrowleft'], right: ['arrowright'], sprint: ['p'], shoot: ['l']
    }
};

// --- Recebimento de Dados (Eventos de Rede) ---
socket.on('playerData', (data) => {
    myPlayerId = data.id;
    allPlayers = data.players;
    serverObstacles = data.obstacles;
    mapWidth = data.mapWidth;
    mapHeight = data.mapHeight;
    
    // Ajuste o tamanho do canvas para o tamanho do mundo (o CSS cuidará da responsividade)
    gameCanvas.width = mapWidth;
    gameCanvas.height = mapHeight;
    
    gameRunning = true;
    
    const myPlayer = allPlayers[myPlayerId];
    if (myPlayer) {
        playerNumber = myPlayer.playerNum;
    }
    
    showMessage('Conectado: ' + myPlayerId);
    requestAnimationFrame(gameLoop); 
});

socket.on('gameStateUpdate', (data) => {
    allPlayers = data.players;
    serverProjectiles = data.projectiles;
});

socket.on('message', (text) => { showMessage(text); });
socket.on('playerKilled', (data) => { 
    const targetName = allPlayers[data.targetId]?.name || 'Jogador';
    const killerName = allPlayers[data.killerId]?.name || 'Jogador';
    showMessage(`${targetName} foi derrotado por ${killerName}!`);
});
socket.on('playerDisconnected', (id) => { delete allPlayers[id]; });


// --- Lógica de Input (Teclado) ---
window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    
    const map = INPUT_MAP[myPlayerId];
    if (!map) return;
    
    if (map.up.includes(key)) keysToSend.up = true;
    if (map.down.includes(key)) keysToSend.down = true;
    if (map.left.includes(key)) keysToSend.left = true;
    if (map.right.includes(key)) keysToSend.right = true;
    if (map.sprint.includes(key)) keysToSend.sprint = true;
    // O tiro é enviado como um pulso (true -> false)
    if (map.shoot.includes(key)) attackSent = true; 
    
    // Troca de Arma (1 a 7)
    if (key >= '1' && key <= '7') {
         socket.emit('playerInput', { switchWeapon: parseInt(key) });
    }

    if ([' ', 'w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    
    const map = INPUT_MAP[myPlayerId];
    if (!map) return;

    if (map.up.includes(key)) keysToSend.up = false;
    if (map.down.includes(key)) keysToSend.down = false;
    if (map.left.includes(key)) keysToSend.left = false;
    if (map.right.includes(key)) keysToSend.right = false;
    if (map.sprint.includes(key)) keysToSend.sprint = false;
});


// --- Lógica de Input (Mouse - APENAS para Atirar) ---
// Removemos mousemove (mira automática) e mantemos mousedown para atirar (opcional)
gameCanvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) { attackSent = true; } // Botão esquerdo
});


// --- Função de Envio de Input ---
function sendInputToServer() {
    if (!gameRunning || !myPlayerId) return;

    const myPlayer = allPlayers[myPlayerId];
    if (!myPlayer || !myPlayer.isAlive) return;

    // Envio final para o servidor. shootAngle é OMITIDO ou zero, 
    // pois o servidor calcula a mira automaticamente.
    socket.emit('playerInput', {
        keys: keysToSend, 
        shoot: attackSent, 
        shootAngle: 0 // Ignorado pelo servidor, mas enviado para o protocolo
    });

    // Resetar o estado de tiro (Mouse/Teclado)
    attackSent = false; 
}


// --- Loop Principal (Cliente) ---
function gameLoop(currentTime = 0) {
    if (!gameRunning) return;

    sendInputToServer();
    updateCamera(); 
    draw(); 

    requestAnimationFrame(gameLoop);
}

// --- Funções de Desenho e UI ---

function showMessage(text) {
    const message = document.createElement('div');
    message.className = 'message';
    message.textContent = text;
    messagesContainer.prepend(message); 
    while (messagesContainer.children.length > 5) {
        messagesContainer.removeChild(messagesContainer.lastChild);
    }
}

function updateCamera() {
    const myPlayer = allPlayers[myPlayerId];
    if (!myPlayer) return;

    const playerCenterX = myPlayer.x + myPlayer.width / 2;
    const playerCenterY = myPlayer.y + myPlayer.height / 2;

    // A câmera deve seguir o jogador local, ajustada para o tamanho da tela do cliente
    // gameCanvas.clientWidth e gameCanvas.clientHeight refletem o tamanho real (CSS) na tela.
    let targetX = playerCenterX - gameCanvas.clientWidth / 2;
    let targetY = playerCenterY - gameCanvas.clientHeight / 2;

    // Ajuste de Limites (usa o tamanho do mundo, mapWidth/mapHeight)
    targetX = Math.max(0, Math.min(mapWidth - gameCanvas.clientWidth, targetX));
    targetY = Math.max(0, Math.min(mapHeight - gameCanvas.clientHeight, targetY));
    
    // Suavização
    cameraX += (targetX - cameraX) * 0.1; 
    cameraY += (targetY - cameraY) * 0.1; 
}

/**
 * Função para desenhar um obstáculo no canvas. (Corrigido o ReferenceError)
 */
function drawObstacle(ctx, obstacle) {
    ctx.fillStyle = obstacle.color || '#34495e'; 
    ctx.fillRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
}

function draw() {
    ctx.fillStyle = '#1a202c'; 
    ctx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);
    
    // A transformação da câmera deve usar cameraX/Y (posição no mundo)
    // e o canvas.width/height (tamanho do mundo), mas ser renderizado 
    // proporcionalmente ao tamanho de exibição (CSS).
    ctx.save();
    ctx.translate(-cameraX, -cameraY); 

    // 1. Desenha Obstáculos
    serverObstacles.forEach(obs => {
        drawObstacle(ctx, obs);
    });

    // 2. Desenha Projéteis
    for (const id in serverProjectiles) {
        const proj = serverProjectiles[id];
        ctx.fillStyle = proj.color;
        ctx.beginPath();
        ctx.arc(proj.x, proj.y, ARROW_SIZE / 2, 0, Math.PI * 2);
        ctx.fill();
    }

    // 3. Desenha Jogadores e suas UI (HP, Energia)
    for (const id in allPlayers) {
        const player = allPlayers[id];
        if (!player.isAlive) continue;

        // Corpo
        ctx.fillStyle = player.color;
        ctx.fillRect(player.x, player.y, player.width, player.height);
        
        // Nome e UI de vida/energia (desenha no mundo)
        ctx.fillStyle = 'white';
        ctx.font = '10px "Press Start 2P"';
        ctx.textAlign = 'center';
        ctx.fillText(player.name, player.x + player.width / 2, player.y - 20);
        
        // Barra de HP
        const hpWidth = player.width * (player.health / 100);
        ctx.fillStyle = 'red';
        ctx.fillRect(player.x, player.y - 15, player.width, 5);
        ctx.fillStyle = 'lime';
        ctx.fillRect(player.x, player.y - 15, hpWidth, 5);

        // Barra de Energia
        const energyWidth = player.width * (player.energy / 100);
        ctx.fillStyle = '#444';
        ctx.fillRect(player.x, player.y - 9, player.width, 3);
        ctx.fillStyle = '#3498db';
        ctx.fillRect(player.x, player.y - 9, energyWidth, 3);
    }
    
    ctx.restore(); 
    
    // 4. Desenha UI Fixa (Fora da Câmera)
    const myPlayer = allPlayers[myPlayerId];
    if (myPlayer) {
        ctx.fillStyle = 'white';
        ctx.font = '12px "Press Start 2P"';
        ctx.textAlign = 'left';
        
        ctx.fillText(`ARMA: ${myPlayer.equippedWeapon.name}`, 10, 30);
        ctx.fillText(`FLECHAS: ${myPlayer.arrows}`, 10, 50);
    }
}