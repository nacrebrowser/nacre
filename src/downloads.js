const api = window.nacre;
const $ = (selector) => document.querySelector(selector);
let latest = null;
const DOWNLOAD_STATES = new Set(['waiting', 'choosing', 'confirming', 'downloading', 'paused', 'interrupted', 'completed', 'cancelled', 'failed']);
function format(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) bytes = 0;
  if (bytes < 1024) return api.getLocaleText('downloads.bytes').replace('{count}', new Intl.NumberFormat(document.documentElement.lang).format(bytes));
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024, index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index++; }
  return `${new Intl.NumberFormat(document.documentElement.lang, {maximumFractionDigits:1}).format(value)} ${units[index]}`;
}
function render(state) {
  latest = state;
  const settings = state.settings;
  const theme = settings.theme === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : settings.theme;
  document.body.dataset.theme = theme;
  const container = $('#download-list');
  container.replaceChildren();
  const list = state.downloads || [];
  $('#empty').hidden = list.length > 0;
  for (const download of [...list].reverse()) {
    const card = document.createElement('article');
    card.className = 'download';
    const head = document.createElement('div'); head.className = 'download-head';
    const title = document.createElement('div'); title.className = 'name'; title.textContent = download.filename;
    if (download.private) { const badge = document.createElement('span'); badge.className = 'private'; badge.textContent = api.getLocaleText("ui.downloadsjs.texta1c1e01b80"); title.append(badge); }
    const status = document.createElement('span'); status.className = 'state'; status.textContent = DOWNLOAD_STATES.has(download.state) ? api.getLocaleText('downloadState.' + download.state) : '';
    head.append(title, status);
    const meta = document.createElement('div'); meta.className = 'meta';
    meta.textContent = download.total ? api.getLocaleText('downloads.totalBytes').replace('{received}', format(download.received)).replace('{total}', format(download.total)) : format(download.received);
    const track = document.createElement('div'); track.className = 'track';
    const fill = document.createElement('i');
    fill.style.width = (download.total ? Math.min(100, download.received / download.total * 100) : download.state === 'completed' ? 100 : 0) + '%';
    track.append(fill);
    const actions = document.createElement('div'); actions.className = 'actions';
    const addAction = (label, action) => { const button = document.createElement('button'); button.textContent = label; button.addEventListener('click', () => api.downloadAction(download.id, action)); actions.append(button); };
    if (download.state === 'completed') { addAction(api.getLocaleText("ui.downloadsjs.text9fb440435a"), 'open'); addAction(api.getLocaleText("ui.downloadsjs.text41be79fbf6"), 'folder'); }
    else if (download.state === 'downloading') { addAction(api.getLocaleText("ui.downloadsjs.text42dd586c06"), 'pause'); addAction(api.getLocaleText("common.cancel"), 'cancel'); }
    else if (download.state === 'paused' || download.state === 'interrupted') { addAction(api.getLocaleText("ui.downloadsjs.textddd913203f"), 'resume'); addAction(api.getLocaleText("common.cancel"), 'cancel'); }
    else if (download.hasPath) addAction(api.getLocaleText("ui.downloadsjs.text41be79fbf6"), 'folder');
    card.append(head, meta, track, actions);
    container.append(card);
  }
}
$('#open-folder').addEventListener('click', () => api.downloadAction(-1, 'folder-root'));
api.onState(render);
window.addEventListener('nacre:locale-ready', () => { if (latest) render(latest); });
