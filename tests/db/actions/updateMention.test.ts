/**
 * tests/db/actions/updateMention.test.ts — T-ACT-64 (+ T-ACT-69 SC-24 audit line) (05 §7.2; 04 §1.6
 * `updateMention`; 02 §5 tags; 01 INV-24 / INV-40; ADR-0002 C7; ADR-0045 — error codes, RPC
 * `reorder_mentions`; migrations 20260919120000 / 20260919120100; 00 S1.8.AC8 / AC10).
 *
 * Auth matrix on BOTH forms: anon `unauthenticated` · user / banned D `forbidden` · **mod D
 * `forbidden`** (ADR-0002 C7) · admin A — the denied rows never write and never revalidate.
 *
 * `{id, patch}`: `featured`; `status` `published` ↔ `hidden` (a hidden mention leaves the public
 * read at once); reassign `project_id` → revalidates `mentions` + BOTH the old and the new
 * `project:<slug>`, each once; only the keys present are written, `null` clears an optional one,
 * a `url` key is stripped (a mention's link never changes). Unknown `id` → `not_found`; unknown
 * `patch.project_id` → `validation` on `project_id`; a YouTube row must keep an 11-char
 * `external_id` — checked against the STORED half when the patch carries only one of the pair →
 * `validation` on `external_id`. A `suggested` row goes live ONLY by an explicit
 * `patch.status = 'published'`; `suggested` itself is not a value the schema accepts.
 *
 * `{reorder}`: ≤ 200 pairs through RPC `reorder_mentions` = ONE transaction. Reading of the 05
 * cell's "→ sequential ints": the client sends 1..n and the rows hold exactly those values
 * afterwards (the action writes what it is given — nothing is renumbered server-side). An id that
 * matches no row → `not_found` with NOTHING applied. Revalidates `mentions` exactly once.
 *
 * `updateMentionInput` is a union: an input whose SHAPE fits neither form (a missing key, a wrong
 * type, a value outside an enum) fails as ONE issue at path `''` — "Check this field." — while an
 * input that fits a form and breaks one of its VALUE rules reports that rule's own path and words
 * (`patch.title`, `reorder.1.id`, …). Both are pinned below, as observed from zod 4.4.
 *
 * Rows: `makeMention` factory rows (`cleanupFactories`) — articles "about OddSense generally" by
 * default, and `hidden` / `draft` wherever the case allows, so a concurrently running
 * `refreshMentions` / public-reader lane never meets them. The 200-row case bulk-inserts through the
 * service client and removes its rows itself (200 ids do not fit one `in (…)` URL, which is what
 * `cleanupFactories` sends); `afterAll` also sweeps this run's URL prefix. Projects are
 * `makeProject` rows. SEED-10 is never written; `afterAll` re-asserts both seed rows' order.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { updateMention } from '@/lib/actions/mentions';
import type { MentionRow, UpdateMentionInput } from '@/lib/actions/mentions.schema';
import { VALIDATION_MESSAGE } from '@/lib/actions/run';
import { expectFail, expectOk } from '@/tests/helpers/actionResult';
import { asRole, SEED_ROLE_IDS } from '@/tests/helpers/asRole';
import { callAction, callActionAs, setupActionMocks } from '@/tests/helpers/callAction';
import { expectInternal, withDbFault, withDbHook } from '@/tests/helpers/dbFault';
import {
  cleanupFactories,
  makeMention,
  makeProject,
  makeUser,
  type MentionOverrides,
} from '@/tests/helpers/factories';
import { SEED_MENTIONS } from '@/tests/helpers/seedIds';
import { spyLog, spyRevalidateTag, type LogSpy } from '@/tests/helpers/spies';

setupActionMocks();

const service = asRole('service');
const tags = spyRevalidateTag();

const RUN = randomBytes(4).toString('hex');
const SITE = `https://example.test/t_${RUN}`;
const NO_SUCH_ID = '00000000-0000-4000-8000-00000000dead';

let counter = 0;
function articleUrl(): string {
  counter += 1;
  return `${SITE}/m-${String(counter)}`;
}

/** A factory ARTICLE mention about OddSense generally — no video id, so no job ever picks it up. */
function makeArticle(overrides: MentionOverrides = {}): Promise<string> {
  return makeMention({
    platform: 'article',
    external_id: null,
    url: articleUrl(),
    creator_url: null,
    thumbnail_url: null,
    ...overrides,
  });
}

async function readMention(id: string): Promise<MentionRow> {
  const { data, error } = await service.from('mentions').select('*').eq('id', id).single();
  if (error) throw new Error(`readMention(${id}) failed: ${error.message}`);
  return data;
}

async function sortOrders(ids: readonly string[]): Promise<number[]> {
  const { data, error } = await service
    .from('mentions')
    .select('id, sort_order')
    .in('id', [...ids]);
  if (error) throw new Error(`mentions read failed: ${error.message}`);
  const byId = new Map(data.map((row) => [row.id, row.sort_order]));
  return ids.map((id) => byId.get(id) ?? Number.NaN);
}

async function projectSlug(id: string): Promise<string> {
  const { data, error } = await service.from('projects').select('slug').eq('id', id).single();
  if (error) throw new Error(`projects read failed: ${error.message}`);
  return data.slug;
}

async function visibleToAnon(id: string): Promise<boolean> {
  const { data, error } = await asRole('anon').from('mentions').select('id').eq('id', id);
  if (error) throw new Error(`anon read failed: ${error.message}`);
  return data.length === 1;
}

const patchAs = (id: string, patch: Record<string, unknown>) =>
  callAction(updateMention, { id, patch } as UpdateMentionInput, { role: 'admin' });

/** The `{id, patch}` form as the seed admin → the returned (= stored) row. */
async function patched(id: string, patch: Record<string, unknown>): Promise<MentionRow> {
  const data = expectOk(await patchAs(id, patch));
  if (!('mention' in data)) throw new Error('expected the {mention} arm');
  return data.mention;
}

let logs: LogSpy;

function adminLines(): Array<{ action: string; id: string; meta: Record<string, unknown> }> {
  return (logs.lines as Array<Record<string, unknown>>).filter(
    (line) => line.msg === 'admin',
  ) as Array<{ action: string; id: string; meta: Record<string, unknown> }>;
}

beforeEach(() => {
  logs = spyLog();
  tags.calls.length = 0;
});

afterEach(() => {
  logs.restore();
});

afterAll(async () => {
  // This run's URL prefix first (one filter, however many rows), then the tracked factory rows.
  const { error } = await service.from('mentions').delete().like('url', `${SITE}/%`);
  if (error) throw new Error(`mentions sweep failed: ${error.message}`);
  await cleanupFactories();
  // 05 H-1: SEED-10 leaves this file exactly as seeded (the Home strip's order rides on it).
  expect(await sortOrders([SEED_MENTIONS.youtube, SEED_MENTIONS.tiktok])).toEqual([1, 2]);
});

// ---------------------------------------------------------------------------------------------
// T-ACT-64 auth — admin only, both forms (ADR-0002 C7)
// ---------------------------------------------------------------------------------------------
describe('T-ACT-64 updateMention auth', () => {
  it.each([
    { role: 'anon' as const, code: 'unauthenticated' as const, message: 'Sign in first.' },
    { role: 'user' as const, code: 'forbidden' as const, message: 'Not allowed.' },
    // The seed banned account has role `user` — `requireRole`'s rank check answers (04 SC-04).
    { role: 'banned' as const, code: 'forbidden' as const, message: 'Not allowed.' },
    // ADR-0002 C7: a moderator reads `/admin/mentions`; every control on it is the admin's.
    { role: 'mod' as const, code: 'forbidden' as const, message: 'Not allowed.' },
  ])(
    'T-ACT-64 $role → $code on the patch form AND the reorder form: row untouched, no revalidate',
    async ({ role, code, message }) => {
      const id = await makeArticle({ sort_order: 4 });
      const before = await readMention(id);
      const forms: UpdateMentionInput[] = [
        { id, patch: { featured: true, status: 'hidden' } },
        { reorder: [{ id, sort_order: 9 }] },
      ];
      for (const form of forms) {
        const error = expectFail(await callAction(updateMention, form, { role }), code);
        expect(error.message).toBe(message);
      }
      expect(await readMention(id)).toEqual(before);
      expect(tags.calls).toEqual([]);
      expect(adminLines()).toEqual([]);
    },
  );
});

// ---------------------------------------------------------------------------------------------
// T-ACT-64 {id, patch} — feature, hide / show, the keys that are written
// ---------------------------------------------------------------------------------------------
describe('T-ACT-64 updateMention patch form', () => {
  it('T-ACT-64 featured: true on a general mention → written, the stored row comes back, revalidates mentions ONLY; SC-24 keys only', async () => {
    const id = await makeArticle();
    const before = await readMention(id);

    const row = await patched(id, { featured: true });
    expect(row).toEqual(await readMention(id));
    // Only `featured` moved (`updated_at` is the trigger's — INV-97).
    expect({ ...row, updated_at: before.updated_at }).toEqual({ ...before, featured: true });
    expect(Date.parse(row.updated_at)).toBeGreaterThanOrEqual(Date.parse(before.updated_at));
    expect(tags.calls).toEqual(['mentions']);

    const lines = adminLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]?.action).toBe('updateMention');
    expect(String(lines[0]?.id)).toMatch(/^[0-9a-f-]{36}$/);
    expect(lines[0]?.meta).toEqual({
      actor_profile_id: SEED_ROLE_IDS.admin,
      target_type: 'mention',
      target_id: id,
      // The keys of the patch, never its values.
      fields: ['id', 'featured'],
    });
    expect(JSON.stringify(logs.lines)).not.toContain('example.test');
  });

  it('T-ACT-64 status published → hidden → published: a hidden mention leaves the public read at once and comes back', async () => {
    const projectId = await makeProject();
    const slug = await projectSlug(projectId);
    const id = await makeArticle({ project_id: projectId, featured: true });
    expect(await visibleToAnon(id)).toBe(true);

    const hidden = await patched(id, { status: 'hidden' });
    expect(hidden.status).toBe('hidden');
    // Hiding does not un-feature: showing it again puts it back where it was.
    expect(hidden.featured).toBe(true);
    expect(await visibleToAnon(id)).toBe(false);
    // The project page carries the SEEN ON row → its tag goes with `mentions`; ONE tag per slug.
    expect(tags.calls).toEqual(['mentions', `project:${slug}`]);

    tags.calls.length = 0;
    const shown = await patched(id, { status: 'published' });
    expect(shown.status).toBe('published');
    expect(await visibleToAnon(id)).toBe(true);
    expect(tags.calls).toEqual(['mentions', `project:${slug}`]);
    expect(tags.calls).not.toContain('projects');
  });

  it('T-ACT-64 status draft is reachable too (published → draft takes it off the site)', async () => {
    const id = await makeArticle();
    expect((await patched(id, { status: 'draft' })).status).toBe('draft');
    expect(await visibleToAnon(id)).toBe(false);
  });

  it('T-ACT-64 only the keys present are written; null clears an optional one; several keys in one call', async () => {
    const id = await makeArticle({
      status: 'hidden',
      creator_url: 'https://example.test/t_creator',
      thumbnail_url: 'https://cdn.example.test/t_cover.jpg',
      external_id: 't_native-id',
      view_count: 1200,
    });
    const before = await readMention(id);

    const retitled = await patched(id, { title: '  t_ a better title  ' });
    expect({ ...retitled, updated_at: '' }).toEqual({
      ...before,
      title: 't_ a better title',
      updated_at: '',
    });

    const cleared = await patched(id, {
      external_id: null,
      creator_url: null,
      thumbnail_url: null,
      published_at: null,
      view_count: null,
    });
    expect(cleared).toMatchObject({
      external_id: null,
      creator_url: null,
      thumbnail_url: null,
      published_at: null,
      view_count: null,
      title: 't_ a better title',
      creator_name: before.creator_name,
    });

    const rewritten = await patched(id, {
      platform: 'reddit',
      external_id: 't3_abc',
      creator_name: 't_ u/seedditor',
      creator_url: 'https://www.reddit.com/user/t_seedditor',
      thumbnail_url: 'https://cdn.example.test/t_other.jpg',
      published_at: '2026-01-02T03:04:05Z',
      view_count: 0,
      featured: true,
      sort_order: -3,
    });
    expect(rewritten).toMatchObject({
      platform: 'reddit',
      external_id: 't3_abc',
      creator_name: 't_ u/seedditor',
      creator_url: 'https://www.reddit.com/user/t_seedditor',
      thumbnail_url: 'https://cdn.example.test/t_other.jpg',
      view_count: 0,
      featured: true,
      sort_order: -3,
      // Untouched by every call above.
      url: before.url,
      status: 'hidden',
      source: 'manual',
      created_by: before.created_by,
    });
    expect([...(adminLines()[2]?.meta.fields as string[])].sort()).toEqual([
      'creator_name',
      'creator_url',
      'external_id',
      'featured',
      'id',
      'platform',
      'published_at',
      'sort_order',
      'thumbnail_url',
      'view_count',
    ]);
  });

  it("T-ACT-64 a mention's link never changes: a url key in the patch is stripped; unknown keys never reach the row", async () => {
    const id = await makeArticle({ status: 'hidden' });
    const before = await readMention(id);
    const row = await patched(id, {
      url: 'https://example.test/t_hijack',
      source: 'auto',
      created_by: SEED_ROLE_IDS.user,
      featured: true,
    });
    expect(row.url).toBe(before.url);
    expect(row.source).toBe('manual');
    expect(row.created_by).toBe(before.created_by);
    expect(row.featured).toBe(true);
    expect(adminLines()[0]?.meta.fields).toEqual(['id', 'featured']);
  });

  it('T-ACT-64 any admin may curate a mention another admin created; created_by stays', async () => {
    const burner = await makeUser({ role: 'admin' });
    const id = await makeArticle({ status: 'hidden' });
    const data = expectOk(
      await callActionAs(updateMention, { id, patch: { featured: true } }, { profileId: burner }),
    );
    expect('mention' in data && data.mention.created_by).toBe(SEED_ROLE_IDS.admin);
    expect(adminLines()[0]?.meta.actor_profile_id).toBe(burner);
  });

  it('T-ACT-64 unknown id → not_found; no revalidate, no audit line', async () => {
    const error = expectFail(await patchAs(NO_SUCH_ID, { featured: true }), 'not_found');
    expect(error.message).toBe("That mention doesn't exist.");
    expect(tags.calls).toEqual([]);
    expect(adminLines()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-64 {id, patch} — reassign: `mentions` + the project it left + the project it joined
// ---------------------------------------------------------------------------------------------
describe('T-ACT-64 updateMention reassign project_id', () => {
  it('T-ACT-64 project A → project B revalidates mentions + project:<A> + project:<B>, each once, never projects', async () => {
    const [a, b] = [await makeProject(), await makeProject()];
    const [slugA, slugB] = [await projectSlug(a), await projectSlug(b)];
    const id = await makeArticle({ project_id: a });

    const row = await patched(id, { project_id: b });
    expect(row.project_id).toBe(b);
    expect(tags.calls).toEqual(['mentions', `project:${slugA}`, `project:${slugB}`]);
    expect(tags.calls).not.toContain('projects');
    expect(adminLines()[0]?.meta.fields).toEqual(['id', 'project_id']);
  });

  it('T-ACT-64 project → "About OddSense generally" (null) revalidates the project it left; general → project the one it joined', async () => {
    const a = await makeProject();
    const slugA = await projectSlug(a);
    const id = await makeArticle({ project_id: a });

    expect((await patched(id, { project_id: null })).project_id).toBeNull();
    expect(tags.calls).toEqual(['mentions', `project:${slugA}`]);

    tags.calls.length = 0;
    expect((await patched(id, { project_id: a })).project_id).toBe(a);
    expect(tags.calls).toEqual(['mentions', `project:${slugA}`]);

    // null → null: nothing but the list itself.
    const general = await makeArticle();
    tags.calls.length = 0;
    await patched(general, { project_id: null });
    expect(tags.calls).toEqual(['mentions']);
  });

  it('T-ACT-64 re-sending the project it already has (any letter case) tags that project ONCE', async () => {
    const a = await makeProject();
    const id = await makeArticle({ project_id: a });
    await patched(id, { project_id: a.toUpperCase(), featured: true });
    expect(tags.calls).toEqual(['mentions', `project:${await projectSlug(a)}`]);
    expect((await readMention(id)).project_id).toBe(a);
  });

  it('T-ACT-64 a project that does not exist → validation on project_id; the row keeps its project, no revalidate, no audit line', async () => {
    const a = await makeProject();
    const id = await makeArticle({ project_id: a });
    const error = expectFail(
      await patchAs(id, { project_id: NO_SUCH_ID, featured: true }),
      'validation',
    );
    expect(error.message).toBe("That project doesn't exist.");
    expect(error.field).toBe('project_id');
    expect(error.issues).toEqual([{ path: 'project_id', message: "That project doesn't exist." }]);

    const row = await readMention(id);
    expect(row.project_id).toBe(a);
    expect(row.featured).toBe(false);
    expect(tags.calls).toEqual([]);
    expect(adminLines()).toEqual([]);
  });

  it('T-ACT-64 the new project removed between the read and the update (23503) is the same validation answer', async () => {
    const [a, b] = [await makeProject(), await makeProject()];
    const id = await makeArticle({ project_id: a });
    const res = await withDbFault({ table: 'mentions', op: 'update' }, { code: '23503' }, () =>
      patchAs(id, { project_id: b }),
    );
    const error = expectFail(res, 'validation');
    expect(error.field).toBe('project_id');
    expect((await readMention(id)).project_id).toBe(a);
    expect(tags.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-64 a suggested row is published ONLY by an explicit patch.status = 'published'
// ---------------------------------------------------------------------------------------------
describe('T-ACT-64 updateMention and suggested rows', () => {
  it('T-ACT-64 featuring, reassigning or reordering a suggested row never publishes it; patch.status = published does', async () => {
    const projectId = await makeProject();
    const id = await makeArticle({ status: 'suggested', source: 'auto', created_by: null });
    expect(await visibleToAnon(id)).toBe(false);

    expect((await patched(id, { featured: true, project_id: projectId })).status).toBe('suggested');
    expectOk(
      await callAction(updateMention, { reorder: [{ id, sort_order: 1 }] }, { role: 'admin' }),
    );
    expect((await readMention(id)).status).toBe('suggested');
    expect(await visibleToAnon(id)).toBe(false);

    // Approve (S2.4's button) = this call, made on purpose.
    const approved = await patched(id, { status: 'published' });
    expect(approved.status).toBe('published');
    // Where it came from stays on the record.
    expect(approved.source).toBe('auto');
    expect(await visibleToAnon(id)).toBe(true);
  });

  it('T-ACT-64 suggested is not a status an action can write', async () => {
    const id = await makeArticle({ status: 'hidden' });
    expectFail(await patchAs(id, { status: 'suggested' }), 'validation');
    expect((await readMention(id)).status).toBe('hidden');
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-64 the platform / external_id pair — the stored half stands in for the missing one
// ---------------------------------------------------------------------------------------------
describe('T-ACT-64 updateMention YouTube id rule (mentions_youtube_external_id_format, in words)', () => {
  const NOT_AN_ID = "That isn't a YouTube video id.";

  it('T-ACT-64 a YouTube row cannot take an external_id that is not an 11-char video id → validation on external_id, row untouched', async () => {
    // `hidden`: the refresh job reads draft | published YouTube rows only.
    const id = await makeMention({ status: 'hidden' });
    const before = await readMention(id);
    const error = expectFail(
      await patchAs(id, { external_id: '7345001122334455667' }),
      'validation',
    );
    expect(error.message).toBe(NOT_AN_ID);
    expect(error.field).toBe('external_id');
    expect(error.issues).toEqual([{ path: 'external_id', message: NOT_AN_ID }]);
    expect(await readMention(id)).toEqual(before);
    expect(tags.calls).toEqual([]);
    expect(adminLines()).toEqual([]);
  });

  it('T-ACT-64 a row whose stored id is not a video id cannot become platform youtube → validation (never a constraint error → internal)', async () => {
    const id = await makeArticle({ status: 'hidden', external_id: 't3_abc' });
    const error = expectFail(await patchAs(id, { platform: 'youtube' }), 'validation');
    expect(error.field).toBe('external_id');
    expect((await readMention(id)).platform).toBe('article');
  });

  it('T-ACT-64 what the rule allows: youtube with no id, youtube with a real id, clearing the id, leaving youtube', async () => {
    const bare = await makeArticle({ status: 'hidden' });
    expect((await patched(bare, { platform: 'youtube' })).platform).toBe('youtube');

    const videoId = `t_${randomBytes(4).toString('hex')}u`;
    expect((await patched(bare, { external_id: videoId })).external_id).toBe(videoId);
    expect((await patched(bare, { external_id: null })).external_id).toBeNull();

    const video = await makeMention({ status: 'hidden' });
    const moved = await patched(video, { platform: 'other', external_id: 'anything-goes-here' });
    expect(moved).toMatchObject({ platform: 'other', external_id: 'anything-goes-here' });
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-64 {reorder} — one transaction (RPC `reorder_mentions`), one revalidate
// ---------------------------------------------------------------------------------------------
describe('T-ACT-64 updateMention reorder form', () => {
  const reorderAs = (reorder: { id: string; sort_order: number }[]) =>
    callAction(updateMention, { reorder }, { role: 'admin' });

  it('T-ACT-64 [{id, sort_order}] → the rows hold exactly the sequential ints sent; {reordered:n}; revalidates mentions ONCE; nothing else moves', async () => {
    const ids = [
      await makeArticle({ featured: true, sort_order: 10 }),
      await makeArticle({ featured: true, sort_order: 20, status: 'hidden' }),
      await makeArticle({ featured: false, sort_order: 30, status: 'draft' }),
      await makeArticle({ featured: true, sort_order: 40 }),
    ];
    const before = await Promise.all(ids.map(readMention));
    // The drop: last → first.
    const order = [ids[3], ids[0], ids[1], ids[2]] as string[];

    const data = expectOk(
      await reorderAs(order.map((id, index) => ({ id, sort_order: index + 1 }))),
    );
    expect(data).toEqual({ reordered: 4 });
    expect(await sortOrders(order)).toEqual([1, 2, 3, 4]);

    // Only `sort_order` was written.
    const after = await Promise.all(ids.map(readMention));
    after.forEach((row, index) => {
      expect({ ...row, sort_order: 0, updated_at: '' }).toEqual({
        ...before[index],
        sort_order: 0,
        updated_at: '',
      });
    });

    // ONE revalidate — no per-project tag (sort_order only orders the Home strip).
    expect(tags.calls).toEqual(['mentions']);

    const lines = adminLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]?.action).toBe('updateMention');
    expect(lines[0]?.meta).toEqual({
      actor_profile_id: SEED_ROLE_IDS.admin,
      target_type: 'mentions',
      target_id: null,
      fields: ['reorder'],
    });
    for (const id of ids) expect(JSON.stringify(logs.lines)).not.toContain(id);
  });

  it('T-ACT-64 200 pairs (the maximum) are applied by ONE rpc call → 1..200', async () => {
    const rows = Array.from({ length: 200 }, (_unused, index) => ({
      id: randomUUID(),
      platform: 'article' as const,
      url: `${SITE}/bulk-${String(index)}`,
      title: `t_ bulk ${String(index)}`,
      creator_name: 't_ bulk',
      status: 'draft' as const,
      created_by: SEED_ROLE_IDS.admin,
    }));
    const ids = rows.map((row) => row.id);
    try {
      const { error } = await service.from('mentions').insert(rows);
      expect(error).toBeNull();

      let rpcCalls = 0;
      const res = await withDbHook(
        { rpc: 'reorder_mentions' },
        () => {
          rpcCalls += 1;
          return Promise.resolve();
        },
        () => reorderAs(ids.map((id, index) => ({ id, sort_order: index + 1 }))),
        { nth: 'all' },
      );
      expect(expectOk(res)).toEqual({ reordered: 200 });
      expect(rpcCalls).toBe(1);

      // Read back by this run's URL prefix — 200 ids do not fit one `in (…)` filter URL.
      const { data, error: readError } = await service
        .from('mentions')
        .select('id, sort_order')
        .like('url', `${SITE}/bulk-%`);
      expect(readError).toBeNull();
      const stored = new Map((data ?? []).map((row) => [row.id, row.sort_order]));
      expect(ids.map((id) => stored.get(id))).toEqual(
        Array.from({ length: 200 }, (_unused, index) => index + 1),
      );
      expect(tags.calls).toEqual(['mentions']);
    } finally {
      const { error } = await service.from('mentions').delete().like('url', `${SITE}/bulk-%`);
      if (error) throw new Error(`bulk mentions cleanup failed: ${error.message}`);
    }
  });

  it('T-ACT-64 an id that matches no row → not_found and NOTHING is applied (one transaction); no revalidate, no audit line', async () => {
    const ids = [await makeArticle({ sort_order: 5 }), await makeArticle({ sort_order: 6 })];
    const error = expectFail(
      await reorderAs([
        { id: ids[0] as string, sort_order: 1 },
        { id: NO_SUCH_ID, sort_order: 2 },
        { id: ids[1] as string, sort_order: 3 },
      ]),
      'not_found',
    );
    expect(error.message).toBe("One of those mentions doesn't exist.");
    // The two rows that DID match rolled back with the one that did not.
    expect(await sortOrders(ids)).toEqual([5, 6]);
    expect(tags.calls).toEqual([]);
    expect(adminLines()).toEqual([]);
  });

  it('T-ACT-64 when both forms are sent the reorder wins and the patch is dropped', async () => {
    const id = await makeArticle({ status: 'hidden' });
    const both = { id, patch: { featured: true }, reorder: [{ id, sort_order: 8 }] };
    const data = expectOk(
      await callAction(updateMention, both as UpdateMentionInput, { role: 'admin' }),
    );
    expect(data).toEqual({ reordered: 1 });
    expect(await readMention(id)).toMatchObject({ sort_order: 8, featured: false });
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-64 validation — `updateMentionInput` (04 §1.6), asked as anon: zod runs before auth
// ---------------------------------------------------------------------------------------------
describe('T-ACT-64 updateMention validation', () => {
  const ID = SEED_MENTIONS.youtube;

  /** Fits neither form → the union's one issue. */
  const SHAPE = { path: '', message: 'Check this field.' };

  it.each<{ name: string; input: unknown; path: string; message: string }>([
    { name: 'neither form', input: {}, ...SHAPE },
    { name: 'null', input: null, ...SHAPE },
    { name: 'a patch without an id', input: { patch: { featured: true } }, ...SHAPE },
    { name: 'an id without a patch', input: { id: ID }, ...SHAPE },
    {
      name: 'patch.status suggested (never reachable from an action)',
      input: { id: ID, patch: { status: 'suggested' } },
      ...SHAPE,
    },
    {
      name: 'patch.title null (NOT NULL column)',
      input: { id: ID, patch: { title: null } },
      ...SHAPE,
    },
    {
      name: 'patch.platform outside the enum',
      input: { id: ID, patch: { platform: 'vine' } },
      ...SHAPE,
    },
    { name: 'patch.featured a string', input: { id: ID, patch: { featured: 'yes' } }, ...SHAPE },
    {
      name: 'patch.sort_order fractional',
      input: { id: ID, patch: { sort_order: 0.5 } },
      ...SHAPE,
    },
    { name: 'reorder item without sort_order', input: { reorder: [{ id: ID }] }, ...SHAPE },
    {
      name: 'reorder sort_order fractional',
      input: { reorder: [{ id: ID, sort_order: 1.5 }] },
      ...SHAPE,
    },
    {
      name: 'an id that is not a uuid',
      input: { id: 'seedvid0001', patch: { featured: true } },
      path: 'id',
      message: 'Pick a mention.',
    },
    {
      name: 'an empty patch',
      input: { id: ID, patch: {} },
      path: 'patch',
      message: 'Nothing to change.',
    },
    {
      name: 'a patch of nothing but url (stripped → empty)',
      input: { id: ID, patch: { url: `${SITE}/x` } },
      path: 'patch',
      message: 'Nothing to change.',
    },
    {
      name: "patch.title ''",
      input: { id: ID, patch: { title: '' } },
      path: 'patch.title',
      message: 'Type a title.',
    },
    {
      name: 'patch.creator_name 81 chars',
      input: { id: ID, patch: { creator_name: 'c'.repeat(81) } },
      path: 'patch.creator_name',
      message: 'Too long. 80 characters maximum.',
    },
    {
      name: 'patch.view_count negative',
      input: { id: ID, patch: { view_count: -5 } },
      path: 'patch.view_count',
      message: 'Views are a whole number, 0 or more.',
    },
    {
      name: 'patch.creator_url http://',
      input: { id: ID, patch: { creator_url: 'http://x.example.test/' } },
      path: 'patch.creator_url',
      message: 'Links start with https://.',
    },
    {
      name: 'patch.project_id not a uuid',
      input: { id: ID, patch: { project_id: 'metal-pipe-mace' } },
      path: 'patch.project_id',
      message: 'Pick a project.',
    },
    {
      name: 'patch.platform youtube + an external_id that is not a video id (both halves in hand)',
      input: { id: ID, patch: { platform: 'youtube', external_id: 'nope' } },
      path: 'patch.external_id',
      message: "That isn't a YouTube video id.",
    },
    {
      name: 'reorder empty',
      input: { reorder: [] },
      path: 'reorder',
      message: 'Nothing to reorder.',
    },
    {
      name: 'reorder id not a uuid',
      input: { reorder: [{ id: 'first', sort_order: 1 }] },
      path: 'reorder.0.id',
      message: 'Pick a mention.',
    },
    {
      name: 'reorder the same id twice (any letter case)',
      input: {
        reorder: [
          { id: ID, sort_order: 1 },
          { id: ID.toUpperCase(), sort_order: 2 },
        ],
      },
      path: 'reorder.1.id',
      message: 'Each mention once.',
    },
    {
      name: 'reorder 201 pairs',
      input: {
        reorder: Array.from({ length: 201 }, (_unused, index) => ({
          id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
          sort_order: index,
        })),
      },
      path: 'reorder',
      message: '200 mentions maximum.',
    },
  ])(
    'T-ACT-64 $name → validation at "$path" (before auth: asked as anon), SEED-10 untouched',
    async ({ input, path, message }) => {
      const before = await readMention(ID);
      const error = expectFail(
        await callAction(updateMention, input as UpdateMentionInput, { role: 'anon' }),
        'validation',
      );
      expect(error.message).toBe(VALIDATION_MESSAGE);
      expect(error.field).toBe(path === '' ? undefined : path);
      expect(error.issues).toEqual([{ path, message }]);
      expect(await readMention(ID)).toEqual(before);
      expect(tags.calls).toEqual([]);
    },
  );
});

// ---------------------------------------------------------------------------------------------
// T-ACT-64 — DB faults (T-ACT-0 (1); COV-2)
// ---------------------------------------------------------------------------------------------
describe('T-ACT-64 updateMention DB faults', () => {
  it.each<{ name: string; target: { table: string; op: 'select' | 'update' }; nth: number }>([
    { name: 'the row read', target: { table: 'mentions', op: 'select' }, nth: 1 },
    { name: "the old project's slug read", target: { table: 'projects', op: 'select' }, nth: 1 },
    { name: "the new project's slug read", target: { table: 'projects', op: 'select' }, nth: 2 },
    { name: 'the update', target: { table: 'mentions', op: 'update' }, nth: 1 },
  ])(
    'T-ACT-64 $name fails → internal + one log.error line, row untouched, no revalidate, no audit line',
    async ({ target, nth }) => {
      const [a, b] = [await makeProject(), await makeProject()];
      const id = await makeArticle({ project_id: a, status: 'hidden' });
      const before = await readMention(id);
      const res = await withDbFault(target, { nth }, () =>
        patchAs(id, { project_id: b, featured: true }),
      );
      expectInternal(res, 'updateMention', logs);
      expect(await readMention(id)).toEqual(before);
      expect(tags.calls).toEqual([]);
      expect(adminLines()).toEqual([]);
    },
  );

  it('T-ACT-64 the update matches no row (removed by hand mid-call) → not_found, no revalidate', async () => {
    const id = await makeArticle({ status: 'hidden' });
    const res = await withDbFault(
      { table: 'mentions', op: 'update' },
      { result: { data: null, error: null } },
      () => patchAs(id, { featured: true }),
    );
    expect(expectFail(res, 'not_found').message).toBe("That mention doesn't exist.");
    expect(tags.calls).toEqual([]);
    expect(adminLines()).toEqual([]);
  });

  it('T-ACT-64 reorder_mentions fails with anything but P0002 → internal + one log.error line, nothing reordered, no revalidate', async () => {
    const id = await makeArticle({ sort_order: 3, status: 'hidden' });
    const res = await withDbFault({ rpc: 'reorder_mentions' }, { code: '22023' }, () =>
      callAction(updateMention, { reorder: [{ id, sort_order: 1 }] }, { role: 'admin' }),
    );
    expectInternal(res, 'updateMention', logs);
    expect(await sortOrders([id])).toEqual([3]);
    expect(tags.calls).toEqual([]);
    expect(adminLines()).toEqual([]);
  });
});
