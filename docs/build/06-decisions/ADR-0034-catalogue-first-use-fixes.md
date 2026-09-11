# ADR-0034 — Catalogue fixes from Oliver's first use: synced slugs, loader names, version ranges, full-size images

## Status
Proposed

## Date
2026-09-11

## Slice
cross-cutting (fix pass on `main` after S1.5 / v0.6; touches S1.2 sync + catalogue rendering)

## Context
Kind: deviation
- Spec says: `docs/build/04-server-contracts.md` §3.1 step 2 — the sync upserts `slug` and `icon_url` as Modrinth sends them and `gallery[{url,…}]` from each gallery item's `url`; `docs/build/03-components.md` §2.3 — chips are "versions/loaders" and `VersionsTable`'s Minecraft column / `GetItPanel`'s file meta join `gameVersions` / `loaders` as stored; `docs/data-model.md` §2 — `icon_url` "Modrinth CDN URL".
- Found (Oliver, reported through David 2026-09-11, the first hands-on pass over the live catalogue): (1) **"Essential Dark Pack Fix" 404s** — Modrinth's slug for it is `essential-dark-pack-armor-fix-` with a trailing dash; `SLUG_RE` (04 shared schemas) refuses a trailing dash, `getProjectDetail` returns nothing for a slug that fails the regex, and the page renders the 404 body. (2) **Loaders read as ids** — `fabric`, `neoforge`, `bungeecord` on chips, the versions table and the GET IT meta; the proper names are `Fabric`, `NeoForge`, `BungeeCord`. (3) **Version lists are unreadable** — a project supporting 1.17 through 1.21.11 lists every one of ~40 ids in the Minecraft column. (4) **Images look over-compressed** — Modrinth's API hands out its pre-resized icon (`…_96.webp`, 96 px) and gallery thumbnails (`…_350.webp`); the site renders them at 104 px, in the 440 px hero rail and the full-width gallery well, so they are upscaled. The originals sit next to them on the CDN (gallery items carry `raw_url`; icons keep the original at `<base>.<ext>`).
- Related: ADR-0002 #42/O-18 (synced files download from the Modrinth CDN — unchanged), ADR-0026 (version identity — unchanged), 03 V-01 (chip version groups — unchanged; this ADR touches the versions-table column only), `docs/questions.md` 2026-09-11 (Oliver's list).

## Decision
1. **Synced slugs are normalised (D1).** `adapters/modrinth.mapProject` sets `slug = normalizeSyncedSlug(raw.slug, raw.title, raw.id)`: `slugify(raw.slug)`; if that fails `SLUG_RE` or is reserved, `slugify(raw.title)`; last resort `p-<id>`. The job's existing rename handling revalidates both the old and the new detail path, so the production row heals on the next hourly sync. `createExclusiveProject`'s citext conflict rule already covers a normalised synced slug colliding with an exclusive one.
2. **Loaders display as names, stay ids as data (D2).** New `lib/format/loader.ts` `loaderLabel(id)` / `loaderLabels(ids)` (`fabric` → `Fabric`, `neoforge` → `NeoForge`, `bungeecord` → `BungeeCord`, unknown → first letter upper-cased). Applied in `lib/data/projects.ts` where the read models are built — `projectChips`, `versions[].loaders`, `primaryFile.loaders` — so every chip, the versions-table Loader column and the GET IT meta show names. Filters, forms, the sync and the DB keep lowercase ids; the admin forms' helper text keeps listing ids because that is what the field accepts.
3. **The versions-table Minecraft column shows ranges (D3).** New `lib/versions.ts` `formatVersionList(gameVersions)`: releases sorted oldest → newest, a run of neighbouring minors collapses to `first – last` (`1.17 – 1.21.11`), the run breaks only where a whole minor series is missing (`1.16.5, 1.18 – 1.19.4`), snapshots follow verbatim. The chip rule (03 V-01 `major.minor.x` groups) and the filter matching are unchanged; the full list stays in the read model.
4. **Full-size images from Modrinth (D4).** (a) Gallery: `mapProject` stores `raw_url ?? url` in `gallery[].url` — the original, not the `_350` thumbnail; the gallery/lightbox/hero already read `url`. (b) Icon: `createModrinth` gains `resolveIconUrl(iconUrl)` — for a resized `…/<hash>_<n>.webp` URL it HEAD-probes `<base>.png|.jpg|.jpeg|.webp|.gif` (5 s each, no retry; the CDN, not the rate-limited API) and stores the first 200, else the input unchanged. `syncModrinth` calls it when the icon is new or changed (`iconBase(existing.icon_url) !== iconBase(mapped.icon_url)`) **or while the stored value is itself still a resized icon** (`isResizedIcon` — the rows synced before this rule are upgraded once, on the first run after deploy), so an unchanged, already-upgraded catalogue costs zero extra requests per run; an icon whose original never answers 200 is re-probed hourly (≤ 5 HEADs, bounded) rather than frozen at 96 px. Fixture icons are plain `.png` URLs, so the db/e2e suites never probe (05 H-5 holds). (c) `next.config.ts` `images.qualities = [75, 90]` and `quality={90}` on the four big slots — detail icon, hero screenshot, gallery well, lightbox. Cards keep the default 75 at 64 px.
5. **Tests.** T-UNIT-47 (`loaderLabel`), T-UNIT-48 (`formatVersionList`), T-ADP-21 (`normalizeSyncedSlug`, `raw_url` preference, `iconBase` / `isResizedIcon`, `resolveIconUrl` probe order / failure paths), T-ACT-78 (the job: a stored `_96.webp` upgrades once, an upgraded icon is never re-probed, a changed icon probes again); the `projectChips` expectations in `tests/unit/data-projects.test.ts` now read names.

## Alternatives considered
| Alternative | Why not |
|---|---|
| Relax `SLUG_RE` to accept Modrinth's slug as-is | Spreads Modrinth's looser rule into exclusive slugs, URLs with trailing dashes and case variants, and the reserved-word check; normalising once at the boundary keeps one rule for the whole site. |
| Map loader names in the components rather than the read model | Three components would each carry the map; the read model is the one place chips, table and meta are built, and the tests already pin it there. |
| Fetch Modrinth's canonical game-version list to detect true gaps | An extra upstream call on every render or sync for a display nicety; the minor-series heuristic reads correctly for real catalogues and needs no I/O. |
| Store the `_96` icon and upscale less (smaller slots) | The design fixes the slot sizes (104 px icon, 440 px hero rail); the originals exist and cost ≤ 5 HEADs per new icon. |
| Pull originals through `cdn-raw.modrinth.com` | Same probe problem (the extension is unknown) and a second host to allow-list; the primary CDN serves the original at the same base. |

## Consequences
- Positive: every synced project opens; chips/tables read as Oliver expects; Minecraft support reads as one range; hero, icon and gallery are sharp at their real sizes.
- Negative: a synced slug can now differ from Modrinth's (only when Modrinth's is invalid here); `next/image` optimises larger originals (more bytes per first render of a gallery; cached thereafter); up to five HEAD requests per new or changed icon, plus a one-time ≤ 5 × ~18 on the first run after deploy for the rows still holding `_96.webp`.
- Follow-ups: when uploads open to synced projects (the cross-posting slice), `iconBase` also decides whether an admin-uploaded icon wins over the synced one → owner `backend-robustness`.

## Docs amended
| Doc | Section | Change |
|---|---|---|
| `docs/build/04-server-contracts.md` | §3.1 `syncModrinth` Steps + External calls; §4.1 `modrinth` export list; Status line | slug normalised, `icon_url` original probe, gallery `raw_url`; ≤ 5 CDN HEADs; `resolveIconUrl` export (contains ADR-0034) |
| `docs/build/03-components.md` | §2.3 `VersionsTable`, `GetItPanel` rows; Status line | loader names via `loaderLabel`; Minecraft column via `formatVersionList` (contains ADR-0034) |
| `docs/build/05-test-plan.md` | §7.2 T-ACT-78 (new); §7.3 T-ADP-4, T-ADP-21 (new); §7.4 T-UNIT-47, T-UNIT-48 (new); §8 S1.2; Status line | the new assertions (contains ADR-0034) |
| `docs/data-model.md` | §2 `projects.slug` / `icon_url` / `gallery` notes | slug normalised; "full-size original" (contains ADR-0034) |
| `docs/build/_registry.md` | Modules; Adapters | `format/loader.ts`; `versions.ts formatVersionList`; `resolveIconUrl`, `normalizeSyncedSlug`, `iconBase`, `isResizedIcon` |
| `docs/build/00-build-plan.md` | §6 Changelog | row for ADR-0034 |
| `docs/build/06-decisions/README.md` | §7 Index | new ADR-0034 row |
| `docs/questions.md` | 2026-09-11 entry | Oliver's list + this fix pass recorded |

## Gate impact
| Gate | Now checks |
|---|---|
| spec-drift-reviewer | `mapProject` normalises the slug and prefers `raw_url`; the job probes icons only on change; the read model applies `loaderLabel`; `VersionsTable` uses `formatVersionList`; 03/04/05/data-model rows cite ADR-0034 |
| backend-reviewer | the icon probe is HEAD-only, bounded (5 × 5 s), never on an unchanged already-upgraded icon, never in fixture mode (T-ACT-78 covers the job's skip/probe/upgrade decision); slug rename revalidates old + new paths |
| design-fidelity-reviewer | chips/table/meta text are names (`Fabric`), the Minecraft column uses an en dash range; no token or component change |
| frontend-reviewer | `images.qualities` lists 75 and 90; `quality={90}` only on the four big slots |
