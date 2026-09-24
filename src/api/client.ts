// Base API client — centralized HTTP layer
// All network requests go through here; swap providers without touching UI

import type { ApiError, ApiResponse } from '@/types';

// ─── Retry config ─────────────────────────────────────────────────────────────
const DEFAULT_RETRIES = 2;
const DEFAULT_TIMEOUT_MS = 10_000;
const RETRY_DELAY_MS = 500;

// ─── Error helpers ────────────────────────────────────────────────────────────
export function buildApiError(code: string, message: string, details?: Record<string, unknown>): ApiError {
  return { code, message, details };
}

export class ApiClientError extends Error {
  constructor(
    public readonly apiError: ApiError,
    public readonly status: number,
  ) {
    super(apiError.message);
    this.name = 'ApiClientError';
  }
}

// ─── Sleep utility ────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ─── Core fetch wrapper ───────────────────────────────────────────────────────
interface RequestOptions extends Omit<RequestInit, 'signal'> {
  timeoutMs?: number;
  retries?: number;
  params?: Record<string, string | number | boolean>;
}

export async function apiRequest<T>(
  url: string,
  options: RequestOptions = {},
): Promise<ApiResponse<T>> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, retries = DEFAULT_RETRIES, params, ...fetchOptions } = options;

  // Append query params
  const fullUrl = params
    ? `${url}?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])
      ).toString()}`
    : url;

  let lastError: ApiError = buildApiError('UNKNOWN', 'Unknown error');
  let lastStatus = 0;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(fullUrl, { ...fetchOptions, signal: controller.signal });
      clearTimeout(timer);

      if (!res.ok) {
        let errorBody: ApiError;
        try {
          errorBody = await res.json() as ApiError;
        } catch {
          errorBody = buildApiError('HTTP_ERROR', `HTTP ${res.status}: ${res.statusText}`);
        }
        // Don't retry 4xx client errors
        if (res.status >= 400 && res.status < 500) {
          return { data: null, error: errorBody, status: res.status };
        }
        lastError = errorBody;
        lastStatus = res.status;
      } else {
        const data: T = await res.json();
        return { data, error: null, status: res.status };
      }
    } catch (err) {
      clearTimeout(timer);
      if ((err as Error).name === 'AbortError') {
        lastError = buildApiError('TIMEOUT', `Request timed out after ${timeoutMs}ms`);
      } else {
        lastError = buildApiError('NETWORK_ERROR', (err as Error).message || 'Network error');
      }
      lastStatus = 0;
    }

    // Exponential backoff before retry
    if (attempt < retries) await sleep(RETRY_DELAY_MS * (attempt + 1));
  }

  return { data: null, error: lastError, status: lastStatus };
}

// ─── Convenience methods ──────────────────────────────────────────────────────
export const apiGet = <T>(url: string, options?: RequestOptions) =>
  apiRequest<T>(url, { method: 'GET', ...options });

export const apiPost = <T>(url: string, body: unknown, options?: RequestOptions) =>
  apiRequest<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    body: JSON.stringify(body),
    ...options,
  });

export const apiPut = <T>(url: string, body: unknown, options?: RequestOptions) =>
  apiRequest<T>(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    body: JSON.stringify(body),
    ...options,
  });

export const apiDelete = <T>(url: string, options?: RequestOptions) =>
  apiRequest<T>(url, { method: 'DELETE', ...options });

// ─── Simple in-memory cache ───────────────────────────────────────────────────
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

class ApiCache {
  private store = new Map<string, CacheEntry<unknown>>();

  set<T>(key: string, data: T, ttlMs: number): void {
    this.store.set(key, { data, expiresAt: Date.now() + ttlMs });
  }

  get<T>(key: string): T | null {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) { this.store.delete(key); return null; }
    return entry.data;
  }

  invalidate(key: string): void { this.store.delete(key); }
  invalidatePrefix(prefix: string): void {
    for (const k of this.store.keys()) { if (k.startsWith(prefix)) this.store.delete(k); }
  }
  clear(): void { this.store.clear(); }
}

export const apiCache = new ApiCache();

// ─── Cached GET helper ────────────────────────────────────────────────────────
export async function cachedGet<T>(
  cacheKey: string,
  url: string,
  ttlMs: number,
  options?: RequestOptions,
): Promise<ApiResponse<T>> {
  const cached = apiCache.get<T>(cacheKey);
  if (cached !== null) return { data: cached, error: null, status: 200 };

  const response = await apiGet<T>(url, options);
  if (response.data !== null) apiCache.set(cacheKey, response.data, ttlMs);
  return response;
}
