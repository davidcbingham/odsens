/**
 * lib/supabase/client.ts — the browser client (01 INV-13 four-client model; INV-09 / INV-85).
 *
 * Anon key + `@supabase/ssr` cookie storage, so the session it holds is the same one the server
 * reads. Used for `signInWithOAuth` (`GoogleSignInButton`), session presence (`ViewerProvider`) and
 * the client-seam reads under RLS (`CommentThread`) — those three files are the only importers.
 * Plain module (no client directive, no `server-only`) so it bundles into the islands that import it;
 * env comes from `@/lib/env/public` (browser-safe names only — 01 INV-29 / INV-87), never `@/lib/env`.
 * Module singleton so every island shares one auth state.
 */
import { createBrowserClient as createSsrBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { publicEnv } from '@/lib/env/public';
import type { Database } from '@/lib/supabase/types';

let singleton: SupabaseClient<Database> | null = null;

export function createBrowserClient(): SupabaseClient<Database> {
  singleton ??= createSsrBrowserClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  return singleton;
}
