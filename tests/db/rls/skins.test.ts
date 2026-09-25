/**
 * tests/db/rls/skins.test.ts — RLS matrix for `skins` (docs/build/05-test-plan.md §7.1
 * T-RLS-53..57; data-model §4 row "videos, skins, art": published to all; admin all — drafts;
 * insert/update/delete admin — ADR-0002 C7). Policies:
 * supabase/migrations/20260925120000_skins_art.sql — select = `status = 'published'` or
 * `is_admin()`; insert/update/delete = `is_admin()` only (a moderator is a plain D — `/admin/skins`
 * shows a mod the published rows read-only); `createSkin` / `updateSkin` / `renderSkinBust` /
 * `record_skin_download` writes bypass RLS via service. Cell order of every cell comment:
 * anon | user | banned | mod | admin | svc.
 *
 * Select cells read the SEED-7 rows (2, both published). Seed rows stay read-only (H-1): denied
 * write cells target seed `…0601` and are proven no-ops through `service`; allowed write cells use
 * factory rows (`makeSkin`, `fixture: null` — no object needed to prove a policy) or direct service
 * inserts removed in the same test, all removed by `cleanupFactories`. Assertions are scoped to
 * seed / factory ids — never to table-wide counts.
 *
 * No new ids (H-13) — the table's constraints ride the cells that exercise them:
 *   T-RLS-55  defaults of a minimal insert; `skins_slug_key` (23505); the CHECKs (23514: slug
 *             format, name 1..60, description_md ≤ 5000, downloads ≥ 0, and the OWNER-PATH rules
 *             `skins_texture_path_own` / `skins_render_bust_path_own` — the S1.2 security-round
 *             debt, ADR-0048 D2); the enums (22P02); the indexes (catalog).
 *   T-RLS-56  update incl. `downloads` (the 05 row's own words); the shared `set_updated_at()`
 *             trigger (01 INV-97); an update cannot break a CHECK / collide on slug.
 * The three RPCs are T-RLS-129 (`_rpc-grants.test.ts`); the bucket is T-RLS-121 (`skins-bucket.test.ts`).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { asRole, loose, type TestRole } from '@/tests/helpers/asRole';
import { sql } from '@/tests/helpers/db';
import { expectPolicy, type RowValues } from '@/tests/helpers/expectPolicy';
import { cleanupFactories, factorySkinTexturePath, makeSkin } from '@/tests/helpers/factories';
import { SEED_SKINS } from '@/tests/helpers/seedIds';

/** Signed-in, non-admin roles — every cell below is identical for them (mod is plain D on writes, ADR-0002 C7). */
const NON_ADMIN = ['user', 'banned', 'mod'] as const satisfies readonly TestRole[];
const service = asRole('service');

const SEED_IDS = [SEED_SKINS.skinA, SEED_SKINS.skinB];
const SEED_A_NAME = 'Seed Skin A';
const SEED_A_DESCRIPTION = 'The one that started it. Plain, dependable, slightly cursed.';

/** A factory draft with no Storage object — enough to prove a select / write policy. */
const draftSkin = (): Promise<string> => makeSkin({ status: 'draft', fixture: null });

afterAll(cleanupFactories);

// ---------------------------------------------------------------------------------------------
// T-RLS-53 select status='published' — pub | pub | pub | pub | A | A
// ---------------------------------------------------------------------------------------------
describe("T-RLS-53 skins select status='published'", () => {
  it.each(['anon', ...NON_ADMIN] as const)(
    'T-RLS-53 %s sees both published seed rows and never a draft',
    async (role) => {
      const draftId = await draftSkin();
      const { data, error } = await asRole(role).from('skins').select('id, status');
      expect(error).toBeNull();
      const ids = new Set((data ?? []).map((r) => r.id));
      for (const id of SEED_IDS) expect(ids.has(id), id).toBe(true);
      expect(ids.has(draftId)).toBe(false);
      for (const row of data ?? []) expect(row.status).toBe('published');
    },
  );

  it.each(['admin', 'service'] as const)(
    'T-RLS-53 %s sees the published seed rows and a draft next to them',
    async (role) => {
      const draftId = await draftSkin();
      const { data, error } = await asRole(role).from('skins').select('id');
      expect(error).toBeNull();
      const ids = new Set((data ?? []).map((r) => r.id));
      for (const id of [...SEED_IDS, draftId]) expect(ids.has(id), id).toBe(true);
    },
  );

  it('T-RLS-53 anon reads the seed rows as SEED-7 documents them (ADR-0048 D20) — the column set is closed', async () => {
    const { data, error } = await asRole('anon').from('skins').select('*').in('id', SEED_IDS);
    expect(error).toBeNull();
    const byId = new Map((data ?? []).map((row) => [row.id, row]));
    expect(byId.get(SEED_SKINS.skinA)).toMatchObject({
      slug: 'seed-skin-a',
      name: SEED_A_NAME,
      description_md: SEED_A_DESCRIPTION,
      texture_path: `skins/${SEED_SKINS.skinA}/texture.png`,
      model: 'classic',
      render_bust_path: `skins/${SEED_SKINS.skinA}/bust.png`,
      is_exclusive: false,
      status: 'published',
      sort_order: 2,
    });
    expect(byId.get(SEED_SKINS.skinB)).toMatchObject({
      slug: 'seed-skin-b',
      name: 'Seed Skin B',
      description_md: 'Slim arms. Big feelings.',
      texture_path: `skins/${SEED_SKINS.skinB}/texture.png`,
      model: 'slim',
      render_bust_path: null,
      is_exclusive: true,
      status: 'published',
      sort_order: 1,
    });
    expect(Object.keys(byId.get(SEED_SKINS.skinA) ?? {}).sort()).toEqual([
      'created_at',
      'description_md',
      'downloads',
      'id',
      'is_exclusive',
      'model',
      'name',
      'render_bust_path',
      'slug',
      'sort_order',
      'status',
      'texture_path',
      'updated_at',
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-54 select status='draft' (factory) — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
describe("T-RLS-54 skins select status='draft' (factory)", () => {
  it.each(['anon', ...NON_ADMIN] as const)('T-RLS-54 %s cannot see a draft skin', async (role) => {
    const id = await draftSkin();
    await expectPolicy({ table: 'skins', op: 'select', role, allowed: false, filter: { id } });
  });

  it.each(['admin', 'service'] as const)('T-RLS-54 %s reads a draft skin', async (role) => {
    const id = await draftSkin();
    await expectPolicy({
      table: 'skins',
      op: 'select',
      role,
      allowed: true,
      filter: { id },
      expectRows: 1,
    });
  });

  it('T-RLS-54 the status decides, not the slug or the exclusive flag: an exclusive draft is as hidden as any', async () => {
    const id = await makeSkin({ status: 'draft', is_exclusive: true, fixture: null });
    await expectPolicy({
      table: 'skins',
      op: 'select',
      role: 'anon',
      allowed: false,
      filter: { id },
    });
    await expectPolicy({
      table: 'skins',
      op: 'select',
      role: 'mod',
      allowed: false,
      filter: { id },
    });
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-55 insert (admin only — ADR-0002 C7) — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
/** The smallest valid row: the three NOT NULL columns without a default (+ the id the CHECK binds to). */
function skinRow(id: string): RowValues {
  const tag = id.replace(/-/g, '').slice(0, 8);
  return {
    id,
    slug: `t-rls55-${tag}`,
    name: `t_rls55_${tag}`,
    texture_path: factorySkinTexturePath(id),
  };
}

describe('T-RLS-55 skins insert', () => {
  it.each(['anon', ...NON_ADMIN] as const)('T-RLS-55 %s cannot insert a skin', async (role) => {
    const id = randomUUID();
    await expectPolicy({ table: 'skins', op: 'insert', role, allowed: false, row: skinRow(id) });
    const { data } = await service.from('skins').select('id').eq('id', id);
    expect(data).toEqual([]);
  });

  it.each(['anon', ...NON_ADMIN] as const)(
    'T-RLS-55 %s cannot insert a PUBLISHED skin either (the insert policy is role-only)',
    async (role) => {
      const id = randomUUID();
      await expectPolicy({
        table: 'skins',
        op: 'insert',
        role,
        allowed: false,
        row: { ...skinRow(id), status: 'published' },
      });
      const { data } = await service.from('skins').select('id').eq('id', id);
      expect(data).toEqual([]);
    },
  );

  it.each(['admin', 'service'] as const)(
    'T-RLS-55 %s inserts a minimal skin (defaults: classic draft, not exclusive, no bust, 0 downloads)',
    async (role) => {
      const id = randomUUID();
      await expectPolicy({
        table: 'skins',
        op: 'insert',
        role,
        allowed: true,
        row: skinRow(id),
        expectRows: 1,
      });
      const removed = await service
        .from('skins')
        .delete()
        .eq('id', id)
        .select(
          'description_md, model, render_bust_path, is_exclusive, status, sort_order, downloads',
        );
      expect(removed.error).toBeNull();
      expect(removed.data).toEqual([
        {
          description_md: null,
          model: 'classic',
          render_bust_path: null,
          is_exclusive: false,
          status: 'draft',
          sort_order: 0,
          downloads: 0,
        },
      ]);
    },
  );

  it('T-RLS-55 service cannot insert a second row with the seed slug (skins_slug_key → the action’s conflict)', async () => {
    const id = randomUUID();
    const duplicate = await service
      .from('skins')
      .insert({ ...skinRow(id), slug: 'seed-skin-a' } as never)
      .select('id');
    expect(duplicate.error?.code).toBe('23505');
    expect(duplicate.error?.message).toContain('skins_slug_key');
    const { data } = await service.from('skins').select('id').eq('id', id);
    expect(data).toEqual([]);
  });

  it.each([
    ['a 2-char slug', { slug: 'ab' }, 'skins_slug_format'],
    ['a slug with a capital', { slug: 'Seed-skin' }, 'skins_slug_format'],
    ['a slug ending in a dash', { slug: 'seed-skin-' }, 'skins_slug_format'],
    ['a 65-char slug', { slug: 'a'.repeat(65) }, 'skins_slug_format'],
    ['an empty name', { name: '' }, 'skins_name_length'],
    ['a 61-char name', { name: 'n'.repeat(61) }, 'skins_name_length'],
    [
      'a 5001-char description',
      { description_md: 'd'.repeat(5001) },
      'skins_description_md_length',
    ],
    ['negative downloads', { downloads: -1 }, 'skins_downloads_check'],
  ] as const)('T-RLS-55 service cannot insert %s (23514)', async (_label, patch, constraint) => {
    const id = randomUUID();
    const result = await loose(service)
      .from('skins')
      .insert({ ...skinRow(id), ...patch })
      .select('id');
    expect(result.error?.code).toBe('23514');
    expect(result.error?.message).toContain(constraint);
    const { data } = await service.from('skins').select('id').eq('id', id);
    expect(data).toEqual([]);
  });

  it.each([
    [
      'another skin’s texture folder',
      () => ({ texture_path: factorySkinTexturePath(randomUUID()) }),
      'skins_texture_path_own',
    ],
    [
      'the seed skin’s texture',
      () => ({ texture_path: `skins/${SEED_SKINS.skinA}/texture.png` }),
      'skins_texture_path_own',
    ],
    [
      'a texture with another file name',
      (id: string) => ({ texture_path: `skins/${id}/skin.png` }),
      'skins_texture_path_own',
    ],
    [
      'a texture with a trailing segment',
      (id: string) => ({ texture_path: `skins/${id}/texture.png/x` }),
      'skins_texture_path_own',
    ],
    [
      'a texture without the bucket prefix',
      (id: string) => ({ texture_path: `${id}/texture.png` }),
      'skins_texture_path_own',
    ],
    [
      'a texture in another bucket',
      (id: string) => ({ texture_path: `art/${id}/texture.png` }),
      'skins_texture_path_own',
    ],
    [
      'a bust in another skin’s folder',
      () => ({ render_bust_path: `skins/${SEED_SKINS.skinA}/bust.png` }),
      'skins_render_bust_path_own',
    ],
    [
      'a bust with another file name',
      (id: string) => ({ render_bust_path: `skins/${id}/texture.png` }),
      'skins_render_bust_path_own',
    ],
  ] as const)(
    'T-RLS-55 service cannot point a row at %s (23514 — ADR-0048 D2 owner-path CHECK)',
    async (_label, patchFor, constraint) => {
      const id = randomUUID();
      const result = await loose(service)
        .from('skins')
        .insert({ ...skinRow(id), ...patchFor(id) })
        .select('id');
      expect(result.error?.code).toBe('23514');
      expect(result.error?.message).toContain(constraint);
      const { data } = await service.from('skins').select('id').eq('id', id);
      expect(data).toEqual([]);
    },
  );

  it('T-RLS-55 the limits themselves are accepted: 64-char slug, 60-char name, 5000-char description, own bust path', async () => {
    const id = await makeSkin({
      slug: `t${'a'.repeat(63)}`,
      name: 'n'.repeat(60),
      description_md: 'd'.repeat(5000),
      render_bust_path: `skins/${randomUUID()}/bust.png`.replace(
        /skins\/[^/]+/,
        'skins/PLACEHOLDER',
      ),
      fixture: null,
    }).catch(() => null);
    // The placeholder above is deliberately wrong (proves the CHECK fires on makeSkin too) …
    expect(id).toBeNull();
    // … and the real limits pass:
    const okId = randomUUID();
    const accepted = await makeSkin({
      id: okId,
      slug: `t${'a'.repeat(63)}`,
      name: 'n'.repeat(60),
      description_md: 'd'.repeat(5000),
      render_bust_path: `skins/${okId}/bust.png`,
      fixture: null,
    });
    const { data } = await service
      .from('skins')
      .select('slug, name, description_md, render_bust_path')
      .eq('id', accepted)
      .single();
    expect(data?.slug).toHaveLength(64);
    expect(data?.name).toHaveLength(60);
    expect(data?.description_md).toHaveLength(5000);
    expect(data?.render_bust_path).toBe(`skins/${okId}/bust.png`);
  });

  it.each([
    ['model', { model: 'wide' }],
    ['status', { status: 'hidden' }],
  ] as const)(
    'T-RLS-55 service cannot insert an unknown %s (enum → 22P02)',
    async (_column, patch) => {
      const id = randomUUID();
      // The generated Insert type (rightly) refuses these values — `loose` sends them anyway.
      const row: RowValues = { ...skinRow(id), ...patch };
      const result = await loose(service).from('skins').insert(row).select('id');
      expect(result.error?.code).toBe('22P02');
      const { data } = await service.from('skins').select('id').eq('id', id);
      expect(data).toEqual([]);
    },
  );

  it('T-RLS-55 the slug unique and the status/sort read are indexed (catalog)', () => {
    const rows = sql(
      "select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = 'skins' order by indexname",
    );
    const byName = new Map(rows.map(([name, def]) => [name ?? '', def ?? '']));
    expect([...byName.keys()]).toEqual(['skins_pkey', 'skins_slug_key', 'skins_status_sort_idx']);
    expect(byName.get('skins_status_sort_idx')).toContain('(status, sort_order, created_at DESC)');
    // A plain (non-partial) unique — what `createSkin` maps from 23505 (04 §1.5).
    expect(byName.get('skins_slug_key')).toMatch(/^CREATE UNIQUE INDEX .* \(slug\)$/);
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-56 update (incl. downloads) — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-56 skins update (incl. downloads)', () => {
  it.each(['anon', ...NON_ADMIN] as const)(
    'T-RLS-56 %s cannot unpublish, rename, reorder or bump the downloads of the seed skin',
    async (role) => {
      await expectPolicy({
        table: 'skins',
        op: 'update',
        role,
        allowed: false,
        filter: { id: SEED_SKINS.skinA },
        patch: { status: 'draft', name: 't_rls56', sort_order: 99, downloads: 999 },
      });
      const { data } = await service
        .from('skins')
        .select('status, name, sort_order, downloads')
        .eq('id', SEED_SKINS.skinA)
        .single();
      expect(data).toMatchObject({ status: 'published', name: SEED_A_NAME, sort_order: 2 });
      expect(data?.downloads).not.toBe(999);
    },
  );

  it.each(['anon', ...NON_ADMIN] as const)(
    'T-RLS-56 %s cannot publish a draft (factory) or re-point its texture',
    async (role) => {
      const draftId = await draftSkin();
      await expectPolicy({
        table: 'skins',
        op: 'update',
        role,
        allowed: false,
        filter: { id: draftId },
        patch: { status: 'published' },
      });
      await expectPolicy({
        table: 'skins',
        op: 'update',
        role,
        allowed: false,
        filter: { id: draftId },
        patch: { render_bust_path: `skins/${draftId}/bust.png` },
      });
      const draft = await service
        .from('skins')
        .select('status, render_bust_path')
        .eq('id', draftId)
        .single();
      expect(draft.data).toEqual({ status: 'draft', render_bust_path: null });
    },
  );

  it.each(['admin', 'service'] as const)(
    'T-RLS-56 %s updates a skin (factory) incl. downloads, and the updated_at trigger moves',
    async (role) => {
      const id = await draftSkin();
      const before = await service
        .from('skins')
        .select('created_at, updated_at')
        .eq('id', id)
        .single();
      await expectPolicy({
        table: 'skins',
        op: 'update',
        role,
        allowed: true,
        filter: { id },
        patch: {
          status: 'published',
          model: 'slim',
          is_exclusive: true,
          sort_order: 7,
          downloads: 3,
          description_md: 't_rls56 description',
          render_bust_path: `skins/${id}/bust.png`,
        },
        expectRows: 1,
      });
      const after = await service
        .from('skins')
        .select(
          'status, model, is_exclusive, sort_order, downloads, description_md, render_bust_path, created_at, updated_at',
        )
        .eq('id', id)
        .single();
      expect(after.data).toMatchObject({
        status: 'published',
        model: 'slim',
        is_exclusive: true,
        sort_order: 7,
        downloads: 3,
        description_md: 't_rls56 description',
        render_bust_path: `skins/${id}/bust.png`,
      });
      expect(after.data?.created_at).toBe(before.data?.created_at);
      expect(Date.parse(after.data?.updated_at ?? '')).toBeGreaterThan(
        Date.parse(before.data?.updated_at ?? ''),
      );
    },
  );

  it('T-RLS-56 an update cannot break a CHECK, re-point a path outside the row’s folder, or collide on slug (23514 / 23505)', async () => {
    const id = await makeSkin({ fixture: null });
    const negative = await service
      .from('skins')
      .update({ downloads: -5 })
      .eq('id', id)
      .select('id');
    expect(negative.error?.code).toBe('23514');
    expect(negative.error?.message).toContain('skins_downloads_check');
    const foreignTexture = await service
      .from('skins')
      .update({ texture_path: `skins/${SEED_SKINS.skinA}/texture.png` })
      .eq('id', id)
      .select('id');
    expect(foreignTexture.error?.code).toBe('23514');
    expect(foreignTexture.error?.message).toContain('skins_texture_path_own');
    const foreignBust = await service
      .from('skins')
      .update({ render_bust_path: `skins/${SEED_SKINS.skinA}/bust.png` })
      .eq('id', id)
      .select('id');
    expect(foreignBust.error?.code).toBe('23514');
    expect(foreignBust.error?.message).toContain('skins_render_bust_path_own');
    const collide = await service
      .from('skins')
      .update({ slug: 'seed-skin-b' })
      .eq('id', id)
      .select('id');
    expect(collide.error?.code).toBe('23505');
    // Nothing above landed.
    const { data } = await service
      .from('skins')
      .select('downloads, texture_path, render_bust_path')
      .eq('id', id)
      .single();
    expect(data).toEqual({
      downloads: 0,
      texture_path: factorySkinTexturePath(id),
      render_bust_path: null,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-57 delete — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-57 skins delete', () => {
  it.each(['anon', ...NON_ADMIN] as const)('T-RLS-57 %s cannot delete a skin', async (role) => {
    await expectPolicy({
      table: 'skins',
      op: 'delete',
      role,
      allowed: false,
      filter: { id: SEED_SKINS.skinA },
    });
    const { data } = await service.from('skins').select('id').eq('id', SEED_SKINS.skinA);
    expect(data).toHaveLength(1);
  });

  it.each(['admin', 'service'] as const)('T-RLS-57 %s deletes a skin (factory)', async (role) => {
    const id = await makeSkin({ fixture: null });
    await expectPolicy({
      table: 'skins',
      op: 'delete',
      role,
      allowed: true,
      filter: { id },
      expectRows: 1,
    });
  });
});
