// launcher-server.js
// Servidor Express para exibir o launcher e listar jogos na pasta ./games

const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3001;

// Caminho absoluto da pasta de jogos
const GAMES_DIR = path.join(__dirname, "games");

// Servir o launcher (launcher.html)
app.use("/", express.static(path.join(__dirname)));

// Servir jogos em /game/<nome>/
app.use("/game", express.static(GAMES_DIR));

// API para listar jogos
app.get("/api/games", (req, res) => {
  try {
    if (!fs.existsSync(GAMES_DIR)) {
      return res.json([]);
    }

    const entries = fs.readdirSync(GAMES_DIR, { withFileTypes: true });

    const games = entries
      .filter(dirent => dirent.isDirectory())
      .map(dirent => {
        const gameName = dirent.name;
        const gameFolder = path.join(GAMES_DIR, gameName);

        const icon = path.join(gameFolder, "icon.png");
        const hasIcon = fs.existsSync(icon);

        const indexOptions = ["index.html", "game.html", "main.html"];
        const indexFile = indexOptions.find(f =>
          fs.existsSync(path.join(gameFolder, f))
        );

        return {
          name: gameName,
          url: `/game/${encodeURIComponent(gameName)}/${indexFile || ""}`,
          icon: hasIcon
            ? `/game/${encodeURIComponent(gameName)}/icon.png`
            : null,
          hasIndex: !!indexFile
        };
      })
      .filter(g => g.icon !== null); // só jogos com icon.png aparecem

    res.json(games);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro lendo jogos." });
  }
});

app.listen(PORT, () => {
  console.log(`Launcher rodando em http://localhost:${PORT}`);
});
