import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env', quiet: true });
config({ path: '.env.local', override: true, quiet: true });

export function scriptDatabase() {
  const url = process.env.SUPABASE_URL?.trim();
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !secret)
    throw new Error('Set SUPABASE_URL and SUPABASE_SECRET_KEY in .env.');
  return createClient(url, secret, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(20000) }),
    },
  });
}
