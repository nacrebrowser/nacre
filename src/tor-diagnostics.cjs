'use strict';

function sanitizeTorLog(value) {
  return String(value || '').split(/\r?\n/).slice(-30).map((line) => line
    .replace(/(?:[A-Za-z]:\\Users\\)[^\\\s]+/gi, '[profil local]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g, '[adresse réseau]')
    .replace(/\b[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}\b/gi, '[adresse réseau]')
  ).join('\n').slice(-6000);
}

function explainTorFailure(error, log = '', bridgeMode = 'none') {
  const source = `${error || ''}\n${log || ''}`.toLowerCase();
  if (bridgeMode !== 'none' && ['obfs4', 'snowflake', 'custom'].includes(bridgeMode)) {
    const kind = bridgeMode === 'custom' ? (/snowflake/i.test(source) ? 'Snowflake' : /obfs4/i.test(source) ? 'obfs4' : 'pont personnalisé')
      : bridgeMode === 'snowflake' ? 'Snowflake' : bridgeMode === 'obfs4' ? 'obfs4' : bridgeMode;
    const bridgeIndex = /\bbridge\s*(?:number\s*)?(\d+)\b/i.exec(source);
    const bridge = `Pont ${kind}${bridgeIndex ? ' n°' + bridgeIndex[1] : ' sélectionné'}`;
    let cause = 'échec de négociation; blocage réseau possible';
    if (/address already in use|could not bind|bind to .*port|failed to bind/.test(source)) cause = 'port local occupé';
    else if (/lyrebird|conjure|pluggable transport|no such file|cannot open|spawn .*eacces|permission denied/.test(source)) cause = 'binaire de transport manquant ou inaccessible';
    else if (/invalid bridge|invalid line|verify-config|configuration refused|configuration.*refus|unknown option/.test(source)) cause = 'ligne de pont invalide ou configuration refusée';
    else if (/connection refused|actively refused|connexion refusée/.test(source)) cause = 'connexion refusée';
    else if (/timed out|timeout|deadline|2 minutes|délai/.test(source)) cause = 'délai dépassé';
    else if (/blocked|network is unreachable|connection reset|handshake.*fail|bridge.*fail/.test(source)) cause = 'pont probablement bloqué par le réseau';
    return `${bridge} · ${cause}. Cette cause reste indicative.`;
  }
  if (/address already in use|could not bind|bind to .*port|failed to bind|port local.*occup|port .*occup[eé]/.test(source)) return 'Un port local Tor est déjà occupé. Ferme l’autre instance, puis réessaie.';
  if (/lyrebird|conjure|pluggable transport|no such file|introuvable|cannot open|spawn .*eacces|permission denied/.test(source)) return 'Un binaire ou fichier Tor requis est manquant ou inaccessible.';
  // Tor prints "Read configuration file" on every start, so only its error
  // wording counts as a refused configuration.
  if (/failed to parse\/validate config|reading config failed|configuration refused|verify-config|unknown option|invalid argument|ligne de pont|type de pont/.test(source)) return 'Tor a refusé sa configuration. Vérifie le mode et les lignes de pont.';
  if (/bridge|obfs4|snowflake|pont sélectionné/.test(source)) return 'Le pont sélectionné est absent, invalide ou inaccessible depuis ce réseau.';
  if (/bootstrapped|connection refused|network is unreachable|timed out|timeout|2 minutes|connexion.*n.a pas réussi/.test(source)) return 'Le démarrage réseau Tor n’a pas terminé. Le réseau peut bloquer Tor ou le bootstrap est encore en cours.';
  if (/controlport|control port|authenticate/.test(source)) return 'Tor a démarré, mais le port de contrôle local ou son authentification a échoué.';
  return 'Tor n’a pas pu se connecter. Le trafic reste bloqué jusqu’à une nouvelle tentative.';
}

module.exports = { sanitizeTorLog, explainTorFailure };
