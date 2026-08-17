---
name: security-check
description: Security specialist for odsens.com — reviews auth, RLS, uploads/downloads, webhooks, comments, admin routes, secrets, and third-party embeds against the project's threat model (a minor's public site with authenticated comments and file hosting). Use before merging any slice that touches those areas, and as a periodic audit; complements the built-in /security-review.
---

# security-check

Run the built-in `/security-review` first for generic findings; then this project-specific checklist.

## Threat model (short)
Public site run by a minor · Google-authenticated commenters (spam, harassment, impersonation) · hosted downloadable jars/zips (malware distribution risk, hotlinking) · admin panel (takeover = defacement + data) · webhooks (forged tips) · PII (must never leak Google identity).

## Checklist
**Identity & PII**
- [ ] No query, log, or page ever selects `auth.users` email/name into client code; `public_profiles` view is the only cross-user read.
- [ ] Handle validation server-side (length, charset, uniqueness, reject `@`/email-like, reject obvious real-name patterns per Q34); reserved handles (`admin`, `oddsense`, `odsens`, `moderator`, `mod`).
- [ ] Avatars are re-encoded server-side (strip EXIF), fixed size.
**AuthZ**
- [ ] Every table: RLS on; policies tested as anon/user/mod/admin in Vitest.
- [ ] Every admin route/server action re-checks `is_admin()/is_moderator()` server-side (defense in depth).
- [ ] Middleware forces onboarding; banned users cannot insert comments/likes/reports/orders.
**Uploads / downloads**
- [ ] Uploads only via server actions with type allowlist (`.jar .zip .mrpack` for files; png/jpg/webp for images), size caps, magic-byte sniff (not just extension), sha512 recorded and shown.
- [ ] `project-files` bucket private; download route issues short-lived signed URLs; rate-limit per IP.
- [ ] Never serve user-uploaded HTML/SVG inline; images served with correct content-type; `Content-Disposition: attachment` for files.
**Comments**
- [ ] Body sanitized (no HTML), length cap, link cap; rate limit (e.g. 5/min/user); report → auto-hold threshold; moderation actions audited (`moderated_by/at`).
**Webhooks & cron**
- [ ] Ko-fi: verify `verification_token` constant-time; dedupe on `kofi_message_id`; never trust amounts for anything privileged.
- [ ] Cron routes require `CRON_SECRET`; idempotent.
**Secrets & headers**
- [ ] No service-role key or API keys in client bundle (`grep -r` build output in CI); `.env` gitignored; keys scoped (YouTube key restricted to API).
- [ ] Security headers: CSP (allow self, Supabase, youtube-nocookie, ko-fi frame), `frame-ancestors 'none'` for admin, `X-Content-Type-Options`, `Referrer-Policy`.
- [ ] Third-party embeds are click-to-load facades; `youtube-nocookie.com`.
**Abuse**
- [ ] Rate limits on sign-up-adjacent actions, comments, reports, orders, downloads.
- [ ] Admin login page not linked publicly; admin actions logged.

## Output
A pass/fail table in the PR body with links to the code for each ❌ and a fix or a ticket in `docs/questions.md`.
