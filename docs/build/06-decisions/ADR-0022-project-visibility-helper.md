# ADR-0022 — `project_is_visible()`: the §4 visibility predicate as one SQL helper

## Status
Accepted (2026-08-27 — S1.2 merge, v0.3)

## Date
2026-08-27

## Slice
S1.2

## Context
Kind: schema (security-relevant RLS shape — ADR-R7)
- Spec says: `docs/data-model.md` §4 — "projects / versions / files / links / overrides | all where `status='published'` and not `overrides.hidden`; admin sees all"; §2.11 lists no S1.2 SQL objects. The predicate spans two tables in both directions: a `projects` SELECT must consult `project_overrides.hidden` (05 T-RLS-18) while a `project_overrides` SELECT must consult `projects.status` (child-table inheritance).
- Found while writing migration `20260827090000_projects.sql`: plain cross-referencing RLS policies (`projects` policy sub-selecting `project_overrides` whose own policy sub-selects `projects`) raise SQLSTATE 42P17 (infinite recursion in policy evaluation). Postgres offers no way to express the §4 outline as two mutually-referencing invoker policies.
- Related: ADR-0020 (`is_reserved_handle` — the "one SQL copy of a rule, called from every enforcement point" precedent) · ADR-0002 #75 (RLS on every table) · supersedes none.

## Decision
1. New helper **`public.project_is_visible(p_project_id uuid) returns boolean`** — `security definer`, `language plpgsql`, `stable`, `set search_path = public`; body = exactly the §4 predicate: the project row exists with `status = 'published'` and `not coalesce(project_overrides.hidden, false)`. `revoke all … from public; grant execute … to anon, authenticated, service_role`.
2. Every S1.2 SELECT policy that needs the visibility rule calls the helper instead of inlining joins: `projects` (own-row visibility), `project_overrides`, `project_links` (by `project_id`), `project_versions` (by `project_id`), `project_files` (via its `project_versions` parent). Definer execution breaks the recursion: the helper reads both tables outside policy evaluation. Admin arms (`is_admin()`) and the service role are unchanged.
3. The view `projects_public` keeps its own inlined `WHERE` (a definer view needs no policy help); the helper is the policy-layer twin of the same rule — one predicate, stated twice by necessity, both verbatim from §4.
4. No app-code path calls the helper (it exists for policies); `lib/supabase/types.ts` carries it under `Functions` as generated.

## Alternatives considered
| Alternative | Why not |
|---|---|
| Inline cross-referencing policies | 42P17 infinite recursion — Postgres rejects the shape outright. |
| Duplicate the predicate per table without touching the other table (versions/files check only their parent's `status`) | Loses the `overrides.hidden` half on child tables — a hidden-by-override project's versions/files would stay anon-readable, violating §4 and AC9. |
| `security_barrier` views instead of table RLS | Data-model §4 mandates RLS policies per table (ADR-0002 #75); views don't satisfy T-RLS-16..43's table-level matrix. |
| Make `project_overrides` service/admin-read-only and denormalise `hidden` onto `projects` | Public pages read overrides (`notes_md`, `featured`) via the anon seam; a denormalised flag adds a write path the sync jobs must never touch (§3.1 "never touch `project_overrides`"). |

## Consequences
- Positive: one SQL statement of the visibility rule serves five tables' policies; no recursion; T-RLS-16..43 and AC9 (hidden never renders, admin sees all) hold, proven by the matrix tests.
- Negative: a `security definer` function in the policy path (definer objects need the hardening it has: pinned `search_path`, explicit grants); the predicate exists twice (helper + view WHERE) — a future change must edit both (comment in each migration points at the other).
- Follow-ups: none — later slices' tables with the same visibility need call the same helper.

## Docs amended
| Doc | Section | Change |
|---|---|---|
| `docs/data-model.md` | §2.11 object table | new `project_is_visible(uuid)` row (contains the string ADR-0022) |
| `docs/data-model.md` | §4 projects/versions/files/links/overrides row | the predicate is enforced via `project_is_visible()` (contains the string ADR-0022) |
| `docs/build/_registry.md` | SQL line | helper registered (contains the string ADR-0022) |
| `docs/build/00-build-plan.md` | §6 Changelog; `Status:` line | new row; Status appended (README ADR-R2) |
| `docs/build/06-decisions/README.md` | §7 Index | row for ADR-0022 |

## Gate impact
| Gate | Now checks |
|---|---|
| supabase-reviewer | `pg_get_functiondef('public.project_is_visible(uuid)')` = the §4 predicate, definer, `search_path = public`, grants anon/authenticated/service_role never PUBLIC; every S1.2 SELECT policy referencing visibility calls it; hiding a project via override removes it + versions/files/links from anon in one statement (T-RLS matrix green after `supabase db reset`) |
| security-reviewer | the helper reads only `projects` + `project_overrides`; no PII columns; policy behaviour matches AC9 |
| spec-drift-reviewer | data-model §2.11 / §4, `_registry.md` SQL line, 00 §6 carry ADR-0022; this ADR listed under `## ADRs in this PR` |
| backend-reviewer, frontend-reviewer, design-fidelity-reviewer, deploy-checker | none |
