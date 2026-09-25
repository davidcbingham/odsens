/**
 * tests/db/data/art.test.ts — `lib/data/art.ts` `listPublishedArt` and the `/admin/art` readers of
 * `lib/data/admin.ts` (`listAdminArt` / `getAdminArt`), against the local stack (00 S1.7.AC6 /
 * AC7 / AC8 "natural size, never cropped; a draft never renders publicly"; 02 route rows `/art`,
 * `/admin/art`; ADR-0048 D17 / D12). Supplementary: the S1.7 §8 row gives the data layer no id
 * of its own (ADR-R9) — the behaviour is e2e-proved by T-E2E-9 (smoke, on seed) and T-E2E-38
 * (publish through `/admin/art`); this file pins the readers' contract where a failure names the
 * reader, and tags its titles with the e2e id it backs.
 *
 * In the db lane `next/cache` `unstable_cache` is the pass-through of tests/helpers/setup.db.ts, so
 * every call is a fresh read on the cookie-less anon client (RLS as a visitor — 05 T-RLS-58/59).
 * The SEED-8 rows are only READ (H-1). Everything else is factory rows (`t_` tagged, `sort_order`
 * far past the seed values and `created_at` dated years away), removed in `afterAll`; assertions
 * are scoped to those ids, never to table-wide counts. The admin readers run through
 * `withActionContext` — the request-cookie client of a real local session, so RLS decides what a
 * moderator sees (05 T-RLS-58/59).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getAdminArt, listAdminArt } from '@/lib/data/admin';
import { listPublishedArt } from '@/lib/data/art';
import { withActionContext } from '@/tests/helpers/callAction';
import { requireTestEnv } from '@/tests/helpers/envTest';
import { cleanupFactories, makeArt } from '@/tests/helpers/factories';
import { SEED_ART } from '@/tests/helpers/seedIds';

const PUBLIC_BASE = (): string =>
  `${requireTestEnv('NEXT_PUBLIC_SUPABASE_URL')}/storage/v1/object/public/art`;

/** Published factory pieces, by the role they play below (all `sort_order` ≥ 100, dated 2031). */
let first: string; // sort_order 100, the NEWER created → before `second`; downloadable .jpg
let second: string; // sort_order 100, older
let third: string; // sort_order 101
/** Never public. */
let draft: string; // sort_order 0 — would lead the list if the status filter slipped

const HASH16 = '0123456789abcdef';

beforeAll(async () => {
  const firstId = '00000000-0000-4000-8000-0000000007a1';
  first = await makeArt({
    id: firstId,
    slug: 't-first-piece',
    title: 't_ first',
    kind: 'render',
    image_path: `art/${firstId}/${HASH16}.jpg`,
    width: 1920,
    height: 1080,
    year: 2026,
    credit: 'some_handle',
    downloadable: true,
    sort_order: 100,
    created_at: '2031-03-02T10:00:00+00:00',
    fixture: null,
  });
  second = await makeArt({
    title: 't_ second',
    sort_order: 100,
    created_at: '2031-03-01T10:00:00+00:00',
    fixture: null,
  });
  third = await makeArt({ title: 't_ third', kind: 'other', sort_order: 101, fixture: null });
  draft = await makeArt({ title: 't_ draft', status: 'draft', sort_order: 0, fixture: null });
});

afterAll(async () => {
  await cleanupFactories();
});

describe('T-E2E-9 backing — listPublishedArt (lib/data/art.ts)', () => {
  it('T-E2E-9 reader: the SEED-8 rows come back mapped — avatar first (sort_order 1), URL resolved, Download only on the downloadable one', async () => {
    const items = await listPublishedArt();
    const ids = items.map((item) => item.id);
    expect(ids.indexOf(SEED_ART.avatar)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(SEED_ART.avatar)).toBeLessThan(ids.indexOf(SEED_ART.thumb));

    const avatarUrl = `${PUBLIC_BASE()}/${SEED_ART.avatar}/b64a4e0e96965d51.png`;
    expect(items.find((item) => item.id === SEED_ART.avatar)).toEqual({
      id: SEED_ART.avatar,
      slug: 'seed-art-avatar',
      title: 'Seed Avatar',
      kind: 'avatar',
      imageUrl: avatarUrl,
      width: 256,
      height: 256,
      year: 2025,
      credit: null,
      downloadable: true,
      downloadHref: `${avatarUrl}?download=seed-art-avatar.png`,
    });
    expect(items.find((item) => item.id === SEED_ART.thumb)).toEqual({
      id: SEED_ART.thumb,
      slug: 'seed-art-thumb',
      title: 'Seed Thumbnail',
      kind: 'thumbnail',
      imageUrl: `${PUBLIC_BASE()}/${SEED_ART.thumb}/6ce87bbf56e4d5f6.png`,
      width: 1280,
      height: 720,
      year: null,
      credit: null,
      downloadable: false,
      downloadHref: null,
    });
  });

  it('T-E2E-9 reader: the image URL it hands next/image serves the SEED-13 PNG, and the Download href serves it as an attachment', async () => {
    const items = await listPublishedArt();
    const avatar = items.find((item) => item.id === SEED_ART.avatar);
    const res = await fetch(avatar?.imageUrl ?? '');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    const download = await fetch(avatar?.downloadHref ?? '');
    expect(download.status).toBe(200);
    expect(download.headers.get('content-disposition')).toContain('seed-art-avatar.png');
  });

  it('T-E2E-9 reader: published only; sort_order asc, then created_at desc, then id — the .jpg download name follows the stored extension', async () => {
    const items = await listPublishedArt();
    const ids = items.map((item) => item.id);
    expect(ids).not.toContain(draft);
    const factoryOrder = ids.filter((id) => [first, second, third].includes(id));
    expect(factoryOrder).toEqual([first, second, third]);
    expect(Math.max(ids.indexOf(SEED_ART.avatar), ids.indexOf(SEED_ART.thumb))).toBeLessThan(
      ids.indexOf(first),
    );
    const firstUrl = `${PUBLIC_BASE()}/${first}/${HASH16}.jpg`;
    expect(items.find((item) => item.id === first)).toEqual({
      id: first,
      slug: 't-first-piece',
      title: 't_ first',
      kind: 'render',
      imageUrl: firstUrl,
      width: 1920,
      height: 1080,
      year: 2026,
      credit: 'some_handle',
      downloadable: true,
      downloadHref: `${firstUrl}?download=t-first-piece.jpg`,
    });
    // Props are serialisable (03 C-19): plain JSON round-trips unchanged; no `status` leaks out.
    expect(JSON.parse(JSON.stringify(items))).toEqual(items);
    expect(Object.keys(items[0] ?? {}).sort()).toEqual([
      'credit',
      'downloadHref',
      'downloadable',
      'height',
      'id',
      'imageUrl',
      'kind',
      'slug',
      'title',
      'width',
      'year',
    ]);
  });
});

describe('T-E2E-38 backing — the /admin/art readers (lib/data/admin.ts)', () => {
  it('T-E2E-38 listAdminArt as admin: every status, newest created first, mapped with URL + stored path', async () => {
    const rows = await withActionContext({ role: 'admin' }, () => listAdminArt());
    const ids = rows.map((row) => row.id);
    for (const id of [first, second, third, draft, SEED_ART.avatar, SEED_ART.thumb]) {
      expect(ids, id).toContain(id);
    }
    expect(ids.indexOf(first)).toBeLessThan(ids.indexOf(second));
    expect(ids.indexOf(second)).toBeLessThan(ids.indexOf(SEED_ART.thumb));
    expect(ids.indexOf(SEED_ART.thumb)).toBeLessThan(ids.indexOf(SEED_ART.avatar));
    const stamps = rows.map((row) => Date.parse(row.createdAt));
    expect(stamps).toEqual([...stamps].sort((a, b) => b - a));

    expect(rows.find((row) => row.id === draft)).toMatchObject({
      id: draft,
      title: 't_ draft',
      kind: 'avatar',
      imageUrl: `${PUBLIC_BASE()}/${draft}/${'0'.repeat(16)}.png`,
      imagePath: `art/${draft}/${'0'.repeat(16)}.png`,
      width: 256,
      height: 256,
      year: null,
      credit: null,
      downloadable: false,
      status: 'draft',
      sortOrder: 0,
    });
    expect(rows.find((row) => row.id === SEED_ART.thumb)).toMatchObject({
      slug: 'seed-art-thumb',
      status: 'published',
      width: 1280,
      height: 720,
      sortOrder: 2,
    });
    expect(JSON.parse(JSON.stringify(rows))).toEqual(rows);
  });

  it('T-E2E-38 listAdminArt as mod: published rows only (RLS — 05 T-RLS-59); the page is read-only for them', async () => {
    const rows = await withActionContext({ role: 'mod' }, () => listAdminArt());
    const ids = rows.map((row) => row.id);
    expect(ids).toContain(first);
    expect(ids).toContain(SEED_ART.avatar);
    expect(ids).not.toContain(draft);
    for (const row of rows) expect(row.status).toBe('published');
  });

  it('T-E2E-38 listAdminArt(limit) caps the list', async () => {
    const rows = await withActionContext({ role: 'admin' }, () => listAdminArt(2));
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.id)).toEqual([first, second]);
  });

  it('T-E2E-38 getAdminArt: the edit pre-fill — admin reads a draft, a mod gets null on it, unknown → null', async () => {
    const asAdmin = await withActionContext({ role: 'admin' }, () => getAdminArt(draft));
    expect(asAdmin).toMatchObject({ id: draft, status: 'draft', title: 't_ draft' });
    const asMod = await withActionContext({ role: 'mod' }, () => getAdminArt(draft));
    expect(asMod).toBeNull();
    const published = await withActionContext({ role: 'mod' }, () => getAdminArt(first));
    expect(published).toMatchObject({ id: first, status: 'published', credit: 'some_handle' });
    const unknown = await withActionContext({ role: 'admin' }, () =>
      getAdminArt('00000000-0000-4000-8000-000000000799'),
    );
    expect(unknown).toBeNull();
  });
});
