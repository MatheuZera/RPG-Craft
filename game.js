// game.js (CLIENTE 6 JOGADORES)

// --- Configurações Globais ---
// Os tamanhos do mapa serão recebidos do servidor.
const PLAYER_SIZE = 30;
const ARROW_SIZE = 10;
const MAX_GAMEPADS = 4; // Para P3, P4, P5, P6

// Obtenção dos elementos do DOM (Incluindo P5 e P6)
const gameCanvas = document.getElementById('gameCanvas');
const ctx = gameCanvas.getContext('2d');
const messagesContainer = document.getElementById('messages');
const gamepad1Info = document.getElementById('gamepad1Info');
const gamepad2Info = document.getElementById('gamepad2Info');
const gamepad3Info = document.getElementById('gamepad3Info');
const gamepad4Info = document.getElementById('gamepad4Info');
const player3ControlsDisplay = document.getElementById('player3-controls');
const player4ControlsDisplay = document.getElementById('player4-controls');
const player5ControlsDisplay = document.getElementById('player5-controls');
const player6ControlsDisplay = document.getElementById('player6-controls');

// --- Conexão de Rede ---
const socket = io(); 
let myPlayerId = null; 
let allPlayers = {}; 
let serverProjectiles = {}; 
let serverObstacles = []; 
let serverPickups = {}; 
let mapWidth = 800;
let mapHeight = 600;

let gameRunning = false;
let lastFrameTime = 0;
let cameraShakeIntensity = 0;
let cameraShakeTimer = 0;
let cameraX = 0;
let cameraY = 0;

// --- Sistema de Input ---
const input = {
    keys: {},
    lastGamepadAttackTime: [0, 0, 0, 0], // 4 slots para gamepads (P3 a P6)
    // ... (outras funções de input, como isKeyDown)
    getGamepadControls(gamepad, playerNum) {
        let keys = { up: false, down: false, left: false, right: false, sprint: false };
        let shoot = false;
        
        // Gamepad: sticks/botões 
        if (gamepad.axes[1] < -0.5) keys.up = true;
        if (gamepad.axes[1] > 0.5) keys.down = true;
        if (gamepad.axes[0] < -0.5) keys.left = true;
        if (gamepad.axes[0] > 0.5) keys.right = true;

        const gamepadIndex = playerNum - 3; // 0, 1, 2, 3
        
        if (gamepad.buttons[7]?.pressed || gamepad.buttons[5]?.pressed) { // R2/RT ou R1/RB
            if (Date.now() - input.lastGamepadAttackTime[gamepadIndex] > 100) { 
                 shoot = true;
                 input.lastGamepadAttackTime[gamepadIndex] = Date.now();
            }
        }
        
        if (gamepad.buttons[6]?.pressed || gamepad.buttons[4]?.pressed) { // L2/LT ou L1/LB para correr
            keys.sprint = true;
        }

        // Joystick direito para mira
        const aimX = gamepad.axes[2] || 0; 
        const aimY = gamepad.axes[3] || 0;
        
        let angle = 0;
        if (Math.abs(aimX) > 0.1 || Math.abs(aimY) > 0.1) {
            angle = Math.atan2(aimY, aimX);
        } else {
            // Se não houver mira, usa a direção do movimento
            if (keys.left) angle = Math.PI;
            else if (keys.right) angle = 0;
            else if (keys.up) angle = -Math.PI / 2;
            else if (keys.down) angle = Math.PI / 2;
        }

        return { keys, shoot, angle };
    }
};

let keysToSend = { up: false, down: false, left: false, right: false, sprint: false };
let attackSent = false; 
let shootAngle = 0; 
let mouseX = 0; 
let mouseY = 0;

// --- Funções de Rede (Recebimento de Dados do Servidor) ---

socket.on('playerData', (data) => {
    myPlayerId = data.id;
    allPlayers = data.players;
    serverObstacles = data.obstacles;
    mapWidth = data.mapWidth || 800;
    mapHeight = data.mapHeight || 600;
    
    // Configura o canvas para o tamanho do mapa do servidor
    gameCanvas.width = mapWidth;
    gameCanvas.height = mapHeight;

    gameRunning = true;
    showMessage('Conectado ao servidor! ID: ' + allPlayers[myPlayerId].name);
    requestAnimationFrame(gameLoop); 
});

socket.on('gameStateUpdate', (data) => {
    allPlayers = data.players;
    serverProjectiles = data.projectiles;
    serverPickups = data.pickups;
});

socket.on('playerDisconnected', (playerId) => {
    const disconnectedName = allPlayers[playerId]?.name || `Jogador Desconhecido`;
    delete allPlayers[playerId];
    showMessage(`${disconnectedName} saiu do jogo.`);
    document.querySelector(`.player-head-gui.p${playerId}`)?.remove();
});

socket.on('message', (text) => {
    showMessage(text);
});

socket.on('playerKilled', (data) => {
    // ... (lógica de mensagens de morte)
});

socket.on('gameOver', (winnerId) => {
    // ... (lógica de fim de jogo)
});


// --- Lógica de Captura de Input ---

gameCanvas.addEventListener('mousemove', (e) => {
    const rect = gameCanvas.getBoundingClientRect();
    const scaleX = gameCanvas.width / rect.width;
    const scaleY = gameCanvas.height / rect.height;

    // Converte a posição do mouse para coordenadas do jogo (com câmera)
    mouseX = (e.clientX - rect.left) * scaleX + cameraX; 
    mouseY = (e.clientY - rect.top) * scaleY + cameraY;
});

gameCanvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) { // Botão esquerdo do mouse
        attackSent = true;
    }
});


window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    input.keys[key] = true;
    
    // Mapeamento P1 (Teclado) - WASD
    if (key === 'w') keysToSend.up = true;
    if (key === 's') keysToSend.down = true;
    if (key === 'a') keysToSend.left = true;
    if (key === 'd') keysToSend.right = true;
    if (key === 'f') keysToSend.sprint = true;
    
    // Mapeamento P2 (Teclado) - Setas
    if (key === 'arrowup') keysToSend.up = true;
    if (key === 'arrowdown') keysToSend.down = true;
    if (key === 'arrowleft') keysToSend.left = true;
    if (key === 'arrowright') keysToSend.right = true;
    if (key === 'p') keysToSend.sprint = true;
    
    // Ataque (P1 = C, P2 = E)
    if (key === 'c' || key === 'e') attackSent = true; 
    
    if ([' ', 'w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'c', 'e', 'f', 'p'].includes(key)) {
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    input.keys[key] = false;
    
    if (key === 'w' || key === 'arrowup') keysToSend.up = false;
    if (key === 's' || key === 'arrowdown') keysToSend.down = false;
    if (key === 'a' || key === 'arrowleft') keysToSend.left = false;
    if (key === 'd' || key === 'arrowright') keysToSend.right = false;
    if (key === 'f' || key === 'p') keysToSend.sprint = false;
});


function sendInputToServer() {
    if (!gameRunning || !myPlayerId) return;

    const myPlayer = allPlayers[myPlayerId];
    if (!myPlayer || !myPlayer.isAlive) return;

    let gamepadInput = { keys: { ...keysToSend }, shoot: attackSent, angle: shootAngle };
    let playerNumber = parseInt(myPlayer.name.substring(1));

    // 1. Processar Gamepads (Se o jogador for P3, P4, P5 ou P6)
    if (playerNumber >= 3 && playerNumber <= 6) {
        const gamepadIndex = playerNumber - 3; // P3 = index 0, P6 = index 3
        const gamepad = navigator.getGamepads()[gamepadIndex];

        if (gamepad) {
            const controls = input.getGamepadControls(gamepad, playerNumber);
            gamepadInput.keys = controls.keys; 
            if(controls.shoot) gamepadInput.shoot = true;
            if(controls.angle !== 0) gamepadInput.angle = controls.angle;
            
            // Usar o ângulo do gamepad se estiver em uso
            shootAngle = gamepadInput.angle;
        }
    } else {
        // 2. Calcular o ângulo de mira (Teclado/Mouse)
        shootAngle = Math.atan2(mouseY - myPlayer.y, mouseX - myPlayer.x);
    }
    
    socket.emit('playerInput', {
        keys: gamepadInput.keys, 
        shoot: gamepadInput.shoot || attackSent, 
        shootAngle: shootAngle 
    });

    // Resetar o estado de tiro APÓS o envio
    attackSent = false; 
}


// --- Loop Principal do Jogo ---

function gameLoop(currentTime = 0) {
    if (!gameRunning) return;

    // ... (lógica de deltaTime, cameraShake)

    // 1. Enviar Input
    sendInputToServer();
    
    // 2. Lógica Local (Câmera)
    // ...
    updateCamera(); 
    
    // 3. Desenhar
    draw(); 

    // Atualiza o display GUI
    // ...
    updateInputStatus(); // Atualiza status dos 4 gamepads
    // ...

    requestAnimationFrame(gameLoop);
}


// --- Funções de Desenho e GUI (Essenciais) ---

/**
 * ADICIONADA PARA CORRIGIR O ERRO `showMessage is not defined`
 * Adiciona uma mensagem ao container de mensagens do jogo.
 */
function showMessage(text) {
    const messagesEl = document.getElementById('messages');
    if (!messagesEl) return; 

    const message = document.createElement('div');
    message.className = 'message';
    message.textContent = text;
    messagesEl.prepend(message); 

    while (messagesEl.children.length > 5) {
        messagesEl.removeChild(messagesEl.lastChild);
    }
}

function updateCamera() {
    const myPlayer = allPlayers[myPlayerId];
    if (!myPlayer) return;

    // Centraliza a câmera no jogador
    let targetX = myPlayer.x - gameCanvas.width / 2 + myPlayer.width / 2;
    let targetY = myPlayer.y - gameCanvas.height / 2 + myPlayer.height / 2;

    // Aplica tremor (se houver)
    // ...

    // Limites do Mapa
    targetX = Math.max(0, Math.min(mapWidth - gameCanvas.width, targetX));
    targetY = Math.max(0, Math.min(mapHeight - gameCanvas.height, targetY));


    const smoothing = 0.08;
    // O deltaTime está faltando, mas usaremos 16ms como base se não for calculado
    const factor = lastFrameTime > 0 ? (lastFrameTime / 16) : 1; 

    cameraX += (targetX - cameraX) * smoothing * factor; 
    cameraY += (targetY - cameraY) * smoothing * factor; 
    
    // Opcional: Atualizar o tamanho do canvas com base no tamanho da janela do navegador
    // gameCanvas.width = window.innerWidth;
    // gameCanvas.height = window.innerHeight;
}

function draw() {
    // Limpa o canvas e aplica a transformação da câmera.
    // ... (Desenho permanece igual)
}

function updateInputStatus() {
    const gamepads = navigator.getGamepads();
    const gamepadElements = [
        { el: gamepad1Info, controls: player3ControlsDisplay },
        { el: gamepad2Info, controls: player4ControlsDisplay },
        { el: gamepad3Info, controls: player5ControlsDisplay },
        { el: gamepad4Info, controls: player6ControlsDisplay }
    ];

    gamepadElements.forEach((item, index) => {
        const gamepad = gamepads[index];
        const playerNum = index + 3; // P3, P4, P5, P6

        if (gamepad) {
            item.el.innerHTML = `<span class="status-icon"></span>Slot Gamepad ${index + 1} (P${playerNum}): Conectado (${gamepad.id.substring(0, 15)}...)`;
            item.el.className = 'connected';
            item.controls.style.display = 'block';
        } else {
            item.el.innerHTML = `<span class="status-icon"></span>Slot Gamepad ${index + 1} (P${playerNum}): Desconectado`;
            item.el.className = 'disconnected';
            item.controls.style.display = 'none';
        }
    });
}