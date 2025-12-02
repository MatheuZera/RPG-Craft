// server.js (Rpg-craft) - com header ajustado para permitir embed em iframe
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || process.env.PORT_GAME || 4000;

// Remover cabeçalhos que bloqueiem iframe (X-Frame-Options)
app.use((req, res, next) => {
  try {
    res.removeHeader('X-Frame-Options');
    // opcional: garantir que Content-Security-Policy não bloqueie framing
    // res.setHeader('Content-Security-Policy', "frame-ancestors 'self' http://localhost:3000 http://127.0.0.1:3000;");
  } catch (e) { /* ignore */ }
  next();
});

const PUBLIC_DIR = path.join(__dirname);
app.use('/', express.static(PUBLIC_DIR));

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingInterval: 5000,
  pingTimeout: 10000
});

io.on('connection', (socket) => {
  console.log('socket conectado:', socket.id);

  // você provavelmente tem handlers extras; reaplique-os aqui:
  socket.on('playerInput', (data) => {
    // processa input...
  });

  socket.on('disconnect', () => {
    console.log('socket desconectou:', socket.id);
  });
});

// exemplo de loop (substitua pelo seu)
let gameLoopInterval = null;
const TICK_RATE = 1000 / 60;

function gameLoop() {
  // sua lógica: mover players, colisões, etc.
  // Exemplo simples:
  io.emit('gameStateUpdate', { players: {}, projectiles: {}, pickups: {} });
}

function startGameLoop() {
  if (!gameLoopInterval) {
    gameLoopInterval = setInterval(gameLoop, TICK_RATE);
    console.log('Game loop iniciado.');
  }
}

server.listen(PORT, () => {
  console.log(`Game server rodando em http://localhost:${PORT} (pasta: ${PUBLIC_DIR})`);
  // startGameLoop(); // descomente quando quiser iniciar o loop automaticamente
});
