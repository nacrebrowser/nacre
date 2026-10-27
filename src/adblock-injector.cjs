'use strict';

const MAX_SCRIPTLET_BYTES = 512_000;
const MAX_SCRIPTLET_COUNT = 128;
const MAX_BUNDLE_BYTES = 8 * 1024 * 1024;

// Ghostery returns compiled resources, not raw JavaScript from filter lists.
// Keep this list deliberately narrow: user-supplied rules/lists may select a
// bundled resource, but may not introduce a new scriptlet implementation.
const ALLOWED_SCRIPTLET_ENTRIES = Object.freeze([
  'jsonPrune',
  'setConstant',
  'jsonPruneFetchResponse',
  'replaceNodeText',
  'trustedJsonEditXhrRequest',
  'adjustSetTimeout',
  'jsonPruneXhrResponse',
  'trustedReplaceXhrResponse',
  'trustedReplaceFetchResponse',
  'removeNodeText',
  'trustedPreventDomBypass',
  'preventXhr'
]);
const GHOSTERY_SCRIPTLET_PREFIX = "if (typeof scriptletGlobals === 'undefined') { var scriptletGlobals = {}; };";
const GHOSTERY_ARGUMENTS_SUFFIX = "].filter((a,i) => a !== '{{'+(i+1)+'}}').map((a) => decodeURIComponent(a)))";
const ENTRY_PATTERN = new RegExp(`\\bfunction\\s+(?:${ALLOWED_SCRIPTLET_ENTRIES.join('|')})\\s*\\(`);

function isAllowedGhosteryScriptlet(script) {
  if (typeof script !== 'string' || Buffer.byteLength(script, 'utf8') > MAX_SCRIPTLET_BYTES) return false;
  if (!script.startsWith(GHOSTERY_SCRIPTLET_PREFIX) || !script.endsWith(GHOSTERY_ARGUMENTS_SUFFIX)) return false;
  if (!ENTRY_PATTERN.test(script)) return false;
  // These constructs are never needed in the approved compiled resources.
  if (/\beval\s*\(|\bnew\s+Function\b|\bimport\s*\(/i.test(script)) return false;
  return true;
}

function buildScriptletBundle(payload) {
  const scripts = Array.isArray(payload && payload.scripts) ? payload.scripts : [];
  const blocks = [];
  let bytes = 0;
  let rejected = 0;
  for (const script of scripts.slice(0, MAX_SCRIPTLET_COUNT)) {
    if (!isAllowedGhosteryScriptlet(script)) { rejected += 1; continue; }
    const size = Buffer.byteLength(script, 'utf8');
    if (bytes + size > MAX_BUNDLE_BYTES) { rejected += 1; continue; }
    bytes += size;
    // Separate blocks keep lexical declarations from colliding while sharing
    // scriptletGlobals in the bundle's function scope.
    blocks.push(`try {\n${script}\n} catch {}`);
  }
  const procedural = typeof (payload && payload.proceduralScript) === 'string' ? payload.proceduralScript : '';
  if (procedural && Buffer.byteLength(procedural, 'utf8') <= MAX_SCRIPTLET_BYTES && bytes + Buffer.byteLength(procedural, 'utf8') <= MAX_BUNDLE_BYTES) {
    blocks.push(`try {\n${procedural}\n} catch {}`);
  }
  return { source: blocks.length ? `(()=>{\n${blocks.join('\n')}\n})()` : '', scripts: blocks.length, rejected };
}

module.exports = { MAX_SCRIPTLET_BYTES, MAX_SCRIPTLET_COUNT, MAX_BUNDLE_BYTES, ALLOWED_SCRIPTLET_ENTRIES, isAllowedGhosteryScriptlet, buildScriptletBundle };
