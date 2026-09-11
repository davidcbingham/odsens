/**
 * tests/unit/notify-matrix.test.ts — T-UNIT-27: `matrixDefaults` (`lib/notify/matrix.ts`) equals
 * SEED-2 exactly — 16 `(kind, channel, enabled)` entries, the single source for the seed and the
 * Settings UI. Three copies must agree (ADR-0030 D10): this list, docs/notifications.md's "Default
 * matrix" table, the `20260903120000_notification_matrix.sql` seed insert and `supabase/seed.sql`
 * SEED-2 — the SQL is parsed here, not re-typed. Also the `matrixRowsForUi()` row model (03 §2.10
 * rows + labels) and, as supplementary checks (no 05 ID), the `lib/notify/constants.ts` tunables
 * (04 §5.8), `backoffMs` (04 N1) and `syncSourceSubjectId` (ADR-0030 D3) proven against `node:crypto`.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BACKOFF_BASE_MS,
  COMING_LATER_KINDS,
  DELIVERY_CHANNELS,
  DELIVER_BATCH,
  DELIVER_TIME_BUDGET_MS,
  DIGEST_THRESHOLD,
  DISCORD_PER_TICK,
  FANOUT_BATCH,
  FANOUT_WINDOW_DAYS,
  MATRIX_KINDS,
  MAX_ATTEMPTS,
  STALE_SOURCES,
  STALE_WINDOW_HOURS,
  SYNC_SOURCE_NAMESPACE,
  V1_MATRIX_KINDS,
  backoffMs,
  isDeliveryChannel,
  isMatrixKind,
  isV1MatrixKind,
  syncSourceSubjectId,
  uuidV5,
} from '@/lib/notify/constants';
import {
  MATRIX_ROWS,
  V1_CELL_COUNT,
  matrixCell,
  matrixDefaults,
  matrixRowsForUi,
  sortV1Entries,
  type MatrixEntry,
} from '@/lib/notify/matrix';
import { REPO_ROOT } from '@/tests/helpers/envTest';

const DOC = path.join(REPO_ROOT, 'docs', 'notifications.md');
const SEED = path.join(REPO_ROOT, 'supabase', 'seed.sql');
const MIGRATION = path.join(
  REPO_ROOT,
  'supabase',
  'migrations',
  '20260903120000_notification_matrix.sql',
);

type Triple = [kind: string, channel: string, enabled: boolean];

function triple(entry: { kind: string; channel: string; enabled: boolean }): Triple {
  return [entry.kind, entry.channel, entry.enabled];
}

function sorted(list: Triple[]): Triple[] {
  return [...list].sort((a, b) => `${a[0]} ${a[1]}`.localeCompare(`${b[0]} ${b[1]}`));
}

/** docs/notifications.md "## Default matrix" table → 16 triples (`a / b` rows expand to both kinds). */
function docMatrix(): Triple[] {
  const text = readFileSync(DOC, 'utf8');
  const start = text.indexOf('## Default matrix');
  expect(start, 'docs/notifications.md has a "## Default matrix" heading').toBeGreaterThan(-1);
  const rest = text.slice(start + 1);
  const next = rest.search(/^## /m);
  const section = next === -1 ? rest : rest.slice(0, next);
  const out: Triple[] = [];
  for (const line of section.split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 4 || cells[1] === 'kind' || /^-+$/.test(cells[1] ?? '')) continue;
    const kinds = (cells[1] ?? '')
      .split('/')
      .map((k) => k.replace(/\([^)]*\)/g, '').trim())
      .filter(Boolean);
    const email = cells[2] === 'ON';
    const discord = cells[3] === 'ON';
    expect(['ON', 'OFF'], `${line} email cell`).toContain(cells[2]);
    expect(['ON', 'OFF'], `${line} discord cell`).toContain(cells[3]);
    for (const kind of kinds) out.push([kind, 'email', email], [kind, 'discord', discord]);
  }
  return out;
}

/**
 * The `insert into [public.]notification_matrix (cols) values (…),(…)` tuples of a SQL text (both
 * the migration seed and SEED-2 use this statement shape; column order is read from the list).
 */
function sqlMatrix(text: string, where: string): Triple[] {
  const stmt = text.match(
    /insert\s+into\s+(?:public\.)?notification_matrix\s*\(([^)]*)\)\s*(?:values|select)[\s\S]*?;/i,
  );
  expect(stmt, `${where}: an insert into notification_matrix statement`).not.toBeNull();
  const columns = (stmt?.[1] ?? '').split(',').map((c) => c.trim().replace(/"/g, '').toLowerCase());
  const kindIndex = columns.indexOf('kind');
  const channelIndex = columns.indexOf('channel');
  const enabledIndex = columns.indexOf('enabled');
  expect(
    [kindIndex, channelIndex, enabledIndex],
    `${where}: kind/channel/enabled columns`,
  ).not.toContain(-1);
  const out: Triple[] = [];
  for (const tuple of (stmt?.[0] ?? '').matchAll(/\(([^()]*)\)/g)) {
    const cells = (tuple[1] ?? '').split(',').map((c) =>
      c
        .trim()
        .replace(/::[a-z_.]+/gi, '')
        .replace(/^'(.*)'$/s, '$1')
        .trim(),
    );
    const kind = cells[kindIndex];
    const channel = cells[channelIndex];
    const enabled = cells[enabledIndex]?.toLowerCase();
    if (!kind || !channel || (enabled !== 'true' && enabled !== 'false')) continue;
    if (!kind.includes('.')) continue;
    out.push([kind, channel, enabled === 'true']);
  }
  return out;
}

const EXPECTED_ORDER = [
  'comment.new',
  'comment.held',
  'comment.reported',
  'sync.failed',
  'sync.stale',
  'mention.suggested',
  'order.new',
  'tip.new',
] as const;

describe('matrixDefaults (T-UNIT-27)', () => {
  it('T-UNIT-27 is exactly 16 entries: the 8 matrix kinds × email, discord, document order', () => {
    expect(matrixDefaults).toHaveLength(16);
    expect(matrixDefaults.map((e) => e.kind)).toEqual(EXPECTED_ORDER.flatMap((k) => [k, k]));
    expect(matrixDefaults.map((e) => e.channel)).toEqual(
      EXPECTED_ORDER.flatMap(() => ['email', 'discord']),
    );
    const keys = new Set(matrixDefaults.map((e) => `${e.kind} ${e.channel}`));
    expect(keys.size).toBe(16);
  });

  it('T-UNIT-27 equals the docs/notifications.md "Default matrix" table (parsed, not re-typed)', () => {
    const fromDoc = docMatrix();
    expect(fromDoc).toHaveLength(16);
    expect(matrixDefaults.map(triple)).toEqual(fromDoc);
  });

  it('T-UNIT-27 the seeded values are the notifications.md words: comment.* ON/ON, sync ON/OFF, mention OFF/ON, order ON/ON, tip OFF/ON', () => {
    const cell = (kind: string, channel: string) =>
      matrixDefaults.find((e) => e.kind === kind && e.channel === channel)?.enabled;
    for (const kind of ['comment.new', 'comment.held', 'comment.reported', 'order.new']) {
      expect(cell(kind, 'email'), kind).toBe(true);
      expect(cell(kind, 'discord'), kind).toBe(true);
    }
    for (const kind of ['sync.failed', 'sync.stale']) {
      expect(cell(kind, 'email'), kind).toBe(true);
      expect(cell(kind, 'discord'), kind).toBe(false);
    }
    for (const kind of ['mention.suggested', 'tip.new']) {
      expect(cell(kind, 'email'), kind).toBe(false);
      expect(cell(kind, 'discord'), kind).toBe(true);
    }
  });

  it('T-UNIT-27 equals the migration seed insert (20260903120000_notification_matrix.sql — ADR-0030 D10)', () => {
    expect(
      existsSync(MIGRATION),
      'supabase/migrations/20260903120000_notification_matrix.sql exists (Lane A)',
    ).toBe(true);
    const fromMigration = sqlMatrix(readFileSync(MIGRATION, 'utf8'), 'migration');
    expect(fromMigration).toHaveLength(16);
    expect(sorted(fromMigration)).toEqual(sorted(matrixDefaults.map(triple)));
  });

  it('T-UNIT-27 equals supabase/seed.sql SEED-2 (16 rows, on conflict do update)', () => {
    const text = readFileSync(SEED, 'utf8');
    const fromSeed = sqlMatrix(text, 'seed.sql SEED-2');
    expect(fromSeed).toHaveLength(16);
    expect(sorted(fromSeed)).toEqual(sorted(matrixDefaults.map(triple)));
  });

  it('T-UNIT-27 the list is frozen (a caller cannot mutate the shared defaults)', () => {
    expect(Object.isFrozen(matrixDefaults)).toBe(true);
    expect(() => {
      (matrixDefaults as MatrixEntry[]).push({ kind: 'tip.new', channel: 'email', enabled: true });
    }).toThrow();
  });

  it('T-UNIT-27 every entry uses a MATRIX_KINDS kind and a DELIVERY_CHANNELS channel', () => {
    for (const entry of matrixDefaults) {
      expect(isMatrixKind(entry.kind), entry.kind).toBe(true);
      expect(isDeliveryChannel(entry.channel), entry.channel).toBe(true);
    }
    expect([...MATRIX_KINDS]).toEqual([...EXPECTED_ORDER]);
  });
});

describe('matrixRowsForUi (03 §2.10 rows; DESIGN.md §12.1 labels)', () => {
  it('renders the seven rows in order with the DESIGN.md labels and the COMING LATER flags', () => {
    const rows = matrixRowsForUi();
    expect(rows.map((r) => r.label)).toEqual([
      'New comment',
      'Held for review',
      'Reported',
      'Sync failed / stale',
      'Suggested mention',
      'New order',
      'New tip',
    ]);
    expect(rows.map((r) => r.comingLater)).toEqual([false, false, false, false, true, true, true]);
    expect(rows.map((r) => r.id)).toEqual([
      'comment.new',
      'comment.held',
      'comment.reported',
      'sync',
      'mention.suggested',
      'order.new',
      'tip.new',
    ]);
  });

  it('the sync row carries both sync.failed and sync.stale; every other row one kind; all 8 kinds covered once', () => {
    const sync = MATRIX_ROWS.find((r) => r.id === 'sync');
    expect(sync?.kinds).toEqual(['sync.failed', 'sync.stale']);
    for (const row of MATRIX_ROWS) if (row.id !== 'sync') expect(row.kinds).toHaveLength(1);
    const covered = MATRIX_ROWS.flatMap((r) => [...r.kinds]).sort();
    expect(covered).toEqual([...MATRIX_KINDS].sort());
  });

  it('defaults: comment rows ON/ON, sync ON/OFF, mention OFF/ON, order ON/ON, tip OFF/ON', () => {
    const rows = matrixRowsForUi();
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.enabled]));
    expect(byId['comment.new']).toEqual({ email: true, discord: true });
    expect(byId['comment.held']).toEqual({ email: true, discord: true });
    expect(byId['comment.reported']).toEqual({ email: true, discord: true });
    expect(byId.sync).toEqual({ email: true, discord: false });
    expect(byId['mention.suggested']).toEqual({ email: false, discord: true });
    expect(byId['order.new']).toEqual({ email: true, discord: true });
    expect(byId['tip.new']).toEqual({ email: false, discord: true });
  });

  it('reads the DB rows it is given (comment.new × email OFF shows OFF)', () => {
    const entries = matrixDefaults.map((e) =>
      e.kind === 'comment.new' && e.channel === 'email' ? { ...e, enabled: false } : e,
    );
    const row = matrixRowsForUi(entries).find((r) => r.id === 'comment.new');
    expect(row?.enabled).toEqual({ email: false, discord: true });
  });

  it('the sync cell is ON only when BOTH kinds are ON for that channel (a diverged pair reads OFF)', () => {
    const entries = matrixDefaults.map((e) =>
      e.kind === 'sync.stale' && e.channel === 'discord' ? { ...e, enabled: true } : e,
    );
    // sync.failed × discord is still OFF → the shared cell reads OFF.
    expect(matrixRowsForUi(entries).find((r) => r.id === 'sync')?.enabled).toEqual({
      email: true,
      discord: false,
    });
    const both = entries.map((e) =>
      e.kind === 'sync.failed' && e.channel === 'discord' ? { ...e, enabled: true } : e,
    );
    expect(matrixRowsForUi(both).find((r) => r.id === 'sync')?.enabled).toEqual({
      email: true,
      discord: true,
    });
  });

  it('a cell missing from the given rows falls back to its default (never a blank)', () => {
    expect(matrixCell([], 'tip.new', 'discord')).toBe(true);
    expect(matrixCell([], 'sync.failed', 'discord')).toBe(false);
    expect(matrixRowsForUi([]).map((r) => r.enabled)).toEqual(
      matrixRowsForUi().map((r) => r.enabled),
    );
  });

  it('sortV1Entries keeps matrixDefaults order and drops COMING LATER kinds', () => {
    const shuffled = [
      { kind: 'tip.new', channel: 'email', enabled: true },
      { kind: 'sync.stale', channel: 'discord', enabled: true },
      { kind: 'comment.new', channel: 'discord', enabled: false },
      { kind: 'comment.new', channel: 'email', enabled: false },
    ];
    expect(sortV1Entries(shuffled).map((e) => `${e.kind} ${e.channel}`)).toEqual([
      'comment.new email',
      'comment.new discord',
      'sync.stale discord',
    ]);
    expect(V1_CELL_COUNT).toBe(10);
  });
});

describe('lib/notify/constants.ts (04 §5.8 tunables; supplementary — no 05 ID)', () => {
  it('carries the 04 §5.8 defaults and the §3.7 caps', () => {
    expect(FANOUT_WINDOW_DAYS).toBe(7);
    expect(FANOUT_BATCH).toBe(500);
    expect(DELIVER_BATCH).toBe(100);
    expect(DISCORD_PER_TICK).toBe(20);
    expect(DELIVER_TIME_BUDGET_MS).toBe(12_000);
    // route maxDuration 60 s (02 §1.4) minus one worst-case SC-09 send (~47 s)
    expect(DELIVER_TIME_BUDGET_MS + 47_000).toBeLessThan(60_000);
    expect(MAX_ATTEMPTS).toBe(5);
    expect(DIGEST_THRESHOLD).toBe(5);
    expect(STALE_WINDOW_HOURS).toBe(6);
    expect(BACKOFF_BASE_MS).toBe(5 * 60_000);
  });

  it('backoffMs is 5 min × 2^(attempts−1): 5 / 10 / 20 / 40 / 80 min (04 N1)', () => {
    expect([1, 2, 3, 4, 5].map(backoffMs)).toEqual([5, 10, 20, 40, 80].map((m) => m * 60_000));
    expect(backoffMs(0)).toBe(5 * 60_000);
    expect(backoffMs(-3)).toBe(5 * 60_000);
    expect(backoffMs(2.9)).toBe(10 * 60_000);
  });

  it('the closed sets: channels, v1 kinds, COMING LATER kinds, stale sources (04 §1.3, J-S)', () => {
    expect([...DELIVERY_CHANNELS]).toEqual(['email', 'discord']);
    expect([...V1_MATRIX_KINDS]).toEqual([
      'comment.new',
      'comment.held',
      'comment.reported',
      'sync.failed',
      'sync.stale',
    ]);
    expect([...COMING_LATER_KINDS]).toEqual(['mention.suggested', 'order.new', 'tip.new']);
    expect([...STALE_SOURCES]).toEqual(['modrinth', 'youtube', 'curseforge', 'mentions']);
    expect(isV1MatrixKind('tip.new')).toBe(false);
    expect(isV1MatrixKind('sync.stale')).toBe(true);
    expect(isMatrixKind('comment.reply')).toBe(false);
    expect(isDeliveryChannel('inapp')).toBe(false);
  });

  it('syncSourceSubjectId is a stable RFC 4122 v5 UUID per source (ADR-0030 D3)', () => {
    const V5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    const ids = STALE_SOURCES.map(syncSourceSubjectId);
    for (const id of ids) expect(id).toMatch(V5);
    expect(new Set(ids).size).toBe(STALE_SOURCES.length);
    expect(syncSourceSubjectId('modrinth')).toBe(syncSourceSubjectId('modrinth'));
    expect(syncSourceSubjectId('modrinth')).not.toBe(syncSourceSubjectId('Modrinth'));
    expect(SYNC_SOURCE_NAMESPACE).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  /** Reference v5 through node:crypto (RFC 4122 §4.3) — the module's SHA-1 must agree byte for byte. */
  function referenceV5(namespace: string, name: string): string {
    const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
    const digest = createHash('sha1')
      .update(Buffer.concat([ns, Buffer.from(name, 'utf8')]))
      .digest();
    const bytes = Buffer.from(digest.subarray(0, 16));
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  it('the dependency-free SHA-1 v5 matches node:crypto (short, multi-block and UTF-8 names)', () => {
    for (const source of [
      ...STALE_SOURCES,
      '',
      'a',
      'x'.repeat(55),
      'x'.repeat(56),
      'x'.repeat(64),
      'y'.repeat(1000),
      'ünïcødé ✔ 名前',
    ]) {
      expect(syncSourceSubjectId(source), JSON.stringify(source)).toBe(
        referenceV5(SYNC_SOURCE_NAMESPACE, source),
      );
    }
  });

  it('uuidV5 reproduces the RFC 4122 DNS example (www.example.com → 2ed6657d-e927-568b-95e1-2665a8aea6a2)', () => {
    expect(uuidV5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'www.example.com')).toBe(
      '2ed6657d-e927-568b-95e1-2665a8aea6a2',
    );
    expect(() => uuidV5('not-a-uuid', 'x')).toThrow(/namespace/);
  });
});
