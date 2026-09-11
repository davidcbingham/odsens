# ADR-0036 — Build order after Oliver's first use: cross-posted projects and the Support page ahead of Videos

## Status
Proposed

## Date
2026-09-11

## Slice
cross-cutting (plan order; defines S1.5a and S1.5b, narrows S1.9)

## Context
Kind: deferral
- Spec says: `docs/build/00-build-plan.md` §1.4 (tag order S1.5 `v0.6` → S1.6 `v0.7` → … → S1.9 `v0.10`), §2 (S1.6 Videos is the next slice after S1.5), §S1.9 (the public `/support` page, `FloatingSupportButton` and the `tip_click` event ship with Stats in S1.9); `_registry.md` "Slices" table and the slice-ID format `S<phase>.<n>`; `docs/spec.md` §4 goal 5 (Support).
- Found (Oliver's first hands-on use of the live site, relayed by David 2026-09-11 — the list and dispositions are in `docs/questions.md` "Oliver's first-use list"): the two things that make the site useful to him *now* are not in the next slice. (a) **He posts a project to odsens.com the moment it is ready and submits the same project to Modrinth in parallel**; Modrinth review is slow or refuses. Today the hourly sync would import the approved Modrinth listing as a *second* project, and a project that started on Modrinth cannot carry odsens-hosted files at all, so "download from the site" only exists for exclusives. (b) **He wants Ko-fi live** — the page name is already saved in `/admin/settings` (S1.5), but the public `/support` page with the embed and the floating support button are scheduled three slices out in S1.9. David's calls (2026-09-11): the odsens-hosted file is always the primary download; a project on both sites loses the ONLY ON ODSENS badge; one linking mechanism for Modrinth and CurseForge; Oliver may back-fill hosted versions on older Modrinth-only projects; pull the Support page ahead of Videos.
- Related: ADR-0002 #42 / 00-O-18 (synced file downloads from the Modrinth CDN — kept for files that only exist there), ADR-0026 (version identity — exclusive and synced versions can already coexist in one project), ADR-0027 (two-phase uploads, `Downloadable`), ADR-0034/0035 (the two fix passes that preceded this), `docs/questions.md` 2026-09-11 "Cross-posting decision".

## Decision
1. **Two slices are inserted between S1.5 and S1.6, in this order: `S1.5a — Cross-posted projects` (tag `v0.6.1`) and `S1.5b — Support page` (tag `v0.6.2`).** S1.6 Videos and everything after keep their IDs, tags and content. The slice-ID format in `_registry.md` gains the inserted form `S<phase>.<n><letter>` for slices added after the freeze; tags for inserted slices are `v0.<n>.<k>`.
2. **S1.5a — Cross-posted projects ("one project, many homes").** Full slice section in 00 §2 (this ADR's PR). Summary: the odsens row is canonical; a "Modrinth listing" field in the admin editor (beside the CurseForge one) links a Modrinth project to it through `project_links{platform:'modrinth'}`; the sync never creates a second row for a linked listing — its versions sync *into* the linked project keyed by Modrinth version id (ADR-0026), a hosted version with the same `version_number` adopts the Modrinth id and keeps its files primary, Modrinth files whose sha512 matches a hosted file are not duplicated; a synced duplicate that already exists when the link is made is folded into the canonical row; uploads open to every project (a Modrinth-first project can gain hosted files); the GET IT panel's primary is the newest release's hosted primary file when one exists, else the Modrinth file, with "Also on Modrinth / CurseForge" rows and the combined count; `ExclusiveBadge` renders only while the project has no platform link. Contracts, schema and copy are pinned by the slice's own ADR at Session A, as every slice does.
3. **S1.5b — Support page.** The public `/support` page (`AmountPicker`, CONTINUE ON KO-FI mounting `KofiPanelSlot`, "on Ko-fi ↗", the leaderboard empty state), `FloatingSupportButton` on every public route except `/support`, the `tip_click` event, and the Ko-fi `frame-src` CSP entry move out of S1.9 into S1.5b, with their acceptance criteria S1.9.AC4–AC7, AC11 and the S1.9 tests T-E2E-11, 40, 49 (+ the `tip_click` custom-events smoke). **S1.9 keeps** `stats_daily`, `snapshotStats`, `/admin/stats`, the `sign_in` event and S1.9.AC1–AC3, AC8 (minus `tip_click`), AC9, AC10 (minus `/support`).
4. **Gate matrix, cron/table/nav tables and the §8 slice rows of 02 and 05 gain S1.5a/S1.5b rows**; `START-BUILD.md` names the current position (it still said S0). Test IDs for the new slices are assigned in 05 when each slice opens (H-13 append-only), as for every slice.
5. **Order after this ADR:** S1.5a → S1.5b → S1.6 Videos → S1.7 → S1.8 → S1.9 (narrowed) → S1.10. Oliver's remaining note — anything else missing from the hosted-upload flow — lands in S1.5a's scope if it arrives before that Session A, otherwise as a fix pass.

## Alternatives considered
| Alternative | Why not |
|---|---|
| Keep the order; do cross-posting as a fix pass | It is schema + sync + editor + download panel + badge rule — a slice's worth of gated work; a "fix pass" label would skip the two-session cadence and the seven gates. |
| Renumber S1.6–S1.10 to make room | Every doc, registry row, ADR and PR references those IDs; inserting lettered slices keeps all of them true. |
| Ship the whole of S1.9 early instead of splitting it | Stats needs `stats_daily` history to be worth looking at and blocks nothing Oliver asked for; the Support page is one page + one button. |
| Mirror Modrinth files onto odsens storage automatically | Nothing to mirror — Oliver uploads to both himself; auto-mirroring would copy files he did not choose to host and double storage. |
| A second `projects` row per platform with a "same as" link | Two URLs, two comment threads, two curation rows for one thing; the canonical-row model keeps one. |

## Consequences
- Positive: the next two slices are the two things Oliver needs to use the site daily; nothing already built changes hands; S1.6–S1.10 stay as written.
- Negative: two more tags before Videos; S1.9's section carries "moved to S1.5b" notes; the slice-ID convention has an inserted form.
- Follow-ups: S1.5a Session A writes its contract ADR (link action, sync adoption rules, fold semantics vs J-D "never delete", `Downloadable` for synced rows, badge helper) → owner `build-phase`; the S1.6 Session-A prompt is redrafted after S1.5b merges.

## Docs amended
| Doc | Section | Change |
|---|---|---|
| `docs/build/00-build-plan.md` | §1.4 Tagging; §1.7 Gate matrix; §2 new S1.5a + S1.5b sections; §S1.9 Scope IN/OUT + AC + Tests; §4.1/§4.2/§4.3; §6 Changelog | the inserted slices, the S1.9 narrowing (contains ADR-0036) |
| `docs/build/_registry.md` | ID conventions (inserted slice form); Slices table | S1.5a, S1.5b rows (contains ADR-0036) |
| `docs/build/02-routes-and-pages.md` | §8 slice → routes | S1.5a, S1.5b rows; S1.9 row narrowed (contains ADR-0036) |
| `docs/build/05-test-plan.md` | §8 slice rows | S1.5a, S1.5b rows; S1.9 row narrowed (contains ADR-0036) |
| `docs/build/START-BUILD.md` | Current position | replaces the stale "S0" line (contains ADR-0036) |
| `docs/build/06-decisions/README.md` | §7 Index | new ADR-0036 row |
| `docs/questions.md` | 2026-09-11 entry | the order recorded |

## Gate impact
| Gate | Now checks |
|---|---|
| spec-drift-reviewer | branch names / PR bodies for `S1.5a` and `S1.5b` resolve to 00 §2 sections; S1.9 PRs must not re-implement `/support` or the floating button; tag order `v0.6.1` → `v0.6.2` → `v0.7` |
| all gates | S1.5a and S1.5b run the full seven (00 §1.7 rows) |
