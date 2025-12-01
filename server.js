// server.js
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

// --- Configurações do Servidor ---
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 4;
const TICK_RATE = 1000 / 30; // O servidor atualiza o estado 30 vezes por segundo (30 FPS)

// --- Constantes do Jogo (Migradas de game.js) ---
const CANVAS_WIDTH = 800; 
const CANVAS_HEIGHT = 600; 
const PLAYER_SIZE = 30;
const PLAYER_SPEED = 3;
const PLAYER_SPRINT_SPEED_MULTIPLIER = 1.5;
const ENERGY_COST_SPRINT = 0.5;
const ENERGY_REGEN_RATE = 0.8;
const MAX_HEALTH = 100;
const MAX_ENERGY = 100;
const STARTING_ARROWS = 20;
const ARROW_SPEED = 10;
const ARROW_SIZE = 10;
const BOW_BLUEPRINTS = {
    LONGBOW: { name: "Arco Longo", damage: 15, attackSpeed: 600, durability: 50, projectileColor: '#8b4513' },
    SHORTBOW: { name: "Arco Curto", damage: 10, attackSpeed: 300, durability: 70, projectileColor: '#5cb85c' }
    // ... adicione as outras blueprints aqui (CROSSBOW, RECURVEBOW, COMPOUNDBOW)
};

// --- Estado Global do Servidor ---
let gamePlayers = {}; 
let playerCount = 0;
let playerCounter = 1; 
let projectiles = {}; 
let obstacles = []; // Obstáculos agora são gerenciados pelo servidor
let pickups = {}; // Pickups agora são gerenciados pelo servidor

// Função utilitária para ID
let lastProjectileId = 0;
function getNewProjectileId() {
    return `proj_${lastProjectileId++}_${Date.now()}`;
}

// Inicializa a lógica de Game Loop
let lastGameLoopTime = performance.now();


// --- Funções de Lógica (Migradas de game.js) ---

function collides(obj1, obj2) {
    return obj1.x < obj2.x + obj2.width &&
           obj1.x + obj1.width > obj2.x &&
           obj1.y < obj2.y + obj2.height &&
           obj1.y + obj1.height > obj2.y;
}

function createWeaponFromBlueprint(blueprint) {
    // Cria um objeto simples para representar a arma no servidor
    return {
        name: blueprint.name,
        damage: blueprint.damage,
        attackSpeed: blueprint.attackSpeed,
        durability: blueprint.durability,
        projectileColor: blueprint.projectileColor,
        lastAttackTime: 0
    };
}

// Simples geração de obstáculos (para ter algo no mapa)
function generateInitialObstacles() {
    obstacles.push({ x: 250, y: 250, width: 50, height: 100, color: '#95a5a6' });
    obstacles.push({ x: 500, y: 100, width: 150, height: 30, color: '#95a5a6' });
}
generateInitialObstacles(); // Cria obstáculos ao iniciar o servidor

// --- Roteamento e Inicialização ---
app.use(express.static(path.join(__dirname))); 

// --- Eventos do Socket.IO (Rede) ---
io.on('connection', (socket) => {
    
    // 1. Limite de Jogadores
    if (playerCount >= MAX_PLAYERS) {
        socket.emit('message', 'O jogo está cheio. Máximo de 4 jogadores.');
        socket.disconnect();
        return;
    }

    // 2. Novo Jogador Conectado
    const playerId = socket.id;
    playerCount++;
    const playerNum = playerCounter++;
    
    gamePlayers[playerId] = {
        id: playerId,
        name: `P${playerNum}`, 
        x: Math.random() * (CANVAS_WIDTH - PLAYER_SIZE), // Posição inicial aleatória
        y: Math.random() * (CANVAS_HEIGHT - PLAYER_SIZE),
        width: PLAYER_SIZE,
        height: PLAYER_SIZE,
        color: ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f'][playerNum - 1] || '#ccc',
        health: MAX_HEALTH,
        energy: MAX_ENERGY,
        arrows: STARTING_ARROWS,
        isAlive: true,
        // Arma inicial
        equippedWeapon: createWeaponFromBlueprint(BOW_BLUEPRINTS.LONGBOW),
        // Estado de input do cliente
        input: { up: false, down: false, left: false, right: false, sprint: false }
    };

    console.log(`Novo jogador conectado: ${gamePlayers[playerId].name} (ID: ${playerId})`);

    // Envia o estado inicial para o novo jogador
    socket.emit('playerData', { 
        id: playerId, 
        players: gamePlayers,
        obstacles: obstacles // Envia obstáculos para o cliente desenhar
    });

    // Informa aos outros jogadores que um novo jogador entrou
    socket.broadcast.emit('message', `${gamePlayers[playerId].name} se juntou ao jogo!`);


    // 3. Recebe Ações do Jogador (Input)
    socket.on('playerInput', (data) => {
        let player = gamePlayers[playerId];
        if (!player || !player.isAlive) return;

        // Atualiza o estado das teclas
        player.input = data.keys; 

        // Lógica de ataque (Autoritária no servidor)
        if (data.shoot && player.arrows > 0) {
            const weapon = player.equippedWeapon;
            const now = performance.now();
            
            // Verifica cooldown da arma
            if (now - weapon.lastAttackTime > weapon.attackSpeed) {
                player.arrows--;
                weapon.lastAttackTime = now;

                // Cria o projétil no estado do servidor
                const projVx = Math.cos(data.shootAngle) * ARROW_SPEED; 
                const projVy = Math.sin(data.shootAngle) * ARROW_SPEED;
                
                projectiles[getNewProjectileId()] = {
                    id: getNewProjectileId(),
                    ownerId: playerId,
                    x: player.x + player.width / 2 - ARROW_SIZE / 2,
                    y: player.y + player.height / 2 - ARROW_SIZE / 2,
                    width: ARROW_SIZE,
                    height: ARROW_SIZE,
                    vx: projVx, 
                    vy: projVy,
                    damage: weapon.damage,
                    color: weapon.projectileColor
                };
                
                // Diminui a durabilidade da arma
                if (weapon.durability > 0) {
                    weapon.durability--;
                }
                
                // Lógica de arma quebrada (Ainda precisa de lógica de respawn/default weapon)
            }
        }
    });

    // 4. Desconexão
    socket.on('disconnect', () => {
        const player = gamePlayers[playerId];
        if (player) {
            console.log(`Jogador desconectado: ${player.name}`);
            delete gamePlayers[playerId];
            playerCount--;
            io.emit('playerDisconnected', playerId);
            io.emit('message', `${player.name} saiu do jogo.`);
        }
    });
});

// --- Loop Principal do Servidor (Game Loop Autoritário) ---
function gameLoop() {
    const now = performance.now();
    const deltaTime = (now - lastGameLoopTime) / 1000; // Tempo em segundos
    lastGameLoopTime = now;

    // --- 1. Movimento dos Jogadores ---
    for (const id in gamePlayers) {
        let player = gamePlayers[id];
        if (!player.isAlive) continue;

        let dx = 0;
        let dy = 0;
        
        if (player.input.up) dy = -1;
        if (player.input.down) dy = 1;
        if (player.input.left) dx = -1;
        if (player.input.right) dx = 1;

        if (dx !== 0 && dy !== 0) {
            // Normalização para movimento diagonal
            const magnitude = Math.sqrt(dx * dx + dy * dy);
            dx /= magnitude;
            dy /= magnitude;
        }

        let currentSpeed = PLAYER_SPEED;
        
        // Lógica de Sprint e Energia
        if (player.input.sprint && player.energy > 0) {
            currentSpeed *= PLAYER_SPRINT_SPEED_MULTIPLIER;
            player.energy = Math.max(0, player.energy - ENERGY_COST_SPRINT * deltaTime * 60); // Ajuste pela taxa
        } else {
            player.energy = Math.min(MAX_ENERGY, player.energy + ENERGY_REGEN_RATE * deltaTime * 60); // Ajuste pela taxa
        }

        let newX = player.x + dx * currentSpeed;
        let newY = player.y + dy * currentSpeed;

        // Colisão com Obstáculos (Autoritária)
        let canMoveX = true;
        let canMoveY = true;
        
        const futureRectX = { x: newX, y: player.y, width: player.width, height: player.height };
        const futureRectY = { x: player.x, y: newY, width: player.width, height: player.height };

        for (const obs of obstacles) {
            if (collides(futureRectX, obs)) { canMoveX = false; }
            if (collides(futureRectY, obs)) { canMoveY = false; }
        }

        if (canMoveX) player.x = newX;
        if (canMoveY) player.y = newY;

        // Limites do Mapa
        player.x = Math.max(0, Math.min(CANVAS_WIDTH - player.width, player.x));
        player.y = Math.max(0, Math.min(CANVAS_HEIGHT - player.height, player.y));
    }

    // --- 2. Movimento e Colisão de Projéteis ---
    let projectilesToRemove = [];
    
    for (const id in projectiles) {
        let proj = projectiles[id];
        
        // Movimento
        proj.x += proj.vx;
        proj.y += proj.vy;
        
        // Colisão com Jogadores
        for (const playerId in gamePlayers) {
            let targetPlayer = gamePlayers[playerId];
            if (targetPlayer.id === proj.ownerId || !targetPlayer.isAlive) continue; // Não atinge a si mesmo
            
            if (collides(proj, targetPlayer)) {
                targetPlayer.health = Math.max(0, targetPlayer.health - proj.damage);
                projectilesToRemove.push(id);
                
                // Verifica morte
                if (targetPlayer.health === 0) {
                    targetPlayer.isAlive = false;
                    io.emit('playerKilled', { targetId: targetPlayer.id, killerId: proj.ownerId });
                    io.emit('message', `${targetPlayer.name} foi derrotado por ${gamePlayers[proj.ownerId].name}!`);
                    // Verifica fim de jogo
                    const aliveCount = Object.values(gamePlayers).filter(p => p.isAlive).length;
                    if (aliveCount <= 1) {
                        io.emit('gameOver', Object.values(gamePlayers).find(p => p.isAlive)?.id);
                    }
                }
                break; 
            }
        }
        
        // Colisão com Obstáculos
        for (const obs of obstacles) {
            if (collides(proj, obs)) {
                projectilesToRemove.push(id);
                break;
            }
        }
        
        // Limites do Mapa
        if (proj.x < 0 || proj.x > CANVAS_WIDTH || proj.y < 0 || proj.y > CANVAS_HEIGHT) {
            projectilesToRemove.push(id);
        }
    }
    
    // Remove projéteis da lista
    projectilesToRemove.forEach(id => {
        delete projectiles[id];
    });

    // --- 3. Sincronização (Broadcast) ---
    io.emit('gameStateUpdate', {
        players: gamePlayers,
        projectiles: projectiles,
        pickups: pickups // Implementação futura de Pickups
    });
}

// Inicia o Game Loop (executa a cada TICK_RATE ms)
setInterval(gameLoop, TICK_RATE);


// --- Inicia o Servidor HTTP ---
server.listen(PORT, () => {
    console.log(`Servidor de jogo iniciado na porta ${PORT}`);
});