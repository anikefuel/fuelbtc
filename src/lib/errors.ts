// Shared error helpers for ExchangeX
// Never expose raw stack traces, SQL errors, API keys, or internal paths to the UI.

import { supabase } from '@/client/supabase';

// ─── Structured provider error (returned by Edge Functions from Binance, etc.) ─
export interface ProviderErrorDetails {
  source: 'exchange' | 'edge_function' | 'provider' | 'network' | 'unknown';
  provider?: string;   // e.g. "Binance"
  code?: string | number;
  message: string;
  status?: number;
}

/** Error subclass for failures originating at an external exchange/provider */
export class ProviderError extends Error {
  public readonly source: ProviderErrorDetails['source'];
  public readonly provider?: string;
  public readonly code?: string | number;
  public readonly status?: number;

  constructor(details: ProviderErrorDetails) {
    super(details.message);
    this.name = 'ProviderError';
    this.source = details.source;
    this.provider = details.provider;
    this.code = details.code;
    this.status = details.status;
  }

  toUserString(): string {
    const lines: string[] = [];
    if (this.provider) lines.push(`Exchange: ${this.provider}`);
    if (this.code !== undefined) lines.push(`Error Code: ${this.code}`);
    lines.push(`Message: ${this.message}`);
    return lines.join('\n');
  }
}

/** Error subclass so callers can distinguish Edge Function errors from others */
export class EdgeFunctionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EdgeFunctionError';
  }
}

// ─── Edge Function invocation with proper error extraction ───────────────────
// supabase.functions.invoke() wraps non-2xx in FunctionsHttpError.
// fnErr.message is always the generic "Edge Function returned a non-2xx status code".
// The actual JSON body lives in fnErr.context (a Response object).
export async function invokeEdgeFunction<T = unknown>(
  name: string,
  body: Record<string, unknown>,
): Promise<T> {
  const { data, error: fnErr } = await supabase.functions.invoke(name, { body });

  if (fnErr) {
    // Try to extract the structured error body from the response
    let details: ProviderErrorDetails = {
      source: 'edge_function',
      message: fnErr.message,
    };
    try {
      const ctx = (fnErr as { context?: Response }).context;
      if (ctx && typeof ctx.json === 'function') {
        const respBody = await ctx.json() as Partial<ProviderErrorDetails & { ok?: boolean; error?: string; message?: string; code?: string | number; provider?: string; source?: string; status?: number }>;
        const message = respBody?.message ?? respBody?.error ?? fnErr.message;
        details = {
          source: normalizeSource(respBody?.source),
          provider: respBody?.provider,
          code: respBody?.code,
          message,
          status: respBody?.status ?? ctx.status,
        };
      }
    } catch { /* keep original */ }
    throw new ProviderError(details);
  }

  // Edge Function can also return an error inside the data payload
  const payload = data as Partial<{ ok?: boolean; message?: string; error?: string; code?: string | number; provider?: string; source?: string }> | undefined;
  if (payload && payload.ok === false) {
    throw new ProviderError({
      source: normalizeSource(payload.source),
      provider: payload.provider,
      code: payload.code,
      message: payload.message ?? payload.error ?? 'Edge function returned an error',
    });
  }

  return data as T;
}

function normalizeSource(raw?: string | null): ProviderErrorDetails['source'] {
  if (!raw) return 'edge_function';
  if (raw === 'binance') return 'provider';
  if (['provider', 'exchange', 'edge_function', 'network', 'unknown'].includes(raw)) {
    return raw as ProviderErrorDetails['source'];
  }
  if (raw === 'binance_api') return 'provider';
  return 'edge_function';
}

// ─── User-friendly message mapping ───────────────────────────────────────────
// Map raw error strings (from RPCs, DB, providers) to safe UI messages.
type Mapper = (raw: string) => string;
const SAFE_MESSAGES: Array<[RegExp, Mapper]> = [
  // ── KYC-specific (must come FIRST — before the sensitive-string filter) ──
  [/attempt is already (verified|rejected).*manual decision/i,
    (m) => {
      const s = m.match(/already (\w+)/i)?.[1] ?? 'finalized';
      return `This attempt is already ${s} (manual decision). Use force override to reopen.`;
    }],
  [/attempt is already/i,
    (m) => `Attempt already ${m.match(/already (\w+)/i)?.[1] ?? 'processed'} — no change made.`],
  [/reason is required for reject/i,  () => 'A reason is required when rejecting a verification.'],
  [/admin role required/i,            () => 'You do not have permission to perform this action.'],
  [/attempt.*not found|kyc attempt not found/i, () => 'KYC attempt not found — it may have been deleted.'],
  [/profile update failed/i,          () => 'Profile could not be updated. Please try again.'],
  [/attempt update failed|zero rows returned/i,
    () => 'KYC attempt could not be updated. Please refresh and retry.'],
  [/status mismatch/i,                () => 'Unexpected status conflict. Please refresh and retry.'],
  [/forbidden/i,                      () => 'You do not have permission to perform this action.'],
  [/unauthorized/i,                   () => 'Session expired. Please sign in again.'],
  // ── Database schema / UUID errors ─────────────────────────────────────────
  [/invalid input syntax for type uuid/i,
    () => 'Unable to save provider credentials. Administrator account mapping is invalid.'],
  [/column.*available_balance.*does not exist|available_balance.*column/i,
    () => 'Wallet service is temporarily unavailable. Please try again shortly.'],
  [/column.*of relation.*does not exist/i,
    () => 'Wallet service is temporarily unavailable. Please try again shortly.'],
  [/relation.*does not exist|table.*does not exist/i,
    () => 'A required service is unavailable. Please contact support.'],
  [/not authoris|not authorized/i,
    () => 'You do not have permission to perform this action.'],
  [/insufficient.*balance|balance.*insufficient/i, (m) => {
    const asset = m.match(/insufficient\s+(\w+)\s+balance/i)?.[1];
    return asset ? `Insufficient ${asset} balance` : 'Insufficient balance';
  }],
  [/product not found or inactive/i, () => 'This Earn product is no longer available'],
  [/amount.*below minimum/i, (m) => {
    const nums = m.match(/[\d.]+/g);
    return (nums && nums.length >= 2)
      ? `Minimum subscription is ${nums[0]} ${nums[1] ?? ''}`
      : 'Amount below the minimum';
  }],
  [/subscription not found|already redeemed/i, () => 'Subscription not found or already redeemed'],
  [/fixed subscription locked until/i, (m) => {
    const date = m.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    return date ? `This subscription is locked until ${date}` : 'Subscription is locked';
  }],
  [/trade not found/i, () => 'Trade not found'],
  [/escrow already released/i, () => 'Funds already released'],
  [/trade not in releasable state/i, () => 'Trade cannot be released in its current state'],
  [/only the seller can release/i, () => 'Only the seller can release funds'],
  [/rate limit/i, () => 'Too many requests. Please wait a moment.'],
  [/network error|failed to fetch/i, () => 'Network error. Check your connection.'],
  [/timeout/i, () => 'Request timed out. Please try again.'],
  [/duplicate|already processed|idempotency/i, () => 'This action was already processed'],
];

export function toUserMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  // Structured provider/exchange errors — preserve code + message
  if (err instanceof ProviderError) {
    return err.toUserString();
  }

  const raw = err instanceof Error ? err.message : String(err);

  // Check safe-message patterns FIRST (before sensitive-string filter)
  // so schema/UUID errors are translated rather than hidden.
  for (const [pattern, mapper] of SAFE_MESSAGES) {
    if (pattern.test(raw)) return mapper(raw);
  }

  // Bail out on obvious sensitive strings after pattern matching
  if (/sql|plpgsql|stack|trace|key|secret|token|password/i.test(raw)) return fallback;

  // Return raw if it looks user-safe (no technical jargon)
  if (raw.length < 120 && !/select|insert|update|delete|from|where|pg_|supabase/i.test(raw)) {
    return raw;
  }
  return fallback;
}
