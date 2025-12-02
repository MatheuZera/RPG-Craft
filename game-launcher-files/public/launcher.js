// launcher.js - abre o jogo em overlay com iframe
document.addEventListener('DOMContentLoaded', () => {
  const overlay = document.getElementById('game-overlay');
  const frame = document.getElementById('gameFrame');
  const closeBtn = document.getElementById('close-game');

  function openGame(url) {
    // se a url for relativa (começa com '/'), tentamos abrir direto
    // para passar server override ao jogo, anexamos query "?server=HOST" se detectar host:porta
    frame.src = url;
    overlay.classList.remove('hidden');
  }

  function closeGame() {
    // limpa o iframe para liberar conexões/ws
    frame.src = 'about:blank';
    overlay.classList.add('hidden');
  }

  // Attaches
  document.querySelectorAll('.btn-open').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const url = e.currentTarget.dataset.url;
      openGame(url);
    });
  });

  closeBtn.addEventListener('click', closeGame);

  // fechar com ESC
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !overlay.classList.contains('hidden')) closeGame();
  });
});
