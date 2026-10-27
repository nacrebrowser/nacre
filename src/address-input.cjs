'use strict';

const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const LOCAL_ADDRESS = new RegExp(`^(?:localhost|${OCTET}(?:\\.${OCTET}){3}|\\[::1\\])(?::\\d{1,5})?(?:[/?#]\\S*)?$`, 'i');

// Bare IPv4 addresses and localhost are opened over http://, never searched.
function isLocalAddressInput(input) {
  return typeof input === 'string' && LOCAL_ADDRESS.test(input);
}

module.exports = { isLocalAddressInput };
