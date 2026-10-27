'use strict';
const fs = require('node:fs'), path = require('node:path'), { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const folder = path.join(root, '.cache/memory'); fs.mkdirSync(folder, { recursive: true });
const runs = [];
// Serial, interleaved runs: benchmarks must not compete for CPU/RAM.
for (let repeat = 1; repeat <= 3; repeat++) {
  runs.push(['before', repeat, '--baseline']);
  runs.push(['after', repeat]);
  if (repeat <= 2) runs.push(['window-only', repeat, '--baseline-locales']);
}
const results = [];
for (const [variant, repeat, flag] of runs) {
  const label = `ram-${variant}-${repeat}`;
  console.log('MEMORY_RUN ' + label);
  const result = spawnSync(process.execPath, [path.join(__dirname, 'measure-memory.cjs'), label, ...(flag ? [flag] : []), '--locales'], { cwd: root, encoding: 'utf8', timeout: 190000 });
  process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
  if (result.status !== 0) throw new Error(label + ' failed; see raw evidence');
  const raw = JSON.parse(fs.readFileSync(path.join(folder, label + '.json'), 'utf8'));
  const line = raw.stdout.split(/\r?\n/).find(line => line.startsWith('MEMORY_RESULT '));
  const measured = JSON.parse(line.slice('MEMORY_RESULT '.length));
  if (!measured.rows.every(row => row.tabs === (['1', '5', '10'].includes(row.stage) ? Number(row.stage) : 1))) throw new Error('Invalid tab count');
  results.push({ variant, repeat, ...measured });
  fs.writeFileSync(path.join(folder, 'comparison.json'), JSON.stringify(results, null, 2));
}
const median = values => { const sorted = [...values].sort((a,b) => a-b); return sorted.length % 2 ? sorted[(sorted.length-1)/2] : (sorted[sorted.length/2-1]+sorted[sorted.length/2])/2; };
const summary = {};
for (const variant of ['before', 'window-only', 'after']) {
  const selected = results.filter(run => run.variant === variant);
  summary[variant] = selected[0].rows.map(row => {
    const rows = selected.map(run => run.rows.find(item => item.stage === row.stage));
    return { stage: row.stage, privateMiB: median(rows.map(item => item.privateMiB)), workingSetMiB: median(rows.map(item => item.workingSetMiB)), privateRange: [Math.min(...rows.map(item => item.privateMiB)), Math.max(...rows.map(item => item.privateMiB))] };
  });
}
fs.writeFileSync(path.join(folder, 'summary.json'), JSON.stringify(summary, null, 2));
console.log('MEMORY_COMPARISON ' + JSON.stringify(summary));
