import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { assertOperationAllowed, createGatewayServer, expectedSignature, validateTarget } from '../server.mjs';

const locked = { readOnly: true, allowTrading: false, allowWithdrawals: false };

test('accepts only approved Binance HTTPS hosts', () => {
  assert.equal(validateTarget('https://api.binance.com/api/v3/account').hostname, 'api.binance.com');
  assert.throws(() => validateTarget('http://api.binance.com/api/v3/account'));
  assert.throws(() => validateTarget('https://api.binance.com.evil.example/api/v3/account'));
  assert.throws(() => validateTarget('https://example.com/'));
});

test('read-only mode permits GET and blocks state changes', () => {
  assert.doesNotThrow(() => assertOperationAllowed('GET', '/api/v3/account', locked));
  assert.throws(() => assertOperationAllowed('POST', '/api/v3/order', locked), /read-only/);
  assert.throws(() => assertOperationAllowed('DELETE', '/api/v3/order', locked), /read-only/);
});

test('withdrawals remain separately gated', () => {
  const writes = { readOnly: false, allowTrading: true, allowWithdrawals: false };
  assert.throws(() => assertOperationAllowed('POST', '/sapi/v1/capital/withdraw/apply', writes), /Withdrawals/);
});

test('unknown write endpoints fail closed', () => {
  const writes = { readOnly: false, allowTrading: true, allowWithdrawals: true };
  assert.throws(() => assertOperationAllowed('POST', '/sapi/v1/unknown', writes), /not allowlisted/);
});

test('HMAC signature covers timestamp, nonce, and exact body', () => {
  const secret = 'a'.repeat(32);
  const timestamp = '1234567890';
  const nonce = 'nonce';
  const body = '{"url":"https://api.binance.com/api/v3/account"}';
  const expected = createHmac('sha256', secret).update(`${timestamp}.${nonce}.${body}`).digest('hex');
  assert.equal(expectedSignature(secret, timestamp, nonce, body), expected);
});

test('HTTP gateway authenticates requests and blocks writes before forwarding', async (t) => {
  const secret = 'b'.repeat(32);
  const server = createGatewayServer({
    sharedSecret: secret,
    readOnly: true,
    allowTrading: false,
    allowWithdrawals: false,
    upstreamTimeoutMs: 1_000,
    maxResponseBytes: 1_024,
    rateLimitPerMinute: 10,
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).mode, 'read_only');

  const unauthenticated = await fetch(`${base}/v1/relay`, { method: 'POST', body: '{}' });
  assert.equal(unauthenticated.status, 401);

  const rawBody = JSON.stringify({
    url: 'https://api.binance.com/api/v3/order',
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'symbol=BTCUSDT',
  });
  const timestamp = Date.now().toString();
  const nonce = 'integration-test-nonce';
  const signature = expectedSignature(secret, timestamp, nonce, rawBody);
  const blocked = await fetch(`${base}/v1/relay`, {
    method: 'POST',
    headers: {
      'X-FuelBTC-Timestamp': timestamp,
      'X-FuelBTC-Nonce': nonce,
      'X-FuelBTC-Signature': signature,
    },
    body: rawBody,
  });
  assert.equal(blocked.status, 403);
  assert.match((await blocked.json()).error, /read-only/);
});
