// game.js (CLIENTE - TECLADO, GAMEPAD, JOYSTICK VIRTUAL)
const gameCanvas = document.getElementById('gameCanvas');
const ctx = gameCanvas.getContext('2d');
const messagesContainer = document.getElementById('messages');
const joystickMove = document.getElementById('joystick-move');
const joystickAction = document.getElementById('joystick-action');
const btnA = document.getElementById('btn-a');
const btnB = document.getElementById('btn-b');

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
const PLAYER_SIZE = 30; // Usado para desenho, deve ser consistente

// --- Input Unificado ---
let keysToSend = { up: false, down: false, left: false, right: false, sprint: false };
let attackSent = false; 
let playerNumber = 0; 
let gamepadIndex = -1; // -1 para não-gamepad, 0 ou 1 para gamepad

// Mapeamento de Teclas e Botões conforme solicitado:
// Teclado P1: WASD, C (Atira), F (Corre)
// Teclado P2: Setas, L (Atira), P (Corre)
// Gamepad P3: Joystick Esquerdo, Botão 0/A (Atira), Botão 3/Y (Corre/Triângulo)
const INPUT_MAP = {
    P1: { up: ['w'], down: ['s'], left: ['a'], right: ['d'], sprint: ['f'], shoot: ['c'] },
    P2: { up: ['arrowup'], down: ['arrowdown'], left: ['arrowleft'], right: ['arrowright'], sprint: ['p'], shoot: ['l'] }
};

// --- Funções Gamepad ---
const GAMEPAD_SHOOT_BUTTON = 0; // Botão A no Xbox, X no PS
const GAMEPAD_SPRINT_BUTTON = 3; // Botão Y no Xbox, Triângulo no PS
const GAMEPAD_MOVE_AXIS_X = 0;
const GAMEPAD_MOVE_AXIS_Y = 1;
const GAMEPAD_DEADZONE = 0.5;

function scanGamepads() {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    
    // Procura por um gamepad para P3 (Slot 1)
    if (myPlayerId === 'P1' || myPlayerId === 'P2') {
        gamepadIndex = -1; // P1 e P2 são teclado/mobile, não gamepad
    } else if (myPlayerId === 'P3' && gamepads[0]) {
        handleGamepadInput(gamepads[0]);
    } 
    // Se você tiver P4, adicionaria:
    // else if (myPlayerId === 'P4' && gamepads[1]) { handleGamepadInput(gamepads[1]); }
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
    // Atirar (Botão A/X)
    if (gamepad.buttons[GAMEPAD_SHOOT_BUTTON] && gamepad.buttons[GAMEPAD_SHOOT_BUTTON].pressed) {
        attackSent = true;
    }
    // Correr (Botão Y/Triângulo)
    if (gamepad.buttons[GAMEPAD_SPRINT_BUTTON] && gamepad.buttons[GAMEPAD_SPRINT_BUTTON].pressed) {
        keysToSend.sprint = true;
    } else {
        keysToSend.sprint = false;
    }
}


// --- Funções Joystick Virtual (Mobile) ---

function checkMobile() {
    return /Mobi|Android/i.test(navigator.userAgent);
}

// Configura os joysticks virtuais se for um dispositivo móvel
if (checkMobile()) {
    joystickMove.style.display = 'block';
    joystickAction.style.display = 'flex';
    
    // Esconde os controles de teclado, que não serão usados no mobile
    document.getElementById('controls-container').style.display = 'none';

    // Lógica para o Joystick de Movimento
    const moveHandle = joystickMove.querySelector('.joystick-handle');
    let activeTouchIdMove = null;
    
    function startMove(e) {
        e.preventDefault();
        const touch = e.changedTouches[0];
        activeTouchIdMove = touch.identifier;
        joystickMove.classList.add('active');
        updateMove(touch);
    }
    
    function updateMove(touch) {
        const rect = joystickMove.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        
        let dx = touch.clientX - centerX;
        let dy = touch.clientY - centerY;
        const maxRadius = rect.width / 2;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // Limita o handle ao raio
        if (distance > maxRadius) {
            dx = (dx / distance) * maxRadius;
            dy = (dy / distance) * maxRadius;
        }

        // Move o handle
        moveHandle.style.transform = `translate(${dx}px, ${dy}px)`;

        // Calcula a direção de movimento
        const ratio = distance / maxRadius;
        keysToSend.up = dy < -maxRadius * 0.2; // Deadzone de 20%
        keysToSend.down = dy > maxRadius * 0.2;
        keysToSend.left = dx < -maxRadius * 0.2;
        keysToSend.right = dx > maxRadius * 0.2;
    }

    function endMove() {
        activeTouchIdMove = null;
        joystickMove.classList.remove('active');
        moveHandle.style.transform = `translate(0, 0)`;
        keysToSend.up = keysToSend.down = keysToSend.left = keysToSend.right = false;
    }

    joystickMove.addEventListener('touchstart', startMove);
    joystickMove.addEventListener('touchmove', (e) => {
        if (activeTouchIdMove !== null) {
            const touch = Array.from(e.changedTouches).find(t => t.identifier === activeTouchIdMove);
            if (touch) updateMove(touch);
        }
    });
    joystickMove.addEventListener('touchend', endMove);
    joystickMove.addEventListener('touchcancel', endMove);

    // Lógica para os Botões de Ação
    btnA.addEventListener('touchstart', (e) => { 
        e.preventDefault(); 
        attackSent = true; 
        btnA.classList.add('active');
    });
    btnA.addEventListener('touchend', () => { 
        btnA.classList.remove('active');
    });
    
    btnB.addEventListener('touchstart', (e) => { 
        e.preventDefault(); 
        keysToSend.sprint = true; 
        btnB.classList.add('active');
    });
    btnB.addEventListener('touchend', () => { 
        keysToSend.sprint = false; 
        btnB.classList.remove('active');
    });

} else {
    // Esconde joysticks virtuais no PC
    joystickMove.style.display = 'none';
    joystickAction.style.display = 'none';
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
        
        // Troca de Arma (1 a 7) - disponível para PC e Gamepad
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

    // Remove event listeners de mouse (mira por mouse removida)
    gameCanvas.removeEventListener('mousemove', () => {}); 
    gameCanvas.removeEventListener('mousedown', () => {});
}


// --- Função de Envio de Input ---
function sendInputToServer() {
    if (!gameRunning || !myPlayerId) return;

    // Gamepad check (P3/P4)
    if (myPlayerId === 'P3') {
        scanGamepads();
    }
    // Adicionar P4 se necessário
    
    const myPlayer = allPlayers[myPlayerId];
    if (!myPlayer || !myPlayer.isAlive) return;

    // Envio final para o servidor
    socket.emit('playerInput', {
        keys: keysToSend, 
        shoot: attackSent, 
        // shootAngle é omitido ou zero, o SERVER calcula a mira automática
        shootAngle: 0 
    });

    // Resetar o estado de tiro
    attackSent = false; 
}


// --- Loop Principal (Cliente) ---
function gameLoop(currentTime = 0) {
    if (!gameRunning) return;

    // 1. Envio de Input (incluindo Gamepad/Joystick)
    sendInputToServer();
    
    // 2. Lógica Local (Câmera)
    updateCamera(); 
    
    // 3. Desenho
    draw(); 

    requestAnimationFrame(gameLoop);
}

// --- Funções de Câmera e Desenho (Mantidas do setup anterior) ---

function updateCamera() {
    const myPlayer = allPlayers[myPlayerId];
    if (!myPlayer) return;

    const playerCenterX = myPlayer.x + myPlayer.width / 2;
    const playerCenterY = myPlayer.y + myPlayer.height / 2;

    // Usa o tamanho real do viewport para centralizar (para telas pequenas)
    let targetX = playerCenterX - gameCanvas.clientWidth / 2;
    let targetY = playerCenterY - gameCanvas.clientHeight / 2;
    
    // Limites do mapa (usa o tamanho do mundo)
    targetX = Math.max(0, Math.min(mapWidth - gameCanvas.clientWidth, targetX));
    targetY = Math.max(0, Math.min(mapHeight - gameCanvas.clientHeight, targetY));
    
    // Suavização
    cameraX += (targetX - cameraX) * 0.2; // Aumentei a suavização para 0.2 (mais rápido)
    cameraY += (targetY - cameraY) * 0.2; 
}

function draw() {
    ctx.fillStyle = '#1a202c'; 
    ctx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);
    
    ctx.save();
    ctx.translate(-cameraX, -cameraY); 

    // Desenha Obstáculos, Projéteis e Jogadores (Lógica simplificada)
    // ... (Desenho idêntico ao que você já tem)
    
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
        ctx.arc(proj.x, proj.y, 10 / 2, 0, Math.PI * 2); // 10 é o ARROW_SIZE
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

// Inicia o loop após a conexão bem-sucedida
// requestAnimationFrame(gameLoop) é chamado em socket.on('playerData')