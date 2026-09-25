# ADR-0046 — S1.8 follow-ups fix pass: the stored link on the preview card, the capped error-body read

## Status
Proposed

## Date
2026-09-25

## Slice
S1.8 (fix pass — branch `fix/S1.8-followups`, no tag per 00 §1.4; built before S1.7 — Skins + Art by David's decision of 2026-09-25)

## Context
Kind: deviation
- Spec says: `docs/build/03-components.md` §2.8 `MentionPreview` — "`preview` (card: thumb + title + `PlatformMark` + "Platform · creator" + views Silkscreen `--emerald` + date; ghost "Edit fields" → `manual`)" and "`url` = the preview's `canonical_url` when a page was read, else the pasted link"; `DESIGN.md` §12.2 — "paste URL → auto-fetched preview card (thumb, title, creator, views, date)"; `docs/build/04-server-contracts.md` §0 SC-09 — "final failure throws `AdapterError {status, code, body(≤300)}`" and, of `maxBytes`, "otherwise the body is streamed and cut at the DECODED byte cap" — said of a 2xx body only; `DESIGN.md` §5 — "Focus is a 3px `--gold` ring with 2px offset, always visible for keyboards".
- Found (the S1.8 Session B gates, 2026-09-25 — none blocking, recorded in `docs/questions.md` "S1.8 follow-ups"): **security** — for a non-YouTube page the preview keeps the page's own canonical address (`og:url`) and PUBLISH stores it, but the card shows title, creator, views and date and never the link, so a page could name another address than the one Oliver pasted and he would approve it unseen (the one advisory with a visitor cost); **backend #29** — `fetchPage` caps a successful page at 1 MB but a 4xx / 5xx body was buffered whole (`response.text()`) before the 300-character excerpt, bounded only by the 10 s budget; **frontend #13** — `components/projects/FilterBar.module.css` draws its own 2px `--line-soft` outline with a −2px offset, which wins over the global 3px gold `:focus-visible` ring on `/seen-on` and `/projects` (pre-existing since S1.2); **backend #34** — three boundary cases pinned adapter-only or not at all (exactly 50 / 51 ids per `videos.list`, a non-numeric `viewCount` end-to-end, a 429 + `Retry-After` inside the job).
- Related: `docs/questions.md` "S1.8 follow-ups (from the Session B gates …)" — the bullets marked for this pass; the "Someday, not this pass" bullet and the DESIGN.md questions stay queued. Supersedes nothing; refines ADR-0045 D5 (`fetchPage`) and D25 (`MentionPreview`).

## Decision
1. **The card shows the link that will be stored.** `MentionPreview` renders one clipped line — the word "Link", then the address — as TEXT (never an anchor: nothing on the card is clickable before it is approved), with `title` = the full address, in two places: on the fetched card after the meta row, and above the manual fields in the `manual` and `error` states (nothing in `empty`, nothing while the link field is blank). The address is `storedLink(url, preview)` (`components/seen-on/MentionPreview.draft.ts`): a fetched page → its `canonical_url` VERBATIM — the same string `buildCreateMentionInput` sends as `url` and `createMention` stores (the action canonicalised it already, ADR-0045 D9); no page read → the pasted link trimmed, WHATWG-normalised and upgraded from `http:` to `https:` (the rule the schema's `readMentionUrl` applies). On that by-hand path `createMention`'s `canonicalMentionUrl` may still drop `utm_*` / `si` / `feature` params or reduce a YouTube link to `https://www.youtube.com/watch?v=<id>` — a shorter address to the same page, never another page; the YouTube URL grammar is server-only (`lib/adapters/youtube.ts`, one source of truth — ADR-0045) and is NOT duplicated in the client.
2. **Look:** the card's existing meta recipe — `--mute-dim`, `--text-label-sm`, the word in 700 uppercase with `.06em` tracking, the address clipped with an ellipsis (`white-space: nowrap`), `--space-8` between them. No new token. The pass-3 artboard's card is kept as drawn plus this line; `DESIGN.md` §12.2's text ("thumb, title, creator, views, date") is not edited this pass — the line joins the "For DESIGN.md's next revision" list in `docs/questions.md`.
3. **The error body is read capped.** In `lib/adapters/http.ts`, when the caller set `maxBytes`, a non-2xx body is read to at most `min(maxBytes, EXCERPT_BYTES)` DECODED bytes (`EXCERPT_BYTES` = 1,200 = 4 × the 300-character cap — the longest UTF-8 excerpt) and the rest of the stream is cancelled; the text is then redacted (`redactSecrets`) and cut to 300 as before. It is never thrown over as `unsupported` — the status is the error, the body only illustrates it — so the SC-09 retry set is unchanged (a 500 still backs off and retries). A read that fails yields `''`, as the uncapped `.text().catch(() => '')` did. Without `maxBytes` (`fetchJson`, `fetchText`, a plain `fetchPage`) the error body is still read whole — 04 SC-09 is amended with this one clause.
4. **The filter buttons keep the gold ring.** `FilterBar.module.css` gains `.filter-bar-type:focus-visible` (and the `[aria-current='true']` variant, whose specificity would otherwise let the indigo `outline-color` win): `outline: 3px solid var(--gold); outline-offset: 2px` — DESIGN.md §5 as written, 03 C-25. At phone width the type row is a scroll box (`overflow-x: auto`) that would clip the ring, so it takes 5px of padding and a −5px margin — no change at rest. CSS only; no spec text changes beyond the T-E2E-10 leg.
5. **Tests — legs on existing ids, rows amended in place (05 ADR-R9):** T-E2E-39 — the link shown equals the stored `url` on both paths (fetched: `https://www.youtube.com/watch?v=seedvid0009`; by hand: `https://127.0.0.1:4010/x`), and the island holds no anchor; `tests/unit/mention-preview-render.test.tsx` pins the line on the YouTube and the non-YouTube card, above the manual fields, absent in `empty`, and that a `canonical_url` other than the pasted link is what the card prints; `tests/unit/mention-preview-draft.test.ts` pins `storedLink`; T-ADP-1 — a 5 MB 500 body under `maxBytes` pulls ONE chunk per attempt and cancels the rest, is retried as before, its excerpt is ≤ 300 chars and redacted first; the uncapped read is unchanged; T-ADP-13 — exactly 50 ids → one `videos.list` call and 1 unit, 51 → two (50 + 1) and 2; T-ACT-54 — a non-numeric `viewCount` (`"lots"`, `""`, `"-3"`) reaching `refreshMentions` end-to-end reads as hidden: the stored number is kept, nothing written, `ok=true`, no tags; a 429 + `Retry-After: 1` on one of three batches is retried by the SC-09 loop (the same 50 ids asked again), the run completes with every row written and `units` = 3; T-E2E-10 — a platform link (plain and `aria-current`) focused by keyboard shows the gold 3px ring at 2px offset and keeps its 2px `--line-soft` outline at rest.
6. **Scope guard:** no schema change (`supabase-reviewer` not needed — said in the PR body), no new env name, no tag. The production cron check (`vercel crons ls`, the newest `sync_runs` row for `mentions`) is a read-only verification recorded in `docs/questions.md`, not a decision.

## Alternatives considered
| Alternative | Why not |
|---|---|
| Show the stored link as a clickable anchor on the card | Opens an unreviewed third-party page from the admin form; the line exists so the address is approved, not visited (03 §2.8 — nothing on the card is interactive but "Edit fields") |
| Mirror `canonicalMentionUrl` in the client so the by-hand line is byte-exact | Duplicates the YouTube URL grammar (`videoIdFromUrl`, server-only — one source of truth, ADR-0045); the by-hand difference is only ever a shortening of the address the admin typed himself |
| Return the canonical form from a failed `fetchMentionPreview` | The `ActionError` shape carries no data (04 §1.6); a second action for one URL rule is more than the case warrants |
| Discard the error body entirely under `maxBytes` | Loses the excerpt operators read in `sync_runs.error` and the logs; 1,200 bytes costs nothing |
| Read the error body through `readCapped` | It throws `unsupported` on overflow, which would turn a retryable 500 into an unretried `unsupported` |
| Drop `FilterBar`'s own outline and rely on the global ring | Changes the rest look (DESIGN.md §5 filter bar: 2px `--line-soft`) for a focus-only problem |
| Queue everything with the S1.5c / S1.5b / S1.6 follow-ups | David's decision (2026-09-25): the one advisory with a visitor cost is cleared before Skins + Art |

## Consequences
- Positive: Oliver sees the exact address a visitor will get before he presses PUBLISH, even when a page's `og:url` differs from what he pasted; an error page cannot hold the 10 s budget with a large body; keyboard users see the ring on the filter buttons of `/seen-on` and `/projects`.
- Negative: one more line on the card (about 17 px); on the by-hand path the line can differ from the stored row by a shortening (tracking params, the YouTube `watch?v=` form).
- Follow-ups: DESIGN.md §12.2 next revision — the link line on the preview card → `docs/questions.md` "For DESIGN.md's next revision"; the "Someday, not this pass" bullet is unchanged (the consolidated pass after S1.7).

## Docs amended
| Doc | Section | Change |
|---|---|---|
| `docs/build/03-components.md` | §2.8 `MentionPreview` row (states, pure half, tokens, tests cells); Status line | the link line in `preview` and above the manual fields, `storedLink`, text only; `--mute-dim` in the tokens cell; the T-E2E-39 leg (D1, D2, D5 — contains ADR-0046) |
| `docs/build/04-server-contracts.md` | §0 SC-09; Status line | the non-2xx read under `maxBytes` (D3 — contains ADR-0046) |
| `docs/build/05-test-plan.md` | §7 T-ADP-1, T-ADP-13, T-ACT-54, T-E2E-10, T-E2E-39; §12 Review notes; Status line | the D5 legs (contains ADR-0046) |
| `docs/build/06-decisions/README.md` | §7 Index | new ADR-0046 row |
| `docs/questions.md` | "S1.8 follow-ups" (bullets ticked with the PR number), a "S1.8 follow-ups fix pass MERGED" entry, "For DESIGN.md's next revision" += the link line | the decisions in plain words; the cron check result |
| `docs/spec.md` | Revision log | one line (fix pass built, ADR-0046) |
| `docs/build/START-BUILD.md` | Current position | the fix pass merged; next S1.7 |

## Gate impact
| Gate | Now checks |
|---|---|
| spec-drift-reviewer | every row of the table above is a diff; 03 §2.8 names the link line and `storedLink`; 04 SC-09 carries the D3 clause; 05 §7 rows T-ADP-1 / 13, T-ACT-54, T-E2E-10 / 39 carry the D5 legs and §12 has the 2026-09-25 fix-pass entry; no DESIGN.md text change (D2 — the line is queued for its next revision); `scripts/check-test-ids.mjs` passes (no new id) |
| security-reviewer | the line is TEXT — no `<a>` in the island (`tests/unit/mention-preview-render.test.tsx`, T-E2E-39), nothing new rendered unescaped (React text node; `title` attribute); the shown string on the fetched path IS `canonical_url`, the string PUBLISH sends; `readExcerpt` bounds the read under `maxBytes` and the SSRF guard (ADR-0045 D6) is untouched; `redactSecrets` still runs before the 300-char cut |
| backend-reviewer | `readExcerpt` reads ≤ `min(maxBytes, 1200)` bytes and cancels the reader; the retry set, backoff and `Retry-After` handling are unchanged (`fetchJson` / `fetchText` read the error body whole as before); T-ADP-1 / T-ADP-13 / T-ACT-54 legs as in D5; `refreshMentions` itself is unchanged |
| frontend-reviewer | `.filter-bar-type:focus-visible` on `/seen-on` and `/projects` (plain and `aria-current`), the phone scroll box does not clip the ring; axe zero serious / critical on `/admin/mentions` with the line rendered (1280 + 390); the island list and first-load JS unchanged within noise |
| design-fidelity-reviewer | the line uses `--mute-dim` + `--text-label-sm` only (no new token), the card otherwise the pass-3 artboard; the focus ring = DESIGN.md §5 (3px `--gold`, 2px offset); the rest look of the filter buttons unchanged (2px `--line-soft`) |
| deploy-checker | no new env name, no cron change; `/seen-on` 200, `/admin/mentions` 200 (the ADMINS ONLY gate for a signed-out visitor), `/api/cron/refresh-mentions` 401 |
