/**
 * `/robots.txt` (02 RP-07; T-E2E-45a). Disallows the auth, API, onboarding, profile and admin
 * surfaces; those routes also send `X-Robots-Tag: noindex, nofollow` from `next.config.ts` (01 INV-76).
 * `sitemap:` is added in S1.2 together with `app/sitemap.ts` (T-E2E-45b, ADR-0002 A9) — no env read
 * here, so this file stays static.
 */
import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/api', '/auth', '/welcome', '/profile'],
    },
  };
}
