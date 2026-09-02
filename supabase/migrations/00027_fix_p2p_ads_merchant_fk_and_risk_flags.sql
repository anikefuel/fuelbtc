
-- Fix 1: p2p_ads.merchant_id should reference p2p_merchants.id (not profiles.id)
-- so that Supabase can resolve the p2p_ads <-> p2p_merchants join relationship
ALTER TABLE public.p2p_ads DROP CONSTRAINT IF EXISTS p2p_ads_merchant_id_fkey;
ALTER TABLE public.p2p_ads
  ADD CONSTRAINT p2p_ads_merchant_id_fkey
  FOREIGN KEY (merchant_id) REFERENCES public.p2p_merchants(id) ON DELETE CASCADE;

-- Fix 2: add is_resolved as a generated alias column so both column names work
-- (code uses is_resolved; original column is resolved)
ALTER TABLE public.risk_flags
  ADD COLUMN IF NOT EXISTS is_resolved boolean GENERATED ALWAYS AS (resolved) STORED;
