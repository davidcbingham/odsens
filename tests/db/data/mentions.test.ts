/**
 * tests/db/data/mentions.test.ts — `lib/data/mentions.ts` `listPublishedMentions` (+ the three
 * surface wrappers) and the `/admin/mentions` readers of `lib/data/admin.ts`, against the local
 * stack (00 S1.8.AC2 / AC3 / AC8 "hidden mentions vanish from all three public surfaces"; 02 route
 * rows `/`, `/projects/[slug]`, `/seen-on`, `/admin/mentions`; ADR-0045 — ONE reader, and a mention
 * whose project is not publicly visible is dropped). Supplementary: the S1.8 §8 row gives the data
 * layer no id of its own — the behaviour is e2e-proved by T-E2E-1 / 5 / 10 (smoke, on seed) and
 * T-E2E-39 (publish / hide through `/admin/mentions`); this file pins the readers' contract where
 * a failure names the reader, and tags its titles with the e2e id it backs.
 *
 * In the db lane `next/cache` `unstable_cache` is the pass-through of tests/helpers/setup.db.ts, so
 * every call is a fresh read on the cookie-less anon client (RLS as a visitor — 05 T-RLS-102). The
 * SEED-10 rows are only READ (H-1). Everything else is factory rows (`t_` tagged, dated years past
 * SEED-10 so the ordering assertions hold whatever other mentions exist), removed in `afterAll`;
 * assertions are scoped to those ids, never to table-wide counts (another lane may share the
 * database). The admin readers run through `withActionContext` — the request-cookie client of a
 * real local session, so RLS decides what a moderator sees (05 T-RLS-102/103).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listAdminMentions, listMentionProjectOptions } from '@/lib/data/admin';
import {
  getHomeMentions,
  getProjectMentions,
  getSeenOnMentions,
  listPublishedMentions,
} from '@/lib/data/mentions';
import { featuredMentions, reachTotals } from '@/lib/mentions';
import { asRole } from '@/tests/helpers/asRole';
import { withActionContext } from '@/tests/helpers/callAction';
import {
  cleanupFactories,
  factoryYoutubeId,
  makeMention,
  makeProject,
} from '@/tests/helpers/factories';
import { SEED_MENTIONS, SEED_PROJECTS } from '@/tests/helpers/seedIds';

const service = asRole('service');

let visibleProject: string;
let retitledProject: string;
let hiddenProject: string;
let draftProject: string;

/** Published factory mentions, by the role they play below. */
let newest: string;
let onRetitled: string;
let general: string;
let undated: string;
let onHiddenProject: string;
let onDraftProject: string;
/** Never public. */
let draft: string;
let hidden: string;
let suggested: string;

beforeAll(async () => {
  visibleProject = await makeProject({ title: 't_ visible project', project_type: 'plugin' });
  retitledProject = await makeProject({ title: 't_ stored title', project_type: 'datapack' });
  hiddenProject = await makeProject({ title: 't_ hidden project' });
  draftProject = await makeProject({ title: 't_ draft project', status: 'draft' });
  // Both rows name both columns: PostgREST unifies columns across a multi-row insert, and an
  // omitted column arrives as NULL (not the column default) on the rows that skip it.
  const { error } = await service.from('project_overrides').insert([
    { project_id: retitledProject, hidden: false, title_override: 't_ override title' },
    { project_id: hiddenProject, hidden: true, title_override: null },
  ]);
  if (error) throw new Error(`arrange: project_overrides insert failed: ${error.message}`);

  newest = await makeMention({
    project_id: visibleProject,
    title: 't_ newest mention',
    creator_name: 't_ Creator One',
    published_at: '2031-03-04T10:00:00+00:00',
    view_count: 8200,
    featured: true,
    sort_order: 7,
    // A stored thumbnail on another host must never reach a component (ADR-0002 #33 / INV-54).
    thumbnail_url: 'https://img.example.test/not-ytimg.jpg',
  });
  onRetitled = await makeMention({
    project_id: retitledProject,
    platform: 'article',
    url: `https://blog.example.test/t_${Date.now()}`,
    external_id: null,
    title: 't_ article mention',
    creator_name: 't_ creator one ',
    creator_url: null,
    thumbnail_url: 'https://blog.example.test/og.png',
    published_at: '2031-03-03T10:00:00+00:00',
    view_count: null,
  });
  general = await makeMention({
    project_id: null,
    title: 't_ general mention',
    published_at: '2031-03-02T10:00:00+00:00',
    view_count: 100,
  });
  undated = await makeMention({
    project_id: visibleProject,
    title: 't_ undated mention',
    published_at: null,
  });
  onHiddenProject = await makeMention({
    project_id: hiddenProject,
    title: 't_ on a hidden project',
    published_at: '2031-03-05T10:00:00+00:00',
    featured: true,
  });
  onDraftProject = await makeMention({
    project_id: draftProject,
    title: 't_ on a draft project',
    published_at: '2031-03-05T11:00:00+00:00',
  });
  draft = await makeMention({ status: 'draft', published_at: '2031-03-06T10:00:00+00:00' });
  hidden = await makeMention({
    status: 'hidden',
    project_id: visibleProject,
    featured: true,
    published_at: '2031-03-06T11:00:00+00:00',
  });
  suggested = await makeMention({
    status: 'suggested',
    source: 'auto',
    created_by: null,
    published_at: '2031-03-06T12:00:00+00:00',
  });
});

afterAll(async () => {
  await cleanupFactories();
});

describe('T-E2E-10 backing — listPublishedMentions (lib/data/mentions.ts)', () => {
  it('T-E2E-10 reader: the SEED-10 rows come back mapped — camelCase, ISO dates, project joined, general = null', async () => {
    const mentions = await listPublishedMentions();
    const youtube = mentions.find((mention) => mention.id === SEED_MENTIONS.youtube);
    const tiktok = mentions.find((mention) => mention.id === SEED_MENTIONS.tiktok);

    expect(youtube).toEqual({
      id: SEED_MENTIONS.youtube,
      platform: 'youtube',
      url: 'https://www.youtube.com/watch?v=seedvid0001',
      externalId: 'seedvid0001',
      title: 'Metal Pipe Mace is the loudest mod I have ever installed',
      creatorName: 'Seed Creator',
      creatorUrl: 'https://www.youtube.com/@seedcreator',
      thumbnailUrl: 'https://i.ytimg.com/vi/seedvid0001/hqdefault.jpg',
      publishedAt: '2026-06-14T16:00:00.000Z',
      viewCount: 1_200_000,
      project: { slug: 'metal-pipe-mace', title: 'Metal Pipe Mace', type: 'resourcepack' },
      featured: true,
      sortOrder: 1,
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/) as string,
    });
    expect(tiktok).toMatchObject({
      id: SEED_MENTIONS.tiktok,
      platform: 'tiktok',
      url: 'https://www.tiktok.com/@seedtok/video/1',
      externalId: null,
      title: 'this mod makes no sense and I love it',
      creatorName: 'Seed Tok',
      creatorUrl: 'https://www.tiktok.com/@seedtok',
      thumbnailUrl: null,
      publishedAt: '2026-05-02T12:00:00.000Z',
      viewCount: null,
      project: null,
      featured: false,
      sortOrder: 2,
    });
    // SEED-10: the YouTube row is the newer one — "newest first" is deterministic on seed.
    expect(mentions.indexOf(youtube!)).toBeLessThan(mentions.indexOf(tiktok!));
    // Props are serialisable (03 C-19): plain JSON round-trips unchanged.
    expect(JSON.parse(JSON.stringify(mentions))).toEqual(mentions);
  });

  it('T-E2E-39 reader: draft, hidden and suggested mentions never leave the reader (AC8)', async () => {
    const ids = (await listPublishedMentions()).map((mention) => mention.id);
    expect(ids).not.toContain(draft);
    expect(ids).not.toContain(hidden);
    expect(ids).not.toContain(suggested);
    expect(ids).toEqual(expect.arrayContaining([newest, onRetitled, general, undated]));
  });

  it('T-E2E-10 reader: a mention on a hidden or draft project is dropped — never shown as general, never a 404 link', async () => {
    const mentions = await listPublishedMentions();
    const ids = mentions.map((mention) => mention.id);
    expect(ids).not.toContain(onHiddenProject);
    expect(ids).not.toContain(onDraftProject);
    // Every row is either general or carries a publicly visible project — nothing in between.
    const { data: visible, error } = await asRole('anon').from('projects_public').select('slug');
    expect(error).toBeNull();
    const slugs = new Set((visible ?? []).map((row) => row.slug));
    for (const mention of mentions) {
      if (mention.project !== null) expect(slugs.has(mention.project.slug), mention.id).toBe(true);
    }
  });

  it('T-E2E-10 reader: project = slug + EFFECTIVE title (title_override) + type; general mention = null', async () => {
    const mentions = await listPublishedMentions();
    const byId = new Map(mentions.map((mention) => [mention.id, mention]));
    const visibleSlug = byId.get(newest)?.project?.slug;

    expect(byId.get(newest)?.project).toEqual({
      slug: expect.stringMatching(/^t_[0-9a-f]{8}$/) as string,
      title: 't_ visible project',
      type: 'plugin',
    });
    expect(byId.get(onRetitled)?.project).toMatchObject({
      title: 't_ override title',
      type: 'datapack',
    });
    expect(byId.get(general)?.project).toBeNull();
    expect(byId.get(undated)?.project?.slug).toBe(visibleSlug);
  });

  it('T-E2E-10 reader: newest first — published_at desc, an undated mention after every dated one', async () => {
    const mentions = await listPublishedMentions();
    const ids = mentions.map((mention) => mention.id);
    // The three dated factory rows (2031) lead the list in date order.
    expect(ids.slice(0, 3)).toEqual([newest, onRetitled, general]);
    const lastDated = mentions.findLastIndex((mention) => mention.publishedAt !== null);
    expect(ids.indexOf(undated)).toBeGreaterThan(lastDated);
    expect(mentions[ids.indexOf(undated)]).toMatchObject({ publishedAt: null });
    const times = mentions
      .filter((mention) => mention.publishedAt !== null)
      .map((mention) => Date.parse(mention.publishedAt!));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('T-E2E-10 reader: thumbnailUrl is the i.ytimg literal for a playable YouTube row and null otherwise — a stored URL never leaves', async () => {
    const byId = new Map((await listPublishedMentions()).map((mention) => [mention.id, mention]));
    expect(byId.get(newest)).toMatchObject({
      externalId: factoryYoutubeId(newest),
      thumbnailUrl: `https://i.ytimg.com/vi/${factoryYoutubeId(newest)}/hqdefault.jpg`,
      viewCount: 8200,
      featured: true,
      sortOrder: 7,
    });
    expect(byId.get(onRetitled)).toMatchObject({
      platform: 'article',
      externalId: null,
      creatorUrl: null,
      thumbnailUrl: null,
      viewCount: null,
    });
  });
});

describe('T-E2E-1 backing — the surface wrappers share the one reader', () => {
  it('T-E2E-1 getHomeMentions: featured by sort_order (≤ 4, public ones only); reach over ALL published', async () => {
    const [{ featured, reach }, all] = await Promise.all([
      getHomeMentions(),
      listPublishedMentions(),
    ]);
    const ids = featured.map((mention) => mention.id);
    expect(featured.length).toBeLessThanOrEqual(4);
    expect(featured.every((mention) => mention.featured)).toBe(true);
    // The wrapper IS the pure helper over the one reader (nothing of its own to drift).
    expect(ids).toEqual(featuredMentions(all).map((mention) => mention.id));
    // Uncapped (another lane may have featured rows of its own): hidden rows and rows on a hidden
    // project are not candidates; sort_order ascending puts SEED-10 …0301 (1) before ours (7).
    const candidates = featuredMentions(all, all.length).map((mention) => mention.id);
    expect(candidates).not.toContain(hidden);
    expect(candidates).not.toContain(onHiddenProject);
    expect(candidates).toContain(SEED_MENTIONS.youtube);
    expect(candidates.indexOf(SEED_MENTIONS.youtube)).toBeLessThan(candidates.indexOf(newest));
    expect(reach).toEqual(reachTotals(all));
    expect(reach.videos).toBe(all.length);
    expect(reach.views).toBeGreaterThanOrEqual(1_200_000 + 8200 + 100);
  });

  it('T-E2E-5 getProjectMentions: that project only, featured first then newest; none → []', async () => {
    const all = await listPublishedMentions();
    const slug = all.find((mention) => mention.id === newest)?.project?.slug ?? '';
    expect((await getProjectMentions(slug)).map((mention) => mention.id)).toEqual([
      newest,
      undated,
    ]);

    const seedRow = await getProjectMentions('metal-pipe-mace');
    expect(seedRow.map((mention) => mention.id)).toContain(SEED_MENTIONS.youtube);
    expect(seedRow.every((mention) => mention.project?.slug === 'metal-pipe-mace')).toBe(true);
    // 05 T-E2E-3: pixel-chameleon has no mention → the SEEN ON row is not rendered.
    expect(await getProjectMentions('pixel-chameleon')).toEqual([]);
    expect(await getProjectMentions('no-such-project')).toEqual([]);
  });

  it('T-E2E-10 getSeenOnMentions: the whole list + its totals', async () => {
    const [{ mentions, reach }, all] = await Promise.all([
      getSeenOnMentions(),
      listPublishedMentions(),
    ]);
    expect(mentions.map((mention) => mention.id)).toEqual(all.map((mention) => mention.id));
    expect(reach).toEqual(reachTotals(all));
    // ` t_ creator one ` and `t_ Creator One` are one creator (trimmed, case-insensitive).
    const factoryCreators = reachTotals(
      all.filter((mention) => mention.id === newest || mention.id === onRetitled),
    );
    expect(factoryCreators.creators).toBe(1);
  });
});

describe('T-E2E-39 backing — the /admin/mentions readers (lib/data/admin.ts)', () => {
  it('T-E2E-39 listAdminMentions as admin: every status, mapped, project titles incl. a hidden project', async () => {
    const rows = await withActionContext({ role: 'admin' }, () => listAdminMentions());
    const byId = new Map(rows.map((row) => [row.id, row]));

    for (const id of [newest, onRetitled, general, undated, onHiddenProject, onDraftProject]) {
      expect(byId.get(id)?.status, id).toBe('published');
    }
    expect(byId.get(draft)?.status).toBe('draft');
    expect(byId.get(hidden)?.status).toBe('hidden');
    expect(byId.get(suggested)?.status).toBe('suggested');

    expect(byId.get(SEED_MENTIONS.youtube)).toEqual({
      id: SEED_MENTIONS.youtube,
      platform: 'youtube',
      url: 'https://www.youtube.com/watch?v=seedvid0001',
      externalId: 'seedvid0001',
      title: 'Metal Pipe Mace is the loudest mod I have ever installed',
      creatorName: 'Seed Creator',
      creatorUrl: 'https://www.youtube.com/@seedcreator',
      publishedAt: expect.stringMatching(/^2026-06-14T16:00:00/) as string,
      viewCount: 1_200_000,
      status: 'published',
      featured: true,
      sortOrder: 1,
      projectId: SEED_PROJECTS.metalPipeMace,
      projectTitle: 'Metal Pipe Mace',
      createdAt: expect.any(String) as string,
    });
    expect(byId.get(SEED_MENTIONS.tiktok)).toMatchObject({ projectId: null, projectTitle: null });

    // Public title where the project is visible (the override), the stored title where it is not.
    expect(byId.get(onRetitled)?.projectTitle).toBe('t_ override title');
    expect(byId.get(onHiddenProject)).toMatchObject({
      projectId: hiddenProject,
      projectTitle: 't_ hidden project',
    });
    expect(byId.get(onDraftProject)?.projectTitle).toBe('t_ draft project');

    // Newest-added first — never by sort_order (a reorder must not reshuffle the table).
    const created = rows.map((row) => Date.parse(row.createdAt));
    expect(created).toEqual([...created].sort((a, b) => b - a));
  });

  it('T-E2E-39 listAdminMentions as mod: published rows only (RLS — 05 T-RLS-102); hidden-project titles unreadable', async () => {
    const rows = await withActionContext({ role: 'mod' }, () => listAdminMentions());
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(rows.every((row) => row.status === 'published')).toBe(true);
    expect(byId.has(draft)).toBe(false);
    expect(byId.has(hidden)).toBe(false);
    expect(byId.has(suggested)).toBe(false);
    expect(byId.has(newest)).toBe(true);
    expect(byId.get(onHiddenProject)).toMatchObject({
      projectId: hiddenProject,
      projectTitle: null,
    });
  });

  it('T-E2E-39 listAdminMentions(limit) caps the list', async () => {
    const rows = await withActionContext({ role: 'admin' }, () => listAdminMentions(2));
    expect(rows).toHaveLength(2);
  });

  it('T-E2E-39 listMentionProjectOptions: publicly visible projects only, effective titles, A→Z', async () => {
    const options = await withActionContext({ role: 'admin' }, () => listMentionProjectOptions());
    const byId = new Map(options.map((option) => [option.id, option.title]));
    expect(byId.get(visibleProject)).toBe('t_ visible project');
    expect(byId.get(retitledProject)).toBe('t_ override title');
    expect(byId.get(SEED_PROJECTS.metalPipeMace)).toBe('Metal Pipe Mace');
    expect(byId.has(hiddenProject)).toBe(false);
    expect(byId.has(draftProject)).toBe(false);

    const titles = options.map((option) => option.title.toLowerCase());
    expect(titles).toEqual([...titles].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    expect(Object.keys(options[0] ?? {}).sort()).toEqual(['id', 'title']);
  });
});
