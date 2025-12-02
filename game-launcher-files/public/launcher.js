async function fetchGames(){
  const res = await fetch('/api/games');
  if (!res.ok) return [];
  return await res.json();
}

const grid = document.getElementById('grid');
const noGames = document.getElementById('noGames');
const status = document.getElementById('status');
const searchInput = document.getElementById('search');
const refreshBtn = document.getElementById('refresh');

const previewPanel = document.getElementById('previewPanel');
const previewFrame = document.getElementById('previewFrame');
const previewIcon = document.getElementById('previewIcon');
const previewName = document.getElementById('previewName');
const previewMeta = document.getElementById('previewMeta');
const previewClose = document.getElementById('previewClose');
const openInTabBtn = document.getElementById('openInTab');
const openInIframeBtn = document.getElementById('openInIframe');

let allGames = [];
let currentPreview = null;

function placeholderIcon(name){
  // Cria uma placeholder simples em dataURL (SVG)
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='128' height='128'><rect width='100%' height='100%' fill='%23222'/><text x='50%' y='50%' fill='%23f59e0b' font-size='18' font-family='Arial' dominant-baseline='middle' text-anchor='middle'>${escapeHtml(name.slice(0,2)).toUpperCase()}</text></svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[c]));
}

function renderGames(list){
  grid.innerHTML = '';
  if(list.length === 0){
    noGames.style.display = 'block';
    status.textContent = 'Nenhum jogo encontrado.';
    return;
  }
  noGames.style.display = 'none';
  status.textContent = `${list.length} jogo(s) encontrados.`;

  list.forEach(g => {
    const card = document.createElement('div');
    card.className = 'card';

    const img = document.createElement('img');
    img.src = g.icon || placeholderIcon(g.name);
    img.alt = g.name + ' icon';

    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = g.name;

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = g.hasIndex ? 'Pronto' : 'Sem index.html';

    const actions = document.createElement('div');
    actions.className = 'actions';

    const btnPlay = document.createElement('button');
    btnPlay.textContent = 'Abrir';
    btnPlay.onclick = () => openGame(g);

    const btnPreview = document.createElement('button');
    btnPreview.textContent = 'Pré-visualizar';
    btnPreview.onclick = () => previewGame(g);

    actions.appendChild(btnPreview);
    actions.appendChild(btnPlay);

    card.appendChild(img);
    card.appendChild(name);
    card.appendChild(meta);
    card.appendChild(actions);

    grid.appendChild(card);
  });
}

function openGame(g){
  if(g.url){
    // abre em nova aba por padrão
    window.open(g.url, '_blank');
  } else {
    alert('Esse jogo não tem index.html. Verifique os arquivos na pasta do jogo.');
  }
}

function previewGame(g){
  currentPreview = g;
  previewIcon.src = g.icon || placeholderIcon(g.name);
  previewName.textContent = g.name;
  previewMeta.textContent = g.hasIndex ? 'Pronto - você pode jogar aqui' : 'Sem index.html';

  if(g.url && g.hasIndex){
    previewFrame.src = g.url;
    openInIframeBtn.disabled = false;
    openInTabBtn.disabled = false;
  } else {
    previewFrame.src = 'about:blank';
    openInIframeBtn.disabled = true;
    openInTabBtn.disabled = true;
  }

  previewPanel.style.display = 'block';
  previewPanel.setAttribute('aria-hidden', 'false');
}

previewClose.onclick = () => {
  previewPanel.style.display = 'none';
  previewFrame.src = 'about:blank';
  previewPanel.setAttribute('aria-hidden', 'true');
  currentPreview = null;
};

openInTabBtn.onclick = () => {
  if(currentPreview && currentPreview.url) window.open(currentPreview.url, '_blank');
};

openInIframeBtn.onclick = () => {
  if(currentPreview && currentPreview.url){
    previewFrame.src = currentPreview.url;
  }
};

refreshBtn.onclick = loadAndRender;
searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim().toLowerCase();
  renderGames(allGames.filter(g => g.name.toLowerCase().includes(q)));
});

async function loadAndRender(){
  status.textContent = 'Carregando...';
  try{
    allGames = await fetchGames();
    renderGames(allGames);
  }catch(err){
    console.error(err);
    status.textContent = 'Erro ao carregar jogos.';
  }
}

// inicializa
loadAndRender();
