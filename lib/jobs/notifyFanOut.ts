/**
 * lib/jobs/notifyFanOut.ts — `notifyFanOut` (04 §3.6 F0–F3 verbatim; J-S; SC-16 `DISCORD_WEBHOOK_URL`
 * fallback; SC-22 via `lib/notify/emit.ts`; §5.8 `FANOUT_WINDOW_DAYS` / `FANOUT_BATCH`; 01 INV-43 /
 * INV-70 / INV-71; docs/notifications.md Pipeline 2; ADR-0002 C9; ADR-0030 D2 / D3; 05 T-ACT-29,
 * T-ACT-32). Step 1 of `/api/cron/notify` — `runNotify` calls it with its `runId` (no own
 * `sync_runs` row); called without one it manages its own row through `runJob`.
 *
 * F0 — stale check (J-S / ADR-0030 D3): for each `STALE_SOURCES` entry whose condition holds
 * (`modrinth`, `youtube` always; `curseforge` only with `CURSEFORGE_API_KEY` + ≥ 1 curseforge
 * `project_links` row; `mentions` = false until the table lands in S1.8), a source that HAS
 * `sync_runs` rows but no `ok = true` run finished inside `STALE_WINDOW_HOURS` is stale → one
 * `sync.stale` event `{subject_type:'sync_source', subject_id: syncSourceSubjectId(source),
 * payload:{source, last_ok_at, hours_since_ok}}`, deduped on a `sync.stale` event for that subject
 * younger than the window. A source with no `sync_runs` row at all is never stale (`youtube` on
 * production until S1.6). `stats` / `notify` / `skins` are not in the set.
 *
 * F1 — events with no recipient row, younger than `FANOUT_WINDOW_DAYS`, oldest first, `FANOUT_BATCH`
 * per tick (the anti-join is PostgREST's embedded-null filter — `notification_recipients=is.null`
 * over the FK — one query, index-backed).
 * F2 — per event, per channel in (`email`, `discord`): `enabled = matrix(kind, channel) ?? false`
 * (kinds without a matrix row — `comment.reply`, `comment.approved` — read false). email: enabled +
 * `admin_notify_emails` non-empty → one `pending` row per address, else one `skipped` row with
 * `address` NULL. discord: enabled + a webhook (`site_settings.discord_webhook_url`, else the
 * `DISCORD_WEBHOOK_URL` env fallback — DB wins, SC-16) → one `pending` row whose `address` IS the
 * webhook URL (masked `…<last 4>` in every admin view, never logged — INV-43), else `skipped`.
 * F3 — idempotent under the unique index `(event_id, channel, coalesce(address, ''))`: rows are
 * inserted per event in one statement; a 23505 falls back to per-row inserts that treat 23505 as a
 * no-op (supabase-js `upsert` cannot target an expression index), so a rerun creates nothing and
 * every event ends with ≥ 2 rows and drops out of F1.
 *
 * J-P: a per-source stale error or a per-event insert error is counted in `errors[]` and the run
 * fails only when the F1 read failed or more than half of the events failed. Summary
 * `{items: <recipient rows created>, events, skipped, stale, errors[]}` — counts only, no address.
 */
import 'server-only';
import { env } from '@/lib/env';
import { runJob, type JobDb } from '@/lib/jobs/runner';
import type { JobOptions, JobSummary } from '@/lib/jobs/types';
import {
  DELIVERY_CHANNELS,
  FANOUT_BATCH,
  FANOUT_WINDOW_DAYS,
  STALE_SOURCES,
  STALE_WINDOW_HOURS,
  isMatrixKind,
  syncSourceSubjectId,
  type StaleSource,
} from '@/lib/notify/constants';
import { emit } from '@/lib/notify/emit';
import type { Database } from '@/lib/supabase/types';

const JOB = 'notifyFanOut';
const SOURCE = 'notify' as const;

/** PostgreSQL unique-violation SQLSTATE — the F3 no-op signal. */
const UNIQUE_VIOLATION = '23505';
const ERRORS_LIMIT = 20;
const ERROR_ENTRY_LIMIT = 300;
const HOUR_MS = 3_600_000;

type RecipientInsert = Database['public']['Tables']['notification_recipients']['Insert'];

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pushError(errors: string[], entry: string): void {
  if (errors.length < ERRORS_LIMIT) errors.push(entry.slice(0, ERROR_ENTRY_LIMIT));
}

/** J-S footnotes / ADR-0030 D3 — whether a source is watched at all. */
async function staleCondition(db: JobDb, source: StaleSource): Promise<boolean> {
  switch (source) {
    case 'curseforge': {
      if (env.CURSEFORGE_API_KEY === undefined) return false;
      const { count, error } = await db
        .from('project_links')
        .select('project_id', { count: 'exact', head: true })
        .eq('platform', 'curseforge');
      if (error) throw new Error(`project_links count failed: ${error.message}`);
      return (count ?? 0) > 0;
    }
    case 'mentions':
      // `YOUTUBE_API_KEY` set + ≥ 1 YouTube mention — the `mentions` table lands in S1.8, which
      // wires this condition (ADR-0030 D3). Until then: never stale.
      return false;
    default:
      return true;
  }
}

/** F0 for one source → true when a `sync.stale` event was emitted. */
async function checkStale(db: JobDb, source: StaleSource, now: Date): Promise<boolean> {
  if (!(await staleCondition(db, source))) return false;

  // Never-run sources are never stale (nothing to be stale from — ADR-0030 D3).
  const any = await db.from('sync_runs').select('id').eq('source', source).limit(1);
  if (any.error) throw new Error(`sync_runs read failed: ${any.error.message}`);
  if (any.data.length === 0) return false;

  const lastOk = await db
    .from('sync_runs')
    .select('finished_at, started_at')
    .eq('source', source)
    .eq('ok', true)
    .order('finished_at', { ascending: false, nullsFirst: false })
    .limit(1);
  if (lastOk.error) throw new Error(`sync_runs ok read failed: ${lastOk.error.message}`);
  const last = lastOk.data[0];
  const lastOkAt = last?.finished_at ?? last?.started_at ?? null;
  const windowStart = now.getTime() - STALE_WINDOW_HOURS * HOUR_MS;
  if (lastOkAt !== null && Date.parse(lastOkAt) > windowStart) return false;

  // Dedupe: at most one `sync.stale` per source per window.
  const subjectId = syncSourceSubjectId(source);
  const recent = await db
    .from('notification_events')
    .select('id')
    .eq('kind', 'sync.stale')
    .eq('subject_type', 'sync_source')
    .eq('subject_id', subjectId)
    .gt('created_at', new Date(windowStart).toISOString())
    .limit(1);
  if (recent.error) throw new Error(`notification_events read failed: ${recent.error.message}`);
  if (recent.data.length > 0) return false;

  const hoursSinceOk =
    lastOkAt === null
      ? null
      : Math.round(((now.getTime() - Date.parse(lastOkAt)) / HOUR_MS) * 10) / 10;
  await emit('sync.stale', {
    subjectType: 'sync_source',
    subjectId,
    payload: {
      source,
      last_ok_at: lastOkAt === null ? null : new Date(lastOkAt).toISOString(),
      hours_since_ok: hoursSinceOk,
    },
  });
  return true;
}

/** F3: insert the event's rows; a duplicate falls back to per-row inserts that skip 23505. */
async function insertRecipients(db: JobDb, rows: RecipientInsert[]): Promise<number> {
  if (rows.length === 0) return 0;
  const batch = await db.from('notification_recipients').insert(rows);
  if (!batch.error) return rows.length;
  if (batch.error.code !== UNIQUE_VIOLATION) {
    throw new Error(`notification_recipients insert failed: ${batch.error.message}`);
  }
  let created = 0;
  for (const row of rows) {
    const single = await db.from('notification_recipients').insert(row);
    if (!single.error) {
      created += 1;
      continue;
    }
    if (single.error.code !== UNIQUE_VIOLATION) {
      throw new Error(`notification_recipients insert failed: ${single.error.message}`);
    }
  }
  return created;
}

/** 04 §3.6 — see the file header. `opts.full` is a youtube-only flag and is ignored here. */
export async function notifyFanOut(opts: JobOptions): Promise<JobSummary> {
  return runJob({
    source: SOURCE,
    job: JOB,
    opts,
    work: async ({ db }) => {
      const now = new Date();
      let ok = true;
      let errorText: string | null = null;
      let created = 0;
      let skippedRows = 0;
      let stale = 0;
      let events = 0;
      const errors: string[] = [];

      // F0 — stale check per source (J-P: one source's failure never blocks the others).
      for (const source of STALE_SOURCES) {
        try {
          if (await checkStale(db, source, now)) stale += 1;
        } catch (error) {
          pushError(errors, `stale ${source}: ${message(error)}`);
        }
      }

      try {
        // F1 — events without recipients inside the window, oldest first.
        const cutoff = new Date(now.getTime() - FANOUT_WINDOW_DAYS * 24 * HOUR_MS).toISOString();
        const pending = await db
          .from('notification_events')
          .select('id, kind, notification_recipients(id)')
          .gt('created_at', cutoff)
          .is('notification_recipients', null)
          .order('created_at', { ascending: true })
          .limit(FANOUT_BATCH);
        if (pending.error)
          throw new Error(`notification_events read failed: ${pending.error.message}`);
        events = pending.data.length;

        if (events > 0) {
          // F2 inputs — the matrix + the two delivery targets (read once per tick).
          const matrixRead = await db.from('notification_matrix').select('kind, channel, enabled');
          if (matrixRead.error)
            throw new Error(`notification_matrix read failed: ${matrixRead.error.message}`);
          const matrix = new Map<string, boolean>();
          for (const cell of matrixRead.data)
            matrix.set(`${cell.kind}|${cell.channel}`, cell.enabled);

          const settingsRead = await db
            .from('site_settings')
            .select('admin_notify_emails, discord_webhook_url')
            .eq('id', 1)
            .maybeSingle();
          if (settingsRead.error)
            throw new Error(`site_settings read failed: ${settingsRead.error.message}`);
          const emails = settingsRead.data?.admin_notify_emails ?? [];
          const stored = settingsRead.data?.discord_webhook_url ?? null;
          // SC-16: the DB value wins; the env value is the seed/fallback.
          const webhook =
            stored !== null && stored !== '' ? stored : (env.DISCORD_WEBHOOK_URL ?? null);

          let failedEvents = 0;
          for (const event of pending.data) {
            try {
              const rows: RecipientInsert[] = [];
              for (const channel of DELIVERY_CHANNELS) {
                const enabled = isMatrixKind(event.kind)
                  ? (matrix.get(`${event.kind}|${channel}`) ?? false)
                  : false;
                if (channel === 'email') {
                  if (enabled && emails.length > 0) {
                    for (const address of emails) {
                      rows.push({ event_id: event.id, channel, address, status: 'pending' });
                    }
                  } else {
                    rows.push({ event_id: event.id, channel, address: null, status: 'skipped' });
                  }
                } else if (enabled && webhook !== null) {
                  rows.push({ event_id: event.id, channel, address: webhook, status: 'pending' });
                } else {
                  rows.push({ event_id: event.id, channel, address: null, status: 'skipped' });
                }
              }
              const inserted = await insertRecipients(db, rows);
              created += inserted;
              if (inserted > 0) {
                skippedRows += rows.filter((row) => row.status === 'skipped').length;
              }
            } catch (error) {
              // J-P: one event's failure is counted, never rethrown — the rest still fan out.
              failedEvents += 1;
              pushError(errors, `${event.id}: ${message(error)}`);
            }
          }
          if (failedEvents > events / 2) {
            ok = false;
            errorText = `${String(failedEvents)}/${String(events)} events failed: ${errors.join('; ')}`;
          }
        }
      } catch (error) {
        ok = false;
        errorText = message(error);
        pushError(errors, errorText);
      }

      return {
        ok,
        items: created,
        error: ok ? null : (errorText ?? 'failed'),
        extra: { events, skipped: skippedRows, stale, errors },
        logMeta: { events, skipped: skippedRows, stale, errors: errors.length },
      };
    },
  });
}
