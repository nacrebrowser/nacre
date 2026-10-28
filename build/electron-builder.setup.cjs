const config = require('./electron-builder.dir.cjs');
// Keep the standard builder uninstaller generation/signing pipeline. Setting
// nsis.script would bypass that pipeline and leave UNINSTALLER_OUT_FILE unset.
require('../scripts/prepare-nsis-script.cjs').installNsisTemplatePatch();
module.exports = {
  ...config,
  win: { ...config.win, target: ['nsis'] },
  nsis: {
    ...config.nsis,
    artifactName: require('../scripts/artifact-names.cjs').artifactNames(require('../package.json').nacreVersion || require('../package.json').version).nsis,
    include: 'scripts/installer.nsh',
    installerLanguages: ['en_US'],
    displayLanguageSelector: false,
    runAfterFinish: true,
    uninstallDisplayName: 'Nacre ' + (require('../package.json').nacreVersion || require('../package.json').version)
  }
};
