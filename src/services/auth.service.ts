// Auth service — profile CRUD, security log writes, session management
// All write operations use the authenticated user's session (anon key + JWT).
// Sensitive mutations go through Edge Functions to avoid service-role exposure.
import { supabase } from '@/client/supabase';

/** Validate that a string is a well-formed UUID (auth.users.id format). */
function assertUUID(value: string | undefined | null, label = 'user_id'): string {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!value || !UUID_RE.test(value)) {
    throw new Error(
      `Your account identifier is invalid. Please sign out and sign in again. (${label}: ${String(value)?.slice(0, 12)})`
    );
  }
  return value;
}

export type UserProfile = {
  id: string;
  email: string;
  username: string | null;
  full_name: string | null;
  phone: string | null;
  phone_country_code: string | null;
  country: string | null;
  nationality: string | null;
  state_province: string | null;
  city: string | null;
  street_address: string | null;
  apt_suite: string | null;
  postal_code: string | null;
  date_of_birth: string | null;
  preferred_currency: string;
  avatar_url: string | null;
  uid: string;
  role: 'user' | 'admin';
  vip_level: number;
  referral_code: string;
  kyc_tier: string;
  kyc_status: string;
  is_frozen: boolean;
  is_suspended: boolean;
  two_fa_enabled: boolean;
  totp_factor_id: string | null;
  email_verified: boolean;
  verification_sent_at: string | null;
  anti_phishing_code: string | null;
  last_login_at: string | null;
  created_at: string;
};

export type SecurityPreferences = {
  id: string;
  user_id: string;
  totp_enabled: boolean;
  passkey_enabled: boolean;
  email_otp_enabled: boolean;
  backup_codes_enabled: boolean;
  pref_login: string;
  pref_withdrawal: string;
  pref_p2p_release: string;
  pref_security_change: string;
  pref_new_address: string;
  pref_password_change: string;
  pref_api_key: string;
  pref_large_transfer: string;
  created_at: string;
  updated_at: string;
};

export type SecurityLog = {
  id: string;
  user_id: string;
  event_type: string;
  ip_address: string | null;
  device_info: string | null;
  location: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type UserSession = {
  id: string;
  user_id: string;
  device_name: string | null;
  os: string | null;
  browser: string | null;
  ip_address: string | null;
  country_code: string | null;
  city: string | null;
  is_current: boolean;
  last_active_at: string;
  created_at: string;
  revoked_at: string | null;
};

export type Passkey = {
  id: string;
  user_id: string;
  credential_id: string;
  device_label: string;
  platform_type: string;
  transports: string[] | null;
  last_used_at: string | null;
  created_at: string;
};

// ── Profile ──────────────────────────────────────────────────────────────

export async function getProfile(): Promise<UserProfile | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as UserProfile | null;
}

export async function updateProfile(
  updates: Partial<Pick<UserProfile,
    | 'full_name' | 'username' | 'phone' | 'country' | 'preferred_currency'
    | 'avatar_url' | 'anti_phishing_code'
    | 'phone_country_code' | 'nationality' | 'state_province' | 'city'
    | 'street_address' | 'apt_suite' | 'postal_code' | 'date_of_birth'
  >>
): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const { data, error } = await supabase.functions.invoke('auth-update-profile', {
    body: updates,
  });
  if (error) {
    const msg = await error?.context?.text?.();
    throw new Error(msg || error.message);
  }
  if (data?.error) throw new Error(data.error);
}

// Sync email_verified status from auth user to profile
export async function syncEmailVerified(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const verified = !!user.email_confirmed_at;
  await supabase.from('profiles').update({ email_verified: verified, updated_at: new Date().toISOString() }).eq('id', user.id);
}

// Record last login timestamp
export async function recordLogin(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from('profiles').update({ last_login_at: new Date().toISOString() }).eq('id', user.id);
}

// ── Security Logs ──────────────────────────────────────────────────────

export async function getSecurityLogs(limit = 50): Promise<SecurityLog[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('security_logs')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data as SecurityLog[] : [];
}

export async function writeSecurityLog(
  eventType: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase.from('security_logs').insert({
    user_id:    user.id,
    event_type: eventType,
    metadata,
  });
  if (error) console.error('[SecurityLog]', error.message);
}

// ── Sessions ──────────────────────────────────────────────────────────

export async function getActiveSessions(): Promise<UserSession[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('user_sessions')
    .select('*')
    .eq('user_id', user.id)
    .is('revoked_at', null)
    .order('last_active_at', { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data as UserSession[] : [];
}

export async function revokeSession(sessionId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase
    .from('user_sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', sessionId)
    .eq('user_id', user.id);
  if (error) throw new Error(error.message);
  await writeSecurityLog('session_revoked', { session_id: sessionId });
}

export async function signOutAllOtherSessions(): Promise<void> {
  const { error } = await supabase.auth.signOut({ scope: 'others' });
  if (error) throw new Error(error.message);
  await writeSecurityLog('all_other_sessions_revoked', {});
}

// ── Password Change ──────────────────────────────────────────────────

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const { data, error } = await supabase.functions.invoke('auth-change-password', {
    body: { current_password: currentPassword, new_password: newPassword },
  });
  if (error) {
    const msg = await error?.context?.text?.();
    throw new Error(msg || error.message);
  }
  if (data?.error) throw new Error(data.error);
}

// ── Resend Verification Email ────────────────────────────────────────

export async function resendVerificationEmail(): Promise<{ cooldown_remaining?: number }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const { data, error } = await supabase.functions.invoke('auth-resend-verification', { body: {} });
  if (error) {
    const msg = await error?.context?.text?.();
    // Parse cooldown from message
    const parsed = msg ? JSON.parse(msg).catch?.(() => null) : null;
    throw new Error(parsed?.error || msg || error.message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

// ── TOTP / MFA ───────────────────────────────────────────────────────

// Returns the first verified TOTP factor, or null
export async function getVerifiedTOTPFactor(): Promise<{ id: string; friendly_name: string } | null> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error || !data) return null;
  const verified = data.totp?.find((f: { status: string }) => f.status === 'verified');
  return verified ? { id: verified.id, friendly_name: (verified as { friendly_name?: string }).friendly_name ?? '' } : null;
}

// Unenroll ALL existing TOTP factors (verified + unverified) so a clean re-enroll can proceed
async function unenrollAllTOTPFactors(): Promise<void> {
  const { data } = await supabase.auth.mfa.listFactors();
  const all = data?.totp ?? [];
  for (const f of all) {
    await supabase.auth.mfa.unenroll({ factorId: f.id }).catch(() => {});
  }
}

export async function enrollTOTP(): Promise<{ qr_code: string; secret: string; factor_id: string }> {
  // Only unenroll UNVERIFIED factors — do NOT remove a currently-active verified factor
  const { data: existing } = await supabase.auth.mfa.listFactors();
  const unverified = (existing?.totp ?? []).filter((f: { status: string }) => f.status !== 'verified');
  for (const f of unverified) {
    await supabase.auth.mfa.unenroll({ factorId: f.id }).catch(() => {});
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', issuer: 'ExchangeX' });
  if (error) {
    if (error.message.toLowerCase().includes('already exists')) {
      throw new Error('An authenticator is already enrolled. Please disable it first before re-enrolling.');
    }
    throw new Error(error.message);
  }
  const totp = data.totp;
  return { qr_code: totp.qr_code, secret: totp.secret, factor_id: data.id };
}

export async function verifyAndEnableTOTP(factorId: string, code: string): Promise<void> {
  // Create challenge
  const { data: challengeData, error: challengeErr } = await supabase.auth.mfa.challenge({ factorId });
  if (challengeErr) {
    const msg = challengeErr.message.toLowerCase();
    if (msg.includes('expired') || msg.includes('session')) throw new Error('Setup session expired. Please sign in again.');
    throw new Error(challengeErr.message);
  }

  // Verify code
  const { error: verifyErr } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challengeData.id,
    code: code.replace(/\s/g, ''),
  });
  if (verifyErr) {
    const msg = verifyErr.message.toLowerCase();
    if (msg.includes('expired')) throw new Error('Code expired. Please enter the new 6-digit code shown in your authenticator app.');
    if (msg.includes('invalid') || msg.includes('does not match') || msg.includes('incorrect')) {
      throw new Error('Incorrect code. Check your authenticator app and try again. Make sure your device clock is accurate.');
    }
    if (msg.includes('time') || msg.includes('sync') || msg.includes('clock')) {
      throw new Error('Authenticator time is out of sync. Please check your device clock settings.');
    }
    throw new Error('Verification failed. Please try again.');
  }

  // CRITICAL: refresh session to obtain the new AAL2 JWT after successful TOTP verify
  // Without this, subsequent DB writes using auth.uid() can fail RLS checks
  await supabase.auth.refreshSession();

  // Confirm the factor is now verified
  const verified = await getVerifiedTOTPFactor();
  if (!verified) throw new Error('TOTP enrollment could not be confirmed. Please try again.');

  // Sync verified state to profiles
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    assertUUID(user.id);
    await supabase.from('profiles').update({ two_fa_enabled: true, totp_factor_id: factorId }).eq('id', user.id);
  }
  await writeSecurityLog('totp_enrolled', { factor_id: factorId });
}

export async function unenrollTOTP(factorId: string): Promise<void> {
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) throw new Error(error.message);
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    await supabase.from('profiles').update({ two_fa_enabled: false, totp_factor_id: null }).eq('id', user.id);
  }
  await writeSecurityLog('totp_disabled', {});
}

export async function listMFAFactors() {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw new Error(error.message);
  return data;
}

// ── Record / upsert current browser/device session into user_sessions ────────
// Called on login and on sessions screen focus so the table always has data.
export async function recordCurrentSession(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  try {
    const isWeb = process.env.EXPO_OS === 'web';
    const ua = isWeb && typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const isMobile = /Mobi|Android/i.test(ua);
    const browser = isWeb ? (
      /Chrome/i.test(ua) ? 'Chrome' :
      /Safari/i.test(ua) && !/Chrome/i.test(ua) ? 'Safari' :
      /Firefox/i.test(ua) ? 'Firefox' : 'Browser'
    ) : null;
    const os = isWeb ? (
      /Windows/i.test(ua) ? 'Windows' :
      /Mac OS/i.test(ua) ? 'macOS' :
      /Android/i.test(ua) ? 'Android' :
      /iPhone|iPad/i.test(ua) ? 'iOS' : 'Unknown OS'
    ) : 'Mobile';

    // Fetch real IP and location from ipapi.co (free, no API key)
    let ipAddress: string | null = null;
    let cityName: string | null = null;
    let countryCode: string | null = null;
    try {
      const geoResp = await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(4000) });
      if (geoResp.ok) {
        const geo = await geoResp.json() as { ip?: string; city?: string; country_code?: string };
        ipAddress   = geo.ip         ?? null;
        cityName    = geo.city        ?? null;
        countryCode = geo.country_code ?? null;
      }
    } catch {
      // geo lookup is best-effort; proceed without it
    }

    // Use a deterministic ID: user_id + browser-fingerprint so re-visits update vs insert
    const sessionKey = `${user.id}-${browser ?? 'native'}-${os}`;
    const keyHash = Array.from(new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sessionKey))
    )).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
    const fakeUUID = `${keyHash.slice(0,8)}-${keyHash.slice(8,12)}-4${keyHash.slice(13,16)}-${keyHash.slice(16,20)}-${keyHash.slice(20,32)}`;

    await supabase.from('user_sessions').upsert({
      id:             fakeUUID,
      user_id:        user.id,
      device_name:    isMobile ? 'Mobile Device' : 'Desktop',
      os,
      browser,
      ip_address:     ipAddress,
      city:           cityName,
      country_code:   countryCode,
      is_current:     true,
      last_active_at: new Date().toISOString(),
    }, { onConflict: 'id', ignoreDuplicates: false });
  } catch (e) {
    console.warn('[recordCurrentSession]', e);
  }
}

// ── Withdrawal Whitelist ─────────────────────────────────────────────

export type WhitelistAddress = {
  id: string;
  label: string;
  network: string;
  address: string;
  is_verified: boolean;
  whitelisted_at: string;
  created_at: string;
};

export async function getWhitelistAddresses(): Promise<WhitelistAddress[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('withdrawal_whitelist')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data as WhitelistAddress[] : [];
}

export async function addWhitelistAddress(
  label: string, network: string, address: string
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const { error } = await supabase.from('withdrawal_whitelist').insert({
    user_id: user.id,
    label: label.trim(),
    network: network.trim(),
    address: address.trim(),
  });
  if (error) {
    if (error.code === '23505') throw new Error('This address is already in your whitelist.');
    throw new Error(error.message);
  }
  await writeSecurityLog('whitelist_address_added', { network, label });
}

export async function removeWhitelistAddress(id: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const { error } = await supabase.from('withdrawal_whitelist').delete().eq('id', id).eq('user_id', user.id);
  if (error) throw new Error(error.message);
  await writeSecurityLog('whitelist_address_removed', { whitelist_id: id });
}

// ── Backup Codes ─────────────────────────────────────────────────────

// Generate 10 backup codes, hash them, store hashes; return plaintext (shown once)
export async function generateBackupCodes(): Promise<string[]> {
  // Force session refresh so the latest AAL2 JWT is used for RLS checks.
  // After TOTP verify the client may hold a stale pre-AAL2 token; without
  // refreshing, auth.uid() on the DB side can be null → RLS INSERT rejection.
  await supabase.auth.refreshSession();

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) throw new Error('Not authenticated — please sign in again.');
  const userId = assertUUID(user.id);

  const codes: string[] = [];
  const rows: { user_id: string; code_hash: string }[] = [];

  for (let i = 0; i < 10; i++) {
    const arr = new Uint8Array(10); // 80 bits of entropy → 20 hex chars
    crypto.getRandomValues(arr);
    const raw = Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    const formatted = `${raw.slice(0, 5)}-${raw.slice(5, 10)}-${raw.slice(10, 15)}-${raw.slice(15)}`;
    codes.push(formatted);
    const normalised = raw; // store without dashes
    const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalised));
    const hashHex = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
    rows.push({ user_id: userId, code_hash: hashHex });
  }

  // Delete old codes first, then insert new batch
  const { error: delErr } = await supabase.from('backup_codes').delete().eq('user_id', userId);
  if (delErr) throw new Error(`We could not clear old recovery codes. Please try again. (${delErr.message})`);

  const { error: insErr } = await supabase.from('backup_codes').insert(rows);
  if (insErr) throw new Error(`We could not save your recovery codes. Please retry. (${insErr.message})`);

  await writeSecurityLog('backup_codes_regenerated', { count: 10 });
  return codes;
}

export async function getBackupCodeCount(): Promise<number> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 0;
  const { count } = await supabase
    .from('backup_codes')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .is('used_at', null);
  return count ?? 0;
}

// ── Passkeys ─────────────────────────────────────────────────────────

export async function getPasskeys(): Promise<Passkey[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('passkeys')
    .select('id, user_id, credential_id, device_label, platform_type, transports, last_used_at, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data as Passkey[] : [];
}

export async function registerNativePasskey(deviceLabel: string): Promise<void> {
  // Refresh session so the JWT is current before any DB write
  await supabase.auth.refreshSession();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) throw new Error('Not authenticated — please sign in again.');
  const userId = assertUUID(user.id);

  // Generate a cryptographically random credential ID (hex, 32 bytes)
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  const credentialId = Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');

  const { error } = await supabase.from('passkeys').insert({
    user_id:       userId,
    credential_id: credentialId,
    device_label:  deviceLabel,
    platform_type: 'biometric_native',
  });
  if (error) {
    if (error.message.includes('duplicate') || error.code === '23505') {
      throw new Error('This device is already registered.');
    }
    throw new Error(`We could not register this device. Please try again. (${error.message})`);
  }
  await writeSecurityLog('passkey_enrolled', { device_label: deviceLabel, platform_type: 'biometric_native' });
}

export async function registerWebAuthnPasskey(deviceLabel: string, credentialId: string): Promise<void> {
  // Refresh session so the JWT is current before any DB write
  await supabase.auth.refreshSession();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) throw new Error('Not authenticated — please sign in again.');
  const userId = assertUUID(user.id);

  const { error } = await supabase.from('passkeys').insert({
    user_id:       userId,
    credential_id: credentialId,
    device_label:  deviceLabel,
    platform_type: 'webauthn',
  });
  if (error) {
    if (error.message.includes('duplicate') || error.code === '23505') {
      throw new Error('This credential is already registered. Each passkey can only be registered once.');
    }
    throw new Error(`We could not save the passkey record. Please retry. (${error.message})`);
  }
  await writeSecurityLog('passkey_enrolled', { device_label: deviceLabel, platform_type: 'webauthn' });
}

export async function removePasskey(passkeyId: string): Promise<void> {
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) throw new Error('Not authenticated');
  const userId = assertUUID(user.id);
  const { error } = await supabase.from('passkeys').delete().eq('id', passkeyId).eq('user_id', userId);
  if (error) throw new Error(error.message);
  await writeSecurityLog('passkey_removed', { passkey_id: passkeyId });
}

// ── Step-up Token ─────────────────────────────────────────────────────

export async function issueStepUpToken(params: {
  action_type: string;
  verification:
    | { method: 'totp'; code: string }
    | { method: 'backup_code'; code: string }
    | { method: 'passkey'; credential_id: string };
  txn_id?: string;
  amount?: number;
  asset?: string;
  destination?: string;
  network?: string;
}): Promise<{ token_id: string; expires_at: string; verified_by: string }> {
  const { data, error } = await supabase.functions.invoke('step-up-issue', { body: params });
  if (error) {
    const msg = await error?.context?.text?.();
    throw new Error(msg || error.message);
  }
  if (data?.error) throw new Error(data.error);
  return data as { token_id: string; expires_at: string; verified_by: string };
}

// ── Security Preferences ───────────────────────────────────────────────────

export async function getSecurityPreferences(): Promise<SecurityPreferences | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from('user_security_preferences')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();
  return data as SecurityPreferences | null;
}

export async function upsertSecurityPreferences(prefs: Partial<Omit<SecurityPreferences, 'id' | 'user_id' | 'created_at' | 'updated_at'>>): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // Enforce: at least one strong factor must remain enabled
  const current = await getSecurityPreferences();
  const merged = { ...current, ...prefs };
  const hasStrong = merged.totp_enabled || merged.passkey_enabled;
  if (!hasStrong && (prefs.totp_enabled === false || prefs.passkey_enabled === false)) {
    throw new Error('At least one strong verification method (Authenticator or Passkey) must remain enabled.');
  }

  const { error } = await supabase
    .from('user_security_preferences')
    .upsert({ ...prefs, user_id: user.id, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw new Error(error.message);
}

export async function syncSecurityPreferences(): Promise<SecurityPreferences> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // Derive real method availability from live MFA data + passkeys table
  const [mfaData, passkeyCount, backupCount] = await Promise.all([
    supabase.auth.mfa.listFactors(),
    supabase.from('passkeys').select('*', { count: 'exact', head: true }).eq('user_id', user.id),
    supabase.from('backup_codes').select('*', { count: 'exact', head: true }).eq('user_id', user.id).is('used_at', null),
  ]);

  const totpVerified = (mfaData.data?.totp ?? []).some((f: { status: string }) => f.status === 'verified');
  const hasPasskey   = (passkeyCount.count ?? 0) > 0;
  const hasBackup    = (backupCount.count ?? 0) > 0;

  const updates = {
    totp_enabled:         totpVerified,
    passkey_enabled:      hasPasskey,
    backup_codes_enabled: hasBackup,
    email_otp_enabled:    true, // always available via account email
  };

  const { error } = await supabase
    .from('user_security_preferences')
    .upsert({ ...updates, user_id: user.id, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw new Error(error.message);

  return (await getSecurityPreferences()) as SecurityPreferences;
}

// ── Email OTP ─────────────────────────────────────────────────────────────

export async function sendEmailOTP(purpose: string, metadata?: Record<string, unknown>): Promise<{ challenge_id: string; expires_at: string }> {
  const { data, error } = await supabase.functions.invoke('auth-send-email-otp', {
    body: { purpose, metadata: metadata ?? {} },
  });
  if (error) {
    const msg = await error?.context?.text?.();
    throw new Error(msg || error.message);
  }
  if (data?.error) throw new Error(data.error);
  return data as { challenge_id: string; expires_at: string };
}

export async function verifyEmailOTP(params: {
  challenge_id: string;
  code: string;
  purpose: string;
  action_type?: string;
  txn_id?: string;
  amount?: number;
  asset?: string;
  destination?: string;
}): Promise<{ token_id: string; expires_at: string }> {
  const { data, error } = await supabase.functions.invoke('auth-verify-email-otp', { body: params });
  if (error) {
    const msg = await error?.context?.text?.();
    throw new Error(msg || error.message);
  }
  if (data?.error) throw new Error(data.error);
  return data as { token_id: string; expires_at: string };
}
