const api = window.nacre;
const warning = document.querySelector('#warning');
const unavailable = document.querySelector('#unavailable');
const unavailableBack = document.querySelector('#unavailable-back');
const urlNode = document.querySelector('#phishing-url');
const reasonsNode = document.querySelector('#phishing-reasons');
const continueButton = document.querySelector('#continue');
const backButton = document.querySelector('#back');
let armed = false;
let armTimer;
let targetHost = '';

const REASON_KEYS = {
  'public-feed': 'phishing.reasonPublicFeed',
  blocklist: 'phishing.reasonBlocklist',
  idn: 'phishing.reasonIdn',
  'ip-literal': 'phishing.reasonIp',
  brand: 'phishing.reasonBrand',
  'risky-tld': 'phishing.reasonTld',
  subdomains: 'phishing.reasonSubdomains'
};

function disarm() {
  armed = false;
  window.clearTimeout(armTimer);
  continueButton.classList.remove('is-armed');
  continueButton.textContent = api.getLocaleText('phishing.continue');
  continueButton.removeAttribute('aria-label');
}

function showUnavailable() {
  warning.hidden = true;
  unavailable.hidden = false;
  unavailableBack.hidden = false;
}

async function load() {
  try {
    const notice = await api.getPhishing();
    if (!notice || typeof notice.url !== 'string') { showUnavailable(); return; }
    try { targetHost = new URL(notice.url).hostname; } catch { targetHost = ''; }
    urlNode.textContent = notice.url;
    reasonsNode.replaceChildren();
    for (const reason of Array.isArray(notice.reasons) ? notice.reasons : []) {
      const key = REASON_KEYS[reason];
      if (!key) continue;
      const item = document.createElement('li');
      item.textContent = api.getLocaleText(key);
      reasonsNode.append(item);
    }
    warning.hidden = false;
    unavailable.hidden = true;
  } catch {
    showUnavailable();
  }
}

backButton.addEventListener('click', () => api.cancelPhishing());
unavailableBack.addEventListener('click', () => api.cancelPhishing());
continueButton.addEventListener('click', () => {
  if (!armed) {
    armed = true;
    continueButton.classList.add('is-armed');
    continueButton.textContent = api.getLocaleText('phishing.continueConfirm').replace('{host}', targetHost || api.getLocaleText('phishing.thisSite'));
    window.clearTimeout(armTimer);
    armTimer = window.setTimeout(disarm, 5000);
    return;
  }
  disarm();
  api.continuePhishing();
});
window.addEventListener('nacre:locale-ready', () => { if (!armed) disarm(); load(); });
load();
