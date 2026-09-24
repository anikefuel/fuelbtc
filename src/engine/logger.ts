// Provider Execution Engine — Structured Logger
// Records every provider request lifecycle: start → complete/timeout/error
// Logs are kept in memory (ring buffer, max 500 entries) and are searchable.

import type { ProviderLogEntry, ProviderStatus, CheckerType } from './types';

let _logIdCounter = 0;

function genLogId(): string {
  return `log_${Date.now()}_${++_logIdCounter}`;
}

class EngineLogger {
  private maxEntries = 500;
  private logs: ProviderLogEntry[] = [];

  /** Called when a provider request starts */
  start(providerId: string, checkerType: CheckerType): string {
    const id = genLogId();
    const entry: ProviderLogEntry = {
      id,
      providerId,
      checkerType,
      startedAt: Date.now(),
      completedAt: null,
      durationMs: null,
      httpStatus: null,
      status: 'failed',  // will be updated on complete
      retryCount: 0,
      cacheHit: false,
      errorMessage: null,
    };
    this.append(entry);
    return id; // callers use this id to complete the log
  }

  /** Called when a provider request completes (success or failure) */
  complete(
    logId: string,
    status: ProviderStatus,
    opts: {
      httpStatus?: number;
      retryCount?: number;
      cacheHit?: boolean;
      errorMessage?: string | null;
    } = {},
  ): void {
    const entry = this.logs.find(l => l.id === logId);
    if (!entry) return;
    entry.completedAt = Date.now();
    entry.durationMs = entry.completedAt - entry.startedAt;
    entry.status = status;
    entry.httpStatus = opts.httpStatus ?? null;
    entry.retryCount = opts.retryCount ?? 0;
    entry.cacheHit = opts.cacheHit ?? false;
    entry.errorMessage = opts.errorMessage ?? null;
  }

  /** Instant cache-hit log (no async round-trip needed) */
  logCacheHit(providerId: string, checkerType: CheckerType): void {
    const now = Date.now();
    const entry: ProviderLogEntry = {
      id: genLogId(),
      providerId,
      checkerType,
      startedAt: now,
      completedAt: now,
      durationMs: 0,
      httpStatus: null,
      status: 'cached',
      retryCount: 0,
      cacheHit: true,
      errorMessage: null,
    };
    this.append(entry);
  }

  /** Return all logs (most recent first) */
  all(): ProviderLogEntry[] {
    return [...this.logs].reverse();
  }

  /** Filter logs by provider */
  forProvider(providerId: string): ProviderLogEntry[] {
    return this.logs.filter(l => l.providerId === providerId).reverse();
  }

  /** Filter logs by checker type */
  forChecker(checkerType: CheckerType): ProviderLogEntry[] {
    return this.logs.filter(l => l.checkerType === checkerType).reverse();
  }

  /** Return only failed / errored entries */
  errors(): ProviderLogEntry[] {
    return this.logs.filter(l => l.status === 'failed' || l.status === 'timeout').reverse();
  }

  /** Compute summary stats per provider */
  summary(): Record<string, { total: number; success: number; failed: number; timeout: number; avgDurationMs: number }> {
    const acc: Record<string, { total: number; success: number; failed: number; timeout: number; durations: number[] }> = {};
    for (const l of this.logs) {
      if (!acc[l.providerId]) acc[l.providerId] = { total: 0, success: 0, failed: 0, timeout: 0, durations: [] };
      acc[l.providerId].total++;
      if (l.status === 'success' || l.status === 'cached') acc[l.providerId].success++;
      else if (l.status === 'failed') acc[l.providerId].failed++;
      else if (l.status === 'timeout') acc[l.providerId].timeout++;
      if (l.durationMs !== null) acc[l.providerId].durations.push(l.durationMs);
    }
    const result: Record<string, { total: number; success: number; failed: number; timeout: number; avgDurationMs: number }> = {};
    for (const [id, s] of Object.entries(acc)) {
      const avg = s.durations.length > 0 ? Math.round(s.durations.reduce((a, b) => a + b, 0) / s.durations.length) : 0;
      result[id] = { total: s.total, success: s.success, failed: s.failed, timeout: s.timeout, avgDurationMs: avg };
    }
    return result;
  }

  /** Clear log history */
  clear(): void { this.logs = []; }

  private append(entry: ProviderLogEntry): void {
    this.logs.push(entry);
    // Ring buffer: trim oldest when over limit
    if (this.logs.length > this.maxEntries) {
      this.logs = this.logs.slice(this.logs.length - this.maxEntries);
    }
  }
}

// Singleton
export const engineLogger = new EngineLogger();
