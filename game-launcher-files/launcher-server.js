// launcher-server.js
// Servidor Express para exibir o launcher e listar jogos na pasta ./games

const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;

// Caminho absoluto da pasta de jogos
const ROOT = path.join(__dirname);
const PUBLIC_DIR = path.join(ROOT, 'public');
const GAMES_DIR = path.join(ROOT, 'games');

// Servir assets do launcher
app.use('/', express.static(PUBLIC_DIR));

// Servir cada jogo em /game/<nome>/
app.use('/game', express.static(GAMES_DIR));

// API para listar jogos
app.get('/api/games', (req, res) => {
  try {
    if (!fs.existsSync(GAMES_DIR)) return res.json([]);

    const entries = fs.readdirSync(GAMES_DIR, { withFileTypes: true });

    const games = entries
      .filter(dirent => dirent.isDirectory())
      .map(dirent => {
        const gameName = dirent.name;
        const gameFolder = path.join(GAMES_DIR, gameName);

        const iconPath = path.join(gameFolder, 'icon.png');
        const hasIcon = fs.existsSync(iconPath);

        const indexOptions = ['index.html', 'game.html', 'main.html'];
        const indexFile = indexOptions.find(f => fs.existsSync(path.join(gameFolder, f)));

        return {
          name: gameName,
          url: indexFile ? `/game/${encodeURIComponent(gameName)}/${indexFile}` : null,
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

app.listen(PORT, () => {
  console.log(`Launcher rodando em http://localhost:${PORT}`);
});
