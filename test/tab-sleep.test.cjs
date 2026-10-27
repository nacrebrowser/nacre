'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { tabsToSleep, MAX_AWAKE_BACKGROUND_TABS } = require('../src/tab-sleep.cjs');

const MINUTE = 60_000;
const now = 1_000 * MINUTE;
const tabs = (idleMinutes) => idleMinutes.map((minutes, id) => ({ id, lastActiveAt: now - minutes * MINUTE }));

test('tabs sleep after the chosen delay', () => {
  const chosen = tabsToSleep(tabs([20, 3, 1]), { now, delayMs: 15 * MINUTE, freeRatio: 0.5 });
  assert.deepEqual(chosen.map((tab) => tab.id), [0]);
});

test('beyond six awake background tabs, the oldest idle ones sleep early', () => {
  const list = tabs([10, 9, 8, 7, 6, 5, 4, 3, 1]);
  const chosen = tabsToSleep(list, { now, delayMs: 15 * MINUTE, freeRatio: 0.5 });
  assert.equal(list.length - MAX_AWAKE_BACKGROUND_TABS, 3);
  assert.deepEqual(chosen.map((tab) => tab.id), [0, 1, 2]);
});

test('recently used tabs stay awake even under pressure', () => {
  const chosen = tabsToSleep(tabs([1, 1, 1, 1, 1, 1, 1, 1]), { now, delayMs: 15 * MINUTE, freeRatio: 0.05 });
  assert.deepEqual(chosen, []);
});

test('low memory puts every idle background tab to sleep', () => {
  const chosen = tabsToSleep(tabs([5, 3, 1]), { now, delayMs: 15 * MINUTE, freeRatio: 0.05 });
  assert.deepEqual(chosen.map((tab) => tab.id).sort(), [0, 1]);
});
