/**
 * lib/skins.ts — the pure, client-safe half of the skins data layer (S1.7; 03 §2.7 `SkinViewer3D` /
 * `SkinCard` + the `SkinsStage` island; 02 route row `/skins`; 04 §2.3 download route kind `skin`;
 * 00 S1.7 AC1–AC5; ADR-0047 / ADR-0048).
 *
 * Plain module (no directive, no env, no `server-only`, no zod — ADR-0008): bundled into the
 * `SkinsStage` / `SkinCard` / `SkinViewer3D` client leaves and the `SkinForm` admin island, which
 * may not import `@/lib/data/*` (01 INV-09 Check greps every client file for it). So the prop types
 * `SkinCardData` / `SkinStageItem` are declared HERE and `lib/data/skins.ts` (server-only: the one
 * cached reader `listPublishedSkins`, tag `skins`) re-exports them with `export type` — the
 * `lib/videos.ts` / `lib/data/videos.ts` split (ADR-0043 D6). `tests/unit/skins.test.ts` covers
 * every function.
 *
 * What lives here:
 *   SkinModel                               the `skin_model` enum (data-model §2.4)
 *   SkinCardData · SkinStageItem            the component prop shapes (serialisable: camelCase,
 *                                           public URLs already resolved — 03 C-19)
 *   slugifyName                             the `SkinForm` slug pre-fill (the `lib/validation/slug.ts`
 *                                           `slugify` rule, copied so the island stays zod-free)
 *   selectSkin                              `?skin=<slug>` → the shown skin (absent / unknown → first)
 *   skinDownloadHref · skinFilename         the DOWNLOAD PNG link (04 §2.3) and the saved file name
 *
 * Every function is pure: no clock, no I/O, inputs are never mutated.
 */

/** `skin_model` (data-model §2.4; 04 §1.5 `createSkinInput.model`). */
export type SkinModel = 'classic' | 'slim';

/** 03 §2.7 `SkinCard` prop shape — one published row of `skins`, URLs resolved by the reader. */
export type SkinCardData = {
  id: string;
  slug: string;
  name: string;
  model: SkinModel;
  /** Public object URL of the 64×64 texture (`skins/<id>/texture.png`) — what skinview3d loads. */
  textureUrl: string;
  /** Public object URL of the cached bust render; `null` → the card renders the live fallback. */
  bustUrl: string | null;
  /** `skins.is_exclusive` → `data-exclusive` + `ExclusiveBadge`. */
  exclusive: boolean;
};

/** What the `SkinsStage` island takes: a card plus the Markdown source and the download count. */
export type SkinStageItem = SkinCardData & {
  /** `skins.description_md` (rendered by the server page — 03 C-19); `null` → nothing under the name. */
  descriptionMd: string | null;
  downloads: number;
};

/**
 * `slugifyName('Seed Skin A!')` → `seed-skin-a` — the same rule as `lib/validation/slug.ts`
 * `slugify` (NFKD-strips accents, lowercases, every non-alphanumeric run → one dash, dashes
 * trimmed), duplicated here because that module carries zod and this one is in a client bundle
 * (ADR-0008). The result is a PRE-FILL only: `createSkinInput.slug` (`slugSchema`) still decides
 * length and reservation on the server.
 */
export function slugifyName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The skin `/skins` shows for `?skin=<slug>` (02 §1.1 row `/skins`; 00 S1.7.AC3): the matching
 * skin, or the FIRST of the list when the param is absent or names no skin (the reader's order
 * puts the lowest `sort_order` first — SEED-7 `seed-skin-b`). `null` only for an empty list.
 */
export function selectSkin<T extends SkinCardData>(
  skins: readonly T[],
  slug: string | null,
): T | null {
  if (slug !== null) {
    const match = skins.find((skin) => skin.slug === slug);
    if (match !== undefined) return match;
  }
  return skins[0] ?? null;
}

/** The DOWNLOAD PNG href (04 §2.3 `/api/download/[fileId]`, kind `skin` — ADR-0002 C8). */
export function skinDownloadHref(id: string): string {
  return `/api/download/${encodeURIComponent(id)}`;
}

/** The file name the download saves as (`?download=<slug>.png` — 04 §2.3 ADR-0048 D1 / ADR-0048 D22). */
export function skinFilename(slug: string): string {
  return `${slug}.png`;
}
