const api = window.nacre;
const card = document.querySelector('#share-card');
const empty = document.querySelector('#empty');
const status = document.querySelector('#status');
const titleNode = document.querySelector('#share-title');
const urlNode = document.querySelector('#share-url');
const qrNode = document.querySelector('#qr');
let clearTimer;

function setTheme(state) {
  const theme = state.settings.theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : state.settings.theme;
  document.body.dataset.theme = theme;
}

function renderQr(value) {
  qrNode.replaceChildren();
  if (typeof qrcode !== 'function') throw new Error('QR generator unavailable');
  const qr = qrcode(0, 'M');
  qr.addData(value);
  qr.make();
  const count = qr.getModuleCount();
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 ' + count + ' ' + count);
  svg.setAttribute('role', 'img');
  svg.setAttribute('shape-rendering', 'crispEdges');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  const parts = [];
  for (let row = 0; row < count; row += 1) {
    let column = 0;
    while (column < count) {
      if (!qr.isDark(row, column)) { column += 1; continue; }
      const start = column;
      while (column < count && qr.isDark(row, column)) column += 1;
      parts.push('M' + start + ' ' + row + 'h' + (column - start) + 'v1h-' + (column - start) + 'z');
    }
  }
  path.setAttribute('d', parts.join(''));
  path.setAttribute('fill', 'currentColor');
  svg.append(path);
  qrNode.append(svg);
}

async function load() {
  try {
    const info = await api.getShare();
    if (!info || typeof info.url !== 'string') {
      card.hidden = true;
      empty.hidden = false;
      return;
    }
    titleNode.textContent = info.title || info.url;
    urlNode.textContent = info.url;
    card.hidden = false;
    empty.hidden = true;
    if (info.url.length > 2000) {
      card.hidden = true;
      empty.textContent = api.getLocaleText('share.tooLong');
      empty.hidden = false;
      return;
    }
    try { renderQr(info.url); }
    catch {
      card.hidden = true;
      empty.textContent = api.getLocaleText('share.tooLong');
      empty.hidden = false;
    }
  } catch {
    card.hidden = true;
    empty.textContent = api.getLocaleText('share.unavailable');
    empty.hidden = false;
  }
}

document.querySelector('#copy').addEventListener('click', async () => {
  try {
    const copied = await api.copyShare();
    if (!copied) return;
    status.textContent = api.getLocaleText('share.copied');
    window.clearTimeout(clearTimer);
    clearTimer = window.setTimeout(() => { status.textContent = ''; }, 2200);
  } catch {
    status.textContent = api.getLocaleText('common.operationFailed');
  }
});

document.querySelector('#close').addEventListener('click', () => api.closeShare());
api.onState(setTheme);
window.addEventListener('nacre:locale-ready', load);
load();
