-- Drop the old status check constraint and add 'rejected' + 'pending' to allowed values
ALTER TABLE public.kyc_attempts
  DROP CONSTRAINT IF EXISTS kyc_attempts_status_check;

ALTER TABLE public.kyc_attempts
  ADD CONSTRAINT kyc_attempts_status_check
  CHECK (status = ANY (ARRAY[
    'not_started'::text,
    'in_progress'::text,
    'submitted'::text,
    'pending'::text,
    'pending_review'::text,
    'manual_review'::text,
    'resubmission_required'::text,
    'verified'::text,
    'rejected'::text,
    'failed'::text,
    'abandoned'::text,
    'provider_unavailable'::text
  ]));

-- Update kyc_providers Prembly config with production keys
UPDATE public.kyc_providers
SET config = jsonb_build_object(
  'config_id',       '2c2e39dd-ecdc-4ba0-a728-5b097afee19f',
  'widget_key',      'wdgt_0ac12959c04d45efbc927189b0d694ac',
  'environment',     'production',
  'base_widget_url', 'https://widget.prembly.com',
  'integration_mode','widget'
),
updated_at = now()
WHERE provider_name = 'prembly';