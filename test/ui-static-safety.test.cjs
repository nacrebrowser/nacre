'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const srcDir = path.join(root, 'src');

const uiFiles = [];
for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
  if (entry.isFile() && /\.(html|js|css)$/.test(entry.name)) uiFiles.push(path.join(srcDir, entry.name));
}

const allowlist = {
  'protection.js': [
    /typeRoot\.innerHTML = '<div class="empty">Aucune requete bloc<\/div>';/,
    /siteRoot\.innerHTML = '<div class="empty">Les sites apparaissent<\/div>';/,
  ],
  'renderer.js': [
    /favicon\.innerHTML = tab\.private\? '<svg aria-hidden="true"><use href="#i-moon"><\/use><\/svg>' : \(tab\.secure\? '<svg aria-hidden="true"><use href="#i-lock"><\/use><\/svg>' : '<svg aria-hidden="true"><use href="#i-globe"><\/use><\/svg>\)/,
    /close\.innerHTML = '<svg aria-hidden="true"><use href="#i-close"><\/use><\/svg>';/,
    /button\.innerHTML = '<svg aria-hidden="true"><use href="#i-bookmark"><\/use><\/svg>';/,
    /trackerStatus\.innerHTML = state\.settings\.blockTrackers \? '<i><\/i> ACTIF' : '<i><\/i> EN PAUSE';/,
    /cookieStatus\.innerHTML = state\.settings\.blockThirdPartyCookies \? '<i><\/i> ACTIF' : '<i><\/i> EN PAUSE';/,
  ],
};

function isStringLiteral(val) {
  if (/^'(?:[^'\\]|\\.)*'$/.test(val)) return true;
  if (/^"(?:[^"\\]|\\.)*"$/.test(val)) return true;
  if (/^\`(?:[^`\\]|\\.)*\`$/.test(val)) return true;
  return false;
}

function isTernaryWithLiteralBranches(val) {
  const ternaryMatch = val.match(/^(.+)\?\s*(.+):\s*(.+)$/);
  if (!ternaryMatch) return false;
  const [, condition, thenBranch, elseBranch] = ternaryMatch;
  return isStringLiteral(thenBranch.trim()) && isStringLiteral(elseBranch.trim());
}

function checkViolations(content, file) {
  const violations = [];
  const basename = path.basename(file);
  const lines = content.split('\n');
  const isAllowedExternalPage = ['error.html', 'leak-tests.html', 'tests.html'].includes(basename);
  
  lines.forEach((line, i) => {
    const lineNum = i + 1;
    const isAllowlisted = allowlist[basename] && allowlist[basename].some((r) => r.test(line));

    if (/eval\(|new Function\(|document\.write\(/.test(line)) {
      violations.push({ file: basename, line: lineNum, type: 'eval/new Function/document.write', content: line.trim() });
    }

    const innerHTMLMatch = line.match(/(\w+)\.innerHTML\s*=/);
    if (innerHTMLMatch && !isAllowlisted) {
      const rhs = line.slice(innerHTMLMatch.index + innerHTMLMatch[0].length);
      const trimmed = rhs.trim().replace(/;.*$/, '').trim();
      const isLiteral = isStringLiteral(trimmed) || isTernaryWithLiteralBranches(trimmed);
      if (!isLiteral) {
        violations.push({ file: basename, line: lineNum, type: 'innerHTML non-literal', content: line.trim() });
      }
    }

    if (/\bstyle\s*=\s*["'][^"']*["']/.test(line)) {
      violations.push({ file: basename, line: lineNum, type: 'style= attribute', content: line.trim() });
    }

    const onMatches = line.matchAll(/\bon[a-z]+\s*=\s*["'][^"']*["']/g);
    for (const m of onMatches) {
      violations.push({ file: basename, line: lineNum, type: 'on* event attribute', content: line.trim() });
    }

    const scriptWithSrc = line.match(/<script[^>]*\ssrc=[^>]*>/);
    if (!scriptWithSrc && /<script[^>]*>/i.test(line)) {
      violations.push({ file: basename, line: lineNum, type: 'inline script tag', content: line.trim() });
    }

    const httpSrcMatches = line.matchAll(/src\s*=\s*["']https?:\/\/[^"']+/g);
    for (const m of httpSrcMatches) {
      violations.push({ file: basename, line: lineNum, type: 'external http(s) src', content: line.trim() });
    }

    const httpHrefMatches = line.matchAll(/href\s*=\s*["']https?:\/\/[^"']+/g);
    for (const m of httpHrefMatches) {
      const val = m[0].slice(m[0].indexOf('"') + 1, m[0].lastIndexOf('"'));
      if (!isAllowedExternalPage && !val.includes('check.torproject.org') && !val.includes('browserleaks.com') && !val.includes('coveryourtracks.eff.org') && !val.includes('d3ward.github.io') && !val.includes('adblock-tester.com') && !val.includes('canyoublockit.com')) {
        violations.push({ file: basename, line: lineNum, type: 'unexpected external href', content: line.trim() });
      }
    }

    if (/@import\s+url\s*\(\s*['"]https?:\/\//.test(line)) {
      violations.push({ file: basename, line: lineNum, type: 'remote @import', content: line.trim() });
    }
  });
  return violations;
}

test('ui static safety: no forbidden patterns in UI files', () => {
  const allViolations = [];
  for (const file of uiFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const violations = checkViolations(content, file);
    allViolations.push(...violations);
  }
  assert.equal(allViolations.length, 0, `UI static-safety violations:\n${allViolations.map((v) => `${v.file}:${v.line} ${v.type}\n  ${v.content}`).join('\n')}`);
});

test('ui static safety: all script tags have src attribute', () => {
  const htmlFiles = uiFiles.filter((f) => /\.html$/.test(f));
  const inlineScripts = [];
  for (const file of htmlFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const scriptWithoutSrc = content.match(/<script(?![^>]*\ssrc=)[^>]*>[^<]*(?=<\/script>)/gi);
    if (scriptWithoutSrc) {
      inlineScripts.push({ file: path.basename(file), matches: scriptWithoutSrc });
    }
  }
  assert.equal(inlineScripts.length, 0, `Inline scripts found:\n${JSON.stringify(inlineScripts, null, 2)}`);
});
