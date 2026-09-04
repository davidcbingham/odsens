/**
 * lib/notify/matrix.ts — `matrixDefaults` + the Settings-grid row model (05 T-UNIT-27; 04 §1.3
 * `updateSettings`; 03 §2.10 `NotificationMatrix`; docs/notifications.md "Default matrix";
 * ADR-0030 D10 — the TypeScript twin of the migration seed and SEED-2).
 *
 * `matrixDefaults` is exactly the 16 `(kind, channel, enabled)` rows of docs/notifications.md in
 * document order (8 kinds × email, discord). Three copies must agree — this list, the
 * `20260903120000_notification_matrix.sql` seed insert and `supabase/seed.sql` SEED-2 — and
 * T-UNIT-27 parses all three. Client-safe: no `server-only`, no zod, no Supabase (the
 * `NotificationMatrix` island imports it).
 *
 * `matrixRowsForUi()` folds the flat rows into the seven grid rows DESIGN.md §12.1 names: the four
 * switchable v1 rows (New comment · Held for review · Reported · Sync failed / stale — the sync row
 * carries BOTH `sync.failed` and `sync.stale`; 00 S1.5 "one row toggles both kinds") and the three
 * greyed COMING LATER rows (Suggested mention · New order · New tip).
 */
import {
  DELIVERY_CHANNELS,
  MATRIX_KINDS,
  V1_MATRIX_KINDS,
  isV1MatrixKind,
  type DeliveryChannel,
  type MatrixKind,
} from '@/lib/notify/constants';

/** One `notification_matrix` row. */
export type MatrixEntry = {
  kind: MatrixKind;
  channel: DeliveryChannel;
  enabled: boolean;
};

/**
 * docs/notifications.md "Default matrix" — verbatim, document order, `sync.failed` / `sync.stale`
 * expanded from the shared table row (16 entries; SEED-2).
 */
export const matrixDefaults: readonly MatrixEntry[] = Object.freeze([
  { kind: 'comment.new', channel: 'email', enabled: true },
  { kind: 'comment.new', channel: 'discord', enabled: true },
  { kind: 'comment.held', channel: 'email', enabled: true },
  { kind: 'comment.held', channel: 'discord', enabled: true },
  { kind: 'comment.reported', channel: 'email', enabled: true },
  { kind: 'comment.reported', channel: 'discord', enabled: true },
  { kind: 'sync.failed', channel: 'email', enabled: true },
  { kind: 'sync.failed', channel: 'discord', enabled: false },
  { kind: 'sync.stale', channel: 'email', enabled: true },
  { kind: 'sync.stale', channel: 'discord', enabled: false },
  { kind: 'mention.suggested', channel: 'email', enabled: false },
  { kind: 'mention.suggested', channel: 'discord', enabled: true },
  { kind: 'order.new', channel: 'email', enabled: true },
  { kind: 'order.new', channel: 'discord', enabled: true },
  { kind: 'tip.new', channel: 'email', enabled: false },
  { kind: 'tip.new', channel: 'discord', enabled: true },
] as const satisfies readonly MatrixEntry[]);

/** Grid row ids — the first kind of the row, except the shared `sync` row. */
export type MatrixRowId =
  | 'comment.new'
  | 'comment.held'
  | 'comment.reported'
  | 'sync'
  | 'mention.suggested'
  | 'order.new'
  | 'tip.new';

export type MatrixRowSpec = {
  id: MatrixRowId;
  /** DESIGN.md §12.1 row label, verbatim. */
  label: string;
  /** The `notification_matrix` kinds this row toggles together. */
  kinds: readonly MatrixKind[];
  /** Greyed 45 %, `Toggle disabled`, "COMING LATER" — rendered regardless of flags (01 INV-74). */
  comingLater: boolean;
};

/** DESIGN.md §12.1 / 03 §2.10 row order and labels. */
export const MATRIX_ROWS: readonly MatrixRowSpec[] = Object.freeze([
  { id: 'comment.new', label: 'New comment', kinds: ['comment.new'], comingLater: false },
  { id: 'comment.held', label: 'Held for review', kinds: ['comment.held'], comingLater: false },
  { id: 'comment.reported', label: 'Reported', kinds: ['comment.reported'], comingLater: false },
  {
    id: 'sync',
    label: 'Sync failed / stale',
    kinds: ['sync.failed', 'sync.stale'],
    comingLater: false,
  },
  {
    id: 'mention.suggested',
    label: 'Suggested mention',
    kinds: ['mention.suggested'],
    comingLater: true,
  },
  { id: 'order.new', label: 'New order', kinds: ['order.new'], comingLater: true },
  { id: 'tip.new', label: 'New tip', kinds: ['tip.new'], comingLater: true },
] as const satisfies readonly MatrixRowSpec[]);

/** A grid row with its two cell states. */
export type MatrixRow = MatrixRowSpec & {
  enabled: Record<DeliveryChannel, boolean>;
};

/** `"<kind> <channel>"` — the space keeps `kind + channel` concatenations from ever colliding. */
function entryKey(kind: string, channel: string): string {
  return `${kind} ${channel}`;
}

/**
 * Looks a `(kind, channel)` cell up in `entries`, falling back to `matrixDefaults` (a row the DB
 * lacks — it never should, the migration seeds all 16 — shows its default rather than a blank).
 */
export function matrixCell(
  entries: readonly MatrixEntry[],
  kind: MatrixKind,
  channel: DeliveryChannel,
): boolean {
  const key = entryKey(kind, channel);
  const hit = entries.find((entry) => entryKey(entry.kind, entry.channel) === key);
  if (hit) return hit.enabled;
  const fallback = matrixDefaults.find((entry) => entryKey(entry.kind, entry.channel) === key);
  return fallback?.enabled ?? false;
}

/**
 * The seven DESIGN.md §12.1 rows in order, each cell = EVERY kind in the row enabled for that
 * channel (the sync row reads ON only when both `sync.failed` and `sync.stale` are ON; a toggle
 * through `expandSyncRow` writes both, so a diverged pair heals on the next SAVE). `entries`
 * defaults to `matrixDefaults` so the row model renders before any DB read.
 */
export function matrixRowsForUi(entries: readonly MatrixEntry[] = matrixDefaults): MatrixRow[] {
  return MATRIX_ROWS.map((row) => ({
    ...row,
    enabled: Object.fromEntries(
      DELIVERY_CHANNELS.map((channel) => [
        channel,
        row.kinds.every((kind) => matrixCell(entries, kind, channel)),
      ]),
    ) as Record<DeliveryChannel, boolean>,
  }));
}

/**
 * Canonical order for a matrix write list: `matrixDefaults` order (kind × channel), v1 kinds only.
 * Shared by `matrixDiff` so payloads are stable whatever order the island holds its state in.
 */
export function sortV1Entries<T extends { kind: string; channel: string }>(
  entries: readonly T[],
): T[] {
  const order = MATRIX_KINDS.flatMap((kind) =>
    DELIVERY_CHANNELS.map((channel) => entryKey(kind, channel)),
  );
  const rank = new Map(order.map((key, index) => [key, index]));
  return entries
    .filter((entry) => isV1MatrixKind(entry.kind))
    .slice()
    .sort(
      (a, b) =>
        (rank.get(entryKey(a.kind, a.channel)) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(entryKey(b.kind, b.channel)) ?? Number.MAX_SAFE_INTEGER),
    );
}

/** Number of switchable cells the v1 grid writes (5 kinds × 2 channels = 10). */
export const V1_CELL_COUNT = V1_MATRIX_KINDS.length * DELIVERY_CHANNELS.length;
