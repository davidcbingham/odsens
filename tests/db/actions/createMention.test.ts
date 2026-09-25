/**
 * tests/db/actions/createMention.test.ts — T-ACT-63 (+ T-ACT-69 SC-24 audit line) (05 §7.2; 04 §1.6
 * `createMention`; 02 §5 tags; 01 INV-40 / INV-54; ADR-0002 C7 / #33; ADR-0045; migration
 * 20260919120000; 00 S1.8.AC2 / AC11).
 *
 * Auth matrix: anon `unauthenticated` · user D `forbidden` · banned D `forbidden` (the seed banned
 * account has role `user`) · **mod D `forbidden`** (ADR-0002 C7) · admin A — the denied rows never
 * write and never revalidate. Effects: the CANONICAL link is what is stored (`utm_*` / `si` /
 * `feature` dropped, `http:` upgraded, every YouTube form → `https://www.youtube.com/watch?v=<id>`)
 * and what is unique — a second paste of the same page under other tracking params, or the same
 * video under another YouTube form, is `conflict` on `url` (also proved through a raced insert →
 * 23505); `project_id` NULL or existing (nonexistent → `validation` on `project_id`, also through
 * a raced 23503); `status` defaults `draft` (`published` accepted, `suggested` / `hidden` refused by
 * the schema), `source = 'manual'`, `created_by` = the ACTING admin (a burner admin proves it is not
 * a constant). A YouTube row's `external_id` is the link's own video id and its thumbnail is an
 * `i.ytimg.com` URL or the `hqdefault` literal. Revalidates `mentions` + `project:<slug>` when
 * attached — never `projects`. One keys-only `admin` line per success, none on a failure.
 *
 * Rows: the action inserts them, so each is adopted with `trackMention` (05 H-1) — plus a
 * by-URL sweep in `afterAll` for anything a failed assertion left untracked. Every URL / video id
 * carries a per-run `t_` tag (`mentions.url` is unique across runs under `SKIP_DB_RESET=1`).
 * Projects are `makeProject` factory rows — never a seed project (a published mention on one would
 * show up on the prerendered project page). SEED-10 is never touched.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMention } from '@/lib/actions/mentions';
import type { CreateMentionInput, MentionRow } from '@/lib/actions/mentions.schema';
import { VALIDATION_MESSAGE } from '@/lib/actions/run';
import { expectFail, expectOk } from '@/tests/helpers/actionResult';
import { asRole, SEED_ROLE_IDS } from '@/tests/helpers/asRole';
import { callAction, callActionAs, setupActionMocks } from '@/tests/helpers/callAction';
import { expectInternal, withDbFault } from '@/tests/helpers/dbFault';
import {
  cleanupFactories,
  makeMention,
  makeProject,
  makeUser,
  trackMention,
} from '@/tests/helpers/factories';
import { SEED_MENTIONS } from '@/tests/helpers/seedIds';
import { spyLog, spyRevalidateTag, type LogSpy } from '@/tests/helpers/spies';

setupActionMocks();

const service = asRole('service');
const tags = spyRevalidateTag();

const RUN = randomBytes(4).toString('hex');
const SITE = `https://example.test/t_${RUN}`;
/** Every canonical WATCH url this file may have stored — the `afterAll` sweep (see the header). */
const watchUrls: string[] = [];

let counter = 0;
/** A fresh article link under this run's tag (already canonical; swept by that prefix). */
function articleUrl(): string {
  counter += 1;
  return `${SITE}/post-${String(counter)}`;
}

/** A fresh 11-char video id (`t_` + 8 hex + `v`) and its canonical watch URL. */
function video(): { id: string; watch: string } {
  const id = `t_${randomBytes(4).toString('hex')}v`;
  const watch = `https://www.youtube.com/watch?v=${id}`;
  watchUrls.push(watch);
  return { id, watch };
}

function input(overrides: Partial<CreateMentionInput> = {}): CreateMentionInput {
  return {
    url: articleUrl(),
    project_id: null,
    platform: 'article',
    title: 't_ a review',
    creator_name: 't_ Blocky Bulletin',
    featured: false,
    ...overrides,
  };
}

async function readMention(id: string): Promise<MentionRow> {
  const { data, error } = await service.from('mentions').select('*').eq('id', id).single();
  if (error) throw new Error(`readMention(${id}) failed: ${error.message}`);
  return data;
}

async function idsAt(url: string): Promise<string[]> {
  const { data, error } = await service.from('mentions').select('id').eq('url', url);
  if (error) throw new Error(`mentions read failed: ${error.message}`);
  return data.map((row) => row.id);
}

/** Runs the action as the seed admin, adopts the row for cleanup, returns it. */
async function create(overrides: Partial<CreateMentionInput> = {}): Promise<MentionRow> {
  const { mention } = expectOk(
    await callAction(createMention, input(overrides), { role: 'admin' }),
  );
  trackMention(mention.id);
  return mention;
}

async function projectSlug(id: string): Promise<string> {
  const { data, error } = await service.from('projects').select('slug').eq('id', id).single();
  if (error) throw new Error(`projects read failed: ${error.message}`);
  return data.slug;
}

let logs: LogSpy;

function adminLines(): Array<Record<string, unknown>> {
  return (logs.lines as Array<Record<string, unknown>>).filter((line) => line.msg === 'admin');
}

beforeEach(() => {
  logs = spyLog();
  tags.calls.length = 0;
});

afterEach(() => {
  logs.restore();
});

afterAll(async () => {
  await cleanupFactories();
  // Backstop (05 H-1): a row whose test failed before `trackMention` still leaves with the file —
  // articles by this run's URL prefix (one filter, however many rows), videos by their watch URL.
  const swept = await service.from('mentions').delete().like('url', `${SITE}/%`);
  if (swept.error) throw new Error(`mentions sweep failed: ${swept.error.message}`);
  const { error } = await service.from('mentions').delete().in('url', watchUrls);
  if (error) throw new Error(`mentions sweep failed: ${error.message}`);
  const { data } = await service
    .from('mentions')
    .select('id')
    .in('id', Object.values(SEED_MENTIONS));
  expect(data).toHaveLength(2);
});

// ---------------------------------------------------------------------------------------------
// T-ACT-63 auth — admin only (ADR-0002 C7)
// ---------------------------------------------------------------------------------------------
describe('T-ACT-63 createMention auth', () => {
  it.each([
    { role: 'anon' as const, code: 'unauthenticated' as const, message: 'Sign in first.' },
    { role: 'user' as const, code: 'forbidden' as const, message: 'Not allowed.' },
    // The seed banned account has role `user` — `requireRole`'s rank check answers (04 SC-04).
    { role: 'banned' as const, code: 'forbidden' as const, message: 'Not allowed.' },
    // ADR-0002 C7: mentions are admin-only; a moderator reads `/admin/mentions`, nothing more.
    { role: 'mod' as const, code: 'forbidden' as const, message: 'Not allowed.' },
  ])(
    'T-ACT-63 $role → $code: nothing written, no revalidate, no audit line',
    async ({ role, code, message }) => {
      const payload = input({ status: 'published' });
      const error = expectFail(await callAction(createMention, payload, { role }), code);
      expect(error.message).toBe(message);
      expect(await idsAt(payload.url)).toEqual([]);
      expect(tags.calls).toEqual([]);
      expect(adminLines()).toEqual([]);
    },
  );
});

// ---------------------------------------------------------------------------------------------
// T-ACT-63 effects — the row, the defaults, the tags, the audit line
// ---------------------------------------------------------------------------------------------
describe('T-ACT-63 createMention effects', () => {
  it('T-ACT-63 the smallest input: status defaults draft, source manual, created_by = the admin, project NULL, optionals NULL; revalidates mentions ONLY; SC-24 keys only', async () => {
    const payload = input();
    const res = await callAction(createMention, payload, { role: 'admin' });
    const { mention } = expectOk(res);
    trackMention(mention.id);

    const row = await readMention(mention.id);
    // The action returns the stored row, whole.
    expect(mention).toEqual(row);
    expect(row).toMatchObject({
      url: payload.url,
      project_id: null,
      platform: 'article',
      external_id: null,
      title: 't_ a review',
      creator_name: 't_ Blocky Bulletin',
      creator_url: null,
      thumbnail_url: null,
      published_at: null,
      view_count: null,
      status: 'draft',
      source: 'manual',
      featured: false,
      sort_order: 0,
      created_by: SEED_ROLE_IDS.admin,
    });

    // A draft is nobody's business but the admin's (RLS — 05 T-RLS-102).
    const { data: asAnon } = await asRole('anon').from('mentions').select('id').eq('id', row.id);
    expect(asAnon).toEqual([]);

    // 02 §5: `mentions` — no project attached, so no `project:<slug>`; never `projects`.
    expect(tags.calls).toEqual(['mentions']);

    // SC-24 (T-ACT-69): keys only — no link, no title, no creator.
    const lines = adminLines();
    expect(lines).toHaveLength(1);
    const line = lines[0] as { action: string; id: string; meta: Record<string, unknown> };
    expect(line.action).toBe('createMention');
    expect(String(line.id)).toMatch(/^[0-9a-f-]{36}$/);
    expect(Object.keys(line.meta).sort()).toEqual([
      'actor_profile_id',
      'fields',
      'target_id',
      'target_type',
    ]);
    expect(line.meta.actor_profile_id).toBe(SEED_ROLE_IDS.admin);
    expect(line.meta.target_type).toBe('mention');
    expect(line.meta.target_id).toBe(row.id);
    expect([...(line.meta.fields as string[])].sort()).toEqual([
      'creator_name',
      'featured',
      'platform',
      'project_id',
      'status',
      'title',
      'url',
    ]);
    const text = JSON.stringify(logs.lines);
    expect(text).not.toContain('example.test');
    expect(text).not.toContain('Blocky Bulletin');
    expect(text).not.toContain('a review');
  });

  it('T-ACT-63 attached to a project, published, featured, every optional field: stored as sent; revalidates mentions + project:<slug>, never projects; public at once', async () => {
    const projectId = await makeProject();
    const slug = await projectSlug(projectId);
    const row = await create({
      project_id: projectId,
      platform: 'tiktok',
      external_id: '7345001122334455667',
      title: '  t_ this mod makes no sense  ',
      creator_name: '  t_ seedtok  ',
      creator_url: 'https://www.tiktok.com/@t_seedtok',
      thumbnail_url: 'https://p16.tiktokcdn.example/t_cover.jpeg',
      published_at: '2026-01-05T10:00:00+02:00',
      view_count: 88_000,
      status: 'published',
      featured: true,
      sort_order: 7,
    });
    expect(row).toMatchObject({
      project_id: projectId,
      platform: 'tiktok',
      // A non-YouTube id is whatever the platform uses (1..64) — the 11-char rule is YouTube's.
      external_id: '7345001122334455667',
      title: 't_ this mod makes no sense',
      creator_name: 't_ seedtok',
      creator_url: 'https://www.tiktok.com/@t_seedtok',
      // Stored, never rendered (ADR-0002 #33).
      thumbnail_url: 'https://p16.tiktokcdn.example/t_cover.jpeg',
      view_count: 88_000,
      status: 'published',
      source: 'manual',
      featured: true,
      sort_order: 7,
    });
    expect(new Date(row.published_at ?? '').toISOString()).toBe('2026-01-05T08:00:00.000Z');

    expect(tags.calls).toEqual(['mentions', `project:${slug}`]);
    expect(tags.calls).not.toContain('projects');

    const { data: asAnon } = await asRole('anon').from('mentions').select('id').eq('id', row.id);
    expect(asAnon).toEqual([{ id: row.id }]);
  });

  it('T-ACT-63 created_by is the ACTING admin, not a constant', async () => {
    const burner = await makeUser({ role: 'admin' });
    const { mention } = expectOk(await callActionAs(createMention, input(), { profileId: burner }));
    trackMention(mention.id);
    expect(mention.created_by).toBe(burner);
    expect((adminLines()[0] as { meta: { actor_profile_id: string } }).meta.actor_profile_id).toBe(
      burner,
    );
  });

  it('T-ACT-63 every platform of the enum is accepted', async () => {
    for (const platform of ['tiktok', 'twitch', 'reddit', 'article', 'other'] as const) {
      expect((await create({ platform })).platform).toBe(platform);
    }
    const { id, watch } = video();
    expect((await create({ platform: 'youtube', url: watch })).external_id).toBe(id);
  });

  it('T-ACT-63 unknown input keys are stripped: source, created_by, id and view counts of their own never reach the row', async () => {
    const hijack = {
      ...input(),
      id: SEED_MENTIONS.youtube,
      source: 'auto',
      created_by: SEED_ROLE_IDS.user,
      created_at: '2001-01-01T00:00:00Z',
    } as unknown as CreateMentionInput;
    const { mention } = expectOk(await callAction(createMention, hijack, { role: 'admin' }));
    trackMention(mention.id);
    expect(mention.id).not.toBe(SEED_MENTIONS.youtube);
    expect(mention.source).toBe('manual');
    expect(mention.created_by).toBe(SEED_ROLE_IDS.admin);
    expect(new Date(mention.created_at).getUTCFullYear()).toBeGreaterThan(2001);
    const { fields } = (adminLines()[0] as { meta: { fields: string[] } }).meta;
    expect(fields).not.toContain('source');
    expect(fields).not.toContain('created_by');
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-63 the canonical link — what is stored, and what `conflict` means
// ---------------------------------------------------------------------------------------------
describe('T-ACT-63 createMention canonical url + uniqueness', () => {
  it('T-ACT-63 utm_*, si and feature are stripped (any case), other params keep their order; http is upgraded', async () => {
    const canonical = `${SITE}/tracked?id=7&page=2`;
    const row = await create({
      url: `http://example.test/t_${RUN}/tracked?utm_source=t_news&id=7&UTM_Medium=mail&si=abc&page=2&feature=share`,
    });
    expect(row.url).toBe(canonical);
  });

  it('T-ACT-63 the same page under other tracking params → conflict on url; no second row, no revalidate, no audit line', async () => {
    const first = await create();
    tags.calls.length = 0;
    logs.restore();
    logs = spyLog();

    const again = input({ url: `${first.url}?utm_campaign=t_again&si=zzz`, status: 'published' });
    const error = expectFail(await callAction(createMention, again, { role: 'admin' }), 'conflict');
    expect(error.message).toBe('That link is already on the list.');
    expect(error.field).toBe('url');
    expect(error.issues).toEqual([{ path: 'url', message: 'That link is already on the list.' }]);

    expect(await idsAt(first.url)).toEqual([first.id]);
    // The first row is untouched by the refused second paste.
    expect((await readMention(first.id)).status).toBe('draft');
    expect(tags.calls).toEqual([]);
    expect(adminLines()).toEqual([]);
  });

  it.each<{ name: string; paste: (id: string) => string }>([
    { name: 'youtu.be/<id>?si=', paste: (id) => `https://youtu.be/${id}?si=t_share` },
    { name: '/shorts/<id>', paste: (id) => `https://www.youtube.com/shorts/${id}?feature=share` },
    { name: '/live/<id>', paste: (id) => `https://youtube.com/live/${id}` },
    { name: '/embed/<id>', paste: (id) => `https://www.youtube.com/embed/${id}` },
    {
      name: 'm. watch?v=<id>&t=&list=',
      paste: (id) => `http://m.youtube.com/watch?t=42&v=${id}&list=PLt_x`,
    },
    { name: 'music. watch?v=<id>', paste: (id) => `https://music.youtube.com/watch?v=${id}&si=x` },
  ])(
    'T-ACT-63 YouTube $name → stored as https://www.youtube.com/watch?v=<id>; external_id + thumbnail derived from the link',
    async ({ paste }) => {
      const { id, watch } = video();
      const row = await create({ platform: 'youtube', url: paste(id) });
      expect(row.url).toBe(watch);
      // The caller sent neither: both come from the link (ADR-0045 D7 — the hqdefault literal).
      expect(row.external_id).toBe(id);
      expect(row.thumbnail_url).toBe(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`);
    },
  );

  it('T-ACT-63 the same video under another YouTube form → conflict (uniqueness is on the canonical string)', async () => {
    const { id, watch } = video();
    const first = await create({ platform: 'youtube', url: `https://youtu.be/${id}` });
    expect(first.url).toBe(watch);
    const error = expectFail(
      await callAction(
        createMention,
        input({ platform: 'youtube', url: `https://www.youtube.com/shorts/${id}?si=t_other` }),
        { role: 'admin' },
      ),
      'conflict',
    );
    expect(error.field).toBe('url');
    expect(await idsAt(watch)).toEqual([first.id]);
  });

  it('T-ACT-63 a raced insert (23505 from the unique index) is the same conflict — the constraint is the answer, not a pre-read', async () => {
    const payload = input();
    const res = await withDbFault({ table: 'mentions', op: 'insert' }, { code: '23505' }, () =>
      callAction(createMention, payload, { role: 'admin' }),
    );
    const error = expectFail(res, 'conflict');
    expect(error.message).toBe('That link is already on the list.');
    expect(error.field).toBe('url');
    expect(tags.calls).toEqual([]);
    expect(adminLines()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-63 YouTube rows — the id is the link's, the thumbnail lives on i.ytimg.com (01 INV-54)
// ---------------------------------------------------------------------------------------------
describe('T-ACT-63 createMention YouTube rules', () => {
  it('T-ACT-63 an i.ytimg.com thumbnail is kept as sent; anything else becomes the hqdefault literal', async () => {
    const kept = video();
    const best = `https://i.ytimg.com/vi/${kept.id}/maxresdefault.jpg`;
    expect(
      (
        await create({
          platform: 'youtube',
          url: kept.watch,
          external_id: kept.id,
          thumbnail_url: best,
        })
      ).thumbnail_url,
    ).toBe(best);

    const swapped = video();
    const row = await create({
      platform: 'youtube',
      url: swapped.watch,
      external_id: swapped.id,
      thumbnail_url: 'https://i.ytimg.com.evil.example/vi/x/hqdefault.jpg',
    });
    expect(row.thumbnail_url).toBe(`https://i.ytimg.com/vi/${swapped.id}/hqdefault.jpg`);
  });

  it("T-ACT-63 the link's own video id wins over a caller's external_id (the player and refreshMentions key on it)", async () => {
    const real = video();
    const other = video();
    const row = await create({ platform: 'youtube', url: real.watch, external_id: other.id });
    expect(row.external_id).toBe(real.id);
    expect(row.thumbnail_url).toBe(`https://i.ytimg.com/vi/${real.id}/hqdefault.jpg`);
  });

  it('T-ACT-63 platform youtube on a link with no video id: the caller id is used; with none, id and thumbnail stay NULL (a link-out card)', async () => {
    const { id } = video();
    const withId = await create({ platform: 'youtube', external_id: id });
    expect(withId.external_id).toBe(id);
    expect(withId.thumbnail_url).toBe(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`);

    const bare = await create({
      platform: 'youtube',
      thumbnail_url: 'https://cdn.example.test/t_cover.jpg',
    });
    expect(bare.external_id).toBeNull();
    expect(bare.thumbnail_url).toBeNull();
  });

  it('T-ACT-63 a YouTube link filed under another platform is canonicalised all the same, and nothing is derived', async () => {
    const { watch, id } = video();
    const row = await create({ platform: 'other', url: `https://youtu.be/${id}?si=t_x` });
    expect(row.url).toBe(watch);
    expect(row.external_id).toBeNull();
    expect(row.thumbnail_url).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-63 project_id — NULL or an existing project
// ---------------------------------------------------------------------------------------------
describe('T-ACT-63 createMention project_id', () => {
  const NO_SUCH_PROJECT = '00000000-0000-4000-8000-00000000dead';

  it('T-ACT-63 a project that does not exist → validation on project_id; nothing written, no revalidate, no audit line', async () => {
    const payload = input({ project_id: NO_SUCH_PROJECT });
    const error = expectFail(
      await callAction(createMention, payload, { role: 'admin' }),
      'validation',
    );
    expect(error.message).toBe("That project doesn't exist.");
    expect(error.field).toBe('project_id');
    expect(error.issues).toEqual([{ path: 'project_id', message: "That project doesn't exist." }]);
    expect(await idsAt(payload.url)).toEqual([]);
    expect(tags.calls).toEqual([]);
    expect(adminLines()).toEqual([]);
  });

  it('T-ACT-63 a project removed between the read and the insert (23503) is the same validation answer', async () => {
    const projectId = await makeProject();
    const payload = input({ project_id: projectId });
    const res = await withDbFault({ table: 'mentions', op: 'insert' }, { code: '23503' }, () =>
      callAction(createMention, payload, { role: 'admin' }),
    );
    const error = expectFail(res, 'validation');
    expect(error.field).toBe('project_id');
    expect(await idsAt(payload.url)).toEqual([]);
    expect(tags.calls).toEqual([]);
  });

  it('T-ACT-63 a draft / hidden project can carry a mention (the public reader drops it until the project shows)', async () => {
    const projectId = await makeProject({ status: 'draft' });
    const row = await create({ project_id: projectId, status: 'published' });
    expect(row.project_id).toBe(projectId);
    expect(tags.calls).toEqual(['mentions', `project:${await projectSlug(projectId)}`]);
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-63 validation — `createMentionInput` (04 §1.6), asked as anon: zod runs before auth
// ---------------------------------------------------------------------------------------------
describe('T-ACT-63 createMention validation', () => {
  const HTTPS = 'Links start with https://.';
  const VIEWS = 'Views are a whole number, 0 or more.';

  it.each<{ name: string; patch: Record<string, unknown>; path: string; message: string }>([
    { name: 'url javascript:', patch: { url: 'javascript:alert(1)' }, path: 'url', message: HTTPS },
    { name: 'url file:', patch: { url: 'file:///etc/passwd' }, path: 'url', message: HTTPS },
    {
      name: 'url with credentials',
      patch: { url: 'https://oliver:hunter2@example.test/x' },
      path: 'url',
      message: "Links can't carry a username or password.",
    },
    {
      name: 'url over 2048',
      patch: { url: `https://example.test/${'a'.repeat(2048)}` },
      path: 'url',
      message: 'Too long. 2048 characters maximum.',
    },
    {
      name: 'url not a link',
      patch: { url: 'the one with the pipe' },
      path: 'url',
      message: "That doesn't look like a link.",
    },
    { name: 'url missing', patch: { url: undefined }, path: 'url', message: 'Paste a link.' },
    {
      name: 'project_id not a uuid',
      patch: { project_id: 'metal-pipe-mace' },
      path: 'project_id',
      message: 'Pick a project.',
    },
    {
      name: 'project_id missing (null is the only way to say "general")',
      patch: { project_id: undefined },
      path: 'project_id',
      message: 'Pick a project.',
    },
    {
      name: 'platform outside the enum',
      patch: { platform: 'instagram' },
      path: 'platform',
      message: 'Pick a platform.',
    },
    {
      name: 'platform missing',
      patch: { platform: undefined },
      path: 'platform',
      message: 'Pick a platform.',
    },
    { name: "title ''", patch: { title: '' }, path: 'title', message: 'Type a title.' },
    { name: 'title whitespace', patch: { title: '   ' }, path: 'title', message: 'Type a title.' },
    {
      name: 'title 201 chars',
      patch: { title: 't'.repeat(201) },
      path: 'title',
      message: 'Too long. 200 characters maximum.',
    },
    {
      name: "creator_name ''",
      patch: { creator_name: '' },
      path: 'creator_name',
      message: "Type the creator's name.",
    },
    {
      name: 'creator_name 81 chars',
      patch: { creator_name: 'c'.repeat(81) },
      path: 'creator_name',
      message: 'Too long. 80 characters maximum.',
    },
    {
      name: "external_id ''",
      patch: { external_id: '' },
      path: 'external_id',
      message: 'Type the id.',
    },
    {
      name: 'external_id 65 chars',
      patch: { external_id: 'x'.repeat(65) },
      path: 'external_id',
      message: 'Too long. 64 characters maximum.',
    },
    {
      name: 'external_id null (absent is the only "none" on create)',
      patch: { external_id: null },
      path: 'external_id',
      message: 'Type the id.',
    },
    {
      name: 'platform youtube with an id that is not 11 url-safe chars',
      patch: { platform: 'youtube', external_id: 'not-a-video-id!' },
      path: 'external_id',
      message: "That isn't a YouTube video id.",
    },
    {
      name: 'creator_url http://',
      patch: { creator_url: 'http://www.youtube.com/@t_x' },
      path: 'creator_url',
      message: HTTPS,
    },
    {
      name: 'creator_url not a URL',
      patch: { creator_url: '@t_x' },
      path: 'creator_url',
      message: 'Needs to be a full https:// link.',
    },
    {
      name: 'thumbnail_url over 512',
      patch: { thumbnail_url: `https://cdn.example.test/${'a'.repeat(512)}` },
      path: 'thumbnail_url',
      message: 'Too long. 512 characters maximum.',
    },
    {
      name: 'thumbnail_url javascript:',
      patch: { thumbnail_url: 'javascript:alert(1)' },
      path: 'thumbnail_url',
      message: HTTPS,
    },
    {
      name: 'published_at not ISO',
      patch: { published_at: 'last tuesday' },
      path: 'published_at',
      message: 'Dates are ISO timestamps.',
    },
    { name: 'view_count negative', patch: { view_count: -1 }, path: 'view_count', message: VIEWS },
    {
      name: 'view_count fractional',
      patch: { view_count: 1.5 },
      path: 'view_count',
      message: VIEWS,
    },
    {
      name: 'view_count a string',
      patch: { view_count: '12' },
      path: 'view_count',
      message: VIEWS,
    },
    {
      name: 'status suggested (never reachable from an action)',
      patch: { status: 'suggested' },
      path: 'status',
      message: 'Pick draft or published.',
    },
    {
      name: 'status hidden (hide is an update)',
      patch: { status: 'hidden' },
      path: 'status',
      message: 'Pick draft or published.',
    },
    {
      name: 'featured missing',
      patch: { featured: undefined },
      path: 'featured',
      message: 'Featured is on or off.',
    },
    {
      name: 'featured a string',
      patch: { featured: 'true' },
      path: 'featured',
      message: 'Featured is on or off.',
    },
    {
      name: 'sort_order fractional',
      patch: { sort_order: 1.5 },
      path: 'sort_order',
      message: 'Order is a whole number.',
    },
    {
      name: 'sort_order past int4',
      patch: { sort_order: 2_147_483_648 },
      path: 'sort_order',
      message: 'Order is a whole number.',
    },
  ])('T-ACT-63 $name → validation on $path, nothing written', async ({ patch, path, message }) => {
    const payload = { ...input(), ...patch } as unknown as CreateMentionInput;
    const error = expectFail(
      await callAction(createMention, payload, { role: 'anon' }),
      'validation',
    );
    expect(error.message).toBe(VALIDATION_MESSAGE);
    expect(error.field).toBe(path);
    // The first issue is the one the form shows; a value that is not a URL at all also trips the
    // https rule behind it — every issue is about the same field either way.
    expect(error.issues?.[0]).toEqual({ path, message });
    expect([...new Set(error.issues?.map((issue) => issue.path))]).toEqual([path]);
    expect(tags.calls).toEqual([]);
  });

  it('T-ACT-63 several bad fields → one issue each, field = the first', async () => {
    const error = expectFail(
      await callAction(
        createMention,
        { ...input(), title: '', creator_name: '' } as CreateMentionInput,
        { role: 'anon' },
      ),
      'validation',
    );
    expect(error.field).toBe('title');
    expect(error.issues?.map((issue) => issue.path)).toEqual(['title', 'creator_name']);
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-63 — DB faults (T-ACT-0 (1); COV-2): the project read, the insert
// ---------------------------------------------------------------------------------------------
describe('T-ACT-63 createMention DB faults', () => {
  it('T-ACT-63 the project read fails → internal + one log.error line; nothing written, no revalidate, no audit line', async () => {
    const projectId = await makeProject();
    const payload = input({ project_id: projectId });
    const res = await withDbFault({ table: 'projects', op: 'select' }, {}, () =>
      callAction(createMention, payload, { role: 'admin' }),
    );
    expectInternal(res, 'createMention', logs);
    expect(await idsAt(payload.url)).toEqual([]);
    expect(tags.calls).toEqual([]);
    expect(adminLines()).toEqual([]);
  });

  it.each<{ name: string; code: string | undefined }>([
    { name: 'any other error', code: undefined },
    // No project on the row → a 23503 is not about the project: `internal`, not a wrong message.
    { name: 'a 23503 with project_id NULL', code: '23503' },
    // Every CHECK is mirrored by the schema, so a 23514 is a bug, not a form error.
    { name: 'a CHECK violation (23514)', code: '23514' },
  ])(
    'T-ACT-63 the insert fails with $name → internal, no revalidate, no audit line',
    async ({ code }) => {
      const payload = input();
      const res = await withDbFault(
        { table: 'mentions', op: 'insert' },
        code === undefined ? {} : { code },
        () => callAction(createMention, payload, { role: 'admin' }),
      );
      expectInternal(res, 'createMention', logs);
      expect(JSON.stringify(logs.lines)).not.toContain('example.test');
      expect(await idsAt(payload.url)).toEqual([]);
      expect(tags.calls).toEqual([]);
      expect(adminLines()).toEqual([]);
    },
  );

  it('T-ACT-63 SEED-10 and factory mentions are never touched by a create', async () => {
    const bystander = await makeMention({
      platform: 'article',
      external_id: null,
      url: articleUrl(),
    });
    const before = await readMention(bystander);
    await create();
    expect(await readMention(bystander)).toEqual(before);
  });
});
