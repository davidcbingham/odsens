/**
 * tests/helpers/asRole.ts — docs/build/05-test-plan.md §1.3 `asRole` contract.
 *
 *   asRole('anon')    → anon key, no session
 *   asRole('service') → service-role key (bypasses RLS; arrange state / prove "service can")
 *   asRole('user' | 'banned' | 'mod' | 'admin') → anon key + JWT for the matching seed user (05 §1.4)
 *
 * S0: `anon` and `service` are real. The seeded roles need SEED-3 (`auth.users` + `profiles`), which
 * arrives in S1.1 — until then they throw so a test can never silently run as the wrong role.
 * Env comes from `.env.test` (loaded by tests/helpers/setup.db.ts): local stack only, no real key.
 * tests/** may import @supabase/supabase-js directly (the app-side fence, 01 INV-13, is for app code).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/types';

export type TestRole = 'anon' | 'user' | 'banned' | 'mod' | 'admin' | 'service';

export type TestClient = SupabaseClient<Database>;

const SEEDED_ROLES: ReadonlySet<TestRole> = new Set(['user', 'banned', 'mod', 'admin']);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(
      `asRole: ${name} is not set — is .env.test loaded (tests/helpers/setup.db.ts)?`,
    );
  }
  return value;
}

function assertLocalStack(url: string): void {
  const host = new URL(url).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(`asRole: refusing to run against non-local Supabase host "${host}" (05 H-9).`);
  }
}

function makeClient(key: string): TestClient {
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  assertLocalStack(url);
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Returns a typed Supabase client acting as `role` against the local stack (05 §1.3). */
export function asRole(role: TestRole): TestClient {
  switch (role) {
    case 'anon':
      return makeClient(requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'));
    case 'service':
      return makeClient(requireEnv('SUPABASE_SERVICE_ROLE_KEY'));
    default:
      if (SEEDED_ROLES.has(role)) {
        throw new Error('asRole: seed users arrive in S1.1 (SEED-3)');
      }
      throw new Error(`asRole: unknown role "${String(role)}"`);
  }
}
