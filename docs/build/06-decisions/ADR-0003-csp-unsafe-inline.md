# ADR-0003 — CSP script-src 'unsafe-inline' for v1

## Status
Accepted

## Date
2026-08-17

## Slice
S0

## Context
Kind: security
- Spec says: `docs/build/01-architecture.md` §20 INV-77 `script-src` row — "`'self' 'unsafe-inline'` (Next.js inline bootstrap; strict nonces are incompatible with ISR — accepted for v1 by ADR-0002 #32; recorded as the `csp-unsafe-inline` security ADR at S0); dev adds `'unsafe-eval'`". INV-77: "CSP baseline (v1) is exactly the directive set below; any new host/directive needs an ADR + this table edited."
- Spec says: `docs/build/06-decisions/ADR-0002-spec-reconciliation.md` OPEN default #32 — "CSP `script-src 'unsafe-inline'` accepted for v1 (Next inline runtime) — dependency/security ADR at S0". `01` §29 O-2 — "DECIDED (ADR-0002 #32) — accepted for v1; `csp-unsafe-inline` security ADR at S0."
- Found: S0 writes `next.config.ts` `headers()` with the 01 §20 CSP baseline. Next.js emits inline bootstrap `<script>` tags on every page; a strict CSP needs a per-request nonce (or a per-build hash) to allow them. Public content pages are ISR (01 INV-38, 02 §0.1) — one cached HTML per path, served to every visitor — so a per-request nonce cannot exist on them without making them dynamic. This ADR is the security record 01 O-2 / ADR-0002 #32 asked for; it changes nothing in the table.
- Related: none in `docs/questions.md` · supersedes none.

## Decision
1. `next.config.ts` builds the `Content-Security-Policy` header from the 01 §20 table; its `script-src` directive is exactly `'self' 'unsafe-inline'` in preview and production, and exactly `'self' 'unsafe-inline' 'unsafe-eval'` when `NODE_ENV === 'development'` (Next dev runtime uses `eval`).
2. Strict nonce-based CSP (`'nonce-…'` + `'strict-dynamic'`) is **not** adopted in v1: ISR pages (01 INV-38 — `/`, `/projects`, `/projects/[slug]`, `/videos`, `/skins`, `/art`, `/seen-on`, `/support`, `/privacy`, `/how-comments-work`) cannot carry a per-request nonce, and Next only reads a nonce from request headers on dynamically rendered routes.
3. Revisit = a new ADR (`Kind: security`) that supersedes this one when either (a) the public routes become dynamic by decision, or (b) Next ships an ISR-compatible nonce/hash mechanism for its inline runtime scripts. Until then no PR narrows or widens `script-src`.
4. Every other directive stays exactly as the 01 §20 table states it (INV-77: the table is the contract). Adding a host to `img-src`/`connect-src`/`frame-src`, or any new directive, is a separate ADR + table edit (INV-77, README ADR-R7).

## Alternatives considered
| Alternative | Why not |
|---|---|
| Nonce-based CSP (`'nonce-<random>'` via `middleware` setting `x-nonce`, `'strict-dynamic'`) | Requires every page to render per request; forces the ten INV-38 routes to `ƒ` dynamic, breaking ISR/`revalidate = 600`, the cache-tag model (02 §0.1, §5) and the "pages never wait on Modrinth/YouTube at request time" rule. Not acceptable for v1. |
| Hash-based CSP (`'sha256-…'` for each Next inline script) | Next's inline runtime scripts (hydration data, chunk bootstrap) change per build and per page; the hash list would have to be regenerated at every build and injected into `next.config.ts` headers before the header is emitted — brittle, and one miss breaks the whole site silently. |
| Drop the CSP header entirely until nonces are feasible | Loses `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` and the host allowlists that INV-76/77 and `security-check` rely on. `'unsafe-inline'` on `script-src` weakens only XSS-script mitigation; the rest of the baseline still holds. |

## Consequences
- Positive: ISR stays intact; the CSP baseline is a single static string in `next.config.ts` (deploy-checker diffs it verbatim); every other directive still enforces host allowlists, no framing, no plugins, same-origin forms.
- Negative: `'unsafe-inline'` on `script-src` means the CSP does not block an injected inline `<script>`; XSS defence in v1 rests on React escaping, `Markdown` sanitisation (`rehype-sanitize`, `skipHtml` — 01 INV-54/65), no `dangerouslySetInnerHTML` (01 lint rules), and comment body validation (04 `commentBodySchema`).
- Follow-ups: `security-reviewer` treats the exact `script-src` string as the contract and flags any `dangerouslySetInnerHTML`/`innerHTML` in `app/**`, `components/**` as a finding on every PR → owner `security-check`; re-evaluate at S1.10 launch checklist and when Next changes its inline-script model → owner `vercel-ops` (opens a superseding ADR if warranted).

## Docs amended
| Doc | Section | Change |
|---|---|---|
| `docs/build/01-architecture.md` | §20 CSP baseline table, `script-src` row | appended "(ADR-0003)" — the row now names the ADR that records the decision (contains the string ADR-0003) |
| `docs/build/01-architecture.md` | `Status:` line | appended "— amended by ADR-0003, ADR-0005 (2026-08-17)" (README ADR-R2) |
| `docs/build/06-decisions/README.md` | §7 Index | row for ADR-0003 |

## Gate impact
| Gate | Now checks |
|---|---|
| spec-drift-reviewer | `next.config.ts` CSP string equals the 01 §20 table (incl. `'unsafe-inline'` on `script-src`; `'unsafe-eval'` only under `NODE_ENV === 'development'`); no PR changes `script-src` without a superseding ADR |
| security-reviewer | header string on the preview URL vs the 01 §20 table, `script-src` exactly `'self' 'unsafe-inline'`; because inline scripts are allowed, `dangerouslySetInnerHTML`/`innerHTML` anywhere in `app/**` or `components/**` = ❌ unless 01 INV-54/65 sanitisation applies |
| deploy-checker | `curl -sI <preview>/` `Content-Security-Policy` contains `script-src 'self' 'unsafe-inline'` and no `'unsafe-eval'` on preview/production; `frame-ancestors 'none'` present (00 S0.AC9) |
| design-fidelity-reviewer, frontend-reviewer, backend-reviewer, supabase-reviewer | none |
