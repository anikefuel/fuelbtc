
-- ─── p2p_open_dispute: atomic trade freeze + dispute creation ───────────────
CREATE OR REPLACE FUNCTION p2p_open_dispute(
  p_trade_id    uuid,
  p_reason      text,
  p_description text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id    uuid := auth.uid();
  v_trade      p2p_trades%ROWTYPE;
  v_dispute_id uuid;
BEGIN
  SELECT * INTO v_trade FROM p2p_trades WHERE id = p_trade_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trade not found'; END IF;
  IF v_user_id IS DISTINCT FROM v_trade.buyer_id AND v_user_id IS DISTINCT FROM v_trade.seller_id THEN
    RAISE EXCEPTION 'Access denied: not a trade party';
  END IF;
  IF v_trade.status = 'disputed' THEN
    SELECT id INTO v_dispute_id FROM p2p_disputes WHERE trade_id = p_trade_id ORDER BY created_at DESC LIMIT 1;
    IF FOUND THEN RETURN v_dispute_id; END IF;
  END IF;
  IF v_trade.status NOT IN ('awaiting_payment','payment_marked','awaiting_release') THEN
    RAISE EXCEPTION 'Cannot dispute trade in status: %', v_trade.status;
  END IF;
  UPDATE p2p_trades SET status = 'disputed', updated_at = now() WHERE id = p_trade_id;
  INSERT INTO p2p_disputes (trade_id, raised_by, reason, description, status)
    VALUES (p_trade_id, v_user_id, p_reason, p_description, 'open') RETURNING id INTO v_dispute_id;
  INSERT INTO p2p_trade_messages (trade_id, sender_id, message, is_system)
    VALUES (p_trade_id, NULL, 'Dispute opened: ' || p_reason || '. Trade frozen pending admin review.', true);
  INSERT INTO p2p_notifications (user_id, trade_id, type, title, body) VALUES
    (v_trade.buyer_id,  p_trade_id, 'dispute_opened', 'Dispute Opened', 'A dispute was raised for trade #' || substr(v_trade.trade_number, 1, 8) || '. Awaiting admin review.'),
    (v_trade.seller_id, p_trade_id, 'dispute_opened', 'Dispute Opened', 'A dispute was raised for trade #' || substr(v_trade.trade_number, 1, 8) || '. Awaiting admin review.');
  INSERT INTO p2p_risk_events (user_id, trade_id, event_type, severity, details)
    VALUES (v_user_id, p_trade_id, 'dispute_opened', 'medium', jsonb_build_object('reason', p_reason));
  RETURN v_dispute_id;
END;
$$;

-- ─── p2p_release_escrow_secure: SECURITY DEFINER escrow release ─────────────
CREATE OR REPLACE FUNCTION p2p_release_escrow_secure(
  p_trade_id   uuid,
  p_step_token uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id  uuid := auth.uid();
  v_trade    p2p_trades%ROWTYPE;
  v_escrow_id uuid;
BEGIN
  SELECT * INTO v_trade FROM p2p_trades WHERE id = p_trade_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trade not found'; END IF;
  IF v_user_id IS DISTINCT FROM v_trade.seller_id THEN RAISE EXCEPTION 'Only the seller can release escrow'; END IF;
  IF v_trade.escrow_released THEN RETURN; END IF;
  IF v_trade.status NOT IN ('payment_marked','awaiting_release','disputed') THEN
    RAISE EXCEPTION 'Cannot release in trade status: %', v_trade.status;
  END IF;
  IF p_step_token IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM step_up_tokens
      WHERE id = p_step_token AND user_id = v_user_id
        AND action_type = 'p2p_escrow_release' AND used_at IS NULL AND expires_at > now()
    ) THEN RAISE EXCEPTION 'Invalid or expired step-up token'; END IF;
    UPDATE step_up_tokens SET used_at = now() WHERE id = p_step_token;
  END IF;
  -- Credit buyer wallet
  INSERT INTO wallets (user_id, asset, wallet_type, balance)
    VALUES (v_trade.buyer_id, v_trade.asset, 'spot', v_trade.crypto_amount)
    ON CONFLICT (user_id, asset, wallet_type) DO UPDATE
      SET balance = wallets.balance + v_trade.crypto_amount, updated_at = now();
  -- Debit seller locked_balance
  UPDATE wallets
    SET locked_balance = GREATEST(0, locked_balance - v_trade.crypto_amount), updated_at = now()
    WHERE user_id = v_trade.seller_id AND asset = v_trade.asset AND wallet_type IN ('spot','p2p');
  -- Ledger double-entry
  UPDATE ledger_accounts
    SET locked_balance = GREATEST(0, locked_balance - v_trade.crypto_amount), updated_at = now()
    WHERE user_id = v_trade.seller_id AND asset = v_trade.asset;
  INSERT INTO ledger_accounts (user_id, asset, available_balance)
    VALUES (v_trade.buyer_id, v_trade.asset, v_trade.crypto_amount)
    ON CONFLICT (user_id, asset) DO UPDATE
      SET available_balance = ledger_accounts.available_balance + v_trade.crypto_amount, updated_at = now();
  -- Release escrow record
  SELECT id INTO v_escrow_id FROM escrows WHERE p2p_trade_id = p_trade_id AND status = 'locked' LIMIT 1;
  IF v_escrow_id IS NOT NULL THEN
    UPDATE escrows SET status = 'released', released_at = now() WHERE id = v_escrow_id;
  END IF;
  -- Update trade atomically
  UPDATE p2p_trades
    SET status = 'released', escrow_released = true, released_at = now(), updated_at = now()
    WHERE id = p_trade_id;
  -- System message + notifications
  INSERT INTO p2p_trade_messages (trade_id, sender_id, message, is_system)
    VALUES (p_trade_id, NULL, 'Crypto released! ' || v_trade.crypto_amount || ' ' || v_trade.asset || ' sent to buyer.', true);
  INSERT INTO p2p_notifications (user_id, trade_id, type, title, body) VALUES
    (v_trade.buyer_id,  p_trade_id, 'crypto_released', 'Crypto Released! 🎉',
     v_trade.crypto_amount || ' ' || v_trade.asset || ' has been released to your wallet.'),
    (v_trade.seller_id, p_trade_id, 'crypto_released', 'Trade Completed',
     'Trade #' || substr(v_trade.trade_number, 1, 8) || ' completed. Funds released to buyer.');
  -- Update merchant stats
  UPDATE p2p_merchants
    SET completed_trades = completed_trades + 1, total_trades = total_trades + 1, updated_at = now()
    WHERE id = v_trade.merchant_id;
END;
$$;

-- ─── get_trade_payment_details: safe reveal of seller payment account ────────
CREATE FUNCTION get_trade_payment_details(p_trade_id uuid)
RETURNS TABLE (
  account_name   text,
  account_number text,
  bank_name      text,
  extra_info     text,
  payment_method text,
  fiat_code      text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_trade   p2p_trades%ROWTYPE;
BEGIN
  SELECT * INTO v_trade FROM p2p_trades WHERE id = p_trade_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trade not found'; END IF;
  IF v_user_id IS DISTINCT FROM v_trade.buyer_id AND v_user_id IS DISTINCT FROM v_trade.seller_id THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF v_trade.status NOT IN ('awaiting_payment','payment_marked','awaiting_release','disputed') THEN
    RAISE EXCEPTION 'Payment details not available for trade status: %', v_trade.status;
  END IF;
  RETURN QUERY
    SELECT upa.account_name, upa.account_number, upa.bank_name,
           upa.extra_info, upa.payment_method, upa.fiat_code
    FROM p2p_user_payment_accounts upa
    WHERE upa.user_id = v_trade.seller_id
      AND upa.payment_method = v_trade.payment_method
      AND upa.is_active = true
    ORDER BY upa.created_at DESC LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION p2p_open_dispute(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION p2p_release_escrow_secure(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_trade_payment_details(uuid) TO authenticated;
