// Provider Execution Engine — Standardized types
// Every provider in ExchangeX must conform to these interfaces.

// ─── Execution status ─────────────────────────────────────────────────────────
export type ProviderStatus = 'success' | 'timeout' | 'failed' | 'partial' | 'cached' | 'disabled';

// ─── Standardized provider response ──────────────────────────────────────────
// ALL providers return this shape regardless of success or failure.
export interface ProviderResponse<T = unknown> {
  provider: string;       // e.g. "binance", "coingecko"
  status: ProviderStatus;
  durationMs: number;     // wall-clock execution time
  confidence: number;     // 0–1 data quality score (1 = full data, 0 = no data)
  data: T | null;
  evidence: string[];     // human-readable proof points (e.g. "24h volume: $28B")
  warnings: string[];     // non-fatal issues (e.g. "stale data — last update 8 min ago")
  error: string | null;
  retryCount: number;
  cacheHit: boolean;
  metadata: Record<string, unknown>;
}

// ─── Checker types (what kind of intelligence is being requested) ─────────────
export type CheckerType =
  | 'market_data'
  | 'futures_market_data'
  | 'order_book'
  | 'candles'
  | 'trades'
  | 'token_security'
  | 'wallet_balance'
  | 'transaction_history'
  | 'blockchain_info'
  | 'fiat_banking'
  | 'launchpad';

// ─── Provider health snapshot ─────────────────────────────────────────────────
export interface ProviderHealth {
  providerId: string;
  online: boolean;
  avgResponseMs: number;
  lastSuccess: number | null;  // epoch ms
  lastFailure: number | null;
  errorRate: number;           // 0–1
  totalRequests: number;
  totalErrors: number;
  rateLimitHits: number;
  consecutiveFailures: number;
}

// ─── Provider configuration ───────────────────────────────────────────────────
export interface ProviderConfig {
  id: string;
  name: string;
  enabled: boolean;
  apiKey?: string;
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;       // 0–2
  cacheTtlMs: number;
  priority: number;         // lower = higher priority in failover
  supportedCheckers: CheckerType[];
  rateLimit?: {
    requestsPerMinute: number;
    requestsPerDay?: number;
  };
}

// ─── Engine execution options ─────────────────────────────────────────────────
export interface ExecutionOptions {
  checkerType: CheckerType;
  symbol?: string;
  address?: string;
  network?: string;
  limit?: number;
  interval?: string;
  forceRefresh?: boolean;   // bypass cache
}

// ─── Structured log entry ─────────────────────────────────────────────────────
export interface ProviderLogEntry {
  id: string;
  providerId: string;
  checkerType: CheckerType;
  startedAt: number;
  completedAt: number | null;
  durationMs: number | null;
  httpStatus: number | null;
  status: ProviderStatus;
  retryCount: number;
  cacheHit: boolean;
  errorMessage: string | null;
}
