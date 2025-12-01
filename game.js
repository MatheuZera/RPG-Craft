// game.js (CLIENTE - 2 JOGADORES TECLADO)
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
let attackSent = false; 
let shootAngle = 0; 
let mouseX = 0; 
let mouseY = 0;
let playerNumber = 0; // Armazena 1 ou 2

// Mapeamento de Teclas para P1 e P2
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
    gameCanvas.width = mapWidth;
    gameCanvas.height = mapHeight;
    gameRunning = true;
    
    // Define o número do jogador (1 ou 2)
    const myPlayer = allPlayers[myPlayerId];
    if (myPlayer) {
        playerNumber = myPlayer.playerNum; // Usa a propriedade playerNum enviada pelo servidor
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
// ... (outros eventos)


// --- Lógica de Input (Teclado) ---
window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    
    // Mapeamento de Input para P1 e P2
    const map = INPUT_MAP[myPlayerId];
    if (!map) return;
    
    if (map.up.includes(key)) keysToSend.up = true;
    if (map.down.includes(key)) keysToSend.down = true;
    if (map.left.includes(key)) keysToSend.left = true;
    if (map.right.includes(key)) keysToSend.right = true;
    if (map.sprint.includes(key)) keysToSend.sprint = true;
    if (map.shoot.includes(key)) attackSent = true; 
    
    // Troca de Arma (1 a 7) - Disponível para ambos
    if (key >= '1' && key <= '7') {
         socket.emit('playerInput', { switchWeapon: parseInt(key) });
    }

    // Prevenir o scroll da página com as setas e barra de espaço
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
    // 'shoot' é redefinido apenas no sendInputToServer
});


// --- Lógica de Input (Mouse - Usado Apenas para Mira) ---
gameCanvas.addEventListener('mousemove', (e) => {
    const rect = gameCanvas.getBoundingClientRect();
    // Ajusta a posição do mouse para a coordenada do mundo do jogo
    mouseX = (e.clientX - rect.left) / (rect.width / gameCanvas.width) * (mapWidth / gameCanvas.width) + cameraX;
    mouseY = (e.clientY - rect.top) / (rect.height / gameCanvas.height) * (mapHeight / gameCanvas.height) + cameraY;
});

gameCanvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) { attackSent = true; } 
});


// --- Função de Envio de Input ---
function sendInputToServer() {
    if (!gameRunning || !myPlayerId) return;

    const myPlayer = allPlayers[myPlayerId];
    if (!myPlayer || !myPlayer.isAlive) return;

    // Calcular o ângulo de tiro baseado na posição do mouse
    const playerCenterX = myPlayer.x + myPlayer.width / 2;
    const playerCenterY = myPlayer.y + myPlayer.height / 2;
    
    // A mira do mouse é usada para definir a direção do tiro
    shootAngle = Math.atan2(mouseY - playerCenterY, mouseX - playerCenterX);
    
    // Envio final para o servidor
    socket.emit('playerInput', {
        keys: keysToSend, 
        shoot: attackSent, 
        shootAngle: shootAngle 
    });

    // Resetar o estado de tiro para exigir um novo clique/pressionar de tecla
    attackSent = false; 
}


// --- Loop Principal (Cliente) ---
function gameLoop(currentTime = 0) {
    if (!gameRunning) return;

    // 1. Envio de Input
    sendInputToServer();
    
    // 2. Lógica Local (Câmera)
    updateCamera(); 
    
    // 3. Desenho
    draw(); 

    requestAnimationFrame(gameLoop);
}
// O requestAnimationFrame(gameLoop) inicial é chamado em socket.on('playerData')

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

    let targetX = playerCenterX - gameCanvas.width / 2;
    let targetY = playerCenterY - gameCanvas.height / 2;

    targetX = Math.max(0, Math.min(mapWidth - gameCanvas.width, targetX));
    targetY = Math.max(0, Math.min(mapHeight - gameCanvas.height, targetY));
    
    cameraX += (targetX - cameraX) * 0.1; 
    cameraY += (targetY - cameraY) * 0.1; 
}

/**
 * Função para desenhar um obstáculo no canvas. (Corrigido)
 */
function drawObstacle(ctx, obstacle) {
    ctx.fillStyle = obstacle.color || '#34495e'; 
    ctx.fillRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
}


function draw() {
    ctx.fillStyle = '#1a202c'; 
    ctx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);
    
    ctx.save();
    ctx.translate(-cameraX, -cameraY); // Aplica a câmera

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

    // 3. Desenha Jogadores
    for (const id in allPlayers) {
        const player = allPlayers[id];
        if (!player.isAlive) continue;

        // Corpo
        ctx.fillStyle = player.color;
        ctx.fillRect(player.x, player.y, player.width, player.height);
        
        // Nome e UI
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

        // Barra de Energia (Sprint)
        const energyWidth = player.width * (player.energy / 100);
        ctx.fillStyle = '#444';
        ctx.fillRect(player.x, player.y - 9, player.width, 3);
        ctx.fillStyle = '#3498db';
        ctx.fillRect(player.x, player.y - 9, energyWidth, 3);
    }

    // 4. Desenha Mira (Crosshair)
    const myPlayer = allPlayers[myPlayerId];
    if (myPlayer) {
         ctx.strokeStyle = 'red';
         ctx.lineWidth = 1;
         ctx.beginPath();
         // Desenha a mira na posição do mouse ajustada pela câmera
         ctx.arc(mouseX, mouseY, 5, 0, Math.PI * 2); 
         ctx.stroke();
    }
    
    ctx.restore(); 
}