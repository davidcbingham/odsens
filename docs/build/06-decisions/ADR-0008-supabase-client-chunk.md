# ADR-0008 — Supabase browser client chunk on public routes (lazy)

## Status
Accepted

## Date
2026-08-20

## Slice
S0

## Context
Kind: dependency
- Spec says: `docs/build/01-architecture.md` INV-80 — "Any client-side dependency > 50 KB gzipped (skinview3d is the one pre-approved exception and is lazy) requires an ADR that states the route-level bundle delta from `pnpm build`; the frontend gate blocks without it." INV-78 allow-lists `@supabase/supabase-js` and `@supabase/ssr`.
- Spec says: `docs/build/03-components.md` C-17a / ADR-0002 C1 — `ViewerProvider` (client, mounted once in `app/(public)/layout.tsx`) resolves the session after hydration through `lib/supabase/client.ts`; C-18 — "Heavy client dependencies are lazy".
- Found: the first S0 build (5082471) put `@supabase/supabase-js` + `@supabase/ssr` + `zod` (via `lib/env/public.ts`) into one chunk of **137.4 KB gz** loaded on every public route; first-load JS for `/` and the six placeholders measured **≈ 323 KB gz** (`frontend-reviewer`, Lighthouse unused-JS ≈ 153 KiB). No ADR stated the numbers, so INV-80 blocked the slice.
- Related: none in `docs/questions.md` · supersedes none.

## Decision
1. The dependency stays: the session seam is the ADR-0002 C1 design and `@supabase/supabase-js` / `@supabase/ssr` are INV-78 packages; this ADR is the INV-80 record.
2. It loads **lazily**: `components/accounts/ViewerProvider.tsx` dynamic-imports `@/lib/supabase/client` inside its mount effect (`void import('@/lib/supabase/client')`), so the Supabase chunk is not part of any route's first-load JS; while it loads, `useViewer()` reports `status: 'loading'` and the leaves render the signed-out shape (03 C-17a). `GoogleSignInButton` (S1.1) and `CommentThread` (S1.4) follow the same pattern unless they are themselves lazily mounted.
3. `lib/env/public.ts` validates its four `NEXT_PUBLIC_*` names by hand (URL parse + non-empty) instead of zod, so zod stays server-only (`lib/env.ts`); 04 SC-16 / 01 INV-35 require zod only in `lib/env.ts`.
4. Numbers (from `pnpm build` of this PR, gzip level 9 over the chunks referenced by the prerendered HTML): `/` and the six placeholders first-load = **188.0 KB gz** across 10 chunks (largest 73.0 · 47.6 · 39.4 KB — the React/Next runtime); `/_not-found` = 180.1 KB gz; the lazy Supabase chunk = **64.4 KB gz / 245.9 KB raw**, fetched after hydration. Delta vs the first build: **−135 KB gz first-load**.
5. Going forward, the CI `build-output.txt` artifact of this merge is the `main` baseline; a PR that grows any route's first-load JS by more than 20 KB gz writes the `## Bundle` line (00 §1.3) and, if a new client dependency exceeds 50 KB gz, its own INV-80 ADR.

## Alternatives considered
| Alternative | Why not |
|---|---|
| Keep the static import (chunk in first-load JS) | 137 KB gz on every ISR page for a provider that only flips a `loading → anon` flag for most visitors; fails INV-80's intent. |
| Drop the client seam and render session state server-side | Would make every public page dynamic — contradicts 01 INV-38/39 and ADR-0002 C1 (ISR + client seam). |
| Replace `@supabase/supabase-js` with a hand-rolled GoTrue cookie reader | Re-implements session refresh and PKCE handling that `@supabase/ssr` owns; fragile, and S1.1/S1.4 need the real client anyway. |
| Keep zod in `lib/env/public.ts` | Costs ~10 KB gz on every page to validate four strings. |

## Consequences
- Positive: first-load JS −135 KB gz on every public route; the Supabase client still initialises within the first idle moments after hydration; zod never ships to the browser.
- Negative: `status` stays `'loading'` for one extra chunk fetch after hydration (leaves render the signed-out shape meanwhile — already the C-17a rule); a failed chunk load degrades to `'anon'`.
- Follow-ups: `frontend-reviewer` compares each PR's route table/first-load against the merged artifact → owner `web-quality`; S1.1 `GoogleSignInButton` and S1.4 `CommentThread` keep the client lazy → owner `web-quality`; re-measure LCP at S1.2 when the hero exists (`docs/questions.md`).

## Docs amended
| Doc | Section | Change |
|---|---|---|
| `docs/build/01-architecture.md` | §21 INV-80 row | appended "(the Supabase browser client chunk behind the ADR-0002 C1 seam is recorded by ADR-0008, which also makes it lazy)" (contains the string ADR-0008) |
| `docs/build/01-architecture.md` | `Status:` line | appended "— amended by ADR-0008 (2026-08-20)" (README ADR-R2) |
| `docs/build/06-decisions/README.md` | §7 Index | row for ADR-0008 |

## Gate impact
| Gate | Now checks |
|---|---|
| frontend-reviewer | `ViewerProvider` imports `@/lib/supabase/client` dynamically (no static import of the Supabase packages reaches a route's first-load chunk set); `lib/env/public.ts` imports no zod; first-load JS per route vs the `main` `build-output.txt` artifact (> 20 KB gz growth → `## Bundle` line) |
| spec-drift-reviewer | the C1/C-17a seam unchanged (session read after hydration, viewer shape verbatim); no new dependency in `package.json` |
| security-reviewer | the lazy chunk still goes through `lib/supabase/client.ts` only (01 INV-85) and holds only the anon key |
| design-fidelity-reviewer, backend-reviewer, supabase-reviewer, deploy-checker | none |
