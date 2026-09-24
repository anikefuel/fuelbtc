
-- Drop existing conflicting functions first, then recreate with correct signatures
DROP FUNCTION IF EXISTS get_trade_payment_details(uuid);
DROP FUNCTION IF EXISTS p2p_release_escrow_secure(uuid, uuid);
DROP FUNCTION IF EXISTS p2p_open_dispute(uuid, text, text);
