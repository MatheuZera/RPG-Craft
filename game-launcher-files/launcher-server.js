// launcher-server.js
// Servidor Express para exibir o launcher e listar jogos na pasta ./games

const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;

// Caminho absoluto da pasta do projeto (raiz onde está este launcher)
const ROOT = path.join(__dirname);
const PUBLIC_DIR = path.join(ROOT, 'public');   // UI do launcher (launcher.html, style.css, launcher.js)
const GAMES_DIR = path.join(ROOT, 'games');     // pasta que contém subpastas com jogos

// Servir assets do launcher (página do launcher)
app.use('/', express.static(PUBLIC_DIR));

// Servir cada jogo em /game/<nome>/
// Ex: /game/Rpg-craft/ -> serve os arquivos dentro de games/Rpg-craft/
app.use('/game', express.static(GAMES_DIR, { index: false }));

// API para listar jogos
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

        // procura o arquivo de entrada
        const indexFile = indexOptions.find(f => fs.existsSync(path.join(gameFolder, f)));

        // Se encontrou um indexFile, expõe URL raiz do jogo (o servidor do jogo deve servir o index automaticamente).
        // Usamos URL relativa para o launcher: "/game/<nome>/"
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
    console.error(err);
    res.status(500).json({ error: 'Erro lendo jogos.' });
  }
});

// Rota simples de debug
app.get('/status', (req, res) => {
  res.json({ status: 'ok', gamesPath: GAMES_DIR });
});

app.listen(PORT, () => {
  console.log(`Launcher rodando em http://localhost:${PORT}`);
});
