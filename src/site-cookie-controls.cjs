'use strict';
const COOKIE_POLICIES = new Set(['allow', 'block-third-party', 'block-all']);
const { isIP } = require('node:net');
function validHost(host) {
  if(typeof host!=='string'||host.length>253||host!==host.toLowerCase())return false;
  if(host.startsWith('[')&&host.endsWith(']'))return isIP(host.slice(1,-1))===6;
  return host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) && !['__proto__','constructor','prototype'].includes(host);
}
function normalizeSiteCookiePolicies(raw) {
  const result=Object.create(null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
  for(const [host,policy] of Object.entries(raw).slice(0,1000))if(validHost(host)&&COOKIE_POLICIES.has(policy))result[host]=policy;
  return result;
}
function siteCookiePolicy(globalPolicy, host, policies, temporary) {
  const fallback=COOKIE_POLICIES.has(globalPolicy)?globalPolicy:'block-third-party';
  if(temporary && temporary.host===host && COOKIE_POLICIES.has(temporary.policy))return temporary.policy;
  return policies && Object.hasOwn(policies,host) && COOKIE_POLICIES.has(policies[host])?policies[host]:fallback;
}
function detachedCookiePolicy(globalPolicy, policies, temporaryPolicies=[]) {
  // No top site can be proven. Never use an allow exception to relax the route.
  const values=[COOKIE_POLICIES.has(globalPolicy)?globalPolicy:'block-third-party',...Object.values(normalizeSiteCookiePolicies(policies)),...temporaryPolicies];
  return values.includes('block-all')?'block-all':values.includes('block-third-party')?'block-third-party':'allow';
}
module.exports={COOKIE_POLICIES,validHost,normalizeSiteCookiePolicies,siteCookiePolicy,detachedCookiePolicy};
