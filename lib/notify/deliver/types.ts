/**
 * lib/notify/deliver/types.ts — the 04 §3.7 N3 `Deliverer` seam shared by `deliver/email.ts` and
 * `deliver/discord.ts` (01 INV-70 "share the 04 N3 `Deliverer` interface"; docs/notifications.md
 * Pipeline 3 "pluggable `deliver/` modules with one interface"; registry Notify line).
 *
 * `notifyDeliver` claims rows (N1), groups them per channel + address (N2), decides `single` vs
 * `digest` (> `DIGEST_THRESHOLD` rows in one group) and hands each group to the channel's deliverer
 * with a `DeliverContext`; the deliverer sends and answers per row — `sent` ids and `failed`
 * `{id, error}` pairs — never touching the DB (the job does the N4 marking). A digest is one send
 * for the whole group: every row lands in `sent` or every row in `failed`.
 *
 * Plain module (types + one pure helper): importable by the job, the deliverers and unit tests.
 */
import type { Json } from '@/lib/supabase/types';

/** The two v1 delivery channels (`notification_channel` also holds `inapp` / `push` for Phase 2). */
export type DeliveryChannel = 'email' | 'discord';

/** The `notification_events` columns a deliverer renders from (payload shapes: 04 §1.2, J-F, J-S). */
export type EventView = {
  id: string;
  kind: string;
  payload: Json;
  subject_type: string;
  subject_id: string;
  created_at: string;
};

/** One claimed `notification_recipients` row joined with its event (04 N1 select). */
export type RecipientRow = {
  id: string;
  event_id: string;
  channel: DeliveryChannel;
  /** The admin email or the webhook URL (04 F2) — never logged, never in an error text. */
  address: string | null;
  attempts: number;
  created_at: string;
  event: EventView;
};

export type DeliverMode = 'single' | 'digest';

export type DeliverContext = {
  /** `sync_runs.id` of the tick — the log line id (01 INV-42). */
  runId: string;
  /** `NEXT_PUBLIC_SITE_URL` without a trailing slash — every link and image is absolute (03 E-07). */
  siteUrl: string;
  /** N2: `digest` when the group has more than `DIGEST_THRESHOLD` rows, else `single`. */
  mode: DeliverMode;
  /** The tick's clock, for relative run times in the sync mails (04 SC-14). */
  now: Date;
};

export type DeliverResult = {
  sent: string[];
  failed: { id: string; error: string }[];
};

/** 04 N3 — `(rows, ctx) => {sent, failed}`; the only importers of `lib/adapters/{resend,discord}.ts` besides `testDiscordWebhook` (INV-70). */
export type Deliverer = (rows: RecipientRow[], ctx: DeliverContext) => Promise<DeliverResult>;

/** 04 N4: `error` is stored at ≤ 500 chars. */
export const RECIPIENT_ERROR_LIMIT = 500;

export function clipRecipientError(text: string): string {
  return text.slice(0, RECIPIENT_ERROR_LIMIT);
}
