/**
 * lib/env/public.ts — the browser-safe env subset (01 INV-35/INV-29; 04 SC-16).
 * Only NEXT_PUBLIC_* names live here; client components import `publicEnv` from this file, never `@/lib/env`.
 * Next.js inlines these at build time, so they must be referenced as literal `process.env.NEXT_PUBLIC_*`.
 * Validated by hand (not zod) on purpose: this module is in every client bundle and zod stays server-side
 * (`lib/env.ts`) — ADR-0008.
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
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const site = process.env.NEXT_PUBLIC_SITE_URL;
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
