# ADR-0031 — Sign-out's CSRF check compares `Origin` against the request's own host

## Status
Accepted (2026-09-11 — S1.5 merge, v0.6)

## Date
2026-09-06

## Slice
cross-cutting (found in production during S1.5 Session B; the rule dates from S1.1)

## Context
Kind: deviation
- Spec says: `docs/build/04-server-contracts.md` §2.2 — "Verify `Origin` (fallback `Referer`) host equals `NEXT_PUBLIC_SITE_URL` host (CSRF) else 403"; `docs/build/02-routes-and-pages.md` §4 Sign-out repeats it verbatim; `docs/build/05-test-plan.md` T-ACT-9 encodes it; `docs/build/04-server-contracts.md` §7 env matrix lists "sign-out CSRF" as a reason `NEXT_PUBLIC_SITE_URL` is boot-required.
- Found: **every logout on production returned 403 `{"ok":false,"error":{"code":"forbidden","message":"Nope."}}`** and the browser rendered that JSON as a white page. The Vercel project had `www.odsens.com` as the primary domain with `odsens.com` 308 → `www` (set when the domain was attached at the S1.1 merge, 2026-08-21), while the Production `NEXT_PUBLIC_SITE_URL` is `https://odsens.com`. The form POST therefore carried `Origin: https://www.odsens.com`, the comparison read `www.odsens.com !== odsens.com`, and the guard rejected the user's own request. Sign-in was unaffected: `/auth/callback` is a GET that Vercel's 308 forwards intact, whereas a POST cannot survive the same hop with its origin still matching. The domain mismatch itself was corrected first (`docs/questions.md` 2026-09-06 — apex made primary, `www` 308s to it, no code change); this ADR removes the code's dependence on the two ever agreeing.
- Root cause of the blind spot: **no test could catch it.** T-ACT-9 builds the request `Origin` *from* `NEXT_PUBLIC_SITE_URL`, so it matches by construction; e2e runs on `localhost:3000` where the browsed host *is* the configured one; preview deployments derive `NEXT_PUBLIC_SITE_URL` from `VERCEL_BRANCH_URL` (ADR-0010), so they agree too. Production was the only environment where the served host could differ from the configured one, and it is the one environment with no test.
- Related: `docs/questions.md` 2026-09-06 (the incident, the Vercel domain swap and this follow-up) · ADR-0010 (preview site URL derivation) · ADR-0002 C3 (sign-out is the only POST form; there is no `/auth/sign-in` route).

## Decision
1. **The comparison is `Origin` host against a host this deployment answers on**, not against a build-time constant. `app/auth/sign-out/route.ts` accepts the `Origin` (fallback: the `Referer` origin) when its host equals **either** `request.nextUrl.host` — the host the request was actually addressed to, which is the OWASP same-origin check and which Next resolves from the forwarded host, so on Vercel it is the public domain — **or** `new URL(env.NEXT_PUBLIC_SITE_URL).host`. Neither `Origin` nor `Referer` parsing changes; a missing/unparseable `Origin` with no usable `Referer` is still 403.
2. **The env host stays an accepted value** rather than being replaced. It costs nothing (both hosts are ours), it keeps the frozen §2.2 comparison true as a subset instead of contradicting it, and every existing T-ACT-9 row passes unchanged.
3. **The 303 goes back to the host the request came in on**: `NextResponse.redirect(new URL('/', request.nextUrl), 303)` replaces `new URL('/', env.NEXT_PUBLIC_SITE_URL)`. A user who signed out on any host this deployment serves lands on `/` of that same host — no cross-host hop, and no chance of bouncing a just-cleared session onto a host whose cookies were never touched.
4. **This is not a weakening of the guard.** A cross-site HTML form cannot set `Origin` (the browser sets it, and `form-action 'self'` in the CSP is the second layer, 01 INV-77); both accepted hosts are hosts the deployment itself answers on; and a caller who can already forge headers on a direct request holds the victim's cookies and does not need CSRF. The rule stays "same site as the one you are talking to".
5. **T-ACT-9 gains the regression row** that would have caught this: a `POST` whose `Origin` is the request's own host but *differs* from `NEXT_PUBLIC_SITE_URL` → 303 (before this ADR: 403). The existing same-origin, foreign-`Origin`, foreign-`Referer`, no-header and 405 rows are unchanged, and the foreign-origin rows still assert the session is untouched.

## Alternatives considered
| Alternative | Why not |
|---|---|
| Fix only the Vercel domain config, leave the code (what was done first) | Correct and shipped, but it leaves the route depending on two independently-editable settings agreeing forever; a future domain change, an added marketing host or a wrong `NEXT_PUBLIC_SITE_URL` silently breaks logout again, in the one environment with no test. |
| Replace the env host entirely with `request.nextUrl.host` | Cleaner as a single rule, but it makes §2.2's sentence false rather than a subset, and it changes behaviour for any caller that legitimately posts with the configured origin. Keeping both is a superset with no attack surface added. |
| Trust `X-Forwarded-Host` directly instead of `request.nextUrl` | Hand-rolls header trust that Next already resolves; a header the app reads itself is easier to get wrong than the one the framework normalises for `redirect()` and routing. |
| Drop the `Origin` check and rely on CSP `form-action 'self'` | `form-action` is not a CSRF defence for the receiving server (it constrains *our* pages, not an attacker's), and 01 INV-77 explicitly calls it the second layer. |
| Make the sign-out form a Server Action instead of a route handler | Contradicts 01 INV-17's carve-out and 04 SC-01, and would need its own ADR for a much larger change; the route handler is right, its comparison was wrong. |

## Consequences
- Positive: logout works on every host the deployment answers on — apex, `www`, `*.vercel.app`, a preview URL, `localhost` — with no env coordination; the sign-out redirect no longer crosses hosts; the failure mode that produced a white JSON page for real users is closed at the source rather than at the Vercel dashboard.
- Negative: two accepted hosts instead of one is marginally more to reason about in a security review (mitigated by Decision 4's reasoning being stated in the route's own header comment); `request.nextUrl.host` is framework-resolved, so a future Next change to forwarded-host handling is a dependency this route now has.
- Follow-ups: no other route compares an inbound origin against `NEXT_PUBLIC_SITE_URL` (`/auth/callback` builds its redirect from it, which is correct — it must send the user to the canonical site, and it is a GET). If a second such comparison ever appears, lift `acceptedHosts` into `lib/auth.ts` → owner `backend-robustness`. The env matrix keeps `NEXT_PUBLIC_SITE_URL` boot-required for metadata, emails and redirects; only the "sign-out CSRF" justification is reworded.

## Docs amended
| Doc | Section | Change |
|---|---|---|
| `docs/build/04-server-contracts.md` | §2.2 `/auth/sign-out`; §7 env matrix `NEXT_PUBLIC_SITE_URL` row; Status line | the comparison is the request's own host or the configured host; the 303 targets the request host; env reason reworded (contains ADR-0031) |
| `docs/build/02-routes-and-pages.md` | §4 Sign-out; §1.2 route table `/auth/sign-out` row; Status line | same rule restated (contains ADR-0031) |
| `docs/build/05-test-plan.md` | §7.2 T-ACT-9; Status line | new regression row: own-host `Origin` ≠ `NEXT_PUBLIC_SITE_URL` → 303 (contains ADR-0031) |
| `docs/build/06-decisions/README.md` | §7 Index | new ADR-0031 row |
| `docs/questions.md` | 2026-09-06 entry | follow-up marked done |

## Gate impact
| Gate | Now checks |
|---|---|
| spec-drift-reviewer | `app/auth/sign-out/route.ts` compares `Origin`/`Referer` host against `request.nextUrl.host` **or** the `NEXT_PUBLIC_SITE_URL` host, and redirects to `new URL('/', request.nextUrl)`; 04 §2.2, 02 §4 + route table and 05 T-ACT-9 all state that rule and cite ADR-0031 |
| security-reviewer | the CSRF guard still rejects a foreign `Origin`, a foreign `Referer` with no `Origin`, and neither-header; both accepted hosts are hosts the deployment answers on; no header is trusted that a cross-site form could set |
| backend-reviewer | T-ACT-9 carries the own-host regression row; no other route compares an inbound origin against a build-time constant |
