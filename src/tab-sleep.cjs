'use strict';

// Chooses which background tabs to put to sleep. Besides the delay chosen in
// the settings, the oldest tabs sleep after two idle minutes when more than
// six background tabs are awake, and every idle tab does when the computer is
// short of memory. Each sleeping tab frees its renderer process.

const MAX_AWAKE_BACKGROUND_TABS = 6;
const PRESSURE_IDLE_MS = 2 * 60 * 1000;
const LOW_MEMORY_RATIO = 0.12;

// candidates: suspendable background tabs ({ lastActiveAt }).
function tabsToSleep(candidates, { now = Date.now(), delayMs, freeRatio = 1 } = {}) {
  const live = [...candidates].sort((a, b) => (a.lastActiveAt || 0) - (b.lastActiveAt || 0));
  const lowMemory = freeRatio < LOW_MEMORY_RATIO;
  const surplus = lowMemory ? live.length : Math.max(0, live.length - MAX_AWAKE_BACKGROUND_TABS);
  return live.filter((tab, index) => {
    const idleSince = tab.lastActiveAt || 0;
    if (idleSince <= now - delayMs) return true;
    return index < surplus && idleSince <= now - PRESSURE_IDLE_MS;
  });
}

module.exports = { tabsToSleep, MAX_AWAKE_BACKGROUND_TABS, PRESSURE_IDLE_MS, LOW_MEMORY_RATIO };
