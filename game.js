// game.js (CLIENTE - 6 JOGADORES, TECLADO, GAMEPAD, TOUCH)
const gameCanvas = document.getElementById('gameCanvas');
const ctx = gameCanvas.getContext('2d');
const messagesContainer = document.getElementById('messages');
const MAX_GAMEPADS = 4; // Para P3, P4, P5, P6

// Elementos de Status e Joysticks
const gamepadElements = [document.getElementById('gamepad1Info'), document.getElementById('gamepad2Info'), document.getElementById('gamepad3Info'), document.getElementById('gamepad4Info')];
const moveJoystickArea = document.getElementById('move-joystick-area');
const aimJoystickArea = document.getElementById('aim-joystick-area');
const moveJoystick = document.getElementById('move-joystick');
const aimJoystick = document.getElementById('aim-joystick');


// --- Conexão e Estado Local ---
const socket = io(); 
let myPlayerId = null; 
let allPlayers = {}; 
let serverProjectiles = {}; 
let serverObstacles = []; 
let mapWidth = 1200; 
let mapHeight = 900; 
let cameraX = 0; 
let cameraY = 0; 
let gameRunning = false;
let lastFrameTime = 0;
const ARROW_SIZE = 10;
const PLAYER_SIZE = 30;

// --- Input (Teclado, Mouse, Touch) ---
let keysToSend = { up: false, down: false, left: false, right: false, sprint: false };
let attackSent = false; 
let shootAngle = 0; 
let mouseX = 0; 
let mouseY = 0;
const lastGamepadAttackTime = [0, 0, 0, 0];

// Estado do Joystick Virtual
const touchInput = {
    move: { active: false, startX: 0, startY: 0, deltaX: 0, deltaY: 0, knobX: 0, knobY: 0, radius: 50 },
    aim: { active: false, startX: 0, startY: 0, deltaX: 0, deltaY: 0, knobX: 0, knobY: 0, radius: 50 }
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
    showMessage('Conectado: ' + allPlayers[myPlayerId].name);
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


// --- 1. Lógica de Input (Teclado) ---
window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    
    // P1 Teclado (WASD, SHIFT, C)
    if (key === 'w') keysToSend.up = true;
    if (key === 's') keysToSend.down = true;
    if (key === 'a') keysToSend.left = true;
    if (key === 'd') keysToSend.right = true;
    if (key === 'shift') keysToSend.sprint = true;
    if (key === 'c') attackSent = true; 

    // P2 Teclado (Setas, P, E) - Assumindo que P2 não usa mouse
    if (key === 'arrowup') keysToSend.up = true;
    if (key === 'arrowdown') keysToSend.down = true;
    if (key === 'arrowleft') keysToSend.left = true;
    if (key === 'arrowright') keysToSend.right = true;
    if (key === 'p') keysToSend.sprint = true;
    if (key === 'e') attackSent = true; 
    
    // Troca de Arma (1 a 7)
    if (key >= '1' && key <= '7') {
         socket.emit('playerInput', { switchWeapon: parseInt(key) });
    }

    if ([' ', 'w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'c', 'e', 'shift', 'p'].includes(key)) {
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    
    if (key === 'w' || key === 'arrowup') keysToSend.up = false;
    if (key === 's' || key === 'arrowdown') keysToSend.down = false;
    if (key === 'a' || key === 'arrowleft') keysToSend.left = false;
    if (key === 'd' || key === 'arrowright') keysToSend.right = false;
    if (key === 'shift' || key === 'p') keysToSend.sprint = false;
});

// --- 2. Lógica de Input (Mouse) ---
gameCanvas.addEventListener('mousemove', (e) => {
    const rect = gameCanvas.getBoundingClientRect();
    mouseX = (e.clientX - rect.left) + cameraX; 
    mouseY = (e.clientY - rect.top) + cameraY;
});

gameCanvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) { attackSent = true; } // Botão esquerdo
});


// --- 3. Lógica de Input (Touch / Joysticks Virtuais) ---

function handleTouchStart(e, type) {
    if (e.target.closest(`#${type}-joystick-area`)) {
        e.preventDefault();
        const touch = e.touches[0];
        const area = touchInput[type];
        const rect = e.currentTarget.getBoundingClientRect();

        area.active = true;
        area.startX = rect.width / 2;
        area.startY = rect.height / 2;
        
        // Posiciona o knob no centro da área inicialmente
        const knob = type === 'move' ? moveJoystick : aimJoystick;
        knob.style.transform = `translate(-50%, -50%) translate(0px, 0px)`;
    }
}

function handleTouchMove(e, type) {
    const touch = e.touches[0];
    const area = touchInput[type];
    if (!area.active) return;
    
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    
    let currentX = touch.clientX - rect.left - rect.width / 2;
    let currentY = touch.clientY - rect.top - rect.height / 2;
    
    // Limita o movimento dentro do raio
    const distance = Math.sqrt(currentX * currentX + currentY * currentY);
    if (distance > area.radius) {
        currentX *= area.radius / distance;
        currentY *= area.radius / distance;
    }
    
    area.deltaX = currentX;
    area.deltaY = currentY;
    area.knobX = currentX;
    area.knobY = currentY;

    // Move o Knob visualmente
    const knob = type === 'move' ? moveJoystick : aimJoystick;
    knob.style.transform = `translate(-50%, -50%) translate(${currentX}px, ${currentY}px)`;
}

function handleTouchEnd(e, type) {
    const area = touchInput[type];
    if (!area.active) return;
    
    area.active = false;
    area.deltaX = 0;
    area.deltaY = 0;
    
    // Retorna o Knob ao centro
    const knob = type === 'move' ? moveJoystick : aimJoystick;
    knob.style.transform = `translate(-50%, -50%) translate(0px, 0px)`;
}

// Configura Listeners de Toque
moveJoystickArea.addEventListener('touchstart', (e) => handleTouchStart(e, 'move'), { passive: false });
moveJoystickArea.addEventListener('touchmove', (e) => handleTouchMove(e, 'move'), { passive: false });
moveJoystickArea.addEventListener('touchend', (e) => handleTouchEnd(e, 'move'));

aimJoystickArea.addEventListener('touchstart', (e) => handleTouchStart(e, 'aim'), { passive: false });
aimJoystickArea.addEventListener('touchmove', (e) => handleTouchMove(e, 'aim'), { passive: false });
aimJoystickArea.addEventListener('touchend', (e) => handleTouchEnd(e, 'aim'));


// --- 4. Função de Envio de Input ---

function sendInputToServer() {
    if (!gameRunning || !myPlayerId) return;

    const myPlayer = allPlayers[myPlayerId];
    if (!myPlayer || !myPlayer.isAlive) return;

    let currentKeys = { ...keysToSend };
    let currentShoot = attackSent;
    let currentAngle = 0;
    let playerNumber = parseInt(myPlayer.name.substring(1));

    // --- Prioridade 1: Gamepads (P3 a P6) ---
    if (playerNumber >= 3 && playerNumber <= 6) {
        const gamepadIndex = playerNumber - 3;
        const gamepad = navigator.getGamepads()[gamepadIndex];

        if (gamepad) {
            // Mover (Joystick Esquerdo ou D-Pad)
            if (gamepad.axes[1] < -0.5 || gamepad.buttons[12]?.pressed) currentKeys.up = true;
            if (gamepad.axes[1] > 0.5 || gamepad.buttons[13]?.pressed) currentKeys.down = true;
            if (gamepad.axes[0] < -0.5 || gamepad.buttons[14]?.pressed) currentKeys.left = true;
            if (gamepad.axes[0] > 0.5 || gamepad.buttons[15]?.pressed) currentKeys.right = true;

            // Sprint (Triângulo/Y - Botão 3)
            if (gamepad.buttons[3]?.pressed) currentKeys.sprint = true; 
            else currentKeys.sprint = false;

            // Atirar (X/A - Botão 0)
            if (gamepad.buttons[0]?.pressed) {
                if (Date.now() - lastGamepadAttackTime[gamepadIndex] > myPlayer.equippedWeapon.attackSpeed) {
                    currentShoot = true;
                    lastGamepadAttackTime[gamepadIndex] = Date.now();
                }
            }

            // Mira (Joystick Direito)
            const aimX = gamepad.axes[2] || 0; 
            const aimY = gamepad.axes[3] || 0;
            if (Math.abs(aimX) > 0.1 || Math.abs(aimY) > 0.1) {
                currentAngle = Math.atan2(aimY, aimX);
            } else {
                // Se não houver mira, usa a direção do movimento
                currentAngle = Math.atan2(currentKeys.down - currentKeys.up, currentKeys.right - currentKeys.left) || 0;
            }
        }
    } 
    
    // --- Prioridade 2: Touch (Dispositivos Móveis - Sobrescreve Teclado/Mouse se ativo) ---
    else if (myPlayerId === Object.keys(allPlayers)[0]) { // Apenas o P1 usa Touch/Mouse
        const move = touchInput.move;
        const aim = touchInput.aim;
        
        if (move.active) {
            currentKeys.up = move.deltaY < -10;
            currentKeys.down = move.deltaY > 10;
            currentKeys.left = move.deltaX < -10;
            currentKeys.right = move.deltaX > 10;
            currentKeys.sprint = Math.sqrt(move.deltaX * move.deltaX + move.deltaY * move.deltaY) > 40;
        }

        if (aim.active) {
            // Se o joystick de mira estiver ativo, atira continuamente ou com um limite de taxa
            const aimDistance = Math.sqrt(aim.deltaX * aim.deltaX + aim.deltaY * aim.deltaY);
            if (aimDistance > 10) { // Se mover o stick de mira um pouco
                 currentAngle = Math.atan2(aim.deltaY, aim.deltaX);
                 currentShoot = true; 
            }
        } else if (!move.active) {
            // Se não for Touch, volta a usar o Mouse para mira (para P1/P2)
            currentAngle = Math.atan2(mouseY - myPlayer.y, mouseX - myPlayer.x);
        }
    }
    
    // Envio final para o servidor
    socket.emit('playerInput', {
        keys: currentKeys, 
        shoot: currentShoot, 
        shootAngle: currentAngle 
    });

    // Resetar o estado de tiro (Mouse/Teclado)
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

    // 4. Atualiza a GUI
    updateInputStatus(); 

    requestAnimationFrame(gameLoop);
}
requestAnimationFrame(gameLoop); // Inicia o loop

// --- Funções de GUI e Desenho (Simplificadas) ---

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

    let targetX = myPlayer.x - gameCanvas.width / 2 + myPlayer.width / 2;
    let targetY = myPlayer.y - gameCanvas.height / 2 + myPlayer.height / 2;

    // Limites e Suavização
    targetX = Math.max(0, Math.min(mapWidth - gameCanvas.width, targetX));
    targetY = Math.max(0, Math.min(mapHeight - gameCanvas.height, targetY));
    cameraX += (targetX - cameraX) * 0.1; 
    cameraY += (targetY - cameraY) * 0.1; 
}

function updateInputStatus() {
    const gamepads = navigator.getGamepads();
    gamepadElements.forEach((el, index) => {
        const gamepad = gamepads[index];
        const playerNum = index + 3; // P3, P4, P5, P6
        if (gamepad) {
            el.innerHTML = `<span class="status-icon"></span>Slot Gamepad ${index + 1} (P${playerNum}): Conectado (${gamepad.id.substring(0, 15)}...)`;
            el.className = 'connected';
        } else {
            el.innerHTML = `<span class="status-icon"></span>Slot Gamepad ${index + 1} (P${playerNum}): Desconectado`;
            el.className = 'disconnected';
        }
    });
}

function draw() {
    ctx.fillStyle = '#1a202c';
    ctx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);
    
    ctx.save();
    ctx.translate(-cameraX, -cameraY); // Aplica a câmera

    // 1. Desenha Obstáculos
    serverObstacles.forEach(obs => {
        ctx.fillStyle = obs.color;
        ctx.fillRect(obs.x, obs.y, obs.width, obs.height);
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
        
        // Nome e HP
        ctx.fillStyle = 'white';
        ctx.font = '10px "Press Start 2P"';
        ctx.textAlign = 'center';
        ctx.fillText(player.name, player.x + player.width / 2, player.y - 15);
        
        // Barra de HP
        const hpWidth = player.width * (player.health / 100);
        ctx.fillStyle = 'red';
        ctx.fillRect(player.x, player.y - 10, player.width, 5);
        ctx.fillStyle = 'lime';
        ctx.fillRect(player.x, player.y - 10, hpWidth, 5);

        // Status Effects (Ex: Lento)
        if (player.status.slow.active) {
            ctx.fillStyle = 'rgba(52, 152, 219, 0.5)'; // Azul transparente
            ctx.fillRect(player.x, player.y, player.width, player.height);
        }
        if (player.status.poison.active) {
            ctx.fillStyle = 'rgba(46, 204, 113, 0.5)'; // Verde transparente
            ctx.fillRect(player.x, player.y, player.width, player.height);
        }
        if (player.status.burn.active) {
            ctx.fillStyle = 'rgba(231, 76, 60, 0.5)'; // Vermelho transparente
            ctx.fillRect(player.x, player.y, player.width, player.height);
        }
    }

    // 4. Desenha UI (Nome da Arma)
    const myPlayer = allPlayers[myPlayerId];
    if (myPlayer) {
        ctx.restore(); // Volta para a tela de GUI (sem câmera)
        
        ctx.fillStyle = 'white';
        ctx.font = '12px "Press Start 2P"';
        ctx.textAlign = 'left';
        ctx.fillText(`ARMA: ${myPlayer.equippedWeapon.name}`, 10, 30);
        ctx.fillText(`FLECHAS: ${myPlayer.arrows}`, 10, 50);
        
        // Desenha a mira para P1/P2
        if (playerNumber === 1 || playerNumber === 2) {
             ctx.strokeStyle = 'red';
             ctx.beginPath();
             ctx.arc(mouseX - cameraX, mouseY - cameraY, 5, 0, Math.PI * 2);
             ctx.stroke();
        }
    }
}