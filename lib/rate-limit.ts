/**
 * lib/rate-limit.ts — the one rate limiter (04 SC-08 / §5.5; 01 INV-69; ADR-0002 A4, #14).
 *
 * `assertRateLimit(scope, key)` calls the service-role RPC `rate_limit_ok(p_scope, p_key, p_max,
 * p_window)`, which records ONE `rate_limit_hits` row per call (also on a rejected call) and then
 * counts rows for (scope, key) inside the window — atomically, in SQL. No in-memory state, no KV.
 * Over the limit → `RateLimitError` (`code: 'rate_limited'`, copy "Slow down a little.") which
 * `runAction` maps to `{ok:false, error:{code:'rate_limited'}}` / HTTP 429 in route handlers.
 *
 * Call it BEFORE the write it protects. An RPC failure throws (fail closed → `internal`), it never
 * silently allows the write.
 *
 * `SCOPES` is 04 §5.5 verbatim (18 rows — 05 T-UNIT-37). The `updateProfile` handle rule
 * (1 / 7 days from `profiles.handle_changed_at`) and the `triggerSync` lock are not scopes here.
 */
import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

export const SCOPES = {
  comment: { max: 5, window: '1 minute' },
  comment_day: { max: 50, window: '24 hours' },
  comment_edit: { max: 20, window: '1 minute' },
  comment_delete: { max: 20, window: '1 minute' },
  report: { max: 10, window: '1 hour' },
  like: { max: 60, window: '1 minute' },
  download: { max: 30, window: '1 minute' },
  onboarding: { max: 10, window: '10 minutes' },
  check_handle: { max: 60, window: '1 minute' },
  avatar: { max: 10, window: '10 minutes' },
  delete_account: { max: 1, window: '1 day' },
  'upload:project-media': { max: 60, window: '1 hour' },
  'upload:art': { max: 60, window: '1 hour' },
  'upload:project-files': { max: 30, window: '1 hour' },
  'upload:skins': { max: 60, window: '1 hour' },
  project_link: { max: 30, window: '1 hour' },
  mention_preview: { max: 30, window: '1 minute' },
  discord_test: { max: 10, window: '1 minute' },
} as const;

export type Scope = keyof typeof SCOPES;

export const RATE_LIMITED_MESSAGE = 'Slow down a little.';

/** Thrown when `rate_limit_ok` returns false; `runAction` maps `code` onto the action result. */
export class RateLimitError extends Error {
  readonly code = 'rate_limited' as const;

  constructor() {
    super(RATE_LIMITED_MESSAGE);
    this.name = 'RateLimitError';
  }
}

/**
 * Records a hit and enforces `max` calls per `window` (a Postgres interval literal such as
 * `'10 minutes'`) for `(scope, key)`. Defaults come from `SCOPES`; an unknown scope throws.
 */
export async function assertRateLimit(
  scope: Scope,
  key: string,
  max?: number,
  window?: string,
): Promise<void> {
  const rule = (SCOPES as Record<string, { max: number; window: string } | undefined>)[scope];
  if (!rule) throw new Error(`assertRateLimit: unknown scope "${String(scope)}"`);
  if (key === '') throw new Error('assertRateLimit: empty key');

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('rate_limit_ok', {
    p_scope: scope,
    p_key: key,
    p_max: max ?? rule.max,
    p_window: window ?? rule.window,
  });
  if (error) throw new Error(`rate_limit_ok failed: ${error.code}`);
  if (data !== true) throw new RateLimitError();
}
