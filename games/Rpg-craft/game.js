// game.js
const gameCanvas = document.getElementById('gameCanvas');
const ctx = gameCanvas.getContext('2d');
const messagesContainer = document.getElementById('messages');
const gamepad1Info = document.getElementById('gamepad1Info');
const gamepad2Info = document.getElementById('gamepad2Info');

// NOVOS ELEMENTOS DO DOM
const playerGUI = document.getElementById('player-gui');
const healthBar = document.getElementById('health-bar');
const healthValue = document.getElementById('health-value');
const energyBar = document.getElementById('energy-bar');
const energyValue = document.getElementById('energy-value');
const weaponNameDisplay = document.getElementById('weapon-name');
const ammoCountDisplay = document.getElementById('ammo-count');
const cssWeaponShapeContainer = document.getElementById('css-weapon-shape');
const respawnMessage = document.getElementById('respawn-message');
const respawnTimer = document.getElementById('respawn-timer');
const visualEffectsOverlay = document.getElementById('visual-effects-overlay');


// Referências aos displays de controle
const playerControlDisplays = {
    'P1': document.getElementById('player1-controls'),
    'P2': document.getElementById('player2-controls'),
};


// --- Conexão e Estado Local ---
const socket = io(); 
let myPlayerId = null; 
let allPlayers = {}; 
let serverProjectiles = {}; 
let serverObstacles = []; 
let serverPickups = {}; // Estado dos Pickups
let mapWidth = 800; 
let mapHeight = 600; 
let cameraX = 0; 
let cameraY = 0; 
let gameRunning = false;
let animationFrameId = null; 
const RESPAWN_DELAY = 5000; 


// --- Input Unificado ---
let keysToSend = { up: false, down: false, left: false, right: false, sprint: false };
let attackSent = false; 

// Mapeamento de Teclas (WASD/C/F para P1 E P2)
const INPUT_MAP = {
    P1: { up: ['w'], down: ['s'], left: ['a'], right: ['d'], sprint: ['f'], shoot: ['c'] },
    P2: { up: ['w'], down: ['s'], left: ['a'], right: ['d'], sprint: ['f'], shoot: ['c'] },
};

// --- Configurações de Gamepad ---
const GAMEPAD_SHOOT_BUTTON = 0; 
const GAMEPAD_SPRINT_BUTTON = 1; 
const GAMEPAD_MOVE_AXIS_X = 0;
const GAMEPAD_MOVE_AXIS_Y = 1;
const GAMEPAD_DEADZONE = 0.5;


// --- Funções Auxiliares ---
function showMessage(text) {
    const msg = document.createElement('div');
    msg.classList.add('message');
    msg.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
    messagesContainer.appendChild(msg);
    messagesContainer.scrollTop = messagesContainer.scrollHeight; 
}

function checkMobile() {
    return /Mobi|Android/i.test(navigator.userAgent);
}

// --- Gerenciamento do HUD de Controles ---

function showControlHUD(playerId) {
    Object.values(playerControlDisplays).forEach(el => {
        if (el) el.style.display = 'none';
    });
    
    const hudEl = playerControlDisplays[playerId];
    if (hudEl) {
        hudEl.style.display = 'block';
    }
    
    // Mostra o HUD principal do jogador
    playerGUI.classList.remove('player-gui-hidden');
}

function hideControlHUD(playerId) {
    const hudEl = playerControlDisplays[playerId];
    if (hudEl) {
        hudEl.style.display = 'none';
    }
    
    // Esconde o HUD principal se o player local desconectar
    if (playerId === myPlayerId) {
        playerGUI.classList.add('player-gui-hidden');
        respawnMessage.classList.add('hidden');
    }
}

// --- Lógica de Efeitos Visuais ---
socket.on('visualEffect', (data) => {
    visualEffectsOverlay.classList.remove('damage-flash', 'heal-flash');
    void visualEffectsOverlay.offsetWidth; // Reinicia a animação
    
    if (data.type === 'damageFlash') {
        visualEffectsOverlay.classList.add('damage-flash');
        setTimeout(() => visualEffectsOverlay.classList.remove('damage-flash'), 100);
    } else if (data.type === 'healFlash') {
        visualEffectsOverlay.classList.add('heal-flash');
        setTimeout(() => visualEffectsOverlay.classList.remove('heal-flash'), 100);
    }
});


// --- Lógica de Input (Teclado - PC) ---
if (!checkMobile()) {
    window.addEventListener('keydown', (e) => {
        const key = e.key.toLowerCase();
        const myPlayer = allPlayers[myPlayerId];
        if (myPlayer && myPlayer.isDead) return; // Bloqueia input se o jogador estiver morto
        
        const map = INPUT_MAP[myPlayerId];
        if (!map) return;
        
        if (map.up.includes(key)) keysToSend.up = true;
        if (map.down.includes(key)) keysToSend.down = true;
        if (map.left.includes(key)) keysToSend.left = true;
        if (map.right.includes(key)) keysToSend.right = true;
        if (map.sprint.includes(key)) keysToSend.sprint = true;
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
}


// --- Função de Envio de Input ---
function sendInputToServer() {
    if (!gameRunning || !myPlayerId) return;
    
    const myPlayer = allPlayers[myPlayerId];
    if (!myPlayer || myPlayer.isDead) { // Bloqueia input se estiver morto
        keysToSend = { up: false, down: false, left: false, right: false, sprint: false };
        attackSent = false;
        return;
    }

    socket.emit('playerInput', {
        keys: keysToSend, 
        shoot: attackSent, 
    });

    attackSent = false; 
}


// --- Funções de Câmera e Desenho ---
function updateCamera() {
    const myPlayer = allPlayers[myPlayerId];
    if (!myPlayer || myPlayer.isDead) return; 

    const playerCenterX = myPlayer.x + myPlayer.width / 2;
    const playerCenterY = myPlayer.y + myPlayer.height / 2;

    let targetX = playerCenterX - gameCanvas.clientWidth / 2;
    let targetY = playerCenterY - gameCanvas.clientHeight / 2;
    
    targetX = Math.max(0, Math.min(mapWidth - gameCanvas.clientWidth, targetX));
    targetY = Math.max(0, Math.min(mapHeight - gameCanvas.clientHeight, targetY));
    
    cameraX += (targetX - cameraX) * 0.2; 
    cameraY += (targetY - cameraY) * 0.2; 
}

// Atualiza o HUD de barras e texto
function updateLocalHUD(myPlayer) {
    const healthPercent = (myPlayer.health / 100) * 100;
    const energyPercent = (myPlayer.energy / 100) * 100;

    healthBar.style.width = `${healthPercent}%`;
    healthValue.textContent = myPlayer.health;
    
    // Efeito Visual: Low Health
    if (myPlayer.health <= 30) {
        healthBar.classList.add('low-health-bar');
    } else {
        healthBar.classList.remove('low-health-bar');
    }

    energyBar.style.width = `${energyPercent}%`;
    energyValue.textContent = Math.round(myPlayer.energy);
    
    weaponNameDisplay.textContent = myPlayer.equippedWeapon.name;
    ammoCountDisplay.textContent = myPlayer.arrows;
    
    // Atualiza a forma do arco em CSS
    // Remove todas as classes de arco para evitar múltiplos
    cssWeaponShapeContainer.className = 'css-weapon-shape-container'; 
    if (myPlayer.equippedWeapon.cssClass) {
        cssWeaponShapeContainer.classList.add(myPlayer.equippedWeapon.cssClass);
    }


    // Lógica do Respawn Message
    if (myPlayer.isDead) {
        respawnMessage.classList.remove('hidden');
        playerGUI.classList.add('player-gui-hidden');
        
        const timeElapsed = performance.now() - myPlayer.respawnStartTime;
        const timeLeft = Math.max(0, RESPAWN_DELAY - timeElapsed);
        respawnTimer.textContent = (timeLeft / 1000).toFixed(1);
    } else {
        respawnMessage.classList.add('hidden');
        playerGUI.classList.remove('player-gui-hidden');
    }
}

// Desenha Pickups
function drawPickups() {
    for (const id in serverPickups) {
        const pickup = serverPickups[id];
        
        // Desenha o quadrado do pickup
        ctx.fillStyle = pickup.color;
        ctx.fillRect(pickup.x, pickup.y, pickup.width, pickup.height);
        
        // Desenho do Símbolo de Cura (Cruz)
        ctx.fillStyle = 'white';
        const crossSize = pickup.width * 0.6;
        const offset = (pickup.width - crossSize) / 2;
        
        // Vertical
        ctx.fillRect(pickup.x + pickup.width / 2 - 2, pickup.y + offset, 4, crossSize);
        // Horizontal
        ctx.fillRect(pickup.x + offset, pickup.y + pickup.height / 2 - 2, crossSize, 4);
        
    }
}

function draw() {
    ctx.fillStyle = '#1a202c'; 
    ctx.fillRect(0, 0, mapWidth, mapHeight); 
    
    ctx.save();
    ctx.translate(-cameraX, -cameraY); 

    // 1. Desenha Obstáculos
    serverObstacles.forEach(obs => {
        ctx.fillStyle = obs.color || '#34495e'; 
        ctx.fillRect(obs.x, obs.y, obs.width, obs.height);
    });
    
    // Desenha Pickups
    drawPickups();

    // 2. Desenha Projéteis
    for (const id in serverProjectiles) {
        const proj = serverProjectiles[id];
        ctx.fillStyle = proj.color;
        ctx.beginPath();
        ctx.arc(proj.x, proj.y, 5, 0, Math.PI * 2); 
        ctx.fill();
    }

    // 3. Desenha Jogadores e UI
    for (const id in allPlayers) {
        const player = allPlayers[id];
        
        if (player.isDead) continue; // Não desenha o corpo se estiver morto

        // Corpo
        ctx.fillStyle = player.color;
        ctx.fillRect(player.x, player.y, player.width, player.height);
        
        // UI BÁSICA (Nome)
        ctx.fillStyle = 'white';
        ctx.font = '10px "Press Start 2P"';
        ctx.textAlign = 'center';
        ctx.fillText(player.name, player.x + player.width / 2, player.y - 20);
    }
    
    ctx.restore(); 
}


// --- Loop Principal (Cliente) ---
function gameLoop(currentTime) {
    if (!gameRunning) {
        return; 
    }

    sendInputToServer();
    updateCamera(); 
    draw(); 
    
    const myPlayer = allPlayers[myPlayerId];
    if (myPlayer) {
        updateLocalHUD(myPlayer); // Atualiza o HUD HTML
    }

    animationFrameId = requestAnimationFrame(gameLoop);
}


// --- Eventos de Socket.IO ---

socket.on('playerData', (data) => {
    myPlayerId = data.id;
    allPlayers = data.players;
    serverObstacles = data.obstacles;
    serverPickups = data.pickups;
    mapWidth = data.mapWidth;
    mapHeight = data.mapHeight;
    gameCanvas.width = mapWidth;
    gameCanvas.height = mapHeight;
    
    showControlHUD(myPlayerId); 

    if (!gameRunning) {
        gameRunning = true;
        showMessage(`Conectado como ${myPlayerId}.`);
        animationFrameId = requestAnimationFrame(gameLoop);
    }
});

socket.on('gameStateUpdate', (data) => {
    allPlayers = data.players;
    serverProjectiles = data.projectiles;
    serverPickups = data.pickups; // Recebe o estado dos pickups
});

socket.on('playerDisconnected', (playerId) => {
    delete allPlayers[playerId];
    showMessage(`${playerId} se desconectou.`);
    hideControlHUD(playerId); 
    
    if (playerId === myPlayerId) {
        myPlayerId = null; 
    }
});

socket.on('playerKilled', (data) => {
    showMessage(`${data.targetId} foi abatido por ${data.killerId}!`);
});

socket.on('gameReset', (message) => {
    showMessage(`[ALERTA DO SERVIDOR] ${message}`);
    
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
    }
    
    Object.keys(playerControlDisplays).forEach(hideControlHUD);

    myPlayerId = null; 
    allPlayers = {}; 
    serverProjectiles = {}; 
    serverPickups = {};
    gameRunning = false;
    
    setTimeout(() => {
        window.location.reload(); 
    }, 3000);
});