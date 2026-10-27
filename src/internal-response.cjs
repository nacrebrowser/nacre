'use strict';

const INTERNAL_SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': "default-src 'self' data:; img-src 'self' data:; media-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), notifications=()'
});

async function secureInternalResponse(responsePromise, method = 'GET') {
  let response;
  try {
    response = await responsePromise;
  } catch {
    response = new Response('Internal page unavailable', { status: 500 });
  }
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(INTERNAL_SECURITY_HEADERS)) headers.set(name, value);
  return new Response(method === 'HEAD' ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function internalErrorResponse(status, message, method = 'GET') {
  if (![403, 404, 500].includes(status)) throw new RangeError('Unsupported internal response status.');
  return secureInternalResponse(Promise.resolve(new Response(message, { status })), method);
}

module.exports = { INTERNAL_SECURITY_HEADERS, secureInternalResponse, internalErrorResponse };
