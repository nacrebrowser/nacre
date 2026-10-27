'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { WEBGL_DISABLE_SWITCHES, applyWebglDisablePolicy } = require('../src/webgl-policy.cjs');

test('la politique force WebGL désactivé avant la création des pages', () => {
  const calls = [];
  applyWebglDisablePolicy({ disableHardwareAcceleration: () => calls.push('hardware-off'), commandLine: { appendSwitch: (name) => calls.push(name) } });
  assert.deepEqual(calls, ['hardware-off', ...WEBGL_DISABLE_SWITCHES]);
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.cjs'), 'utf8');
  assert.match(source, /applyWebglDisablePolicy\(app\);[\s\S]*?app\.whenReady\(\)/);
  assert.equal((source.match(/webgl: false/g) || []).length, 2, 'les vues de contenu et l’interface interne désactivent WebGL');
  assert.match(source, /win = new BaseWindow\(/, 'le conteneur natif ne crée aucun moteur de rendu supplémentaire');
  assert.ok(source.includes("webglGuardPreloads.set(ses, ses.registerPreloadScript({ type: 'frame', filePath: path.join(__dirname, 'webgl-guard-preload.cjs') }))"));
  assert.ok(source.indexOf("path.join(__dirname, 'webgl-guard-preload.cjs')") < source.indexOf("if (settings.antiFingerprint && !fingerprintId)"), 'la garde WebGL est indépendante du réglage anti-empreinte');
  const guard = fs.readFileSync(path.join(__dirname, '..', 'src', 'webgl-guard-preload.cjs'), 'utf8');
  for (const contextName of ['webgl', 'webgl2', 'experimental-webgl', 'experimental-webgl2']) assert.ok(guard.includes(`'${contextName}'`));
  assert.match(guard, /HTMLCanvasElement\.prototype/);
  assert.match(guard, /OffscreenCanvas\.prototype/);
  assert.match(guard, /configurable: false,[\s\S]*?writable: false/);
  class FakeCanvas { getContext(type) { return { type }; } }
  class FakeOffscreenCanvas { getContext(type) { return { type }; } }
  const context = {
    require: () => ({ contextBridge: { executeInMainWorld: ({ func }) => func() } }),
    HTMLCanvasElement: FakeCanvas,
    OffscreenCanvas: FakeOffscreenCanvas
  };
  context.globalThis = context;
  vm.runInNewContext(guard, context);
  assert.equal(new FakeCanvas().getContext('webgl'), null);
  assert.equal(new FakeCanvas().getContext('2d').type, '2d');
  assert.equal(new FakeOffscreenCanvas().getContext('webgl2'), null);
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'fingerprint-preload.cjs'), 'utf8');
  assert.match(preload, /parameter === 0x9245\) return 'WebKit'/);
  assert.match(preload, /parameter === 0x9246\) return 'WebKit WebGL'/);
  assert.match(preload, /webgl_debug_renderer_info/);
});
