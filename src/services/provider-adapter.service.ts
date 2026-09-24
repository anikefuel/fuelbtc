// Provider Adapter Service
// Client-side bridge to the provider-action Edge Function.
// API credentials NEVER touch the frontend — all credential operations
// go through the Edge Function which reads secrets from Supabase DB.
//
// Supported providers (architecture — backend handles each differently):
//   binance | bybit | okx | kraken | coinbase | internal

import { supabase } from '@/client/supabase';
import { invokeEdgeFunction } from '@/lib/errors';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ProviderName = 'binance' | 'bybit' | 'okx' | 'kraken' | 'coinbase' | 'internal';

export interface ProviderConfig {
  id:           string;
  providerName: ProviderName;
  label:        string;
  isActive:     boolean;
  isTestnet:    boolean;
  hasKey:       boolean;           // true if api_key is set (never the key itself)
  permissions:  string[];
  notes:        string;
  healthStatus: 'active' | 'degraded' | 'rate_limited' | 'failed' | 'disabled' | 'unknown';
  lastSyncAt:   string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  avgResponseMs: number | null;
  errorCount:   number;
  syncError:    string | null;
  createdAt:    string;
  updatedAt:    string;
}

export interface ConnectionTestResult {
  ok:           boolean;
  provider:     string;
  label:        string;
  accountType:  string;
  permissions:  string[];
  canTrade:     boolean;
  canWithdraw:  boolean;
  latencyMs:    number;
  error?:       string;
}

export interface ProviderBalance {
  asset:      string;
  free:       number;
  locked:     number;
  walletType: string;
}

export interface ProviderBalancesResult {
  spot:          ProviderBalance[];
  futures:       ProviderBalance[];
  spotError:     string | null;
  futuresError:  string | null;
}

export interface ManualSyncResult {
  ok:              boolean;
  durationMs:      number;
  balancesSynced:  number;
  ordersSynced:    number;
  positionsSynced: number;
  warningsCreated: number;
  errors?:         string[];
}

export interface ReconciliationWarning {
  id:              string;
  providerName:    string;
  asset:           string;
  ledgerBalance:   number;
  providerBalance: number;
  delta:           number;
  deltaPct:        number | null;
  warningType:     string;
  details:         Record<string, unknown> | null;
  resolved:        boolean;
  createdAt:       string;
}

export interface SyncResult {
  id:              string;
  configId:        string;
  triggerType:     string;
  success:         boolean;
  balancesSynced:  number;
  ordersSynced:    number;
  positionsSynced: number;
  warningsCreated: number;
  errorMessage:    string | null;
  durationMs:      number | null;
  createdAt:       string;
}

// ─── Config CRUD (frontend-safe — never reads api_key/api_secret back) ────────

function mapConfig(row: Record<string, unknown>): ProviderConfig {
  return {
    // RPC returns "cfg_id" (renamed to avoid PostgreSQL OUT-param "id" ambiguity)
    id:            (row.cfg_id ?? row.id) as string,
    providerName:  row.provider_name as ProviderName,
    label:         String(row.label ?? row.provider_name),
    isActive:      Boolean(row.is_active),
    isTestnet:     Boolean(row.is_testnet),
    // has_key is a server-computed boolean; api_key truthy fallback for any legacy path
    hasKey:        row.has_key !== undefined ? Boolean(row.has_key) : Boolean(row.api_key),
    permissions:   Array.isArray(row.permissions) ? row.permissions as string[] : [],
    notes:         String(row.notes ?? ''),
    healthStatus:  (row.health_status as ProviderConfig['healthStatus']) ?? 'unknown',
    lastSyncAt:    (row.last_sync_at as string) ?? null,
    lastSuccessAt: (row.last_success_at as string) ?? null,
    lastFailureAt: (row.last_failure_at as string) ?? null,
    avgResponseMs: row.avg_response_ms != null ? Number(row.avg_response_ms) : null,
    errorCount:    Number(row.error_count ?? 0),
    syncError:     row.sync_error ? String(row.sync_error) : null,
    createdAt:     row.created_at as string,
    updatedAt:     row.updated_at as string,
  };
}

export async function listProviderConfigs(): Promise<ProviderConfig[]> {
  // Use SECURITY DEFINER RPC so api_key/api_secret are NEVER sent to the client.
  // The RPC verifies admin role server-side before returning any rows.
  const { data, error } = await supabase.rpc('list_provider_configs_safe');
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: Record<string, unknown>) => mapConfig(r));
}

export async function upsertProviderConfig(payload: {
  id?:           string;
  providerName:  string;
  label:         string;
  apiKey:        string;
  apiSecret:     string;
  passphrase?:   string;
  isTestnet:     boolean;
  permissions:   string[];
  notes:         string;
}): Promise<ProviderConfig> {
  // Verify the caller has admin role BEFORE calling the RPC.
  // The RPC also enforces this server-side via auth.uid(); this pre-check
  // gives a clearer error instead of "administrator account mapping is invalid."
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user?.id) throw new Error('Not authenticated. Please sign in again.');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, id')
    .eq('id', user.id)       // always auth UUID — never EXX text uid
    .maybeSingle();

  if (!profile) throw new Error('Admin profile not found. Ensure your account is fully set up.');
  if (profile.role !== 'admin') throw new Error('Administrator privileges required to save provider credentials.');

  // Use SECURITY DEFINER RPC so api_key/secret are written server-side.
  // The RPC reads auth.uid() for the user_id column — never uses a client-supplied UUID.
  const { data, error } = await supabase.rpc('save_provider_config', {
    p_id:          payload.id   ?? null,
    p_provider:    payload.providerName,
    p_label:       payload.label,
    p_api_key:     payload.apiKey.trim()        || null,
    p_api_secret:  payload.apiSecret.trim()     || null,
    p_passphrase:  payload.passphrase?.trim()   || null,
    p_is_testnet:  payload.isTestnet,
    p_permissions: payload.permissions,
    p_notes:       payload.notes,
  });
  if (error) throw new Error(`Failed to save provider config: ${error.message}`);
  const rows = data as Record<string, unknown>[] | null;
  if (!rows || rows.length === 0) {
    // RPC returned nothing — most likely the record id was not found for an update
    throw new Error(payload.id
      ? `Provider config not found (id: ${payload.id}). It may have been deleted.`
      : 'Provider config could not be created. Check database permissions.');
  }
  return mapConfig(rows[0]);
}

export async function toggleProviderActive(id: string, isActive: boolean): Promise<void> {
  const { error } = await supabase.from('exchange_provider_configs')
    .update({ is_active: isActive, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function toggleProviderTestnet(id: string, isTestnet: boolean): Promise<void> {
  const { error } = await supabase.from('exchange_provider_configs')
    .update({ is_testnet: isTestnet, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteProviderConfig(id: string): Promise<void> {
  const { error } = await supabase.from('exchange_provider_configs').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ─── Privileged actions (go through Edge Function) ───────────────────────────

export async function testConnection(configId: string): Promise<ConnectionTestResult> {
  return invokeEdgeFunction<ConnectionTestResult>('provider-action', { action: 'test-connection', configId });
}

export async function getProviderBalances(configId: string): Promise<ProviderBalancesResult> {
  return invokeEdgeFunction<ProviderBalancesResult>('provider-action', { action: 'get-balances', configId });
}

export async function runManualSync(configId: string): Promise<ManualSyncResult> {
  return invokeEdgeFunction<ManualSyncResult>('provider-action', { action: 'manual-sync', configId });
}

// ─── Reconciliation warnings ─────────────────────────────────────────────────

export async function listReconWarnings(limit = 50): Promise<ReconciliationWarning[]> {
  const { data, error } = await supabase
    .from('reconciliation_warnings')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => ({
    id:              r.id as string,
    providerName:    r.provider_name as string,
    asset:           r.asset as string,
    ledgerBalance:   Number(r.ledger_balance),
    providerBalance: Number(r.provider_balance),
    delta:           Number(r.delta),
    deltaPct:        r.delta_pct != null ? Number(r.delta_pct) : null,
    warningType:     r.warning_type as string,
    details:         r.details as Record<string, unknown> | null,
    resolved:        Boolean(r.resolved),
    createdAt:       r.created_at as string,
  }));
}

export async function resolveReconWarning(id: string, note: string): Promise<void> {
  const { error } = await supabase.from('reconciliation_warnings').update({
    resolved: true, resolved_at: new Date().toISOString(), resolution_note: note,
  }).eq('id', id);
  if (error) throw new Error(error.message);
}

// ─── Sync history ─────────────────────────────────────────────────────────────

export async function listSyncResults(configId: string, limit = 20): Promise<SyncResult[]> {
  const { data, error } = await supabase
    .from('provider_sync_results')
    .select('*')
    .eq('config_id', configId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => ({
    id:              r.id as string,
    configId:        r.config_id as string,
    triggerType:     r.trigger_type as string,
    success:         Boolean(r.success),
    balancesSynced:  Number(r.balances_synced),
    ordersSynced:    Number(r.orders_synced),
    positionsSynced: Number(r.positions_synced),
    warningsCreated: Number(r.warnings_created),
    errorMessage:    r.error_message as string | null,
    durationMs:      r.duration_ms != null ? Number(r.duration_ms) : null,
    createdAt:       r.created_at as string,
  }));
}
