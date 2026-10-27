const api = window.nacre;
const article = document.querySelector('#reader');
const status = document.querySelector('#reader-status');
const titleNode = document.querySelector('#reader-title');
const metaNode = document.querySelector('#reader-meta');
const content = document.querySelector('#reader-content');
const truncated = document.querySelector('#reader-truncated');
let scale = 1;

function setTheme(state) {
  const theme = state.settings.theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : state.settings.theme;
  document.body.dataset.theme = theme;
}

function number(value) {
  return new Intl.NumberFormat(document.documentElement.lang || 'en').format(Number(value) || 0);
}

function renderBlocks(blocks) {
  content.replaceChildren();
  let list = null;
  for (const block of blocks) {
    if (block.type === 'li') {
      if (!list) { list = document.createElement('ul'); content.append(list); }
      const item = document.createElement('li');
      item.textContent = block.text;
      list.append(item);
      continue;
    }
    list = null;
    let node;
    if (block.type === 'h1' || block.type === 'h2' || block.type === 'h3') {
      node = document.createElement(block.type);
    } else if (block.type === 'blockquote') {
      node = document.createElement('blockquote');
      const paragraph = document.createElement('p');
      paragraph.textContent = block.text;
      node.append(paragraph);
      content.append(node);
      continue;
    } else if (block.type === 'pre') {
      node = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = block.text;
      node.append(code);
      content.append(node);
      continue;
    } else {
      node = document.createElement('p');
    }
    node.textContent = block.text;
    content.append(node);
  }
}

async function load() {
  try {
    const data = await api.getReader();
    if (!data || !Array.isArray(data.blocks) || !data.blocks.length) {
      status.textContent = api.getLocaleText('reader.empty');
      return;
    }
    status.hidden = true;
    article.hidden = false;
    document.title = data.title + ' — Nacre';
    titleNode.textContent = data.title;
    if (data.lang) article.lang = data.lang;
    const meta = [];
    if (data.site) meta.push(data.site);
    if (data.byline) meta.push(api.getLocaleText('reader.byline').replace('{author}', data.byline));
    meta.push(api.getLocaleText('reader.minutes').replace('{count}', number(data.minutes)));
    metaNode.textContent = meta.join(' · ');
    renderBlocks(data.blocks);
    truncated.hidden = !data.truncated;
  } catch {
    status.textContent = api.getLocaleText('reader.empty');
  }
}

function updateScale() {
  document.documentElement.style.setProperty('--reader-scale', String(scale));
}
document.querySelector('#smaller').addEventListener('click', () => { scale = Math.max(0.9, Number((scale - 0.1).toFixed(1))); updateScale(); });
document.querySelector('#larger').addEventListener('click', () => { scale = Math.min(1.5, Number((scale + 0.1).toFixed(1))); updateScale(); });
document.querySelector('#exit').addEventListener('click', () => api.exitReader());
document.querySelector('#exit-bottom').addEventListener('click', () => api.exitReader());
window.addEventListener('keydown', (event) => { if (event.key === 'Escape') api.exitReader(); });
api.onState(setTheme);
window.addEventListener('nacre:locale-ready', load);
load();
