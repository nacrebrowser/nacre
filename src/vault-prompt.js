'use strict';
let confirmPassword = false;
window.vaultPrompt.onContext(context => {
  confirmPassword = context.confirm;
  document.querySelector('#confirmation').hidden = !confirmPassword;
  document.querySelector('#message').textContent = context.message;
  document.querySelector('#password').focus();
});
document.querySelector('form').addEventListener('submit', async event => {
  event.preventDefault(); const password = document.querySelector('#password'); const repeat = document.querySelector('#repeat');
  if (confirmPassword && (password.value.length < 12 || password.value !== repeat.value)) { document.querySelector('#error').textContent = 'Use at least 12 characters and enter the same password twice.'; return; }
  const value = password.value; password.value = ''; repeat.value = '';
  await window.vaultPrompt.submit(value);
});
document.querySelector('#cancel').addEventListener('click', () => window.vaultPrompt.submit(null));
