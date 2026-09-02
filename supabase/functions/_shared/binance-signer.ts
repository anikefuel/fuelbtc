// Shared Binance REST signing utilities for Edge Functions
// All signed Binance calls must go through the backend — never expose keys to frontend.

import { crypto } from 'https://deno.land/std@0.208.0/crypto/mod.ts';
import { encodeHex } from 'https://deno.land/std@0.208.0/encoding/hex.ts';

export const BINANCE_SPOT  = 'https://api.binance.com';
export const BINANCE_FAPI  = 'https://fapi.binance.com';
export const BINANCE_TEST  = 'https://testnet.binance.vision';

export interface ProviderKeys {
  apiKey:    string;
  apiSecret: string;
  isTestnet: boolean;
}

export async function hmacSha256(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return encodeHex(new Uint8Array(sig));
}

export function spotBase(isTestnet: boolean): string {
  return isTestnet ? BINANCE_TEST : BINANCE_SPOT;
}

export const BINANCE_FAPI_TEST = 'https://testnet.binancefuture.com';

export function futuresBase(isTestnet?: boolean): string {
  return isTestnet ? BINANCE_FAPI_TEST : BINANCE_FAPI;
}

/** Build signed query string and return full URL + headers */
export async function buildSignedUrl(
  baseUrl: string,
  path: string,
  params: Record<string, string | number | boolean>,
  apiKey: string,
  apiSecret: string,
): Promise<{ url: string; headers: Record<string, string> }> {
  const p: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) p[k] = String(v);
  p.timestamp = Date.now().toString();
  const qs  = new URLSearchParams(p).toString();
  const sig = await hmacSha256(apiSecret, qs);
  return {
    url: `${baseUrl}${path}?${qs}&signature=${sig}`,
    headers: { 'X-MBX-APIKEY': apiKey, 'Content-Type': 'application/x-www-form-urlencoded' },
  };
}

const REQUEST_TIMEOUT_MS = 15_000;

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('timeout') || msg.includes('Timeout') || msg.includes('timed out')) {
      throw new BinanceError(0, 'Network timeout: request to Binance timed out', url);
    }
    throw new BinanceError(0, `Network error: ${msg}`, url);
  }
}

/** Signed GET */
export async function signedGet<T>(
  baseUrl: string, path: string,
  params: Record<string, string | number | boolean>,
  apiKey: string, apiSecret: string,
): Promise<T> {
  const { url, headers } = await buildSignedUrl(baseUrl, path, params, apiKey, apiSecret);
  const res = await fetchWithTimeout(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new BinanceError(res.status, body, path);
  }
  return res.json() as Promise<T>;
}

/** Signed POST (body as query string per Binance docs) */
export async function signedPost<T>(
  baseUrl: string, path: string,
  params: Record<string, string | number | boolean>,
  apiKey: string, apiSecret: string,
): Promise<T> {
  const p: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) p[k] = String(v);
  p.timestamp = Date.now().toString();
  const qs  = new URLSearchParams(p).toString();
  const sig = await hmacSha256(apiSecret, qs);
  const body = `${qs}&signature=${sig}`;
  const res = await fetchWithTimeout(`${baseUrl}${path}`, {
    method:  'POST',
    headers: { 'X-MBX-APIKEY': apiKey, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new BinanceError(res.status, errBody, path);
  }
  return res.json() as Promise<T>;
}

/** Signed DELETE */
export async function signedDelete<T>(
  baseUrl: string, path: string,
  params: Record<string, string | number | boolean>,
  apiKey: string, apiSecret: string,
): Promise<T> {
  const p: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) p[k] = String(v);
  p.timestamp = Date.now().toString();
  const qs  = new URLSearchParams(p).toString();
  const sig = await hmacSha256(apiSecret, qs);
  const res = await fetchWithTimeout(`${baseUrl}${path}?${qs}&signature=${sig}`, {
    method:  'DELETE',
    headers: { 'X-MBX-APIKEY': apiKey },
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new BinanceError(res.status, errBody, path);
  }
  return res.json() as Promise<T>;
}

// ── Binance-specific error normalization ──────────────────────────────────────
export class BinanceError extends Error {
  public readonly httpStatus: number;
  public readonly binanceCode: number | null;
  public readonly raw: string;
  public readonly path: string;
  public readonly internalCode: string;

  constructor(httpStatus: number, body: string, path: string) {
    let binanceCode: number | null = null;
    let msg = body.slice(0, 300);
    let parsed: { code?: number; msg?: string } = {};
    try { parsed = JSON.parse(body); binanceCode = parsed.code ?? null; msg = parsed.msg ?? msg; } catch { /* raw */ }

    super(msg);
    this.httpStatus   = httpStatus;
    this.binanceCode  = binanceCode;
    this.raw          = body.slice(0, 500);
    this.path         = path;
    this.internalCode = BinanceError.normalizeCode(httpStatus, binanceCode, body);
  }

  private static normalizeCode(http: number, code: number | null, body: string): string {
    if (http === 429 || http === 418) return 'RATE_LIMITED';
    if (http === 0 || !body)          return 'NETWORK_TIMEOUT';
    if (code === -2015)               return 'API_KEY_IP_PERMISSION_INVALID';
    if (code === -2014)               return 'API_KEY_FORMAT_INVALID';
    if (code === -2016)               return 'API_KEY_SPOT_TRADING_DISABLED';
    if (code === -2010)               return 'INSUFFICIENT_BALANCE';
    if (code === -1013)               return 'MIN_NOTIONAL';
    if (code === -1111)               return 'INVALID_PRECISION';
    if (code === -1121)               return 'INVALID_SYMBOL';
    if (code === -1100)               return 'INVALID_PARAMETER';
    if (code === -1021)               return 'TIMESTAMP_OUTSIDE_RECV_WINDOW';
    if (code === -1022)               return 'INVALID_SIGNATURE';
    if (code === -1003)               return 'TOO_MANY_REQUESTS';
    if (code === -1002)               return 'UNAUTHORIZED';
    if (code === -2011)               return 'CANCEL_REJECTED';
    if (code === -2013)               return 'ORDER_NOT_FOUND';
    if (code === -3041)               return 'SPOT_PERMISSION_MISSING';
    if (body.includes('whitelist') || body.includes('IP')) return 'IP_NOT_WHITELISTED';
    if (body.includes('permission') || body.includes('permissions')) return 'SPOT_PERMISSION_MISSING';
    if (body.includes('Invalid API key') || body.includes('API-key')) return 'API_KEY_INVALID';
    if (http >= 500)                  return 'PROVIDER_UNAVAILABLE';
    return `BINANCE_ERROR_${code ?? http}`;
  }
}

// ── Precision helpers ─────────────────────────────────────────────────────────
export function roundToStep(value: number, step: number): number {
  if (!step || step <= 0) return value;
  const precision = Math.round(-Math.log10(step));
  return parseFloat((Math.floor(value / step) * step).toFixed(precision));
}

export function roundToTick(value: number, tick: number): number {
  if (!tick || tick <= 0) return value;
  const precision = Math.round(-Math.log10(tick));
  return parseFloat((Math.round(value / tick) * tick).toFixed(precision));
}
