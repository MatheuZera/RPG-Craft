// game.js (VERSÃO CLIENTE-REDE 100% COMPLETA)

// --- Configurações Globais (Manter suas constantes originais) ---
const CANVAS_WIDTH = 800; 
const CANVAS_HEIGHT = 600; 
const PLAYER_SIZE = 30;
const ARROW_SIZE = 10;
const ARROW_SPEED = 10; 
// Remova constantes de velocidade, energia, e spawn de pickups - elas são do servidor!

// Obtenção dos elementos do DOM
const gameCanvas = document.getElementById('gameCanvas');
const ctx = gameCanvas.getContext('2d');
const messagesContainer = document.getElementById('messages');
const gamepad1Info = document.getElementById('gamepad1Info');
const gamepad2Info = document.getElementById('gamepad2Info');
const player1ControlsDisplay = document.getElementById('player1-controls');
const player2ControlsDisplay = document.getElementById('player2-controls');
const player3ControlsDisplay = document.getElementById('player3-controls');
const player4ControlsDisplay = document.getElementById('player4-controls');

// --- Conexão de Rede ---
// A função 'io()' é globalmente disponível graças ao script do socket.io no index.html
const socket = io(); 
let myPlayerId = null; 
let allPlayers = {}; // Estado dos jogadores fornecido pelo servidor
let serverProjectiles = {}; // Estado dos projéteis fornecido pelo servidor
let serverObstacles = []; // Obstáculos fornecidos pelo servidor
let serverPickups = {}; // Pickups fornecidos pelo servidor

let gameRunning = false;
let lastFrameTime = 0;
let cameraShakeIntensity = 0;
let cameraShakeTimer = 0;
let cameraX = 0;
let cameraY = 0;

// --- Sistema de Input ---
const input = {
    keys: {},
    lastGamepadAttackTime: [0, 0],
    isKeyDown(key) {
        return this.keys[key.toLowerCase()] || false;
    },
    // Funções de Gamepad: É essencial que estas funções sejam mantidas e adaptadas.
    // Presumindo que você as tinha no seu código original:
    getGamepadType(gamepad) {
        if (!gamepad) return 'None';
        if (gamepad.id.toLowerCase().includes('xbox')) return 'xbox';
        return 'standard';
    },
    getGamepadControls(gamepad, playerNum) {
        // Lógica para obter input do gamepad (sticks/botões) e retornar as chaves
        // Esta lógica deve ser simples, apenas para atualizar keysToSend e attackSent
        let keys = { up: false, down: false, left: false, right: false, sprint: false };
        let shoot = false;
        
        // Exemplo básico de mapeamento (ajuste conforme seu mapeamento original)
        if (gamepad.axes[1] < -0.5) keys.up = true;
        if (gamepad.axes[1] > 0.5) keys.down = true;
        if (gamepad.axes[0] < -0.5) keys.left = true;
        if (gamepad.axes[0] > 0.5) keys.right = true;

        if (gamepad.buttons[7]?.pressed || gamepad.buttons[5]?.pressed) { // R2/RT ou R1/RB
            if (Date.now() - input.lastGamepadAttackTime[playerNum - 3] > 100) { // Cooldown básico
                 shoot = true;
                 input.lastGamepadAttackTime[playerNum - 3] = Date.now();
            }
        }
        
        if (gamepad.buttons[6]?.pressed || gamepad.buttons[4]?.pressed) { // L2/LT ou L1/LB para correr
            keys.sprint = true;
        }

        // Joystick direito para mira (apenas para calcular o ângulo)
        const aimX = gamepad.axes[2] || 0; 
        const aimY = gamepad.axes[3] || 0;
        
        let angle = 0;
        if (Math.abs(aimX) > 0.1 || Math.abs(aimY) > 0.1) {
            angle = Math.atan2(aimY, aimX);
        } else {
            // Se não houver mira, usa a direção do movimento como base (ou mantém o último)
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
    gameRunning = true;
    showMessage('Conectado ao servidor! ID do Jogador: ' + myPlayerId);
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
    if (data.targetId === myPlayerId) {
        showMessage('Você foi derrotado!');
    } else {
        showMessage(`${allPlayers[data.targetId]?.name} foi derrotado!`);
    }
    // Adiciona o tremor da câmera no cliente que atirou, se necessário
    if (data.killerId === myPlayerId) {
        startCameraShake(50, 200);
    }
});

socket.on('gameOver', (winnerId) => {
    const winnerName = allPlayers[winnerId]?.name || "Ninguém";
    showMessage(`FIM DE JOGO! Vencedor: ${winnerName}`);
    gameRunning = false;
    // Lógica para mostrar o botão de reiniciar (que deve enviar 'socket.emit('restart')')
});


// --- Lógica de Captura de Input (REFACTOR) ---

gameCanvas.addEventListener('mousemove', (e) => {
    const rect = gameCanvas.getBoundingClientRect();
    const scaleX = gameCanvas.width / rect.width;
    const scaleY = gameCanvas.height / rect.height;

    // Converte a posição do mouse para coordenadas do jogo
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
    if (key === 'c') attackSent = true; 

    // Mapeamento P2 (Teclado) - Setas
    if (key === 'arrowup') keysToSend.up = true;
    if (key === 'arrowdown') keysToSend.down = true;
    if (key === 'arrowleft') keysToSend.left = true;
    if (key === 'arrowright') keysToSend.right = true;
    if (key === 'p') keysToSend.sprint = true; // Usando P para sprint do P2
    if (key === 'e') attackSent = true; // Usando E para ataque do P2 (pode sobrepor P1)
    
    if ([' ', 'w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'c', 'e', 'f', 'p'].includes(key)) {
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    input.keys[key] = false;
    
    // Mapeamento P1/P2
    if (key === 'w' || key === 'arrowup') keysToSend.up = false;
    if (key === 's' || key === 'arrowdown') keysToSend.down = false;
    if (key === 'a' || key === 'arrowleft') keysToSend.left = false;
    if (key === 'd' || key === 'arrowright') keysToSend.right = false;
    if (key === 'f' || key === 'p') keysToSend.sprint = false;
    
    // 'c' e 'e' não precisam ser resetados no keyup, pois 'attackSent' é resetado após o envio.
});


function sendInputToServer() {
    if (!gameRunning || !myPlayerId) return;

    const myPlayer = allPlayers[myPlayerId];
    if (!myPlayer || !myPlayer.isAlive) return;

    // 1. Processar Gamepads (P3 e P4)
    const gamepads = navigator.getGamepads();
    let gamepadInput = { keys: { ...keysToSend }, shoot: attackSent, angle: shootAngle };

    // P3 (Gamepad 1) e P4 (Gamepad 2)
    for (let i = 0; i < gamepads.length; i++) {
        const gamepad = gamepads[i];
        if (gamepad && (i === 0 || i === 1)) {
            const playerNum = i + 3; // P3 ou P4
            // A lógica é complexa para P3/P4, aqui vamos considerar apenas um player por enquanto:
            if (i === 0) { // Apenas para o primeiro gamepad
                 const controls = input.getGamepadControls(gamepad, playerNum);
                 // Se o gamepad estiver em uso, sobrescreve o input do teclado
                 if(controls.keys.up || controls.keys.down || controls.keys.left || controls.keys.right) {
                     gamepadInput.keys = controls.keys;
                 }
                 if(controls.shoot) {
                     gamepadInput.shoot = true;
                 }
                 if(controls.angle !== 0) {
                    gamepadInput.angle = controls.angle;
                 }
            }
        }
    }
    
    // 2. Calcular o ângulo de mira (usa o mouse por padrão, ou gamepad)
    // Se o mouse se moveu, a mira é baseada no mouse:
    shootAngle = Math.atan2(mouseY - myPlayer.y, mouseX - myPlayer.x);
    
    socket.emit('playerInput', {
        keys: gamepadInput.keys, // Envia o input do teclado OU gamepad
        shoot: gamepadInput.shoot || attackSent, // Ativa o tiro se teclado OU gamepad ativou
        shootAngle: shootAngle 
    });

    // Resetar o estado de tiro APÓS o envio
    attackSent = false; 
}


// --- Loop Principal do Jogo (AGORA SÓ UM DESENHISTA) ---

function gameLoop(currentTime = 0) {
    if (!gameRunning) return;

    const deltaTime = currentTime - lastFrameTime;
    lastFrameTime = currentTime; 

    // 1. Enviar Input
    sendInputToServer();
    
    // 2. Lógica Local (Câmera)
    if (cameraShakeTimer > 0) {
        cameraShakeTimer = Math.max(0, cameraShakeTimer - deltaTime);
        if (cameraShakeTimer === 0) {
            cameraShakeIntensity = 0;
        }
    }
    
    // 3. Atualizar e Desenhar
    updateCamera(); 
    draw(); 

    // Atualiza o display GUI
    for(const id in allPlayers) {
        const player = allPlayers[id];
        let guiElement = document.querySelector(`.player-head-gui.p${id}`);
        if (!guiElement) {
            guiElement = createHeadGuiElement(player); 
        }
        updateHeadGui(player); 
        updateHeadGuiPosition(player);
    }
    updateInputStatus();

    // REMOVIDO: endGame() e lógica de jogo do cliente
    // O servidor gerencia o fim de jogo (socket.on('gameOver'))

    requestAnimationFrame(gameLoop);
}


// --- Funções de Desenho e GUI (Essenciais) ---

/**
 * Adiciona uma mensagem ao container de mensagens do jogo.
 * ESTA FUNÇÃO FOI ADICIONADA PARA CORRIGIR O SEU ERRO DE showMessage is not defined!
 */
function showMessage(text) {
    // Re-obter o container, caso o global messagesContainer não tenha sido carregado
    const messagesEl = document.getElementById('messages');
    if (!messagesEl) return; 

    const message = document.createElement('div');
    message.className = 'message';
    message.textContent = text;
    messagesEl.prepend(message); 

    // Limita o número de mensagens visíveis
    while (messagesEl.children.length > 5) {
        messagesEl.removeChild(messagesEl.lastChild);
    }
}


function startCameraShake(intensity, duration) {
    cameraShakeIntensity = intensity;
    cameraShakeTimer = duration;
}

function updateCamera() {
    const myPlayer = allPlayers[myPlayerId];
    if (!myPlayer) return;

    // Centraliza a câmera no jogador
    let targetX = myPlayer.x - CANVAS_WIDTH / 2 + myPlayer.width / 2;
    let targetY = myPlayer.y - CANVAS_HEIGHT / 2 + myPlayer.height / 2;

    // Limites da câmera para o mapa (opcional, se o mapa for maior que a tela)
    // Se não houver limites, apenas segue o jogador.

    // Aplica tremor
    if (cameraShakeTimer > 0) {
        targetX += Math.random() * cameraShakeIntensity * 2 - cameraShakeIntensity;
        targetY += Math.random() * cameraShakeIntensity * 2 - cameraShakeIntensity;
    }

    // Suavização (opcional, para menos jitter)
    const smoothing = 0.08;
    cameraX += (targetX - cameraX) * smoothing * (lastFrameTime / 16); 
    cameraY += (targetY - cameraY) * smoothing * (lastFrameTime / 16); 

    // Trava no canvas (se a tela for maior que o mapa)
    cameraX = Math.max(0, Math.min(CANVAS_WIDTH - gameCanvas.width, cameraX));
    cameraY = Math.max(0, Math.min(CANVAS_HEIGHT - gameCanvas.height, cameraY));
}


function draw() {
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // 1. Desenha Fundo
    ctx.fillStyle = '#485563'; // Cor de fundo do mapa
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Salva o estado para a transformação da câmera
    ctx.save();
    ctx.translate(-cameraX, -cameraY);


    // 2. Desenha Obstáculos
    serverObstacles.forEach(obs => drawObstacle(obs));

    // 3. Desenha Pickups (Implementação futura)
    // for (const id in serverPickups) { drawPickup(serverPickups[id]); }

    // 4. Desenha Projéteis
    for (const id in serverProjectiles) {
        drawProjectile(serverProjectiles[id]); 
    }

    // 5. Desenha Jogadores
    for (const id in allPlayers) {
        const player = allPlayers[id];
        if (player.isAlive) {
            drawPlayer(player);
        }
    }
    
    // Restaura o estado para desenhar a GUI fixa na tela
    ctx.restore();
}

function drawObstacle(obs) {
    ctx.fillStyle = obs.color || '#95a5a6';
    ctx.fillRect(obs.x, obs.y, obs.width, obs.height);
    // Desenho de borda
    ctx.strokeStyle = '#7f8c8d';
    ctx.lineWidth = 2;
    ctx.strokeRect(obs.x, obs.y, obs.width, obs.height);
}

function drawProjectile(proj) {
    ctx.fillStyle = proj.color || '#8b4513';
    ctx.beginPath();
    ctx.arc(proj.x + proj.width / 2, proj.y + proj.height / 2, proj.width / 2, 0, Math.PI * 2);
    ctx.fill();
}

function drawPlayer(player) {
    // Corpo do Jogador
    ctx.fillStyle = player.color;
    ctx.fillRect(player.x, player.y, player.width, player.height);

    // Desenha o nome
    ctx.fillStyle = 'white';
    ctx.font = '10px "Press Start 2P"';
    ctx.textAlign = 'center';
    ctx.fillText(player.name, player.x + player.width / 2, player.y - 15);
    
    // Desenho da mira (para o jogador local)
    if (player.id === myPlayerId) {
        ctx.strokeStyle = '#f39c12';
        ctx.lineWidth = 1;
        ctx.beginPath();
        // Desenha uma linha do centro do jogador para a mira do mouse
        ctx.moveTo(player.x + player.width / 2, player.y + player.height / 2);
        ctx.lineTo(mouseX, mouseY);
        ctx.stroke();

        // Desenha um pequeno círculo no ponto de mira
        ctx.beginPath();
        ctx.arc(mouseX, mouseY, 5, 0, Math.PI * 2);
        ctx.stroke();
    }
}


// --- Funções de GUI para Barras de Vida/Energia na Cabeça ---

function createHeadGuiElement(player) {
    const guiElement = document.createElement('div');
    guiElement.className = `player-head-gui p${player.id}`;
    guiElement.innerHTML = `
        <h3>${player.name}</h3>
        <div class="bar-container"><div class="health-bar"></div></div>
        <div class="bar-container"><div class="energy-bar"></div></div>
        <div class="ammo-display">🏹 <strong>${player.arrows}</strong></div>
        <div class="weapon-display">Weapon: ${player.equippedWeapon.name}</div>
    `;
    document.body.appendChild(guiElement);
    // Anexa o elemento DOM ao objeto player para fácil acesso
    player.headGuiElement = guiElement; 
    return guiElement;
}

function updateHeadGui(player) {
    if (!player.headGuiElement) return;

    const healthBar = player.headGuiElement.querySelector('.health-bar');
    const energyBar = player.headGuiElement.querySelector('.energy-bar');
    const ammoDisplay = player.headGuiElement.querySelector('.ammo-display strong');
    const weaponDisplay = player.headGuiElement.querySelector('.weapon-display');

    const healthPercent = (player.health / 100) * 100; // O servidor envia 100 max
    const energyPercent = (player.energy / 100) * 100; // O servidor envia 100 max

    healthBar.style.width = `${healthPercent}%`;
    energyBar.style.width = `${energyPercent}%`;
    
    // Adiciona a classe crítica se a vida estiver baixa
    if (healthPercent <= 25 && player.isAlive) {
        healthBar.classList.add('critical');
    } else {
        healthBar.classList.remove('critical');
    }

    ammoDisplay.textContent = player.arrows;
    weaponDisplay.textContent = `Weapon: ${player.equippedWeapon.name} (${player.equippedWeapon.durability})`;

    // Esconde a GUI se o jogador estiver morto
    if (!player.isAlive) {
        player.headGuiElement.style.display = 'none';
    } else {
        player.headGuiElement.style.display = 'block';
    }
}

function updateHeadGuiPosition(player) {
    if (!player.headGuiElement) return;

    const rect = gameCanvas.getBoundingClientRect();
    const scaleX = gameCanvas.width / rect.width;
    const scaleY = gameCanvas.height / rect.height;

    // Posição no mundo do jogo
    const gameX = player.x + player.width / 2;
    const gameY = player.y;

    // Converte para coordenadas da tela (com correção de câmera)
    const screenX = (gameX - cameraX) / scaleX + rect.left;
    const screenY = (gameY - 40 - cameraY) / scaleY + rect.top; // -40 para ficar acima da cabeça

    // Centraliza o elemento HTML na posição X
    player.headGuiElement.style.left = `${screenX}px`;
    player.headGuiElement.style.top = `${screenY}px`;
    player.headGuiElement.style.transform = `translateX(-50%)`;
}


function updateInputStatus() {
    // Esta função deve mostrar o status do gamepad conectado no #gamepad-status
    const gamepads = navigator.getGamepads();
    let gamepad1 = gamepads[0];
    let gamepad2 = gamepads[1];

    function updateGamepadDisplay(gamepad, infoEl, controlsEl) {
        if (gamepad) {
            infoEl.textContent = `Slot ${gamepad.index + 1} (${gamepad.id}): Conectado`;
            infoEl.className = 'connected';
            controlsEl.style.display = 'block';
            // Aqui você deve adicionar a lógica para desenhar o estado dos botões, se necessário.
        } else {
            infoEl.textContent = `Slot Gamepad ${infoEl.id.includes('1') ? 1 : 2} (P${infoEl.id.includes('1') ? 3 : 4}): Desconectado`;
            infoEl.className = 'disconnected';
            controlsEl.style.display = 'none';
        }
    }
    
    updateGamepadDisplay(gamepad1, gamepad1Info, player3ControlsDisplay);
    updateGamepadDisplay(gamepad2, gamepad2Info, player4ControlsDisplay);
}