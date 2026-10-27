'use strict';

const { validateBridgeLines } = require('./privacy-core.cjs');

function buildTorBridgeArguments(mode, configuredLines, executable) {
  if (mode === 'none') return [];
  if (!['obfs4', 'snowflake', 'custom'].includes(mode)) throw new Error('Le type de pont Tor choisi est invalide.');
  const validated = validateBridgeLines(mode, configuredLines);
  if (!validated.valid) throw new Error(validated.error);
  if (!validated.lines.length) return [];
  if (!executable) throw new Error('Le transport Lyrebird requis pour ce pont est absent du bundle.');
  const pluginTypes = [...new Set(validated.lines.map((line) => line.split(/\s+/, 1)[0]))];
  const args = ['--UseBridges', '1'];
  for (const type of pluginTypes) args.push('--ClientTransportPlugin', `${type} exec "${executable}"`);
  for (const line of validated.lines) args.push('--Bridge', line);
  return args;
}

module.exports = { buildTorBridgeArguments };
