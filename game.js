// game.js
const gameCanvas = document.getElementById('gameCanvas');
const ctx = gameCanvas.getContext('2d');
const messagesContainer = document.getElementById('messages');
const joystickMove = document.getElementById('joystick-move');
const joystickAction = document.getElementById('joystick-action');
const btnA = document.getElementById('btn-a'); // Atirar
const btnB = document.getElementById('btn-b'); // Correr

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
const PLAYER_SIZE = 30; 
let animationFrameId = null; // ID para o requestAnimationFrame

// --- Input Unificado ---
let keysToSend = { up: false, down: false, left: false, right: false, sprint: false };
let attackSent = false; 

// Mapeamento de Teclas e Botões:
const INPUT_MAP = {
    P1: { up: ['w'], down: ['s'], left: ['a'], right: ['d'], sprint: ['f'], shoot: ['c'] },
    P2: { up: ['arrowup'], down: ['arrowdown'], left: ['arrowleft'], right: ['arrowright'], sprint: ['p'], shoot: ['l'] }
    // P3+ podem usar Gamepads (lógica em scanGamepads)
};

// --- Funções Auxiliares ---
function showMessage(text) {
    const msg = document.createElement('div');
    msg.classList.add('message');
    msg.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
    messagesContainer.appendChild(msg);
    messagesContainer.scrollTop = messagesContainer.scrollHeight; // Auto-scroll
}

function checkMobile() {
    return /Mobi|Android/i.test(navigator.userAgent);
}


// --- Lógica de Gamepad (P3+) ---
const GAMEPAD_SHOOT_BUTTON = 0; // Botão A no Xbox, X no PS
const GAMEPAD_SPRINT_BUTTON = 3; // Botão Y no Xbox, Triângulo no PS
const GAMEPAD_MOVE_AXIS_X = 0;
const GAMEPAD_MOVE_AXIS_Y = 1;
const GAMEPAD_DEADZONE = 0.5;

function scanGamepads() {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    
    // Procura o gamepad para P1 (Slot 0), P2 (Slot 1), etc.
    // Simplificando: P1/P2 são Teclado/Mobile. P3 usa Gamepad 1 (Slot 0).
    // Se o seu jogo usa P3, P4... você precisa de uma lógica de alocação de gamepad
    
    // Assumindo que P1 e P2 usam teclado, o primeiro Gamepad conectado é P3 (Gamepad 1/Slot 0)
    // Se P3 for o meu ID, uso o Gamepad 1 (índice 0)
    if (myPlayerId === 'P3' && gamepads[0]) {
        handleGamepadInput(gamepads[0]);
    } else if (myPlayerId === 'P4' && gamepads[1]) { // Se houver P4
        handleGamepadInput(gamepads[1]);
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


// --- Lógica de Joystick Virtual (Mobile) ---
if (checkMobile()) {
    joystickMove.style.display = 'block';
    joystickAction.style.display = 'flex';
    document.getElementById('controls-container').style.display = 'none';

    // Lógica para o Joystick de Movimento
    const moveHandle = joystickMove.querySelector('.joystick-handle');
    let activeTouchIdMove = null;
    
    function updateMove(touch, rect, maxRadius) {
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        
        let dx = touch.clientX - centerX;
        let dy = touch.clientY - centerY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance > maxRadius) {
            dx = (dx / distance) * maxRadius;
            dy = (dy / distance) * maxRadius;
        }

        moveHandle.style.transform = `translate(${dx}px, ${dy}px)`;

        const deadzone = maxRadius * 0.2;
        keysToSend.up = dy < -deadzone; 
        keysToSend.down = dy > deadzone;
        keysToSend.left = dx < -deadzone;
        keysToSend.right = dx > deadzone;
    }
    
    joystickMove.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const touch = e.changedTouches[0];
        activeTouchIdMove = touch.identifier;
        joystickMove.classList.add('active');
        const rect = joystickMove.getBoundingClientRect();
        const maxRadius = rect.width / 2;
        updateMove(touch, rect, maxRadius);
    });

    joystickMove.addEventListener('touchmove', (e) => {
        if (activeTouchIdMove !== null) {
            const touch = Array.from(e.changedTouches).find(t => t.identifier === activeTouchIdMove);
            if (touch) {
                const rect = joystickMove.getBoundingClientRect();
                const maxRadius = rect.width / 2;
                updateMove(touch, rect, maxRadius);
            }
        }
    });
    
    const endMove = () => {
        activeTouchIdMove = null;
        joystickMove.classList.remove('active');
        moveHandle.style.transform = `translate(0, 0)`;
        keysToSend.up = keysToSend.down = keysToSend.left = keysToSend.right = false;
    };

    joystickMove.addEventListener('touchend', endMove);
    joystickMove.addEventListener('touchcancel', endMove);

    // Lógica para os Botões de Ação
    btnA.addEventListener('touchstart', (e) => { e.preventDefault(); attackSent = true; btnA.classList.add('active'); });
    btnA.addEventListener('touchend', () => { btnA.classList.remove('active'); });
    
    btnB.addEventListener('touchstart', (e) => { e.preventDefault(); keysToSend.sprint = true; btnB.classList.add('active'); });
    btnB.addEventListener('touchend', () => { keysToSend.sprint = false; btnB.classList.remove('active'); });

} else {
    // Esconde joysticks virtuais no PC
    if(joystickMove) joystickMove.style.display = 'none';
    if(joystickAction) joystickAction.style.display = 'none';
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

    // Se estiver no PC e for Gamepad player (P3, P4, etc.)
    if (!checkMobile() && (myPlayerId === 'P3' || myPlayerId === 'P4')) {
        scanGamepads();
    }
    
    const myPlayer = allPlayers[myPlayerId];
    if (!myPlayer || !myPlayer.isAlive) return;

    // Envio final para o servidor
    socket.emit('playerInput', {
        keys: keysToSend, 
        shoot: attackSent, 
    });

    // Resetar o estado de tiro
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
    
    // Limites do mapa (usa o tamanho do mundo)
    targetX = Math.max(0, Math.min(mapWidth - gameCanvas.clientWidth, targetX));
    targetY = Math.max(0, Math.min(mapHeight - gameCanvas.clientHeight, targetY));
    
    // Suavização
    cameraX += (targetX - cameraX) * 0.2; 
    cameraY += (targetY - cameraY) * 0.2; 
}

function draw() {
    ctx.fillStyle = '#1a202c'; 
    ctx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);
    
    ctx.save();
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
        ctx.arc(proj.x, proj.y, 10 / 2, 0, Math.PI * 2); 
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
    }
    
    ctx.restore(); 
}


// --- Loop Principal (Cliente) ---
function gameLoop(currentTime) {
    if (!gameRunning) {
        // Se o jogo parou, não peça a próxima animação
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

socket.on('message', (text) => {
    showMessage(text);
});

socket.on('playerDisconnected', (playerId) => {
    delete allPlayers[playerId];
    showMessage(`${playerId} se desconectou.`);
});

socket.on('playerKilled', (data) => {
    showMessage(`${data.targetId} foi abatido por ${data.killerId}!`);
});

// CRÍTICO: Lidar com o reset do servidor
socket.on('gameReset', (message) => {
    showMessage(`[ALERTA DO SERVIDOR] ${message}`);
    
    // Limpar o estado local
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
    }
    myPlayerId = null; 
    allPlayers = {}; 
    serverProjectiles = {}; 
    gameRunning = false;
    
    // Força a atualização da tela para um estado limpo
    ctx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);
    showMessage("Cliente resetado. Recarregando em 5 segundos...");
    
    // Recarregar a página para garantir um estado limpo para a próxima conexão
    setTimeout(() => {
        window.location.reload(); 
    }, 5000);
});