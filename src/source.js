const api = window.nacre;
const target = new URLSearchParams(location.search).get('url') || '';
document.querySelector('#source-url').textContent = target;
let sourceResult;
let sourceFailure;
function renderStatus() {
  if (sourceResult) document.querySelector('#source-status').textContent = `HTTP ${sourceResult.status}${sourceResult.truncated ? api.getLocaleText('source.truncated') : ''}`;
  if (sourceFailure) {
    document.querySelector('#source-status').textContent = api.getLocaleText('source.failed');
    document.querySelector('#source-code').textContent = api.localizeText(sourceFailure);
  }
}
(async () => {
  try {
    const result = await api.getSource(target);
    sourceResult = result; renderStatus();
    document.querySelector('#source-code').textContent = result.text;
  } catch (error) {
    sourceFailure = error && error.message ? error.message : api.getLocaleText('common.operationFailed'); renderStatus();
  }
})();
window.addEventListener('nacre:locale-ready', renderStatus);
api.onState((state) => {
  const theme = state.settings.theme === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : state.settings.theme;
  document.body.dataset.theme = theme;
});
