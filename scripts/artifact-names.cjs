'use strict';

// One source for release file names: the NSIS build, Windows packaging, the
// Linux package and the signed update manifest all use these. No spaces, so
// GitHub keeps the names unchanged as release assets.
function artifactNames(version) {
  if (!/^\d+\.\d+\.\d+$/.test(String(version))) throw new Error(`Version de release invalide : ${version}`);
  return Object.freeze({
    nsis: `Nacre-Setup-${version}.exe`,
    portable: `Nacre-${version}-Portable.zip`,
    deb: `nacre_${version}_amd64.deb`,
    sums: `SHA256SUMS-${version}.txt`
  });
}

module.exports = { artifactNames };
