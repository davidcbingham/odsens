# ADR-0032 — The crown alone is the site mark; the full character is Oliver's account picture

## Status
Proposed

## Date
2026-09-06

## Slice
cross-cutting (brand asset; first shows in S1.5's branch)

## Context
Kind: design
- Spec says: `DESIGN.md` §10 Assets — "`assets/brand/avatar/oddsense-avatar-5000.png` — OddSense avatar (5000×5000 PNG). Source of the palette. Used at 40px in nav, 56px in the home intro strip, and full-size in the Art gallery."
- Found: Oliver asked for the **crown alone** as the website's logo rather than his personal OddSense avatar — the crown stands for the site, the full character stands for him. David replaced the 5000×5000 source with crown-only art on 2026-09-06 and regenerated the 80/112/160 derivatives (commit `74b508a`).
- Related: `DESIGN.md` §2 also samples the palette from that file ("navy-black ground, indigo-violet armour, two crown golds, emerald crown gems, white outline") — wording that no longer describes the file's contents, though the tokens themselves are unchanged.

## Decision
1. **The crown alone is the odsens site mark.** `assets/brand/avatar/oddsense-avatar-5000.png` and the `public/brand/avatar-{80,112,160}.png` derivatives hold the crown.
2. **The full OddSense character is Oliver's personal account picture** — it belongs to his account on the site, not to the repo's brand assets. It is not a site logo and no page composes it from `public/brand/`.
3. The palette in `DESIGN.md` §2 is **unchanged**. Its tokens were sampled from the original character art; the file named there now holds only the crown, so §2 and §10 say so rather than implying the golds and gems can be re-read off the current file.
4. **Open, not decided here:** all three repo usages of `/brand/avatar-80.png` — nav (`components/layout/Nav.tsx`), the home intro strip (`app/(public)/page.tsx`) and `components/projects/FeaturedHero.tsx` — read the one file, so all three now render the crown. The nav is right by decision 1. The two intro strips sit beside "OddSense makes things for Minecraft" with `alt="OddSense"`, which is person-context (`DESIGN.md` §6.1). Whether they keep the character (a second asset + a code change) or take the crown is David's call — see the follow-up.

## Alternatives considered
| Alternative | Why not |
|---|---|
| Keep the full character as the site mark | Oliver asked for the opposite: the crown is the website, the character is him. |
| Ship a second `oddsense-character-5000.png` now and repoint the two intro strips | Presumes the answer to decision 4. Costs an asset + code change before David has said which reading he wants. |
| Leave `DESIGN.md` untouched and treat this as art-only | §2 and §10 describe the file's contents by name; both become untrue. `DESIGN.md` is frozen (00 §1.5 F-4), so the rule change travels with an ADR. |

## Consequences
- Positive: the site's mark is legible at 40px in the nav, where the full character's face and shoulders were losing detail; the person/brand split matches the `OddSense` vs `odsens` distinction `DESIGN.md` already draws at the top.
- Negative: the crown art carries no white sticker outline and no dark ground, so it leans on the `Avatar` component's own 3px white border for edge definition; the palette can no longer be re-sampled from the named file.
- Follow-ups: decision 4 (the two intro strips) → David, then `design-fidelity` if the character comes back as a second asset · the crown mark has not been checked at 40px against `DESIGN.md` §4 edge rules on a `--slab` nav → owner `design-fidelity`.

## Docs amended
| Doc | Section | Change |
|---|---|---|
| `DESIGN.md` | header changelog (v1.6) | one line naming this change (contains the string ADR-0032) |
| `DESIGN.md` | §2 Palette | the palette sentence says the tokens were sampled from the original character art; the named file now holds the crown (contains the string ADR-0032) |
| `DESIGN.md` | §10 Assets | the asset line describes the crown mark and names the person/brand split (contains the string ADR-0032) |

## Gate impact
| Gate | Now checks |
|---|---|
| spec-drift-reviewer | `DESIGN.md` §2 / §10 describe the crown mark, not the character; the header carries the v1.6 line |
| design-fidelity-reviewer | the nav / intro-strip avatar renders the crown; flags any page still expecting the character until decision 4 closes |
