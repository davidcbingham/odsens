/**
 * tests/helpers/contentReset.ts — snapshot/restore of the S1.2 content tables for job tests that run
 * real syncs against the local DB (05 H-1 `mutatesSeed`: seed rows are read-only except in tests that
 * restore state in `afterAll`). A sync run upserts rows the factories never created (18 fixture
 * projects with generated ids), so factory tracking cannot clean it up — instead:
 *
 *   let snap: ContentSnapshot;
 *   beforeAll(async () => { snap = await snapshotContentTables(); });
 *   afterAll(async () => { await restoreContentTables(snap); });
 *
 * `restoreContentTables` removes rows that did not exist at snapshot time (children first, FK order)
 * and upserts every snapshot row back, so seed values (SEED-4..6, SEED-10, SEED-11, SEED-12) survive
 * byte-for-byte.
 *
 * S1.6 adds `videos` to the same snapshot (no `videosReset.ts`): a `syncYoutube` run
 * inserts fixture rows no factory tracks and rewrites seed rows (T-ACT-53/71/74, the cron route,
 * `triggerSync`), and `updateVideo` flips seed `seedvid0001` (T-ACT-68). The e2e build prerenders
 * `/videos` and Home from the DB as the db lane left it, so every such file restores (H-1).
 *
 * S1.8 adds `mentions` the same way: a `refreshMentions` run rewrites seed `…0301`'s `view_count`
 * (T-ACT-54/71/74, the cron route, `triggerSync`), `updateMention` hides / features / reorders seed
 * rows and `createMention` inserts rows no factory tracks (T-ACT-63/64) — and the e2e build
 * prerenders Home, `/seen-on` and `/projects/metal-pipe-mace` from whatever the db lane left.
 * `mentions.project_id` references `projects` (`on delete set null`): extra mentions are removed
 * before extra projects (child-first like the rest; a seed mention a test re-assigned to an extra
 * project is nulled by that delete and then repaired by the upsert) and snapshot rows are upserted
 * AFTER projects (the FK needs the parent).
 * Service-role client only (arranging state, 05 §1.3 `asRole('service')`).
 *
 * S1.5 adds the settings tables' documented shape as constants + a constant-based restore (no
 * snapshot needed — SEED-1 / SEED-2 are fixed values, 05 §3):
 *   SEED_MATRIX · SEED_SITE_SETTINGS         the 16 `notification_matrix` rows / the `site_settings` row
 *   restoreSeedMatrix()                      extra (kind, channel) rows removed, the 16 upserted back
 *   restoreSeedSettings()                    SEED-1 row upserted back, then restoreSeedMatrix()
 * `afterAll(restoreSeedSettings)` covers every `updateSettings` / fan-out test (H-1 `mutatesSeed`).
 * Playwright-safe (no `import.meta`, no Vitest imports) — the e2e specs may import it too.
 */
import { asRole, loose } from './asRole';
import { SEED_USERS } from './seedIds';

type Row = Record<string, unknown>;

const TABLES = [
  'projects',
  'project_versions',
  'project_files',
  'project_links',
  'project_overrides',
  'sync_runs',
  'videos',
  'mentions', // after `projects` — restore upserts run in this order, parents first
] as const;

type ContentTable = (typeof TABLES)[number];

export type ContentSnapshot = Record<ContentTable, Row[]>;

/** Primary-key columns per table (project_links is the composite-PK exception). */
const PK: Record<ContentTable, string[]> = {
  projects: ['id'],
  project_versions: ['id'],
  project_files: ['id'],
  project_links: ['project_id', 'platform'],
  project_overrides: ['project_id'],
  sync_runs: ['id'],
  videos: ['id'],
  mentions: ['id'],
};

/** Generated columns cannot be written back (`projects.search` is GENERATED ALWAYS … STORED). */
const GENERATED: Partial<Record<ContentTable, string[]>> = {
  projects: ['search'],
};

/** Extra rows are removed children-first so no FK blocks; snapshot rows restore parents-first. */
const CHILD_FIRST: ContentTable[] = [
  'project_files',
  'project_versions',
  'project_links',
  'project_overrides',
  'sync_runs',
  'mentions', // FK → projects (`on delete set null`, data-model §2.3b) — before its parent
  'projects',
  'videos', // no FK in or out (data-model §2.3) — order is free
];

function pkKey(table: ContentTable, row: Row): string {
  // NUL-separated so composite keys cannot collide (the literal NUL byte S1.2 used is now the escape).
  return PK[table].map((column) => String(row[column])).join('\0');
}

export async function snapshotContentTables(): Promise<ContentSnapshot> {
  const service = loose(asRole('service'));
  const snapshot = {} as ContentSnapshot;
  for (const table of TABLES) {
    const { data, error } = await service.from(table).select('*');
    if (error) throw new Error(`snapshotContentTables: ${table} read failed: ${error.message}`);
    snapshot[table] = (data ?? []) as Row[];
  }
  return snapshot;
}

export async function restoreContentTables(snapshot: ContentSnapshot): Promise<void> {
  const service = loose(asRole('service'));

  for (const table of CHILD_FIRST) {
    const { data, error } = await service.from(table).select(PK[table].join(', '));
    if (error) throw new Error(`restoreContentTables: ${table} read failed: ${error.message}`);
    const keep = new Set(snapshot[table].map((row) => pkKey(table, row)));
    // The select string is dynamic, so supabase-js cannot type the rows — hence the double cast.
    const extras = ((data ?? []) as unknown as Row[]).filter((row) => !keep.has(pkKey(table, row)));
    for (const extra of extras) {
      let query = service.from(table).delete();
      for (const column of PK[table]) query = query.eq(column, extra[column] as string);
      const { error: deleteError } = await query;
      if (deleteError) {
        throw new Error(`restoreContentTables: ${table} delete failed: ${deleteError.message}`);
      }
    }
  }

  for (const table of TABLES) {
    if (snapshot[table].length === 0) continue;
    const stripped = snapshot[table].map((row) => {
      const copy: Row = { ...row };
      for (const column of GENERATED[table] ?? []) delete copy[column];
      return copy;
    });
    const { error } = await service
      .from(table)
      .upsert(stripped, { onConflict: PK[table].join(',') });
    if (error) throw new Error(`restoreContentTables: ${table} upsert failed: ${error.message}`);
  }
}

// ---- S1.5 settings tables (SEED-1 + SEED-2) --------------------------------------------------

export type MatrixChannel = 'email' | 'discord';
export type MatrixRow = { kind: string; channel: MatrixChannel; enabled: boolean };

/**
 * SEED-2 (05 §3) = docs/notifications.md "Default matrix": 8 kinds × (email, discord), in the
 * document's row order. The same 16 values live in migration 20260903120000 (`do nothing`),
 * seed.sql (`do update`) and `lib/notify/matrix.ts` (T-UNIT-27 keeps those three equal); this copy is
 * the test-side truth T-RLS-98 reads the table against.
 */
export const SEED_MATRIX: readonly MatrixRow[] = [
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
];

export type SiteSettingsRow = {
  id: 1;
  moderation_mode: 'auto' | 'hold_first_time';
  admin_notify_emails: string[];
  discord_webhook_url: string | null;
  kofi_page: string | null;
  comments_closed_default: boolean;
  announcement_md: string | null;
  owner_profile_id: string | null;
};

/** SEED-1 (05 §3): the one `site_settings` row as seed.sql leaves it. */
export const SEED_SITE_SETTINGS: Readonly<SiteSettingsRow> = {
  id: 1,
  moderation_mode: 'auto',
  admin_notify_emails: [],
  discord_webhook_url: null,
  kofi_page: 'oddsense',
  comments_closed_default: false,
  announcement_md: null,
  owner_profile_id: SEED_USERS.oddsense,
};

const matrixKey = (row: { kind: string; channel: string }): string => `${row.kind} ${row.channel}`;

/**
 * `notification_matrix` back to SEED-2: rows outside the 16 seeded (kind, channel) pairs are deleted
 * (service — delete is service-only, T-RLS-101) and the 16 are upserted with their documented
 * `enabled` values.
 */
export async function restoreSeedMatrix(): Promise<void> {
  const service = loose(asRole('service'));
  const { data, error } = await service.from('notification_matrix').select('kind, channel');
  if (error) throw new Error(`restoreSeedMatrix: read failed: ${error.message}`);
  const keep = new Set(SEED_MATRIX.map(matrixKey));
  const extras = ((data ?? []) as unknown as { kind: string; channel: string }[]).filter(
    (row) => !keep.has(matrixKey(row)),
  );
  for (const extra of extras) {
    const { error: deleteError } = await service
      .from('notification_matrix')
      .delete()
      .eq('kind', extra.kind)
      .eq('channel', extra.channel);
    if (deleteError) throw new Error(`restoreSeedMatrix: delete failed: ${deleteError.message}`);
  }
  const { error: upsertError } = await service.from('notification_matrix').upsert(
    SEED_MATRIX.map((row) => ({ ...row })),
    { onConflict: 'kind,channel' },
  );
  if (upsertError) throw new Error(`restoreSeedMatrix: upsert failed: ${upsertError.message}`);
}

/** SEED-1 + SEED-2 back to their documented values (service client). */
export async function restoreSeedSettings(): Promise<void> {
  const { error } = await loose(asRole('service'))
    .from('site_settings')
    .upsert({ ...SEED_SITE_SETTINGS }, { onConflict: 'id' });
  if (error) throw new Error(`restoreSeedSettings: site_settings upsert failed: ${error.message}`);
  await restoreSeedMatrix();
}
