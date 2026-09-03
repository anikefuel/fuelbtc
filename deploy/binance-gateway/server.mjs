import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

export const ALLOWED_HOSTS = new Set([
  'api.binance.com',
  'fapi.binance.com',
  'testnet.binance.vision',
  'testnet.binancefuture.com',
]);

const TRADING_PATHS = new Set([
  '/api/v3/order',
  '/fapi/v1/order',
  '/fapi/v1/leverage',
  '/fapi/v1/marginType',
  '/sapi/v1/futures/transfer',
]);
const WITHDRAWAL_PATH = '/sapi/v1/capital/withdraw/apply';
const ALLOWED_WRITE_PATHS = new Set([...TRADING_PATHS, WITHDRAWAL_PATH]);
const ALLOWED_METHODS = new Set(['GET', 'POST', 'DELETE']);
const AUTH_WINDOW_MS = 60_000;
const NONCE_TTL_MS = 5 * 60_000;

function boolEnv(value, fallback = false) {
  if (value === undefined) return fallback;
  return value.toLowerCase() === 'true';
}

export function loadConfig(env = process.env) {
  const sharedSecret = env.GATEWAY_SHARED_SECRET ?? '';
  if (sharedSecret.length < 32) {
    throw new Error('GATEWAY_SHARED_SECRET must contain at least 32 characters');
  }
  return {
    sharedSecret,
    readOnly: boolEnv(env.READ_ONLY, true),
    allowTrading: boolEnv(env.ALLOW_TRADING, false),
    allowWithdrawals: boolEnv(env.ALLOW_WITHDRAWALS, false),
    upstreamTimeoutMs: Number(env.UPSTREAM_TIMEOUT_MS ?? 15_000),
    maxResponseBytes: Number(env.MAX_RESPONSE_BYTES ?? 2_097_152),
    rateLimitPerMinute: Number(env.RATE_LIMIT_PER_MINUTE ?? 300),
  };
}

export function validateTarget(rawUrl) {
  let target;
  try { target = new URL(rawUrl); } catch { throw new Error('Invalid upstream URL'); }
  if (target.protocol !== 'https:' || target.port || target.username || target.password) {
    throw new Error('Only standard HTTPS Binance URLs are allowed');
  }
  if (!ALLOWED_HOSTS.has(target.hostname)) throw new Error('Upstream host is not allowed');
  return target;
}

export function assertOperationAllowed(method, pathname, config) {
  if (!ALLOWED_METHODS.has(method)) throw Object.assign(new Error('Method is not allowed'), { status: 405 });
  if (config.readOnly && method !== 'GET') {
    throw Object.assign(new Error('Gateway is in read-only mode'), { status: 403 });
  }
  if (method !== 'GET' && !ALLOWED_WRITE_PATHS.has(pathname)) {
    throw Object.assign(new Error('Write endpoint is not allowlisted'), { status: 403 });
  }
  if (pathname === WITHDRAWAL_PATH && !config.allowWithdrawals) {
    throw Object.assign(new Error('Withdrawals are disabled'), { status: 403 });
  }
  if ((method === 'POST' || method === 'DELETE') && TRADING_PATHS.has(pathname) && !config.allowTrading) {
    throw Object.assign(new Error('Trading operations are disabled'), { status: 403 });
  }
}

export function expectedSignature(secret, timestamp, nonce, rawBody) {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${nonce}.${rawBody}`)
    .digest('hex');
}

function equalSignature(left, right) {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

async function readBody(req, maxBytes = 262_144) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('Request body is too large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function filteredHeaders(input = {}) {
  const headers = {};
  for (const [name, value] of Object.entries(input)) {
    const lower = name.toLowerCase();
    if (lower === 'x-mbx-apikey' || lower === 'content-type') headers[name] = String(value);
  }
  return headers;
}

export function createGatewayServer(config = loadConfig()) {
  const seenNonces = new Map();
  let windowStartedAt = Date.now();
  let requestCount = 0;
  let egressCache = { ip: null, expiresAt: 0 };

  const cleanupNonces = (now) => {
    for (const [nonce, expiresAt] of seenNonces) if (expiresAt <= now) seenNonces.delete(nonce);
  };

  return createServer(async (req, res) => {
    const requestId = randomUUID();
    try {
      if (req.method === 'GET' && req.url === '/health') {
        return json(res, 200, {
          ok: true,
          service: 'fuelbtc-binance-gateway',
          mode: config.readOnly ? 'read_only' : 'controlled_writes',
          tradingEnabled: config.allowTrading,
          withdrawalsEnabled: config.allowWithdrawals,
        });
      }
      if (req.method === 'GET' && req.url === '/egress') {
        if (egressCache.ip && egressCache.expiresAt > Date.now()) {
          return json(res, 200, { ok: true, ip: egressCache.ip });
        }
        const response = await fetch('https://api.ipify.org?format=json', {
          signal: AbortSignal.timeout(5_000),
        });
        if (!response.ok) return json(res, 502, { ok: false, error: 'Egress lookup failed', requestId });
        const data = await response.json();
        const ip = typeof data.ip === 'string' ? data.ip : null;
        if (!ip || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
          return json(res, 502, { ok: false, error: 'Invalid egress response', requestId });
        }
        egressCache = { ip, expiresAt: Date.now() + 5 * 60_000 };
        return json(res, 200, { ok: true, ip });
      }
      if (req.method !== 'POST' || req.url !== '/v1/relay') {
        return json(res, 404, { ok: false, error: 'Not found', requestId });
      }

      const now = Date.now();
      if (now - windowStartedAt >= 60_000) {
        windowStartedAt = now;
        requestCount = 0;
      }
      requestCount += 1;
      if (requestCount > config.rateLimitPerMinute) {
        return json(res, 429, { ok: false, error: 'Gateway rate limit exceeded', requestId });
      }

      const rawBody = await readBody(req);
      const timestamp = req.headers['x-fuelbtc-timestamp'];
      const nonce = req.headers['x-fuelbtc-nonce'];
      const signature = req.headers['x-fuelbtc-signature'];
      if (typeof timestamp !== 'string' || typeof nonce !== 'string' || typeof signature !== 'string') {
        return json(res, 401, { ok: false, error: 'Missing gateway authentication', requestId });
      }
      const requestTime = Number(timestamp);
      if (!Number.isFinite(requestTime) || Math.abs(now - requestTime) > AUTH_WINDOW_MS) {
        return json(res, 401, { ok: false, error: 'Expired gateway request', requestId });
      }
      cleanupNonces(now);
      if (seenNonces.has(nonce)) return json(res, 409, { ok: false, error: 'Replayed request', requestId });
      const expected = expectedSignature(config.sharedSecret, timestamp, nonce, rawBody);
      if (!equalSignature(expected, signature)) {
        return json(res, 401, { ok: false, error: 'Invalid gateway authentication', requestId });
      }
      seenNonces.set(nonce, now + NONCE_TTL_MS);

      let payload;
      try { payload = JSON.parse(rawBody); } catch { throw Object.assign(new Error('Invalid JSON body'), { status: 400 }); }
      const method = String(payload.method ?? 'GET').toUpperCase();
      const target = validateTarget(payload.url);
      assertOperationAllowed(method, target.pathname, config);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.upstreamTimeoutMs);
      let upstream;
      try {
        upstream = await fetch(target, {
          method,
          headers: filteredHeaders(payload.headers),
          body: method === 'GET' ? undefined : (payload.body ?? undefined),
          redirect: 'manual',
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      const declaredLength = Number(upstream.headers.get('content-length') ?? 0);
      if (declaredLength > config.maxResponseBytes) {
        return json(res, 502, { ok: false, error: 'Upstream response is too large', requestId });
      }
      const responseBuffer = Buffer.from(await upstream.arrayBuffer());
      if (responseBuffer.length > config.maxResponseBytes) {
        return json(res, 502, { ok: false, error: 'Upstream response is too large', requestId });
      }
      console.log(JSON.stringify({
        requestId,
        method,
        host: target.hostname,
        path: target.pathname,
        status: upstream.status,
      }));
      res.writeHead(upstream.status, {
        'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
        'Content-Length': responseBuffer.length,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(responseBuffer);
    } catch (error) {
      const status = Number(error?.status ?? (error?.name === 'AbortError' ? 504 : 502));
      console.error(JSON.stringify({ requestId, error: error instanceof Error ? error.message : String(error) }));
      json(res, status, { ok: false, error: error instanceof Error ? error.message : 'Gateway error', requestId });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3000);
  const server = createGatewayServer();
  server.listen(port, '0.0.0.0', () => {
    console.log(JSON.stringify({ service: 'fuelbtc-binance-gateway', port }));
  });
}
