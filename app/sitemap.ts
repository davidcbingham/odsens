import type { MetadataRoute } from 'next';
import { listPublishedProjects } from '@/lib/data/projects';
import { env } from '@/lib/env';

/**
 * `/sitemap.xml` — 02 RP-07 (registry `app/sitemap.ts`; T-E2E-45b / SM-25 — ADR-0002 A9; 00
 * S1.2 "Public routes"). Lists, in RP-07's order: `/`, `/projects`, every published non-hidden
 * `/projects/<slug>`, then `/videos`, `/skins`, `/art`, `/seen-on`, `/support`, `/privacy`,
 * `/how-comments-work`. Noindexed surfaces (`/admin`, `/welcome`, `/profile`, `/api`,
 * `/__test`) are never listed (RP-07; T-E2E-45b).
 *
 * Slugs come from `listPublishedProjects()` (`lib/data/projects.ts` — anon client, no cookies,
 * `unstable_cache` under tag `projects`; 01 INV-09/INV-15/INV-38), so a sync/curation
 * `revalidateTag('projects')` refreshes the file instantly and everything else catches up at
 * the ISR interval (`revalidate` 600, 02 §0.1). URLs are absolute from `NEXT_PUBLIC_SITE_URL`
 * (metadata routes take no `metadataBase`). RP-07 specifies no `lastModified`/`changefreq`/
 * `priority`, so entries are bare `<loc>`s.
 */
export const revalidate = 600;

/** RP-07 static routes, verbatim, split around the project detail URLs to keep RP-07's order. */
const STATIC_BEFORE = ['/', '/projects'] as const;
const STATIC_AFTER = [
  '/videos',
  '/skins',
  '/art',
  '/seen-on',
  '/support',
  '/privacy',
  '/how-comments-work',
] as const;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');
  const projects = await listPublishedProjects();
  return [
    ...STATIC_BEFORE.map((path) => ({ url: `${base}${path}` })),
    ...projects.map(({ slug }) => ({ url: `${base}/projects/${slug}` })),
    ...STATIC_AFTER.map((path) => ({ url: `${base}${path}` })),
  ];
}
