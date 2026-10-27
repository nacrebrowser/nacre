'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Execute the production preload, including its asynchronous IPC/event wiring.
function localeHarness() {
  const calls = [], listeners = new Map(), events = new Map();
  const makeElement = attrs => ({ attrs, textContent: '',
    getAttribute(key) { return this.attrs[key]; },
    setAttribute(key,value) { this.attrs[key] = value; },
    set innerHTML(_) { throw new Error('Unsafe HTML insertion'); } });
  const text = makeElement({ 'data-i18n': 'fixture.text' });
  const attribute = makeElement({ 'data-i18n-attr': 'title:fixture.text;onclick:fixture.text' });
  const document = { readyState: 'complete',
    documentElement: { dataset: {}, style: { setProperty() {} } },
    querySelectorAll(selector) { return selector === '[data-i18n]' ? [text] : [attribute]; }
  };
  const window = {
    location: { href: 'nacre://settings/' },
    matchMedia: () => ({ addEventListener() {} }),
    addEventListener(name, fn) { if (!events.has(name)) events.set(name, []); events.get(name).push(fn); },
    dispatchEvent() {}
  };
  const api = {};
  const ipcRenderer = {
    on(channel, fn) { listeners.set(channel, fn); }, removeListener() {},
    async invoke(channel, language) {
      calls.push({ channel, language });
      if (channel === 'nacre:get-language') return 'fr';
      if (channel === 'nacre:get-messages') return { 'fixture.text': '<img src=x onerror=alert(1)>' };
      throw new Error('Unexpected IPC');
    }, send() { throw new Error('Translation must not send a writable IPC'); }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../src/preload.cjs'), 'utf8'), {
    require(name) { if(name !== 'electron') throw new Error(name); return { ipcRenderer, contextBridge: { exposeInMainWorld(name,value) { api[name] = value; } } }; },
    window, document, URL, CustomEvent: class {}, console
  });
  return { calls, text, attribute, document, api,
    async ready() { for(const fn of events.get('DOMContentLoaded') || []) fn(); await new Promise(setImmediate); await new Promise(setImmediate); }
  };
}
module.exports = { localeHarness };
