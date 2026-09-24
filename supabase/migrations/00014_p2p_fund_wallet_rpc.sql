
-- ═══════════════════════════════════════════════════════════════════
-- RPC: p2p_fund_wallet
-- Credits a user's spot wallet (used by P2P "Fund Balance" flow).
-- Callable by authenticated user for their own wallet only.
-- Writes a wallet_ledger entry for full auditability.
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION p2p_fund_wallet(
  p_user_id  uuid,
  p_asset    text,
  p_amount   numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caller  uuid := auth.uid();
  v_wallet_id uuid;
BEGIN
  -- User can only fund their own wallet
  IF v_caller IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  -- Ensure spot wallet exists
  INSERT INTO wallets (id, user_id, asset, wallet_type,
                       available_balance, locked_balance, total_balance, updated_at)
  VALUES (gen_random_uuid(), p_user_id, p_asset, 'spot', 0, 0, 0, now())
  ON CONFLICT (user_id, asset, wallet_type) DO NOTHING;

  -- Credit available + total balance
  UPDATE wallets
     SET available_balance = available_balance + p_amount,
         total_balance     = total_balance     + p_amount,
         updated_at        = now()
   WHERE user_id     = p_user_id
     AND asset       = p_asset
     AND wallet_type = 'spot';

  -- Ledger entry
  SELECT id INTO v_wallet_id FROM wallets
   WHERE user_id = p_user_id AND asset = p_asset AND wallet_type = 'spot';

  INSERT INTO wallet_ledger (
    id, wallet_id, user_id, transaction_type, asset,
    amount, balance_before, balance_after,
    reference_type, description, created_at
  )
  SELECT gen_random_uuid(), w.id, p_user_id, 'p2p_fund', p_asset,
         p_amount,
         w.available_balance - p_amount,
         w.available_balance,
         'p2p_fund', 'P2P balance funding: ' || p_amount || ' ' || p_asset,
         now()
    FROM wallets w
   WHERE w.user_id = p_user_id AND w.asset = p_asset AND w.wallet_type = 'spot';
END;
$$;

GRANT EXECUTE ON FUNCTION p2p_fund_wallet(uuid, text, numeric) TO authenticated;
