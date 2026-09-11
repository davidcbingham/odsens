# Notifications — design (decided 2026-08-17)

**Scope v1: admins only.** Users get no notifications in v1 (bell/inbox cut; workroom clients arrive in Phase 2 with opt-in).
**Principle: one event log, pluggable delivery.** Every notable thing writes an event; delivery reads a settings matrix
and pushes to channels. Adding a channel later = a new deliverer module, not a rewrite.

## Event catalog (names are permanent)
| kind | when | phase |
|---|---|---|
| `comment.new` | a comment is published on a project/skin/art | v1 |
| `comment.held` | a comment is held (first-timer / auto-hold) — needs review | v1 |
| `comment.reported` | a comment receives a report | v1 |
| `comment.reply` / `comment.approved` | logged for a future user inbox; **no delivery in v1** | v1 (log only) |
| `sync.failed` / `sync.stale` | a sync job errors, or no successful run in 6h | v1 |
| `mention.suggested` | assisted discovery found a candidate | v1.5 |
| `order.new` | custom order submitted | P2 |
| `tip.new` | Ko-fi webhook received | P2 |
| `workroom.post` / `workroom.file` / `workroom.comment` | activity in a workroom → members who opted in | P2 |

## Data
- `notification_events (id, kind, actor_id null, subject_type, subject_id, payload jsonb, created_at)` — the log.
- `notification_recipients (id, event_id, profile_id null, channel enum email|discord|inapp|push, address text null, status enum pending|sent|failed|skipped, attempts int, sent_at, error)` — queue + audit; one row per (recipient, channel).
- `notification_matrix (kind, channel, enabled bool, PK(kind, channel))` — the admin Settings grid; seeded with defaults below.
- `site_settings` gains `discord_webhook_url` (secret; masked in UI) and `admin_notify_emails text[]` (entered explicitly — we never silently reuse Google emails).
- Phase 2 adds `notification_prefs (profile_id, kind, channel, enabled)` for user-facing delivery.

## Pipeline
1. Server Action / cron inserts an event.
2. **Fan-out** (`/api/cron/notify` step 1, or a DB trigger later): for each enabled (kind, channel) in the matrix → create recipient rows (email → one per admin email; discord → one row, address = webhook).
3. **Deliver** (`/api/cron/notify` step 2, every 5 min): pending rows → `lib/notify/deliver/<channel>.ts` → mark sent/failed; retry failed with backoff (max 5); if >5 pending for one channel, send a single **digest**.
4. Templates in the site voice, plain-text-first; every email carries a "manage in Settings" link (admins) — user-facing emails later carry a signed unsubscribe link.

## Channels
| channel | infra | v1? | notes |
|---|---|---|---|
| **Discord** | one channel webhook URL (no bot) — Oliver's server (David to confirm he has one) | **yes** | ~30 lines; small embed: kind, project, excerpt, link. Primary channel for Oliver. |
| **Email** | **Resend** API; sender `allay@odsens.com`; DKIM/SPF/DMARC DNS at Squarespace (do with the Vercel DNS cutover) | **yes** | free tier 3k/mo. Secondary for David. |
| In-app | reads `notification_recipients` (channel inapp) — the cut bell | P2 | needed for workroom clients |
| Web push | VAPID + service worker + subscriptions table | later/maybe | |
| SMS | — | no | |

## Default matrix (admin Settings shows this grid with square ON/OFF toggles)
| kind | email | discord |
|---|---|---|
| comment.new | ON | ON |
| comment.held | ON | ON |
| comment.reported | ON | ON |
| sync.failed / sync.stale | ON | OFF |
| mention.suggested (v1.5) | OFF | ON |
| order.new (P2) | ON | ON |
| tip.new (P2) | OFF | ON |

## Groundwork in v1 regardless of timing
Ship events + recipients + matrix tables; log `comment.reply/approved` even though undelivered; pluggable `deliver/` modules
with one interface; the Settings matrix UI; Discord webhook + admin emails fields; Resend domain verification queued with DNS cutover.

## Email styling (2026-08-17)
Templates are **React Email** components in `emails/` (Resend's library; inline-styled, table-based HTML that survives Gmail/Outlook/Apple Mail), using DESIGN.md tokens: dark-first (ink background, slab card — explicit backgrounds so Gmail dark mode doesn't invert), 0 radius, 2px borders, gold/indigo bulletproof buttons, `ODSENS` wordmark as PNG (the 2× file at 84×20 attributes for retina — 03 E-07; web fonts don't load in Gmail/Outlook → fallbacks Impact/Arial Black display, Arial body), no shadows/hatch/motion. Shared `Layout`, `Button`, `Badge`; per-event templates (`CommentNew`, `CommentHeld`, `CommentReported`, `SyncFailed`, P2 `OrderNew`, `WorkroomUpdate`). Always send a plain-text alternative. Preview with `pnpm email dev`; `design-fidelity` covers `emails/`.
Provider note: Resend chosen over Postmark for fit (tiny admin-only volume, React Email + Vercel integration, free tier, simplest for Oliver); Postmark is the switch target if user-facing volume/inbox placement ever matters — `deliver/email.ts` is the only seam.

## Resend account wiring (2026-08-17)
- Vercel Marketplace integration → `RESEND_API_KEY` injected into the `odsens` project envs (pull locally with `vercel env pull`).
- Domain `odsens.com` verified in Resend — sender **`allay@odsens.com`** ("odsens <allay@odsens.com>"). DNS at Squarespace verified 2026-08-17: DKIM `resend._domainkey` ✔, SPF+MX on `send.odsens.com` ✔ (SES us-east-1). Test send succeeded (id 904a9249…).
- The Vercel-integration API key is **send-only** (can't list domains/logs) — fine for the app; use the Resend dashboard for logs.
- **Gaps:** no `_dmarc` record yet (add `TXT _dmarc.odsens.com "v=DMARC1; p=none; rua=mailto:david@studiobing.com"`); no MX on `odsens.com` root, so **allay@ can't receive replies** — add Squarespace email forwarding allay@odsens.com → david@studiobing.com (or Resend Receiving) and set `Reply-To` accordingly.
- Not used: Resend↔Supabase SMTP (Supabase Auth sends no email for us). Resend MCP deferred; if added later, sending is gated by the stop-and-ask list.

## Character (design pass 3)
Notifications speak as **the allay** (Minecraft's item-delivery mob) — dry, never explaining the joke: new comment → "The allay picked this up on…"; held → "The allay is holding it until you decide"; sync failure → "The allay came back empty-handed. It'll keep trying." Settings panel titles: "Where the allay delivers" / "What it picks up". Discord bot posts as **allay** with a pixel allay avatar (asset pending from Oliver, Q44). Templates + Discord embeds: `design/claude-design-export/pass-3/odsens Screens - Email and Discord.dc.html`, rules in `DESIGN.md` §12.1.
