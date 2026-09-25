/**
 * lib/data/art.ts — the ISR read of `art` (registry Modules `data/art.ts`; 02 route row `/art`
 * "Data `art` (published)"; 02 RP-23 tag `art`; 00 S1.7 AC6–AC8; ADR-0048 D12).
 *
 * Server-only; the cookie-less anon client (01 INV-15). RLS already keeps draft rows from anon
 * (05 T-RLS-58/59) — the explicit `status = 'published'` filter stays anyway. ONE cached reader
 * serves `/art` under tag `art` with the page's 600 s (01 INV-38); `createArt` / `updateArt`
 * revalidate the tag (02 RP-22). Order = the `art_status_sort_idx` order: `sort_order` asc,
 * `created_at` desc, `id` asc (total — one order between revalidations).
 *
 * URLs are resolved HERE (03 C-19): `imageUrl` is the public-bucket URL of the CHECK-bound
 * `art/<id>/<hash16>.<ext>` path, built with `publicStorageUrl` (`lib/data/projects.ts` —
 * `lib/files.ts` sits behind the admin-client import fence, 01 INV-14); `downloadHref` is that
 * URL + `?download=<slug>.<ext>` (Supabase answers `Content-Disposition: attachment`) ONLY when
 * the row is `downloadable`, else `null` — the lightbox renders no Download button (T-E2E-9).
 * `width` / `height` are the server-derived natural size the masonry hands `next/image`
 * (never cropped — 00 S1.7.AC7).
 *
 * The prop shape `ArtItem` is DECLARED in the pure client-safe `lib/art.ts` (the `ArtGallery` /
 * `ArtMasonry` client leaves may not import `@/lib/data/*` — 01 INV-09 Check) and re-exported
 * here with `export type`; the kind filter / counts / file-name rules are the pure helpers of the
 * same module.
 */
import 'server-only';
import { unstable_cache } from 'next/cache';
import { artFilename, type ArtItem } from '@/lib/art';
import { publicStorageUrl } from '@/lib/data/projects';
import { createAnonClient } from '@/lib/supabase/anon';

export type { ArtFilter, ArtItem, ArtKind } from '@/lib/art';

const REVALIDATE_S = 600;
const TAG_ART = 'art';

const LIST_SELECT = 'id, slug, title, kind, image_path, width, height, year, credit, downloadable';

async function fetchPublishedArt(): Promise<ArtItem[]> {
  const { data, error } = await createAnonClient()
    .from('art')
    .select(LIST_SELECT)
    .eq('status', 'published')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false })
    .order('id', { ascending: true });
  if (error) throw new Error(`lib/data/art: list read failed — ${error.message}`);
  return data.map((row) => {
    const imageUrl = publicStorageUrl(row.image_path);
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      kind: row.kind,
      imageUrl,
      width: row.width,
      height: row.height,
      year: row.year,
      credit: row.credit,
      downloadable: row.downloadable,
      downloadHref: row.downloadable
        ? `${imageUrl}?download=${encodeURIComponent(artFilename(row.slug, row.image_path))}`
        : null,
    };
  });
}

/**
 * Every published piece in masonry order (`sort_order` asc, newest created breaks a tie, then
 * `id`), image URL resolved, `downloadHref` set only on downloadable rows. `[]` → the page renders
 * the §11.7 "NO ART HERE YET" state (00 S1.7.AC8). Callers filter with `applyArtFilter` /
 * `kindCounts` (`lib/art.ts`). Cached under tag `art` (01 INV-38; 02 RP-23).
 */
export const listPublishedArt = unstable_cache(fetchPublishedArt, ['data-art-list'], {
  revalidate: REVALIDATE_S,
  tags: [TAG_ART],
});
