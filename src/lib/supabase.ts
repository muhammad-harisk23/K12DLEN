import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// Module-load failure previously produced a permanently blank screen because
// nothing had mounted yet. Export a null client with a visible flag instead of
// throwing; main.tsx decides what to render.
export let supabaseInitError: string | null = null;

if (!supabaseUrl || !supabaseAnonKey) {
  supabaseInitError = 'Backend configuration is missing in this environment.';
}

function createSafeClient() {
  if (supabaseInitError) {
    return null;
  }
  try {
    return createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  } catch (err) {
    console.error('Supabase client failed to initialize', err);
    supabaseInitError = 'Backend client failed to initialize.';
    return null;
  }
}

export const supabase = createSafeClient()!;
