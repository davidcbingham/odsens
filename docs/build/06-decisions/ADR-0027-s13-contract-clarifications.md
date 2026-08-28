# ADR-0027 — S1.3 contract clarifications (create-page flow, download-route referrer header, upload-contract letter)

## Status
Proposed

## Date
2026-08-27

## Slice
S1.3

## Context
Kind: deviation
- Spec says: `docs/build/02-routes-and-pages.md` §1.3 `/admin/projects/new` row — components "`Field`, `Select`, `Chip`, `UploadWell`, `Markdown` (preview), `Button`"; `docs/build/00-build-plan.md` §S1.3 demo step 1 — "fill Modrinth-shaped form → upload icon + a .jar → save draft"; `docs/build/01-architecture.md` INV-76 — headers "on every route … `Referrer-Policy: strict-origin-when-cross-origin`"; `docs/build/04-server-contracts.md` §1.4 `updateExclusiveProject` input — "`{id: uuid} & Partial<createExclusiveProject input>`"; §1.4.5 commit — "`download` the object (streaming)", "U3 commit is idempotent on `path`"; 01 INV-56 — the download route "is generic … not project-hardwired".
- Found: five places where the frozen letter and the correct build disagree, each found by the Session-A verification sweep. (1) Uploads need a `project_id` for the SC-21 storage paths, so `/admin/projects/new` cannot host an `UploadWell` — the canonical flow (data-model §6, 05 T-E2E-35) is create draft → redirect → upload on `/admin/projects/[id]`; 02's component list and 00's demo step describe the impossible order. (2) 04 §2.3 D6 mandates `Referrer-Policy: no-referrer` on the download 302, which INV-76's blanket header contradicts; Next config headers overwrite handler headers per key, so the route needs its own config rule. (3) `Partial<>` cannot express clearing a stored `license`/link URL — the schema accepts explicit `null` for the four clearable optionals; the create schema also defaults `body_md`/`categories`/`loaders`/`game_versions` (absent = empty), a presence loosening within the cells' value bounds. (4) The commit phase buffers the object (≤ 100 MB, within function memory) rather than streaming, and media idempotency is content-based (same bytes → same `{hash16}` path → the stored entry; a bare commit retry after a successful commit answers `validation` and converges when the client re-sends) — the object is content-addressed, so a path-keyed retry ledger would add state for no integrity gain. (5) The route's RPC call shape (`p_file_id/p_ip_hash/p_ua_hash`) and signed-URL strategy fit kind `project_file` only; kind `skin` (S1.7) needs a counter-payload builder + a `urlKind` discriminator on `Downloadable`.
- Related: `docs/questions.md` S1.3 build notes 2026-08-27.

## Decision
1. `/admin/projects/new` is the create-only metadata form (`Field`/`Select`/`Button`/`Breadcrumb`; comma-separated text inputs for categories/loaders/game versions); uploads and the rendered body live on `/admin/projects/[id]` after the redirect. 02 §1.3 row and 00 §S1.3 demo step 1 are amended to that flow.
2. `next.config.ts` carries a `source: '/api/download/:path*'` header rule setting `Referrer-Policy: no-referrer` (04 §2.3 D6), scoped to that subtree only; INV-76 gains the carve-out line. Every other route keeps `strict-origin-when-cross-origin`.
3. 04 §1.4 `updateExclusiveProject`: the four clearable optionals (`license`, `source_url`, `issues_url`, `discord_url`) accept `| null` to clear; `createExclusiveProject`'s `body_md`/`categories`/`loaders`/`game_versions` are optional-with-empty-defaults (values still bound by the cells).
4. 04 §1.4.5 as built: the commit phase buffers the stored object (caps ≤ 100 MB sit inside function memory; a streaming refactor is not required); media U3 idempotency is content-based per the Context; file commits keep the path-keyed letter (same path + same sha512 → existing row, different bytes → `conflict`), with the filename-uniqueness check ordered before the version-metadata upsert.
5. The `Downloadable` counter-payload/URL-kind generalisation (01 INV-56 for kind `skin`) is deferred to S1.7, which adds `record_skin_download` and the public-URL branch; v1.3's route serves the one kind that exists.
6. `UploadWell` carries two additive optional props beyond the frozen 03 §2.10 cell: `disabled` (the 03 §2.10 admin-only-controls rule requires it) and `disabledTitle` (so the not-ready gate of `ProjectFileWell` never shows the moderator wording) — C-03 additive-prop precedent (ADR-0014). `ProjectFileWell` (same island file) is registered in `_registry.md`.

## Alternatives considered
| Alternative | Why not |
|---|---|
| UploadWell on `/new`, disabled until saved | A dead control on a create form; the redirect-then-upload flow is what 05 T-E2E-35 tests and data-model §6 describes. |
| Drop the download route's `no-referrer` (accept INV-76's blanket value) | 04 §2.3 D6 is the specific contract for the one response that carries a signed URL in `Location`; specific beats blanket. |
| Path-keyed media idempotency ledger | State for no integrity gain — the final path IS the content hash; a re-upload converges to the same entry. |
| Streaming commit validation now | Buffered ≤ 100 MB is safely inside function memory; streaming adds complexity with no current failure mode. |
| Generalise `Downloadable` now | Speculative until S1.7's `skin` kind exists; the refactor is one type + one call-site change, listed here so S1.7 picks it up. |

## Consequences
- Positive: the shipped flow, headers and schemas match one written contract again; S1.7 inherits an explicit TODO instead of a surprise.
- Negative: 04 §1.4.5's "streaming" wording is weakened to "buffered within caps"; media bare-retry answers a (self-healing) validation error.
- Follow-ups: S1.7 implements Decision 5 (`counterArgs` + `urlKind` on `Downloadable`) → owner `backend-robustness`.

## Docs amended
| Doc | Section | Change |
|---|---|---|
| `docs/build/02-routes-and-pages.md` | §1.3 `/admin/projects/new` row + Status line | components/flow per Decision 1 (contains ADR-0027) |
| `docs/build/00-build-plan.md` | §S1.3 demo step 1 · §6 changelog + Status line | demo flow per Decision 1; changelog row (contains ADR-0027) |
| `docs/build/01-architecture.md` | §20 INV-76 + Status line | `/api/download/**` carve-out (contains ADR-0027) |
| `docs/build/04-server-contracts.md` | §1.4 `createExclusiveProject`/`updateExclusiveProject` input cells, §1.4.5 commit row + Status line | Decisions 3–4 (contains ADR-0027) |
| `docs/build/_registry.md` | Component registry Admin line | `ProjectFileWell` (same file as `UploadWell`) |
| `docs/questions.md` | S1.3 build notes | fix-round record |

## Gate impact
| Gate agent | What it now checks differently |
|---|---|
| `spec-drift-reviewer` | 02 §1.3 `/new` row, 00 demo step, 01 INV-76, 04 §1.4/§1.4.5 read as amended here |
| `security-reviewer` | header override rule is sanctioned and scoped to `/api/download/:path*` only |
| `design-fidelity-reviewer` | `UploadWell` `disabled`/`disabledTitle` are sanctioned additive props |
| `backend-reviewer` | buffered commit + content-based media U3 are the recorded contract |
