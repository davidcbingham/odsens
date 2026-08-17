---
name: design-fidelity
description: Front-end fidelity specialist for odsens.com — verifies built UI matches DESIGN.md (tokens, type, spacing, edges, components, states, voice) and the Claude Design prototypes in design/claude-design-export/pass-*/, with computed contrast checks and desktop+phone screenshots. Use when building or changing any visible UI; called by build-phase, new-feature, and restyle.
---

# design-fidelity

## Sources
`DESIGN.md` v1.3a (law; §12.7 = build clarifications from ADR-0002) · `design/claude-design-export/pass-3/*.dc.html` (reference renderings — open in a browser) · `styles/tokens.css` (must mirror DESIGN.md §1 verbatim).

## Method
1. **Tokens first**: every colour/space/radius/shadow in CSS is a `var(--…)` from `tokens.css`; grep for raw hex/px shadows outside `tokens.css` → ❌.
2. **Component parity**: for each DESIGN.md §5/§11 component used, compare states (hover/active/disabled/focus/selected/error/held/etc.) against the spec text; missing state → ❌.
3. **Rules of the look**: radius 0 (3px only inputs/chips) · 2px lines drawn as `outline` on cards · offset block shadows only, no blur/gradient/glow · hatch only on indigo/gold slabs · type roles and minimums (Bungee ≥16 titles, 12–15 labels only; Silkscreen ≥10, ≥11 informational; body ≥16) · 44px targets · 3px gold focus ring.
4. **Contrast**: run `scripts/contrast.mjs` (WCAG calc) on any new pair; text ≥4.5, UI ≥3.
5. **Screenshots**: Playwright at 1280 and 390 for the touched pages, light on: dark theme; attach before/after to the PR; compare against the matching prototype section.
6. **Voice**: copy follows §7 (no emoji, hype, vlogger openers; "Download" not "Get"; handles only).
7. **Motion & a11y**: 120–180ms ease-out; `prefers-reduced-motion` respected; headings in order; alt text present; keyboard path works.

## Output
Checklist table (✅/❌ with file:line) + screenshots in PR. Any deliberate deviation from DESIGN.md requires a DESIGN.md edit + changelog line in the same PR.

## Boundaries & hand-offs (see `docs/skill-handoffs.md`)
- **Owns:** verification of built UI vs `DESIGN.md`/prototypes. **Does not own:** building features, backend, inventing design rules.
- **Return path:** checklist + screenshots to the caller; ❌ with file:line and the token/rule to use.
- **Hand off:** deliberate deviation → caller edits `DESIGN.md` + `keep-docs` in the same PR · missing component in DESIGN.md → **stop, ask** (may need a Claude Design pass; see `docs/design-process.md`).
