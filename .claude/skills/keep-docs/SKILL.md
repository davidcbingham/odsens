---
name: keep-docs
description: Keeps the odsens.com docs true after a decision or change — spec, open questions, DESIGN.md changelog, data model, the frozen engineering specs (through an ADR), and the ADR index. Use when Oliver or another skill says "we decided", "change the spec", "update the docs", "write that down", or after any feature, design, or schema change lands.
---

# keep-docs — the docs closer

The last step of every change that touched a decision, a rule, or a scope. Makes the smallest edit that makes the docs true again. Never decides anything itself.
Talk to Oliver like a smart 15-year-old who builds mods: name a thing once, then use it.

## When to use
- "We decided …", "change the spec", "the docs are wrong", "write that down".
- Called by `build-phase`, `new-feature`, `restyle`, `db-change`, `upkeep`, or `ship` (after merge) with a hand-off note saying what changed.
- An ADR needs filing, indexing, or flipping from `Proposed` to `Accepted`.

## Inputs it needs
- What changed, in one line, and who decided it (Oliver, David, a PR, a `Q<nn>` in `docs/questions.md`).
- Which kind of thing it is: product (what the site does) · engineering (how it's built) · design (how it looks) · data (what's stored) · notifications.
- The branch / PR the edit belongs in — doc edits ride in the same PR as the change, never a separate "fix docs later".

## Steps
1. **Find the home** (one edit, one place, then cross-reference):
   | Kind | Lives in |
   |---|---|
   | Product behaviour, scope | `docs/spec.md` (+ a *Revision log* line) |
   | Question asked / answered | `docs/questions.md` (numbered list; strike with the date) |
   | Visual rule, token, component, voice | `DESIGN.md` (+ header changelog line) |
   | Schema, RLS, storage | `docs/data-model.md` |
   | Notification kinds / matrix | `docs/notifications.md` |
   | Engineering contract | `docs/build/00–05` + `docs/build/_registry.md` (names / IDs) |
   | Engineering decision log | `docs/build/06-decisions/ADR-<nnnn>-<slug>.md` + `README.md` §7 index |
2. **Frozen-set check.** `00–05`, `_registry.md`, `DESIGN.md`, `docs/data-model.md`, `docs/notifications.md` are frozen (00 §1.5 F-4). Anything that contradicts them changes ONLY through an ADR **and** the doc edit, in the same PR (06 README R1). A prose clarification that changes no rule needs no ADR (F-2) — add one dated line to that doc's changelog / review-notes section instead.
3. **ADR mechanics** (`docs/build/06-decisions/README.md`; do them in this order):
   - Number: highest `ADR-<nnnn>` in the folder on `main` + 1 (N3) — `git ls-tree --name-only origin/main docs/build/06-decisions/ | sort | tail -1`. Never reuse or renumber (N1).
   - File: copy `ADR-TEMPLATE.md` → `ADR-<nnnn>-<slug>.md` (slug kebab-case, ≤6 words, subject not outcome — N2). First line `# ADR-<nnnn> — <Title>` (N5). Keep every H2 in order; `Kind:` from the closed list; `Status` = `Proposed`.
   - Doc edit: the amended doc carries the literal string `ADR-<nnnn>` at the changed row / cell / paragraph (R2).
   - Also per doc (R2): `DESIGN.md` gets a header changelog line `> v1.x (YYYY-MM-DD): … ADR-<nnnn>` · `docs/spec.md` gets a *Revision log* line · each of `00–05` touched gets its `Status:` line appended with `— amended by ADR-<nnnn> (YYYY-MM-DD)` · `docs/data-model.md` / `docs/notifications.md` need only the string at the location.
   - Index: add the row to `06-decisions/README.md` §7 in the same PR (N4).
   - PR body: under `## ADRs in this PR` (that exact heading) write `ADR-<nnnn>-<slug>.md (amends: <doc §>)`, or the single word `none` (R11).
   - Merge: flip `Proposed` → `Accepted` (file + §7 index row) in the same PR before it merges — nothing on `main` stays `Proposed` (L1). `ship` calls this skill for that flip.
   - Changing an Accepted decision = a NEW ADR that supersedes it; the old one's Status becomes `Superseded by ADR-<nnnn>` and the docs are re-amended (L2 / L3).
4. **Smallest true edit.** Change the sentence, not the section. Registry names verbatim. A new route / component / action / table / test ID goes into `_registry.md` first, then gets used (00 CC-5).
5. **Questions.** Answered: `~~**Title**~~ — **Answered YYYY-MM-DD:** <one line>`. New: next number, dated. Setup to-dos: tick `[x]` and say what was done.
6. **Revision log.** One dated line at the TOP of the `docs/spec.md` *Revision log*, same style as the existing lines.
7. **Design changelog.** If a `DESIGN.md` rule changed: bump the header version and add the changelog line with the ADR number (R8). Applying existing §7 voice to new copy needs nothing.
8. **Read it back.** `git diff -- docs DESIGN.md` — every row in an ADR's *Docs amended* table is a real hunk; `grep -rn "ADR-<nnnn>" docs DESIGN.md` hits every named location.
9. **Breadcrumb:** what I did / where it is (files + PR) / how to undo (`git checkout -- <file>` before commit, `git revert` after).

## Guardrails
- Never decide. Two docs disagree, or a doc disagrees with what someone says happened → stop and ask David; park it as a dated line in `docs/questions.md` if the answer will take a while.
- Never edit an Accepted ADR's *Decision* (status line, typo fixes, a "See also" line only — L2). Write a superseding ADR instead.
- Never delete an ADR (L4), never renumber one, never reuse a number (N1).
- No product decisions inside an ADR — those go to `docs/questions.md` / `docs/spec.md`; the ADR records the engineering consequence and names the `Q<nn>` (R12).
- No secrets, no PII, no real names — handles only, everywhere.
- Don't rewrite prose for style. Docs are reference, not essays.

## Done looks like
Every doc a reader would check says the same thing as the code and the PR: the edited section, the ADR (if any) with its index row and `Accepted` status once merged, the `Status:` lines, the spec revision log, the questions list — all in the same PR. `spec-drift-reviewer`'s `Docs amended:` footer matches the ADR's *Docs amended* table.

## Hand-offs
- None outbound except **ask David** (contradiction, missing decision).
- Returns to the calling skill with the list of files edited and the ADR id (if any).

## Boundaries & hand-offs (see `docs/skill-handoffs.md`)
- **Owns:** edits to `docs/spec.md`, `docs/questions.md`, the `DESIGN.md` changelog, `docs/data-model.md`, `docs/notifications.md`, `docs/build/00–05` + `_registry.md` (through an ADR), `docs/build/06-decisions/*` (filing, indexing, status flips). **Does not own:** code, design decisions, merges, anything that decides what the site does.
- **Hand off:** nothing outbound — return to the caller (`build-phase`, `new-feature`, `restyle`, `db-change`, `upkeep`, `ship`).
- **Stop & ask:** a contradiction between docs; a decision nobody made; a change to what the site stores about people; deleting or renumbering an ADR.
- **Return path:** the caller gets the file list + ADR id and pastes them into the PR body under `## Docs updated` / `## ADRs in this PR`.
- Always write the hand-off note (format in `docs/skill-handoffs.md` §2).
