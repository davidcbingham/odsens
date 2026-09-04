/**
 * lib/notify/emit.ts — `emit(kind, {actorId?, subjectType, subjectId, payload})` (04 SC-22;
 * docs/notifications.md "Pipeline" step 1; data-model §2.6). Inserts one `notification_events` row
 * through the service client (the table has no JWT insert path — 05 T-RLS-91). Nothing is
 * delivered until S1.5 (`notifyFanOut` / `notifyDeliver` read this log).
 *
 * `kind` must be a catalog member (`NOTIFICATION_KINDS`, permanent names) — the table CHECK
 * enforces it too. `payload` never carries emails or Google identity; user references are
 * `{profile_id, handle}` (SC-22). A DB failure throws — the calling action maps it to `internal`
 * through `runAction` (04 SC-03); an event write never silently disappears.
 *
 * S1.5 (ADR-0030 D4): `scrubProfileFromEvents(profileId)` — `deleteAccount` calls it right before
 * `auth.admin.deleteUser` so the kept event rows stop naming the deleted account (04 SC-22 / §1.1;
 * data-model §2.6; 05 T-ACT-65). `scrubPayload` is its pure half.
 */
import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Json } from '@/lib/supabase/types';

/** docs/notifications.md event catalog — v1, v1.5 and Phase 2 kinds. */
export const NOTIFICATION_KINDS = [
  'comment.new',
  'comment.held',
  'comment.reported',
  'comment.reply',
  'comment.approved',
  'sync.failed',
  'sync.stale',
  'mention.suggested',
  'order.new',
  'tip.new',
  'workroom.post',
  'workroom.file',
  'workroom.comment',
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

const KIND_SET: ReadonlySet<string> = new Set(NOTIFICATION_KINDS);

export function isNotificationKind(value: string): value is NotificationKind {
  return KIND_SET.has(value);
}

export type EmitInput = {
  /** The profile that caused the event; omitted/null for jobs. */
  actorId?: string | null;
  subjectType: string;
  subjectId: string;
  payload: Record<string, Json | undefined>;
};

/** Drops `undefined` values so the stored JSON is exactly the keys the caller set. */
function compact(payload: Record<string, Json | undefined>): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export async function emit(kind: NotificationKind, input: EmitInput): Promise<{ id: string }> {
  if (!isNotificationKind(kind)) {
    throw new Error(`emit: unknown notification kind "${String(kind)}"`);
  }
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('notification_events')
    .insert({
      kind,
      actor_id: input.actorId ?? null,
      subject_type: input.subjectType,
      subject_id: input.subjectId,
      payload: compact(input.payload),
    })
    .select('id')
    .single();
  if (error) throw new Error(`notification_events insert failed: ${error.code}`);
  return { id: data.id };
}

// ---------------------------------------------------------------------------------------------
// scrubProfileFromEvents — ADR-0030 D4 (04 SC-22 / §1.1 `deleteAccount` Effects; data-model §2.6)
// ---------------------------------------------------------------------------------------------

/**
 * The top-level payload keys that hold a `{profile_id, handle}` reference today (04 §1.2 payloads:
 * `author` on every comment event, `parent_author` on `comment.reply`). The select below filters on
 * these keys — add a key here when a new payload shape stores a user reference (the scrub itself is
 * generic: every top-level object with a matching `profile_id` in a fetched row is rewritten).
 */
export const PROFILE_REF_KEYS = ['author', 'parent_author'] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isPlainObject(value: Json | undefined): value is { [key: string]: Json } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Rewrites every top-level payload object whose `profile_id` is `profileId` to
 * `{ profile_id: null, handle: null }` (other keys of that object are dropped — the reference is
 * exactly the SC-22 pair). Pure; returns `null` when nothing referenced the profile.
 */
export function scrubPayload(payload: Json, profileId: string): { [key: string]: Json } | null {
  if (!isPlainObject(payload)) return null;
  let changed = false;
  const out: { [key: string]: Json } = {};
  for (const [key, value] of Object.entries(payload)) {
    if (isPlainObject(value) && value.profile_id === profileId) {
      out[key] = { profile_id: null, handle: null };
      changed = true;
    } else {
      out[key] = value;
    }
  }
  return changed ? out : null;
}

/**
 * ADR-0030 D4: before `deleteAccount` removes the auth user, every `notification_events` payload
 * reference `{profile_id, handle}` to that user becomes `{profile_id: null, handle: null}`. The rows
 * themselves are kept (admin audit); `actor_id` nulls through its FK when the profile goes.
 *
 * Reads the candidate rows through the service client — events the user caused (`actor_id`) plus
 * events that reference them under a `PROFILE_REF_KEYS` key — and updates only the rows whose
 * payload actually changed (a few rows per account; one update each). Throws on a DB failure so the
 * calling action answers `internal` and the account stays deletable later.
 */
export async function scrubProfileFromEvents(
  profileId: string,
): Promise<{ scanned: number; scrubbed: number }> {
  if (!UUID_RE.test(profileId)) throw new Error('scrubProfileFromEvents: profileId is not a uuid');
  const admin = createAdminClient();
  const filters = [
    `actor_id.eq.${profileId}`,
    ...PROFILE_REF_KEYS.map((key) => `payload->${key}->>profile_id.eq.${profileId}`),
  ];
  const { data, error } = await admin
    .from('notification_events')
    .select('id, payload')
    .or(filters.join(','));
  if (error) throw new Error(`notification_events read failed: ${error.code}`);

  let scrubbed = 0;
  for (const row of data) {
    const next = scrubPayload(row.payload, profileId);
    if (next === null) continue;
    const { error: updateError } = await admin
      .from('notification_events')
      .update({ payload: next })
      .eq('id', row.id);
    if (updateError) throw new Error(`notification_events scrub failed: ${updateError.code}`);
    scrubbed += 1;
  }
  return { scanned: data.length, scrubbed };
}
