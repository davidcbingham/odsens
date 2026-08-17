/**
 * lib/env/public.ts — the browser-safe env subset (01 INV-35/INV-29; 04 SC-16).
 * Only NEXT_PUBLIC_* names live here; client components import `publicEnv` from this file, never `@/lib/env`.
 * Next.js inlines these at build time, so they must be referenced as literal `process.env.NEXT_PUBLIC_*`.
 */
import { z } from 'zod';

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_SITE_URL: z.url(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(), // S1.10 (ADR-0002 #79)
});

export type PublicEnv = z.infer<typeof publicSchema>;

/** Parsed once at module load; throws with the missing names if a required public var is absent. */
export const publicEnv: PublicEnv = (() => {
  const parsed = publicSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN || undefined,
  });
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Missing or invalid public environment variables: ${missing}`);
  }
  return parsed.data;
})();
