/**
 * lib/env/public.ts — the browser-safe env subset (01 INV-35/INV-29; 04 SC-16; ADR-0010).
 * Only NEXT_PUBLIC_* names live here; client components import `publicEnv` from this file, never `@/lib/env`.
 * Next.js inlines these at build time, so they must be referenced as literal `process.env.NEXT_PUBLIC_*`
 * (no dynamic access, no loops). Validated by hand (not zod) on purpose: this module is in every client
 * bundle and zod stays server-side (`lib/env.ts`) — ADR-0008.
 *
 * Mirrors the two `lib/env.ts` pre-fills (ADR-0010 / brief §7), with the client-exposed names:
 *   1. `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (Supabase↔Vercel integration) fills a blank
 *      `NEXT_PUBLIC_SUPABASE_ANON_KEY`; the canonical name wins when both are set.
 *   2. On preview (`NEXT_PUBLIC_VERCEL_ENV === 'preview'`) with `NEXT_PUBLIC_VERCEL_BRANCH_URL` set,
 *      `NEXT_PUBLIC_SITE_URL = 'https://' + branchUrl` — this derived value wins over the configured one.
 */

export type PublicEnv = {
  NEXT_PUBLIC_SUPABASE_URL: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY: string;
  NEXT_PUBLIC_SITE_URL: string;
  NEXT_PUBLIC_SENTRY_DSN?: string; // S1.10 (ADR-0002 #79)
};

function isUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function present(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** Parsed once at module load; throws with the missing/invalid names if a required public var is absent. */
export const publicEnv: PublicEnv = (() => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const canonicalAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const anon = present(canonicalAnon) ? canonicalAnon : publishable;

  const configuredSite = process.env.NEXT_PUBLIC_SITE_URL;
  const previewBranch =
    process.env.NEXT_PUBLIC_VERCEL_ENV === 'preview'
      ? process.env.NEXT_PUBLIC_VERCEL_BRANCH_URL
      : undefined;
  const site = present(previewBranch) ? `https://${previewBranch}` : configuredSite;

  const sentry = process.env.NEXT_PUBLIC_SENTRY_DSN;

  const missing: string[] = [];
  if (!isUrl(url)) missing.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!present(anon)) missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  if (!isUrl(site)) missing.push('NEXT_PUBLIC_SITE_URL');
  if (missing.length > 0 || !isUrl(url) || !present(anon) || !isUrl(site)) {
    throw new Error(`Missing or invalid public environment variables: ${missing.join(', ')}`);
  }
  return {
    NEXT_PUBLIC_SUPABASE_URL: url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
    NEXT_PUBLIC_SITE_URL: site,
    ...(present(sentry) ? { NEXT_PUBLIC_SENTRY_DSN: sentry } : {}),
  };
})();

/**
 * True outside production builds (`next dev`, vitest) — enables the throw-in-development copy guards
 * (03 PixelLabel ≤5 words / size 10 && informational; Toast ≤3 words). Literal NODE_ENV so Next inlines it.
 */
export const isDev = process.env.NODE_ENV !== 'production';
