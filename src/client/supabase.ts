import { createClient } from '@supabase/supabase-js'
import 'expo-sqlite/localStorage/install';

export const SUPABASE_URL: string =
  process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://gehhhbuzjyxtwwljzfyx.supabase.co';
const supabaseAnonKey: string =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdlaGhoYnV6anl4dHd3bGp6Znl4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwNTQ4MTIsImV4cCI6MjA5NzYzMDgxMn0.aE3EXZuX8J2ivXSbskNOzXInYCDk92ep7EeTKWHYzDg';

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
