// game.js (VERSÃO CLIENTE-REDE)

// --- Configurações Globais (Manter suas constantes originais) ---
const CANVAS_WIDTH = 800; 
const CANVAS_HEIGHT = 600; 
const PLAYER_SIZE = 30;
// Remova as constantes de velocidade e energia, o servidor as usa!
// ... (MANTENHA SUAS OUTRAS CONSTANTES DE TAMANHO DE OBJETO) ...

// Obtenção dos elementos do DOM
const gameCanvas = document.getElementById('gameCanvas');
const ctx = gameCanvas.getContext('2d');
const messagesContainer = document.getElementById('messages');
// ... (MANTENHA OUTRAS OBTENÇÕES DE DOM) ...

// --- Conexão de Rede (NOVO) ---
const socket = io(); // Conecta ao servidor que hospeda a página
let myPlayerId = null; 
let allPlayers = {}; // Estado dos jogadores fornecido pelo servidor
let serverProjectiles = {}; // Estado dos projéteis fornecido pelo servidor
let serverObstacles = []; // Obstáculos fornecidos pelo servidor
let serverPickups = {}; // Pickups fornecidos pelo servidor

let gameRunning = false;
let lastFrameTime = 0;
let cameraShakeIntensity = 0;
let cameraShakeTimer = 0;

// --- Sistema de Input (APENAS PARA COLETAR E ENVIAR) ---
const input = {
    keys: {},
    lastGamepadAttackTime: [0, 0],
    isKeyDown(key) {
        return this.keys[key.toLowerCase()] || false;
    },
    // ... (MANTENHA SUAS FUNÇÕES isGamepadButtonDown, getGamepadType, getGamepadControls)
    // Elas apenas precisam coletar o estado, não mais mover o player local.
};

// Variáveis para rastrear o input que será enviado
let keysToSend = { up: false, down: false, left: false, right: false, sprint: false };
let attackSent = false; 
let shootAngle = 0; // Ângulo de tiro

// --- Funções de Rede ---

// Recebe o ID do jogador, estado inicial e obstáculos
socket.on('playerData', (data) => {
    myPlayerId = data.id;
    allPlayers = data.players;
    serverObstacles = data.obstacles;
    gameRunning = true;
    showMessage('Conectado ao servidor! Aguardando jogadores...');
    requestAnimationFrame(gameLoop); 
});

// Recebe atualizações em tempo real do estado do jogo (o "Tick" do servidor)
socket.on('gameStateUpdate', (data) => {
    allPlayers = data.players;
    serverProjectiles = data.projectiles;
    serverPickups = data.pickups;
});

// Outros eventos
socket.on('playerDisconnected', (playerId) => {
    const disconnectedName = allPlayers[playerId]?.name || `Jogador Desconhecido`;
    delete allPlayers[playerId];
    // Remova o elemento GUI da cabeça do jogador
    document.querySelector(`.player-head-gui.p${playerId}`)?.remove();
});

socket.on('message', (text) => {
    showMessage(text);
});

socket.on('playerKilled', (data) => {
    // Lógica para mostrar animação de morte, etc.
    if (data.targetId === myPlayerId) {
        showMessage('Você foi derrotado!');
    }
});

socket.on('gameOver', (winnerId) => {
    const winnerName = allPlayers[winnerId]?.name || "Ninguém";
    showMessage(`FIM DE JOGO! Vencedor: ${winnerName}`);
    gameRunning = false;
    // ... Adicionar botão de reiniciar, se necessário.
});


// --- Lógica de Captura de Input (REFACTOR) ---

// Modifique seus listeners de teclado/gamepad para APENAS ATUALIZAR keysToSend.
window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    input.keys[key] = true;
    
    // Exemplo de mapeamento P1
    if (key === 'w') keysToSend.up = true;
    if (key === 's') keysToSend.down = true;
    if (key === 'a') keysToSend.left = true;
    if (key === 'd') keysToSend.right = true;
    if (key === 'f') keysToSend.sprint = true;
    if (key === 'c') attackSent = true; // Define o tiro para este frame

    // Adicione a lógica de mapeamento para P2, P3, P4
    // ...
    
    if ([' ', 'w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'c', 'e', 'f', 'p'].includes(key)) {
        e.preventDefault();
    }
});
window.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    input.keys[key] = false;
    
    if (key === 'w') keysToSend.up = false;
    if (key === 's') keysToSend.down = false;
    if (key === 'a') keysToSend.left = false;
    if (key === 'd') keysToSend.right = false;
    if (key === 'f') keysToSend.sprint = false;
    // 'c' não precisa ser resetado no keyup, pois 'attackSent' é resetado após o envio.
    
    // Adicione a lógica de mapeamento para P2, P3, P4
    // ...
});


function sendInputToServer() {
    if (!gameRunning || !myPlayerId) return;

    const myPlayer = allPlayers[myPlayerId];
    if (!myPlayer) return;

    // AQUI VOCÊ DEVE CALCULAR O shootAngle
    // Exemplo: se você usa o mouse para mirar.
    // shootAngle = Math.atan2(mouseY - myPlayer.y, mouseX - myPlayer.x);
    // Por enquanto, use um valor padrão se não estiver usando mouse:
    
    if(attackSent) {
        // Exemplo: atirar para a direita se não houver mira de mouse/gamepad
        shootAngle = 0; 
    }
    
    socket.emit('playerInput', {
        keys: keysToSend,
        shoot: attackSent,
        shootAngle: shootAngle 
    });

    // Resetar o estado de tiro após o envio
    attackSent = false; 
}


// --- Loop Principal do Jogo (AGORA SÓ UM DESENHISTA) ---

function gameLoop(currentTime = 0) {
    if (!gameRunning) return;

    const deltaTime = currentTime - lastFrameTime;
    lastFrameTime = currentTime; 

    // 1. Enviar Input (NOVO)
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
    draw(); // Redesenha a tela com base nos dados que o servidor enviou

    // Atualiza o display GUI, que agora lê de allPlayers
    for(const id in allPlayers) {
        const player = allPlayers[id];
        if (player.headGuiElement) {
            updateHeadGui(player); // Certifique-se que esta função lê o estado do objeto player
            updateHeadGuiPosition(player);
        }
    }
    updateInputStatus(); // Atualiza display de gamepad/teclado

    endGame(); // Verifica se o jogo deve terminar

    requestAnimationFrame(gameLoop);
}

// --- Funções de Desenho (DRAW) ---

function draw() {
    // ... (MANTENHA SUA LÓGICA DE DESENHO DE FUNDO E CÂMERA) ...

    // Desenha Obstáculos
    serverObstacles.forEach(obs => drawObstacle(obs));

    // Desenha Pickups
    for (const id in serverPickups) {
        // ... (Desenhe pickups) ...
    }

    // Desenha Projéteis
    for (const id in serverProjectiles) {
        const proj = serverProjectiles[id];
        drawProjectile(proj); // Adapte sua função drawProjectile para usar os dados do proj
    }

    // Desenha Jogadores
    for (const id in allPlayers) {
        const player = allPlayers[id];
        if (player.isAlive) {
            drawPlayer(player); // Adapte sua função drawPlayer para usar os dados do player
        }
    }
    
    // ... (Desenho de debug, etc.) ...
}


// --- Outras Funções (Manter e adaptar) ---

// MANTENHA SUAS FUNÇÕES:
// - showMessage(text)
// - drawObstacle(obs)
// - drawProjectile(proj) 
// - drawPlayer(player)
// - updateCamera()
// - updateHeadGui(player)
// - updateHeadGuiPosition(player)
// - endGame() <--- Mas adapte para usar 'allPlayers'
// - ... (Todas as outras funções utilitárias e de desenho) ...

// REMOVA SUAS FUNÇÕES:
// - spawnPickup() 
// - generateRandomObstacles()
// - As funções de classe 'Player', 'Projectile', 'Pickup', etc., se você as mantiver no cliente, elas
//   devem ser adaptadas para apenas representar dados do servidor, não ter lógica de 'update()'.