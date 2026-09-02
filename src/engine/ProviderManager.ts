// Provider Execution Engine — Central Provider Manager
//
// Responsibilities:
//   • Register / deregister provider adapters
//   • Execute providers in parallel (Promise.allSettled — fault tolerant)
//   • Enforce per-provider timeouts
//   • Retry transient failures with exponential backoff
//   • Read/write the cache layer
//   • Record health metrics
//   • Log every request lifecycle
//   • Validate inputs before dispatch
//   • Sanitize all data before exposure

import type {
  ProviderResponse,
  ProviderHealth,
  ProviderStatus,
  CheckerType,
  ExecutionOptions,
} from './types';
import { getEnabledProvidersForChecker, getProviderConfig } from './config';
import { engineCache, buildCacheKey } from './cache';
import { engineLogger } from './logger';

// ─── Adapter interface ────────────────────────────────────────────────────────
// Every provider implements this. The manager calls execute() for every request.
export interface ProviderAdapter<T = unknown> {
  readonly id: string;
  readonly supportedCheckers: readonly CheckerType[];
  execute(options: ExecutionOptions): Promise<ProviderResponse<T>>;
}

// ─── Retryable HTTP status codes ─────────────────────────────────────────────
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const NON_RETRYABLE_STATUS = new Set([400, 401, 403, 404, 422]);

// ─── Sleep helper ─────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ─── Health registry ──────────────────────────────────────────────────────────
class HealthRegistry {
  private health = new Map<string, ProviderHealth>();

  init(providerId: string): void {
    if (!this.health.has(providerId)) {
      this.health.set(providerId, {
        providerId,
        online: true,
        avgResponseMs: 0,
        lastSuccess: null,
        lastFailure: null,
        errorRate: 0,
        totalRequests: 0,
        totalErrors: 0,
        rateLimitHits: 0,
        consecutiveFailures: 0,
      });
    }
  }

  recordSuccess(providerId: string, durationMs: number): void {
    const h = this.getOrInit(providerId);
    h.totalRequests++;
    h.lastSuccess = Date.now();
    h.online = true;
    h.consecutiveFailures = 0;
    h.avgResponseMs = h.totalRequests === 1
      ? durationMs
      : Math.round((h.avgResponseMs * (h.totalRequests - 1) + durationMs) / h.totalRequests);
    h.errorRate = h.totalErrors / h.totalRequests;
  }

  recordFailure(providerId: string, isTimeout: boolean, httpStatus?: number): void {
    const h = this.getOrInit(providerId);
    h.totalRequests++;
    h.totalErrors++;
    h.lastFailure = Date.now();
    h.consecutiveFailures++;
    h.errorRate = h.totalErrors / h.totalRequests;
    if (httpStatus === 429) h.rateLimitHits++;
    // Mark offline after 3 consecutive failures
    if (h.consecutiveFailures >= 3) h.online = false;
    void isTimeout; // referenced for completeness
  }

  get(providerId: string): ProviderHealth | null {
    return this.health.get(providerId) ?? null;
  }

  all(): ProviderHealth[] {
    return Array.from(this.health.values());
  }

  private getOrInit(providerId: string): ProviderHealth {
    this.init(providerId);
    return this.health.get(providerId)!;
  }
}

// ─── Provider Manager ─────────────────────────────────────────────────────────
class ProviderManager {
  private adapters = new Map<string, ProviderAdapter>();
  readonly health = new HealthRegistry();

  // ── Registration ──────────────────────────────────────────────────────────

  register(adapter: ProviderAdapter): void {
    this.adapters.set(adapter.id, adapter);
    this.health.init(adapter.id);
  }

  unregister(id: string): void {
    this.adapters.delete(id);
  }

  listRegistered(): string[] {
    return Array.from(this.adapters.keys());
  }

  // ── Single-provider execution (with retry + timeout + cache) ──────────────

  private async executeOne<T>(
    adapter: ProviderAdapter<T>,
    options: ExecutionOptions,
    forceRefresh: boolean,
  ): Promise<ProviderResponse<T>> {
    const config = getProviderConfig(adapter.id);
    if (!config || !config.enabled) {
      return this.buildDisabled<T>(adapter.id);
    }

    // ── Cache lookup ──────────────────────────────────────────────────────
    const cacheKey = buildCacheKey(adapter.id, options.checkerType, {
      symbol: options.symbol ?? '',
      address: options.address ?? '',
      network: options.network ?? '',
      limit: options.limit ?? '',
      interval: options.interval ?? '',
    });

    if (!forceRefresh) {
      const cached = engineCache.get<T>(cacheKey);
      if (cached !== null) {
        engineLogger.logCacheHit(adapter.id, options.checkerType);
        return {
          provider: adapter.id,
          status: 'cached',
          durationMs: 0,
          confidence: 1,
          data: cached,
          evidence: ['Served from cache'],
          warnings: [],
          error: null,
          retryCount: 0,
          cacheHit: true,
          metadata: { cacheKey },
        };
      }
    }

    // ── Retry loop ────────────────────────────────────────────────────────
    const maxRetries = config.maxRetries ?? 2;
    let attempt = 0;
    let lastError = 'Unknown error';
    let lastStatus: ProviderStatus = 'failed';

    while (attempt <= maxRetries) {
      const logId = engineLogger.start(adapter.id, options.checkerType);
      const startedAt = Date.now();

      // ── Timeout wrapper ───────────────────────────────────────────────
      const timeoutMs = config.timeoutMs;
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

      const timeoutPromise = new Promise<ProviderResponse<T>>(resolve => {
        timeoutHandle = setTimeout(() => {
          const durationMs = Date.now() - startedAt;
          this.health.recordFailure(adapter.id, true);
          engineLogger.complete(logId, 'timeout', { retryCount: attempt });
          resolve({
            provider: adapter.id,
            status: 'timeout',
            durationMs,
            confidence: 0,
            data: null,
            evidence: [],
            warnings: [`Timed out after ${timeoutMs}ms`],
            error: `Timeout after ${timeoutMs}ms`,
            retryCount: attempt,
            cacheHit: false,
            metadata: {},
          });
        }, timeoutMs);
      });

      try {
        const result = await Promise.race([adapter.execute(options), timeoutPromise]);
        if (timeoutHandle) clearTimeout(timeoutHandle);

        if (result.status === 'timeout') {
          lastStatus = 'timeout';
          lastError = result.error ?? 'Timeout';
          // Timeouts are retried (might be transient overload)
          if (attempt < maxRetries) {
            await sleep(300 * Math.pow(2, attempt));
            attempt++;
            continue;
          }
          return result;
        }

        if (result.status === 'success' || result.status === 'partial') {
          const durationMs = Date.now() - startedAt;
          this.health.recordSuccess(adapter.id, durationMs);
          engineLogger.complete(logId, result.status, { retryCount: attempt });

          // Write to cache on success
          if (result.data !== null) {
            engineCache.set(cacheKey, result.data, config.cacheTtlMs, adapter.id);
          }
          return { ...result, retryCount: attempt, cacheHit: false };
        }

        // failed — check if retryable
        const httpStatus = (result.metadata?.httpStatus as number) ?? 0;
        engineLogger.complete(logId, 'failed', { httpStatus, retryCount: attempt, errorMessage: result.error });

        if (NON_RETRYABLE_STATUS.has(httpStatus)) {
          this.health.recordFailure(adapter.id, false, httpStatus);
          return { ...result, retryCount: attempt, cacheHit: false };
        }

        if (RETRYABLE_STATUS.has(httpStatus) && attempt < maxRetries) {
          this.health.recordFailure(adapter.id, false, httpStatus);
          lastError = result.error ?? 'Failed';
          lastStatus = 'failed';
          await sleep(500 * Math.pow(2, attempt));
          attempt++;
          continue;
        }

        this.health.recordFailure(adapter.id, false, httpStatus);
        return { ...result, retryCount: attempt, cacheHit: false };

      } catch (err) {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        const durationMs = Date.now() - startedAt;
        lastError = (err as Error).message ?? 'Unexpected error';
        lastStatus = 'failed';
        this.health.recordFailure(adapter.id, false);
        engineLogger.complete(logId, 'failed', { retryCount: attempt, errorMessage: lastError });

        if (attempt < maxRetries) {
          await sleep(500 * Math.pow(2, attempt));
          attempt++;
          continue;
        }

        return {
          provider: adapter.id,
          status: lastStatus,
          durationMs,
          confidence: 0,
          data: null,
          evidence: [],
          warnings: [],
          error: lastError,
          retryCount: attempt,
          cacheHit: false,
          metadata: {},
        };
      }
    }

    return this.buildError<T>(adapter.id, lastError, attempt);
  }

  // ── Parallel execution across all matching providers ──────────────────────
  //
  // Uses Promise.allSettled so one slow/failing provider never blocks others.
  // Returns results sorted by priority (primary providers first).

  async execute<T>(options: ExecutionOptions): Promise<ProviderResponse<T>[]> {
    // Input validation (sanitize before dispatch)
    const sanitized = this.sanitizeOptions(options);

    const enabledConfigs = getEnabledProvidersForChecker(sanitized.checkerType);
    const adaptersToRun = enabledConfigs
      .map(c => this.adapters.get(c.id))
      .filter((a): a is ProviderAdapter<T> => !!a);

    if (adaptersToRun.length === 0) {
      // Fall back to mock if no real adapters registered for this checker
      const mockAdapter = this.adapters.get('mock') as ProviderAdapter<T> | undefined;
      if (mockAdapter) {
        return [await this.executeOne(mockAdapter, sanitized, sanitized.forceRefresh ?? false)];
      }
      return [];
    }

    const forceRefresh = sanitized.forceRefresh ?? false;

    const settled = await Promise.allSettled(
      adaptersToRun.map(adapter => this.executeOne(adapter, sanitized, forceRefresh)),
    );

    return settled.map(r =>
      r.status === 'fulfilled'
        ? r.value
        : this.buildError<T>('unknown', (r.reason as Error)?.message ?? 'Rejected'),
    );
  }

  // ── Execute with automatic fallback (returns first success) ───────────────
  async executeWithFallback<T>(options: ExecutionOptions): Promise<ProviderResponse<T>> {
    const results = await this.execute<T>(options);
    const success = results.find(r => r.status === 'success' || r.status === 'cached');
    return success ?? results[0] ?? this.buildError<T>('none', 'No providers available');
  }

  // ── Health / diagnostics ──────────────────────────────────────────────────
  getHealth(providerId: string): ProviderHealth | null {
    return this.health.get(providerId);
  }

  getAllHealth(): ProviderHealth[] {
    return this.health.all();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private sanitizeOptions(options: ExecutionOptions): ExecutionOptions {
    return {
      ...options,
      // Strip dangerous characters from user-supplied strings
      symbol:  options.symbol?.replace(/[^A-Z0-9/_-]/gi, '').toUpperCase().slice(0, 20),
      address: options.address?.replace(/[^a-zA-Z0-9]/g, '').slice(0, 100),
      network: options.network?.replace(/[^a-z0-9_-]/gi, '').toLowerCase().slice(0, 30),
    };
  }

  private buildDisabled<T>(providerId: string): ProviderResponse<T> {
    return {
      provider: providerId,
      status: 'disabled',
      durationMs: 0,
      confidence: 0,
      data: null,
      evidence: [],
      warnings: ['Provider is disabled'],
      error: 'Provider disabled',
      retryCount: 0,
      cacheHit: false,
      metadata: {},
    };
  }

  private buildError<T>(providerId: string, message: string, retryCount = 0): ProviderResponse<T> {
    return {
      provider: providerId,
      status: 'failed',
      durationMs: 0,
      confidence: 0,
      data: null,
      evidence: [],
      warnings: [],
      error: message,
      retryCount,
      cacheHit: false,
      metadata: {},
    };
  }
}

// ─── Singleton instance ────────────────────────────────────────────────────────
export const providerManager = new ProviderManager();
