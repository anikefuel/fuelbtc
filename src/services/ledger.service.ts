// Ledger Service — read ledger entries (all writes go through DB functions)
import { supabase } from '@/client/supabase';

export type LedgerEntryType =
  | 'deposit_credit' | 'withdrawal_debit' | 'trade_debit' | 'trade_credit'
  | 'p2p_escrow_lock' | 'p2p_escrow_release' | 'fee_debit' | 'fee_credit'
  | 'refund_credit' | 'admin_adjustment' | 'conversion_debit' | 'conversion_credit';

export interface LedgerEntry {
  id: string;
  userId: string;
  asset: string;
  accountId: string;
  entryType: LedgerEntryType;
  debit: number;
  credit: number;
  balanceBefore: number;
  balanceAfter: number;
  referenceId?: string;
  referenceType?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

/** Fetch ledger entry history for the current user */
export async function getLedgerEntries(params?: {
  asset?: string;
  entryType?: LedgerEntryType;
  limit?: number;
  offset?: number;
}): Promise<LedgerEntry[]> {
  let query = supabase
    .from('ledger_entries')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(params?.limit ?? 50);

  if (params?.asset) query = query.eq('asset', params.asset);
  if (params?.entryType) query = query.eq('entry_type', params.entryType);
  if (params?.offset) query = query.range(params.offset, params.offset + (params.limit ?? 50) - 1);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return (data ?? []).map(row => ({
    id: row.id,
    userId: row.user_id,
    asset: row.asset,
    accountId: row.account_id,
    entryType: row.entry_type as LedgerEntryType,
    debit: Number(row.debit),
    credit: Number(row.credit),
    balanceBefore: Number(row.balance_before),
    balanceAfter: Number(row.balance_after),
    referenceId: row.reference_id ?? undefined,
    referenceType: row.reference_type ?? undefined,
    description: row.description ?? undefined,
    metadata: row.metadata ?? undefined,
    createdAt: row.created_at,
  }));
}

/** Human-readable label for a ledger entry type */
export function entryTypeLabel(type: LedgerEntryType): string {
  const labels: Record<LedgerEntryType, string> = {
    deposit_credit: 'Deposit',
    withdrawal_debit: 'Withdrawal',
    trade_debit: 'Trade (sell)',
    trade_credit: 'Trade (buy)',
    p2p_escrow_lock: 'P2P Escrow Lock',
    p2p_escrow_release: 'P2P Escrow Release',
    fee_debit: 'Fee',
    fee_credit: 'Fee Refund',
    refund_credit: 'Refund',
    admin_adjustment: 'Admin Adjustment',
    conversion_debit: 'Conversion (out)',
    conversion_credit: 'Conversion (in)',
  };
  return labels[type] ?? type;
}

/** Whether the entry increased the user's available balance */
export function isCredit(type: LedgerEntryType): boolean {
  return ['deposit_credit','trade_credit','p2p_escrow_release','fee_credit','refund_credit','admin_adjustment','conversion_credit'].includes(type);
}
