// server.js (versão segura para ficar dentro de games/<nome>/)
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// porta padrão distinta para cada game-server (evita conflito com launcher)
const PORT = process.env.PORT || process.env.PORT_GAME || 4000;

// Serve apenas os arquivos desta pasta (onde server.js está).
// IMPORTANTE: certifique-se de iniciar este server a partir da pasta do próprio jogo
// (cd games/Rpg-craft && node server.js) para que __dirname aponte para a pasta do jogo.
const PUBLIC_DIR = path.join(__dirname); // confinado à pasta do jogo
app.use('/', express.static(PUBLIC_DIR));

// configurações do socket.io
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingInterval: 5000,
  pingTimeout: 10000
});

// (aqui vem toda a lógica do jogo exatamente como você já tem)
// --- exemplo reduzido para manter a estrutura ---
// --- substitua/cole sua lógica de game loop/socket aqui (a sua file antiga) ---
const MAX_PLAYERS = 2;
const TICK_RATE = 1000 / 60;
const performanceNow = global.performance ? global.performance.now : Date.now;

let gamePlayers = {};
let projectiles = {};
let obstacles = [];
let pickups = {};
let lastProjectileId = 0;
let lastPickupId = 0;
let gameLoopInterval = null;

// exemplo de listeners (mantenha os seus)
io.on('connection', (socket) => {
  // coloque aqui a sua lógica de associação de jogador, eventos playerInput, etc.
  console.log('socket conectado:', socket.id);
  socket.on('disconnect', () => {
    console.log('socket desconectou:', socket.id);
  });
});

// game loop simples (substitua pelo seu gameLoop)
function gameLoop() {
  // lógica do jogo...
  io.emit('gameStateUpdate', { /*...*/ });
}

function startGameLoop() {
  if (!gameLoopInterval) {
    gameLoopInterval = setInterval(gameLoop, TICK_RATE);
    console.log('Game loop iniciado.');
  }
}

server.listen(PORT, () => {
  console.log(`Game server rodando em http://localhost:${PORT} (pasta: ${PUBLIC_DIR})`);
  // opcional: startGameLoop(); -- inicie o loop quando apropriado
});
