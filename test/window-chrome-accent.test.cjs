'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = path.join(__dirname, '..', 'src');
const read = (name) => fs.readFileSync(path.join(source, name), 'utf8');

function cssRule(css, selector) {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `CSS rule exists for ${selector}`);
  const end = css.indexOf('}', start);
  assert.notEqual(end, -1, `CSS rule closes for ${selector}`);
  return css.slice(start, end);
}

test('blank tab strip is draggable while tab controls stay interactive', () => {
  const css = read('styles.css');
  const row = cssRule(css, '.tab-row');
  const list = cssRule(css, '.tab-list');
  const tab = cssRule(css, '.tab');
  const controlsStart = css.indexOf('.tab-row button,');
  const controlsEnd = css.indexOf('.tab-list {', controlsStart);
  assert.notEqual(controlsStart, -1);
  assert.notEqual(controlsEnd, -1);
  const controls = css.slice(controlsStart, controlsEnd);

  assert.match(row, /height:\s*40px/);
  assert.match(row, /-webkit-app-region:\s*drag/);
  assert.match(list, /-webkit-app-region:\s*drag/);
  assert.match(tab, /-webkit-app-region:\s*no-drag/);
  assert.match(controls, /-webkit-app-region:\s*no-drag/);
  assert.doesNotMatch(controls, /\.tab-list/);
});

test('saved custom accent reaches toolbar and settings accent tokens', () => {
  const renderer = read('renderer.js');
  const theme = read('theme.css');
  const settings = read('settings.js');
  const settingsCss = read('settings.css');
  const settingsHtml = read('settings.html');
  const indexHtml = read('index.html');
  const preload = read('preload.cjs');

  assert.match(indexHtml, /id="tab-list" class="tab-list" role="tablist"/);
  assert.match(renderer, /item\.setAttribute\('role', 'tab'\)/);
  assert.match(settingsHtml, /data-pref="accent"\s+type="color"/);
  assert.match(settings, /element\.type === 'color' \? 'change'/);
  assert.match(settings, /setProperty\('--accent', prefs\.accent\)/);
  assert.match(renderer, /setProperty\('--accent', state\.settings\.accent/);
  assert.match(preload, /--mint/, 'the legacy appearance preload still feeds the --accent alias');
  assert.match(theme, /--accent:\s*var\(--mint\)/);
  assert.match(theme, /--accent-solid:\s*color-mix\(in srgb, var\(--accent\)/);
  assert.match(theme, /--accent-text:\s*color-mix\(in srgb, var\(--accent\)/);
  assert.match(theme, /--accent-hover:\s*color-mix\(in srgb, var\(--accent\)/);
  assert.match(settingsCss, /var\(--accent\)/);
});
