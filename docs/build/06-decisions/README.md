# Architecture Decision Records
Purpose: the log of engineering decisions taken during the build that add to, or deviate from, the frozen engineering specs (`docs/build/00–05`, `_registry.md`), `DESIGN.md`, `docs/data-model.md`, and `docs/notifications.md` — so the specs and the code never disagree silently.
Status: v1.0 (2026-08-17)

## 1. What this folder is
| Item | Value |
|---|---|
| Location | `docs/build/06-decisions/` |
| Files | `README.md` (this), `ADR-TEMPLATE.md`, `ADR-<nnnn>-<slug>.md` (one per decision) |
| Baseline | `ADR-0001-engineering-spec-baseline.md` — declares `docs/build/00–05` + `_registry.md` the engineering baseline and lists the pre-build decisions (D1–D24) with their source pointers |
| Enforced by | `.claude/agents/spec-drift-reviewer.md` step 8 (every PR); required by `docs/build/00-build-plan.md` §1.6 CC-1–CC-7 and DoD-8, `docs/build/01-architecture.md` INV-95, `docs/build/03-components.md` C-15 / C-23, `.claude/skills/build-phase/SKILL.md` step 2b, `CLAUDE.md` |
| Owner of edits | the skill that owns the PR (`build-phase`, `new-feature`, `restyle`, `db-change` …); `keep-docs` closes the doc amendments; gate agents never write ADRs |
| Sibling docs (the contract an ADR may amend) | `00-build-plan.md`, `01-architecture.md`, `02-routes-and-pages.md`, `03-components.md`, `04-server-contracts.md`, `05-test-plan.md`, `_registry.md`, `/DESIGN.md`, `docs/data-model.md`, `docs/notifications.md` (= the F-4 frozen set, 00 §1.5) |

An ADR is **not** the place for product decisions (what the site does). Those go to `docs/questions.md` / `docs/spec.md` via `keep-docs` (see `docs/skill-handoffs.md` §1 rule 6). An ADR records the *engineering* consequence when such a decision changes 00–05/DESIGN.md/data-model, and always points at the product-doc entry.

## 2. When an ADR is required (rules)
Each rule has a yes/no answer for a given PR diff.

| # | Rule |
|---|---|
| ADR-R1 | Any change in a PR that contradicts a statement in `00-build-plan.md`, `01-architecture.md`, `02-routes-and-pages.md`, `03-components.md`, `04-server-contracts.md`, `05-test-plan.md`, `_registry.md` (renames), `DESIGN.md`, `docs/data-model.md`, or `docs/notifications.md` MUST be accompanied, **in the same PR**, by (a) a new ADR file and (b) the amendment of the contradicted doc. This is the F-4 frozen set of 00 §1.5 and equals 00 CC-1; the shorter lists in 00 DoD-8, 01 INV-95 and `build-phase` step 2b are subsets of it and mean the same set (alignment at freeze: OPEN-5). |
| ADR-R2 | The amended doc MUST contain the literal string `ADR-<nnnn>` at the changed location (the table row / rule cell / paragraph that changed). Additionally: `DESIGN.md` gets a header changelog line (`> v1.x (date): … ADR-<nnnn>`); `docs/spec.md` gets a *Revision log* line; each of 00–05 gets its `Status:` line appended with `— amended by ADR-<nnnn> (YYYY-MM-DD)`; `docs/data-model.md` / `docs/notifications.md` need only the string at the changed location. |
| ADR-R3 | Removing, weakening, or moving an acceptance criterion (`<slice>.AC<n>`) listed in `00-build-plan.md` requires an ADR (`Kind: deferral`) **and** the `00-build-plan.md` edit in the same PR (00 CC-7). Noticing but not building an item that belongs to a later slice needs no ADR — it is listed under the PR body `## Deferred / out of slice` section (00 §1.3; `spec-drift-reviewer` step 1 accepts that note only for such items, never for a removed AC). |
| ADR-R4 | Adding a new registry ID (route, component, action, table, event kind, test, invariant) that a spec doc introduced under its "Registry additions" section does **not** need an ADR — it needs the `_registry.md` edit (registry rule: add first, then use). Renaming or repurposing an existing registry name **does** need an ADR. |
| ADR-R5 | Adding any package to `package.json` `dependencies` or `devDependencies` that is not listed in `01-architecture.md` INV-78 needs an ADR (`Kind: dependency`) **before** `pnpm add`; a client-side dependency > 50 KB gzipped additionally states the route-level bundle delta from `pnpm build` in *Decision* (INV-80; `web-quality` stop-and-ask threshold). Patch/minor bumps of listed packages need no ADR (R9). |
| ADR-R6 | Changing a number that a spec states as a rule (ISR `revalidate` 600, comment 1000 chars / 1 link / 15-min edit / auto-hold ≥3 reports, cron cadences, storage limits per `docs/data-model.md` §3, notify retry max 5 / digest >5, handle 3–20 chars) needs an ADR. |
| ADR-R7 | Changing a security-relevant rule (RLS shape, service-role usage, upload allowlist, download route behaviour, CSP/headers, rate limits, what is stored about people) needs an ADR **and** a `security-reviewer` gate on the PR; anything that changes what the site stores about people is also on the stop-and-ask list (`docs/skill-handoffs.md` §5) — human confirms before merge. |
| ADR-R8 | A colour, token, component, or state that is not in `DESIGN.md` needs a `DESIGN.md` edit + header changelog line **and** an ADR (`Kind: design`) in the same PR (00 CC-6, 01 INV-95, 03 C-23). Any change to an existing `DESIGN.md` rule — including §7 voice rules — is likewise `DESIGN.md` edit + changelog line **and** an ADR (`Kind: design`). Applying existing §7 voice to new copy strings needs neither. |
| ADR-R9 | Bug fixes that bring code into line with the spec, test additions, refactors that preserve every contract in 04, dependency patch/minor bumps of INV-78 packages, copy edits, and content changes need **no** ADR. |
| ADR-R10 | One ADR per decision. A PR may carry several ADRs. An ADR never spans two unrelated decisions. |
| ADR-R11 | The PR body lists its ADRs under the mandatory `## ADRs in this PR` section of the `00-build-plan.md` §1.3 PR template — either the single word `none` or one line per ADR in the form `ADR-<nnnn>-<slug>.md (amends: <doc §>)`. `spec-drift-reviewer` prints the same list in its verdict footer (`ADRs in PR:` / `Docs amended:`). No other heading (`ADRs:` etc.) counts. |
| ADR-R12 | An ADR that changes a decision recorded in `docs/questions.md` or `docs/spec.md` names the question number (`Q<nn>`) in *Context* and the PR also updates that doc (`keep-docs`). |
| ADR-R13 | No ADR is written retroactively for a merged deviation without a PR that also amends the doc — a late ADR still satisfies R1 only together with the doc amendment. |
| ADR-R14 | Items marked OPEN with a proposed default in `00-build-plan.md` §5, `01-architecture.md` §29, `02-routes-and-pages.md` §9, `03-components.md` §7 / §11, `04-server-contracts.md` §10, `05-test-plan.md` §11 are binding statements for R1 in the form "use the proposed default": building the default needs no ADR (00 rule 0.8); diverging from it needs an ADR (`Kind: deviation`) that names the `O-<n>` / `OPEN-<n>` id in *Context* and rewrites or closes that row in the same PR. Closing an OPEN by adopting the default is a doc edit (Status → DECIDED) without an ADR — unless the sibling doc itself says the decision is to be recorded as an ADR (e.g. 03 §7 O-1, 01 §29 O-2), in which case that ADR is `Kind: addition`. |

## 3. Numbering
| # | Rule |
|---|---|
| ADR-N1 | IDs are `ADR-<nnnn>`, four digits, zero-padded, sequential from `ADR-0001`; never reused, never re-numbered after merge. `ADR-0001` is the baseline ADR; no other doc may pre-assign a number to a future ADR (see OPEN-3 for the pre-assignments that already exist in 00/01/03/04). |
| ADR-N2 | Filename = `ADR-<nnnn>-<slug>.md`; slug is kebab-case, lowercase, ≤ 6 words, states the subject not the outcome (`…-shorts-detection.md`, not `…-use-duration.md`). |
| ADR-N3 | The next number = highest existing number in the folder on `main` + 1, taken at PR open. If two open PRs claim the same number, the PR that merges second renumbers before merge (rebase-time conflict is the signal). Slugs may be reserved by 00–05 (e.g. `branching-preview-env`, `shorts-detection`); numbers never are — `_registry.md`'s `ADR-0003-shorts-detection.md` is an example of the filename format only. |
| ADR-N4 | The index table in §7 of this README is updated in the same PR that adds or changes an ADR's status. |
| ADR-N5 | The first line of every ADR is `# ADR-<nnnn> — <Title>` where `<nnnn>` matches the filename. |

## 4. Lifecycle
| Status (exact string) | Meaning | Allowed transition |
|---|---|---|
| `Proposed` | Written in an open PR; decision under review; may still change | → `Accepted` when the PR merges; PR closed unmerged → file is deleted (never merged as `Proposed`) |
| `Accepted` | Merged to `main`; binding on code and gates | → `Superseded by ADR-<nnnn>` when a later ADR replaces it |
| `Superseded by ADR-<nnnn>` | No longer binding; kept for history; the superseding ADR's *Context* names it | terminal |

Rules:
| # | Rule |
|---|---|
| ADR-L1 | Nothing on `main` is `Proposed`. Merge flips it to `Accepted` (the merging PR edits the line, or `keep-docs` does it in the same PR before merge). |
| ADR-L2 | An accepted ADR is never edited except: status line (superseding), typo fixes, and adding a "See also" line. Changing the decision = a new ADR that supersedes it. |
| ADR-L3 | Superseding ADR MUST (a) name the old ADR in *Context*, (b) flip the old ADR's status line to `Superseded by ADR-<nnnn>`, (c) re-amend the affected docs (R1/R2 apply again). |
| ADR-L4 | Deleting an ADR file after merge is prohibited (stop-and-ask territory; would break R2 pointers). |

## 5. Template
Canonical file: `docs/build/06-decisions/ADR-TEMPLATE.md`. Copy it; keep every H2 heading in this order; do not add or remove H2 headings; H3 sub-headings *inside* a section are allowed; leave a heading's body as `None.` rather than deleting it.

| Section (H2, exact) | Content rule |
|---|---|
| Title | H1 line `# ADR-<nnnn> — <Title>`; Title ≤ 10 words, imperative or noun phrase |
| Status | one of the exact strings in §4 |
| Date | ISO `YYYY-MM-DD` of the PR that adds it |
| Slice | registry slice ID (`S0`, `S1.4`, `S2.1` …) or `cross-cutting` |
| Context | ≤ 10 lines: what the spec says (quote the doc + section), what was found, why it can't stand; `Kind:` one of `deviation | addition | deferral | design | dependency | security | supersession | baseline` (closed list) |
| Decision | numbered statements, each checkable in code (path, name, number, yes/no rule) |
| Alternatives considered | table: alternative · why not (≥ 1 row, or `None.` for baseline/deferral kinds) |
| Consequences | positive / negative / follow-ups (each follow-up names an owner skill or a `Q<nn>`) |
| Docs amended | table: doc path · section · what changed — every row must exist as a diff in the same PR (R1/R2) |
| Gate impact | table: gate agent · what it now checks differently (or `none`); gates: `spec-drift-reviewer`, `design-fidelity-reviewer`, `frontend-reviewer`, `security-reviewer`, `backend-reviewer`, `supabase-reviewer`, `deploy-checker` |

## 6. How the gates use this folder
### 6.1 Enforced today (present in `.claude/agents/*.md`)
| Gate | Reads | Fails a PR when |
|---|---|---|
| `spec-drift-reviewer` (every PR) | `docs/build/06-decisions/`; the PR body `## ADRs in this PR` section | step 8, verbatim: "every deviation from 1–7 has an ADR *in this PR* that names the doc it amends, and the doc is amended. Unlogged deviation = ❌." Footer prints `ADRs in PR:` / `Docs amended:`. |

No other agent file mentions ADRs or this folder today (`grep -l "ADR\|06-decisions" .claude/agents/*.md` → `spec-drift-reviewer.md` only). Verdict format is the standard `GATE:` block (see `.claude/agents/spec-drift-reviewer.md`); the caller pastes it into the PR.

### 6.2 Proposed additions to agent files (OPEN-4 — not enforceable until the agent files say so)
| Gate | Would read | Would fail a PR when |
|---|---|---|
| `spec-drift-reviewer` (extend step 8) | every `ADR-*.md` on `main` | an ADR on `main` is `Proposed`; a *Docs amended* row of an ADR in the PR is not in the diff; the PR body section is missing or uses another heading (R11) |
| `design-fidelity-reviewer` | ADRs with `Kind: design` named in the PR | a visual deviation from DESIGN.md lacks the changelog line + ADR (R8) |
| `security-reviewer` | ADRs with `Kind: security`, and any ADR whose *Docs amended* names 01 §20 (headers/CSP) or an R7 area | an R7 change lacks an ADR, or the ADR's *Gate impact* has no `security-reviewer` row |
| `backend-reviewer` / `supabase-reviewer` / `frontend-reviewer` | ADRs named in the PR | code contradicts an accepted ADR's *Decision* |
| `deploy-checker` | ADRs with `Slice: S1.10`, or any ADR whose *Docs amended* names 04 §6 (`vercel.json` cron table), 01 §7 (env) or 01 §20 (headers/CSP) | deploy config contradicts an accepted ADR |

## 7. Index
| ADR | Title | Status | Date | Slice | Amends |
|---|---|---|---|---|---|
| ADR-0001 | Engineering spec baseline | Accepted | 2026-08-17 | cross-cutting | none (baseline) |
| ADR-0002 | Engineering-spec reconciliation (contradictions + OPEN defaults) | Accepted | 2026-08-17 | cross-cutting | 00–05, `_registry.md`, `DESIGN.md` §12.7, `docs/data-model.md` |
| ADR-0003 | CSP script-src 'unsafe-inline' for v1 | Accepted | 2026-08-17 | S0 | 01 §20 INV-77 `script-src` row; 01 Status line |
| ADR-0004 | Dev-only component preview route | Accepted | 2026-08-17 | S0 | 03 §7, §12, Status line; `_registry.md` Non-production line |
| ADR-0005 | Placeholder pages render static, not ISR | Accepted | 2026-08-17 | S0 | 01 INV-38 + Status line; 02 §0.1, RP-16, Status line |
| ADR-0006 | Preview env fallback until Supabase Branching is live | Superseded by ADR-0010 | 2026-08-17 | S0 | 00 §6 changelog + Status line; `docs/questions.md` Setup to-dos |
| ADR-0007 | Bundle secret grep ignores the supabase-js key-format literal | Accepted | 2026-08-20 | S0 | 01 INV-29 Check + Status line; 02 SM-30 + Status line; 05 CI-4 + Status line |
| ADR-0008 | Supabase browser client chunk on public routes (lazy) | Accepted | 2026-08-20 | S0 | 01 INV-80 + Status line |
| ADR-0009 | Middleware file is `proxy.ts` (Next 16 convention) | Accepted | 2026-08-20 | S1.1 | 02 §3 heading, RP-19, RP-20 + Status line; 01 §1 tree, INV-14, INV-30, INV-32, INV-42 + Status line; 01 INV-13, INV-85 (addendum 2026-08-20); 04 SC-04 + Status line; `_registry.md` Route files + tree; 00 S1.1 Scope IN, §6 + Status line; `docs/questions.md` S0 notes; 02 §3 M3b + RP-19, 01 INV-30, 05 T-ACT-10 (addendum 2026-08-21: redirects GET/HEAD-only) |
| ADR-0010 | Preview env from persistent `staging` Supabase branch; site URL derived | Accepted | 2026-08-20 | S1.1 | ADR-0006 Status; 01 INV-29, INV-36, INV-37, §7 env matrix + Status line; 04 SC-16 key rows + Status line; 05 T-UNIT-16 + Status line; `_registry.md` Env; 00 §6 + Status line; `docs/questions.md` Setup to-dos + S0/S1.1 notes (Q47); `docs/spec.md` revision log; `docs/dev-tooling.md`; `.env.example`; `ship`, `vercel-ops`, `supabase-ops` skills |
| ADR-0011 | OAuth redirect allow-list narrowed to project previews | Accepted | 2026-08-20 | S1.1 | 02 §4 + Status line; 01 INV-34 + Status line; 00 S1.1 Risks, §6 + Status line; `supabase-ops` skill Auth checklist; `docs/setup-google-cloud.md` §2 + Status; `docs/questions.md` S0 gate note (b) |
| ADR-0012 | `HASH_SECRET` boot-required from S1.1 | Accepted | 2026-08-20 | S1.1 | 04 SC-16 + Status line; 05 T-UNIT-16 + Status line; `_registry.md` Env; 00 §6 + Status line; `.env.example` header |
| ADR-0013 | Action error surfacing: `runAction` + `AuthError` export | Accepted | 2026-08-20 | S1.1 | 04 SC-03, SC-04 + Status line; 01 INV-32 + Status line; 02 RP-20 + Status line; 05 T-UNIT-44 + Status line; `_registry.md` Modules; 04 SC-02, 01 INV-18, 05 T-ACT-0, `_registry.md` Modules `actions/<area>.schema.ts` (addendum 2026-08-20); 01 INV-49, 05 T-UNIT-1 (zod-free `lib/validation/handle.ts`, addendum 2026-08-20) |
| ADR-0014 | Profile page island and own-row columns | Accepted | 2026-08-20 | S1.1 | `_registry.md` Accounts; 03 C-03, C-08, C-16a, §2.2, §2.5, §2.10, §3, §7, §12 + Status line; 01 INV-45 + Status line; 04 SC-04 + Status line; 05 §1.1 + Status line; 00 §6 + Status line; `docs/questions.md` S1.1 notes; `docs/spec.md` revision log; 03 §2.5 `ViewerProvider` row, C-01 (addendum 2026-08-20) |
| ADR-0015 | Profiles mutations on other rows via the service client | Accepted | 2026-08-20 | S1.1 | 05 §7.1 T-RLS-5, T-RLS-8, T-RLS-9 + Status line; `docs/data-model.md` §4 `profiles`; 00 §6 + Status line; `docs/questions.md` S1.1 notes; `docs/spec.md` revision log; `docs/data-model.md` §2.1 `avatar_path`, §2.4 `site_settings`, §2.11; 04 §1.1 `updateProfile` / `deleteAccount` + Status line; 01 INV-53, INV-97 + Status line; 05 §3 SEED-1 (addendum 2026-08-20) |
| ADR-0016 | Auth callback writes `email_hash` with the service client | Accepted | 2026-08-20 | S1.1 | 01 INV-12, INV-14, INV-45, INV-46, INV-84 + Status line; 00 §6 + Status line; `docs/questions.md` S1.1 notes; `docs/spec.md` revision log |
| ADR-0017 | Onboarding panel: no Skip button; document navigation after DONE | Accepted | 2026-08-21 | S1.1 | `DESIGN.md` §11.3 #10 + header; 03 §2.5 `OnboardingPanel` + Status line; 02 §2.4 + Status line; 05 T-E2E-22 + Status line; 00 §6 + Status line; `docs/questions.md` S1.1 notes |
| ADR-0018 | Profile menu items: Your profile · Admin · Sign out | Accepted | 2026-08-21 | S1.1 | `DESIGN.md` header (v1.4) + §11.1; 03 §2.5 `ProfileMenu` row, §12 + Status line; 02 RP-12, `/profile` row + Status line; 00 §6 + Status line; `docs/questions.md` S1.1 notes |
| ADR-0019 | Banned accounts land on `/banned` | Accepted | 2026-08-21 | S1.1 | 02 §1.2 `/banned` row, §3 M4 / M4b, RP-19, RP-21 + Status line; 01 INV-30, INV-45 + Status line; 04 SC-04, SC-05, §1.1 (`completeOnboarding`, `updateProfile`, `checkHandle`, `deleteAccount`), §7 `banned` + Status line; 05 T-ACT-1/4/7/10/65, T-E2E-32 + Status line; `DESIGN.md` §11.3 #19; `_registry.md` Route registry + Route files + layout; 00 S1.1 Scope IN, §6 + Status line; `docs/questions.md` S1.1 notes (already named) |
| ADR-0020 | Reserved handles and bans bind the owner's direct `profiles` write | Accepted | 2026-08-21 | S1.1 | `docs/data-model.md` §2.1 `handle`, §2.11, §4 `profiles`; 04 §1.1 H3 / H5 + Status line; 05 §7.1 T-RLS-4, T-RLS-5 + Status line; 01 INV-49, INV-97 + Status line; `_registry.md` SQL line; 00 §6 + Status line; `docs/questions.md` S1.1 notes; `supabase-ops` skill Owner bootstrap |
| ADR-0021 | Banned accounts may delete themselves | Accepted | 2026-08-27 | S1.1 (`fix/S1.1-banned-delete`) | 04 SC-05, §1.0 `deleteAccount` row, §1.1 `deleteAccount` + Status line; 02 §1.2 `/banned` row + Status line; 03 C-16a + §2.5 + §3 `BannedDelete` + changelog + Status line; 05 §7.2 T-ACT-65, §7.3 T-E2E-32 + Status line; `DESIGN.md` v1.5 header + §11.3 #19; `_registry.md` Accounts components row; 00 §6 + Status line; `docs/questions.md` S1.1 notes |
| ADR-0022 | `project_is_visible()`: the §4 visibility predicate as one SQL helper | Accepted | 2026-08-27 | S1.2 | `docs/data-model.md` §2.11, §4; `_registry.md` SQL line; 00 §6 + Status line |
| ADR-0023 | CI `build` job starts local Supabase (build-time reads exist from S1.2) | Accepted | 2026-08-27 | S1.2 | 05 §4 CI-4 row + Status line; 00 §6 + Status line |
| ADR-0024 | Page-scoped `'use server'` glue on dynamic admin routes | Accepted | 2026-08-27 | S1.2 | 01 INV-04 + Status line; 04 SC-01 + Status line; 00 §6 + Status line |
| ADR-0025 | Unknown ISR slug routes: HTTP 200 + 404 body accepted until the Next streaming fix (interim) | Accepted | 2026-08-27 | S1.2 | 02 §7 SM-04 + Status line; 05 T-E2E-14/T-E2E-34 + Status line; 00 §6 + Status line; docs/questions.md |
| ADR-0026 | Version identity: `external_id` for synced versions, `(project_id, version_number)` for exclusives only | Accepted | 2026-08-27 | S1.3 | `docs/data-model.md` §2.2 `project_versions`; 05 §12 note (T-ACT-48 duplicate case) + Status line; 00 §6 + Status line; `docs/questions.md` S1.3 notes |
| ADR-0027 | S1.3 contract clarifications (create-page flow, download referrer header, upload-contract letter) | Accepted | 2026-08-27 | S1.3 | 02 §1.3 `/admin/projects/new` row + Status line; 00 §S1.3 demo step 1, §6 + Status line; 01 INV-76 + Status line; 04 §1.4 input cells, §1.4.5 commit row + Status line; `_registry.md` Admin components line; `docs/questions.md` S1.3 notes |
| ADR-0028 | S1.4 contract clarifications (deleted-slot rule, report preconditions, counter triggers vs `profiles_guard`, schema helper names, `commentBodySchema` home, `ModActionRow surface`, banned reach via the proxy, moderator merge `public_profiles` read, rename-handle schema, `stripHtml` script blocks, optimistic insert only under `auto`) | Proposed | 2026-09-03 | S1.4 | 00 §S1.4.AC8, AC10, §S1.4 Scope-IN + Risks, §6 + Status line; 01 INV-66 + module list + Status line; 04 §1.2 `reportComment` Preconditions + Body rules + `renameUserHandle` Input + Status line; 03 §1.4 C-17 (5), §2.4 `ModActionRow` + Status line; 02 §2.3 + Status line; 05 §7.5 T-E2E-28/30 + Status line; `docs/data-model.md` §2.11, §4; `_registry.md` SQL + Modules lines; `docs/questions.md` S1.4 notes |

## 8. Phase 2 stub
Phase 2 slices (S2.1–S2.5) reuse this process unchanged. Phase 2 needs an ADR only where a stub in 00 §3 / 01 §26 / 02 §1.5 / 04 §9 is contradicted when the slice is detailed (e.g. Q45 workroom limits if they change from 25 MB/file · 200 MB/room). Already-baseline items need no ADR when built: showing the Commissions nav item at S2.2 is a `commissionsEnabled` flag flip (03 §8, ADR-0001 D10); Ko-fi webhook verification and `kofi_message_id` dedupe are specified in 00 §3 S2.1 (ADR-0001 D14). ADRs are written when the slice opens, not before.

## 9. Open
| # | Item | Proposed default |
|---|---|---|
| OPEN-1 | Whether a `Rejected` status is needed for ADRs discussed but not adopted | No — rejected proposals live in the PR discussion / `docs/questions.md`; only merged decisions become ADRs (keeps §4 to three states). |
| OPEN-2 | Whether `ADR-0001` should be re-issued as `ADR-0002` at freeze if 00–05 change materially between v0.1 and v1.0 | No — ADR-0001 points at the docs by path; doc versions carry their own changelogs. Re-issue only if the *baseline set* changes (a doc added/removed). |
| OPEN-3 | Sibling docs pre-assign numbers that N1/N3 forbid: `00-build-plan.md` §6 (`ADR-0001-branching-preview-env.md`), `01-architecture.md` §29 O-2 ("Record as ADR-0001 at S0"), `03-components.md` §7 O-1 ("recorded as ADR-0001") and §9 ("or ADR-0002"), `04-server-contracts.md` §5.3 + §10 OPEN-8 (`ADR-0003-shorts-detection.md` as a fixed name). `ADR-0001` is the baseline. | Those decisions take `ADR-0002+` in creation order per N3; `keep-docs` edits the five locations at freeze to read `ADR-<next>` / "an ADR (Kind: …)" (00 §6 → `ADR-<next>-branching-preview-env.md`; 01 O-2 → "an ADR (`Kind: security`) at S0"; 03 O-1 → "an ADR (`Kind: addition`) at S0"; 03 §9 → "or an ADR (`Kind: design`)"; 04 → "an ADR, slug `shorts-detection`"). This README does not edit sibling docs. |
| OPEN-4 | Only `spec-drift-reviewer` reads ADRs today; §6.2 rows are unenforced. | At S0, amend `.claude/agents/{design-fidelity-reviewer,security-reviewer,backend-reviewer,supabase-reviewer,frontend-reviewer,deploy-checker}.md` with one line: "Read `docs/build/06-decisions/ADR-*.md` named in the PR; code contradicting an Accepted ADR's *Decision* = ❌", and extend `spec-drift-reviewer.md` step 8 with "no ADR on `main` is `Proposed`; every *Docs amended* row appears in the diff; the PR body uses `## ADRs in this PR`". Owner: `keep-docs` (agent files are docs). |
| OPEN-5 | Wording in sibling docs/skills that gates could read differently from §2: (a) 00 DoD-8, 01 INV-95, `build-phase` 2b list fewer docs than CC-1/F-4 (R1); (b) 03 C-15 says "ADR **or** DESIGN.md edit" where CC-6/INV-95/C-23/R8 say both; (c) `spec-drift-reviewer.md` step 1 "unless the PR marks them deferred/removed" does not distinguish a removed AC (needs ADR, CC-7) from an out-of-slice extra (PR note suffices) — R3; (d) `.claude/skills/design-fidelity/SKILL.md` Output line names DESIGN.md edit + changelog but not the ADR that R8 also requires. | At freeze `keep-docs` (a) makes DoD-8 / INV-95 / build-phase 2b read "`00–05`, `_registry.md` (renames), `DESIGN.md`, `docs/data-model.md`, `docs/notifications.md`"; (b) changes C-15 to "DESIGN.md edit + changelog line **and** an ADR (`Kind: design`) (06 README R8)"; (c) changes step 1 to "Extra features → ❌ 'out of slice' unless listed under `## Deferred / out of slice`; a removed/deferred AC is acceptable only with an ADR (`Kind: deferral`) amending 00 (CC-7)"; (d) appends "and an ADR (`Kind: design`) in `docs/build/06-decisions/`" to the design-fidelity Output line. Until then this README's §2 wording governs (it is the stricter reading in every case). |

## 10. Registry additions
None. Registry already defines the ADR ID format (`ADR-<nnnn>-<slug>.md`). Rule IDs `ADR-R1…R14`, `ADR-N1…N5`, `ADR-L1…L4` are local to this README and are not registry IDs.

## 11. Review notes (v0.2)
- Findings that asked for edits to sibling docs or agent files (00 §6, 01 §29 O-2, 03 §7/§9/C-15, 04 §5.3/OPEN-8, `spec-drift-reviewer.md` step 1, `design-fidelity/SKILL.md`) were not applied there — this doc's remit is `06-decisions/` only. Each is recorded as a proposed `keep-docs` edit under OPEN-3 / OPEN-4 / OPEN-5 and the README wording was made consistent with the sources' stricter reading (CC-6, CC-7, INV-78, INV-95, F-4).
- R8: two findings conflicted (one asked to require the ADR for voice-rule changes, one asked to relax to "ADR or DESIGN.md edit" per 03 C-15). Kept the strict form because 00 CC-6 and 01 INV-95 (both binding sources) make the changelog line *additional* to the ADR; C-15's "or" is listed for alignment in OPEN-5(b).
- ADR-0001 keeps its `### Pre-build decisions` H3; §5 now permits H3 sub-headings inside a section (H2 set is still fixed).
- The finding asking ADR-0001 to add *Docs amended* rows for 00/01/03 was declined: rows must be diffs in the same PR (R1/R2, template rule) and those docs are not edited here; the edits are follow-ups (ADR-0001 Consequences, README OPEN-3).
