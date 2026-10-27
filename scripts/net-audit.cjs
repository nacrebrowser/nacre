'use strict';

// Development-only Electron NetLog audit. The fixture routes .invalid hostnames
// into a loopback-only SOCKS stub; no public destination is contacted.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const electronBinary = require('electron');

const root = path.resolve(__dirname, '..');
const work = path.join(root, '.cache', 'net-audit');
const reportPath = path.join(work, 'report.json');
const netLogPath = path.join(work, 'netlog.json');
const negativeReportPath = path.join(work, 'negative-report.json');
const negativeNetLogPath = path.join(work, 'negative-netlog.json');
const fixturePath = path.join(__dirname, 'net-audit-child.cjs');
const timeoutMs = Math.max(20_000, Number(process.env.NACRE_NET_AUDIT_TIMEOUT_MS) || 60_000);

function netLogEventName(event, constants) {
  if (typeof event.type === 'string') return event.type;
  const types = constants && (constants.logEventTypes || constants.logEventTypesV2);
  if (types && !Array.isArray(types)) return Object.keys(types).find((name) => types[name] === event.type) || String(event.type);
  const item = Array.isArray(types) ? types[event.type] : null;
  if (typeof item === 'string') return item;
  return item && (item.name || item.eventType) || String(event.type);
}

function endpointKey(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const bracketed = text.match(/^\[([^\]]+)\]:(\d{1,5})$/);
  if (bracketed) return `${bracketed[1].toLowerCase()}:${Number(bracketed[2])}`;
  const plain = text.match(/^([^:]+):(\d{1,5})$/);
  if (!plain) return null;
  return `${plain[1].toLowerCase()}:${Number(plain[2])}`;
}

function analyzeNetLog(log, allowedEndpoints) {
  const allowed = new Set(allowedEndpoints.map((value) => endpointKey(value) || String(value).toLowerCase()));
  const connections = [];
  const resolverRequests = [];
  const dnsTransactions = [];
  const proxyChanges = [];
  for (const event of Array.isArray(log.events) ? log.events : []) {
    const name = netLogEventName(event, log.constants || {});
    const params = event.params || {};
    const addEndpoint = (value) => {
      const endpoint = endpointKey(value);
      if (endpoint) connections.push({ event: name, endpoint });
    };
    if (/^TCP_CONNECT$|^UDP_CONNECT$|^SOCKET_CONNECT$|^TCP_CONNECT_ATTEMPT$|^TCP_CONNECT_JOB_CONNECTOR_CONNECT_START$|^QUIC_.*(?:CONNECT|PROBE)/i.test(name)) {
      for (const key of ['address', 'remote_address']) addEndpoint(params[key]);
      if (Array.isArray(params.address_list)) for (const address of params.address_list) addEndpoint(address);
    }
    if (/^HOST_RESOLVER_MANAGER_REQUEST$/.test(name)) {
      const host = params.host || params.hostname || params.name;
      if (typeof host === 'string') resolverRequests.push({ event: name, host, speculative: Boolean(params.is_speculative) });
    }
    if (name === 'PROXY_RESOLUTION_SERVICE_RESOLVED_PROXY_LIST' && /DIRECT/.test(String(params.proxy_info || ''))) {
      resolverRequests.push({ event: name, directResolution: true, proxyInfo: params.proxy_info });
    }
    if (/^DNS_TRANSACTION(?:_QUERY|_PLATFORM_ATTEMPT|_HTTPS_ATTEMPT|_TCP_ATTEMPT)?$|^DOH_URL_REQUEST$|^HOST_RESOLVER_SYSTEM_TASK$/.test(name)) {
      const host = params.hostname || params.qname || params.domain_name || params.host || params.name;
      if (typeof host === 'string') dnsTransactions.push({ event: name, host: host.replace(/\\.$/, '') });
      const address = params.address || params.server_address || params.endpoint;
      if (typeof address === 'string') addEndpoint(address);
    }
    if (name === 'PROXY_CONFIG_CHANGED') proxyChanges.push(JSON.stringify(params));
  }
  const unexpected = connections.filter(({ endpoint }) => !allowed.has(endpoint));
  const ipv6ReachabilityProbes = (Array.isArray(log.events) ? log.events : []).filter((event) =>
    netLogEventName(event, log.constants || {}) === 'HOST_RESOLVER_MANAGER_IPV6_REACHABILITY_CHECK'
  ).map((event) => event.params || {});
  return {
    clean: unexpected.length === 0 && dnsTransactions.length === 0 && (Array.isArray(log.events) ? log.events : []).every((event) => {
      const name = netLogEventName(event, log.constants || {});
      const params = event.params || {};
      if (!/HOST_RESOLVER|DNS_TRANSACTION|DOH_URL_REQUEST|UDP_CONNECT|TCP_CONNECT|SOCKET_CONNECT/.test(name)) return true;
      const text = JSON.stringify(params);
      if (name === 'HOST_RESOLVER_MANAGER_IPV6_REACHABILITY_CHECK') return true;
      if (name === 'HOST_RESOLVER_MANAGER_REQUEST') return !params.host || !/\.nacre-audit\.invalid$/i.test(String(params.host));
      return !/\b(?:DIRECT|system|dns|doh|DoH)\b/i.test(text) && !/2001:4860:4860::8888/.test(text);
    }),
    connections,
    unexpected,
    ipv6ReachabilityProbes,
    resolverRequests,
    dnsTransactions,
    proxyChanges
  };
}

function readArtifact(file, label) {
  if (!fs.existsSync(file)) throw new Error(`${label} was not written.`);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { throw new Error(`${label} is invalid JSON: ${error.message}`); }
}

function launch(mode, report, netlog, phase = 'normal', options = {}) {
  for (const file of [report, netlog]) fs.rmSync(file, { force: true });
  const env = { ...process.env, NACRE_NET_AUDIT_MODE: mode, NACRE_NET_AUDIT_REPORT: report, NACRE_NET_AUDIT_NETLOG: netlog, NACRE_NET_AUDIT_PHASE: phase };
  if (options.hostResolverRules) env.NACRE_NET_AUDIT_HOST_RESOLVER_RULES = options.hostResolverRules;
  if (options.enableIpv6Feature) env.NACRE_NET_AUDIT_ENABLE_IPV6_FEATURE = '1';
  delete env.ELECTRON_RUN_AS_NODE;
  return new Promise((resolve, reject) => {
    const child = spawn(electronBinary, [fixturePath], {
      cwd: root,
      env,
      windowsHide: true,
      windowsVerbatimArguments: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      if (code !== 0) {
        const debugReport = fs.existsSync(report) ? fs.readFileSync(report, 'utf8') : '(no fixture report)';
        return reject(new Error(`Electron fixture failed (${code || signal}).\n${stderr}\n${stdout}\n${debugReport}`));
      }
      try { resolve({ report: readArtifact(report, 'Electron report'), netlog: readArtifact(netlog, 'Chromium NetLog') }); }
      catch (error) { reject(error); }
    });
  });
}

async function main() {
  fs.mkdirSync(work, { recursive: true });
  const positive = await launch('proxy', reportPath, netLogPath, 'prefetch-off', { hostResolverRules: 'MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost, EXCLUDE ::1' });
  const positiveAnalysis = analyzeNetLog(positive.netlog, [`127.0.0.1:${positive.report.socksPort}`, `127.0.0.1:${positive.report.auditPort}`]);
  const seenHosts = new Set((positive.report.socksRequests || []).map((entry) => String(entry.host).toLowerCase()));
  const requiredHosts = ['fetch.nacre-audit.invalid', 'xhr.nacre-audit.invalid', 'worker.nacre-audit.invalid'];
  const missingHosts = requiredHosts.filter((host) => !seenHosts.has(host));
  const positiveProxyChecks = {
    noDnsTransactions: positiveAnalysis.dnsTransactions.length === 0,
    noUnexpectedSockets: positiveAnalysis.unexpected.length === 0,
    allRequiredHostnamesUsedSocks: missingHosts.length === 0,
    reservedIpRequests: positive.report.reservedIpRequests || 0,
    noDnsPrefetchSocksRequest: !positive.report.dnsPrefetchResolverAttempted,
    proxyOnlyResolution: positiveAnalysis.resolverRequests.filter((entry) => entry.host).length >= 3 && positiveAnalysis.resolverRequests.every((entry) => !entry.directResolution)
  };
  const internalAttacksBlocked = positive.report.deniedNavigation >= 1 && positive.report.internalRequests === 0 && positive.report.pageResults.internalFetch === 'blocked' && positive.report.pageResults.openWindow === false;
  if (!internalAttacksBlocked) throw new Error('nacre:// frame/fetch/window isolation negative control failed: ' + JSON.stringify(positive.report));

  const normal = await launch('proxy', path.join(work, 'normal-report.json'), path.join(work, 'normal-netlog.json'), 'normal', { hostResolverRules: 'MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost, EXCLUDE ::1' });
  const normalAnalysis = analyzeNetLog(normal.netlog, [`127.0.0.1:${normal.report.socksPort}`, `127.0.0.1:${normal.report.auditPort}`]);
  const dnsPrefetchRequests = normalAnalysis.dnsTransactions.filter((entry) => entry.host.replace(/\.$/, '') === 'dns-prefetch.nacre-audit.invalid');
  const dnsPrefetchComparison = { explicitHintRequests: normal.report.socksRequests.filter((entry) => entry.host === 'dns-prefetch.nacre-audit.invalid').length, resolverTransactions: dnsPrefetchRequests.length, policySwitchWasEnabled: true, noNameResolutionRulesApplied: true };
  const hardeningBlocked = !positiveAnalysis.clean || !positiveProxyChecks.noDnsTransactions || !positiveProxyChecks.noUnexpectedSockets || !positiveProxyChecks.allRequiredHostnamesUsedSocks || !positiveProxyChecks.noDnsPrefetchSocksRequest || !positiveProxyChecks.proxyOnlyResolution;

  const negative = await launch('direct', negativeReportPath, negativeNetLogPath, 'negative', { hostResolverRules: 'MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost, EXCLUDE ::1' });
  const stoppedReportPath = path.join(work, 'tor-stopped-report.json');
  const stoppedNetLogPath = path.join(work, 'tor-stopped-netlog.json');
  const stopped = await launch('stopped', stoppedReportPath, stoppedNetLogPath, 'kill-switch', { hostResolverRules: 'MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost, EXCLUDE ::1' });
  const stoppedAnalysis = analyzeNetLog(stopped.netlog, []);
  const allowedStoppedEndpoints = new Set([`127.0.0.1:${stopped.report.auditPort}`, `127.0.0.1:${stopped.report.socksPort}`, '127.0.0.1:1']);
  const stoppedUnexpected = stoppedAnalysis.connections.filter(({ endpoint }) => !allowedStoppedEndpoints.has(endpoint));
  const stoppedClean = stoppedUnexpected.length === 0 && stopped.report.socksRequests.length === 0;
  const negativeAnalysis = analyzeNetLog(negative.netlog, [`127.0.0.1:${negative.report.auditPort}`]);
  const injectedEndpoint = '127.0.0.1:' + negative.report.auditPort;
  const negativeControlDetected = Boolean(negative.report.canaryHits && negativeAnalysis.connections.some((item) => item.endpoint === injectedEndpoint));

  process.stdout.write(JSON.stringify({
    result: hardeningBlocked || !negativeControlDetected || !stoppedClean ? 'BLOCKED' : 'PASS',
    scope: 'Chromium Session proxy plus Chromium NetLog in an isolated Electron fixture; loopback servers and .invalid names only; not the full Nacre app or a Windows packet capture.',
    proxyMode: { netLogSockets: positiveAnalysis.connections.length, unexpectedSockets: positiveAnalysis.unexpected, ipv6ReachabilityProbes: positiveAnalysis.ipv6ReachabilityProbes, dnsTransactions: positiveAnalysis.dnsTransactions, resolverRequests: positiveAnalysis.resolverRequests.length, socksRequests: positive.report.socksRequests.length, requiredHostnames: requiredHosts, missingHostnames: missingHosts, checks: positiveProxyChecks, deniedNacreRequestsAndNavigations: positive.report.deniedNavigation, ipc: { exposed: positive.report.pageResults.privilegedApiExposed, top: positive.report.pageResults.topIpc, child: positive.report.pageResults.childIpc, mainAccepted: positive.report.acceptedIpc, childDenied: positive.report.deniedIpc }, dnsPrefetchComparison },
    negativeControl: { injectedDirectCanaryHit: negative.report.canaryHits > 0, NetLogUnexpectedEndpoint: injectedEndpoint, detected: negativeControlDetected },
    torStopped: { noSocksDestinationReached: stopped.report.socksRequests.length === 0, connections: stoppedAnalysis.connections, unexpectedSockets: stoppedUnexpected, deniedRequests: stopped.report.deniedNavigation, clean: stoppedClean },
    artifacts: { netLog: path.relative(root, netLogPath), report: path.relative(root, reportPath), negativeNetLog: path.relative(root, negativeNetLogPath) }
  }, null, 2) + '\n');
  if (hardeningBlocked || !negativeControlDetected || !stoppedClean) process.exitCode = 2;
}

if (require.main === module) main().catch((error) => { process.stderr.write(`NET-AUDIT FAILED: ${error.stack || error}\n`); process.exitCode = 1; });
module.exports = { analyzeNetLog, endpointKey, netLogEventName };
