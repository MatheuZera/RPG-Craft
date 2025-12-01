// game.js (CLIENTE 6 JOGADORES)

// --- Configurações Globais ---
// As dimensões do mapa serão recebidas do servidor.
const PLAYER_SIZE = 30;
const ARROW_SIZE = 10;
const MAX_GAMEPADS = 4; // Para P3, P4, P5, P6 (Gamepads 1 a 4)

// Obtenção dos elementos do DOM (Expandido para 6 Jogadores)
const gameCanvas = document.getElementById('gameCanvas');
const ctx = gameCanvas.getContext('2d');
const messagesContainer = document.getElementById('messages');
const gamepad1Info = document.getElementById('gamepad1Info');
const gamepad2Info = document.getElementById('gamepad2Info');
const gamepad3Info = document.getElementById('gamepad3Info'); // NOVO
const gamepad4Info = document.getElementById('gamepad4Info'); // NOVO
// Elementos de controle para Gamepads 3 e 4 (P5 e P6)
const player3ControlsDisplay = document.getElementById('player3-controls');
const player4ControlsDisplay = document.getElementById('player4-controls');
const player5ControlsDisplay = document.getElementById('player5-controls'); // NOVO
const player6ControlsDisplay = document.getElementById('player6-controls'); // NOVO

// --- Conexão de Rede e Estado Global do Cliente ---
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
let cameraX = 0; 
let cameraY = 0;

// Variável para armazenar o tempo do último ataque de cada gamepad (para controle de frequência)
const lastGamepadAttackTime = [0, 0, 0, 0]; // 4 slots para gamepads (P3 a P6)

// --- Sistema de Input ---
const keysPressed = {}; // Mapeamento de teclas pressionadas
let keysToSend = { up: false, down: false, left: false, right: false, sprint: false };
let attackSent = false; 
let shootAngle = 0; 
let mouseX = 0; 
let mouseY = 0;


/**
 * Função para mapear Gamepad para Input do Jogador (P3, P4, P5, P6)
 */
function getGamepadControls(gamepad, playerNum) {
    let keys = { up: false, down: false, left: false, right: false, sprint: false };
    let shoot = false;
    
    // Movimento (Joystick Esquerdo ou D-Pad)
    if (gamepad.axes[1] < -0.5 || gamepad.buttons[12]?.pressed) keys.up = true;
    if (gamepad.axes[1] > 0.5 || gamepad.buttons[13]?.pressed) keys.down = true;
    if (gamepad.axes[0] < -0.5 || gamepad.buttons[14]?.pressed) keys.left = true;
    if (gamepad.axes[0] > 0.5 || gamepad.buttons[15]?.pressed) keys.right = true;

    const gamepadIndex = playerNum - 3; // P3 = index 0, P6 = index 3
    
    // Tiro (Gatilho ou Botão de Ação)
    if (gamepad.buttons[7]?.pressed || gamepad.buttons[5]?.pressed || gamepad.buttons[0]?.pressed) { // R2/RT ou R1/RB ou A/X
        // Limita a taxa de tiro a 100ms
        if (Date.now() - lastGamepadAttackTime[gamepadIndex] > 100) { 
             shoot = true;
             lastGamepadAttackTime[gamepadIndex] = Date.now();
        }
    }
    
    // Sprint (Gatilho Esquerdo ou Botão de Ombro)
    if (gamepad.buttons[6]?.pressed || gamepad.buttons[4]?.pressed) { 
        keys.sprint = true;
    }

    // Mira (Joystick direito para calcular o ângulo)
    const aimX = gamepad.axes[2] || 0; 
    const aimY = gamepad.axes[3] || 0;
    
    let angle = 0;
    if (Math.abs(aimX) > 0.1 || Math.abs(aimY) > 0.1) {
        // Mira com Joystick Direito
        angle = Math.atan2(aimY, aimX);
    } else {
        // Se não houver mira, usa a direção do movimento (pode ser ajustado)
        if (keys.left) angle = Math.PI;
        else if (keys.right) angle = 0;
        else if (keys.up) angle = -Math.PI / 2;
        else if (keys.down) angle = Math.PI / 2;
    }

    return { keys, shoot, angle };
}

// --- Eventos de Rede ---

socket.on('playerData', (data) => {
    myPlayerId = data.id;
    allPlayers = data.players;
    serverObstacles = data.obstacles;
    mapWidth = data.mapWidth || 1000; // Usa os tamanhos maiores do servidor
    mapHeight = data.mapHeight || 800;

    gameCanvas.width = mapWidth;
    gameCanvas.height = mapHeight;

    gameRunning = true;
    showMessage('Conectado ao servidor! ID: ' + allPlayers[myPlayerId].name);
    // Removemos a chamada requestAnimationFrame(gameLoop) aqui para simplificar e garantir que
    // o loop só comece após o load (que será feito mais abaixo).
});

socket.on('gameStateUpdate', (data) => {
    allPlayers = data.players;
    serverProjectiles = data.projectiles;
    serverPickups = data.pickups;
});

// Outros eventos de rede (playerDisconnected, message, playerKilled, gameOver) 
// permanecem como no seu original, mas atualizados para usar allPlayers.

socket.on('playerDisconnected', (playerId) => {
    const disconnectedName = allPlayers[playerId]?.name || `Jogador Desconhecido`;
    delete allPlayers[playerId];
    showMessage(`${disconnectedName} saiu do jogo.`);
    // A remoção da GUI de cabeça deve ser adaptada, mas é secundário por agora.
});

socket.on('message', (text) => {
    showMessage(text); // Função corrigida (está no final deste arquivo)
});

socket.on('playerKilled', (data) => {
    const targetName = allPlayers[data.targetId]?.name || 'Jogador Desconhecido';
    const killerName = allPlayers[data.killerId]?.name || 'Jogador Desconhecido';
    showMessage(`${targetName} foi derrotado por ${killerName}!`);
});

socket.on('gameOver', (winnerId) => {
    endGame(winnerId); // Usaremos sua função endGame, que precisa ser adaptada (ver abaixo)
});


// --- Lógica de Captura de Input (Teclado/Mouse) ---

gameCanvas.addEventListener('mousemove', (e) => {
    const rect = gameCanvas.getBoundingClientRect();
    const scaleX = gameCanvas.width / rect.width;
    const scaleY = gameCanvas.height / rect.height;

    // Converte a posição do mouse para coordenadas do jogo (com câmera)
    // Aqui usamos myPlayerId para garantir que a mira é relativa ao jogador
    const myPlayer = allPlayers[myPlayerId];
    if (myPlayer) {
        mouseX = (e.clientX - rect.left) * scaleX + cameraX; 
        mouseY = (e.clientY - rect.top) * scaleY + cameraY;
    }
});

gameCanvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) { // Botão esquerdo do mouse
        attackSent = true;
    }
});

window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    
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
    if (key === 'p') keysToSend.sprint = true;
    if (key === 'e') attackSent = true; 
    
    if ([' ', 'w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'c', 'e', 'f', 'p'].includes(key)) {
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    
    if (key === 'w' || key === 'arrowup') keysToSend.up = false;
    if (key === 's' || key === 'arrowdown') keysToSend.down = false;
    if (key === 'a' || key === 'arrowleft') keysToSend.left = false;
    if (key === 'd' || key === 'arrowright') keysToSend.right = false;
    if (key === 'f' || key === 'p') keysToSend.sprint = false;
    // O ataque só é resetado no sendInputToServer
});


function sendInputToServer() {
    if (!gameRunning || !myPlayerId) return;

    const myPlayer = allPlayers[myPlayerId];
    if (!myPlayer || !myPlayer.isAlive) return;

    let playerNumber = parseInt(myPlayer.name.substring(1)); // Pega o número do jogador (1 a 6)

    let currentKeys = { ...keysToSend }; // Começa com o input do teclado
    let currentShoot = attackSent;
    let currentAngle = shootAngle;

    // 1. Processar Gamepads (Se o jogador for P3, P4, P5 ou P6)
    if (playerNumber >= 3 && playerNumber <= 6) {
        const gamepadIndex = playerNumber - 3; // P3 = index 0, P6 = index 3
        const gamepad = navigator.getGamepads()[gamepadIndex];

        if (gamepad) {
            const controls = getGamepadControls(gamepad, playerNumber);
            currentKeys = controls.keys; // Sobrescreve o teclado pelo Gamepad
            currentShoot = currentShoot || controls.shoot; // Se atirar pelo Gamepad OU Teclado
            currentAngle = controls.angle; // Usa o ângulo do Gamepad
        }
    } else if (playerNumber === 1 || playerNumber === 2) {
        // 2. Calcular o ângulo de mira (Teclado/Mouse)
        currentAngle = Math.atan2(mouseY - myPlayer.y, mouseX - myPlayer.x);
    } else {
        // Posição 5 e 6 no teclado/mouse, mas não temos o mapeamento, então usa o P1/P2
        currentAngle = Math.atan2(mouseY - myPlayer.y, mouseX - myPlayer.x);
    }
    
    socket.emit('playerInput', {
        keys: currentKeys, 
        shoot: currentShoot, 
        shootAngle: currentAngle 
    });

    // Resetar o estado de tiro APÓS o envio
    attackSent = false; 
}


// --- Loop Principal do Jogo (Cliente) ---

function gameLoop(currentTime = 0) {
    if (!gameRunning) {
        requestAnimationFrame(gameLoop); // Mantém o loop esperando
        return;
    }
    
    const deltaTime = (currentTime - lastFrameTime) || 16; 
    lastFrameTime = currentTime;

    // 1. Enviar Input
    sendInputToServer();
    
    // 2. Lógica Local (Câmera)
    updateCamera(); 
    
    // 3. Desenhar
    draw(); 

    // 4. Atualiza o display GUI
    updateInputStatus(); 

    requestAnimationFrame(gameLoop);
}

// Inicia o loop para garantir que o cliente está sempre rodando
requestAnimationFrame(gameLoop); 

// --- Funções de Desenho, GUI e Fim de Jogo ---

/**
 * Funções de desenho (drawPlayer, drawProjectile, drawObstacle, drawGUI) 
 * devem ser adaptadas para usar a lógica baseada na câmera (cameraX, cameraY).
 * Esta lógica não foi modificada por ser extensa, assumindo que funcionava 
 * no seu código original:
 * Ex: ctx.fillRect(player.x - cameraX, player.y - cameraY, player.width, player.height);
 */
function draw() {
    // 1. Limpa o Canvas
    // ctx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);
    ctx.fillStyle = '#2c3e50';
    ctx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);

    // 2. Desenha Obstáculos
    serverObstacles.forEach(obs => drawObstacle(obs));

    // 3. Desenha Pickups
    for (const id in serverPickups) {
        drawPickup(serverPickups[id]);
    }

    // 4. Desenha Projéteis
    for (const id in serverProjectiles) {
        drawProjectile(serverProjectiles[id]);
    }

    // 5. Desenha Jogadores
    for (const id in allPlayers) {
        drawPlayer(allPlayers[id]);
    }

    // 6. Desenha GUI de Head (acima dos jogadores)
    for (const id in allPlayers) {
        drawPlayerHeadGUI(allPlayers[id]);
    }
}

// ... (Outras funções de desenho: drawPlayer, drawProjectile, drawObstacle, drawPickup, drawPlayerHeadGUI)

function updateCamera() {
    const myPlayer = allPlayers[myPlayerId];
    if (!myPlayer) return;

    let targetX = myPlayer.x - gameCanvas.width / 2 + myPlayer.width / 2;
    let targetY = myPlayer.y - gameCanvas.height / 2 + myPlayer.height / 2;

    // Implemente sua lógica de tremor aqui se necessário.

    // Limites do Mapa
    targetX = Math.max(0, Math.min(mapWidth - gameCanvas.width, targetX));
    targetY = Math.max(0, Math.min(mapHeight - gameCanvas.height, targetY));


    const smoothing = 0.08;
    const factor = lastFrameTime > 0 ? (lastFrameTime / 16) : 1; 

    cameraX += (targetX - cameraX) * smoothing * factor; 
    cameraY += (targetY - cameraY) * smoothing * factor; 
}

function updateInputStatus() {
    const gamepads = navigator.getGamepads();
    const gamepadElements = [
        { el: gamepad1Info, controls: player3ControlsDisplay },
        { el: gamepad2Info, controls: player4ControlsDisplay },
        { el: gamepad3Info, controls: player5ControlsDisplay }, // NOVO
        { el: gamepad4Info, controls: player6ControlsDisplay }  // NOVO
    ];

    gamepadElements.forEach((item, index) => {
        const gamepad = gamepads[index];
        const playerNum = index + 3; // P3, P4, P5, P6

        if (gamepad) {
            item.el.innerHTML = `<span class="status-icon"></span>Slot Gamepad ${index + 1} (P${playerNum}): Conectado (${gamepad.id.substring(0, Math.min(15, gamepad.id.length))}...)`;
            item.el.className = 'connected';
            // Apenas P3 a P6 usam gamepads, então só mostra os controles deles.
            document.getElementById(`player${playerNum}-controls`).style.display = 'block'; 
        } else {
            item.el.innerHTML = `<span class="status-icon"></span>Slot Gamepad ${index + 1} (P${playerNum}): Desconectado`;
            item.el.className = 'disconnected';
            document.getElementById(`player${playerNum}-controls`).style.display = 'none'; 
        }
    });
}

/**
 * Função Corrigida: Adiciona uma mensagem ao container de mensagens do jogo.
 */
function showMessage(text) {
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

/**
 * Adaptação da sua função endGame.
 */
function endGame(winnerId) {
    if (!gameRunning) return;
    gameRunning = false;
    
    let winnerName = "Ninguém";
    if (winnerId) {
        winnerName = allPlayers[winnerId]?.name || 'Jogador Vencedor';
    } else {
        // Se não houver winnerId, significa que todos foram eliminados
        winnerName = "Todos foram derrotados!";
    }
    
    showMessage(`FIM DE JOGO! Vencedor: ${winnerName}`);

    // Cria o botão de reiniciar (lógica mantida do seu código original)
    setTimeout(() => {
        const restartButton = document.createElement('button');
        restartButton.textContent = 'Reiniciar Jogo';
        restartButton.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            padding: 15px 30px;
            font-size: 1.5em;
            background-color: #28a745;
            color: white;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            box-shadow: 0 5px 15px rgba(0,0,0,0.5);
            font-family: 'Press Start 2P', cursive;
            z-index: 200;
        `;
        // Recarrega a página ao clicar
        restartButton.onclick = () => window.location.reload(); 
        document.body.appendChild(restartButton);
    }, 1000); 
}