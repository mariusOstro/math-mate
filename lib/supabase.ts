import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { supabaseSettings } from './server-config';

export function createServerDatabase() {
  const { url, secret } = supabaseSettings();
  return createClient(url, secret, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          cache: 'no-store',
          signal: init?.signal ?? AbortSignal.timeout(15000),
        }),
    },
  });
}
