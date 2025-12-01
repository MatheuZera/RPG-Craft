// server.js (SERVIDOR AUTORITÁRIO - 2 JOGADORES, TECLADO, MIRA AUTOMÁTICA)
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

// --- Configurações de Rede e Jogo ---
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });
const PORT = process.env.PORT || 3000;

const MAX_PLAYERS = 2; 
const TICK_RATE = 1000 / 60; 
const performance = global.performance || { now: Date.now }; 

// --- Constantes Físicas ---
const CANVAS_WIDTH = 1000; // Largura do Mundo (Arena)
const CANVAS_HEIGHT = 750; // Altura do Mundo (Arena)
const PLAYER_SIZE = 30;
const PLAYER_SPEED = 3;
const PLAYER_SPRINT_SPEED_MULTIPLIER = 1.8;
const ENERGY_COST_SPRINT = 0.8;
const ENERGY_REGEN_RATE = 1.2;
const MAX_HEALTH = 100;
const MAX_ENERGY = 100;
const ARROW_SPEED = 15;
const ARROW_SIZE = 10;
const STARTING_ARROWS = 30;
const PLAYER_COLORS = ['#e74c3c', '#3498db']; 

// --- Blueprints das Armas (Simplificado) ---
const BOW_BLUEPRINTS = {
    NORMAL: { name: "Arco Normal", damage: 10, attackSpeed: 500, projectileColor: '#8b4513', effect: null },
    // ... (Mantenha as outras armas, se necessário, ou simplifique)
};

// --- Estado Global do Servidor ---
let gamePlayers = {}; 
let playerCount = 0;
let projectiles = {}; 
let obstacles = []; 
let lastProjectileId = 0;
let lastGameLoopTime = performance.now();

// --- Funções Auxiliares (Colisão e Spawns) ---
function collides(obj1, obj2) {
    return obj1.x < obj2.x + obj2.width && obj1.x + obj1.width > obj2.x &&
           obj1.y < obj2.y + obj2.height && obj1.y + obj1.height > obj2.y;
}

function generateInitialObstacles() {
    obstacles.push({ x: 200, y: 200, width: 50, height: 350, color: '#607d8b' });
    obstacles.push({ x: 750, y: 200, width: 50, height: 350, color: '#607d8b' });
    obstacles.push({ x: 400, y: 400, width: 200, height: 50, color: '#607d8b' });
}
generateInitialObstacles(); 

function createWeapon(blueprintKey) {
    const blueprint = BOW_BLUEPRINTS[blueprintKey];
    return {
        name: blueprint.name,
        damage: blueprint.damage,
        attackSpeed: blueprint.attackSpeed,
        projectileColor: blueprint.projectileColor,
        effect: blueprint.effect,
        lastAttackTime: 0
    };
}

// --- Eventos do Socket.IO (Rede) ---
io.on('connection', (socket) => {
    // 1. Determina o slot do jogador (P1 ou P2)
    let playerNum = 0;
    if (!gamePlayers['P1']) {
        playerNum = 1;
    } else if (!gamePlayers['P2']) {
        playerNum = 2;
    }

    if (playerNum === 0) {
        socket.emit('message', `O jogo está cheio. Máximo de ${MAX_PLAYERS} jogadores.`);
        socket.disconnect();
        return;
    }

    const playerId = `P${playerNum}`;
    playerCount++;
    
    // 2. Inicializa o estado do jogador
    const startX = (playerNum === 1) ? 100 : CANVAS_WIDTH - 100 - PLAYER_SIZE;
    const startY = CANVAS_HEIGHT / 2 - PLAYER_SIZE / 2;

    gamePlayers[playerId] = {
        id: playerId,
        name: playerId, 
        playerNum: playerNum,
        x: startX, 
        y: startY,
        width: PLAYER_SIZE,
        height: PLAYER_SIZE,
        color: PLAYER_COLORS[playerNum - 1],
        health: MAX_HEALTH,
        energy: MAX_ENERGY,
        arrows: STARTING_ARROWS,
        isAlive: true,
        status: { slow: { active: false, end: 0, potency: 0 }, burn: { active: false, end: 0, lastTick: 0, damage: 0 }, poison: { active: false, end: 0, lastTick: 0, damage: 0 } },
        equippedWeapon: createWeapon('NORMAL'),
        input: { up: false, down: false, left: false, right: false, sprint: false }
    };

    console.log(`Novo jogador conectado: ${playerId}`);

    // 3. Envia dados iniciais
    socket.emit('playerData', { 
        id: playerId, players: gamePlayers, obstacles: obstacles, mapWidth: CANVAS_WIDTH, mapHeight: CANVAS_HEIGHT
    });
    socket.join(playerId);
    socket.playerGameId = playerId;
    
    io.emit('message', `${gamePlayers[playerId].name} se juntou ao jogo!`);

    // 4. Recebe Input do Cliente
    socket.on('playerInput', (data) => {
        let player = gamePlayers[socket.playerGameId];
        if (!player || !player.isAlive) return;

        player.input = data.keys; 
        
        // --- NOVO: CÁLCULO DE MIRA AUTOMÁTICA (SERVER-SIDE) ---
        const targetId = (player.id === 'P1') ? 'P2' : 'P1';
        const targetPlayer = gamePlayers[targetId];
        let shootAngle = 0;
        
        if (targetPlayer && targetPlayer.isAlive) {
            const dx = targetPlayer.x + targetPlayer.width / 2 - (player.x + player.width / 2);
            const dy = targetPlayer.y + targetPlayer.height / 2 - (player.y + player.height / 2);
            shootAngle = Math.atan2(dy, dx);
        } else {
             // Se não houver alvo (o outro jogador saiu/morreu), atira em uma direção padrão (Leste)
             shootAngle = 0; 
        }

        // 5. Lógica de Tiro (Autoritária)
        if (data.shoot && player.arrows > 0) {
            const weapon = player.equippedWeapon;
            const now = performance.now();
            
            if (now - weapon.lastAttackTime > weapon.attackSpeed) {
                player.arrows--;
                weapon.lastAttackTime = now;

                const projVx = Math.cos(shootAngle) * ARROW_SPEED; 
                const projVy = Math.sin(shootAngle) * ARROW_SPEED;
                
                projectiles[`proj_${lastProjectileId++}`] = {
                    id: `proj_${lastProjectileId}`,
                    ownerId: socket.playerGameId,
                    x: player.x + player.width / 2 - ARROW_SIZE / 2,
                    y: player.y + player.height / 2 - ARROW_SIZE / 2,
                    width: ARROW_SIZE,
                    height: ARROW_SIZE,
                    vx: projVx, 
                    vy: projVy,
                    damage: weapon.damage,
                    color: weapon.projectileColor,
                    effect: weapon.effect
                };
            }
        }
        
        // 6. Lógica de Troca de Arma (1 a 7)
        if (data.switchWeapon) {
            const weaponKeys = Object.keys(BOW_BLUEPRINTS);
            const newWeaponKey = weaponKeys[data.switchWeapon - 1];
            if (newWeaponKey) {
                 player.equippedWeapon = createWeapon(newWeaponKey);
                 io.to(socket.id).emit('message', `Você equipou: ${player.equippedWeapon.name}`);
            }
        }
    });

    socket.on('disconnect', () => {
        const playerIdToRemove = socket.playerGameId;
        const player = gamePlayers[playerIdToRemove];
        if (player) {
            delete gamePlayers[playerIdToRemove];
            playerCount--;
            io.emit('playerDisconnected', playerIdToRemove);
            io.emit('message', `${player.name} saiu do jogo.`);
            console.log(`Jogador desconectado: ${player.name}`);
        }
    });
});


// --- Loop Principal do Servidor (Game Loop Autoritário) ---
function gameLoop() {
    const now = performance.now();
    const deltaTime = (now - lastGameLoopTime) / 1000; 
    lastGameLoopTime = now;

    // 1. Processamento de Jogadores (Movimento e Energia)
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
            const magnitude = Math.sqrt(dx * dx + dy * dy);
            dx /= magnitude;
            dy /= magnitude;
        }

        let currentSpeed = PLAYER_SPEED;
        
        // Lógica de Sprint e Energia
        if (player.input.sprint && player.energy > 0) {
            currentSpeed *= PLAYER_SPRINT_SPEED_MULTIPLIER;
            player.energy = Math.max(0, player.energy - ENERGY_COST_SPRINT); 
        } else {
            player.energy = Math.min(MAX_ENERGY, player.energy + ENERGY_REGEN_RATE); 
        }

        player.x += dx * currentSpeed;
        player.y += dy * currentSpeed;
        
        // Limites do Mapa
        player.x = Math.max(0, Math.min(CANVAS_WIDTH - player.width, player.x));
        player.y = Math.max(0, Math.min(CANVAS_HEIGHT - player.height, player.y));
    }

    // 2. Movimento e Colisão de Projéteis
    let projectilesToRemove = [];
    
    for (const id in projectiles) {
        let proj = projectiles[id];
        proj.x += proj.vx;
        proj.y += proj.vy;
        
        // Colisão com Jogadores
        for (const playerId in gamePlayers) {
            let targetPlayer = gamePlayers[playerId];
            if (targetPlayer.id === proj.ownerId || !targetPlayer.isAlive) continue; 
            
            if (collides(proj, targetPlayer)) {
                targetPlayer.health = Math.max(0, targetPlayer.health - proj.damage);
                projectilesToRemove.push(id);
                
                if (targetPlayer.health === 0) {
                    targetPlayer.isAlive = false;
                    io.emit('playerKilled', { targetId: targetPlayer.id, killerId: proj.ownerId });
                }
                break; 
            }
        }
        
        // Colisão com Obstáculos (Adicionar se necessário)
        // for (const obs of obstacles) {
        //     if (collides(proj, obs)) {
        //         projectilesToRemove.push(id);
        //         break;
        //     }
        // }
        
        // Limites do Mapa
        if (proj.x < 0 || proj.x > CANVAS_WIDTH || proj.y < 0 || proj.y > CANVAS_HEIGHT) {
            projectilesToRemove.push(id);
        }
    }
    
    projectilesToRemove.forEach(id => delete projectiles[id]);


    // 3. Sincronização (Broadcast)
    io.emit('gameStateUpdate', {
        players: gamePlayers,
        projectiles: projectiles,
    });
}

// Inicia o Game Loop
setInterval(gameLoop, TICK_RATE);


// --- Inicia o Servidor HTTP ---
app.use(express.static(path.join(__dirname))); 
server.listen(PORT, () => {
    console.log(`Servidor de Arqueiros iniciado na porta ${PORT}`);
});