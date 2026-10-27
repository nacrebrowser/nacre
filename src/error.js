const api = window.nacre;
const params = new URLSearchParams(location.search);
const target = params.get('url') || '';
const reason = params.get('reason') || 'network';
let preferredCountry = 'AUTO';
const text = (key) => api.getLocaleText(key);
const $ = (selector) => document.querySelector(selector);

// One place decides every visible string, so the first paint and a later
// language change always agree.
function paint() {
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    const key = element.getAttribute('data-i18n');
    if (key) element.textContent = text(key);
  });
  $('#target').textContent = target;
  $('#fix-dns').hidden = reason !== 'dns-strict';
  if (reason === 'tor-stopped') {
    $('#title').textContent = text('error.torStoppedTitle');
    $('#message').textContent = text('error.torStoppedMessage');
    $('#code').textContent = text('error.torStoppedCode');
    $('#retry').textContent = text('error.torStoppedRetry');
    $('#offline').hidden = true;
    $('#note').textContent = text('error.torStoppedNote');
  } else if (reason.startsWith('certificate:')) {
    $('#title').textContent = text('error.certificateTitle');
    $('#message').textContent = text('error.certificateMessage');
    $('#code').textContent = text('error.certificateCode') + reason.slice('certificate:'.length);
  } else if (reason === 'dns-strict') {
    $('#title').textContent = text('error.dnsStrictTitle');
    $('#message').textContent = text('error.dnsStrictMessage');
    $('#code').textContent = text('error.networkCode') + (params.get('code') || '');
    $('#note').textContent = text('error.dnsStrictNote');
  } else {
    $('#code').textContent = reason === 'network' ? text('error.networkCode') + (params.get('code') || '') : text('error.genericCode') + reason;
  }
}

paint();
$('#retry').addEventListener('click', () => {
  if (reason === 'tor-stopped') api.connectTor(preferredCountry);
  else api.navigate(target);
});
$('#fix-dns').addEventListener('click', () => {
  api.savePreferences({ secureDnsMode: 'automatic' });
  if (target) window.setTimeout(() => api.navigate(target), 150);
});
$('#home').addEventListener('click', () => api.newTab());
$('#offline').addEventListener('click', () => api.openOffline());
window.addEventListener('nacre:locale-ready', paint);
api.onState((state) => {
  const theme = state.settings.theme === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : state.settings.theme;
  document.body.dataset.theme = theme;
  preferredCountry = state.settings.proxy.torPreferredCountry || state.settings.proxy.torCountry || 'AUTO';
});
