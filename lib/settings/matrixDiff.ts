/**
 * lib/settings/matrixDiff.ts — the SAVE SETTINGS payload helper (05 T-UNIT-41; 03 §2.10
 * `NotificationMatrix` "unit: `lib/settings/matrixDiff.ts` → `updateSettings` payload"; 04 §1.3
 * `updateSettings.matrix`; 00 S1.5 "one row toggles both kinds").
 *
 * Pure and client-safe (the island calls it on submit; the action's schema is the server truth).
 *   matrixDiff(before, after) → only the `(kind, channel, enabled)` triples whose `enabled`
 *     changed, in `matrixDefaults` order, v1 kinds only — a COMING LATER kind is never emitted even
 *     if the caller's `after` list carries one (04 §1.3 would reject it with `validation`).
 *   expandSyncRow(enabled, channel) → the two triples the shared "Sync failed / stale" cell writes.
 */
import { isV1MatrixKind, type DeliveryChannel, type V1MatrixKind } from '@/lib/notify/constants';
import { sortV1Entries } from '@/lib/notify/matrix';

/** One element of `updateSettingsInput.matrix` (04 §1.3). */
export type MatrixWrite = {
  kind: V1MatrixKind;
  channel: DeliveryChannel;
  enabled: boolean;
};

/** Anything shaped like a matrix row — the island's state, the DB rows, `matrixDefaults`. */
export type MatrixLike = { kind: string; channel: string; enabled: boolean };

function key(entry: { kind: string; channel: string }): string {
  return `${entry.kind} ${entry.channel}`;
}

/**
 * Changed cells only. An `after` cell with no `before` twin counts as changed (the server has no
 * value to compare with, so it must be written); a `before` cell absent from `after` is untouched
 * (nothing to write). Duplicates in either list resolve to the LAST occurrence.
 */
export function matrixDiff(
  before: readonly MatrixLike[],
  after: readonly MatrixLike[],
): MatrixWrite[] {
  const previous = new Map(before.map((entry) => [key(entry), entry.enabled]));
  const latest = new Map<string, MatrixLike>();
  for (const entry of after) latest.set(key(entry), entry);

  const changed: MatrixWrite[] = [];
  for (const entry of latest.values()) {
    if (!isV1MatrixKind(entry.kind)) continue;
    if (entry.channel !== 'email' && entry.channel !== 'discord') continue;
    const was = previous.get(key(entry));
    if (was === entry.enabled) continue;
    changed.push({ kind: entry.kind, channel: entry.channel, enabled: entry.enabled });
  }
  return sortV1Entries(changed);
}

/** The "Sync failed / stale" cell → both kinds, same channel, same value (`sync.failed` first). */
export function expandSyncRow(enabled: boolean, channel: DeliveryChannel): MatrixWrite[] {
  return [
    { kind: 'sync.failed', channel, enabled },
    { kind: 'sync.stale', channel, enabled },
  ];
}
