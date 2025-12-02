// server.js - servidor principal (raiz)
// - Serve o launcher (public/) em /
// - Serve os jogos estáticos em /game/<nome>/ (pasta ./games/<nome>/)
// - Fornece Socket.IO com namespaces dinâmicos para /game/<nome>
// - Middleware para permitir embed (iframe) das páginas dos jogos

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Porta do servidor principal (launcher + socket)
const PORT = process.env.PORT || 3000;

// Pastas
const ROOT = path.join(__dirname);
const PUBLIC_DIR = path.join(ROOT, 'public'); // launcher UI
const GAMES_DIR = path.join(ROOT, 'games');   // subpastas com jogos

// Servir arquivos do launcher (ex: public/launcher.html)
if (fs.existsSync(PUBLIC_DIR)) {
  app.use('/', express.static(PUBLIC_DIR));
} else {
  console.warn('Atenção: pasta public/ não encontrada. Crie public/ com launcher.html etc.');
}

// Permitir embeding / remover header para rotas /game/*
app.use('/game', (req, res, next) => {
  try {
    res.removeHeader('X-Frame-Options');
    // Mais permissivo: permitir qualquer origem embutir (troque por origens específicas se quiser)
    res.setHeader('Content-Security-Policy', "frame-ancestors *");
  } catch (e) { /* ignore */ }
  next();
});

// Servir jogos estáticos em /game/<nome>/
if (fs.existsSync(GAMES_DIR)) {
  // index: false -> não força index automático; deixamos o comportamento mais previsível
  app.use('/game', express.static(GAMES_DIR, { index: false }));
} else {
  console.warn('Atenção: pasta games/ não encontrada. Crie games/<nome>/ com os jogos.');
}

// API que lista os jogos (lê subpastas de ./games)
app.get('/api/games', (req, res) => {
  try {
    if (!fs.existsSync(GAMES_DIR)) return res.json([]);

    const entries = fs.readdirSync(GAMES_DIR, { withFileTypes: true });
    const indexOptions = ['index.html', 'render.html', 'game.html', 'main.html'];

    const games = entries
      .filter(dirent => dirent.isDirectory())
      .map(dirent => {
        const gameName = dirent.name;
        const gameFolder = path.join(GAMES_DIR, gameName);
        const iconPath = path.join(gameFolder, 'icon.png');
        const hasIcon = fs.existsSync(iconPath);

        const indexFile = indexOptions.find(f => fs.existsSync(path.join(gameFolder, f)));
        const url = indexFile ? `/game/${encodeURIComponent(gameName)}/` : null;

        return {
          name: gameName,
          url,
          icon: hasIcon ? `/game/${encodeURIComponent(gameName)}/icon.png` : null,
          hasIndex: !!indexFile
        };
      });

    res.json(games);
  } catch (err) {
    console.error('Erro em /api/games:', err);
    res.status(500).json({ error: 'Erro lendo jogos.' });
  }
});

// rota simples de status
app.get('/status', (req, res) => res.json({ status: 'ok', gamesPath: GAMES_DIR }));

// Socket.IO (wildcard namespaces para /game/<nome>)
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingInterval: 5000,
  pingTimeout: 10000
});

// Map para guardar estado por namespace (/game/<nome>)
const namespaceState = new Map(); // key: namespace name (ex: '/game/Rpg-craft')

// Helper: inicializa estado para um namespace
function createNamespaceState(nsName) {
  if (namespaceState.has(nsName)) return namespaceState.get(nsName);

  const state = {
    players: {},
    projectiles: {},
    obstacles: [],
    pickups: {},
    tickInterval: null,
    tickRate: 1000 / 30 // 30 TPS por default; ajuste conforme necessário
  };

  namespaceState.set(nsName, state);
  return state;
}

// Start per-namespace game loop
function startNamespaceLoop(nsName) {
  const st = namespaceState.get(nsName);
  if (!st) return;
  if (st.tickInterval) return;

  st.tickInterval = setInterval(() => {
    // Aqui você colocaria a lógica do seu game loop (movimentação, colisões, etc).
    // Por ora apenas broadcast do estado atual:
    io.of(nsName).emit('gameStateUpdate', {
      players: st.players,
      projectiles: st.projectiles,
      pickups: st.pickups,
      obstacles: st.obstacles
    });
  }, st.tickRate);

  console.log(`Game loop iniciado para ${nsName} (tick ${st.tickRate}ms)`);
}

// Stop per-namespace loop se ninguém estiver conectado
function stopNamespaceLoopIfEmpty(nsName) {
  const nsp = io.of(nsName);
  const st = namespaceState.get(nsName);
  if (!st) return;
  // nsp.sockets é um Map, verificar tamanho
  const connectedCount = Object.keys(nsp.sockets || nsp.sockets).length || nsp.sockets?.size || Array.from(nsp.sockets || []).length;
  // socket.io v4 usa nsp.sockets Map (nsp.sockets.size)
  const size = (nsp.sockets && nsp.sockets.size !== undefined) ? nsp.sockets.size : (nsp.sockets ? Object.keys(nsp.sockets).length : 0);

  if (size === 0 && st.tickInterval) {
    clearInterval(st.tickInterval);
    st.tickInterval = null;
    console.log(`Game loop parado para ${nsName} (nenhum cliente conectado)`);
  }
}

// wildcard: aceita namespaces que comecem por /game/<nome>
io.of(/^\/game\/[^\/]+$/).on('connection', (socket) => {
  const nsName = socket.nsp.name; // ex: '/game/Rpg-craft'
  console.log(`[${nsName}] socket conectado:`, socket.id);

  // inicializa estado
  const st = createNamespaceState(nsName);

  // criar um "player" simples ao conectar
  st.players[socket.id] = {
    id: socket.id,
    name: `P-${socket.id.slice(0,6)}`,
    x: Math.floor(Math.random() * 200) + 50,
    y: Math.floor(Math.random() * 200) + 50,
    width: 32,
    height: 32,
    color: '#'+Math.floor(Math.random()*16777215).toString(16),
    health: 100,
    energy: 100,
    arrows: 10,
    equippedWeapon: { name: 'Arco Normal', cssClass: '' },
    isDead: false,
    respawnStartTime: 0
  };

  // envia dados iniciais só para o socket recém-conectado
  socket.emit('playerData', {
    id: socket.id,
    players: st.players,
    obstacles: st.obstacles,
    pickups: st.pickups,
    mapWidth: 800,
    mapHeight: 600
  });

  // start loop se necessário
  startNamespaceLoop(nsName);

  // handlers de input
  socket.on('playerInput', (data) => {
    // Exemplo simples: se receber "keys" atualiza posição do player no estado
    try {
      const p = st.players[socket.id];
      if (!p) return;

      const speed = data.keys && data.keys.sprint ? 4 : 2;
      if (data.keys) {
        if (data.keys.left) p.x -= speed;
        if (data.keys.right) p.x += speed;
        if (data.keys.up) p.y -= speed;
        if (data.keys.down) p.y += speed;
      }
      if (data.shoot) {
        // cria um projétil de exemplo
        const id = `proj_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
        st.projectiles[id] = { id, x: p.x + p.width/2, y: p.y + p.height/2, vx: 4, vy: 0, color: '#f1c40f' };
      }
      if (data.switchWeapon) {
        p.equippedWeapon = { name: `Arma ${data.switchWeapon}`, cssClass: '' };
      }
    } catch (err) {
      console.error('Erro playerInput:', err);
    }
  });

  socket.on('disconnect', () => {
    console.log(`[${nsName}] socket desconectou:`, socket.id);
    // remove player do estado e notifica
    if (st.players && st.players[socket.id]) delete st.players[socket.id];

    // broadcast para outros clientes que o jogador saiu
    io.of(nsName).emit('playerDisconnected', socket.id);

    // parar o loop se não houver mais conexões
    // (aguarda micro-tarefa para garantir socket removido)
    setTimeout(() => stopNamespaceLoopIfEmpty(nsName), 50);
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`Servidor principal rodando em http://localhost:${PORT}`);
  console.log(`Launcher (se existir em public/) será servido em http://localhost:${PORT}/launcher.html (ou /)`);
  console.log(`Jogos estáticos (games/) acessíveis via http://localhost:${PORT}/game/<nome>/`);
});
