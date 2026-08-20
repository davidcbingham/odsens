/**
 * lib/supabase/server.ts — the cookie-bound server client (01 INV-13 four-client model; INV-30).
 *
 * Anon key + the request's auth cookies via `@supabase/ssr`, so RLS runs as the signed-in user.
 * Calling `cookies()` opts the route into dynamic rendering — use it only from dynamic routes,
 * route handlers and user-scoped Server Actions (01 INV-15: ISR reads use `createAnonClient()`).
 * Only `lib/auth.ts` and `middleware.ts` resolve the signed-in user (Supabase `getUser`) on the
 * client this returns (01 INV-32).
 */
import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient as createSsrServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import type { Database } from '@/lib/supabase/types';

export async function createServerClient(): Promise<SupabaseClient<Database>> {
  const cookieStore = await cookies();
  return createSsrServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(list) {
          try {
            for (const { name, value, options } of list) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Component render: the cookie store is read-only here. The session refresh
            // that writes cookies is middleware's job (02 §3 M2, S1.1), so this is safe to ignore.
          }
        },
      },
    },
  );
}
