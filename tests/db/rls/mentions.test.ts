/**
 * tests/db/rls/mentions.test.ts — RLS matrix for `mentions` (docs/build/05-test-plan.md §7.1
 * T-RLS-102..106; data-model §4 row "mentions": published to all; admin all — draft / suggested /
 * hidden; insert/update/delete admin — ADR-0002 C7). Policies:
 * supabase/migrations/20260919120000_mentions.sql — select = `status = 'published'` or `is_admin()`;
 * insert/update/delete = `is_admin()` only (a moderator is a plain D — `/admin/mentions` shows a mod
 * the published rows read-only, ADR-0045); `createMention` / `updateMention` / `refreshMentions`
 * writes bypass RLS via service. Cell order of every cell comment:
 * anon | user | banned | mod | admin | svc.
 *
 * Select cells read the SEED-10 rows (2, both published). Seed rows stay read-only (H-1): denied
 * write cells target seed `…0301` and are proven no-ops through `service`; allowed write cells use
 * factory rows (`makeMention`), removed by `cleanupFactories`. Assertions are scoped to seed / factory
 * ids — never to table-wide counts — so rows another db file creates cannot break them.
 *
 * No new ids (H-13) — the table's constraints ride the cells that exercise them:
 *   T-RLS-104  defaults of a minimal insert; `mentions_url_key` (23505); the CHECKs (23514: url https
 *              + ≤ 2048, title 1..200, creator_name 1..80, external_id 1..64, YouTube external_id =
 *              11 chars, view_count ≥ 0); the enums (22P02); the `project_id` FK (23503); the FK /
 *              newest-first indexes (catalog).
 *   T-RLS-105  the shared `set_updated_at()` trigger (01 INV-97).
 *   T-RLS-106  "a mention is never deleted with its parent" (01 INV-24): both FKs are
 *              `on delete set null`.
 * The reorder RPC is T-RLS-129 (`_rpc-grants.test.ts`); a mention following a folded project is
 * T-ACT-81 (`tests/db/actions/linkProjectListing.fold.test.ts`).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { asRole, loose, type TestRole } from '@/tests/helpers/asRole';
import { sql } from '@/tests/helpers/db';
import { expectPolicy, type RowValues } from '@/tests/helpers/expectPolicy';
import {
  cleanupFactories,
  factoryYoutubeId,
  makeMention,
  makeProject,
  makeUser,
} from '@/tests/helpers/factories';
import { SEED_MENTIONS, SEED_PROJECTS, SEED_USERS } from '@/tests/helpers/seedIds';

/** Signed-in, non-admin roles — every cell below is identical for them (mod is plain D on writes, ADR-0002 C7). */
const NON_ADMIN = ['user', 'banned', 'mod'] as const satisfies readonly TestRole[];
/** The three statuses only an admin may read (05 T-RLS-103). */
const NON_PUBLIC_STATUSES = ['draft', 'suggested', 'hidden'] as const;
const service = asRole('service');

const SEED_IDS = [SEED_MENTIONS.youtube, SEED_MENTIONS.tiktok];
const SEED_YOUTUBE_URL = 'https://www.youtube.com/watch?v=seedvid0001';
const SEED_YOUTUBE_TITLE = 'Metal Pipe Mace is the loudest mod I have ever installed';

afterAll(cleanupFactories);

// ---------------------------------------------------------------------------------------------
// T-RLS-102 select status='published' — pub | pub | pub | pub | A | A
// ---------------------------------------------------------------------------------------------
describe("T-RLS-102 mentions select status='published'", () => {
  it.each(['anon', ...NON_ADMIN] as const)(
    'T-RLS-102 %s sees both published seed rows and never a row of another status',
    async (role) => {
      const draftId = await makeMention({ status: 'draft' });
      const { data, error } = await asRole(role).from('mentions').select('id, status');
      expect(error).toBeNull();
      const ids = new Set((data ?? []).map((r) => r.id));
      for (const id of SEED_IDS) expect(ids.has(id), id).toBe(true);
      expect(ids.has(draftId)).toBe(false);
      for (const row of data ?? []) expect(row.status).toBe('published');
    },
  );

  it.each(['admin', 'service'] as const)(
    'T-RLS-102 %s sees the published seed rows and a draft next to them',
    async (role) => {
      const draftId = await makeMention({ status: 'draft' });
      const { data, error } = await asRole(role).from('mentions').select('id');
      expect(error).toBeNull();
      const ids = new Set((data ?? []).map((r) => r.id));
      for (const id of [...SEED_IDS, draftId]) expect(ids.has(id), id).toBe(true);
    },
  );

  it('T-RLS-102 anon reads the seed row as SEED-10 documents it (creator = public name + link only)', async () => {
    const { data, error } = await asRole('anon')
      .from('mentions')
      .select('*')
      .eq('id', SEED_MENTIONS.youtube)
      .single();
    expect(error).toBeNull();
    expect(data).toMatchObject({
      id: SEED_MENTIONS.youtube,
      project_id: SEED_PROJECTS.metalPipeMace,
      platform: 'youtube',
      url: SEED_YOUTUBE_URL,
      external_id: 'seedvid0001',
      title: SEED_YOUTUBE_TITLE,
      creator_name: 'Seed Creator',
      creator_url: 'https://www.youtube.com/@seedcreator',
      thumbnail_url: 'https://i.ytimg.com/vi/seedvid0001/hqdefault.jpg',
      view_count: 1200000,
      status: 'published',
      source: 'manual',
      featured: true,
      sort_order: 1,
    });
    // 00 S1.8.AC11: no creator column beyond the public name + link — the column set is closed.
    expect(Object.keys(data ?? {}).sort()).toEqual([
      'created_at',
      'created_by',
      'creator_name',
      'creator_url',
      'external_id',
      'featured',
      'id',
      'platform',
      'project_id',
      'published_at',
      'sort_order',
      'source',
      'status',
      'thumbnail_url',
      'title',
      'updated_at',
      'url',
      'view_count',
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-103 select draft / suggested / hidden (factory) — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
describe.each(NON_PUBLIC_STATUSES)('T-RLS-103 mentions select status=%s (factory)', (status) => {
  /** A `suggested` row is what the v1.5 discovery job would write — `source='auto'`, no creator. */
  const arrange = (): Promise<string> =>
    makeMention(status === 'suggested' ? { status, source: 'auto', created_by: null } : { status });

  it.each(['anon', ...NON_ADMIN] as const)(
    `T-RLS-103 %s cannot see a ${status} mention`,
    async (role) => {
      const id = await arrange();
      await expectPolicy({ table: 'mentions', op: 'select', role, allowed: false, filter: { id } });
    },
  );

  it.each(['admin', 'service'] as const)(`T-RLS-103 %s reads a ${status} mention`, async (role) => {
    const id = await arrange();
    await expectPolicy({
      table: 'mentions',
      op: 'select',
      role,
      allowed: true,
      filter: { id },
      expectRows: 1,
    });
  });
});

describe('T-RLS-103 mentions select — the status decides, not the project', () => {
  it.each(['anon', 'mod'] as const)(
    'T-RLS-103 %s cannot see a hidden mention hung on a published seed project',
    async (role) => {
      const id = await makeMention({
        status: 'hidden',
        project_id: SEED_PROJECTS.metalPipeMace,
      });
      await expectPolicy({ table: 'mentions', op: 'select', role, allowed: false, filter: { id } });
    },
  );
});

// ---------------------------------------------------------------------------------------------
// T-RLS-104 insert (admin only — ADR-0002 C7) — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
/** The smallest valid row: the four NOT NULL columns without a default (+ the id the test tracks). */
function mentionRow(id: string): RowValues {
  const videoId = factoryYoutubeId(id);
  return {
    id,
    platform: 'youtube',
    url: `https://www.youtube.com/watch?v=${videoId}`,
    title: `t_rls104_${videoId}`,
    creator_name: `t_rls104_${videoId}`,
  };
}

describe('T-RLS-104 mentions insert', () => {
  it.each(['anon', ...NON_ADMIN] as const)('T-RLS-104 %s cannot insert a mention', async (role) => {
    const id = randomUUID();
    await expectPolicy({
      table: 'mentions',
      op: 'insert',
      role,
      allowed: false,
      row: mentionRow(id),
    });
    const { data } = await service.from('mentions').select('id').eq('id', id);
    expect(data).toEqual([]);
  });

  it.each(['anon', ...NON_ADMIN] as const)(
    'T-RLS-104 %s cannot insert a PUBLISHED mention either (the insert policy is role-only)',
    async (role) => {
      const id = randomUUID();
      await expectPolicy({
        table: 'mentions',
        op: 'insert',
        role,
        allowed: false,
        row: { ...mentionRow(id), status: 'published' },
      });
      const { data } = await service.from('mentions').select('id').eq('id', id);
      expect(data).toEqual([]);
    },
  );

  it.each(['admin', 'service'] as const)(
    'T-RLS-104 %s inserts a minimal mention (defaults: manual draft, not featured, about OddSense generally)',
    async (role) => {
      const id = randomUUID();
      await expectPolicy({
        table: 'mentions',
        op: 'insert',
        role,
        allowed: true,
        row: mentionRow(id),
        expectRows: 1,
      });
      const removed = await service
        .from('mentions')
        .delete()
        .eq('id', id)
        .select(
          'project_id, external_id, creator_url, thumbnail_url, published_at, view_count, status, source, featured, sort_order, created_by',
        );
      expect(removed.error).toBeNull();
      expect(removed.data).toEqual([
        {
          project_id: null,
          external_id: null,
          creator_url: null,
          thumbnail_url: null,
          published_at: null,
          view_count: null,
          status: 'draft',
          source: 'manual',
          featured: false,
          sort_order: 0,
          created_by: null,
        },
      ]);
    },
  );

  it('T-RLS-104 service cannot insert a second row with the same url (mentions_url_key → the action’s conflict)', async () => {
    const duplicate = await service
      .from('mentions')
      .insert({
        platform: 'youtube',
        url: SEED_YOUTUBE_URL,
        title: 't_rls104_duplicate',
        creator_name: 't_rls104_duplicate',
      })
      .select('id');
    expect(duplicate.error?.code).toBe('23505');
    expect(duplicate.error?.message).toContain('mentions_url_key');
  });

  it('T-RLS-104 the unique is on the exact url: the same video under another url spelling is a different row', async () => {
    // Canonicalising is `createMention`'s job (04 §1.6) — the table only sees byte-identical urls.
    const id = await makeMention({
      url: `https://www.youtube.com/watch?v=seedvid0001&t_rls104=${randomUUID()}`,
      external_id: 'seedvid0001',
    });
    const { data } = await service.from('mentions').select('external_id').eq('id', id).single();
    expect(data?.external_id).toBe('seedvid0001');
  });

  it.each([
    [
      'a non-https url',
      { url: 'http://www.youtube.com/watch?v=t_rls104_h0' },
      'mentions_url_format',
    ],
    ['a url that is not a url', { url: 'javascript:alert(1)' }, 'mentions_url_format'],
    [
      'a url over 2048 chars',
      { url: `https://example.com/${'a'.repeat(2048)}` },
      'mentions_url_format',
    ],
    ['an empty title', { title: '' }, 'mentions_title_length'],
    ['a 201-char title', { title: 't'.repeat(201) }, 'mentions_title_length'],
    ['an empty creator_name', { creator_name: '' }, 'mentions_creator_name_length'],
    ['an 81-char creator_name', { creator_name: 'c'.repeat(81) }, 'mentions_creator_name_length'],
    ['a negative view_count', { view_count: -1 }, 'mentions_view_count_check'],
    ['an empty external_id', { external_id: '' }, 'mentions_external_id_length'],
    [
      'a 65-char external_id',
      { platform: 'tiktok', external_id: 'x'.repeat(65) },
      'mentions_external_id_length',
    ],
    [
      'a 12-char YouTube external_id',
      { external_id: 't_twelve_chr' },
      'mentions_youtube_external_id_format',
    ],
    [
      'a YouTube external_id with a bad char',
      { external_id: 't_bad.char0' },
      'mentions_youtube_external_id_format',
    ],
  ] as const)('T-RLS-104 service cannot insert %s (23514)', async (_label, patch, constraint) => {
    const id = randomUUID();
    const result = await service
      .from('mentions')
      .insert({
        id,
        platform: 'youtube',
        url: `https://www.youtube.com/watch?v=${factoryYoutubeId(id)}`,
        title: 't_rls104_check',
        creator_name: 't_rls104_check',
        ...patch,
      })
      .select('id');
    expect(result.error?.code).toBe('23514');
    expect(result.error?.message).toContain(constraint);
    const { data } = await service.from('mentions').select('id').eq('id', id);
    expect(data).toEqual([]);
  });

  it('T-RLS-104 the limits themselves are accepted: 200-char title, 80-char creator, 2048-char url, 0 views, a non-YouTube external_id of any shape', async () => {
    const prefix = `https://example.com/t_rls104_${randomUUID()}/`;
    const id = await makeMention({
      platform: 'article',
      url: `${prefix}${'a'.repeat(2048 - prefix.length)}`,
      external_id: 'not-eleven-chars.at-all',
      title: 't'.repeat(200),
      creator_name: 'c'.repeat(80),
      view_count: 0,
    });
    const { data } = await service
      .from('mentions')
      .select('url, title, creator_name, external_id, view_count')
      .eq('id', id)
      .single();
    expect(data?.url).toHaveLength(2048);
    expect(data?.title).toHaveLength(200);
    expect(data?.creator_name).toHaveLength(80);
    expect(data?.external_id).toBe('not-eleven-chars.at-all');
    expect(data?.view_count).toBe(0);
  });

  it('T-RLS-104 view_count is a bigint: a count past int4 round-trips as a number', async () => {
    const id = await makeMention({ view_count: 5_000_000_000 });
    const { data } = await service.from('mentions').select('view_count').eq('id', id).single();
    expect(data?.view_count).toBe(5_000_000_000);
  });

  it.each([
    ['platform', { platform: 'instagram' }],
    ['status', { status: 'archived' }],
    ['source', { source: 'import' }],
  ] as const)(
    'T-RLS-104 service cannot insert an unknown %s (enum → 22P02)',
    async (_column, patch) => {
      const id = randomUUID();
      // The generated Insert type (rightly) refuses these values — `loose` sends them anyway.
      const row: RowValues = { ...mentionRow(id), ...patch };
      const result = await loose(service).from('mentions').insert(row).select('id');
      expect(result.error?.code).toBe('22P02');
      const { data } = await service.from('mentions').select('id').eq('id', id);
      expect(data).toEqual([]);
    },
  );

  it('T-RLS-104 service cannot hang a mention on a project that does not exist (23503)', async () => {
    const row: RowValues = { ...mentionRow(randomUUID()), project_id: randomUUID() };
    const result = await loose(service).from('mentions').insert(row).select('id');
    expect(result.error?.code).toBe('23503');
    expect(result.error?.message).toContain('mentions_project_id_fkey');
  });

  it('T-RLS-104 the FK columns and the newest-first read are indexed (ADR-0030 D11)', () => {
    const rows = sql(
      "select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = 'mentions' order by indexname",
    );
    const byName = new Map(rows.map(([name, def]) => [name ?? '', def ?? '']));
    expect([...byName.keys()]).toEqual([
      'mentions_created_by_idx',
      'mentions_pkey',
      'mentions_project_id_idx',
      'mentions_status_published_at_idx',
      'mentions_url_key',
    ]);
    expect(byName.get('mentions_project_id_idx')).toContain('(project_id)');
    expect(byName.get('mentions_created_by_idx')).toContain('(created_by)');
    expect(byName.get('mentions_status_published_at_idx')).toContain('(status, published_at DESC)');
    // A plain (non-partial) unique — what `createMention` maps from 23505 (04 §1.6).
    expect(byName.get('mentions_url_key')).toMatch(/^CREATE UNIQUE INDEX .* \(url\)$/);
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-105 update — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-105 mentions update', () => {
  it.each(['anon', ...NON_ADMIN] as const)(
    'T-RLS-105 %s cannot hide, un-feature, reorder or re-title the seed mention',
    async (role) => {
      await expectPolicy({
        table: 'mentions',
        op: 'update',
        role,
        allowed: false,
        filter: { id: SEED_MENTIONS.youtube },
        patch: { status: 'hidden', featured: false, sort_order: 99, title: 't_rls105' },
      });
      const { data } = await service
        .from('mentions')
        .select('status, featured, sort_order, title')
        .eq('id', SEED_MENTIONS.youtube)
        .single();
      expect(data).toEqual({
        status: 'published',
        featured: true,
        sort_order: 1,
        title: SEED_YOUTUBE_TITLE,
      });
    },
  );

  it.each(['anon', ...NON_ADMIN] as const)(
    'T-RLS-105 %s cannot publish a draft (factory) or move a mention onto another project',
    async (role) => {
      const draftId = await makeMention({ status: 'draft' });
      await expectPolicy({
        table: 'mentions',
        op: 'update',
        role,
        allowed: false,
        filter: { id: draftId },
        patch: { status: 'published' },
      });
      await expectPolicy({
        table: 'mentions',
        op: 'update',
        role,
        allowed: false,
        filter: { id: SEED_MENTIONS.tiktok },
        patch: { project_id: SEED_PROJECTS.pixelChameleon },
      });
      const draft = await service.from('mentions').select('status').eq('id', draftId).single();
      expect(draft.data?.status).toBe('draft');
      const seed = await service
        .from('mentions')
        .select('project_id')
        .eq('id', SEED_MENTIONS.tiktok)
        .single();
      expect(seed.data?.project_id).toBeNull();
    },
  );

  it.each(['admin', 'service'] as const)(
    'T-RLS-105 %s updates a mention (factory) and the updated_at trigger moves',
    async (role) => {
      const id = await makeMention({ status: 'draft' });
      const before = await service
        .from('mentions')
        .select('created_at, updated_at')
        .eq('id', id)
        .single();
      await expectPolicy({
        table: 'mentions',
        op: 'update',
        role,
        allowed: true,
        filter: { id },
        patch: {
          status: 'published',
          featured: true,
          sort_order: 7,
          project_id: SEED_PROJECTS.pixelChameleon,
          view_count: 42,
        },
        expectRows: 1,
      });
      const after = await service
        .from('mentions')
        .select('status, featured, sort_order, project_id, view_count, created_at, updated_at')
        .eq('id', id)
        .single();
      expect(after.data).toMatchObject({
        status: 'published',
        featured: true,
        sort_order: 7,
        project_id: SEED_PROJECTS.pixelChameleon,
        view_count: 42,
      });
      expect(after.data?.created_at).toBe(before.data?.created_at);
      expect(Date.parse(after.data?.updated_at ?? '')).toBeGreaterThan(
        Date.parse(before.data?.updated_at ?? ''),
      );
    },
  );

  it('T-RLS-105 an update cannot break a CHECK or collide with another url (23514 / 23505)', async () => {
    const id = await makeMention();
    const negative = await service
      .from('mentions')
      .update({ view_count: -5 })
      .eq('id', id)
      .select('id');
    expect(negative.error?.code).toBe('23514');
    const collide = await service
      .from('mentions')
      .update({ url: SEED_YOUTUBE_URL })
      .eq('id', id)
      .select('id');
    expect(collide.error?.code).toBe('23505');
    // A YouTube row cannot take a malformed id later either (the check spans platform + external_id).
    const malformed = await service
      .from('mentions')
      .update({ external_id: 'too-short' })
      .eq('id', id)
      .select('id');
    expect(malformed.error?.code).toBe('23514');
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-106 delete — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-106 mentions delete', () => {
  it.each(['anon', ...NON_ADMIN] as const)('T-RLS-106 %s cannot delete a mention', async (role) => {
    await expectPolicy({
      table: 'mentions',
      op: 'delete',
      role,
      allowed: false,
      filter: { id: SEED_MENTIONS.youtube },
    });
    const { data } = await service.from('mentions').select('id').eq('id', SEED_MENTIONS.youtube);
    expect(data).toHaveLength(1);
  });

  it.each(['admin', 'service'] as const)(
    'T-RLS-106 %s deletes a mention (factory)',
    async (role) => {
      const id = await makeMention();
      await expectPolicy({
        table: 'mentions',
        op: 'delete',
        role,
        allowed: true,
        filter: { id },
        expectRows: 1,
      });
    },
  );

  it('T-RLS-106 deleting the project does NOT delete its mention — project_id goes NULL (01 INV-24; on delete set null)', async () => {
    const projectId = await makeProject({ status: 'published' });
    const id = await makeMention({ project_id: projectId });
    const gone = await service.from('projects').delete().eq('id', projectId).select('id');
    expect(gone.error).toBeNull();
    expect(gone.data).toHaveLength(1);
    const { data } = await service
      .from('mentions')
      .select('id, project_id, status')
      .eq('id', id)
      .single();
    expect(data).toEqual({ id, project_id: null, status: 'published' });
  });

  it('T-RLS-106 deleting the admin who added it does NOT delete the mention — created_by goes NULL', async () => {
    const adminId = await makeUser({ role: 'admin' });
    const id = await makeMention({ created_by: adminId });
    const stamped = await service.from('mentions').select('created_by').eq('id', id).single();
    expect(stamped.data?.created_by).toBe(adminId);
    const removed = await service.auth.admin.deleteUser(adminId);
    expect(removed.error).toBeNull();
    const { data } = await service.from('mentions').select('id, created_by').eq('id', id).single();
    expect(data).toEqual({ id, created_by: null });
    // The seed rows keep their creator (nothing above touched …0001).
    const seed = await service
      .from('mentions')
      .select('created_by')
      .eq('id', SEED_MENTIONS.youtube)
      .single();
    expect(seed.data?.created_by).toBe(SEED_USERS.oddsense);
  });
});
