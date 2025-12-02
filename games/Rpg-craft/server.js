// server.js (game) - serve arquivos do jogo e expõe Socket.IO
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// porta padrão (pode ser sobrescrita por env PORT_GAME)
const PORT = process.env.PORT || process.env.PORT_GAME || 4000;

// Serve apenas os arquivos desta pasta (onde server.js está).
// IMPORTANTE: iniciar este server a partir da pasta do próprio jogo (cd games/Rpg-craft && node server.js)
const PUBLIC_DIR = path.join(__dirname);

// Remove headers que podem bloquear embedding em iframe e define CSP permissiva para frame-ancestors
app.use((req, res, next) => {
  try {
    res.removeHeader('X-Frame-Options');
    // Permitir que outros sites (ex: launcher em outra porta) embutam este jogo
    res.setHeader('Content-Security-Policy', "frame-ancestors *");
  } catch (e) {
    // ignore
  }
  next();
});

// Serve arquivos estáticos (index.html, game.js, assets...)
app.use('/', express.static(PUBLIC_DIR));

// Força servir index.html caso acessem raiz
app.get('/', (req, res) => {
  const indexCandidates = ['index.html', 'render.html', 'game.html', 'main.html'];
  for (const f of indexCandidates) {
    const fp = path.join(PUBLIC_DIR, f);
    if (require('fs').existsSync(fp)) return res.sendFile(fp);
  }
  // fallback: serve diretório estático (lista de arquivos) ou mensagem simples
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'), err => {
    if (err) res.status(404).send('Arquivo de entrada não encontrado.');
  });
});

// Socket.IO
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingInterval: 5000,
  pingTimeout: 10000
});

// --- Exemplo mínimo de lógica do jogo / socket handlers ---
// Substitua esta lógica pelo seu gameLoop / handlers reais.
let players = {};
let projectiles = {};
let obstacles = [];
let pickups = {};
let lastProjectileId = 0;
let lastPickupId = 0;

io.on('connection', (socket) => {
  console.log('socket conectado:', socket.id);

  // Exemplo: envia dados iniciais ao cliente
  socket.emit('playerData', {
    id: socket.id,
    players,
    obstacles,
    pickups,
    mapWidth: 800,
    mapHeight: 600
  });

  socket.on('playerInput', (data) => {
    // trate o input do cliente (keys, shoot, etc.)
    // aqui você integrará sua lógica de movimentação/ação
  });

  socket.on('disconnect', () => {
    console.log('socket desconectou:', socket.id);
    // remover player, notificar outros etc.
    socket.broadcast.emit('playerDisconnected', socket.id);
  });
});

// Exemplo de game loop (ajuste para sua lógica)
const TICK_RATE = 1000 / 60;
let gameLoopInterval = null;

function gameLoop() {
  // Atualize estado do jogo e emita para os clientes
  io.emit('gameStateUpdate', {
    players,
    projectiles,
    pickups
  });
}

function startGameLoop() {
  if (!gameLoopInterval) {
    gameLoopInterval = setInterval(gameLoop, TICK_RATE);
    console.log('Game loop iniciado.');
  }
}

// iniciar server
server.listen(PORT, () => {
  console.log(`Game server rodando em http://localhost:${PORT} (pasta: ${PUBLIC_DIR})`);
  // startGameLoop(); // descomente se quiser iniciar automaticamente
});
