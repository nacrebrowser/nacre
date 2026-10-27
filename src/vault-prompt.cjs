'use strict';
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const crypto = require('node:crypto');
let pending = false;
function promptVault({ BrowserWindow, ipcMain, parent, confirm = false, message = '' }) {
  if (pending) return Promise.resolve(null);
  pending = true;
  return new Promise(resolve => {
    const url = pathToFileURL(path.join(__dirname, 'vault-prompt.html')).href;
    const channel = 'vault-prompt:' + crypto.randomBytes(16).toString('hex');
    const window = new BrowserWindow({ parent, modal: Boolean(parent), width: 510, height: 430, resizable: false, autoHideMenuBar: true, show: false,
      title: 'Nacre settings vault', webPreferences: { preload: path.join(__dirname, 'vault-prompt-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });
    let finished = false;
    const finish = value => { if (finished) return; finished = true; pending = false; clearTimeout(timer); ipcMain.removeHandler(channel); resolve(value); if (!window.isDestroyed()) window.destroy(); };
    const timer = setTimeout(() => finish(null), 180000);
    ipcMain.handle(channel, (event, value) => {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== url) return false;
      if (value !== null && (typeof value !== 'string' || value.length > 1024)) return false;
      finish(value); return true;
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('will-redirect', event => event.preventDefault());
    window.once('closed', () => finish(null));
    window.webContents.once('did-finish-load', () => { window.webContents.send('vault-context', { channel, confirm, message }); window.show(); });
    window.loadURL(url).catch(() => finish(null));
  });
}
module.exports = { promptVault };
