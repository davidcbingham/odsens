# ADR-0024 — page-scoped `'use server'` glue on dynamic admin routes

## Status
Accepted (2026-08-27 — S1.2 merge, v0.3)

## Date
2026-08-27

## Slice
S1.2

## Context
Kind: architecture invariant amendment (01 INV-04 / 04 SC-01)
- Spec says: 01 INV-04 — Server Actions live in `lib/actions/<area>.ts`; check = `grep -rl "'use server'"` → **only** `lib/actions/*.ts`. 04 SC-01 states the same file list.
- Found at S1.2 gate review (spec-drift ❌ row 2): the admin curation pages declare five module-private page-scoped server functions — `reorderFeatured`/`curateAndRefresh` in `app/admin/projects/page.tsx` and `saveOverrides`/`saveLink`/`saveCommentsEnabled` in `app/admin/projects/[id]/page.tsx`. Each is Next's idiomatic form/callback-prop glue: it maps the component's callback shape (e.g. `ReorderableList.onReorder(ids)` — 03 §2.10) or a `FormData` post into the 04 §1.4/§1.7 input shape, calls exactly one `lib/actions` action, and optionally `redirect()`s for PRG. Every security-relevant property lives in the called action: `requireRole('admin')`, zod parse, rate limit, writes, audit line, `revalidateTag`.
- The alternative homes are worse: moving the glue into `lib/actions/*.ts` (a `'use server'` file) makes each glue function *look like* a contract action while violating SC-02 (no own zod schema) and SC-03 (returns `void`, not `ActionResult`) — trading one deviation for two; binding the actions directly is impossible where the component callback shape ≠ the action input shape without a new client island (worse under INV-08).
- Related: ADR-0013 (runAction shape) · ADR-0002 C7 (admin-only curation). Supersedes none.

## Decision
1. 01 INV-04 and 04 SC-01 gain a narrow exception: a **dynamic** (non-ISR) route file under `app/admin/**` MAY declare **module-private** (never exported) page-scoped `'use server'` glue functions, where each glue body is: input mapping + **exactly one call to one `lib/actions` export** + optionally `redirect()`/`revalidatePath`-free PRG via `redirect()`. Glue must contain no auth check, no zod parse, no DB client, no service-role import, no fetch — those live only in the called action (unchanged SC-02/03/04/06).
2. The INV-04 check becomes: `grep -rln "'use server'" --include=*.ts --include=*.tsx .` → `lib/actions/*.ts` ∪ `app/admin/**/page.tsx`; for each hit under `app/admin/**`, every `'use server'` function is unexported and its body calls exactly one `lib/actions` import.
3. The mutation surface the gates diff stays `lib/actions` + the registry "Actions" list: glue adds no new endpoint semantics (a client invoking glue reaches the same guarded action; malformed glue input fails the action's zod parse).
4. This exception is admin-surface only. Public route files still may not carry `'use server'`; a public-page need for it is a stop-and-ask.

## Alternatives considered
| Alternative | Why not |
|---|---|
| Move glue into `lib/actions/projects.ts` | The file's `'use server'` marks every export an action: glue would violate SC-02 (no `<name>Input` schema) and SC-03 (`void` return, PRG throw) — two new deviations to fix one. |
| Bind `lib/actions` exports directly as props | Callback shapes differ from action input shapes (`onReorder(ids)` vs the §1.4 batch); adapting client-side needs new client islands (INV-08 cost) and moves mapping into the browser. |
| A separate `lib/actions/glue.ts` non-contract file | Still a new `'use server'` file outside the SC-01 list — same amendment size with the glue now far from the only pages that use it. |

## Consequences
- Positive: the Next-idiomatic PRG/callback pattern is legal where it is actually used; auth/validation/writes remain greppable in `lib/actions/*`; the INV-04 grep stays a yes/no check.
- Negative: two grep targets instead of one; reviewers must verify the "exactly one action call, nothing else" property per glue function (spec-drift + security both list it now).
- Follow-ups: none — S1.4+ admin pages reuse the same pattern under the same rule.

## Docs amended
| Doc | Section | Change |
|---|---|---|
| `docs/build/01-architecture.md` | INV-04 row; `Status:` line | exception + check amendment (contains the string ADR-0024); Status appended |
| `docs/build/04-server-contracts.md` | SC-01; `Status:` line | same exception sentence (contains the string ADR-0024); Status appended |
| `docs/build/00-build-plan.md` | §6 Changelog; `Status:` line | new row; Status appended |
| `docs/build/06-decisions/README.md` | §7 Index | row for ADR-0024 |

## Gate impact
| Gate | Now checks |
|---|---|
| spec-drift-reviewer | amended INV-04 grep (two-set target); per-glue: unexported, one `lib/actions` call, no auth/zod/DB/fetch in body |
| security-reviewer | glue bodies contain no privilege logic; the called action's `requireRole` is the gate |
| backend-reviewer, frontend-reviewer, design-fidelity-reviewer, supabase-reviewer, deploy-checker | none |
