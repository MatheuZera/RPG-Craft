// game.js
const gameCanvas = document.getElementById('gameCanvas');
const ctx = gameCanvas.getContext('2d');
const messagesContainer = document.getElementById('messages');
const gamepad1Info = document.getElementById('gamepad1Info');
const gamepad2Info = document.getElementById('gamepad2Info');

// Referências aos displays de controle
const playerControlDisplays = {
    'P1': document.getElementById('player1-controls'),
    'P2': document.getElementById('player2-controls'),
    // P3 e P4 são gamepads, mas o HTML tem containers para eles
    'P3': document.getElementById('player3-controls'), 
    'P4': document.getElementById('player4-controls'),
};


// --- Conexão e Estado Local ---
const socket = io(); 
let myPlayerId = null; 
let allPlayers = {}; 
let serverProjectiles = {}; 
let serverObstacles = []; 
let mapWidth = 800; 
let mapHeight = 600; 
let cameraX = 0; 
let cameraY = 0; 
let gameRunning = false;
let animationFrameId = null; 

// --- Input Unificado ---
let keysToSend = { up: false, down: false, left: false, right: false, sprint: false };
let attackSent = false; 

// Mapeamento de Teclas (WASD/C/F para P1 E P2 - CUIDADO: Causa conflito no mesmo teclado)
const INPUT_MAP = {
    P1: { up: ['w'], down: ['s'], left: ['a'], right: ['d'], sprint: ['f'], shoot: ['c'] },
    P2: { up: ['w'], down: ['s'], left: ['a'], right: ['d'], sprint: ['f'], shoot: ['c'] },
    // Gamepads usam a lógica em scanGamepads, então não precisam de um mapeamento aqui
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

// --- Gerenciamento do HUD de Controles (NOVA LÓGICA) ---

/**
 * Exibe o HUD de controle do player conectado e esconde os outros.
 * @param {string} playerId ID do jogador (ex: 'P1')
 */
function showControlHUD(playerId) {
    // Esconde todos os HUDs de teclado que não são do player local
    Object.values(playerControlDisplays).forEach(el => {
        if (el) el.style.display = 'none';
    });
    
    // Mostra o HUD do jogador local
    const hudEl = playerControlDisplays[playerId];
    if (hudEl) {
        hudEl.style.display = 'block';
    }
}

/**
 * Esconde o HUD de controle de um player que desconectou (deletado visualmente).
 * @param {string} playerId ID do jogador (ex: 'P1')
 */
function hideControlHUD(playerId) {
    const hudEl = playerControlDisplays[playerId];
    if (hudEl) {
        hudEl.style.display = 'none';
    }
}

// --- Lógica de Gamepad (P3+) ---
function updateGamepadStatus(gamepads) {
    const statusMap = { 0: gamepad1Info, 1: gamepad2Info };

    for (let i = 0; i < 2; i++) {
        const infoEl = statusMap[i];
        if (!infoEl) continue;

        if (gamepads[i]) {
            infoEl.classList.remove('disconnected');
            infoEl.classList.add('connected');
            infoEl.innerHTML = `<span class="status-icon"></span>Slot Gamepad ${i + 1} (P${i + 3}): Conectado`;
        } else {
            infoEl.classList.remove('connected');
            infoEl.classList.add('disconnected');
            infoEl.textContent = `Slot Gamepad ${i + 1} (P${i + 3}): Desconectado`;
        }
    }
}

function scanGamepads() {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    updateGamepadStatus(gamepads);

    let gamepadIndex = -1;
    if (myPlayerId === 'P3' && gamepads[0]) {
        gamepadIndex = 0;
    } else if (myPlayerId === 'P4' && gamepads[1]) {
        gamepadIndex = 1;
    }

    if (gamepadIndex !== -1) {
        handleGamepadInput(gamepads[gamepadIndex]);
    }
}

function handleGamepadInput(gamepad) {
    // MOVIMENTO (Joystick Esquerdo)
    const moveX = gamepad.axes[GAMEPAD_MOVE_AXIS_X];
    const moveY = gamepad.axes[GAMEPAD_MOVE_AXIS_Y];
    
    keysToSend.up = moveY < -GAMEPAD_DEADZONE;
    keysToSend.down = moveY > GAMEPAD_DEADZONE;
    keysToSend.left = moveX < -GAMEPAD_DEADZONE;
    keysToSend.right = moveX > GAMEPAD_DEADZONE;
    
    // AÇÕES
    if (gamepad.buttons[GAMEPAD_SHOOT_BUTTON] && gamepad.buttons[GAMEPAD_SHOOT_BUTTON].pressed) {
        attackSent = true;
    }
    keysToSend.sprint = (gamepad.buttons[GAMEPAD_SPRINT_BUTTON] && gamepad.buttons[GAMEPAD_SPRINT_BUTTON].pressed);
}


// --- Lógica de Input (Teclado - PC) ---
if (!checkMobile()) {
    window.addEventListener('keydown', (e) => {
        const key = e.key.toLowerCase();
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

    // Se não for mobile, verifica Gamepads
    if (!checkMobile()) {
        scanGamepads();
    }
    
    const myPlayer = allPlayers[myPlayerId];
    if (!myPlayer || !myPlayer.isAlive) return;

    socket.emit('playerInput', {
        keys: keysToSend, 
        shoot: attackSent, 
    });

    attackSent = false; 
}


// --- Funções de Câmera e Desenho ---
function updateCamera() {
    const myPlayer = allPlayers[myPlayerId];
    if (!myPlayer) return;

    const playerCenterX = myPlayer.x + myPlayer.width / 2;
    const playerCenterY = myPlayer.y + myPlayer.height / 2;

    let targetX = playerCenterX - gameCanvas.clientWidth / 2;
    let targetY = playerCenterY - gameCanvas.clientHeight / 2;
    
    // Limites do mapa 
    targetX = Math.max(0, Math.min(mapWidth - gameCanvas.clientWidth, targetX));
    targetY = Math.max(0, Math.min(mapHeight - gameCanvas.clientHeight, targetY));
    
    // Suavização
    cameraX += (targetX - cameraX) * 0.2; 
    cameraY += (targetY - cameraY) * 0.2; 
}

function draw() {
    ctx.fillStyle = '#1a202c'; 
    ctx.fillRect(0, 0, mapWidth, mapHeight); 
    
    ctx.save();
    // Aplica a câmera
    ctx.translate(-cameraX, -cameraY); 

    // 1. Desenha Obstáculos
    serverObstacles.forEach(obs => {
        ctx.fillStyle = obs.color || '#34495e'; 
        ctx.fillRect(obs.x, obs.y, obs.width, obs.height);
    });

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
        if (!player.isAlive) continue;

        // Corpo
        ctx.fillStyle = player.color;
        ctx.fillRect(player.x, player.y, player.width, player.height);
        
        // UI
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
        
        // Nome da Arma
        ctx.fillStyle = '#f39c12';
        ctx.font = '8px "Press Start 2P"';
        ctx.fillText(player.equippedWeapon.name, player.x + player.width / 2, player.y + player.height + 15);
    }
    
    ctx.restore(); 
    
    // UI Local (sem câmera)
    drawLocalUI(); 
}

function drawLocalUI() {
    const myPlayer = allPlayers[myPlayerId];
    if (!myPlayer) return;
    
    // Exibe munição
    ctx.fillStyle = myPlayer.color;
    ctx.font = '12px "Press Start 2P"';
    ctx.textAlign = 'left';
    ctx.fillText(`Munição: ${myPlayer.arrows}`, 10, 30);
}


// --- Loop Principal (Cliente) ---
function gameLoop(currentTime) {
    if (!gameRunning) {
        return; 
    }

    sendInputToServer();
    updateCamera(); 
    draw(); 

    animationFrameId = requestAnimationFrame(gameLoop);
}


// --- Eventos de Socket.IO ---

socket.on('playerData', (data) => {
    myPlayerId = data.id;
    allPlayers = data.players;
    serverObstacles = data.obstacles;
    mapWidth = data.mapWidth;
    mapHeight = data.mapHeight;
    gameCanvas.width = mapWidth;
    gameCanvas.height = mapHeight;
    
    // Exibe o HUD de controle do jogador conectado
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
});

socket.on('playerDisconnected', (playerId) => {
    delete allPlayers[playerId];
    showMessage(`${playerId} se desconectou.`);
    
    // Esconde/deleta o HUD do player que desconectou
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
    
    // Esconde todos os HUDs de controle ao resetar
    Object.keys(playerControlDisplays).forEach(hideControlHUD);

    // Limpar o estado local
    myPlayerId = null; 
    allPlayers = {}; 
    serverProjectiles = {}; 
    gameRunning = false;
    
    setTimeout(() => {
        window.location.reload(); 
    }, 3000);
});