'use strict';

const fs = require('node:fs');
const path = require('node:path');

function configuredUserDataPath({ portable, executablePath, appDataPath, readFileSync }) {
  // A portable build keeps its profile next to the binary and must never adopt
  // the profile of an installed copy through %APPDATA%.
  if (portable) return path.join(path.dirname(executablePath), 'NacreData');
  const pointer = path.join(appDataPath, 'Nacre', 'profile-location.json');
  try {
    const saved = JSON.parse(readFileSync(pointer, 'utf8'));
    if (saved && typeof saved.path === 'string' && path.isAbsolute(saved.path)) return path.resolve(saved.path);
  } catch {}
  return null;
}

// True when child is parent itself or somewhere below it. Symbolic links are
// resolved where possible; Windows paths compare without case.
function isPathInside(parent, child, platform = process.platform, fileSystem = fs) {
  const real = (value) => {
    const resolved = path.resolve(value);
    try { return fileSystem.realpathSync.native(resolved); } catch {}
    try { return path.join(fileSystem.realpathSync.native(path.dirname(resolved)), path.basename(resolved)); } catch { return resolved; }
  };
  let a = real(parent);
  let b = real(child);
  if (platform === 'win32') { a = a.toLowerCase(); b = b.toLowerCase(); }
  const relative = path.relative(a, b);
  // "..profile" is a child; only ".." itself or "../…" leaves the parent.
  const outside = relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative);
  return !outside;
}

// installDirectory: updates replace that whole folder, so a profile inside it
// would be deleted by the next update.
function writeProfileLocation(pointer, selectedPath, fileSystem, installDirectory = '') {
  if (typeof selectedPath !== 'string' || !path.isAbsolute(selectedPath)) throw new TypeError('Choisissez un chemin de profil absolu.');
  if (installDirectory && isPathInside(installDirectory, selectedPath)) throw new Error('Choisissez un dossier en dehors du dossier d’installation de Nacre : une mise à jour le remplacerait.');
  const target = path.resolve(selectedPath);
  fileSystem.mkdirSync(path.dirname(pointer), { recursive: true });
  const temporary = `${pointer}.${process.pid}.tmp`;
  fileSystem.writeFileSync(temporary, JSON.stringify({ path: target }, null, 2), { mode: 0o600 });
  try {
    fileSystem.renameSync(temporary, pointer);
  } catch (error) {
    // Some managed Windows folders deny rename operations even when both
    // files are in the same directory. Keep the preference writable there.
    if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error;
    fileSystem.writeFileSync(pointer, JSON.stringify({ path: target }, null, 2), { mode: 0o600 });
    fileSystem.unlinkSync(temporary);
  }
  return target;
}

module.exports = { configuredUserDataPath, writeProfileLocation, isPathInside };
