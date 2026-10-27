'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadMainHeadless } = require('../scripts/red-team/harness/electron-stub.cjs');

const expected = {
  en: ['File', 'Duplicate tab', 'Copy tab address', 'Mute other tabs'],
  fr: ['Fichier', 'Dupliquer l’onglet', 'Copier l’adresse de l’onglet', 'Couper le son des autres onglets'],
  de: ['Datei', 'Tab duplizieren', 'Tab-Adresse kopieren', 'Andere Tabs stummschalten'],
  es: ['Archivo', 'Duplicar pestaña', 'Copiar dirección de la pestaña', 'Silenciar las demás pestañas']
};

test('changing the interface language immediately rebuilds native menus and persists the selection', async () => {
  const h = await loadMainHeadless();
  const event = { sender: h.chrome, senderFrame: h.chrome.mainFrame };
  let template, applicationMenu;
  h.electron.Menu.buildFromTemplate = (items) => {
    template = items;
    return { items, popup() {} };
  };
  h.electron.Menu.setApplicationMenu = (menu) => { applicationMenu = menu; };
  for (const language of ['fr', 'de', 'es', 'en']) {
    h.ipcHandlers.get('nacre:update-preferences').fn(event, { language });
    assert.equal(h.ipcHandlers.get('nacre:get-language').fn(event), language);
    assert.ok(applicationMenu, 'language change rebuilds the native application menu');
    assert.equal(applicationMenu.items[0].label, expected[language][0]);
    const stored = require('../src/profile-integrity.cjs').createProfileIntegrity(h.state.userData, h.electron.safeStorage).open('settings', require('node:fs').readFileSync(require('node:path').join(h.state.userData, 'settings.json'), 'utf8'));
    assert.equal(stored.language, language);
    const state = h.sends.filter((send) => send.channel === 'nacre:state').at(-1).args[0];
    h.ipcHandlers.get('nacre:tab-context').fn(event, state.activeId);
    const labels = template.map((entry) => entry.label);
    for (const label of expected[language].slice(1)) assert.ok(labels.includes(label), `${language}: ${label}`);
  }
});
