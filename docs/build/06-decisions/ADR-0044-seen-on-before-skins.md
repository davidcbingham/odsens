# ADR-0044 — Build order: S1.8 Seen on before S1.7 Skins + Art

## Status
Proposed

## Date
2026-09-19

## Slice
cross-cutting (S1.7, S1.8)

## Context
Kind: deviation
- Spec says: `docs/build/00-build-plan.md` §1 tag table — "| S1.7 | `v0.8` |", "| S1.8 | `v0.9` |"; §2 orders the remaining v1 work S1.7 — Skins + Art → S1.8 — Seen on → S1.9 — Stats → S1.10 — Launch; `docs/build/START-BUILD.md` current position (after the S1.6 close-out) — "**Next: S1.7 — Skins + Art**".
- Found: David changed the priority on 2026-09-19, the day S1.6 — Videos merged (`v0.7`): "Seen on" is to be built before "Skins + Art". Nothing technical stands in the way — S1.8 "Depends on: S1.2, S1.6" (both merged) and uses no S1.7 deliverable: `StatTile`, `Select`, `FilterBar` and `PlatformMark` (Modrinth / CurseForge / YouTube) exist since S1.2, `VideoFacade variant="mention"` since S1.6, and the YouTube `oembed` / `videoIdFromUrl` adapter surface with T-ADP-14 / 15 was built early in S1.6 (ADR-0043 D17). S1.7 "Depends on: S1.1, S1.3" and uses no S1.8 deliverable.
- Related: `docs/questions.md` "Build order: Seen on before Skins + Art (2026-09-19)"; precedent ADR-0036 (slices inserted, order changed) and ADR-0039 D1 (a tag moved; the 00 §1 tag table and §2 section order are the build order).

## Decision
1. **S1.8 — Seen on is built next, before S1.7 — Skins + Art.** Remaining v1 order: S1.8 → S1.7 → S1.9 → S1.10.
2. **Tags follow build order:** S1.8 — Seen on is tagged `v0.8`; S1.7 — Skins + Art is tagged `v0.9`. S1.9 `v0.10` and S1.10 `v1.0.0` are unchanged.
3. **Slice numbers do not move** (06 README N1's spirit; ADR-0039 D1): every `S1.7.*` / `S1.8.*` AC id, every "row S1.7" / "row S1.8" in 02 §8 and 05 §8, the `_registry.md` slice keys and every test id keep their numbers. Those tables are keyed by slice, not by order, and are not re-sorted — only 00 §1 (tag table, gate matrix), 00 §2 (section order) and 00 §4 (tables / sections rows), plus the `_registry.md` slice table, show build order.
4. **No scope, acceptance criterion, test, dependency or gate focus changes in either slice.** Two sentences are read with the new order in mind and stay as written: S1.8.AC9 "on every page from this slice on" (the footer's second line now appears one slice earlier than Skins + Art), and 02 §7's "SM-05–09 … gain their content checks in S1.6/S1.7/S1.8/S1.9" (each check arrives with its own slice).
5. **`scripts/check-test-ids.mjs` `SHIPPED_SLICES`** gains `S1.8` when Seen on ships and `S1.7` after it — the list is a set of shipped slices, not a sequence, so no script change is needed now.

## Alternatives considered
| Alternative | Why not |
|---|---|
| Renumber the slices (Seen on becomes S1.7) | Every AC id, test-plan row, registry key and ADR reference would change for no gain; ADR-0039 already settled that numbers record plan order and tags / section order record build order. |
| Keep the tags (`v0.9` ships before `v0.8`) | Tags are how a rollback target is found; out-of-order versions on `main` would mislead `ship` / `vercel-ops`. |
| Build both in parallel | One builder, one staging database, and both slices add migrations — serial stays the rule (00 §1). |

## Consequences
- Positive: Oliver can start curating coverage of his mods one slice earlier; the YouTube plumbing from S1.6 (adapter, facade, quota budget, the corrected channel id) is fresh when the mentions refresh job is built on it.
- Negative: skins and art — content with no other home — wait one slice longer; the Skins and Art nav items stay placeholder pages (00-O-8) through `v0.8`.
- Follow-ups: the S1.7 Session-A prompt written at the S1.6 close-out is void — a Seen on prompt replaces it → owner `build-phase`. The "S1.6 follow-ups" item about checking a channel's name before writing applies equally to `refreshMentions`' use of the Data API → owner `backend-robustness`, considered in S1.8 Session A.

## Docs amended
| Doc | Section | Change |
|---|---|---|
| `docs/build/00-build-plan.md` | §1 tag table; §1 gate matrix; §2 section order + a dated note under the S1.8 and S1.7 headings; §4.2 tables rows; §4 sections / nav rows; §6 changelog; Status | S1.8 `v0.8` listed before S1.7 `v0.9`; the S1.8 section sits before S1.7 (contains ADR-0044) |
| `docs/build/_registry.md` | Slice table | S1.8 row before S1.7 row, each with its tag and ADR-0044 |
| `docs/build/START-BUILD.md` | Current position | "Next: S1.8 — Seen on (`v0.8`), then S1.7 — Skins + Art (`v0.9`) — ADR-0044" |
| `docs/build/06-decisions/README.md` | §7 Index | new ADR-0044 row |
| `docs/spec.md` | Revision log | one line |
| `docs/questions.md` | new dated entry | the decision and who made it |

## Gate impact
| Gate | Now checks |
|---|---|
| spec-drift-reviewer | S1.8's PR is tagged `v0.8` and S1.7's `v0.9`; neither PR is failed for being "out of order"; slice-keyed ids unchanged |
| deploy-checker | none beyond the tag names |
