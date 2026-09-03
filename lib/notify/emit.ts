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
