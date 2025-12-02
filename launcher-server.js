// launcher-server.js
// Launcher que lista jogos e inicia game-servers opcionais (games/<name>/server.js)
const express = require("express");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const app = express();
const PORT = process.env.PORT || 3001;
const GAMES_DIR = path.join(__dirname, "games");

// porta base para game servers (4000,4001,...)
const GAME_PORT_BASE = parseInt(process.env.GAME_PORT_BASE || "4000", 10);

app.use(express.json());

// serve arquivos do launcher (launcher.html, assets compartilhados etc.)
app.use("/", express.static(path.join(__dirname, "public")));

// serve arquivos estáticos de cada pasta de jogo em /game-static/<nome>/*
// (usado quando o jogo não tem server.js)
app.use("/game-static", express.static(GAMES_DIR));

/**
 * Estado de game servers iniciados:
 * { "<gameName>": { pid, port, startedAt, process } }
 */
const runningGameServers = {};

// lista jogos
app.get("/api/games", (req, res) => {
  try {
    if (!fs.existsSync(GAMES_DIR)) return res.json([]);
    const entries = fs.readdirSync(GAMES_DIR, { withFileTypes: true });

    const games = entries
      .filter(d => d.isDirectory())
      .map((d, idx) => {
        const name = d.name;
        const folder = path.join(GAMES_DIR, name);
        const iconPath = path.join(folder, "icon.png");
        const hasIcon = fs.existsSync(iconPath);
        const indexOptions = ["index.html", "game.html", "main.html"];
        const indexFile = indexOptions.find(f => fs.existsSync(path.join(folder, f)));
        const hasIndex = !!indexFile;
        const hasServer = fs.existsSync(path.join(folder, "server.js"));

        return {
          name,
          hasIndex,
          indexFile: indexFile || null,
          hasIcon,
          icon: hasIcon ? `/game-static/${encodeURIComponent(name)}/icon.png` : null,
          hasServer
        };
      });

    res.json(games);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro lendo jogos." });
  }
});

/**
 * Endpoint para iniciar/garantir game-server.
 * Se o jogo tiver server.js inicia em uma porta alocada e retorna URL.
 * Se o jogo for estático retorna a rota interna /game-static/<name>/<indexFile>
 */
app.post("/api/launch", async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "Nome do jogo necessário." });

    const gameFolder = path.join(GAMES_DIR, name);
    if (!fs.existsSync(gameFolder)) return res.status(404).json({ error: "Jogo não encontrado." });

    const serverFile = path.join(gameFolder, "server.js");
    const indexOptions = ["index.html", "game.html", "main.html"];
    const indexFile = indexOptions.find(f => fs.existsSync(path.join(gameFolder, f)));

    if (fs.existsSync(serverFile)) {
      // já iniciado?
      if (runningGameServers[name]) {
        const info = runningGameServers[name];
        return res.json({ url: `http://localhost:${info.port}/`, started: false });
      }

      // aloca porta livre simples (base + next index)
      let port = GAME_PORT_BASE;
      while (Object.values(runningGameServers).some(s => s.port === port)) port++;

      // inicia node server.js no diretório do jogo, passando PORT_GAME no env
      const child = spawn(process.execPath, ["server.js"], {
        cwd: gameFolder,
        env: { ...process.env, PORT_GAME: String(port) },
        stdio: ["ignore", "pipe", "pipe"]
      });

      runningGameServers[name] = {
        pid: child.pid,
        process: child,
        port,
        startedAt: Date.now()
      };

      child.stdout.on("data", d => {
        process.stdout.write(`[${name} stdout] ${d}`);
      });
      child.stderr.on("data", d => {
        process.stderr.write(`[${name} stderr] ${d}`);
      });
      child.on("exit", (code, sig) => {
        console.log(`Game server ${name} exited: code=${code} sig=${sig}`);
        delete runningGameServers[name];
      });

      // retorna URL imediatamente (o server.js deve escutar porta PORT_GAME)
      return res.json({ url: `http://localhost:${port}/`, started: true });
    } else if (indexFile) {
      // jogo estático: serve via /game-static/<nome>/<indexFile>
      const url = `/game-static/${encodeURIComponent(name)}/${indexFile}`;
      return res.json({ url, started: false });
    } else {
      return res.status(400).json({ error: "Jogo não tem index nem server.js." });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao tentar iniciar o jogo." });
  }
});

// opcional: endpoint para parar servidores (admin) — use com cautela
app.post("/api/stop", (req, res) => {
  const { name } = req.body;
  if (!name || !runningGameServers[name]) return res.status(404).json({ error: "Não encontrado." });
  try {
    runningGameServers[name].process.kill();
    delete runningGameServers[name];
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Falha ao parar." });
  }
});

app.listen(PORT, () => {
  console.log(`Launcher rodando em http://localhost:${PORT}`);
  console.log(`Games dir: ${GAMES_DIR}`);
});
