-- ─── p2p_refund_escrow: admin refund (cancel trade, return crypto to seller) ───
CREATE OR REPLACE FUNCTION p2p_refund_escrow(p_trade_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_trade        p2p_trades%ROWTYPE;
  v_seller_id    UUID;
BEGIN
  SELECT * INTO v_trade FROM p2p_trades WHERE id = p_trade_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trade not found'; END IF;
  IF v_trade.status NOT IN ('disputed', 'payment_marked', 'awaiting_payment') THEN
    RAISE EXCEPTION 'Trade cannot be refunded in status %', v_trade.status;
  END IF;
  IF v_trade.escrow_amount IS NULL OR v_trade.escrow_amount <= 0 THEN
    RAISE EXCEPTION 'No escrowed amount to refund';
  END IF;

  -- Determine seller (ad owner)
  SELECT user_id INTO v_seller_id FROM p2p_ads WHERE id = v_trade.ad_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ad not found'; END IF;

  -- Return escrowed crypto to seller available balance via ledger
  INSERT INTO ledger_entries (user_id, currency, amount, entry_type, reference_id, reference_type, notes)
  VALUES (v_seller_id, v_trade.asset, v_trade.escrow_amount, 'credit', p_trade_id, 'p2p_refund', 'Admin refund of escrowed P2P crypto');

  -- Update wallet: subtract from escrow, add to available
  UPDATE wallets
  SET escrow_balance = GREATEST(0, escrow_balance - v_trade.escrow_amount),
      available_balance = available_balance + v_trade.escrow_amount,
      updated_at = NOW()
  WHERE user_id = v_seller_id AND currency = v_trade.asset;

  -- Mark trade refunded
  UPDATE p2p_trades
  SET status = 'refunded', completed_at = NOW(), updated_at = NOW(),
      notes = COALESCE(notes, '') || ' | Admin refunded escrow'
  WHERE id = p_trade_id;

  -- Log risk event
  INSERT INTO p2p_risk_events (trade_id, user_id, event_type, details, severity)
  VALUES (p_trade_id, v_seller_id, 'admin_refund', 'Admin manually refunded escrow for trade ' || p_trade_id, 'medium');
END;
$$;

-- ─── p2p_increment_merchant_stats: update merchant stats after trade completes ───
CREATE OR REPLACE FUNCTION p2p_increment_merchant_stats(
  p_merchant_id   UUID,
  p_status        TEXT,   -- 'completed' | 'disputed' | 'cancelled'
  p_is_positive   BOOLEAN DEFAULT NULL  -- for reviews: true = positive, false = negative
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE p2p_merchants
  SET
    total_trades      = total_trades + 1,
    completed_trades  = completed_trades + CASE WHEN p_status = 'completed' THEN 1 ELSE 0 END,
    disputed_trades   = disputed_trades  + CASE WHEN p_status = 'disputed'  THEN 1 ELSE 0 END,
    cancelled_trades  = cancelled_trades + CASE WHEN p_status = 'cancelled' THEN 1 ELSE 0 END,
    positive_ratings  = positive_ratings + CASE WHEN p_is_positive IS TRUE   THEN 1 ELSE 0 END,
    negative_ratings  = negative_ratings + CASE WHEN p_is_positive IS FALSE  THEN 1 ELSE 0 END,
    completion_rate   = CASE
      WHEN (total_trades + 1) > 0
      THEN ROUND(
        (completed_trades + CASE WHEN p_status = 'completed' THEN 1 ELSE 0 END)::numeric
        / (total_trades + 1)::numeric * 100, 1)
      ELSE 0 END,
    updated_at = NOW()
  WHERE id = p_merchant_id;
END;
$$;

-- ─── p2p_get_merchant_by_user: convenience lookup ───────────────────────────
CREATE OR REPLACE FUNCTION p2p_get_merchant_by_user(p_user_id UUID)
RETURNS p2p_merchants
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT * FROM p2p_merchants WHERE user_id = p_user_id LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION p2p_refund_escrow(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION p2p_increment_merchant_stats(UUID, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION p2p_get_merchant_by_user(UUID) TO authenticated;