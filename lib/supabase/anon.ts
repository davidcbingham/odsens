/**
 * lib/supabase/anon.ts — the cookie-less anon client (01 INV-13 four-client model; INV-15).
 *
 * Anon key, no cookies, no session: RLS runs as `anon`. This is the client for ISR page reads via
 * `lib/data/**` — it never touches `cookies()`, so it never opts a page into dynamic rendering.
 * Module singleton: the client is stateless (no session persisted, no token refresh).
 */
import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import type { Database } from '@/lib/supabase/types';

let singleton: SupabaseClient<Database> | null = null;

export function createAnonClient(): SupabaseClient<Database> {
  singleton ??= createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return singleton;
}
