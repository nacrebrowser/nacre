(function () {
  'use strict';
  // First-run screen: import bookmarks from the other browsers on this PC and
  // choose the services that should stay signed in. Also reachable later from
  // the menu ("Import from another browser…").
  const api = window.nacre, chromeUI = window.NacreChrome;
  let state = null, messages = {}, language = '', shownOnce = false;
  const t = key => messages[key] || key;
  const format = (key, values) => Object.entries(values).reduce((text, [name, value]) => text.replaceAll('{' + name + '}', value), t(key));
  function node(tag, className, text) { const e = document.createElement(tag); if (className) e.className = className; if (text !== undefined) e.textContent = text; return e; }
  function action(label, run, primary) {
    const e = node('button', primary ? 'welcome-button welcome-primary' : 'welcome-button', label); e.type = 'button';
    e.addEventListener('click', () => Promise.resolve().then(run).catch(() => {})); return e;
  }

  function importSection(full) {
    const section = node('section', 'welcome-section');
    section.append(node('h3', '', t('import.title')), node('p', 'welcome-note', t('import.note')));
    const list = node('div', 'welcome-sources'); const status = node('p', 'welcome-status'); status.setAttribute('role', 'status');
    if (state.settings.iconTorBackground) section.append(node('p', 'welcome-note', t('import.iconTor')));
    section.append(list, status);
    list.append(node('p', 'welcome-note', '…'));
    api.getImportSources().then(sources => {
      list.replaceChildren();
      if (!sources.length) list.append(node('p', 'welcome-note', t('import.none')));
      for (const source of sources) {
        const label = source.profile ? source.browser + ' — ' + source.profile : source.browser;
        const button = action(label, async () => {
          button.disabled = true; status.textContent = '…';
          try {
            const result = await api.importFromBrowser(source.id);
            const count = new Intl.NumberFormat(document.documentElement.lang).format(result.imported);
            const bookmarksText = !result.imported ? (result.icons ? '' : t('import.nothingNew')) : format(result.full ? 'import.doneFull' : 'import.done', { count, browser: source.browser });
            const iconsText = result.icons ? format('import.icons', { count: new Intl.NumberFormat(document.documentElement.lang).format(result.icons) }) : '';
            status.textContent = [bookmarksText, iconsText].filter(Boolean).join(' ') || t('import.nothingNew');
            button.classList.add('is-done');
          } catch (error) { status.textContent = api.localizeText(error?.message) || t('import.failed'); button.disabled = false; }
        });
        button.classList.add('welcome-source');
        list.append(button);
      }
      if (full) list.append(action(t('import.htmlFile'), async () => {
        const result = await api.importBookmarks();
        if (!result.cancelled) status.textContent = t('bookmarks.imported').replace('{count}', new Intl.NumberFormat(document.documentElement.lang).format(result.imported));
      }));
    }).catch(() => { list.replaceChildren(node('p', 'welcome-note', t('import.none'))); });
    return section;
  }

  function trustedSection() {
    const section = node('section', 'welcome-section');
    section.append(node('h3', '', t('trusted.title')), node('p', 'welcome-note', t('trusted.note')));
    const grid = node('div', 'welcome-presets');
    const enabled = new Set(state.settings.trustedPresetsEnabled || []);
    const boxes = [];
    for (const preset of state.settings.trustedPresets || []) {
      const label = node('label', 'welcome-preset'); const box = node('input'); box.type = 'checkbox'; box.value = preset.id; box.checked = enabled.has(preset.id);
      box.addEventListener('change', () => api.trustedSites({ action: 'presets', ids: boxes.filter(item => item.checked).map(item => item.value) }).catch(() => {}));
      boxes.push(box); label.append(box, node('span', '', preset.name)); grid.append(label);
    }
    section.append(grid, node('p', 'welcome-note welcome-drm', t('trusted.drm')));
    return section;
  }

  function supportSection() {
    const section = node('section', 'welcome-section');
    section.append(node('h3', '', t('support.title')), node('p', 'welcome-note', t('support.note')), action(t('support.donate'), () => api.openDonation()));
    return section;
  }

  async function open(kind) {
    if (!state || document.querySelector('.experience-dialog[open]')) return;
    const dialog = node('dialog', 'experience-dialog welcome-dialog'); dialog.id = 'welcome-dialog';
    const welcome = kind === 'welcome';
    dialog.append(node('h2', '', t(welcome ? 'welcome.title' : 'import.dialogTitle')));
    if (welcome) dialog.append(node('p', 'welcome-note', t('welcome.intro')));
    dialog.append(importSection(!welcome));
    if (welcome) dialog.append(trustedSection(), supportSection());
    const footer = node('div', 'welcome-footer');
    footer.append(action(t(welcome ? 'welcome.finish' : 'commands.close'), () => dialog.close(), true));
    dialog.append(footer);
    dialog.addEventListener('close', () => {
      dialog.remove(); chromeUI.endOverlay();
      if (welcome) api.finishWelcome().catch(() => {});
    });
    document.body.append(dialog);
    await chromeUI.beginOverlay(); dialog.showModal();
  }

  window.NacreWelcome = Object.freeze({ openImport: () => open('import').catch(() => {}) });
  api.onState(next => {
    state = next;
    if (language !== next.settings.language) {
      language = next.settings.language;
      api.getMessages(language).then(map => { messages = map; maybeWelcome(); }).catch(() => {});
    } else maybeWelcome();
  });
  function maybeWelcome() {
    if (shownOnce || !state || state.settings.welcomeDone || !Object.keys(messages).length || state.active?.private) return;
    shownOnce = true;
    open('welcome').catch(() => {});
  }
})();
