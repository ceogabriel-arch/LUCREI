import crypto from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { verifyHypercashSignature } from './hypercash-webhook';

const SECRET = 'whsec_test_secret';
const BODY = '{"type":"subscription.test"}';

function sign(timestamp: number, body: string, secret = SECRET) {
  const hash = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${hash}`;
}

describe('verifyHypercashSignature', () => {
  it('accepts a correctly signed, fresh header', () => {
    const header = sign(Math.floor(Date.now() / 1000), BODY);
    expect(verifyHypercashSignature(header, BODY, SECRET)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const header = sign(Math.floor(Date.now() / 1000), BODY);
    expect(verifyHypercashSignature(header, BODY + 'x', SECRET)).toBe(false);
  });

  it('rejects the wrong secret', () => {
    const header = sign(Math.floor(Date.now() / 1000), BODY, 'whsec_other');
    expect(verifyHypercashSignature(header, BODY, SECRET)).toBe(false);
  });

  it('rejects a header older than the tolerance window', () => {
    const header = sign(Math.floor(Date.now() / 1000) - 10 * 60, BODY);
    expect(verifyHypercashSignature(header, BODY, SECRET)).toBe(false);
  });

  it('rejects a missing header', () => {
    expect(verifyHypercashSignature(undefined, BODY, SECRET)).toBe(false);
  });

  it('rejects a malformed header', () => {
    expect(verifyHypercashSignature('garbage', BODY, SECRET)).toBe(false);
  });

  it('rejects when the secret is empty', () => {
    const header = sign(Math.floor(Date.now() / 1000), BODY);
    expect(verifyHypercashSignature(header, BODY, '')).toBe(false);
  });
});
