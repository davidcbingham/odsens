/**
 * tests/db/data/skins.test.ts — `lib/data/skins.ts` `listPublishedSkins` and the `/admin/skins`
 * readers of `lib/data/admin.ts` (`listAdminSkins` / `getAdminSkin`), against the local stack
 * (00 S1.7.AC1 / AC3 / AC10 "a draft never renders publicly; a skin without a bust shows the live
 * fallback"; 02 route rows `/skins`, `/admin/skins`; ADR-0048 D12). Supplementary: the S1.7 §8
 * row gives the data layer no id of its own (ADR-R9) — the behaviour is e2e-proved by T-E2E-7
 * (smoke, on seed) and T-E2E-38 (publish through `/admin/skins`); this file pins the readers'
 * contract where a failure names the reader, and tags its titles with the e2e id it backs.
 *
 * In the db lane `next/cache` `unstable_cache` is the pass-through of tests/helpers/setup.db.ts, so
 * every call is a fresh read on the cookie-less anon client (RLS as a visitor — 05 T-RLS-53/54).
 * The SEED-7 rows are only READ (H-1). Everything else is factory rows (`t_` tagged, `sort_order`
 * far past the seed values and `created_at` dated years away, so the ordering assertions hold
 * whatever other skins exist), removed in `afterAll`; assertions are scoped to those ids, never to
 * table-wide counts. The admin readers run through `withActionContext` — the request-cookie client
 * of a real local session, so RLS decides what a moderator sees (05 T-RLS-53/54).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getAdminSkin, listAdminSkins } from '@/lib/data/admin';
import { listPublishedSkins } from '@/lib/data/skins';
import { withActionContext } from '@/tests/helpers/callAction';
import { requireTestEnv } from '@/tests/helpers/envTest';
import { cleanupFactories, makeSkin } from '@/tests/helpers/factories';
import { SEED_SKINS } from '@/tests/helpers/seedIds';

const PUBLIC_BASE = (): string =>
  `${requireTestEnv('NEXT_PUBLIC_SUPABASE_URL')}/storage/v1/object/public/skins`;

/** Published factory skins, by the role they play below (all `sort_order` ≥ 100, dated 2031). */
let first: string; // sort_order 100, the NEWER created → before `second`
let second: string; // sort_order 100, older
let third: string; // sort_order 101
/** Never public. */
let draft: string; // sort_order 0 — would lead the list if the status filter slipped

beforeAll(async () => {
  first = await makeSkin({
    name: 't_ first',
    description_md: 't_ **bold** description',
    model: 'slim',
    is_exclusive: true,
    sort_order: 100,
    downloads: 4,
    created_at: '2031-03-02T10:00:00+00:00',
    fixture: null,
  });
  second = await makeSkin({
    name: 't_ second',
    sort_order: 100,
    created_at: '2031-03-01T10:00:00+00:00',
    fixture: null,
  });
  third = await makeSkin({ name: 't_ third', sort_order: 101, fixture: null });
  draft = await makeSkin({ name: 't_ draft', status: 'draft', sort_order: 0, fixture: null });
});

afterAll(async () => {
  await cleanupFactories();
});

describe('T-E2E-7 backing — listPublishedSkins (lib/data/skins.ts)', () => {
  it('T-E2E-7 reader: the SEED-7 rows come back mapped — seed-skin-b FIRST (sort_order 1), URLs resolved, bust null on …0602', async () => {
    const skins = await listPublishedSkins();
    const ids = skins.map((skin) => skin.id);
    expect(ids.indexOf(SEED_SKINS.skinB)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(SEED_SKINS.skinB)).toBeLessThan(ids.indexOf(SEED_SKINS.skinA));

    const a = skins.find((skin) => skin.id === SEED_SKINS.skinA);
    const b = skins.find((skin) => skin.id === SEED_SKINS.skinB);
    expect(a).toEqual({
      id: SEED_SKINS.skinA,
      slug: 'seed-skin-a',
      name: 'Seed Skin A',
      model: 'classic',
      textureUrl: `${PUBLIC_BASE()}/${SEED_SKINS.skinA}/texture.png`,
      bustUrl: `${PUBLIC_BASE()}/${SEED_SKINS.skinA}/bust.png`,
      exclusive: false,
      descriptionMd: 'The one that started it. Plain, dependable, slightly cursed.',
      downloads: 0,
    });
    expect(b).toEqual({
      id: SEED_SKINS.skinB,
      slug: 'seed-skin-b',
      name: 'Seed Skin B',
      model: 'slim',
      textureUrl: `${PUBLIC_BASE()}/${SEED_SKINS.skinB}/texture.png`,
      bustUrl: null,
      exclusive: true,
      descriptionMd: 'Slim arms. Big feelings.',
      downloads: 0,
    });
  });

  it('T-E2E-7 reader: the texture URL it hands the viewer actually serves the SEED-13 PNG', async () => {
    const skins = await listPublishedSkins();
    const b = skins.find((skin) => skin.id === SEED_SKINS.skinB);
    const res = await fetch(b?.textureUrl ?? '');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    const a = skins.find((skin) => skin.id === SEED_SKINS.skinA);
    expect((await fetch(a?.bustUrl ?? '')).status).toBe(200);
  });

  it('T-E2E-7 reader: published only; sort_order asc, then created_at desc, then id — camelCase, serialisable', async () => {
    const skins = await listPublishedSkins();
    const ids = skins.map((skin) => skin.id);
    expect(ids).not.toContain(draft);
    const factoryOrder = ids.filter((id) => [first, second, third].includes(id));
    expect(factoryOrder).toEqual([first, second, third]);
    // The seed rows (sort_order 1 / 2) come before every factory row (≥ 100).
    expect(Math.max(ids.indexOf(SEED_SKINS.skinA), ids.indexOf(SEED_SKINS.skinB))).toBeLessThan(
      ids.indexOf(first),
    );
    expect(skins.find((skin) => skin.id === first)).toEqual({
      id: first,
      slug: expect.stringMatching(/^t-[0-9a-f]{8}$/) as string,
      name: 't_ first',
      model: 'slim',
      textureUrl: `${PUBLIC_BASE()}/${first}/texture.png`,
      bustUrl: null,
      exclusive: true,
      descriptionMd: 't_ **bold** description',
      downloads: 4,
    });
    // Props are serialisable (03 C-19): plain JSON round-trips unchanged; no `status` leaks out.
    expect(JSON.parse(JSON.stringify(skins))).toEqual(skins);
    expect(Object.keys(skins[0] ?? {}).sort()).toEqual([
      'bustUrl',
      'descriptionMd',
      'downloads',
      'exclusive',
      'id',
      'model',
      'name',
      'slug',
      'textureUrl',
    ]);
  });
});

describe('T-E2E-38 backing — the /admin/skins readers (lib/data/admin.ts)', () => {
  it('T-E2E-38 listAdminSkins as admin: every status, newest created first, mapped with URLs', async () => {
    const rows = await withActionContext({ role: 'admin' }, () => listAdminSkins());
    const ids = rows.map((row) => row.id);
    for (const id of [first, second, third, draft, SEED_SKINS.skinA, SEED_SKINS.skinB]) {
      expect(ids, id).toContain(id);
    }
    // created_at desc: the 2031-dated factory rows lead, newest first; the seed rows follow.
    expect(ids.indexOf(first)).toBeLessThan(ids.indexOf(second));
    expect(ids.indexOf(second)).toBeLessThan(ids.indexOf(SEED_SKINS.skinB));
    expect(ids.indexOf(SEED_SKINS.skinB)).toBeLessThan(ids.indexOf(SEED_SKINS.skinA));
    const stamps = rows.map((row) => Date.parse(row.createdAt));
    expect(stamps).toEqual([...stamps].sort((a, b) => b - a));

    expect(rows.find((row) => row.id === draft)).toMatchObject({
      id: draft,
      name: 't_ draft',
      descriptionMd: null,
      model: 'classic',
      textureUrl: `${PUBLIC_BASE()}/${draft}/texture.png`,
      bustUrl: null,
      exclusive: false,
      status: 'draft',
      sortOrder: 0,
      downloads: 0,
    });
    expect(rows.find((row) => row.id === SEED_SKINS.skinA)).toMatchObject({
      slug: 'seed-skin-a',
      status: 'published',
      bustUrl: `${PUBLIC_BASE()}/${SEED_SKINS.skinA}/bust.png`,
      sortOrder: 2,
    });
    expect(JSON.parse(JSON.stringify(rows))).toEqual(rows);
  });

  it('T-E2E-38 listAdminSkins as mod: published rows only (RLS — 05 T-RLS-54); the page is read-only for them', async () => {
    const rows = await withActionContext({ role: 'mod' }, () => listAdminSkins());
    const ids = rows.map((row) => row.id);
    expect(ids).toContain(first);
    expect(ids).toContain(SEED_SKINS.skinA);
    expect(ids).not.toContain(draft);
    for (const row of rows) expect(row.status).toBe('published');
  });

  it('T-E2E-38 listAdminSkins(limit) caps the list', async () => {
    const rows = await withActionContext({ role: 'admin' }, () => listAdminSkins(2));
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.id)).toEqual([first, second]);
  });

  it('T-E2E-38 getAdminSkin: the edit pre-fill — admin reads a draft, a mod gets null on it, unknown → null', async () => {
    const asAdmin = await withActionContext({ role: 'admin' }, () => getAdminSkin(draft));
    expect(asAdmin).toMatchObject({ id: draft, status: 'draft', name: 't_ draft' });
    const asMod = await withActionContext({ role: 'mod' }, () => getAdminSkin(draft));
    expect(asMod).toBeNull();
    const published = await withActionContext({ role: 'mod' }, () => getAdminSkin(first));
    expect(published).toMatchObject({ id: first, status: 'published', exclusive: true });
    const unknown = await withActionContext({ role: 'admin' }, () =>
      getAdminSkin('00000000-0000-4000-8000-000000000699'),
    );
    expect(unknown).toBeNull();
  });
});
