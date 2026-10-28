'use strict';

// Automatic updates. Everything Electron-specific (network session, process
// spawning, quitting) is injected, so the whole flow is testable in Node.
//
// Order of a check: route and consent first (no request otherwise), then
// ownership of the shared state, revocations, manifest, download, and a full
// revalidation immediately before an installer is started.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const verify = require('./update-verify.cjs');
const stateStore = require('./update-state.cjs');

const RELEASE_DOWNLOAD = 'https://github.com/nacrebrowser/nacre/releases/';
const RELEASE_TAG = RELEASE_DOWNLOAD + 'tag/v';
const MAX_REDIRECTS = 5;
const MAX_INSTALL_ATTEMPTS = 2;
const RETRY_DELAYS = [60 * 60 * 1000, 6 * 60 * 60 * 1000, 24 * 60 * 60 * 1000];
const CHECK_INTERVAL = 24 * 60 * 60 * 1000;

function errorCode(error) {
  if (error instanceof verify.UpdateError) return error.code;
  if (error && error.name === 'AbortError') return 'route-changed';
  if (error && error.code === 'ENOSPC') return 'disk-full';
  if (error && ['EBUSY', 'EPERM', 'EACCES'].includes(error.code)) return 'locked';
  if (error && error.code === 'state') return 'state';
  return 'offline';
}

function createUpdater(options) {
  const {
    currentVersion, platform = process.platform, arch = process.arch, installKind,
    statePath, stagingRoot, keys,
    route, consent, request,
    acquireOwnership = stateStore.acquireOwnership,
    fileSystem = fs, now = () => Date.now(),
    secureDirectory = (directory) => fileSystem.chmodSync(directory, 0o700),
    installGuard = () => '', spawnInstaller, quit,
    onStatus = () => {}, setTimer = setTimeout, clearTimer = clearTimeout
  } = options;

  let status = { state: 'idle' };
  let ready = null;
  let routeEpoch = 0;
  let controller = null;
  let queue = Promise.resolve();
  let timer = null;
  let failures = 0;
  let launched = false;
  let closing = false;
  let autoEnabled = false;
  let scheduleGeneration = 0;

  // While a verified package is held, later check results keep showing it.
  // An installation failure (installFailure) is shown as is: the user must
  // see why the package was not installed.
  function setStatus(next, { installFailure = false } = {}) {
    if (ready && !installFailure && !['ready', 'installing', 'downloading'].includes(next.state)) {
      next = { state: 'ready', version: ready.version, critical: ready.critical, releaseUrl: ready.releaseUrl, ...(next.error ? { error: next.error } : {}) };
    }
    status = { ...next, currentVersion };
    onStatus(status);
    return status;
  }

  // One operation at a time inside this process.
  function serial(task) {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  }

  function readState() {
    try { return stateStore.readState(statePath, fileSystem); }
    catch (error) { throw Object.assign(new Error(error.message), { code: 'state' }); }
  }

  function writeState(change) {
    try { return stateStore.updateState(statePath, change, fileSystem); }
    catch (error) { throw Object.assign(new Error(error.message), { code: 'state' }); }
  }

  // Requests are allowed only on a ready Tor route, or on a direct or proxy
  // route the user agreed to. Returns a status explaining a refusal, or null.
  function networkRefusal() {
    const current = route();
    if (current.mode === 'transition') return { state: 'error', error: 'offline' };
    if (current.mode === 'tor') return current.ready ? null : { state: 'error', error: 'offline' };
    const answer = consent();
    if (answer === 'allow') return null;
    return answer === 'deny' ? { state: 'disabled' } : { state: 'consent' };
  }

  async function fetchStream(url, signal) {
    let hops = 0;
    if (!verify.allowedUpdateLocation(url)) throw new verify.UpdateError('location', 'Update address refused.');
    const response = await request(url, {
      signal,
      onRedirect(next) {
        hops += 1;
        return hops <= MAX_REDIRECTS && Boolean(verify.allowedUpdateLocation(next));
      }
    });
    return response;
  }

  // Whatever happens, the response is cancelled once reading stops, so an
  // over-long or unwanted body never keeps streaming in the background.
  function cancelResponse(response) {
    if (response && typeof response.body.cancel === 'function') response.body.cancel();
  }

  async function fetchBytes(url, limit, signal, { optional = false } = {}) {
    const response = await fetchStream(url, signal);
    try {
      if (optional && response.status === 404) return null;
      if (response.status !== 200) throw new verify.UpdateError('http', `HTTP status ${response.status}.`);
      const chunks = [];
      let length = 0;
      for await (const chunk of response.body) {
        length += chunk.length;
        if (length > limit) throw new verify.UpdateError('size', 'Response too large.');
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks, length);
    } finally {
      cancelResponse(response);
    }
  }

  function latestAsset(name) { return RELEASE_DOWNLOAD + 'latest/download/' + name; }

  async function refreshRevocations(signal) {
    const body = await fetchBytes(latestAsset('nacre-key-revocation.json'), verify.LIMITS.revocation, signal, { optional: true });
    if (!body) return;
    const signatures = await fetchBytes(latestAsset('nacre-key-revocation.json.sig'), verify.LIMITS.signatures, signal);
    let revocation;
    // A revocation that does not verify is ignored: it cannot add anything.
    try { revocation = verify.authenticateRevocation({ revocationBytes: body, signatureBytes: signatures, keys }); } catch { return; }
    writeState((state) => ({ ...state, revokedKeyIds: [...state.revokedKeyIds, ...revocation.revokedKeyIds] }));
  }

  function removeDirectory(directory) {
    try { fileSystem.rmSync(directory, { recursive: true, force: true }); } catch {}
  }

  function discardReady() {
    if (ready) removeDirectory(ready.directory);
    ready = null;
  }

  function hashFile(file) {
    const hash = crypto.createHash('sha256');
    const descriptor = fileSystem.openSync(file, 'r');
    try {
      const buffer = Buffer.allocUnsafe(1024 * 1024);
      let bytes;
      while ((bytes = fileSystem.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, bytes));
    } finally { fileSystem.closeSync(descriptor); }
    return hash.digest('hex');
  }

  async function download(manifest, artifact, manifestBytes, signatureBytes, signal) {
    fileSystem.mkdirSync(stagingRoot, { recursive: true });
    const directory = path.join(stagingRoot, crypto.randomBytes(12).toString('hex'));
    fileSystem.mkdirSync(directory, { recursive: true, mode: 0o700 });
    secureDirectory(directory);
    const target = path.join(directory, artifact.name);
    const partial = target + '.part';
    let response = null;
    try {
      response = await fetchStream(`${RELEASE_DOWNLOAD}download/v${manifest.version}/${artifact.name}`, signal);
      if (response.status !== 200) throw new verify.UpdateError('http', `HTTP status ${response.status}.`);
      const hash = crypto.createHash('sha256');
      let length = 0;
      const descriptor = fileSystem.openSync(partial, 'wx', 0o600);
      try {
        for await (const chunk of response.body) {
          length += chunk.length;
          if (length > artifact.size) throw new verify.UpdateError('size', 'File larger than announced.');
          hash.update(chunk);
          fileSystem.writeSync(descriptor, chunk);
        }
        fileSystem.fsyncSync(descriptor);
      } finally { fileSystem.closeSync(descriptor); }
      if (length !== artifact.size || hash.digest('hex') !== artifact.sha256) throw new verify.UpdateError('integrity', 'Downloaded file differs from the signed manifest.');
      fileSystem.renameSync(partial, target);
      return { directory, file: target, manifestBytes, signatureBytes, artifact, version: manifest.version, critical: manifest.critical, releaseUrl: manifest.releaseUrl };
    } catch (error) {
      removeDirectory(directory);
      throw error;
    } finally {
      cancelResponse(response);
    }
  }

  // Full revalidation of a staged package against the state on disk now.
  function revalidate(candidate, state) {
    const { manifest } = verify.authenticateManifest({ manifestBytes: candidate.manifestBytes, signatureBytes: candidate.signatureBytes, keys, revokedKeyIds: state.revokedKeyIds });
    const { newer } = verify.evaluateManifest(manifest, { highestSeen: state.highestSeen, currentVersion, now: now() });
    const artifact = verify.selectArtifact(manifest, { platform, arch, format: installKind });
    if (!newer || !artifact || artifact.sha256 !== candidate.artifact.sha256 || artifact.size !== candidate.artifact.size || artifact.name !== candidate.artifact.name) {
      throw new verify.UpdateError('revalidation', 'The staged package is no longer allowed.');
    }
    if (hashFile(candidate.file) !== candidate.artifact.sha256) throw new verify.UpdateError('integrity', 'The staged package was modified.');
  }

  function readyStatus() {
    return { state: 'ready', version: ready.version, critical: ready.critical, releaseUrl: ready.releaseUrl };
  }

  async function runCheck() {
    if (closing) return status;
    const refusal = networkRefusal();
    if (refusal) return setStatus(refusal);
    const release = await acquireOwnership(statePath);
    if (!release) return status;
    const epoch = routeEpoch;
    controller = new AbortController();
    const { signal } = controller;
    try {
      setStatus({ state: 'checking' });
      await refreshRevocations(signal);
      const manifestBytes = await fetchBytes(latestAsset('nacre-update.json'), verify.LIMITS.manifest, signal);
      const signatureBytes = await fetchBytes(latestAsset('nacre-update.json.sig'), verify.LIMITS.signatures, signal);
      if (epoch !== routeEpoch) throw Object.assign(new Error('route changed'), { name: 'AbortError' });
      let state = readState();
      const { manifest } = verify.authenticateManifest({ manifestBytes, signatureBytes, keys, revokedKeyIds: state.revokedKeyIds });
      const { seen, newer } = verify.evaluateManifest(manifest, { highestSeen: state.highestSeen, currentVersion, now: now() });
      state = writeState((current) => ({ ...current, highestSeen: seen, lastCheck: isoNow() }));
      if (ready) {
        try { revalidate(ready, state); } catch { discardReady(); }
      }
      if (!newer) { failures = 0; return setStatus({ state: 'current', lastCheck: state.lastCheck }); }
      const artifact = verify.selectArtifact(manifest, { platform, arch, format: installKind });
      // No package for this system, architecture or format: nothing to offer.
      if (!artifact) { failures = 0; return setStatus({ state: 'current', lastCheck: state.lastCheck }); }
      const blocked = state.pending && state.pending.version === manifest.version && state.pending.attempts >= MAX_INSTALL_ATTEMPTS;
      if (installKind !== 'nsis' || blocked) {
        failures = 0;
        return setStatus({ state: 'available', version: manifest.version, critical: manifest.critical, releaseUrl: manifest.releaseUrl, ...(blocked ? { error: 'install-failed' } : {}) });
      }
      if (ready && ready.version === manifest.version) { failures = 0; return setStatus(readyStatus()); }
      discardReady();
      setStatus({ state: 'downloading', version: manifest.version, critical: manifest.critical });
      const candidate = await download(manifest, artifact, manifestBytes, signatureBytes, signal);
      if (epoch !== routeEpoch) { removeDirectory(candidate.directory); throw Object.assign(new Error('route changed'), { name: 'AbortError' }); }
      ready = candidate;
      // Only a complete cycle resets the retry delays (1 h, 6 h, 24 h).
      failures = 0;
      return setStatus(readyStatus());
    } catch (error) {
      failures += 1;
      return setStatus({ state: 'error', error: errorCode(error), ...(ready ? { version: ready.version } : {}) });
    } finally {
      // Abort anything still open before forgetting the controller.
      controller.abort();
      controller = null;
      await release();
    }
  }

  function isoNow() {
    return new Date(now()).toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  // Called by every path that changes the network route or the consent.
  function onRouteChange() {
    routeEpoch += 1;
    if (controller) controller.abort();
  }

  // Ownership is held from the final reload of the shared state until the
  // installer has actually started: no other profile can revoke a key or
  // advance highestSeen in between. Any failure means no installer runs.
  async function authorizeAndLaunch(args) {
    if (launched || !ready) return false;
    const release = await acquireOwnership(statePath);
    if (!release) return false;
    const candidate = ready;
    try {
      const guard = installGuard();
      if (guard) { setStatus({ state: 'error', error: guard, version: candidate.version, releaseUrl: candidate.releaseUrl }, { installFailure: true }); return false; }
      const state = readState();
      if (state.pending && state.pending.version === candidate.version && state.pending.attempts >= MAX_INSTALL_ATTEMPTS) throw new verify.UpdateError('install-failed');
      revalidate(candidate, state);
      writeState((current) => ({
        ...current,
        pending: { version: candidate.version, attempts: (current.pending && current.pending.version === candidate.version ? current.pending.attempts : 0) + 1, startedAt: isoNow() }
      }));
      try { await spawnInstaller(candidate.file, args); }
      catch { throw new verify.UpdateError('launch-failed'); }
      launched = true;
      return true;
    } catch (error) {
      const code = errorCode(error);
      if (!['state', 'launch-failed'].includes(code)) discardReady();
      setStatus({ state: 'error', error: code, version: candidate.version, releaseUrl: candidate.releaseUrl }, { installFailure: true });
      return false;
    } finally {
      await release();
    }
  }

  // "Restart to update": Nacre quits only once the installer is running.
  function installNow({ relaunch }) {
    return serial(async () => {
      if (!(await authorizeAndLaunch(['/S', '--updated', ...(relaunch ? ['--force-run'] : [])]))) return false;
      setStatus({ state: 'installing', version: ready.version });
      quit();
      return true;
    });
  }

  // Normal closing with a package ready: install without starting Nacre again.
  function installOnQuit() {
    return serial(() => authorizeAndLaunch(['/S', '--updated']));
  }

  // First thing at startup: settle the previous attempt, purge old downloads.
  function settlePreviousInstall() {
    return serial(async () => {
      try { for (const entry of fileSystem.readdirSync(stagingRoot)) removeDirectory(path.join(stagingRoot, entry)); } catch {}
      const release = await acquireOwnership(statePath);
      if (!release) return null;
      try {
        const state = readState();
        if (!state.pending) return null;
        if (verify.compareVersions(currentVersion, state.pending.version) >= 0) {
          writeState((current) => ({ ...current, completedVersion: currentVersion }));
          return setStatus({ state: 'updated', version: currentVersion });
        }
        return setStatus({ state: 'error', error: 'install-failed', version: state.pending.version, releaseUrl: RELEASE_TAG + state.pending.version });
      } catch (error) {
        return setStatus({ state: 'error', error: errorCode(error) });
      } finally { await release(); }
    });
  }

  // Automatic checks run only while enabled; stop() also defeats a callback
  // already running, so turning updates off during a check is final.
  function schedule(delay) {
    if (timer) clearTimer(timer);
    const generation = scheduleGeneration;
    timer = setTimer(() => {
      timer = null;
      serial(() => (autoEnabled && !closing && generation === scheduleGeneration ? runCheck() : status)).then(() => {
        if (autoEnabled && !closing && generation === scheduleGeneration) schedule(failures ? RETRY_DELAYS[Math.min(failures, RETRY_DELAYS.length) - 1] : CHECK_INTERVAL);
      });
    }, delay);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  function stop() {
    autoEnabled = false;
    scheduleGeneration += 1;
    if (timer) clearTimer(timer);
    timer = null;
    onRouteChange();
  }

  return {
    check: () => serial(runCheck),
    start: (firstDelay) => { if (closing) return; autoEnabled = true; scheduleGeneration += 1; schedule(firstDelay); },
    stop,
    // At shutdown: no new request, the current one is aborted, so the queue
    // drains quickly and closing Nacre is never held by the network.
    shutdown: () => { closing = true; stop(); },
    onRouteChange,
    installNow,
    installOnQuit,
    settlePreviousInstall,
    hasReady: () => Boolean(ready),
    status: () => status
  };
}

module.exports = { createUpdater, MAX_INSTALL_ATTEMPTS, RETRY_DELAYS, CHECK_INTERVAL };
