/**
 * The Host routes' request fence.
 *
 * The old check compared `Origin` to the request's own `Host`, which a DNS-rebinding page passes: both
 * headers carry the attacker's hostname while the socket lands on 127.0.0.1. These cases pin the
 * listener-authority check that replaces it.
 */
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { test } from 'node:test';
import { isTrustedRequest } from '../src/dsh-viewtune.ts';

const BOUND = '127.0.0.1:61181';

function request(headers: Record<string, string | undefined>): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

test('the listener authority and loopback names are trusted; foreign hosts are not', () => {
  assert.equal(isTrustedRequest(request({ host: BOUND }), BOUND), true);
  assert.equal(isTrustedRequest(request({ host: 'localhost:61181' }), BOUND), true);
  assert.equal(isTrustedRequest(request({ host: '[::1]:61181' }), BOUND), true);
  // DNS rebinding: Host and Origin agree with each other, but not with the listener.
  assert.equal(isTrustedRequest(request({ host: 'evil.example:61181', origin: 'http://evil.example:61181' }), BOUND), false);
  assert.equal(isTrustedRequest(request({ host: '192.168.1.9:61181' }), BOUND), false);
  // A configured non-loopback listener is trusted by its own authority.
  assert.equal(isTrustedRequest(request({ host: '192.168.1.9:61181' }), '192.168.1.9:61181'), true);
  assert.equal(isTrustedRequest(request({}), BOUND), false);
});

test('Origin and Referer must agree with Host, and a cross-site fetch is refused', () => {
  assert.equal(isTrustedRequest(request({ host: BOUND, origin: `http://${BOUND}` }), BOUND), true);
  assert.equal(isTrustedRequest(request({ host: BOUND, referer: `http://${BOUND}/session` }), BOUND), true);
  assert.equal(isTrustedRequest(request({ host: BOUND, origin: 'http://evil.example' }), BOUND), false);
  assert.equal(isTrustedRequest(request({ host: BOUND, origin: 'http://127.0.0.1:9999' }), BOUND), false);
  assert.equal(isTrustedRequest(request({ host: BOUND, origin: 'null' }), BOUND), false);
  assert.equal(isTrustedRequest(request({ host: BOUND, 'sec-fetch-site': 'cross-site' }), BOUND), false);
  assert.equal(isTrustedRequest(request({ host: BOUND, 'sec-fetch-site': 'same-origin' }), BOUND), true);
});
