// server.js (SERVIDOR AUTORITÁRIO - 2 JOGADORES, TECLADO)
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

// --- Configurações de Rede e Jogo ---
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });
const PORT = process.env.PORT || 3000;

const MAX_PLAYERS = 2; // Configurado para 2 jogadores
const TICK_RATE = 1000 / 60; // 60 Ticks por segundo
const performance = global.performance || { now: Date.now }; 

// --- Constantes Físicas ---
const CANVAS_WIDTH = 1000;
const CANVAS_HEIGHT = 750;
const PLAYER_SIZE = 30;
const PLAYER_SPEED = 3;
const PLAYER_SPRINT_SPEED_MULTIPLIER = 1.8; // Aumentei a corrida
const ENERGY_COST_SPRINT = 0.8;
const ENERGY_REGEN_RATE = 1.2;
const MAX_HEALTH = 100;
const MAX_ENERGY = 100;
const ARROW_SPEED = 15; // Aumentei a velocidade da flecha
const ARROW_SIZE = 10;
const STARTING_ARROWS = 30;
const PLAYER_COLORS = ['#e74c3c', '#3498db']; // Vermelho para P1, Azul para P2

// --- Blueprints das Armas (Seus 7 Tipos de Arcos) ---
const BOW_BLUEPRINTS = {
    NORMAL: { name: "Arco Normal", damage: 10, attackSpeed: 500, projectileColor: '#8b4513', effect: null },
    COMPOSTO: { name: "Composto", damage: 15, attackSpeed: 700, projectileColor: '#5c6f80', effect: null },
    BESTA: { name: "Besta", damage: 20, attackSpeed: 1200, projectileColor: '#444444', effect: { type: 'slow', duration: 1000, potency: 0.5 } },
    FLAMEJANTE: { name: "Flamejante", damage: 8, attackSpeed: 400, projectileColor: '#e74c3c', effect: { type: 'burn', duration: 3000, tickDamage: 5 } },
    VENENOSO: { name: "Venenoso", damage: 5, attackSpeed: 500, projectileColor: '#2ecc71', effect: { type: 'poison', duration: 5000, tickDamage: 2 } },
    GELO: { name: "Gelo", damage: 10, attackSpeed: 600, projectileColor: '#3498db', effect: { type: 'slow', duration: 2000, potency: 0.5 } },
    GELO_VENENO: { name: "Gelo & Veneno", damage: 7, attackSpeed: 800, projectileColor: '#a97ed6', 
                   effect: { type: 'compound', effects: [ { type: 'slow', duration: 2000, potency: 0.5 }, { type: 'poison', duration: 5000, tickDamage: 2 } ] } 
                }
};

// --- Estado Global do Servidor ---
let gamePlayers = {}; 
let playerCount = 0;
let playerCounter = 1; 
let projectiles = {}; 
let obstacles = []; 
let lastProjectileId = 0;
let lastGameLoopTime = performance.now();

// --- Funções Auxiliares (Colisão e Spawns) ---
function collides(obj1, obj2) {
    // Colisão simples de AABB (Axis-Aligned Bounding Box)
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
    // Encontrar o primeiro slot de jogador disponível
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
    
    // Posição inicial
    const startX = (playerNum === 1) ? 100 : CANVAS_WIDTH - 100 - PLAYER_SIZE;
    const startY = CANVAS_HEIGHT / 2 - PLAYER_SIZE / 2;

    // Inicializa o jogador com o Arco Normal
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

    socket.emit('playerData', { 
        id: playerId, players: gamePlayers, obstacles: obstacles, mapWidth: CANVAS_WIDTH, mapHeight: CANVAS_HEIGHT
    });
    // O servidor usa o socket ID para mapear o player. O cliente usa o ID do player (P1 ou P2)
    socket.join(playerId);
    socket.playerGameId = playerId; // Adiciona o ID do jogo ao socket
    
    io.emit('message', `${gamePlayers[playerId].name} se juntou ao jogo!`);

    socket.on('playerInput', (data) => {
        let player = gamePlayers[socket.playerGameId];
        if (!player || !player.isAlive) return;

        player.input = data.keys; 
        
        // Lógica de Tiro (Autoritária)
        if (data.shoot && player.arrows > 0) {
            const weapon = player.equippedWeapon;
            const now = performance.now();
            
            if (now - weapon.lastAttackTime > weapon.attackSpeed) {
                player.arrows--;
                weapon.lastAttackTime = now;

                const projVx = Math.cos(data.shootAngle) * ARROW_SPEED; 
                const projVy = Math.sin(data.shootAngle) * ARROW_SPEED;
                
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
        
        // Lógica de Troca de Arma (1 a 7)
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


// --- Lógica de Efeitos Elementares (Omitida para Brevidade, Mantenha no seu server.js) ---
function applyEffect(player, effect) { /* ... (mesma lógica) ... */ }
function processStatusEffects(player, now) { /* ... (mesma lógica) ... */ }


// --- Loop Principal do Servidor (Game Loop Autoritário) ---
function gameLoop() {
    const now = performance.now();
    const deltaTime = (now - lastGameLoopTime) / 1000; 
    lastGameLoopTime = now;

    // --- 1. Processamento de Jogadores (Movimento, Energia, Status) ---
    for (const id in gamePlayers) {
        let player = gamePlayers[id];
        if (!player.isAlive) continue;

        // ... (Lógica de Status e Movimento) ...
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

        // Simplesmente move o jogador (sem colisão, para simplificar)
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

    // --- 2. Movimento e Colisão de Projéteis (Omitida para Brevidade) ---
    // ... (Apenas o movimento simples)
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
                // applyEffect(targetPlayer, proj.effect); // Habilite se quiser efeitos
                projectilesToRemove.push(id);
                
                if (targetPlayer.health === 0) {
                    targetPlayer.isAlive = false;
                    io.emit('playerKilled', { targetId: targetPlayer.id, killerId: proj.ownerId });
                }
                break; 
            }
        }
        
        // Limites do Mapa
        if (proj.x < 0 || proj.x > CANVAS_WIDTH || proj.y < 0 || proj.y > CANVAS_HEIGHT) {
            projectilesToRemove.push(id);
        }
    }
    
    projectilesToRemove.forEach(id => delete projectiles[id]);


    // --- 3. Sincronização (Broadcast) ---
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