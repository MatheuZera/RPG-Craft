// game.js - cliente completo, robusto e adaptado para namespaces
// - Detecta namespace /game/<nome>/ e conecta ao io('/game/<nome>')
// - Aceita ?server=http://host:porta para forçar a URL do socket
// - Inicializa após DOMContentLoaded, com verificações de existência do DOM
// - Proteções para evitar erros quando elementos estão ausentes

(() => {
  'use strict';

  // --- Configurações / estado ---
  let socket = null;
  let myPlayerId = null;
  let allPlayers = {};
  let serverProjectiles = {};
  let serverObstacles = [];
  let serverPickups = {};
  let mapWidth = 800;
  let mapHeight = 600;
  let cameraX = 0;
  let cameraY = 0;
  let gameRunning = false;
  let animationFrameId = null;
  const RESPAWN_DELAY = 5000;

  // Input
  let keysToSend = { up: false, down: false, left: false, right: false, sprint: false };
  let attackSent = false;

  // DOM references (populados em init)
  let gameCanvas = null;
  let ctx = null;
  let messagesContainer = null;
  let gamepad1Info = null;
  let gamepad2Info = null;

  // HUD elements
  let playerGUI = null;
  let healthBar = null;
  let healthValue = null;
  let energyBar = null;
  let energyValue = null;
  let weaponNameDisplay = null;
  let ammoCountDisplay = null;
  let cssWeaponShapeContainer = null;
  let respawnMessage = null;
  let respawnTimer = null;
  let visualEffectsOverlay = null;

  // Control displays
  let playerControlDisplays = {};

  // Input map
  const INPUT_MAP = {
    P1: { up: ['w'], down: ['s'], left: ['a'], right: ['d'], sprint: ['f'], shoot: ['c'] },
    P2: { up: ['w'], down: ['s'], left: ['a'], right: ['d'], sprint: ['f'], shoot: ['c'] },
  };

  // --- Helpers ---
  const safeGet = id => document.getElementById(id) || null;

  function logMessageToUI(text) {
    if (!messagesContainer) {
      console.log(text);
      return;
    }
    const msg = document.createElement('div');
    msg.classList.add('message');
    msg.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
    messagesContainer.appendChild(msg);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function checkMobile() {
    return /Mobi|Android/i.test(navigator.userAgent);
  }

  // --- HUD control ---
  function showControlHUD(playerId) {
    Object.values(playerControlDisplays).forEach(el => {
      if (el) el.style.display = 'none';
    });

    const hudEl = playerControlDisplays[playerId];
    if (hudEl) hudEl.style.display = 'block';

    if (playerGUI) playerGUI.classList.remove('player-gui-hidden');
  }

  function hideControlHUD(playerId) {
    const hudEl = playerControlDisplays[playerId];
    if (hudEl) hudEl.style.display = 'none';

    if (playerId === myPlayerId) {
      if (playerGUI) playerGUI.classList.add('player-gui-hidden');
      if (respawnMessage) respawnMessage.classList.add('hidden');
    }
  }

  // --- Visual effects ---
  function handleVisualEffect(data) {
    if (!visualEffectsOverlay) return;
    visualEffectsOverlay.classList.remove('damage-flash', 'heal-flash');
    void visualEffectsOverlay.offsetWidth;
    if (data && data.type === 'damageFlash') {
      visualEffectsOverlay.classList.add('damage-flash');
      setTimeout(() => visualEffectsOverlay.classList.remove('damage-flash'), 100);
    } else if (data && data.type === 'healFlash') {
      visualEffectsOverlay.classList.add('heal-flash');
      setTimeout(() => visualEffectsOverlay.classList.remove('heal-flash'), 100);
    }
  }

  // --- Input (keyboard) ---
  function setupKeyboardInput() {
    if (checkMobile()) return;

    window.addEventListener('keydown', (e) => {
      const key = (e.key || '').toLowerCase();
      const myPlayer = allPlayers[myPlayerId];
      if (myPlayer && myPlayer.isDead) return;

      const map = INPUT_MAP[myPlayerId];
      if (!map) return;

      if (map.up.includes(key)) keysToSend.up = true;
      if (map.down.includes(key)) keysToSend.down = true;
      if (map.left.includes(key)) keysToSend.left = true;
      if (map.right.includes(key)) keysToSend.right = true;
      if (map.sprint.includes(key)) keysToSend.sprint = true;
      if (map.shoot.includes(key)) attackSent = true;

      if (key >= '1' && key <= '7') {
        if (socket) socket.emit('playerInput', { switchWeapon: parseInt(key, 10) });
      }

      if ([' ', 'w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
        e.preventDefault();
      }
    });

    window.addEventListener('keyup', (e) => {
      const key = (e.key || '').toLowerCase();
      const map = INPUT_MAP[myPlayerId];
      if (!map) return;

      if (map.up.includes(key)) keysToSend.up = false;
      if (map.down.includes(key)) keysToSend.down = false;
      if (map.left.includes(key)) keysToSend.left = false;
      if (map.right.includes(key)) keysToSend.right = false;
      if (map.sprint.includes(key)) keysToSend.sprint = false;
    });

    window.addEventListener('blur', () => {
      keysToSend = { up: false, down: false, left: false, right: false, sprint: false };
      attackSent = false;
    });
  }

  // --- Send input to server ---
  function sendInputToServer() {
    if (!gameRunning || !myPlayerId || !socket) return;
    const myPlayer = allPlayers[myPlayerId];
    if (!myPlayer || myPlayer.isDead) {
      keysToSend = { up: false, down: false, left: false, right: false, sprint: false };
      attackSent = false;
      return;
    }

    try {
      socket.emit('playerInput', {
        keys: keysToSend,
        shoot: attackSent
      });
    } catch (err) {
      // ignore
    }
    attackSent = false;
  }

  // --- Camera & HUD updates ---
  function updateCamera() {
    const myPlayer = allPlayers[myPlayerId];
    if (!myPlayer || myPlayer.isDead || !gameCanvas) return;

    const playerCenterX = (myPlayer.x || 0) + (myPlayer.width || 0) / 2;
    const playerCenterY = (myPlayer.y || 0) + (myPlayer.height || 0) / 2;

    let targetX = playerCenterX - (gameCanvas.clientWidth || 0) / 2;
    let targetY = playerCenterY - (gameCanvas.clientHeight || 0) / 2;

    targetX = Math.max(0, Math.min(mapWidth - (gameCanvas.clientWidth || 0), targetX));
    targetY = Math.max(0, Math.min(mapHeight - (gameCanvas.clientHeight || 0), targetY));

    cameraX += (targetX - cameraX) * 0.2;
    cameraY += (targetY - cameraY) * 0.2;
  }

  function updateLocalHUD(myPlayer) {
    if (!myPlayer || !playerGUI) return;

    const health = typeof myPlayer.health === 'number' ? myPlayer.health : 100;
    const energy = typeof myPlayer.energy === 'number' ? myPlayer.energy : 100;

    const healthPercent = Math.max(0, Math.min(100, (health / 100) * 100));
    const energyPercent = Math.max(0, Math.min(100, (energy / 100) * 100));

    if (healthBar) healthBar.style.width = `${healthPercent}%`;
    if (healthValue) healthValue.textContent = String(health);

    if (health <= 30) {
      healthBar && healthBar.classList.add('low-health-bar');
    } else {
      healthBar && healthBar.classList.remove('low-health-bar');
    }

    if (energyBar) energyBar.style.width = `${energyPercent}%`;
    if (energyValue) energyValue.textContent = String(Math.round(energy));

    if (weaponNameDisplay) weaponNameDisplay.textContent = (myPlayer.equippedWeapon && myPlayer.equippedWeapon.name) ? myPlayer.equippedWeapon.name : 'Nenhuma';
    if (ammoCountDisplay) ammoCountDisplay.textContent = String(myPlayer.arrows || 0);

    if (cssWeaponShapeContainer) {
      cssWeaponShapeContainer.className = 'css-weapon-shape-container';
      if (myPlayer.equippedWeapon && myPlayer.equippedWeapon.cssClass) {
        cssWeaponShapeContainer.classList.add(myPlayer.equippedWeapon.cssClass);
      }
    }

    if (myPlayer.isDead) {
      respawnMessage && respawnMessage.classList.remove('hidden');
      playerGUI.classList.add('player-gui-hidden');

      const start = myPlayer.respawnStartTime || performance.now();
      const timeElapsed = performance.now() - start;
      const timeLeft = Math.max(0, RESPAWN_DELAY - timeElapsed);
      respawnTimer && (respawnTimer.textContent = (timeLeft / 1000).toFixed(1));
    } else {
      respawnMessage && respawnMessage.classList.add('hidden');
      playerGUI.classList.remove('player-gui-hidden');
    }
  }

  // --- Drawing ---
  function drawPickups() {
    if (!ctx) return;
    for (const id in serverPickups) {
      const pickup = serverPickups[id];
      if (!pickup) continue;

      ctx.fillStyle = pickup.color || '#27ae60';
      ctx.fillRect(pickup.x || 0, pickup.y || 0, pickup.width || 16, pickup.height || 16);

      ctx.fillStyle = 'white';
      const crossSize = (pickup.width || 16) * 0.6;
      const offset = ((pickup.width || 16) - crossSize) / 2;

      ctx.fillRect((pickup.x || 0) + (pickup.width || 16) / 2 - 2, (pickup.y || 0) + offset, 4, crossSize);
      ctx.fillRect((pickup.x || 0) + offset, (pickup.y || 0) + (pickup.height || 16) / 2 - 2, crossSize, 4);
    }
  }

  function draw() {
    if (!ctx || !gameCanvas) return;

    ctx.fillStyle = '#1a202c';
    ctx.fillRect(0, 0, mapWidth, mapHeight);

    ctx.save();
    ctx.translate(-cameraX, -cameraY);

    (serverObstacles || []).forEach(obs => {
      if (!obs) return;
      ctx.fillStyle = obs.color || '#34495e';
      ctx.fillRect(obs.x || 0, obs.y || 0, obs.width || 32, obs.height || 32);
    });

    drawPickups();

    for (const id in serverProjectiles) {
      const proj = serverProjectiles[id];
      if (!proj) continue;
      ctx.fillStyle = proj.color || '#f1c40f';
      ctx.beginPath();
      ctx.arc(proj.x || 0, proj.y || 0, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const id in allPlayers) {
      const player = allPlayers[id];
      if (!player) continue;
      if (player.isDead) continue;

      ctx.fillStyle = player.color || '#e74c3c';
      ctx.fillRect(player.x || 0, player.y || 0, player.width || 32, player.height || 32);

      ctx.fillStyle = 'white';
      ctx.font = '10px "Press Start 2P", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(player.name || 'Player', (player.x || 0) + ((player.width || 32) / 2), (player.y || 0) - 20);
    }

    ctx.restore();
  }

  // --- Game loop ---
  function gameLoop() {
    if (!gameRunning) return;
    sendInputToServer();
    updateCamera();
    draw();
    const myPlayer = allPlayers[myPlayerId];
    if (myPlayer) updateLocalHUD(myPlayer);
    animationFrameId = requestAnimationFrame(gameLoop);
  }

  // --- Socket handlers (registrados após init) ---
  function registerSocketHandlers() {
    if (!socket) return;

    socket.on('visualEffect', handleVisualEffect);

    socket.on('playerData', (data) => {
      try {
        myPlayerId = data.id;
        allPlayers = data.players || {};
        serverObstacles = data.obstacles || [];
        serverPickups = data.pickups || {};
        mapWidth = data.mapWidth || mapWidth;
        mapHeight = data.mapHeight || mapHeight;

        if (gameCanvas) {
          gameCanvas.width = mapWidth;
          gameCanvas.height = mapHeight;
        }

        showControlHUD(myPlayerId);

        if (!gameRunning) {
          gameRunning = true;
          logMessageToUI(`Conectado como ${myPlayerId}.`);
          animationFrameId = requestAnimationFrame(gameLoop);
        }
      } catch (err) {
        console.error('Erro em playerData handler:', err);
      }
    });

    socket.on('gameStateUpdate', (data) => {
      try {
        allPlayers = data.players || allPlayers;
        serverProjectiles = data.projectiles || serverProjectiles;
        serverPickups = data.pickups || serverPickups;
      } catch (err) {
        console.error('Erro em gameStateUpdate handler:', err);
      }
    });

    socket.on('playerDisconnected', (playerId) => {
      delete allPlayers[playerId];
      logMessageToUI(`${playerId} se desconectou.`);
      hideControlHUD(playerId);
      if (playerId === myPlayerId) myPlayerId = null;
    });

    socket.on('playerKilled', (data) => {
      if (data && data.targetId && data.killerId) {
        logMessageToUI(`${data.targetId} foi abatido por ${data.killerId}!`);
      }
    });

    socket.on('gameReset', (message) => {
      logMessageToUI(`[ALERTA DO SERVIDOR] ${message}`);
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      Object.keys(playerControlDisplays).forEach(hideControlHUD);
      myPlayerId = null;
      allPlayers = {};
      serverProjectiles = {};
      serverPickups = {};
      gameRunning = false;
      setTimeout(() => window.location.reload(), 3000);
    });

    // Fallback: log socket errors to UI/console
    socket.on('connect_error', (err) => {
      console.error('Socket connect_error:', err);
      logMessageToUI('Erro ao conectar ao servidor de jogo.');
    });
  }

  // --- Canvas interaction (click to focus / pointer lock) ---
  function setupCanvasInteraction() {
    if (!gameCanvas) return;
    gameCanvas.setAttribute('tabindex', '0');
    gameCanvas.style.outline = 'none';

    gameCanvas.addEventListener('click', () => {
      try {
        gameCanvas.focus();
        if (gameCanvas.requestPointerLock) gameCanvas.requestPointerLock();
      } catch (e) {
        // ignore
      }
    });

    document.addEventListener('pointerlockchange', () => {
      // opcional: tratar mudança de pointer lock
    });
  }

  // --- Init: coleta DOM, cria socket, configura handlers ---
  function init() {
    // DOM refs
    gameCanvas = safeGet('gameCanvas');
    ctx = gameCanvas && gameCanvas.getContext ? gameCanvas.getContext('2d') : null;
    messagesContainer = safeGet('messages');
    gamepad1Info = safeGet('gamepad1Info');
    gamepad2Info = safeGet('gamepad2Info');

    playerGUI = safeGet('player-gui');
    healthBar = safeGet('health-bar');
    healthValue = safeGet('health-value');
    energyBar = safeGet('energy-bar');
    energyValue = safeGet('energy-value');
    weaponNameDisplay = safeGet('weapon-name');
    ammoCountDisplay = safeGet('ammo-count');
    cssWeaponShapeContainer = safeGet('css-weapon-shape');
    respawnMessage = safeGet('respawn-message');
    respawnTimer = safeGet('respawn-timer');
    visualEffectsOverlay = safeGet('visual-effects-overlay');

    playerControlDisplays = {
      P1: safeGet('player1-controls'),
      P2: safeGet('player2-controls'),
      P3: safeGet('player3-controls'),
      P4: safeGet('player4-controls')
    };

    // --- Socket creation / namespace detection ---
    try {
      if (typeof io === 'undefined') {
        logMessageToUI('Socket.IO (io) não encontrado. Verifique se /socket.io/socket.io.js foi carregado.');
        socket = null;
      } else {
        const urlParams = new URLSearchParams(window.location.search);
        const serverOverride = urlParams.get('server'); // ex: http://localhost:3000 (opcional)
        const nsMatch = window.location.pathname.match(/^\/game\/([^\/]+)\/?/);
        const ns = nsMatch ? `/game/${nsMatch[1]}` : null;

        if (serverOverride) {
          const base = serverOverride.replace(/\/$/, '');
          socket = ns ? io(base + ns) : io(base);
        } else {
          socket = ns ? io(ns) : io();
        }
      }
    } catch (err) {
      console.error('Erro ao criar socket:', err);
      socket = null;
    }

    // Ajusta canvas inicialmente
    if (gameCanvas) {
      gameCanvas.width = mapWidth;
      gameCanvas.height = mapHeight;
    }

    setupKeyboardInput();
    setupCanvasInteraction();

    if (socket) {
      registerSocketHandlers();
    } else {
      logMessageToUI('Modo offline: sem conexão socket. O jogo funcionará apenas localmente (sem multiplayer).');
    }

    // desconectar socket ao fechar a aba
    window.addEventListener('beforeunload', () => {
      try {
        if (socket && socket.disconnect) socket.disconnect();
      } catch (e) {}
    });

    logMessageToUI('Cliente pronto.');
  }

  // Inicializa quando DOM for carregado
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
