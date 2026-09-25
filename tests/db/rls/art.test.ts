/**
 * tests/db/rls/art.test.ts — RLS matrix for `art` (docs/build/05-test-plan.md §7.1 T-RLS-58..62;
 * data-model §4 row "videos, skins, art": published to all; admin all — drafts; insert/update/
 * delete admin — ADR-0002 C7). Policies: supabase/migrations/20260925120000_skins_art.sql — select
 * = `status = 'published'` or `is_admin()`; insert/update/delete = `is_admin()` only (a moderator
 * is a plain D — `/admin/art` shows a mod the published rows read-only); `createArt` / `updateArt`
 * writes bypass RLS via service. Cell order of every cell comment:
 * anon | user | banned | mod | admin | svc.
 *
 * Select cells read the SEED-8 rows (2, both published). Seed rows stay read-only (H-1): denied
 * write cells target seed `…0701` and are proven no-ops through `service`; allowed write cells use
 * factory rows (`makeArt`, `fixture: null` — no object needed to prove a policy) or direct service
 * inserts removed in the same test, all removed by `cleanupFactories`. Assertions are scoped to
 * seed / factory ids — never to table-wide counts.
 *
 * No new ids (H-13) — the table's constraints ride the cells that exercise them:
 *   T-RLS-60  defaults of a minimal insert; `art_slug_key` (23505); the CHECKs (23514: slug
 *             format, title 1..80, width / height 1..8192, year 2015..2100, credit ≤ 40 of
 *             `[A-Za-z0-9_ .-]` — a handle, never an address, and the OWNER-PATH rule
 *             `art_image_path_own` — the S1.2 security-round debt, ADR-0048 D2); the enums
 *             (22P02); the indexes (catalog).
 *   T-RLS-61  the shared `set_updated_at()` trigger (01 INV-97); an update cannot break a CHECK /
 *             collide on slug.
 * The reorder RPC is T-RLS-129 (`_rpc-grants.test.ts`); the bucket is T-RLS-122 (`art-bucket.test.ts`).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { asRole, loose, type TestRole } from '@/tests/helpers/asRole';
import { sql } from '@/tests/helpers/db';
import { expectPolicy, type RowValues } from '@/tests/helpers/expectPolicy';
import { cleanupFactories, makeArt } from '@/tests/helpers/factories';
import { SEED_ART } from '@/tests/helpers/seedIds';

/** Signed-in, non-admin roles — every cell below is identical for them (mod is plain D on writes, ADR-0002 C7). */
const NON_ADMIN = ['user', 'banned', 'mod'] as const satisfies readonly TestRole[];
const service = asRole('service');

const SEED_IDS = [SEED_ART.avatar, SEED_ART.thumb];
const SEED_AVATAR_TITLE = 'Seed Avatar';
const SEED_AVATAR_PATH = `art/${SEED_ART.avatar}/b64a4e0e96965d51.png`;
/** A content hash the way the commit phase writes one (04 SC-21) — any 16 lowercase hex chars. */
const HASH16 = '0123456789abcdef';

/** `art/<id>/<hash16>.png` — the only folder the CHECK accepts for that id. */
const ownPath = (id: string, name = `${HASH16}.png`): string => `art/${id}/${name}`;

/** A factory draft with no Storage object — enough to prove a select / write policy. */
const draftArt = (): Promise<string> => makeArt({ status: 'draft', fixture: null });

afterAll(cleanupFactories);

// ---------------------------------------------------------------------------------------------
// T-RLS-58 select status='published' — pub | pub | pub | pub | A | A
// ---------------------------------------------------------------------------------------------
describe("T-RLS-58 art select status='published'", () => {
  it.each(['anon', ...NON_ADMIN] as const)(
    'T-RLS-58 %s sees both published seed rows and never a draft',
    async (role) => {
      const draftId = await draftArt();
      const { data, error } = await asRole(role).from('art').select('id, status');
      expect(error).toBeNull();
      const ids = new Set((data ?? []).map((r) => r.id));
      for (const id of SEED_IDS) expect(ids.has(id), id).toBe(true);
      expect(ids.has(draftId)).toBe(false);
      for (const row of data ?? []) expect(row.status).toBe('published');
    },
  );

  it.each(['admin', 'service'] as const)(
    'T-RLS-58 %s sees the published seed rows and a draft next to them',
    async (role) => {
      const draftId = await draftArt();
      const { data, error } = await asRole(role).from('art').select('id');
      expect(error).toBeNull();
      const ids = new Set((data ?? []).map((r) => r.id));
      for (const id of [...SEED_IDS, draftId]) expect(ids.has(id), id).toBe(true);
    },
  );

  it('T-RLS-58 anon reads the seed rows as SEED-8 documents them (ADR-0048 D20) — the column set is closed', async () => {
    const { data, error } = await asRole('anon').from('art').select('*').in('id', SEED_IDS);
    expect(error).toBeNull();
    const byId = new Map((data ?? []).map((row) => [row.id, row]));
    expect(byId.get(SEED_ART.avatar)).toMatchObject({
      slug: 'seed-art-avatar',
      title: SEED_AVATAR_TITLE,
      kind: 'avatar',
      image_path: SEED_AVATAR_PATH,
      width: 256,
      height: 256,
      year: 2025,
      credit: null,
      downloadable: true,
      status: 'published',
      sort_order: 1,
    });
    expect(byId.get(SEED_ART.thumb)).toMatchObject({
      slug: 'seed-art-thumb',
      title: 'Seed Thumbnail',
      kind: 'thumbnail',
      image_path: `art/${SEED_ART.thumb}/6ce87bbf56e4d5f6.png`,
      width: 1280,
      height: 720,
      year: null,
      credit: null,
      downloadable: false,
      status: 'published',
      sort_order: 2,
    });
    // No PII column exists: `credit` is the only person-shaped field and it is a handle (00 S1.7).
    expect(Object.keys(byId.get(SEED_ART.avatar) ?? {}).sort()).toEqual([
      'created_at',
      'credit',
      'downloadable',
      'height',
      'id',
      'image_path',
      'kind',
      'slug',
      'sort_order',
      'status',
      'title',
      'updated_at',
      'width',
      'year',
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-59 select status='draft' (factory) — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
describe("T-RLS-59 art select status='draft' (factory)", () => {
  it.each(['anon', ...NON_ADMIN] as const)('T-RLS-59 %s cannot see a draft piece', async (role) => {
    const id = await draftArt();
    await expectPolicy({ table: 'art', op: 'select', role, allowed: false, filter: { id } });
  });

  it.each(['admin', 'service'] as const)('T-RLS-59 %s reads a draft piece', async (role) => {
    const id = await draftArt();
    await expectPolicy({
      table: 'art',
      op: 'select',
      role,
      allowed: true,
      filter: { id },
      expectRows: 1,
    });
  });

  it('T-RLS-59 the status decides, not the kind or the downloadable flag', async () => {
    const id = await makeArt({
      status: 'draft',
      kind: 'render',
      downloadable: true,
      fixture: null,
    });
    await expectPolicy({
      table: 'art',
      op: 'select',
      role: 'anon',
      allowed: false,
      filter: { id },
    });
    await expectPolicy({ table: 'art', op: 'select', role: 'mod', allowed: false, filter: { id } });
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-60 insert (admin only — ADR-0002 C7) — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
/** The smallest valid row: the six NOT NULL columns without a default (+ the id the CHECK binds to). */
function artRow(id: string): RowValues {
  const tag = id.replace(/-/g, '').slice(0, 8);
  return {
    id,
    slug: `t-rls60-${tag}`,
    title: `t_rls60_${tag}`,
    kind: 'avatar',
    image_path: ownPath(id),
    width: 256,
    height: 256,
  };
}

describe('T-RLS-60 art insert', () => {
  it.each(['anon', ...NON_ADMIN] as const)('T-RLS-60 %s cannot insert a piece', async (role) => {
    const id = randomUUID();
    await expectPolicy({ table: 'art', op: 'insert', role, allowed: false, row: artRow(id) });
    const { data } = await service.from('art').select('id').eq('id', id);
    expect(data).toEqual([]);
  });

  it.each(['anon', ...NON_ADMIN] as const)(
    'T-RLS-60 %s cannot insert a PUBLISHED piece either (the insert policy is role-only)',
    async (role) => {
      const id = randomUUID();
      await expectPolicy({
        table: 'art',
        op: 'insert',
        role,
        allowed: false,
        row: { ...artRow(id), status: 'published' },
      });
      const { data } = await service.from('art').select('id').eq('id', id);
      expect(data).toEqual([]);
    },
  );

  it.each(['admin', 'service'] as const)(
    'T-RLS-60 %s inserts a minimal piece (defaults: draft, not downloadable, no year / credit, sort 0)',
    async (role) => {
      const id = randomUUID();
      await expectPolicy({
        table: 'art',
        op: 'insert',
        role,
        allowed: true,
        row: artRow(id),
        expectRows: 1,
      });
      const removed = await service
        .from('art')
        .delete()
        .eq('id', id)
        .select('year, credit, downloadable, status, sort_order');
      expect(removed.error).toBeNull();
      expect(removed.data).toEqual([
        { year: null, credit: null, downloadable: false, status: 'draft', sort_order: 0 },
      ]);
    },
  );

  it('T-RLS-60 service cannot insert a second row with the seed slug (art_slug_key → the action’s conflict)', async () => {
    const id = randomUUID();
    const duplicate = await service
      .from('art')
      .insert({ ...artRow(id), slug: 'seed-art-avatar' } as never)
      .select('id');
    expect(duplicate.error?.code).toBe('23505');
    expect(duplicate.error?.message).toContain('art_slug_key');
    const { data } = await service.from('art').select('id').eq('id', id);
    expect(data).toEqual([]);
  });

  it.each([
    ['a 2-char slug', { slug: 'ab' }, 'art_slug_format'],
    ['a slug with a space', { slug: 'seed art' }, 'art_slug_format'],
    ['an empty title', { title: '' }, 'art_title_length'],
    ['an 81-char title', { title: 't'.repeat(81) }, 'art_title_length'],
    ['a zero width', { width: 0 }, 'art_width_check'],
    ['an 8193-px width', { width: 8193 }, 'art_width_check'],
    ['a zero height', { height: 0 }, 'art_height_check'],
    ['an 8193-px height', { height: 8193 }, 'art_height_check'],
    ['year 2014', { year: 2014 }, 'art_year_check'],
    ['year 2101', { year: 2101 }, 'art_year_check'],
    ['a 41-char credit', { credit: 'c'.repeat(41) }, 'art_credit_format'],
    ['an e-mail-shaped credit', { credit: 'a@b.c' }, 'art_credit_format'],
    ['a credit with a slash', { credit: 'some/handle' }, 'art_credit_format'],
  ] as const)('T-RLS-60 service cannot insert %s (23514)', async (_label, patch, constraint) => {
    const id = randomUUID();
    const result = await loose(service)
      .from('art')
      .insert({ ...artRow(id), ...patch })
      .select('id');
    expect(result.error?.code).toBe('23514');
    expect(result.error?.message).toContain(constraint);
    const { data } = await service.from('art').select('id').eq('id', id);
    expect(data).toEqual([]);
  });

  it.each([
    ['another piece’s folder', () => ownPath(randomUUID())],
    ['the seed avatar’s object', () => SEED_AVATAR_PATH],
    ['a name that is not a 16-hex hash', (id: string) => ownPath(id, 'texture.png')],
    ['a 15-hex hash', (id: string) => ownPath(id, `${HASH16.slice(1)}.png`)],
    ['an uppercase hash', (id: string) => ownPath(id, `${HASH16.toUpperCase()}.png`)],
    ['a .gif', (id: string) => ownPath(id, `${HASH16}.gif`)],
    ['a .jpeg (the stored form is .jpg)', (id: string) => ownPath(id, `${HASH16}.jpeg`)],
    ['a pending (uuid) segment', (id: string) => ownPath(id, `${randomUUID()}.png`)],
    ['no bucket prefix', (id: string) => `${id}/${HASH16}.png`],
    ['another bucket', (id: string) => `project-media/${id}/${HASH16}.png`],
  ] as const)(
    'T-RLS-60 service cannot point a row at %s (23514 — ADR-0048 D2 owner-path CHECK)',
    async (_label, pathFor) => {
      const id = randomUUID();
      const result = await loose(service)
        .from('art')
        .insert({ ...artRow(id), image_path: pathFor(id) })
        .select('id');
      expect(result.error?.code).toBe('23514');
      expect(result.error?.message).toContain('art_image_path_own');
      const { data } = await service.from('art').select('id').eq('id', id);
      expect(data).toEqual([]);
    },
  );

  it('T-RLS-60 the limits themselves are accepted: 80-char title, 8192 a side, years 2015 / 2100, a 40-char handle credit, .jpg / .webp', async () => {
    const jpg = randomUUID();
    const webp = randomUUID();
    const [a, b] = await Promise.all([
      makeArt({
        id: jpg,
        title: 't'.repeat(80),
        image_path: ownPath(jpg, `${HASH16}.jpg`),
        width: 8192,
        height: 1,
        year: 2015,
        credit: 'Some_Handle.1 -x'.padEnd(40, 'y'),
        fixture: null,
      }),
      makeArt({
        id: webp,
        image_path: ownPath(webp, `${HASH16}.webp`),
        width: 1,
        height: 8192,
        year: 2100,
        fixture: null,
      }),
    ]);
    const { data } = await service
      .from('art')
      .select('id, title, image_path, width, height, year, credit')
      .in('id', [a, b]);
    const byId = new Map((data ?? []).map((row) => [row.id, row]));
    expect(byId.get(a)?.title).toHaveLength(80);
    expect(byId.get(a)?.credit).toHaveLength(40);
    expect(byId.get(a)).toMatchObject({ width: 8192, height: 1, year: 2015 });
    expect(byId.get(a)?.image_path.endsWith('.jpg')).toBe(true);
    expect(byId.get(b)).toMatchObject({ width: 1, height: 8192, year: 2100 });
    expect(byId.get(b)?.image_path.endsWith('.webp')).toBe(true);
  });

  it.each([
    ['kind', { kind: 'sticker' }],
    ['status', { status: 'hidden' }],
  ] as const)(
    'T-RLS-60 service cannot insert an unknown %s (enum → 22P02)',
    async (_column, patch) => {
      const id = randomUUID();
      // The generated Insert type (rightly) refuses these values — `loose` sends them anyway.
      const row: RowValues = { ...artRow(id), ...patch };
      const result = await loose(service).from('art').insert(row).select('id');
      expect(result.error?.code).toBe('22P02');
      const { data } = await service.from('art').select('id').eq('id', id);
      expect(data).toEqual([]);
    },
  );

  it('T-RLS-60 the slug unique and the status/sort read are indexed (catalog)', () => {
    const rows = sql(
      "select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = 'art' order by indexname",
    );
    const byName = new Map(rows.map(([name, def]) => [name ?? '', def ?? '']));
    expect([...byName.keys()]).toEqual(['art_pkey', 'art_slug_key', 'art_status_sort_idx']);
    expect(byName.get('art_status_sort_idx')).toContain('(status, sort_order, created_at DESC)');
    // A plain (non-partial) unique — what `createArt` maps from 23505 (04 §1.5).
    expect(byName.get('art_slug_key')).toMatch(/^CREATE UNIQUE INDEX .* \(slug\)$/);
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-61 update — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-61 art update', () => {
  it.each(['anon', ...NON_ADMIN] as const)(
    'T-RLS-61 %s cannot unpublish, retitle, reorder or flag the seed piece',
    async (role) => {
      await expectPolicy({
        table: 'art',
        op: 'update',
        role,
        allowed: false,
        filter: { id: SEED_ART.avatar },
        patch: { status: 'draft', title: 't_rls61', sort_order: 99, downloadable: false },
      });
      const { data } = await service
        .from('art')
        .select('status, title, sort_order, downloadable')
        .eq('id', SEED_ART.avatar)
        .single();
      expect(data).toEqual({
        status: 'published',
        title: SEED_AVATAR_TITLE,
        sort_order: 1,
        downloadable: true,
      });
    },
  );

  it.each(['anon', ...NON_ADMIN] as const)(
    'T-RLS-61 %s cannot publish a draft (factory) or re-point its image',
    async (role) => {
      const draftId = await draftArt();
      await expectPolicy({
        table: 'art',
        op: 'update',
        role,
        allowed: false,
        filter: { id: draftId },
        patch: { status: 'published' },
      });
      await expectPolicy({
        table: 'art',
        op: 'update',
        role,
        allowed: false,
        filter: { id: draftId },
        patch: { image_path: ownPath(draftId, `${HASH16}.webp`) },
      });
      const draft = await service
        .from('art')
        .select('status, image_path')
        .eq('id', draftId)
        .single();
      expect(draft.data?.status).toBe('draft');
      expect(draft.data?.image_path.endsWith('.png')).toBe(true);
    },
  );

  it.each(['admin', 'service'] as const)(
    'T-RLS-61 %s updates a piece (factory) and the updated_at trigger moves',
    async (role) => {
      const id = await draftArt();
      const before = await service
        .from('art')
        .select('created_at, updated_at')
        .eq('id', id)
        .single();
      await expectPolicy({
        table: 'art',
        op: 'update',
        role,
        allowed: true,
        filter: { id },
        patch: {
          status: 'published',
          kind: 'thumbnail',
          image_path: ownPath(id, `${HASH16}.jpg`),
          width: 1280,
          height: 720,
          year: 2026,
          credit: 'some_handle',
          downloadable: true,
          sort_order: 7,
        },
        expectRows: 1,
      });
      const after = await service
        .from('art')
        .select(
          'status, kind, image_path, width, height, year, credit, downloadable, sort_order, created_at, updated_at',
        )
        .eq('id', id)
        .single();
      expect(after.data).toMatchObject({
        status: 'published',
        kind: 'thumbnail',
        image_path: ownPath(id, `${HASH16}.jpg`),
        width: 1280,
        height: 720,
        year: 2026,
        credit: 'some_handle',
        downloadable: true,
        sort_order: 7,
      });
      expect(after.data?.created_at).toBe(before.data?.created_at);
      expect(Date.parse(after.data?.updated_at ?? '')).toBeGreaterThan(
        Date.parse(before.data?.updated_at ?? ''),
      );
    },
  );

  it('T-RLS-61 an update cannot break a CHECK, re-point the image outside the row’s folder, or collide on slug (23514 / 23505)', async () => {
    const id = await makeArt({ fixture: null });
    const year = await service.from('art').update({ year: 1999 }).eq('id', id).select('id');
    expect(year.error?.code).toBe('23514');
    expect(year.error?.message).toContain('art_year_check');
    const credit = await service
      .from('art')
      .update({ credit: 'name@example.test' })
      .eq('id', id)
      .select('id');
    expect(credit.error?.code).toBe('23514');
    expect(credit.error?.message).toContain('art_credit_format');
    const foreign = await service
      .from('art')
      .update({ image_path: SEED_AVATAR_PATH })
      .eq('id', id)
      .select('id');
    expect(foreign.error?.code).toBe('23514');
    expect(foreign.error?.message).toContain('art_image_path_own');
    const collide = await service
      .from('art')
      .update({ slug: 'seed-art-thumb' })
      .eq('id', id)
      .select('id');
    expect(collide.error?.code).toBe('23505');
    // Nothing above landed.
    const { data } = await service
      .from('art')
      .select('year, credit, image_path')
      .eq('id', id)
      .single();
    expect(data).toMatchObject({ year: null, credit: null });
    expect(data?.image_path.startsWith(`art/${id}/`)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-62 delete — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-62 art delete', () => {
  it.each(['anon', ...NON_ADMIN] as const)('T-RLS-62 %s cannot delete a piece', async (role) => {
    await expectPolicy({
      table: 'art',
      op: 'delete',
      role,
      allowed: false,
      filter: { id: SEED_ART.avatar },
    });
    const { data } = await service.from('art').select('id').eq('id', SEED_ART.avatar);
    expect(data).toHaveLength(1);
  });

  it.each(['admin', 'service'] as const)('T-RLS-62 %s deletes a piece (factory)', async (role) => {
    const id = await makeArt({ fixture: null });
    await expectPolicy({
      table: 'art',
      op: 'delete',
      role,
      allowed: true,
      filter: { id },
      expectRows: 1,
    });
  });
});
