// server.js
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

// --- Configurações de Rede e Jogo ---
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] }, pingInterval: 5000, pingTimeout: 10000 }); 
const PORT = process.env.PORT || 3000;

const MAX_PLAYERS = 2; // Mantido em 2 (P1/P2)
const TICK_RATE = 1000 / 60; // 60 Ticks por segundo
const performance = global.performance || { now: Date.now }; 

// --- Constantes Físicas e de Jogo ---
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600; 
const PLAYER_SIZE = 30;
const PLAYER_SPEED = 3;
const PLAYER_SPRINT_SPEED_MULTIPLIER = 1.5;
const ENERGY_COST_SPRINT = 0.5;
const ENERGY_REGEN_RATE = 0.8;
const MAX_HEALTH = 100;
const MAX_ENERGY = 100;
const ARROW_SPEED = 10;
const ARROW_SIZE = 10;
const STARTING_ARROWS = 20;
const PLAYER_COLORS = ['#e74c3c', '#3498db']; // Cores para P1 e P2

// NOVAS CONSTANTES PARA RESPAWN E PICKUPS
const RESPAWN_DELAY = 5000; // 5 segundos
const HEAL_AMOUNT = 30;
const HEALING_PICKUP_COLOR = '#2ecc71';
const HEALING_PICKUP_SIZE = 20;
const PICKUP_SPAWN_INTERVAL = 10000; // 10 segundos
const MAX_PICKUPS = 2;


// --- Blueprints das Armas (Com classe CSS para o cliente) ---
const BOW_BLUEPRINTS = {
    NORMAL: { name: "Arco Normal", damage: 10, attackSpeed: 500, projectileColor: '#8b4513', effect: null, cssClass: 'bow-normal' },
    COMPOSTO: { name: "Arco Composto", damage: 15, attackSpeed: 700, projectileColor: '#5c6f80', effect: null, cssClass: 'bow-composto' },
    BESTA: { name: "Besta", damage: 20, attackSpeed: 1200, projectileColor: '#444444', effect: null, cssClass: 'bow-besta' },
    LONGBOW: { name: "Long Bow", damage: 12, attackSpeed: 600, projectileColor: '#b8860b', effect: null, cssClass: 'bow-longbow' },
    SHORTBOW: { name: "Short Bow", damage: 8, attackSpeed: 350, projectileColor: '#9acd32', effect: null, cssClass: 'bow-shortbow' },
    IMPACTO: { name: "Arco de Impacto", damage: 14, attackSpeed: 800, projectileColor: '#ff4500', effect: 'stun', cssClass: 'bow-impacto' },
    GELO: { name: "Arco de Gelo", damage: 9, attackSpeed: 450, projectileColor: '#add8e6', effect: 'slow', cssClass: 'bow-gelo' },
};


// --- Estado Global do Servidor ---
let gamePlayers = {}; 
let playerCount = 0;
let projectiles = {}; 
let obstacles = []; 
let pickups = {}; // NOVO: Objeto para rastrear pickups de cura
let lastProjectileId = 0;
let lastPickupId = 0;
let gameLoopInterval = null; 
let lastPickupSpawnTime = performance.now();


// --- Funções Auxiliares (Colisão e Spawns) ---
function collides(obj1, obj2) {
    return obj1.x < obj2.x + obj2.width && obj1.x + obj1.width > obj2.x &&
           obj1.y < obj2.y + obj2.height && obj1.y + obj1.height > obj2.y;
}

function generateInitialObstacles() {
    obstacles = []; 
    obstacles.push({ x: 150, y: 100, width: 50, height: 350, color: '#607d8b', type: 'wall' });
    obstacles.push({ x: 600, y: 100, width: 50, height: 350, color: '#607d8b', type: 'wall' });
    obstacles.push({ x: 300, y: 250, width: 200, height: 50, color: '#607d8b', type: 'wall' });
}
generateInitialObstacles(); 

function createWeapon(blueprintKey) {
    const blueprint = BOW_BLUEPRINTS[blueprintKey];
    if (!blueprint) return createWeapon('NORMAL'); 
    return {
        name: blueprint.name,
        damage: blueprint.damage,
        attackSpeed: blueprint.attackSpeed,
        projectileColor: blueprint.projectileColor,
        effect: blueprint.effect,
        cssClass: blueprint.cssClass, 
        lastAttackTime: 0
    };
}

function getRespawnPosition(playerNum) {
    const startX = (playerNum === 1) ? 100 : CANVAS_WIDTH - 100 - PLAYER_SIZE;
    const startY = CANVAS_HEIGHT / 2 - PLAYER_SIZE / 2;
    return { x: startX, y: startY };
}

function spawnPickup() {
    if (Object.keys(pickups).length >= MAX_PICKUPS) return;

    const type = 'healing';
    const x = Math.random() * (CANVAS_WIDTH - HEALING_PICKUP_SIZE);
    const y = Math.random() * (CANVAS_HEIGHT - HEALING_PICKUP_SIZE);

    // Ignora se colidir com paredes (simples)
    if (obstacles.some(obs => collides({ x: x, y: y, width: HEALING_PICKUP_SIZE, height: HEALING_PICKUP_SIZE }, obs))) {
        return; 
    }

    const pickupId = `p_${lastPickupId++}`;
    pickups[pickupId] = {
        id: pickupId,
        type: type,
        x: x,
        y: y,
        width: HEALING_PICKUP_SIZE,
        height: HEALING_PICKUP_SIZE,
        color: HEALING_PICKUP_COLOR,
        value: HEAL_AMOUNT
    };
}

// --- Gerenciamento do Game Loop ---
function startGameLoop() {
    if (!gameLoopInterval) {
        console.log("Iniciando Game Loop...");
        gameLoopInterval = setInterval(gameLoop, TICK_RATE);
    }
}

function stopAndResetGame() {
    if (gameLoopInterval) {
        clearInterval(gameLoopInterval);
        gameLoopInterval = null;
        
        gamePlayers = {}; 
        projectiles = {};
        pickups = {}; 
        lastProjectileId = 0;
        lastPickupId = 0;
        
        console.log("Game Loop parado. Resetando estado do jogo.");
        io.emit('gameReset', 'O servidor reiniciou por inatividade. Recarregue para uma nova partida.');
    }
}
// ---------------------------------------------------------------


// --- Eventos do Socket.IO (Rede) ---
io.on('connection', (socket) => {
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
    console.log(`Novo jogador conectado: ${playerId}. Total: ${playerCount}`);
    
    if (playerCount === 1) {
        startGameLoop();
    }
    
    const startPos = getRespawnPosition(playerNum);

    gamePlayers[playerId] = {
        id: playerId,
        name: playerId, 
        playerNum: playerNum,
        x: startPos.x, 
        y: startPos.y,
        width: PLAYER_SIZE,
        height: PLAYER_SIZE,
        color: PLAYER_COLORS[playerNum - 1],
        health: MAX_HEALTH,
        energy: MAX_ENERGY,
        arrows: STARTING_ARROWS,
        isAlive: true,
        isDead: false, // Flag para morte/respawn
        respawnStartTime: 0, // Timestamp para respawn
        input: { up: false, down: false, left: false, right: false, sprint: false },
        equippedWeapon: createWeapon('NORMAL'),
    };

    socket.emit('playerData', { 
        id: playerId, players: gamePlayers, obstacles: obstacles, pickups: pickups, mapWidth: CANVAS_WIDTH, mapHeight: CANVAS_HEIGHT
    });
    socket.join(playerId);
    socket.playerGameId = playerId;
    
    io.emit('message', `${gamePlayers[playerId].name} se juntou ao jogo!`);

    socket.on('playerInput', (data) => {
        let player = gamePlayers[socket.playerGameId];
        if (!player || player.isDead) return; // Impede input se o player estiver morto/respawnando

        player.input = data.keys; 
        
        // CÁLCULO DE MIRA AUTOMÁTICA
        const targetId = (player.id === 'P1') ? 'P2' : 'P1';
        const targetPlayer = gamePlayers[targetId];
        let shootAngle = 0;
        
        if (targetPlayer && targetPlayer.isAlive) {
            const dx = targetPlayer.x + targetPlayer.width / 2 - (player.x + player.width / 2);
            const dy = targetPlayer.y + targetPlayer.height / 2 - (player.y + player.height / 2);
            shootAngle = Math.atan2(dy, dx);
        }

        // Lógica de Tiro
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
        
        // Lógica de Troca de Arma (1-7)
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
            console.log(`Jogador desconectado: ${player.name}. Total: ${playerCount}`);
        }
        
        if (playerCount === 0) {
            stopAndResetGame();
        }
    });
});


// --- Loop Principal do Servidor (Game Loop Autoritário) ---
function gameLoop() {
    const now = performance.now();

    // 0. Spawna Pickups
    if (now - lastPickupSpawnTime > PICKUP_SPAWN_INTERVAL) {
        spawnPickup();
        lastPickupSpawnTime = now;
    }

    // 1. Processamento de Jogadores (Movimento, Energia, Respawn)
    for (const id in gamePlayers) {
        let player = gamePlayers[id];
        
        // Lógica de Respawn
        if (player.isDead) {
            if (now - player.respawnStartTime >= RESPAWN_DELAY) {
                const respawnPos = getRespawnPosition(player.playerNum);
                player.x = respawnPos.x;
                player.y = respawnPos.y;
                player.health = MAX_HEALTH;
                player.energy = MAX_ENERGY;
                player.arrows = STARTING_ARROWS;
                player.isDead = false;
                player.isAlive = true;
                io.emit('message', `${player.name} retornou ao combate!`);
            } else {
                continue; // Pula o resto da lógica (movimento, pickups) se estiver morto
            }
        }
        
        // Movimento
        let dx = 0;
        let dy = 0;
        if (player.input.up) dy = -1;
        if (player.input.down) dy = 1;
        if (player.input.left) dx = -1;
        if (player.input.right) dx = 1;

        if (dx !== 0 || dy !== 0) {
            const magnitude = Math.sqrt(dx * dx + dy * dy);
            dx /= magnitude;
            dy /= magnitude;
        }

        let currentSpeed = PLAYER_SPEED;
        
        // Sprint e Energia
        if (player.input.sprint && player.energy > 0) {
            currentSpeed *= PLAYER_SPRINT_SPEED_MULTIPLIER;
            player.energy = Math.max(0, player.energy - ENERGY_COST_SPRINT); 
        } else {
            player.energy = Math.min(MAX_ENERGY, player.energy + ENERGY_REGEN_RATE * 0.5); 
        }

        // Aplica o movimento
        player.x += dx * currentSpeed;
        player.y += dy * currentSpeed;
        
        // Limites do mapa
        player.x = Math.max(0, Math.min(CANVAS_WIDTH - player.width, player.x));
        player.y = Math.max(0, Math.min(CANVAS_HEIGHT - player.height, player.y));

        // 2. Colisão com Pickups (CURA)
        let pickupToRemove = null;
        for (const pid in pickups) {
            const pickup = pickups[pid];
            if (collides(player, pickup)) {
                if (pickup.type === 'healing') {
                    const oldHealth = player.health;
                    player.health = Math.min(MAX_HEALTH, player.health + pickup.value);
                    if (player.health > oldHealth) {
                        io.emit('message', `${player.name} se curou em ${pickup.value} HP!`);
                        io.to(player.id).emit('visualEffect', { type: 'healFlash', amount: pickup.value });
                    }
                }
                pickupToRemove = pid;
                break;
            }
        }
        if (pickupToRemove) {
            delete pickups[pickupToRemove];
        }

    }

    // 3. Movimento e Colisão de Projéteis
    let projectilesToRemove = [];
    
    for (const id in projectiles) {
        let proj = projectiles[id];
        proj.x += proj.vx;
        proj.y += proj.vy;
        
        // Colisão com Jogadores
        for (const playerId in gamePlayers) {
            let targetPlayer = gamePlayers[playerId];
            if (targetPlayer.id === proj.ownerId || targetPlayer.isDead) continue; 
            
            if (collides(proj, targetPlayer)) {
                const damageTaken = proj.damage;
                targetPlayer.health = Math.max(0, targetPlayer.health - damageTaken);
                projectilesToRemove.push(id);
                
                // Efeito Visual de Dano (Envia apenas para o jogador que levou o dano)
                io.to(targetPlayer.id).emit('visualEffect', { type: 'damageFlash', amount: damageTaken });

                if (targetPlayer.health === 0) {
                    targetPlayer.isAlive = false;
                    targetPlayer.isDead = true; 
                    targetPlayer.respawnStartTime = now;
                    io.emit('playerKilled', { targetId: targetPlayer.id, killerId: proj.ownerId });
                }
                break; 
            }
        }
        
        // Colisão com Limites (fora da tela)
        if (proj.x < -20 || proj.x > CANVAS_WIDTH + 20 || proj.y < -20 || proj.y > CANVAS_HEIGHT + 20) {
            projectilesToRemove.push(id);
        }
    }
    
    projectilesToRemove.forEach(id => delete projectiles[id]);

    // 4. Sincronização (Broadcast)
    io.emit('gameStateUpdate', {
        players: gamePlayers,
        projectiles: projectiles,
        pickups: pickups // Envia pickups para o cliente
    });
}


// --- Inicia o Servidor HTTP ---
app.use(express.static(path.join(__dirname))); 
server.listen(PORT, () => {
    console.log(`Servidor de Arqueiros iniciado na porta ${PORT}`);
});