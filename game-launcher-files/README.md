# Game Launcher

Estrutura esperada:
- public/ (contém launcher.html, launcher.js, style.css)
- games/ (cada pasta aqui é um jogo)
- launcher-server.js
- package.json

## Como rodar

```
npm install
npm start
```

Abra http://localhost:3001

## Observações

- Arquivos da interface ficam em `public/`.
- Cada jogo deve ficar em `games/<nome>/` e ter um `index.html` (ou `game.html`/`main.html`).
- Se o jogo tiver `icon.png` dentro da sua pasta, o launcher usa-o; caso contrário, é mostrada uma placeholder.
