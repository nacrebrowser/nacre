'use strict';
const { contextBridge, ipcRenderer } = require('electron');
let channel;
contextBridge.exposeInMainWorld('vaultPrompt', {
  onContext: callback => ipcRenderer.once('vault-context', (_event, context) => { channel = context.channel; callback({ confirm: context.confirm, message: context.message }); }),
  submit: value => channel ? ipcRenderer.invoke(channel, value) : Promise.resolve(false)
});
