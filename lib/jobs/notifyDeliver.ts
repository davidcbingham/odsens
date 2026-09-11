/**
 * lib/jobs/notifyDeliver.ts — `notifyDeliver` (04 §3.7 N1–N7 verbatim; §5.8 `DELIVER_BATCH` /
 * `DISCORD_PER_TICK`; §4.6 per-tick cap; SC-09 timeouts live in the adapters; 01 INV-43 / INV-70;
 * docs/notifications.md Pipeline 3; ADR-0030 D2 / D7; 05 T-ACT-30, T-ACT-31, T-ACT-72). Step 2
 * of `/api/cron/notify` — `runNotify` calls it with its `runId` (no own `sync_runs` row); called
 * without one it manages its own row through `runJob`.
 *
 * N1 — eligible = `status='pending' and attempts < MAX_ATTEMPTS and (attempts = 0 or updated_at <=
 * now() - backoff(attempts))`, `backoff(a) = 5 min × 2^(a−1)` (`backoffMs`), `created_at asc`,
 * `DELIVER_BATCH` per tick — one PostgREST query with an `or(attempts.eq.0, and(attempts.eq.a,
 * updated_at.lte.<now − backoff(a)>)…)` filter and the event embedded through the FK.
 * N7 — `RESEND_API_KEY` unset → every claimed email row is marked `failed` with `error =
 * 'not_configured'` at once (attempts untouched, never retried); a discord row with an empty
 * `address` likewise. Rows of a channel this job has no deliverer for (`inapp` / `push`, Phase 2)
 * are left untouched.
 * N2 — groups per channel: email per `address`, discord per webhook (one group when there is one
 * webhook — the 04 wording; per-address keeps a changed webhook's old rows from posting to the new
 * one); the discord groups are capped at `DISCORD_PER_TICK` rows per tick (§4.6). A group with more
 * than `DIGEST_THRESHOLD` rows is ONE digest send (`Digest` mail / one embed, ADR-0030 D7), else one
 * send per row. Each send (a digest, or one row of a single-mode group) is a unit: before every unit
 * the time budget is checked — `DELIVER_TIME_BUDGET_MS` since the TICK started, i.e. the owning
 * `sync_runs.started_at` when nested under `runNotify` (fan-out time counts; the route's 60 s
 * `maxDuration` runs from the tick, not from this step), else this run's own start — and the rest
 * stays `pending` for the next tick (`deferred` in the summary). A single SC-09 send can take up to
 * ~47 s (4 × 10 s + backoff), so the check runs per send, not per group.
 * N3 — `deliverEmail` / `deliverDiscord` (`lib/notify/deliver/*`, the `Deliverer` seam).
 * N4 — sent → `status='sent', sent_at=now(), attempts+1, error=null`; failed → `attempts+1,
 * error(≤500)`, and `status='failed'` when `attempts` reaches `MAX_ATTEMPTS`. Every unit is marked
 * right after its own send (the sent-but-unmarked window is one unit, never a whole group); a digest
 * marks all its rows together, and when one of those writes fails the remaining rows are still
 * marked before the run fails (a marked row is never re-sent — delivery is at-least-once, the mark
 * is what stops a repeat). Comment events whose payload lacks `target_title` / `target_slug` are
 * hydrated from `projects_public` by `target_id` (one read per tick) before rendering.
 *
 * Summary `{items: sent, failed, digests, skipped}` (+ `claimed`, `deferred`, `errors[]`): `skipped`
 * counts the N7 rows, `failed` the send failures of this tick, `digests` the digest messages sent.
 * The run is `ok=false` only when the claim read or a status write fails (deliverers never throw);
 * after a failed status write no further unit is sent. No address, subject or body ever reaches a
 * log line (INV-43).
 */
import 'server-only';
import { env } from '@/lib/env';
import { runJob, type JobDb } from '@/lib/jobs/runner';
import type { JobOptions, JobSummary } from '@/lib/jobs/types';
import {
  DELIVER_BATCH,
  DELIVER_TIME_BUDGET_MS,
  DIGEST_THRESHOLD,
  DISCORD_PER_TICK,
  MAX_ATTEMPTS,
  backoffMs,
} from '@/lib/notify/constants';
import { deliverDiscord } from '@/lib/notify/deliver/discord';
import { deliverEmail } from '@/lib/notify/deliver/email';
import {
  clipRecipientError,
  type DeliverContext,
  type DeliverResult,
  type Deliverer,
  type DeliveryChannel,
  type RecipientRow,
} from '@/lib/notify/deliver/types';
import type { Json } from '@/lib/supabase/types';

const JOB = 'notifyDeliver';
const SOURCE = 'notify' as const;

/** 04 N7 wording (`notification_recipients.error`). */
export const NOT_CONFIGURED = 'not_configured';

const ERRORS_LIMIT = 20;
const ERROR_ENTRY_LIMIT = 300;

const DELIVERERS: Readonly<Record<DeliveryChannel, Deliverer>> = {
  email: deliverEmail,
  discord: deliverDiscord,
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pushError(errors: string[], entry: string): void {
  if (errors.length < ERRORS_LIMIT) errors.push(entry.slice(0, ERROR_ENTRY_LIMIT));
}

function isDeliveryChannel(value: string): value is DeliveryChannel {
  return value === 'email' || value === 'discord';
}

/** N1: the PostgREST `or` filter for `attempts = 0 or updated_at <= now() - backoff(attempts)`. */
export function eligibilityFilter(now: Date): string {
  const clauses = ['attempts.eq.0'];
  for (let attempts = 1; attempts < MAX_ATTEMPTS; attempts += 1) {
    const cutoff = new Date(now.getTime() - backoffMs(attempts)).toISOString();
    clauses.push(`and(attempts.eq.${String(attempts)},updated_at.lte.${cutoff})`);
  }
  return clauses.join(',');
}

const CLAIM_SELECT =
  'id, event_id, channel, address, attempts, created_at, notification_events!inner(id, kind, payload, subject_type, subject_id, created_at)';

/** N1 — the tick's claim, mapped to `RecipientRow`s (unknown channels dropped). */
async function claimRows(db: JobDb, now: Date): Promise<RecipientRow[]> {
  const { data, error } = await db
    .from('notification_recipients')
    .select(CLAIM_SELECT)
    .eq('status', 'pending')
    .lt('attempts', MAX_ATTEMPTS)
    .or(eligibilityFilter(now))
    .order('created_at', { ascending: true })
    .limit(DELIVER_BATCH);
  if (error) throw new Error(`notification_recipients claim failed: ${error.message}`);
  const rows: RecipientRow[] = [];
  for (const row of data) {
    if (!isDeliveryChannel(row.channel)) continue;
    const event = row.notification_events;
    rows.push({
      id: row.id,
      event_id: row.event_id,
      channel: row.channel,
      address: row.address,
      attempts: row.attempts,
      created_at: row.created_at,
      event: {
        id: event.id,
        kind: event.kind,
        payload: event.payload,
        subject_type: event.subject_type,
        subject_id: event.subject_id,
        created_at: event.created_at,
      },
    });
  }
  return rows;
}

function asObject(value: Json): { [key: string]: Json | undefined } {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
}

/** Fills `target_title` / `target_slug` from `projects_public` for comment events that lack them. */
async function hydrateTargets(db: JobDb, rows: RecipientRow[]): Promise<void> {
  const wanted = new Set<string>();
  for (const row of rows) {
    const payload = asObject(row.event.payload);
    const targetId = payload.target_id;
    if (
      typeof targetId === 'string' &&
      (payload.target_type ?? 'project') === 'project' &&
      (typeof payload.target_title !== 'string' || typeof payload.target_slug !== 'string')
    ) {
      wanted.add(targetId);
    }
  }
  if (wanted.size === 0) return;
  const { data, error } = await db
    .from('projects_public')
    .select('id, slug, title')
    .in('id', [...wanted]);
  if (error) throw new Error(`projects_public read failed: ${error.message}`);
  const byId = new Map<string, { slug: string; title: string }>();
  for (const project of data) {
    if (project.id !== null && project.slug !== null && project.title !== null) {
      byId.set(project.id, { slug: project.slug, title: project.title });
    }
  }
  for (const row of rows) {
    const payload = asObject(row.event.payload);
    const targetId = payload.target_id;
    if (typeof targetId !== 'string') continue;
    const found = byId.get(targetId);
    if (found === undefined) continue;
    row.event.payload = {
      ...payload,
      target_title: typeof payload.target_title === 'string' ? payload.target_title : found.title,
      target_slug: typeof payload.target_slug === 'string' ? payload.target_slug : found.slug,
    };
  }
}

/** N4 — one row's mark after a send. */
async function markRow(
  db: JobDb,
  row: RecipientRow,
  outcome: { sent: true } | { sent: false; error: string },
  nowIso: string,
): Promise<'sent' | 'pending' | 'failed'> {
  const attempts = row.attempts + 1;
  const patch = outcome.sent
    ? { status: 'sent' as const, sent_at: nowIso, attempts, error: null }
    : {
        status: attempts >= MAX_ATTEMPTS ? ('failed' as const) : ('pending' as const),
        attempts,
        error: clipRecipientError(outcome.error),
      };
  const { error } = await db.from('notification_recipients').update(patch).eq('id', row.id);
  if (error) throw new Error(`notification_recipients update failed: ${error.message}`);
  return patch.status;
}

/** N7 — `failed` + `not_configured` at once; attempts untouched so the row is never retried. */
async function markNotConfigured(db: JobDb, rows: RecipientRow[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await db
    .from('notification_recipients')
    .update({ status: 'failed', error: NOT_CONFIGURED })
    .in(
      'id',
      rows.map((row) => row.id),
    );
  if (error) throw new Error(`notification_recipients update failed: ${error.message}`);
}

/**
 * The clock the time budget runs from: the owner's `sync_runs.started_at` when this step is nested
 * under `runNotify` (ADR-0030 D2 — the tick started before fan-out), else this run's own `started`.
 * Best effort — an unreadable row falls back to `started` (the budget is a safety margin, not a
 * status write, so it never fails the run); the earlier of the two clocks always wins.
 */
async function tickStartedAt(
  db: JobDb,
  runId: string,
  ownsRun: boolean,
  started: number,
): Promise<number> {
  if (ownsRun) return started;
  const { data, error } = await db
    .from('sync_runs')
    .select('started_at')
    .eq('id', runId)
    .maybeSingle();
  if (error || data === null) return started;
  const parsed = Date.parse(data.started_at);
  return Number.isFinite(parsed) ? Math.min(parsed, started) : started;
}

/** One send: a digest for a whole group, or a single row of a single-mode group. */
type SendUnit = { channel: DeliveryChannel; mode: DeliverContext['mode']; rows: RecipientRow[] };

/**
 * N4 for one unit's rows: every row is marked even when one write fails (a marked row is never
 * re-sent — the mark is what makes at-least-once delivery stop); the first write error is thrown
 * after the loop so the run still fails. Counts land in `tally` as they happen, so the summary's
 * `items` / `failed` are true even when the unit's marking ended in an error.
 */
async function markUnit(
  db: JobDb,
  rows: RecipientRow[],
  result: DeliverResult,
  nowIso: string,
  errors: string[],
  tally: { sent: number; failed: number },
): Promise<void> {
  const sentIds = new Set(result.sent);
  const failedById = new Map(result.failed.map((entry) => [entry.id, entry.error]));
  let writeError: unknown = null;
  for (const row of rows) {
    const outcome: { sent: true } | { sent: false; error: string } = sentIds.has(row.id)
      ? { sent: true }
      : { sent: false, error: failedById.get(row.id) ?? 'no result from deliverer' };
    try {
      await markRow(db, row, outcome, nowIso);
    } catch (error) {
      if (writeError === null) writeError = error;
      continue;
    }
    if (outcome.sent) {
      tally.sent += 1;
    } else {
      tally.failed += 1;
      pushError(errors, `${row.id}: ${outcome.error}`);
    }
  }
  if (writeError !== null) throw writeError;
}

/** 04 §3.7 — see the file header. `opts.full` is a youtube-only flag and is ignored here. */
export async function notifyDeliver(opts: JobOptions): Promise<JobSummary> {
  return runJob({
    source: SOURCE,
    job: JOB,
    opts,
    work: async ({ db, runId, started, ownsRun }) => {
      const now = new Date();
      const nowIso = now.toISOString();
      const siteUrl = env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, '');
      let ok = true;
      let errorText: string | null = null;
      const tally = { sent: 0, failed: 0 };
      let digests = 0;
      let skipped = 0;
      let deferred = 0;
      let claimed = 0;
      const errors: string[] = [];

      try {
        const rows = await claimRows(db, now);
        claimed = rows.length;

        // N7 — missing provider config fails the row at once, no attempt counted.
        const emailConfigured = env.RESEND_API_KEY !== undefined;
        const notConfigured = rows.filter(
          (row) =>
            (row.channel === 'email' && !emailConfigured) ||
            row.address === null ||
            row.address === '',
        );
        await markNotConfigured(db, notConfigured);
        skipped += notConfigured.length;
        const unconfigured = new Set(notConfigured.map((row) => row.id));
        const deliverable = rows.filter((row) => !unconfigured.has(row.id));

        await hydrateTargets(db, deliverable);

        // N2 — group per channel + address (claim order = created_at asc); discord capped per tick.
        const groups = new Map<string, RecipientRow[]>();
        let discordTaken = 0;
        for (const row of deliverable) {
          if (row.channel === 'discord') {
            if (discordTaken >= DISCORD_PER_TICK) {
              deferred += 1;
              continue;
            }
            discordTaken += 1;
          }
          const key = `${row.channel}|${row.address ?? ''}`;
          const group = groups.get(key);
          if (group === undefined) groups.set(key, [row]);
          else group.push(row);
        }

        // One unit per send: a digest for a group over the threshold, else one unit per row.
        const units: SendUnit[] = [];
        for (const [key, group] of groups) {
          const channel: DeliveryChannel = key.startsWith('email|') ? 'email' : 'discord';
          if (group.length > DIGEST_THRESHOLD) units.push({ channel, mode: 'digest', rows: group });
          else for (const row of group) units.push({ channel, mode: 'single', rows: [row] });
        }

        const tickStarted = await tickStartedAt(db, runId, ownsRun, started);
        for (const unit of units) {
          if (Date.now() - tickStarted > DELIVER_TIME_BUDGET_MS) {
            // Budget spent (route maxDuration 60 s): the rest stays pending for the next tick.
            deferred += unit.rows.length;
            continue;
          }
          const ctx: DeliverContext = { runId, siteUrl, mode: unit.mode, now };
          const result: DeliverResult = await DELIVERERS[unit.channel](unit.rows, ctx);
          // N4 right after the send — a failed write throws after marking the unit's other rows.
          const sentBefore = tally.sent;
          await markUnit(db, unit.rows, result, nowIso, errors, tally);
          if (unit.mode === 'digest' && tally.sent - sentBefore === unit.rows.length) digests += 1;
        }
      } catch (error) {
        ok = false;
        errorText = message(error);
        pushError(errors, errorText);
      }

      const { sent, failed } = tally;
      return {
        ok,
        items: sent,
        error: ok ? null : (errorText ?? 'failed'),
        extra: { failed, digests, skipped, claimed, deferred, errors },
        logMeta: { failed, digests, skipped, claimed, deferred, errors: errors.length },
      };
    },
  });
}
