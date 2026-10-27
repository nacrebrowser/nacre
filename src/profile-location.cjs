'use strict';

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

function writeProfileLocation(pointer, selectedPath, fileSystem) {
  if (typeof selectedPath !== 'string' || !path.isAbsolute(selectedPath)) throw new TypeError('Choisissez un chemin de profil absolu.');
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

module.exports = { configuredUserDataPath, writeProfileLocation };
