/**
 * lib/supabase/admin.ts — the service-role client (01 INV-13 four-client model; INV-14).
 *
 * Bypasses RLS. Import ONLY from `lib/actions/**`, `lib/jobs/**`, `lib/notify/**`, `lib/files.ts`,
 * `lib/rate-limit.ts` and `app/api/**` (01 INV-14 / INV-84, enforced by ESLint `no-restricted-imports`).
 * NEVER from `components/**`, pages, layouts, `lib/data/**` or `middleware.ts` — the service role must
 * not reach a page render path or the client bundle. `SUPABASE_SERVICE_ROLE_KEY` is read here only.
 * Module singleton: stateless (no session persisted, no token refresh).
 */
import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import type { Database } from '@/lib/supabase/types';

let singleton: SupabaseClient<Database> | null = null;

export function createAdminClient(): SupabaseClient<Database> {
  singleton ??= createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return singleton;
}
