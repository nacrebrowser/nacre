'use strict';

// Single source of truth for simple preference values. The same rules apply
// when a stored profile is loaded and when a trusted internal page updates a
// preference, so a value accepted by one path is always accepted by the other.
// Fields with cross-field rules (proxy, Tor bridges, filter lists, cookies,
// workspaces, home page) keep dedicated validation in main.cjs.

const DARK_BACKGROUNDS = Object.freeze(['#202124', '#171d25', '#1f1724', '#17251e', '#231b17', '#121212']);
const SEARCH_ENGINES = Object.freeze(['duckduckgo', 'qwant', 'startpage', 'brave', 'ecosia', 'custom']);
const SECURE_DNS_MODES = Object.freeze(['automatic', 'strict']);
// Accent colour that was the default before 0.9.5; profiles that kept it move
// to the new default along with the redesigned palette.
const LEGACY_DEFAULT_ACCENT = '#4e8064';

const SCALAR_SETTINGS = Object.freeze({
  searchEngine: { type: 'enum', values: SEARCH_ENGINES, default: 'duckduckgo' },
  startupMode: { type: 'enum', values: ['new-tab', 'pages'], default: 'new-tab' },
  theme: { type: 'enum', values: ['dark', 'light', 'system'], default: 'dark' },
  accent: { type: 'pattern', pattern: /^#[0-9a-f]{6}$/i, default: '#2f9e86' },
  darkBackground: { type: 'enum', values: DARK_BACKGROUNDS, default: '#202124' },
  defaultZoom: { type: 'number', values: [75, 80, 90, 100, 110, 125, 150, 175, 200], default: 100 },
  fontSize: { type: 'number', values: [12, 14, 16, 18, 20, 24], default: 16 },
  adBlockMode: { type: 'enum', values: ['comfort', 'strict'], default: 'comfort' },
  suspendAfterMinutes: { type: 'number', values: [5, 15, 30, 60], default: 15 },
  // automatic: Quad9 over HTTPS, falling back to the system resolver when
  // Quad9 is unreachable (school or company networks). strict: Quad9 only.
  secureDnsMode: { type: 'enum', values: SECURE_DNS_MODES, default: 'automatic' },
  showBookmarksBar: { type: 'boolean', default: true },
  httpsOnly: { type: 'boolean', default: true },
  clearOnQuit: { type: 'boolean', default: false },
  sendGpc: { type: 'boolean', default: true },
  sendDnt: { type: 'boolean', default: false },
  askDownloadLocation: { type: 'boolean', default: true },
  openDownloadsAfter: { type: 'boolean', default: false },
  antiFingerprint: { type: 'boolean', default: true },
  adBlockWeeklyUpdates: { type: 'boolean', default: false },
  verticalTabs: { type: 'boolean', default: false },
  phishingGuardEnabled: { type: 'boolean', default: true },
  // Temporary Tor that fetches missing shortcut and bookmark icons (main.cjs).
  iconTorBackground: { type: 'boolean', default: true },
  suspendInactiveTabs: { type: 'boolean', default: true }
});

// Returns { ok, value }: ok is false when the value does not satisfy the rule.
function coerceSetting(key, value) {
  const rule = SCALAR_SETTINGS[key];
  if (!rule) return { ok: false };
  if (rule.type === 'boolean') return typeof value === 'boolean' ? { ok: true, value } : { ok: false };
  if (rule.type === 'enum') return rule.values.includes(value) ? { ok: true, value } : { ok: false };
  if (rule.type === 'number') {
    const number = Number(value);
    return value !== null && value !== '' && rule.values.includes(number) ? { ok: true, value: number } : { ok: false };
  }
  if (rule.type === 'pattern') return typeof value === 'string' && rule.pattern.test(value) ? { ok: true, value } : { ok: false };
  return { ok: false };
}

// Every scalar key, taken from the stored profile when valid, otherwise the default.
function normalizeStoredScalars(stored) {
  const source = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  const result = {};
  for (const [key, rule] of Object.entries(SCALAR_SETTINGS)) {
    const checked = coerceSetting(key, source[key]);
    result[key] = checked.ok ? checked.value : rule.default;
  }
  if (String(result.accent).toLowerCase() === LEGACY_DEFAULT_ACCENT) result.accent = SCALAR_SETTINGS.accent.default;
  return result;
}

// Copies valid scalar values from an update payload; invalid ones are ignored.
function applyScalarPatch(target, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return target;
  for (const key of Object.keys(SCALAR_SETTINGS)) {
    if (!Object.hasOwn(payload, key)) continue;
    const checked = coerceSetting(key, payload[key]);
    if (checked.ok) target[key] = checked.value;
  }
  return target;
}

function scalarDefaults() {
  return Object.fromEntries(Object.entries(SCALAR_SETTINGS).map(([key, rule]) => [key, rule.default]));
}

module.exports = {
  SCALAR_SETTINGS,
  DARK_BACKGROUNDS,
  SEARCH_ENGINES,
  SECURE_DNS_MODES,
  coerceSetting,
  normalizeStoredScalars,
  applyScalarPatch,
  scalarDefaults
};
