/**
 * lib/data/skins.ts — the ISR read of `skins` (registry Modules `data/skins.ts`; 02 route row
 * `/skins` "Data `skins` (published)"; 02 RP-23 tag `skins`; 00 S1.7 AC1–AC5; ADR-0048 D12).
 *
 * Server-only; the cookie-less anon client (01 INV-15). RLS already keeps draft rows from anon
 * (05 T-RLS-53/54) — the explicit `status = 'published'` filter stays anyway: a draft must never
 * render publicly whatever a later policy edit does. ONE cached reader serves `/skins` (the
 * ADR-0043 D6 precedent: one cache entry, one stale-while-revalidate window) under tag `skins`
 * with the page's 600 s (01 INV-38); `createSkin` / `updateSkin` revalidate the tag (02 RP-22).
 * Order = the `skins_status_sort_idx` order: `sort_order` asc, then `created_at` desc, then `id`
 * asc (total, so the order is one order between revalidations — SEED-7 puts `seed-skin-b` first).
 *
 * URLs are resolved HERE (03 C-19: components get finished strings): `textureUrl` /
 * `bustUrl` are the public-bucket URLs of the CHECK-bound `skins/<id>/…` paths, built with
 * `publicStorageUrl` (`lib/data/projects.ts`) — `lib/files.ts` `publicObjectUrl` is the same
 * template but sits behind the admin-client import fence `lib/data/**` may not cross (01 INV-14).
 * `descriptionMd` leaves as the Markdown SOURCE; the server page renders it (C-19 server-rendered
 * children) — the island never sees Markdown.
 *
 * The prop shapes `SkinCardData` / `SkinStageItem` are DECLARED in the pure client-safe
 * `lib/skins.ts` (the `SkinsStage` / `SkinCard` / `SkinViewer3D` client leaves may not import
 * `@/lib/data/*` — 01 INV-09 Check) and re-exported here with `export type`, so server callers
 * still import them from the data layer (ADR-0043 D6 / ADR-0045 precedent).
 */
import 'server-only';
import { unstable_cache } from 'next/cache';
import { publicStorageUrl } from '@/lib/data/projects';
import type { SkinStageItem } from '@/lib/skins';
import { createAnonClient } from '@/lib/supabase/anon';

export type { SkinCardData, SkinModel, SkinStageItem } from '@/lib/skins';

const REVALIDATE_S = 600;
const TAG_SKINS = 'skins';

const LIST_SELECT =
  'id, slug, name, description_md, texture_path, model, render_bust_path, is_exclusive, downloads';

async function fetchPublishedSkins(): Promise<SkinStageItem[]> {
  const { data, error } = await createAnonClient()
    .from('skins')
    .select(LIST_SELECT)
    .eq('status', 'published')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false })
    .order('id', { ascending: true });
  if (error) throw new Error(`lib/data/skins: list read failed — ${error.message}`);
  return data.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    model: row.model,
    textureUrl: publicStorageUrl(row.texture_path),
    bustUrl: row.render_bust_path === null ? null : publicStorageUrl(row.render_bust_path),
    exclusive: row.is_exclusive,
    descriptionMd: row.description_md,
    downloads: row.downloads,
  }));
}

/**
 * Every published skin in stage order (`sort_order` asc, newest created breaks a tie, then `id`),
 * with the texture / bust public URLs resolved and `bustUrl: null` where the cached render has
 * not landed yet (the card's live fallback — 00 S1.7.AC10). `[]` → the page renders the §11.7
 * "NO SKINS YET" state. Cached under tag `skins` (01 INV-38; 02 RP-23).
 */
export const listPublishedSkins = unstable_cache(fetchPublishedSkins, ['data-skins-list'], {
  revalidate: REVALIDATE_S,
  tags: [TAG_SKINS],
});
