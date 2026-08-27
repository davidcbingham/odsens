/**
 * `/robots.txt` (02 RP-07; T-E2E-45a). Disallows the auth, API, onboarding, profile and admin
 * surfaces; those routes also send `X-Robots-Tag: noindex, nofollow` from `next.config.ts` (01 INV-76).
 * `sitemap:` points at `app/sitemap.ts` (S1.2 — T-E2E-45b, ADR-0002 A9); the absolute URL comes
 * from `NEXT_PUBLIC_SITE_URL` (build-time read — the route output stays static).
 */
import type { MetadataRoute } from 'next';
import { env } from '@/lib/env';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/api', '/auth', '/welcome', '/profile'],
    },
    sitemap: `${env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '')}/sitemap.xml`,
  };
}
