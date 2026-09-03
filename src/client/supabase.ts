import { createClient } from '@supabase/supabase-js'
import 'expo-sqlite/localStorage/install';

function requirePublicEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required public environment variable: ${name}`);
  }
  return value;
}

export const SUPABASE_URL = requirePublicEnv(
  'EXPO_PUBLIC_SUPABASE_URL',
  process.env.EXPO_PUBLIC_SUPABASE_URL,
);
const supabaseAnonKey = requirePublicEnv(
  'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
);

export const supabase = createClient(SUPABASE_URL, supabaseAnonKey, {
  auth: {
    storage: localStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    // Disable navigator.locks — the expo-sqlite localStorage shim does not
    // implement a reliable Web Locks API, causing "lock was released because
    // another request stole it" errors in React Native. A single JS thread
    // accesses auth storage, so a pass-through lock is safe here.
    lock: async <R>(_name: string, _acquireTimeout: number, fn: () => Promise<R>): Promise<R> => fn(),
  },
})
