// launcher-server.js - servidor apenas para o launcher (opcional)
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;

const ROOT = path.join(__dirname);
const PUBLIC_DIR = path.join(ROOT, 'public');
const GAMES_DIR = path.join(ROOT, 'games');

app.use('/', express.static(PUBLIC_DIR));
app.use('/game', express.static(GAMES_DIR, { index: false }));

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
        return { name: gameName, url, icon: hasIcon ? `/game/${encodeURIComponent(gameName)}/icon.png` : null, hasIndex: !!indexFile };
      });

    res.json(games);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro lendo jogos.' });
  }
});

app.listen(PORT, () => {
  console.log(`Launcher estático rodando em http://localhost:${PORT}`);
});
