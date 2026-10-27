'use strict';
const path = require('node:path');
const {getMessages,resolveLanguage}=require('./i18n.cjs');
const prompts = new Map();
const authContents = new WeakSet();
let registered = false;

function isAuthContents(contents) { return authContents.has(contents); }

function promptHttpAuth({ BrowserWindow, ipcMain, parent, contents, url, realm = '', language = 'en' }) {
  if (!contents || contents.isDestroyed() || prompts.size >= 3 || [...prompts.values()].some(p => p.owner === contents)) return Promise.resolve(null);
  if (!registered) {
    registered = true;
    ipcMain.on('nacre:http-auth:submit', (event, credentials) => {
      const prompt = prompts.get(event.sender.id);
      if (!prompt || event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== 'nacre://auth/') return;
      if (!credentials || typeof credentials.username !== 'string' || typeof credentials.password !== 'string' || credentials.username.length > 1024 || credentials.password.length > 4096) return prompt.finish(null);
      prompt.finish({ username: credentials.username, password: credentials.password });
    });
  }
  return new Promise(resolve => {
    const window = new BrowserWindow({ parent, modal: true, width: 480, height: 360, resizable: false, autoHideMenuBar: true, show: false,
      title: new URL(url).origin, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, preload: path.join(__dirname, 'http-auth-preload.cjs') } });
    authContents.add(window.webContents);
    const id = window.webContents.id;
    let done = false;
    const finish = value => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      prompts.delete(id);
      contents.removeListener('did-start-navigation', cancelOnNavigation);
      contents.removeListener('destroyed', cancel);
      resolve(value);
      if (!window.isDestroyed()) window.destroy();
    };
    const cancel = () => finish(null);
    const cancelOnNavigation = (_event, _url, _inPlace, isMainFrame) => { if (isMainFrame) cancel(); };
    const timer = setTimeout(cancel, 120000);
    prompts.set(id, { owner: contents, finish });
    contents.on('did-start-navigation', cancelOnNavigation);
    contents.once('destroyed', cancel);
    window.once('closed', cancel);
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('will-redirect', event => event.preventDefault());
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.once('did-finish-load', () => {
      window.webContents.send('nacre:http-auth:context', { origin: new URL(url).origin, realm: String(realm).slice(0, 200), language: resolveLanguage(language), messages: getMessages(language) });
      window.show();
    });
    window.loadURL('nacre://auth/').catch(cancel);
  });
}
module.exports = { promptHttpAuth, isAuthContents };
