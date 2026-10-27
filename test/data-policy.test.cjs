'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { clearDataTypesForSelection, sanitizeDownloadFilename, isRiskyOpenDownload, canRemoveDownloadRecord, publicDownloadRecord } = require('../src/data-policy.cjs');

test('la sélection de données devient une liste explicite pour Electron', () => {
  assert.deepEqual(clearDataTypesForSelection(['cookies', 'siteData']), [
    'cookies', 'indexedDB', 'localStorage', 'fileSystems', 'serviceWorkers', 'webSQL', 'backgroundFetch'
  ]);
  assert.deepEqual(clearDataTypesForSelection(['cache']), ['cache']);
  assert.deepEqual(clearDataTypesForSelection(['downloads', 'filterCache']), []);
});

test('assainit les noms de fichiers pour Windows et neutralise les chemins', () => {
  assert.equal(sanitizeDownloadFilename('..\\..\\CON.txt'), '_CON.txt');
  assert.equal(sanitizeDownloadFilename('C:\\ProfileFixture\\Desktop\\bad:name.exe'), 'bad_name.exe');
  assert.equal(sanitizeDownloadFilename('   '), 'telechargement');
  assert.equal(sanitizeDownloadFilename('report\0.txt'), 'report_.txt');
  assert.equal(sanitizeDownloadFilename('report.txt\0'), 'report.txt_');
  assert.ok(sanitizeDownloadFilename('x'.repeat(300) + '.zip').length <= 180);
});

test('identifie les exécutables et protège la liste contre l’effacement des transferts actifs', () => {
  assert.equal(isRiskyOpenDownload('document.PS1'), true);
  assert.equal(isRiskyOpenDownload('shortcut.lnk'), true);
  assert.equal(isRiskyOpenDownload('photo.png'), false);
  // Types that run code on open but were missing from the first list (attack: unconfirmed open).
  for (const name of ['help.chm', 'run.sct', 'setup.inf', 'pack.diagcab', 'task.wsc', 'x.ws', 'tool.msh2', 'drop.dll', 'add.xll', 'script.py', 'macro.docm', 'sheet.xlsm']) {
    assert.equal(isRiskyOpenDownload(name), true, name);
  }
  assert.equal(isRiskyOpenDownload('report.docx'), false);
  // Web-content types hand the file to the default browser, which runs outside Tor.
  for (const name of ['page.html', 'page.HTM', 'vector.svg', 'archive.mhtml', 'style.xsl', 'pack.msu']) {
    assert.equal(isRiskyOpenDownload(name), true, name);
  }
  assert.equal(canRemoveDownloadRecord({ state: 'downloading' }), false);
  assert.equal(canRemoveDownloadRecord({ state: 'completed' }), true);
});

test('la vue renderer ne reçoit jamais le chemin de fichier du processus principal', () => {
  const view = publicDownloadRecord({ id: 1, filename: 'x.exe', path: 'C:\\ProfileFixture\\Downloads\\x.exe', item: { secret: true } }, true, false);
  assert.equal(view.hasPath, true);
  assert.equal(Object.hasOwn(view, 'path'), false);
  assert.equal(Object.hasOwn(view, 'item'), false);
});
