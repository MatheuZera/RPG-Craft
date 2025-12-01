// game.js (CLIENTE - 6 JOGADORES, TECLADO, GAMEPAD, TOUCH)
const gameCanvas = document.getElementById('gameCanvas');
const ctx = gameCanvas.getContext('2d');
const messagesContainer = document.getElementById('messages');
const MAX_GAMEPADS = 4; // Para P3, P4, P5, P6

// Elementos de Status e Joysticks
const gamepadElements = [
    document.getElementById('gamepad1Info'), 
    document.getElementById('gamepad2Info'), 
    document.getElementById('gamepad3Info'), 
    document.getElementById('gamepad4Info')
];

// Assegure-se de que estes elementos estão no seu index.html para evitar erros.
// A primeira resposta assumiu P1/P2 Teclado/Mouse e P3-P6 Gamepad
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
const ARROW_SIZE = 10;
const PLAYER_SIZE = 30;

// --- Input (Teclado, Mouse, Touch) ---
let keysToSend = { up: false, down: false, left: false, right: false, sprint: false };
let attackSent = false; 
let shootAngle = 0; 
let mouseX = 0; 
let mouseY = 0;
const lastGamepadAttackTime = [0, 0, 0, 0];
let playerNumber = 0; // Armazena o número do jogador (1 a 6)

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
    
    // Define o número do jogador para lógica de input
    const myPlayer = allPlayers[myPlayerId];
    if (myPlayer) {
        playerNumber = parseInt(myPlayer.name.substring(1));
    }
    
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
    if (playerNumber === 1 || playerNumber === 0) { // Assume P1 se playerNumber ainda não foi setado
        if (key === 'w') keysToSend.up = true;
        if (key === 's') keysToSend.down = true;
        if (key === 'a') keysToSend.left = true;
        if (key === 'd') keysToSend.right = true;
        if (key === 'shift') keysToSend.sprint = true;
        if (key === 'c') attackSent = true; 
    }

    // P2 Teclado (Setas, P, E) - Setas/P/E não devem sobrepor as do P1.
    // O código anterior usava setas e P/E para P2, mas se P1 e P2 estiverem no mesmo teclado, isso pode dar problema.
    // Vamos manter a lógica original: P1 usa WASD/C/Shift. P2 usará a segunda configuração de controle que o servidor deve ignorar se for o P1. 
    // Como a lógica de movimento do P2 (setas) sobrepõe P1 se P1 usar WASD, manteremos a original para P1.
    
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
    
    // P1 Teclado
    if (playerNumber === 1 || playerNumber === 0) {
        if (key === 'w') keysToSend.up = false;
        if (key === 's') keysToSend.down = false;
        if (key === 'a') keysToSend.left = false;
        if (key === 'd') keysToSend.right = false;
        if (key === 'shift') keysToSend.sprint = false;
        // 'c' é um evento de 'tiro' e não é desligado no keyup.
    }
    
    // Opcional: Adicionar lógica para P2 Teclado aqui se você definir controles exclusivos para ele
    // if (playerNumber === 2) { ... }
    
    // Os botões de P2 no código anterior não devem ser mais necessários se P1 usar WASD e P2 usar Gamepad.
    // Se quiser P2 em Setas:
    // if (key === 'arrowup') keysToSend.up = false;
    // if (key === 'arrowdown') keysToSend.down = false;
    // if (key === 'arrowleft') keysToSend.left = false;
    // if (key === 'arrowright') keysToSend.right = false;
    // if (key === 'p') keysToSend.sprint = false;
});

// --- 2. Lógica de Input (Mouse) ---
gameCanvas.addEventListener('mousemove', (e) => {
    // Apenas P1 (e talvez P2) deve usar a mira do mouse
    if (playerNumber > 2) return; 
    const rect = gameCanvas.getBoundingClientRect();
    // Ajusta a posição do mouse para a coordenada do mundo do jogo
    mouseX = (e.clientX - rect.left) / (rect.width / gameCanvas.width) + cameraX; 
    mouseY = (e.clientY - rect.top) / (rect.height / gameCanvas.height) + cameraY;
});

gameCanvas.addEventListener('mousedown', (e) => {
    if (playerNumber > 2) return;
    if (e.button === 0) { attackSent = true; } // Botão esquerdo
});


// --- 3. Lógica de Input (Touch / Joysticks Virtuais) ---

function handleTouchStart(e, type) {
    // Apenas o P1 usa o controle de toque
    if (playerNumber !== 1) return;
    
    if (e.target.closest(`#${type}-joystick-area`)) {
        e.preventDefault();
        const touch = e.touches[0];
        const area = touchInput[type];
        const rect = e.currentTarget.getBoundingClientRect();

        area.active = true;
        
        // Ponto de toque inicial é o centro virtual
        area.startX = rect.width / 2;
        area.startY = rect.height / 2;
        
        // Posiciona o knob no centro da área inicialmente
        const knob = type === 'move' ? moveJoystick : aimJoystick;
        knob.style.transform = `translate(-50%, -50%) translate(0px, 0px)`;
    }
}

function handleTouchMove(e, type) {
    if (playerNumber !== 1) return;
    
    const touch = e.touches[0];
    const area = touchInput[type];
    if (!area.active) return;
    
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    
    // Calcula a posição do toque em relação ao centro da área
    let currentX = touch.clientX - (rect.left + rect.width / 2);
    let currentY = touch.clientY - (rect.top + rect.height / 2);
    
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
    if (playerNumber !== 1) return;
    
    const area = touchInput[type];
    if (!area.active) return;
    
    area.active = false;
    area.deltaX = 0;
    area.deltaY = 0;
    
    // Retorna o Knob ao centro
    const knob = type === 'move' ? moveJoystick : aimJoystick;
    knob.style.transform = `translate(-50%, -50%) translate(0px, 0px)`;
    
    // Se for o joystick de mira, desliga o tiro
    if (type === 'aim') {
        attackSent = false;
    }
}

// Configura Listeners de Toque
if (moveJoystickArea && aimJoystickArea) {
    moveJoystickArea.addEventListener('touchstart', (e) => handleTouchStart(e, 'move'), { passive: false });
    moveJoystickArea.addEventListener('touchmove', (e) => handleTouchMove(e, 'move'), { passive: false });
    moveJoystickArea.addEventListener('touchend', (e) => handleTouchEnd(e, 'move'));

    aimJoystickArea.addEventListener('touchstart', (e) => handleTouchStart(e, 'aim'), { passive: false });
    aimJoystickArea.addEventListener('touchmove', (e) => handleTouchMove(e, 'aim'), { passive: false });
    aimJoystickArea.addEventListener('touchend', (e) => handleTouchEnd(e, 'aim'));
}


// --- 4. Função de Envio de Input ---

function sendInputToServer() {
    if (!gameRunning || !myPlayerId) return;

    const myPlayer = allPlayers[myPlayerId];
    if (!myPlayer || !myPlayer.isAlive) return;

    let currentKeys = { ...keysToSend };
    let currentShoot = attackSent;
    let currentAngle = 0;

    // A. Lógica Gamepad (P3 a P6)
    if (playerNumber >= 3 && playerNumber <= 6) {
        const gamepadIndex = playerNumber - 3;
        const gamepad = navigator.getGamepads()[gamepadIndex];

        if (gamepad) {
            // Mover (Joystick Esquerdo)
            if (gamepad.axes[1] < -0.5) currentKeys.up = true; else currentKeys.up = false;
            if (gamepad.axes[1] > 0.5) currentKeys.down = true; else currentKeys.down = false;
            if (gamepad.axes[0] < -0.5) currentKeys.left = true; else currentKeys.left = false;
            if (gamepad.axes[0] > 0.5) currentKeys.right = true; else currentKeys.right = false;

            // Sprint (Triângulo/Y - Botão 3)
            currentKeys.sprint = gamepad.buttons[3]?.pressed || false; 

            // Atirar (X/A - Botão 0)
            if (gamepad.buttons[0]?.pressed) {
                if (Date.now() - lastGamepadAttackTime[gamepadIndex] > myPlayer.equippedWeapon.attackSpeed) {
                    currentShoot = true;
                    lastGamepadAttackTime[gamepadIndex] = Date.now();
                }
            } else {
                // Se não estiver pressionado, reseta o tiro
                currentShoot = false; 
            }

            // Mira (Joystick Direito)
            const aimX = gamepad.axes[2] || 0; 
            const aimY = gamepad.axes[3] || 0;
            if (Math.abs(aimX) > 0.1 || Math.abs(aimY) > 0.1) {
                currentAngle = Math.atan2(aimY, aimX);
            } else {
                // Se não houver mira, usa a direção do movimento (para arco)
                if (currentKeys.up || currentKeys.down || currentKeys.left || currentKeys.right) {
                    currentAngle = Math.atan2(
                        (currentKeys.down ? 1 : 0) - (currentKeys.up ? 1 : 0), 
                        (currentKeys.right ? 1 : 0) - (currentKeys.left ? 1 : 0)
                    );
                }
            }
        }
    } 
    
    // B. Lógica Touch (P1 com Joysticks Virtuais)
    else if (playerNumber === 1 && (touchInput.move.active || touchInput.aim.active)) {
        const move = touchInput.move;
        const aim = touchInput.aim;
        
        // Movimento e Sprint
        currentKeys.up = move.deltaY < -10;
        currentKeys.down = move.deltaY > 10;
        currentKeys.left = move.deltaX < -10;
        currentKeys.right = move.deltaX > 10;
        currentKeys.sprint = Math.sqrt(move.deltaX * move.deltaX + move.deltaY * move.deltaY) > 40;

        // Mira e Tiro
        const aimDistance = Math.sqrt(aim.deltaX * aim.deltaX + aim.deltaY * aim.deltaY);
        if (aim.active && aimDistance > 10) { 
             currentAngle = Math.atan2(aim.deltaY, aim.deltaX);
             currentShoot = true; // Tiro contínuo no touch (controlado pelo servidor)
        } else if (aim.active) {
            currentShoot = false;
        } else if (!currentShoot) {
            // Se o joystick de mira não estiver ativo, volta para a mira do mouse/teclado se não estiver atirando
            currentAngle = Math.atan2(mouseY - (myPlayer.y + myPlayer.height / 2), mouseX - (myPlayer.x + myPlayer.width / 2));
        }
    }
    
    // C. Lógica Teclado/Mouse (P1/P2)
    else if (playerNumber === 1 || playerNumber === 2) {
        // Mira do mouse para P1/P2
        currentAngle = Math.atan2(mouseY - (myPlayer.y + myPlayer.height / 2), mouseX - (myPlayer.x + myPlayer.width / 2));
    }
    
    // Envio final para o servidor
    socket.emit('playerInput', {
        keys: currentKeys, 
        shoot: currentShoot, 
        shootAngle: currentAngle 
    });

    // Resetar o estado de tiro (Mouse/Teclado/Touch End)
    if (playerNumber <= 2) { // Somente P1/P2 usa o reset por evento mousedown/keydown
        attackSent = false; 
    }
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

// Inicia o loop quando os dados do jogador chegarem
// requestAnimationFrame(gameLoop); 


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

    // Centro do jogador
    const playerCenterX = myPlayer.x + myPlayer.width / 2;
    const playerCenterY = myPlayer.y + myPlayer.height / 2;

    // Posição alvo da câmera
    let targetX = playerCenterX - gameCanvas.width / 2;
    let targetY = playerCenterY - gameCanvas.height / 2;

    // Limites e Suavização
    targetX = Math.max(0, Math.min(mapWidth - gameCanvas.width, targetX));
    targetY = Math.max(0, Math.min(mapHeight - gameCanvas.height, targetY));
    
    // Suavização (Interpolação linear)
    cameraX += (targetX - cameraX) * 0.1; 
    cameraY += (targetY - cameraY) * 0.1; 
}

function updateInputStatus() {
    const gamepads = navigator.getGamepads();
    gamepadElements.forEach((el, index) => {
        if (!el) return; // Proteção caso o index.html não tenha todos os 4 slots
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

/**
 * Funçao ausente que causou o erro.
 * Desenha um obstáculo no canvas.
 */
function drawObstacle(ctx, obstacle) {
    // Usa a cor enviada pelo servidor, se disponível
    ctx.fillStyle = obstacle.color || '#34495e'; 
    ctx.fillRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
}

function draw() {
    ctx.fillStyle = '#1a202c'; // Cor do fundo do mapa
    ctx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);
    
    ctx.save();
    ctx.translate(-cameraX, -cameraY); // Aplica a câmera

    // 1. Desenha Obstáculos (AGORA USANDO A FUNÇÃO CORRIGIDA)
    serverObstacles.forEach(obs => {
        drawObstacle(ctx, obs);
    });

    // 2. Desenha Projéteis
    for (const id in serverProjectiles) {
        const proj = serverProjectiles[id];
        // Proteção extra contra projéteis inválidos
        if (isNaN(proj.x) || isNaN(proj.y)) continue; 
        
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

        // Barra de Energia (Sprint)
        const energyWidth = player.width * (player.energy / 100);
        ctx.fillStyle = '#444';
        ctx.fillRect(player.x, player.y - 4, player.width, 3);
        ctx.fillStyle = '#3498db'; // Azul
        ctx.fillRect(player.x, player.y - 4, energyWidth, 3);

        // Status Effects (Ex: Lento, Veneno, Fogo)
        if (player.status.slow.active) {
            ctx.fillStyle = 'rgba(52, 152, 219, 0.4)'; // Azul transparente
            ctx.fillRect(player.x, player.y, player.width, player.height);
        }
        if (player.status.poison.active) {
            ctx.fillStyle = 'rgba(46, 204, 113, 0.4)'; // Verde transparente
            ctx.fillRect(player.x, player.y, player.width, player.height);
        }
        if (player.status.burn.active) {
            ctx.fillStyle = 'rgba(231, 76, 60, 0.4)'; // Vermelho transparente
            ctx.fillRect(player.x, player.y, player.width, player.height);
        }
    }

    ctx.restore(); // Volta para a tela de GUI (sem câmera)

    // 4. Desenha UI (Nome da Arma na tela, fixo)
    const myPlayer = allPlayers[myPlayerId];
    if (myPlayer) {
        ctx.fillStyle = 'white';
        ctx.font = '12px "Press Start 2P"';
        ctx.textAlign = 'left';
        
        // UI fixa no canto superior esquerdo
        ctx.fillText(`ARMA: ${myPlayer.equippedWeapon.name}`, 10, 30);
        ctx.fillText(`FLECHAS: ${myPlayer.arrows}`, 10, 50);
        
        // Desenha a mira (crosshair) para P1/P2
        if (playerNumber === 1 || playerNumber === 2) {
             ctx.strokeStyle = 'red';
             ctx.lineWidth = 1;
             ctx.beginPath();
             // Usa mouseX/mouseY para desenhar a mira na posição correta do mundo, ajustada pela câmera
             ctx.arc(mouseX - cameraX, mouseY - cameraY, 5, 0, Math.PI * 2); 
             ctx.stroke();
        }
    }
}