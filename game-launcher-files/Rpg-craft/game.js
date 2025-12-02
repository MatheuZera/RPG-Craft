// game.js (versão completa e robusta)
// - Aceita ?server=http://host:porta para forçar conexão socket
// - Inicializa após DOMContentLoaded
// - Proteções caso elementos não existam
// - Clique no canvas foca e tenta pointer lock
// - Mantém a lógica original do seu jogo

(() => {
  'use strict';

  // --- Socket: detecta override via query param ---
  const urlParams = new URLSearchParams(window.location.search);
  const serverOverride = urlParams.get('server'); // ex: http://localhost:4000
  const socket = (typeof io !== 'undefined')
    ? (serverOverride ? io(serverOverride) : io())
    : null;

  // --- Estado global ---
  let gameCanvas, ctx;
  let messagesContainer, gamepad1Info, gamepad2Info;
  let playerGUI, healthBar, healthValue, energyBar, energyValue;
  let weaponNameDisplay, ammoCountDisplay, cssWeaponShapeContainer;
  let respawnMessage, respawnTimer, visualEffectsOverlay;
  let playerControlDisplays = {};
  let myPlayerId = null;
  let allPlayers = {};
  let serverProjectiles = {};
  let serverObstacles = [];
  let serverPickups = {};
  let mapWidth = 800;
  let mapHeight = 600;
  let cameraX = 0, cameraY = 0;
  let gameRunning = false;
  let animationFrameId = null;
  const RESPAWN_DELAY = 5000;

  // Input state
  let keysToSend = { up: false, down: false, left: false, right: false, sprint: false };
  let attackSent = false;

  // Default input map (pode adaptar depois)
  const INPUT_MAP = {
    P1: { up: ['w'], down: ['s'], left: ['a'], right: ['d'], sprint: ['f'], shoot: ['c'] },
    P2: { up: ['w'], down: ['s'], left: ['a'], right: ['d'], sprint: ['f'], shoot: ['c'] },
  };

  // Gamepad config (não totalmente implementado aqui)
  const GAMEPAD_SHOOT_BUTTON = 0;
  const GAMEPAD_SPRINT_BUTTON = 1;
  const GAMEPAD_MOVE_AXIS_X = 0;
  const GAMEPAD_MOVE_AXIS_Y = 1;
  const GAMEPAD_DEADZONE = 0.5;

  // --- Helpers ---
  function safeGet(id) { return document.getElementById(id); }

  function showMessage(text) {
    if (!messagesContainer) return;
    const msg = document.createElement('div');
    msg.classList.add('message');
    msg.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
    messagesContainer.appendChild(msg);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function checkMobile() {
    return /Mobi|Android/i.test(navigator.userAgent);
  }

  // --- HUD / Controls management ---
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

  // --- Visual effects socket handler ---
  function handleVisualEffect(data) {
    if (!visualEffectsOverlay) return;
    visualEffectsOverlay.classList.remove('damage-flash', 'heal-flash');
    void visualEffectsOverlay.offsetWidth;
    if (data.type === 'damageFlash') {
      visualEffectsOverlay.classList.add('damage-flash');
      setTimeout(() => visualEffectsOverlay.classList.remove('damage-flash'), 100);
    } else if (data.type === 'healFlash') {
      visualEffectsOverlay.classList.add('heal-flash');
      setTimeout(() => visualEffectsOverlay.classList.remove('heal-flash'), 100);
    }
  }

  // --- Input (teclado) ---
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

    // liberar teclas ao perder foco (por ex. alt-tab)
    window.addEventListener('blur', () => {
      keysToSend = { up: false, down: false, left: false, right: false, sprint: false };
      attackSent = false;
    });
  }

  // --- Envio de input ao servidor ---
  function sendInputToServer() {
    if (!gameRunning || !myPlayerId || !socket) return;

    const myPlayer = allPlayers[myPlayerId];
    if (!myPlayer || myPlayer.isDead) {
      keysToSend = { up: false, down: false, left: false, right: false, sprint: false };
      attackSent = false;
      return;
    }

    socket.emit('playerInput', {
      keys: keysToSend,
      shoot: attackSent,
    });

    attackSent = false;
  }

  // --- Camera e desenho ---
  function updateCamera() {
    const myPlayer = allPlayers[myPlayerId];
    if (!myPlayer || myPlayer.isDead) return;

    const playerCenterX = myPlayer.x + (myPlayer.width || 0) / 2;
    const playerCenterY = myPlayer.y + (myPlayer.height || 0) / 2;

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
      if (respawnTimer) respawnTimer.textContent = (timeLeft / 1000).toFixed(1);
    } else {
      respawnMessage && respawnMessage.classList.add('hidden');
      playerGUI.classList.remove('player-gui-hidden');
    }
  }

  function drawPickups() {
    if (!ctx) return;
    for (const id in serverPickups) {
      const pickup = serverPickups[id];
      if (!pickup) continue;
      ctx.fillStyle = pickup.color || '#27ae60';
      ctx.fillRect(pickup.x, pickup.y, pickup.width, pickup.height);

      ctx.fillStyle = 'white';
      const crossSize = (pickup.width || 16) * 0.6;
      const offset = ((pickup.width || 16) - crossSize) / 2;

      ctx.fillRect(pickup.x + (pickup.width || 16) / 2 - 2, pickup.y + offset, 4, crossSize);
      ctx.fillRect(pickup.x + offset, pickup.y + (pickup.height || 16) / 2 - 2, crossSize, 4);
    }
  }

  function draw() {
    if (!ctx || !gameCanvas) return;

    ctx.fillStyle = '#1a202c';
    ctx.fillRect(0, 0, mapWidth, mapHeight);

    ctx.save();
    ctx.translate(-cameraX, -cameraY);

    serverObstacles.forEach(obs => {
      if (!obs) return;
      ctx.fillStyle = obs.color || '#34495e';
      ctx.fillRect(obs.x, obs.y, obs.width, obs.height);
    });

    drawPickups();

    for (const id in serverProjectiles) {
      const proj = serverProjectiles[id];
      if (!proj) continue;
      ctx.fillStyle = proj.color || '#f1c40f';
      ctx.beginPath();
      ctx.arc(proj.x, proj.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const id in allPlayers) {
      const player = allPlayers[id];
      if (!player) continue;
      if (player.isDead) continue;

      ctx.fillStyle = player.color || '#e74c3c';
      ctx.fillRect(player.x, player.y, player.width, player.height);

      ctx.fillStyle = 'white';
      ctx.font = '10px "Press Start 2P", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(player.name || 'Player', player.x + (player.width || 32) / 2, player.y - 20);
    }

    ctx.restore();
  }

  // --- Main game loop ---
  function gameLoop(/* currentTime */) {
    if (!gameRunning) return;
    sendInputToServer();
    updateCamera();
    draw();

    const myPlayer = allPlayers[myPlayerId];
    if (myPlayer) updateLocalHUD(myPlayer);

    animationFrameId = requestAnimationFrame(gameLoop);
  }

  // --- Socket event handlers registration (safe) ---
  function registerSocketHandlers() {
    if (!socket) return;

    socket.on('visualEffect', handleVisualEffect);

    socket.on('playerData', (data) => {
      myPlayerId = data.id;
      allPlayers = data.players || {};
      serverObstacles = data.obstacles || [];
      serverPickups = data.pickups || {};
      mapWidth = data.mapWidth || mapWidth;
      mapHeight = data.mapHeight || mapHeight;

      // Ajusta tamanho do canvas de acordo com mapa
      if (gameCanvas) {
        gameCanvas.width = mapWidth;
        gameCanvas.height = mapHeight;
      }

      showControlHUD(myPlayerId);

      if (!gameRunning) {
        gameRunning = true;
        showMessage(`Conectado como ${myPlayerId}.`);
        animationFrameId = requestAnimationFrame(gameLoop);
      }
    });

    socket.on('gameStateUpdate', (data) => {
      allPlayers = data.players || allPlayers;
      serverProjectiles = data.projectiles || serverProjectiles;
      serverPickups = data.pickups || serverPickups;
    });

    socket.on('playerDisconnected', (playerId) => {
      delete allPlayers[playerId];
      showMessage(`${playerId} se desconectou.`);
      hideControlHUD(playerId);
      if (playerId === myPlayerId) myPlayerId = null;
    });

    socket.on('playerKilled', (data) => {
      showMessage(`${data.targetId} foi abatido por ${data.killerId}!`);
    });

    socket.on('gameReset', (message) => {
      showMessage(`[ALERTA DO SERVIDOR] ${message}`);
      if (animationFrameId) cancelAnimationFrame(animationFrameId);

      Object.keys(playerControlDisplays).forEach(hideControlHUD);

      myPlayerId = null;
      allPlayers = {};
      serverProjectiles = {};
      serverPickups = {};
      gameRunning = false;

      setTimeout(() => {
        window.location.reload();
      }, 3000);
    });
  }

  // --- Canvas click / focus / pointer lock ---
  function setupCanvasInteraction() {
    if (!gameCanvas) return;
    // garantir que canvas possa receber foco
    gameCanvas.setAttribute('tabindex', '0');
    gameCanvas.style.outline = 'none';

    gameCanvas.addEventListener('click', () => {
      try {
        gameCanvas.focus();
        if (gameCanvas.requestPointerLock) {
          gameCanvas.requestPointerLock();
        }
      } catch (e) {
        // ignore
      }
    });

    // sair do pointer lock: atualiza estado se necessário
    document.addEventListener('pointerlockchange', () => {
      const lockedElem = document.pointerLockElement;
      if (!lockedElem) {
        // pointer unlocked
      }
    });
  }

  // --- Inicialização (DOM ready) ---
  function init() {
    // Re-obter elementos DOM (assim podemos executar o arquivo cedo sem erros)
    gameCanvas = safeGet('gameCanvas');
    ctx = gameCanvas ? (gameCanvas.getContext ? gameCanvas.getContext('2d') : null) : null;

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
      'P1': safeGet('player1-controls'),
      'P2': safeGet('player2-controls'),
      'P3': safeGet('player3-controls'),
      'P4': safeGet('player4-controls'),
    };

    // Se o canvas existe, definimos seu tamanho inicial
    if (gameCanvas) {
      gameCanvas.width = mapWidth;
      gameCanvas.height = mapHeight;
    }

    setupKeyboardInput();
    setupCanvasInteraction();
    registerSocketHandlers();

    // desconectar socket ao fechar a aba
    window.addEventListener('beforeunload', () => {
      try {
        if (socket && socket.disconnect) socket.disconnect();
      } catch (e) {}
    });

    // opcional: inicia uma mensagem local para debug
    showMessage('Cliente pronto.');
  }

  // inicializa quando DOM estiver pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
