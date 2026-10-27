const api = window.nacre;
const root = document.querySelector('#items');
const status = document.querySelector('#status');
let items = [];
let dragged = -1;

async function persist() {
  try { await api.saveBookmarks(items); status.textContent = api.getLocaleText("ui.bookmarksjs.text166301d01b"); setTimeout(() => { status.textContent = ''; }, 1200); }
  catch { status.textContent = api.getLocaleText("ui.bookmarksjs.text8427c0b5a4"); }
}

function field(value, placeholder, change) {
  const input = document.createElement('input'); input.value = value || ''; input.placeholder = placeholder; input.addEventListener('change', () => { change(input.value); persist(); }); return input;
}

function render() {
  root.replaceChildren();
  if (!items.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = api.getLocaleText("ui.bookmarksjs.textbaaabc052f"); root.append(empty); return; }
  items.forEach((item, index) => {
    const row = document.createElement('article'); row.className = 'bookmark'; row.draggable = true;
    const link = document.createElement('a'); link.href = item.url; link.textContent = item.title || item.url; link.title = item.url;
    link.addEventListener('click', (event) => { event.preventDefault(); api.navigate(item.url); });
    row.append(link, field(item.title, api.getLocaleText("ui.bookmarksjs.text78e7920010"), (value) => { item.title = value.slice(0, 200); }));
    row.append(field(item.url, api.getLocaleText("ui.bookmarksjs.text4b0f814236"), (value) => { item.url = value; }));
    row.append(field(item.folder, api.getLocaleText("ui.bookmarksjs.text2cdf175d11"), (value) => { item.folder = value.slice(0, 80); }));
    const remove = document.createElement('button'); remove.className = 'remove'; remove.textContent = api.getLocaleText("common.remove"); remove.addEventListener('click', () => { items.splice(index, 1); render(); persist(); }); row.append(remove);
    row.addEventListener('dragstart', () => { dragged = index; });
    row.addEventListener('dragover', (event) => event.preventDefault());
    row.addEventListener('drop', (event) => { event.preventDefault(); if (dragged < 0 || dragged === index) return; const [move] = items.splice(dragged, 1); items.splice(index, 0, move); dragged = -1; render(); persist(); });
    root.append(row);
  });
}

async function load() { try { items = await api.getBookmarks(); render(); } catch { status.textContent = api.getLocaleText("ui.bookmarksjs.text225b287844"); } }
document.querySelector('#import').addEventListener('click', async () => { try { const result = await api.importBookmarks(); if (!result.cancelled) status.textContent = api.getLocaleText('bookmarks.imported').replace('{count}', new Intl.NumberFormat(document.documentElement.lang).format(result.imported)); load(); } catch(error) { status.textContent = api.localizeText(error.message); } });
document.querySelector('#export').addEventListener('click', async () => { try { const result = await api.exportBookmarks(); if (!result.cancelled) status.textContent = api.getLocaleText('bookmarks.exported').replace('{count}', new Intl.NumberFormat(document.documentElement.lang).format(result.exported)); } catch(error) { status.textContent = api.localizeText(error.message); } });
window.addEventListener('nacre:locale-ready', render);
api.onState(load);
load();
