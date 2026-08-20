# ADR-0005 — Placeholder pages render static, not ISR

## Status
Accepted

## Date
2026-08-17

## Slice
S0

## Context
Kind: deviation
- Spec says: `docs/build/01-architecture.md` INV-38 — "Placeholder pages for nav targets not yet shipped (ADR-0002 C20) are ISR(600) with no data reads (`export const revalidate = 600`, no tags, no `loading.tsx` — 02 RP-16); they live at the same paths as the pages that replace them, so the grep below applies to them unchanged." Its Check: "`grep -rn "export const revalidate" …` == 600 on each of the ten".
- Spec says: `docs/build/02-routes-and-pages.md` §0.1 — "The C20 placeholder pages (RP-16) are **static** — no data reads and no `revalidate` export (01 INV-38); they show `○` in the route table until their slice replaces them." RP-16 — "Placeholders are **static** (no data reads, no `revalidate` export — 01 INV-38), carry the real `<title>`, and have no `loading.tsx`." SM-29 agrees ("C20 placeholders are static `○` before that").
- Found: both docs are frozen v1.0 and each cites the other, yet they contradict on whether the six S0 placeholder pages (`/projects`, `/videos`, `/skins`, `/art`, `/seen-on`, `/support`) export `revalidate = 600`. S0 must build them one way. ADR-0002 precedence: "**02 owns route rendering**" (02 header: "02 §1 wins for a route's rendering mode"), so 02's static reading governs and 01 INV-38 is amended.
- Related: none in `docs/questions.md` · supersedes none.

## Decision
1. The six placeholder pages export **no** `revalidate` (and no `dynamic`), read no data, import nothing from `lib/data/**` or `lib/supabase/**`, and have no `loading.tsx`; `next build` shows them as `○` (static) in the route table. 02 §0.1 / RP-16 stand as written.
2. `docs/build/01-architecture.md` INV-38 is amended so its placeholder sentence reads: "Placeholder pages for nav targets not yet shipped (ADR-0002 C20) are static — no data reads and no `revalidate` export (02 §0.1/RP-16; ADR-0005) — and the `== 600 on each of the ten` grep applies to a path only once its real page ships." The rest of INV-38 (ISR 600 + tags for the real pages; `/privacy` and `/how-comments-work` = ISR(600) with no data reads) is unchanged.
3. When a slice replaces a placeholder with the real page (S1.2 `/projects`, S1.6 `/videos`, S1.7 `/skins` + `/art`, S1.8 `/seen-on`, S1.9 `/support`), that page adds `export const revalidate = 600` and its registry tags per INV-38; the INV-38 grep then applies to that path.

## Alternatives considered
| Alternative | Why not |
|---|---|
| Follow 01 as written: `export const revalidate = 600` on a page that reads nothing | Harmless at runtime (`●` vs `○`), but it contradicts the doc that owns rendering (02 §0.1, RP-16, SM-29 all say static `○`) and the route-table check `frontend-reviewer` runs against `main`'s artifact would have to special-case placeholders twice (once for `●`, again when they turn ISR-with-tags). One reading, owned by 02, is simpler. |
| Leave both docs as they are and let the gate pick | Frozen docs that contradict on a checkable statement make `spec-drift-reviewer` fail either way; README ADR-R1 requires the amendment in the same PR. |

## Consequences
- Positive: one rendering rule for placeholders, owned by 02; the S0 route table is fully `○` for the six paths (00 S0 demo, T-E2E-46 unaffected); the INV-38 grep stays exact for real pages.
- Negative: the INV-38 check needs the "once its real page ships" qualifier, so a reviewer must know which paths are still placeholders (00 §4.3 nav/footer state by slice is the source).
- Follow-ups: each replacing slice adds `revalidate = 600` + tags and re-runs the INV-38 grep for that path → owner `build-phase` (per-slice AC) and `web-quality`; `frontend-reviewer` route-table comparison expects `○` → `●` flips only in the replacing slice.

## Docs amended
| Doc | Section | Change |
|---|---|---|
| `docs/build/01-architecture.md` | INV-38 row (§9 Rendering) | placeholder sentence rewritten to "static — no data reads and no `revalidate` export (02 §0.1/RP-16; ADR-0005) — and the `== 600 on each of the ten` grep applies to a path only once its real page ships" (contains the string ADR-0005) |
| `docs/build/01-architecture.md` | `Status:` line | appended "— amended by ADR-0003, ADR-0005 (2026-08-17)" (README ADR-R2) |
| `docs/build/02-routes-and-pages.md` | §0.1 `ISR(600; tags)` row | appended "(confirmed by ADR-0005)" after the placeholder sentence (contains the string ADR-0005) |
| `docs/build/02-routes-and-pages.md` | RP-16 | appended "(confirmed by ADR-0005)" after "Placeholders are **static** …" (contains the string ADR-0005) |
| `docs/build/02-routes-and-pages.md` | `Status:` line | appended "— amended by ADR-0005 (2026-08-17)" (README ADR-R2) |
| `docs/build/06-decisions/README.md` | §7 Index | row for ADR-0005 |

## Gate impact
| Gate | Now checks |
|---|---|
| spec-drift-reviewer | placeholder pages contain no `revalidate`/`dynamic` export and no `lib/data`/`lib/supabase` import at S0; the INV-38 `== 600` grep is applied only to paths whose real page has shipped (00 §4.3) |
| frontend-reviewer | `next build` route table shows `○` for `/projects`, `/videos`, `/skins`, `/art`, `/seen-on`, `/support` at S0; a path flips to `●` (ISR 600 + tags) only in its replacing slice; no `loading.tsx` beside a placeholder |
| deploy-checker | the six placeholder URLs return 200 with title + "Not yet. Soon." (00 S0.AC1); no `Cache-Control: no-store` on them |
| design-fidelity-reviewer, security-reviewer, backend-reviewer, supabase-reviewer | none |
