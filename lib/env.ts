/**
 * lib/env.ts — the one server-side env reader (01 INV-35/INV-36/INV-37; 04 SC-16; ADR-0002 #18;
 * ADR-0010; ADR-0012).
 *
 * - Parsed with zod at module load; a missing/invalid boot-required name throws at import (fail fast).
 * - Boot-required = the 8 names in 00 S0.AC5 + `HASH_SECRET` from S1.1 (≥ 32 chars, ADR-0012) = 9.
 *   Everything else is optional-with-degradation: blank → `undefined`, never a crash.
 * - Not schema keys (01 §7 env matrix "CLI only" / P2 / platform): `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
 *   `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `CURSEFORGE_MEMBER`,
 *   `KOFI_WEBHOOK_VERIFICATION_TOKEN` (S2.1), `VERCEL_*` (read below for environment detection only).
 * - Browser-safe names live in `lib/env/public.ts` (`publicEnv`); client code never imports this file.
 *
 * Pre-fills applied by `parseEnv(source)` BEFORE validation (ADR-0010 / brief §7):
 *   1. Supabase↔Vercel integration key names: `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` fills a blank
 *      `NEXT_PUBLIC_SUPABASE_ANON_KEY`; `SUPABASE_SECRET_KEY` fills a blank `SUPABASE_SERVICE_ROLE_KEY`.
 *      The canonical (spec) name wins when both are set. The schema keys stay the canonical names.
 *   2. Preview site URL: when `VERCEL_ENV === 'preview'` and `VERCEL_BRANCH_URL` is set,
 *      `NEXT_PUBLIC_SITE_URL = 'https://' + VERCEL_BRANCH_URL` — derived, never hand-built, and it wins
 *      over any configured value on preview. Production and local use the configured value.
 *
 * `parseEnv(source)` is pure so T-UNIT-16 can exercise the schema without touching `process.env`.
 */
import 'server-only';
import { z } from 'zod';

/** Boot-required — an empty string counts as missing (see `parseEnv`). */
const required = z.string().min(1);

export const envSchema = z.object({
  // --- required at boot (9: ADR-0002 #18 + HASH_SECRET, ADR-0012) ---
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: required,
  SUPABASE_SERVICE_ROLE_KEY: required,
  NEXT_PUBLIC_SITE_URL: z.url(),
  CRON_SECRET: required,
  MODRINTH_USER: required,
  MODRINTH_USER_AGENT: required,
  YOUTUBE_CHANNEL_ID: required,
  HASH_SECRET: z.string().min(32), // keyed hashing (04 SC-17); ≥ 32 chars, server-only

  // --- optional, feature degrades (01 §7 env matrix) ---
  YOUTUBE_API_KEY: z.string().optional(), // from S1.6 — unset → RSS-only sync
  CURSEFORGE_API_KEY: z.string().optional(), // optional forever (04 §3.2 no-key path)
  KOFI_PAGE: z.string().optional(), // seeds site_settings.kofi_page only (S1.9)
  RESEND_API_KEY: z.string().optional(), // from S1.5 — unset → email rows failed/not_configured
  NOTIFY_FROM_EMAIL: z.string().default('allay@odsens.com'),
  DISCORD_WEBHOOK_URL: z.string().optional(), // seeds site_settings.discord_webhook_url only
  SENTRY_DSN: z.string().optional(), // S1.10
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(), // S1.10 (ADR-0002 #79)

  // --- test-only (never set in Vercel) ---
  E2E: z.string().optional(), // '1' enables /__test/throw (ADR-0002 #74)
  MODRINTH_API_BASE: z.string().optional(), // fixture server :4010 (ADR-0002 #73)
  CURSEFORGE_API_BASE: z.string().optional(),
  YOUTUBE_API_BASE: z.string().optional(),
  YOUTUBE_RSS_BASE: z.string().optional(),
  OEMBED_BASE: z.string().optional(),
  DISCORD_API_BASE: z.string().optional(),
  RESEND_API_BASE: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

/** Blank (empty / whitespace-only) → `undefined`, so "set to nothing" behaves like "unset". */
function clean(raw: string | undefined): string | undefined {
  return raw === undefined || raw.trim() === '' ? undefined : raw;
}

/**
 * Pure parser: applies the ADR-0010 pre-fills, treats blank values as unset for every key, then runs
 * the schema. Throws `Error('Missing required environment variables: A, B')` naming every missing or
 * invalid boot-required variable (schema key order); optional keys never throw.
 */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const input: Record<string, string | undefined> = {};
  for (const key of Object.keys(envSchema.shape)) {
    input[key] = clean(source[key]);
  }

  // ADR-0010 (1): integration key-name aliases — canonical wins when both are present.
  input.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= clean(source.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  input.SUPABASE_SERVICE_ROLE_KEY ??= clean(source.SUPABASE_SECRET_KEY);

  // ADR-0010 (2): preview deployments derive the site origin from the branch URL (no scheme there).
  if (source.VERCEL_ENV === 'preview') {
    const branchUrl = clean(source.VERCEL_BRANCH_URL);
    if (branchUrl !== undefined) input.NEXT_PUBLIC_SITE_URL = `https://${branchUrl}`;
  }

  const parsed = envSchema.safeParse(input);
  if (!parsed.success) {
    const bad = new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? '')));
    const names = Object.keys(envSchema.shape).filter((key) => bad.has(key));
    throw new Error(`Missing required environment variables: ${names.join(', ')}`);
  }
  return parsed.data;
}

/** Parsed once at import — the fail-fast point (00 S0.AC5). */
export const env: Env = parseEnv(process.env);

export type VercelEnv = 'production' | 'preview' | 'development';

/** Environment detection uses VERCEL_ENV, never hostname sniffing (01 INV-37). */
export const vercelEnv: VercelEnv = ((): VercelEnv => {
  const value = process.env.VERCEL_ENV;
  return value === 'production' || value === 'preview' ? value : 'development';
})();

/** True on any Vercel deployment (production or preview). */
export const isVercel: boolean = Boolean(process.env.VERCEL_ENV);

/** Node's NODE_ENV as reported to the server bundle ('development' | 'production' | 'test'). */
export const nodeEnv: string = process.env.NODE_ENV ?? 'development';

/** True under Vitest / NODE_ENV=test — the only place this is derived (lib/log.ts uses it). */
export const isTest: boolean = nodeEnv === 'test' || Boolean(process.env.VITEST);
