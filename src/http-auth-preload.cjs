'use strict';
const { ipcRenderer } = require('electron');
let context;
ipcRenderer.on('nacre:http-auth:context', (_event, value) => {
  context = value;
  document.documentElement.lang = context.language || 'en';
  document.documentElement.dir = /^(?:ar|fa|he|ur|ps|sd|ckb|yi|dv)(?:-|$)/i.test(String(context.language || '')) ? 'rtl' : 'ltr';
  for (const node of document.querySelectorAll('[data-i18n]')) {
    const message = context.messages?.[node.dataset.i18n];
    if (typeof message === 'string') node.textContent = message;
  }
  for (const node of document.querySelectorAll('[data-i18n-attr]')) {
    for (const mapping of node.dataset.i18nAttr.split(';')) {
      const [attribute,key] = mapping.split(':',2);
      if (['title','aria-label','placeholder'].includes(attribute) && typeof context.messages?.[key] === 'string') node.setAttribute(attribute,context.messages[key]);
    }
  }
  document.querySelector('#origin').textContent = context.origin;
  document.querySelector('#realm').textContent = context.realm;
});
window.addEventListener('DOMContentLoaded', () => {
  document.querySelector('form').addEventListener('submit', event => {
    event.preventDefault();
    if (!event.isTrusted || !context) return;
    const password = document.querySelector('#password');
    ipcRenderer.send('nacre:http-auth:submit', { username: document.querySelector('#username').value, password: password.value });
    password.value = '';
  });
});
