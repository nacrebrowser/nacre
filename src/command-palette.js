(function () {
  'use strict';

  const MAX_ROWS = 40;
  const MAX_QUERY = 200;
  const MAX_ITEMS = 5000;
  let nextId = 0;
  const fallback = {
  "title": "Commands and search",
  "placeholder": "Search tabs, bookmarks or commands…",
  "close": "Close",
  "hint": "↑ ↓ to select · Enter to open · Esc to close",
  "empty": "No results",
  "results": "result(s)",
  "limited": "First results",
  "action": "Command",
  "tab": "Tab",
  "bookmark": "Bookmark",
  "untitled": "Untitled",
  "newTab": "New tab",
  "newPrivate": "New private tab",
  "bookmarks": "Open bookmarks",
  "downloads": "Open downloads",
  "settings": "Open settings",
  "protection": "Open protection",
  "shortcuts": "Show keyboard shortcuts",
  "leakTests": "Open privacy tests",
  "network": "Network and Tor settings",
  "failed": "Could not run this command."
};

  function create(options = {}) {
    const { api = {}, getState = () => null, t, onOpen, onClose, actions = [] } = options;
    const prefix = 'nacre-commands-' + (++nextId);
    let opened = false;
    let opening = false;
    let generation = 0;
    let previousFocus = null;
    let rows = [];
    let selected = 0;

    function label(key) {
      const fullKey = 'commands.' + key;
      const translated = typeof t === 'function' ? t(fullKey) : null;
      return typeof translated === 'string' && translated !== fullKey ? translated : fallback[key] || key;
    }

    function element(tag, className, text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }

    const backdrop = element('div', 'command-palette-backdrop');
    backdrop.hidden = true;
    const dialog = element('section', 'command-palette');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', prefix + '-title');
    const header = element('div', 'command-palette-header');
    const title = element('h2', 'command-palette-title');
    title.id = prefix + '-title';
    const dismiss = element('button', 'command-palette-close', '×');
    dismiss.type = 'button';
    header.append(title, dismiss);
    const input = element('input', 'command-palette-input');
    input.type = 'text';
    input.maxLength = MAX_QUERY;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', prefix + '-list');
    input.setAttribute('aria-describedby', prefix + '-hint');
    const list = element('div', 'command-palette-list');
    list.id = prefix + '-list';
    list.setAttribute('role', 'listbox');
    const empty = element('p', 'command-palette-empty');
    const footer = element('div', 'command-palette-footer');
    const hint = element('span', 'command-palette-hint');
    hint.id = prefix + '-hint';
    const status = element('span', 'command-palette-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    footer.append(hint, status);
    dialog.append(header, input, list, empty, footer);
    backdrop.append(dialog);
    document.body.append(backdrop);

    function normalize(value) {
      return String(value || '').slice(0, 10000).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    }

    function candidates() {
      const state = getState() || {};
      const result = [];
      const builtins = [
        ['newTab', 'newTab'], ['newPrivate', 'newPrivateTab'], ['bookmarks', 'openBookmarks'],
        ['downloads', 'openDownloads'], ['settings', 'openSettingsTab'],
        ['protection', 'openProtectionDashboard'], ['shortcuts', 'openShortcuts'],
        ['leakTests', 'openLeakTests'], ['network', 'openSettingsTab']
      ];
      for (const [id, method] of builtins) {
        if (typeof api[method] === 'function') result.push({ key: 'action-' + id, title: label(id), detail: label('action'), run: () => api[method]() });
      }
      for (const action of Array.isArray(actions) ? actions.slice(0, 50) : []) {
        if (!action || typeof action.run !== 'function') continue;
        const text = typeof action.label === 'function' ? action.label(state) : action.label;
        if (typeof text !== 'string' || !text) continue;
        result.push({ key: 'custom-' + action.id, title: text, detail: label('action'), run: action.run });
      }
      const workspaces = Array.isArray(state.workspaces) ? state.workspaces : [];
      if (typeof api.activateTab === 'function') {
        for (const tab of (Array.isArray(state.tabs) ? state.tabs : []).slice(0, MAX_ITEMS)) {
          if (!tab || tab.id === undefined || tab.id === null) continue;
          const workspace = workspaces.find((item) => item && item.id === tab.workspaceId);
          const workspaceName = tab.workspaceName || (workspace && workspace.name) || '';
          const url = typeof tab.url === 'string' ? tab.url : '';
          const text = typeof tab.title === 'string' && tab.title ? tab.title : url || label('untitled');
          result.push({ key: 'tab-' + tab.id, title: text,
            detail: [label('tab'), workspaceName, url].filter(Boolean).join(' · '),
            run: () => api.activateTab(tab.id) });
        }
      }
      if (typeof api.navigate === 'function') {
        for (const bookmark of (Array.isArray(state.bookmarks) ? state.bookmarks : []).slice(0, MAX_ITEMS)) {
          if (!bookmark || typeof bookmark.url !== 'string' || !bookmark.url) continue;
          const url = bookmark.url;
          result.push({ key: 'bookmark-' + url, title: bookmark.title || url,
            detail: label('bookmark') + ' · ' + url, run: () => api.navigate(url) });
        }
      }
      return result;
    }

    function updateSelection(scroll) {
      const nodes = list.children;
      for (let index = 0; index < nodes.length; index++) {
        nodes[index].setAttribute('aria-selected', String(index === selected));
      }
      if (nodes[selected]) {
        input.setAttribute('aria-activedescendant', nodes[selected].id);
        if (scroll) nodes[selected].scrollIntoView({ block: 'nearest' });
      } else input.removeAttribute('aria-activedescendant');
    }

    function refresh() {
      if (!opened) return;
      title.textContent = label('title');
      dismiss.setAttribute('aria-label', label('close'));
      input.placeholder = label('placeholder');
      input.setAttribute('aria-label', label('title'));
      list.setAttribute('aria-label', label('title'));
      hint.textContent = label('hint');
      empty.textContent = label('empty');
      const selectedKey = rows[selected] && rows[selected].key;
      const words = normalize(input.value.slice(0, MAX_QUERY)).trim().split(/\s+/).filter(Boolean);
      const matches = candidates().filter((row) => {
        const haystack = normalize(row.title + ' ' + row.detail);
        return words.every((word) => haystack.includes(word));
      });
      rows = matches.slice(0, MAX_ROWS);
      selected = Math.max(0, rows.findIndex((row) => row.key === selectedKey));
      list.replaceChildren();
      rows.forEach((row, index) => {
        const option = element('div', 'command-palette-option');
        option.id = prefix + '-option-' + index;
        option.setAttribute('role', 'option');
        option.append(element('span', 'command-palette-option-title', row.title), element('span', 'command-palette-option-detail', row.detail));
        option.addEventListener('pointerdown', (event) => event.preventDefault());
        option.addEventListener('click', () => execute(index));
        list.append(option);
      });
      empty.hidden = rows.length > 0;
      status.textContent = matches.length > MAX_ROWS ? label('limited') + ' (' + MAX_ROWS + ')' : rows.length + ' ' + label('results');
      updateSelection(false);
    }

    function close() {
      if (!opened && !opening) return;
      const wasOpen = opened || opening;
      generation++;
      opening = false;
      opened = false;
      backdrop.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      input.value = '';
      rows = [];
      selected = 0;
      list.replaceChildren();
      status.textContent = '';
      const focus = previousFocus;
      previousFocus = null;
      try {
        if (wasOpen && typeof onClose === 'function') onClose();
      } finally {
        if (focus && focus.isConnected && typeof focus.focus === 'function') focus.focus({ preventScroll: true });
      }
    }

    async function open() {
      if (opened) { input.focus(); return; }
      if (opening) return;
      opening = true;
      const token = ++generation;
      previousFocus = document.activeElement;
      try {
        if (typeof onOpen === 'function') await onOpen();
        if (token !== generation) return;
        opening = false;
        opened = true;
        input.value = '';
        refresh();
        backdrop.hidden = false;
        input.setAttribute('aria-expanded', 'true');
        input.focus({ preventScroll: true });
      } catch (error) {
        if (token === generation) close();
        throw error;
      }
    }

    function execute(index) {
      const row = rows[index];
      if (!row) return;
      const run = row.run;
      close();
      // IPC commands currently return void; handle future promise-based actions too.
      try {
        Promise.resolve(run()).catch(() => {
          window.dispatchEvent(new CustomEvent('nacre:command-error', { detail: label('failed') }));
        });
      } catch {
        window.dispatchEvent(new CustomEvent('nacre:command-error', { detail: label('failed') }));
      }
    }

    input.addEventListener('input', () => { selected = 0; rows = []; refresh(); });
    dismiss.addEventListener('click', close);
    backdrop.addEventListener('click', (event) => { if (event.target === backdrop) close(); });
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); close();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); event.stopPropagation();
        if (rows.length) selected = (selected + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
        input.focus(); updateSelection(true);
      } else if (event.key === 'Enter' && event.target === input && !event.isComposing) {
        event.preventDefault(); event.stopPropagation(); execute(selected);
      } else if (event.key === 'Tab') {
        event.preventDefault(); event.stopPropagation();
        (document.activeElement === input ? dismiss : input).focus();
      }
    });
    // Native views are hidden by the parent. Keep focus inside the visible modal.
    document.addEventListener('focusin', (event) => {
      if (opened && !dialog.contains(event.target)) input.focus({ preventScroll: true });
    });

    return Object.freeze({ open, close, refresh, isOpen: () => opened || opening });
  }

  window.NacreCommands = Object.freeze({ create });
})();
