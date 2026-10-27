'use strict';

(() => {
  const api = window.nacre;
  const translate = (key, fallback, values = {}) => {
    const translated = api?.getLocaleText?.(key);
    let result = translated && translated !== key ? translated : fallback;
    for (const [name, value] of Object.entries(values)) {
      result = result.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value));
    }
    return result;
  };
  const button = document.querySelector('#diagnostics-run');
  const externalCheckbox = document.querySelector('#diagnostics-external');
  const statusLine = document.querySelector('#diagnostics-status');
  const summaryLine = document.querySelector('#diagnostics-summary');
  const overview = document.querySelector('#diagnostics-overview');
  const overviewIcon = document.querySelector('#diagnostics-overview-icon');
  const overviewTitle = document.querySelector('#diagnostics-headline');
  const overviewDetail = document.querySelector('#diagnostics-headline-detail');
  const results = document.querySelector('#diagnostics-results');
  const buildMeta = document.querySelector('#diagnostics-build-meta');
  const buildResults = document.querySelector('#diagnostics-build-results');
  const buildBadge = document.querySelector('#diagnostics-build-badge');
  const rawOutput = document.querySelector('#diagnostics-json');

  const fallbackStatusMeta = Object.freeze({
    PASS: { key: 'diagnostics.status.pass', fallback: 'Verified', className: 'pass' },
    FAIL: { key: 'diagnostics.status.fail', fallback: 'Measured failure', className: 'fail' },
    NOT_STARTED: { key: 'diagnostics.status.notStarted', fallback: 'Could not start', className: 'not-started' },
    NOT_RUN: { key: 'diagnostics.status.notRun', fallback: 'Not run', className: 'not-run' },
    LIMITED: { key: 'diagnostics.status.limited', fallback: 'Limited coverage', className: 'limited' },
    MEASURED: { key: 'diagnostics.status.measured', fallback: 'Measured', className: 'measured' },
    NOT_APPLICABLE: { key: 'diagnostics.status.notApplicable', fallback: 'Not applicable', className: 'not-applicable' },
    INCOMPLETE: { key: 'diagnostics.status.incomplete', fallback: 'Incomplete', className: 'incomplete' }
  });

  function statusMeta(code) {
    return window.nacreDiagnosticStatusMeta?.[code] || fallbackStatusMeta[code] || fallbackStatusMeta.NOT_STARTED;
  }

  function statusLabel(code) {
    const meta = statusMeta(code);
    return translate(meta.key, meta.fallback);
  }

  function statusForBuild(status, freshness) {
    const helper = window.nacreDiagnosticStatusForBuild;
    if (typeof helper === 'function') return helper(status, freshness);
    if (freshness !== 'CURRENT') return 'NOT_RUN';
    return ['PASS', 'FAIL', 'NOT_STARTED', 'NOT_RUN', 'LIMITED', 'INCOMPLETE'].includes(status) ? status : 'INCOMPLETE';
  }

  // Short, plain badge text. The precise vocabulary (for example "Measured
  // failure" or "Limited coverage") stays available as the badge tooltip.
  const badgeText = Object.freeze({
    PASS: ['diagnostics.badge.pass', 'Passed'],
    FAIL: ['diagnostics.badge.fail', 'Problem'],
    NOT_STARTED: ['diagnostics.badge.notStarted', 'Couldn’t run'],
    NOT_RUN: ['diagnostics.badge.notRun', 'Skipped'],
    LIMITED: ['diagnostics.badge.limited', 'Known limit'],
    MEASURED: ['diagnostics.badge.measured', 'Info'],
    NOT_APPLICABLE: ['diagnostics.badge.notApplicable', 'Not needed'],
    INCOMPLETE: ['diagnostics.badge.incomplete', 'Incomplete']
  });
  const statusGlyph = Object.freeze({ PASS: '✓', FAIL: '×', NOT_STARTED: '!', NOT_RUN: '–', LIMITED: '!', MEASURED: 'i', NOT_APPLICABLE: '–', INCOMPLETE: '!' });

  function makeBadge(code) {
    const badge = document.createElement('span');
    badge.className = `diagnostics-badge diagnostics-badge--${statusMeta(code).className}`;
    const [key, fallback] = badgeText[code] || badgeText.NOT_STARTED;
    badge.textContent = translate(key, fallback);
    badge.title = statusLabel(code);
    return badge;
  }

  function makeIcon(code) {
    const icon = document.createElement('span');
    icon.className = `diagnostics-icon diagnostics-icon--${statusMeta(code).className}`;
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = statusGlyph[code] || '!';
    return icon;
  }

  function addRow(container, { title, status, detail, command = '' }) {
    const row = document.createElement('article');
    row.className = 'diagnostics-row';
    row.dataset.status = status;
    row.setAttribute('role', 'listitem');
    const heading = document.createElement('h3');
    heading.textContent = title;
    row.append(makeIcon(status), heading, makeBadge(status));
    if (detail) {
      const description = document.createElement('p');
      description.textContent = detail;
      row.append(description);
    }
    if (command) {
      const commandLine = document.createElement('p');
      commandLine.textContent = translate('diagnostics.command', 'Command: {command}', { command });
      row.append(commandLine);
    }
    container.append(row);
  }

  function localizeVerdictLabel(row) {
    const suffix = /^(page|iframe|worker)(?:-(node|webgl|language|cores|canvas))?$/.exec(row.id);
    if (row.id === 'javascript') return translate('diagnostics.check.javascript', row.label);
    if (row.id === 'internal-node') return translate('diagnostics.check.internalNode', row.label);
    if (row.id === 'internal-webgl') return translate('diagnostics.check.internalWebgl', row.label);
    if (row.id === 'webrtc') return translate('diagnostics.check.webrtc', row.label);
    if (row.id === 'tor-exit') return translate('diagnostics.check.torExit', row.label);
    if (row.id === 'dns') return translate('diagnostics.check.dns', row.label);
    if (row.id === 'kill-switch') return translate('diagnostics.check.killSwitch', row.label);
    if (!suffix) return row.label;

    const realm = translate(`diagnostics.realm.${suffix[1]}`, suffix[1]);
    const labels = {
      undefined: ['diagnostics.check.websiteRealm', 'Website {realm}'],
      node: ['diagnostics.check.websiteNode', 'Website {realm}: Node.js isolation'],
      webgl: ['diagnostics.check.websiteWebgl', 'Website {realm}: WebGL disabled'],
      language: ['diagnostics.check.websiteLanguage', 'Website {realm}: language consistency'],
      cores: ['diagnostics.check.websiteCores', 'Website {realm}: CPU value normalized'],
      canvas: ['diagnostics.check.websiteCanvas', 'Website {realm}: Canvas readback perturbation']
    };
    const [key, fallback] = labels[suffix[2]];
    return translate(key, fallback, { realm });
  }

  function realmLabel(id) {
    return translate(`diagnostics.realm.${id}`, id);
  }

  function localizeVerdictDetail(row, report) {
    const evidence = row.evidence || {};
    if (row.status === 'NOT_STARTED') {
      if (row.id === 'tor-exit') {
        return translate('diagnostics.detail.externalNotStarted', 'The external check could not complete ({reason}). No result was measured.', { reason: evidence.externalError || 'no usable response' });
      }
      return translate('diagnostics.detail.realmNotStarted', 'The {realm} probe could not start. No failure was measured; this result is not a pass.', { realm: realmLabel(row.id) });
    }
    if (row.status === 'NOT_RUN') {
      if (row.id === 'tor-exit') return translate('diagnostics.detail.externalNotRun', 'The external check was not selected. No external result was measured.');
      if (row.id === 'developer-suite') return translate('diagnostics.detail.developerSuite', 'Source tests require the checkout and Node. They are recorded separately in the bundled build validation.');
      return translate('diagnostics.detail.notRun', 'This check was not executed. It is not a pass.');
    }
    if (row.status === 'NOT_APPLICABLE') {
      return row.id === 'webrtc'
        ? translate('diagnostics.detail.webrtcNotApplicable', 'Tor is not selected; WebRTC availability alone is not a leak.')
        : translate('diagnostics.detail.notApplicable', 'This check does not apply to the current configuration.');
    }
    if (row.status === 'LIMITED') {
      if (/-canvas$/.test(row.id)) {
        return translate('diagnostics.detail.canvasLimited', 'One sampled pixel: red channel {measured} (baseline 64). This is a coverage limit, not a canvas-protection certification.', { measured: evidence.canvasRed ?? 'unavailable' });
      }
      if (/-language$/.test(row.id)) {
        return translate('diagnostics.detail.realmLanguageLimit', 'Measured languages {measured}; the fingerprint preload covers top-level documents only. This is a coverage limit, not a page failure.', { measured: JSON.stringify(evidence.measured ?? null) });
      }
      if (/-cores$/.test(row.id)) {
        return translate('diagnostics.detail.realmCoresLimit', 'Measured hardwareConcurrency={measured}; the fingerprint preload covers top-level documents only. This is a coverage limit, not a page failure.', { measured: evidence.measured ?? 'unavailable' });
      }
      if (row.id === 'dns') return translate('diagnostics.detail.dns', 'No independent DNS observer or packet capture is integrated. This is a coverage limit, not a pass.');
      if (row.id === 'kill-switch') return translate('diagnostics.detail.killSwitch', 'A live disconnection test is not run because it would interrupt your browsing. This is a coverage limit, not a pass.');
      return translate('diagnostics.detail.limited', 'This check has limited coverage and cannot support a pass or fail claim.');
    }
    if (row.id === 'javascript') return translate('diagnostics.detail.javascript', 'JavaScript can run in this diagnostic page.');
    if (row.id === 'internal-node') {
      return translate('diagnostics.detail.nodeProof', 'Measured typeof require={requireType}; typeof process={processType}; expected both "undefined".', { requireType: evidence.requireType ?? 'unavailable', processType: evidence.processType ?? 'unavailable' });
    }
    if (row.id === 'internal-webgl') {
      return translate('diagnostics.detail.webglProof', 'Measured getContext("webgl")={webgl}; getContext("webgl2")={webgl2}; expected both false.', { webgl: evidence.webgl, webgl2: evidence.webgl2 });
    }
    if (/-node$/.test(row.id)) {
      return translate('diagnostics.detail.nodeProof', 'Measured typeof require={requireType}; typeof process={processType}; expected both "undefined".', { requireType: evidence.requireType ?? 'unavailable', processType: evidence.processType ?? 'unavailable' });
    }
    if (/-webgl$/.test(row.id)) {
      return translate('diagnostics.detail.webglProof', 'Measured getContext("webgl")={webgl}; getContext("webgl2")={webgl2}; expected both false.', { webgl: evidence.webgl, webgl2: evidence.webgl2 });
    }
    if (/-language$/.test(row.id)) {
      return translate('diagnostics.detail.languageProof', 'Measured languages {measured}; expected ["en-US","en"].', { measured: JSON.stringify(evidence.measured ?? null) });
    }
    if (/-cores$/.test(row.id)) {
      return translate('diagnostics.detail.coresProof', 'Measured hardwareConcurrency={measured}; expected 8.', { measured: evidence.measured ?? 'unavailable' });
    }
    if (row.id === 'webrtc') {
      return report.torExpected
        ? translate('diagnostics.detail.webrtcTor', 'Checks that the peer-connection API is unavailable. No STUN packet test was performed.')
        : translate('diagnostics.detail.webrtcNotApplicable', 'Tor is not selected; WebRTC availability alone is not a leak.');
    }
    if (row.id === 'tor-exit') {
      if (typeof evidence.isTor === 'boolean') {
        return translate('diagnostics.detail.torMeasured', 'Tor Project reports IsTor={value}. This checks one destination.', { value: evidence.isTor });
      }
      return translate('diagnostics.detail.unavailable', 'No usable measurement. This is not a successful protection test.');
    }
    return row.detail;
  }

  function makeInternalResult() {
    const webglCanvas = document.createElement('canvas');
    const webgl2Canvas = document.createElement('canvas');
    let webgl = false;
    let webgl2 = false;
    try { webgl = Boolean(webglCanvas.getContext('webgl')); } catch {}
    try { webgl2 = Boolean(webgl2Canvas.getContext('webgl2')); } catch {}

    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    let canvasRead = false;
    let canvasSample = null;
    if (context) {
      context.fillStyle = 'rgb(64, 128, 192)';
      context.fillRect(0, 0, 4, 4);
      try {
        const pixels = context.getImageData(1, 1, 1, 1).data;
        canvasRead = pixels.length === 4;
        canvasSample = Array.from(pixels);
      } catch {}
    }

    const languages = Array.isArray(navigator.languages) ? Array.from(navigator.languages) : [];
    return {
      javascript: true,
      node: typeof require,
      process: typeof process,
      webgl,
      webgl2,
      webglCanvases: { separate: true, webglCanvasAvailable: webgl, webgl2CanvasAvailable: webgl2 },
      canvasRead,
      canvasSample,
      webRTC: typeof RTCPeerConnection,
      offscreenCanvas: typeof OffscreenCanvas,
      offlineAudio: typeof OfflineAudioContext,
      language: navigator.language,
      languages,
      cores: Number.isFinite(navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : null,
      memory: Number.isFinite(navigator.deviceMemory) ? navigator.deviceMemory : null,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
    };
  }

  function renderSummary(rows) {
    const counts = { pass: 0, fail: 0, notStarted: 0, notRun: 0, limited: 0, measured: 0, notApplicable: 0, incomplete: 0 };
    for (const row of rows) {
      if (row.status === 'PASS') counts.pass += 1;
      else if (row.status === 'FAIL') counts.fail += 1;
      else if (row.status === 'NOT_STARTED') counts.notStarted += 1;
      else if (row.status === 'NOT_RUN') counts.notRun += 1;
      else if (row.status === 'LIMITED') counts.limited += 1;
      else if (row.status === 'MEASURED') counts.measured += 1;
      else if (row.status === 'NOT_APPLICABLE') counts.notApplicable += 1;
      else counts.incomplete += 1;
    }
    // One plain verdict first; the individual rows carry the detail.
    let tone = 'ok';
    if (counts.fail > 0) tone = 'fail';
    else if (counts.notStarted > 0 || counts.incomplete > 0) tone = 'partial';
    const headlines = {
      ok: ['diagnostics.headline.ok', 'No problem found', 'diagnostics.headline.okDetail', 'Every check that could run passed. This is a snapshot of this page, not proof that nothing leaks. See the known limits below.'],
      fail: ['diagnostics.headline.fail', 'Problems found: {count}', 'diagnostics.headline.failDetail', 'Open the rows marked “Problem” to see what was measured. Nothing is changed automatically.'],
      partial: ['diagnostics.headline.partial', 'Some checks couldn’t run', 'diagnostics.headline.partialDetail', 'No problem was measured, but at least one check did not complete. Run the diagnostics again, or see the rows marked “Couldn’t run”.']
    }[tone];
    overview.dataset.tone = tone;
    overviewIcon.textContent = tone === 'ok' ? '✓' : tone === 'fail' ? '×' : '!';
    overviewTitle.textContent = translate(headlines[0], headlines[1], { count: counts.fail });
    overviewDetail.textContent = translate(headlines[2], headlines[3]);
    overview.hidden = false;

    const chips = [
      ['pass', counts.pass, 'diagnostics.chip.passed', '{count} passed'],
      ['fail', counts.fail, 'diagnostics.chip.problems', '{count} problems'],
      ['not-started', counts.notStarted + counts.incomplete, 'diagnostics.chip.couldNotRun', '{count} couldn’t run'],
      ['limited', counts.limited + counts.notRun, 'diagnostics.chip.limits', '{count} known limits'],
      ['measured', counts.measured + counts.notApplicable, 'diagnostics.chip.info', '{count} info']
    ];
    summaryLine.replaceChildren();
    for (const [name, count, key, fallback] of chips) {
      if (!count) continue;
      const chip = document.createElement('span');
      chip.className = `diagnostics-chip diagnostics-chip--${name}`;
      chip.textContent = translate(key, fallback, { count });
      summaryLine.append(chip);
    }
    summaryLine.hidden = false;
  }

  // Rows are grouped by theme. Known limits and skipped checks are kept apart
  // so they are not mistaken for problems or for passes.
  const GROUPS = Object.freeze([
    { id: 'isolation', key: 'diagnostics.group.isolation', fallback: 'Isolation and security' },
    { id: 'fingerprint', key: 'diagnostics.group.fingerprint', fallback: 'Fingerprint' },
    { id: 'network', key: 'diagnostics.group.network', fallback: 'Network' },
    { id: 'limits', key: 'diagnostics.group.limits', fallback: 'Known limits and checks not run', noteKey: 'diagnostics.group.limitsNote', noteFallback: 'These are not failures. Nacre protects the main page of a site. A page running inside the browser cannot fully verify frames and workers, DNS leaks or the Tor kill switch, so no pass is claimed. Cross-check with the external tests below.' }
  ]);

  function groupFor(row) {
    if (row.status === 'LIMITED' || row.status === 'NOT_RUN') return 'limits';
    if (row.id === 'webrtc' || row.id === 'tor-exit') return 'network';
    if (/-(language|cores|canvas)$/.test(row.id)) return 'fingerprint';
    return 'isolation';
  }

  function renderGroups(entries) {
    results.replaceChildren();
    for (const group of GROUPS) {
      const members = entries.filter((entry) => groupFor(entry.row) === group.id);
      if (!members.length) continue;
      const details = document.createElement('details');
      details.className = 'diagnostics-group';
      details.dataset.group = group.id;
      // Everything is open except the long list of known limits.
      details.open = group.id !== 'limits';
      const summary = document.createElement('summary');
      const title = document.createElement('span');
      title.textContent = translate(group.key, group.fallback);
      const count = document.createElement('span');
      count.className = 'diagnostics-group-count';
      count.textContent = String(members.length);
      summary.append(title, count);
      details.append(summary);
      if (group.noteKey) {
        const note = document.createElement('p');
        note.className = 'diagnostics-group-note';
        note.textContent = translate(group.noteKey, group.noteFallback);
        details.append(note);
      }
      const list = document.createElement('div');
      list.className = 'diagnostics-group-list';
      list.setAttribute('role', 'list');
      for (const entry of members) addRow(list, entry.display);
      details.append(list);
      results.append(details);
    }
  }

  // The raw report is meant to be shared in bug reports: hide the public IP.
  function maskAddress(value) {
    if (typeof value !== 'string') return value;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return value.replace(/\.\d{1,3}$/, '.x');
    if (value.includes(':')) return value.split(':').slice(0, 3).join(':') + ':…';
    return '…';
  }

  function shareableReport(report) {
    const copy = JSON.parse(JSON.stringify(report));
    if (copy.web?.network && Object.hasOwn(copy.web.network, 'IP')) copy.web.network.IP = maskAddress(copy.web.network.IP);
    return copy;
  }

  function exitCodeText(value) {
    if (value === null || value === undefined) return translate('diagnostics.noExitCode', 'no exit code');
    const number = Number(value);
    if (!Number.isFinite(number)) return String(value);
    return number >= 0x80000000 ? `0x${(number >>> 0).toString(16)}` : String(number);
  }

  function digestText(value) {
    return typeof value === 'string' && value.length === 64 ? `${value.slice(0, 16)}…` : translate('diagnostics.notRecorded', 'not recorded');
  }

  function checkProof(check, status) {
    const command = check.command || translate('diagnostics.notRecorded', 'not recorded');
    const exit = exitCodeText(check.exitCode);
    const hash = digestText(check.outputSha256);
    if (status === 'PASS') return translate('diagnostics.buildVerified', 'Verified with evidence: {command} exited {exit}; output SHA-256 {hash}.', { command, exit, hash });
    if (status === 'FAIL') return translate('diagnostics.buildMeasuredFailure', 'Measured failure: {command} exited {exit}; output SHA-256 {hash}.', { command, exit, hash });
    if (status === 'NOT_STARTED') return translate('diagnostics.buildNotStarted', 'Could not start: {command} exited {exit} without producing a result. This is not a measured failure; output SHA-256 {hash}.', { command, exit, hash });
    if (status === 'NOT_RUN') return translate('diagnostics.buildNotRun', 'This check was not executed for this build. It is not a pass.');
    return translate('diagnostics.buildLimited', 'Coverage is limited; see the individual limits below.');
  }

  function suiteProof(suite, status) {
    const exit = exitCodeText(suite.exitCode);
    const hash = digestText(suite.outputSha256);
    const counts = { passed: suite.passed ?? 0, total: suite.total ?? 0, failed: suite.failed ?? 0, skipped: suite.skipped ?? 0, todo: suite.todo ?? 0 };
    if (status === 'PASS') return translate('diagnostics.buildTestsProof', '{passed} of {total} tests passed; exit {exit}; output SHA-256 {hash}.', { ...counts, exit, hash });
    if (status === 'FAIL') return translate('diagnostics.buildTestsFailure', '{passed} of {total} tests passed, {failed} failed, {skipped} skipped, {todo} todo; exit {exit}; output SHA-256 {hash}.', { ...counts, exit, hash });
    if (status === 'NOT_STARTED') return translate('diagnostics.buildTestsNotStarted', 'The test command exited {exit} without a usable test summary. This is not a measured failure; output SHA-256 {hash}.', { exit, hash });
    if (status === 'NOT_RUN') return translate('diagnostics.buildTestsNotRun', 'The Node test suite was not executed for this build.');
    return translate('diagnostics.buildTestsLimited', '{passed} of {total} tests passed, but {skipped} skipped and {todo} todo leave coverage incomplete; exit {exit}; output SHA-256 {hash}.', { ...counts, exit, hash });
  }

  function renderBuild(build) {
    buildResults.replaceChildren();
    buildMeta.textContent = '';
    const validation = build?.buildValidation;
    const setBuildBadge = (code) => { if (buildBadge) buildBadge.replaceChildren(makeBadge(code)); };
    if (!validation) {
      setBuildBadge('NOT_RUN');
      addRow(buildResults, {
        title: translate('diagnostics.buildOverall', 'Bundled build checks'),
        status: 'NOT_RUN',
        detail: translate('diagnostics.buildMissing', 'No bundled release validation result is available. Nothing was verified for this build.')
      });
      return;
    }

    const freshness = validation.freshness;
    const version = validation.releaseVersion || translate('diagnostics.unknown', 'unknown');
    const generatedAt = validation.generatedAt ? new Date(validation.generatedAt).toLocaleString() : translate('diagnostics.notRecorded', 'not recorded');
    buildMeta.textContent = freshness === 'CURRENT'
      ? translate('diagnostics.buildMetaCurrent', 'Version {version} · recorded {date}', { version, date: generatedAt })
      : translate('diagnostics.buildMetaStale', 'The last recorded report is for version {version} ({date}). This app is version {current}.', { version, date: generatedAt, current: build?.currentDevice?.appVersion || translate('diagnostics.unknown', 'unknown') });
    const overallStatus = statusForBuild(validation.status, freshness);
    setBuildBadge(overallStatus);
    let overallDetail;
    if (freshness !== 'CURRENT') overallDetail = translate('diagnostics.buildStale', 'This report is missing, invalid, or does not match the running app. Its checks were not rerun for this build and are not a current pass.');
    else if (overallStatus === 'PASS') overallDetail = translate('diagnostics.buildFresh', 'This report matches the running app version and source digest. Each verified check lists its command, exit code and output hash.');
    else if (overallStatus === 'FAIL') overallDetail = translate('diagnostics.buildRecordedFailures', 'This report matches the running app but records measured failures.');
    else if (overallStatus === 'INCOMPLETE') overallDetail = translate('diagnostics.buildIncomplete', 'This report matches the running app, but some checks could not start or were not run. It is not a complete pass.');
    else overallDetail = translate('diagnostics.buildStale', 'This report is missing, invalid, or does not match the running app. Its checks were not rerun for this build and are not a current pass.');
    addRow(buildResults, {
      title: translate('diagnostics.buildOverall', 'Bundled build checks'),
      status: overallStatus,
      detail: overallDetail
    });

    // A report that does not match this build proves nothing about it. Say so
    // once instead of listing every recorded check as "not run".
    if (freshness !== 'CURRENT') return;

    if (validation.testSuite) {
      const suite = validation.testSuite;
      const suiteStatus = statusForBuild(suite.status, freshness);
      addRow(buildResults, {
        title: translate('diagnostics.buildTestSuite', 'Node test suite'),
        status: suiteStatus,
        detail: freshness === 'CURRENT' ? suiteProof(suite, suiteStatus) : translate('diagnostics.buildStaleCheck', 'The recorded result is not current for this build and was not rerun.')
      });
    }
    const names = { 'diagnostics-runtime': 'Automatic diagnostic panel', 'privacy-profiles-runtime': 'Profiles and settings vault', 'audit-runtime': 'Security regression scenarios', 'canvas-runtime': 'Canvas export protections', 'fingerprint-runtime': 'Fingerprint protection scenarios', 'hardening-runtime': 'Browser hardening scenarios', 'tor-control-runtime': 'Tor controller authentication', 'workspace-isolation-runtime': 'Workspace data separation', 'continuation-runtime': 'Cleanup and session lifecycle', 'packaged-sources': 'Packaged file integrity', 'packaged-smoke': 'Packaged application launch' };
    for (const check of Array.isArray(validation.checks) ? validation.checks : []) {
      const checkStatus = statusForBuild(check.status, freshness);
      addRow(buildResults, {
        title: names[check.id] || translate('diagnostics.buildCheck', 'Build check'),
        status: checkStatus,
        detail: freshness === 'CURRENT' ? checkProof(check, checkStatus) : translate('diagnostics.buildStaleCheck', 'The recorded result is not current for this build and was not rerun.')
      });
    }
    // The same statement is often recorded for many checks: show it once.
    const byStatement = new Map();
    for (const limitation of Array.isArray(validation.limitations) ? validation.limitations : []) {
      const statement = limitation.statement || translate('diagnostics.detail.limited', 'This check has limited coverage and cannot support a pass or fail claim.');
      byStatement.set(statement, (byStatement.get(statement) || []).concat(limitation));
    }
    for (const [statement, entries] of byStatement) {
      const first = entries[0];
      addRow(buildResults, {
        title: entries.length > 1
          ? translate('diagnostics.buildLimitationMany', 'Coverage limit · {count} checks', { count: entries.length })
          : translate('diagnostics.buildLimitation', 'Coverage limit · {check}', { check: names[first.checkId] || first.checkId || translate('diagnostics.buildCheck', 'Build check') }),
        status: 'LIMITED',
        detail: entries.length > 1 ? statement : `${statement} (${translate('diagnostics.proofHash', 'output SHA-256')} ${digestText(first.outputSha256)})`
      });
    }
  }

  async function runDiagnostics() {
    if (!button || !externalCheckbox || button.disabled) return;
    const externalSelected = externalCheckbox.checked;
    button.disabled = true;
    externalCheckbox.disabled = true;
    statusLine.textContent = translate('diagnostics.running', 'Running diagnostics…');
    summaryLine.hidden = true;
    overview.hidden = true;
    results.replaceChildren();
    buildResults.replaceChildren();
    buildMeta.textContent = '';

    let pageCheck;
    try {
      pageCheck = { status: 'MEASURED', result: makeInternalResult() };
    } catch (error) {
      pageCheck = { status: 'UNAVAILABLE', reason: String(error?.message || error).slice(0, 240) };
    }

    let response = null;
    let caughtError = null;
    try {
      if (typeof api?.runDiagnostics !== 'function') throw new Error('Diagnostic service unavailable.');
      response = await api.runDiagnostics(externalSelected);
    } catch (error) {
      caughtError = String(error?.message || error).slice(0, 240);
    }

    const report = {
      time: new Date().toISOString(),
      scope: 'Internal page measurements and, after native consent, one temporary Tor Project page. Results are observations, not a privacy certification.',
      checks: {
        page: pageCheck,
        developerSuite: {
          status: 'DEVELOPMENT_ONLY',
          reason: 'Source regression tests require the checkout and Node. They are recorded separately in bundled build validation; packaged pages do not run terminal commands.'
        }
      },
      web: response?.web || null,
      build: response?.build || null,
      torExpected: response?.torExpected === true,
      fingerprintExpected: response?.fingerprintExpected === true,
      externalSelected,
      error: response?.error || caughtError || null
    };

    const helperAvailable = typeof window.nacreDiagnosticVerdicts === 'function';
    const verdicts = helperAvailable
      ? window.nacreDiagnosticVerdicts({
        internal: report.checks,
        web: report.web,
        torExpected: report.torExpected,
        fingerprintExpected: report.fingerprintExpected,
        externalSelected,
        externalError: report.error
      })
      : [];
    // The source regression suite is a developer check: it is recorded in the
    // build report and is not a result the person running this page can act on.
    const rows = (Array.isArray(verdicts) ? verdicts : []).filter((row) => row.id !== 'developer-suite');
    const entries = rows.map((row) => ({
      row,
      display: {
        title: localizeVerdictLabel(row),
        status: ['PASS', 'FAIL', 'NOT_STARTED', 'NOT_RUN', 'LIMITED', 'MEASURED', 'NOT_APPLICABLE', 'INCOMPLETE'].includes(row.status) ? row.status : 'NOT_STARTED',
        detail: localizeVerdictDetail(row, report)
      }
    }));
    if (!pageCheck.result && !helperAvailable) {
      entries.push({
        row: { id: 'internal-page', status: 'NOT_STARTED' },
        display: {
          title: translate('diagnostics.check.internalPage', 'Internal page measurements'),
          status: 'NOT_STARTED',
          detail: pageCheck.reason || translate('diagnostics.detail.notStarted', 'This check could not start. No failure was measured.')
        }
      });
    }
    if (!helperAvailable) {
      entries.push({
        row: { id: 'verdict-helper', status: 'NOT_STARTED' },
        display: {
          title: translate('diagnostics.check.verdicts', 'Diagnostic verdict helper'),
          status: 'NOT_STARTED',
          detail: translate('diagnostics.helperMissing', 'The diagnostics could not classify the measurements.')
        }
      });
    }
    renderGroups(entries);
    renderSummary(entries.map((entry) => entry.row));
    renderBuild(report.build);
    rawOutput.textContent = JSON.stringify(shareableReport(report), null, 2);

    const wasCancelled = typeof report.error === 'string' && report.error.toLowerCase().includes('cancelled');
    statusLine.textContent = wasCancelled
      ? translate('diagnostics.externalCancelled', 'External check cancelled. No external result was measured.')
      : report.error
        ? translate('diagnostics.completedWithIssue', 'Diagnostics finished with an unavailable check. See the statuses below.')
        : translate('diagnostics.complete', 'Diagnostics finished. Review each result and its limits.');
    button.disabled = false;
    externalCheckbox.disabled = false;
  }

  if (button) button.addEventListener('click', runDiagnostics);
  if (location.hash === '#run' && button) button.click();
})();
