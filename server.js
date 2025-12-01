// server.js (SERVIDOR AUTORITÁRIO - 6 JOGADORES, 7 ARCOS)
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

// --- Configurações de Rede e Jogo ---
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });
const PORT = process.env.PORT || 3000;

const MAX_PLAYERS = 6;
const TICK_RATE = 1000 / 60; // 60 Ticks por segundo
const performance = global.performance || { now: Date.now }; 

// --- Constantes Físicas ---
const CANVAS_WIDTH = 1200; // Mapa maior para 6 jogadores
const CANVAS_HEIGHT = 900;
const PLAYER_SIZE = 30;
const PLAYER_SPEED = 3;
const PLAYER_SPRINT_SPEED_MULTIPLIER = 1.5;
const ENERGY_COST_SPRINT = 0.5;
const ENERGY_REGEN_RATE = 0.8;
const MAX_HEALTH = 100;
const MAX_ENERGY = 100;
const ARROW_SPEED = 12;
const ARROW_SIZE = 10;
const STARTING_ARROWS = 30;
const PLAYER_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#1abc9c'];

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
let pickups = {}; 
let lastProjectileId = 0;
let lastGameLoopTime = performance.now();

// --- Funções Auxiliares (Colisão e Spawns) ---
function collides(obj1, obj2) {
    return obj1.x < obj2.x + obj2.width && obj1.x + obj1.width > obj2.x &&
           obj1.y < obj2.y + obj2.height && obj1.y + obj1.height > obj2.y;
}

function generateInitialObstacles() {
    obstacles.push({ x: 200, y: 200, width: 100, height: 200, color: '#607d8b', type: 'wall' });
    obstacles.push({ x: 800, y: 100, width: 200, height: 50, color: '#607d8b', type: 'wall' });
    obstacles.push({ x: 500, y: 500, width: 50, height: 300, color: '#607d8b', type: 'wall' });
    obstacles.push({ x: 900, y: 650, width: 150, height: 150, color: '#607d8b', type: 'wall' });
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
    if (playerCount >= MAX_PLAYERS) {
        socket.emit('message', `O jogo está cheio. Máximo de ${MAX_PLAYERS} jogadores.`);
        socket.disconnect();
        return;
    }

    const playerId = socket.id;
    playerCount++;
    const playerNum = playerCounter++;
    
    // Inicializa o jogador com o Arco Normal
    gamePlayers[playerId] = {
        id: playerId,
        name: `P${playerNum}`, 
        x: Math.random() * (CANVAS_WIDTH - PLAYER_SIZE), 
        y: Math.random() * (CANVAS_HEIGHT - PLAYER_SIZE),
        width: PLAYER_SIZE,
        height: PLAYER_SIZE,
        color: PLAYER_COLORS[playerNum - 1] || '#ccc',
        health: MAX_HEALTH,
        energy: MAX_ENERGY,
        arrows: STARTING_ARROWS,
        isAlive: true,
        // Efeitos de Status (Slow, Poison, Burn)
        status: { slow: { active: false, end: 0, potency: 0 }, burn: { active: false, end: 0, lastTick: 0, damage: 0 }, poison: { active: false, end: 0, lastTick: 0, damage: 0 } },
        equippedWeapon: createWeapon('NORMAL'),
        input: { up: false, down: false, left: false, right: false, sprint: false }
    };

    console.log(`Novo jogador conectado: P${playerNum}`);

    socket.emit('playerData', { 
        id: playerId, players: gamePlayers, obstacles: obstacles, mapWidth: CANVAS_WIDTH, mapHeight: CANVAS_HEIGHT
    });
    io.emit('message', `${gamePlayers[playerId].name} se juntou ao jogo!`);

    socket.on('playerInput', (data) => {
        let player = gamePlayers[playerId];
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
                    ownerId: playerId,
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
        
        // Lógica de Troca de Arma (ex: pressionar 1, 2, 3...)
        if (data.switchWeapon) {
            const weaponKeys = Object.keys(BOW_BLUEPRINTS);
            const newWeaponKey = weaponKeys[data.switchWeapon - 1];
            if (newWeaponKey) {
                 player.equippedWeapon = createWeapon(newWeaponKey);
                 io.to(playerId).emit('message', `Você equipou: ${player.equippedWeapon.name}`);
            }
        }
    });

    socket.on('disconnect', () => {
        const player = gamePlayers[playerId];
        if (player) {
            delete gamePlayers[playerId];
            playerCount--;
            io.emit('playerDisconnected', playerId);
            io.emit('message', `${player.name} saiu do jogo.`);
            // Lógica de Fim de Jogo aqui...
        }
    });
});


// --- Lógica de Efeitos Elementares ---
function applyEffect(player, effect) {
    if (!effect) return;

    if (effect.type === 'compound') {
        effect.effects.forEach(e => applyEffect(player, e));
        return;
    }

    const now = performance.now();
    const endTime = now + effect.duration;

    if (effect.type === 'slow') {
        player.status.slow.active = true;
        player.status.slow.end = Math.max(player.status.slow.end, endTime);
        player.status.slow.potency = effect.potency;
    } else if (effect.type === 'poison') {
        player.status.poison.active = true;
        player.status.poison.end = Math.max(player.status.poison.end, endTime);
        player.status.poison.damage = effect.tickDamage;
        player.status.poison.lastTick = now;
    } else if (effect.type === 'burn') {
        player.status.burn.active = true;
        player.status.burn.end = Math.max(player.status.burn.end, endTime);
        player.status.burn.damage = effect.tickDamage;
        player.status.burn.lastTick = now;
    }
}

function processStatusEffects(player, now) {
    // 1. Lógica de Lentidão (Slow)
    if (player.status.slow.active && now > player.status.slow.end) {
        player.status.slow.active = false;
        player.status.slow.potency = 0;
    }

    // 2. Lógica de Dano por Tempo (Poison/Burn)
    ['poison', 'burn'].forEach(effectType => {
        const effect = player.status[effectType];
        if (effect.active) {
            if (now > effect.end) {
                effect.active = false;
            } else if (now - effect.lastTick >= 1000) { // Ticks a cada 1 segundo
                player.health = Math.max(0, player.health - effect.damage);
                effect.lastTick = now;
                // Emitir feedback de dano para o cliente se desejar
            }
        }
    });
}


// --- Loop Principal do Servidor (Game Loop Autoritário) ---
function gameLoop() {
    const now = performance.now();
    const deltaTime = (now - lastGameLoopTime) / 1000; 
    lastGameLoopTime = now;

    // --- 1. Processamento de Jogadores ---
    for (const id in gamePlayers) {
        let player = gamePlayers[id];
        if (!player.isAlive) continue;

        // Aplica Efeitos de Status (Dano e Limpeza)
        processStatusEffects(player, now);

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

        // Calcula a velocidade base, aplicando o Slow se ativo
        let currentSpeed = PLAYER_SPEED;
        if (player.status.slow.active) {
             currentSpeed *= (1 - player.status.slow.potency); // Ex: 1 - 0.5 = 0.5x velocidade
        }
        
        // Lógica de Sprint e Energia
        if (player.input.sprint && player.energy > 0) {
            currentSpeed *= PLAYER_SPRINT_SPEED_MULTIPLIER;
            player.energy = Math.max(0, player.energy - ENERGY_COST_SPRINT * 60 / 60); // Gasto constante
        } else {
            player.energy = Math.min(MAX_ENERGY, player.energy + ENERGY_REGEN_RATE * 60 / 60); // Regeneração
        }

        let newX = player.x + dx * currentSpeed;
        let newY = player.y + dy * currentSpeed;

        // Colisão com Obstáculos e Limites (lógica removida para brevidade, mas deve ser implementada)
        // ... (Apenas para o player, projéteis serão tratados abaixo)

        player.x = newX;
        player.y = newY;
        
        // Limites do Mapa
        player.x = Math.max(0, Math.min(CANVAS_WIDTH - player.width, player.x));
        player.y = Math.max(0, Math.min(CANVAS_HEIGHT - player.height, player.y));
    }

    // --- 2. Movimento e Colisão de Projéteis ---
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
                // Aplica dano
                targetPlayer.health = Math.max(0, targetPlayer.health - proj.damage);
                
                // Aplica Efeito Elemental
                if (proj.effect) {
                    applyEffect(targetPlayer, proj.effect);
                }
                
                projectilesToRemove.push(id);
                
                if (targetPlayer.health === 0) {
                    targetPlayer.isAlive = false;
                    io.emit('playerKilled', { targetId: targetPlayer.id, killerId: proj.ownerId });
                }
                break; 
            }
        }
        
        // Colisão com Obstáculos e Limites (remover projéteis)
        // ...
        if (proj.x < 0 || proj.x > CANVAS_WIDTH || proj.y < 0 || proj.y > CANVAS_HEIGHT) {
            projectilesToRemove.push(id);
        }
    }
    
    projectilesToRemove.forEach(id => delete projectiles[id]);

    // --- 3. Sincronização (Broadcast) ---
    io.emit('gameStateUpdate', {
        players: gamePlayers,
        projectiles: projectiles,
        pickups: pickups // Deixei pickups no código, se você quiser adicionar logicamente depois.
    });
}

// Inicia o Game Loop
setInterval(gameLoop, TICK_RATE);


// --- Inicia o Servidor HTTP ---
app.use(express.static(path.join(__dirname))); 
server.listen(PORT, () => {
    console.log(`Servidor de Arqueiros iniciado na porta ${PORT}`);
});