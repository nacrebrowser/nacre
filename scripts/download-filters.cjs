const fs = require('node:fs');
const path = require('node:path');
const { isFilterMetadataFor } = require('../src/filter-metadata.cjs');

(async () => {
  const destination = path.join(__dirname, '..', 'vendor', 'filters', 'engine.bin');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const metadataPath = path.join(path.dirname(destination), 'metadata.json');
  try {
    const current = fs.readFileSync(destination);
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    if (isFilterMetadataFor(current, metadata)) {
      process.stdout.write(`Snapshot de filtres vérifié (${metadata.generatedAt}, SHA-256 ${metadata.sha256}).\n`);
      return;
    }
  } catch {}
  throw new Error('Le snapshot embarqué est absent ou invalide. Ce script ne télécharge pas de listes hors Tor; restaure un snapshot vérifié ou actualise-les depuis Nacre via Tor.');
})().catch((error) => {
  console.error('Snapshot de filtres non vérifié; aucun téléchargement direct n’a été tenté.', error.message || error);
  process.exitCode = 1;
});
