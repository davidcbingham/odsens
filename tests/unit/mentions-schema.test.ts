/**
 * tests/unit/mentions-schema.test.ts — `lib/actions/mentions.schema.ts` (04 §1.6 Input cells;
 * ADR-0045): the schema-level twins of the 05 §7.2 validation rows the db lane proves through
 * `callAction` — T-ACT-62 (`fetchMentionPreviewInput`: `javascript:` / `file:` / userinfo are
 * `validation`, http is upgraded), T-ACT-63 (`createMentionInput`: bounds, `project_id` required +
 * nullable, `status` default draft / never `suggested`, a YouTube id is 11 chars), T-ACT-64
 * (`updateMentionInput`: either form; ≥ 1 patch key, `null` clears, `hidden` allowed, `suggested`
 * never; reorder 1..200 with unique ids). Also pins the hand-written input TYPES to the schemas
 * (`expectTypeOf` — a drift is a `tsc` error) and the 04 SC-02 message rule `_meta` enforces:
 * plain words, never zod's generic text. Pure — no DB, no network.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import {
  MENTION_PLATFORM,
  MENTION_REORDER_MAX,
  createMentionInput,
  fetchMentionPreviewInput,
  mentionUrlSchema,
  updateMentionInput,
  type CreateMentionInput,
  type CreateMentionValues,
  type FetchMentionPreviewInput,
  type MentionPreviewData,
  type UpdateMentionInput,
} from '@/lib/actions/mentions.schema';
import { MENTION_PLATFORMS } from '@/lib/mentions';

const PROJECT = '00000000-0000-4000-8000-000000000101';
const MENTION = '00000000-0000-4000-8000-000000000301';
const OTHER_MENTION = '00000000-0000-4000-8000-000000000302';

const CREATE: CreateMentionInput = {
  url: 'https://www.youtube.com/watch?v=fixmen00001',
  project_id: PROJECT,
  platform: 'youtube',
  title: 'A video about a mod',
  creator_name: 'BlockBuddy',
  featured: false,
};

type Parsed = {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
};

/** `path → first message` for every path of a failed parse (`{}` on success) — what a form shows. */
function issuesOf(result: Parsed): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of result.success ? [] : (result.error?.issues ?? [])) {
    out[issue.path.join('.')] ??= issue.message;
  }
  return out;
}

/** 04 SC-02 as `_meta` (2) checks it: a capitalised plain sentence, none of zod's generic words. */
function expectPlainWords(result: Parsed): void {
  for (const message of Object.values(issuesOf(result))) {
    expect(message).toMatch(/^[A-Z0-9]/);
    expect(message).not.toMatch(/invalid_type|expected|received|ZodError|\$Zod|^Invalid input/i);
  }
}

describe('T-ACT-62 fetchMentionPreviewInput / mentionUrlSchema', () => {
  it('T-ACT-62 an https link parses to its normalised href — tracking params stay (the preview reads what was pasted)', () => {
    expect(
      fetchMentionPreviewInput.parse({ url: ' https://youtu.be/fixmen00001?si=abc ' }),
    ).toEqual({ url: 'https://youtu.be/fixmen00001?si=abc' });
  });

  it('T-ACT-62 http is upgraded to https', () => {
    expect(fetchMentionPreviewInput.parse({ url: 'http://blog.example.test/post' })).toEqual({
      url: 'https://blog.example.test/post',
    });
  });

  it.each([
    ['javascript:alert(1)', 'Links start with https://.'],
    ['file:///etc/passwd', 'Links start with https://.'],
    ['data:text/html,hi', 'Links start with https://.'],
    ['ftp://example.test/x', 'Links start with https://.'],
    ['https://user:pass@blog.example.test/', "Links can't carry a username or password."],
    ['https://user@blog.example.test/', "Links can't carry a username or password."],
    ['not a url', "That doesn't look like a link."],
    ['blog.example.test/post', "That doesn't look like a link."],
    ['', 'Paste a link.'],
    ['   ', 'Paste a link.'],
    [`https://blog.example.test/${'a'.repeat(2048)}`, 'Too long. 2048 characters maximum.'],
  ])('T-ACT-62 %s → validation on `url`: %s', (url, message) => {
    const result = fetchMentionPreviewInput.safeParse({ url });
    expect(result.success).toBe(false);
    expect(issuesOf(result)).toEqual({ url: message });
  });

  it('T-ACT-62 a missing or non-string url → "Paste a link." (no coercion)', () => {
    for (const value of [undefined, null, 42, {}, ['https://blog.example.test/']]) {
      const result = fetchMentionPreviewInput.safeParse({ url: value });
      expect(result.success, String(value)).toBe(false);
      expect(issuesOf(result)).toEqual({ url: 'Paste a link.' });
    }
    expect(fetchMentionPreviewInput.safeParse(null).success).toBe(false);
    expect(mentionUrlSchema.safeParse(undefined).success).toBe(false);
  });

  it('T-ACT-62 unknown keys are stripped', () => {
    expect(
      fetchMentionPreviewInput.parse({ url: 'https://blog.example.test/', project_id: PROJECT }),
    ).toEqual({ url: 'https://blog.example.test/' });
  });
});

describe('T-ACT-63 createMentionInput', () => {
  it('T-ACT-63 the minimal input parses; status defaults to draft', () => {
    expect(createMentionInput.parse(CREATE)).toEqual({ ...CREATE, status: 'draft' });
  });

  it('T-ACT-63 the full input parses; text is trimmed; published is accepted', () => {
    const full: CreateMentionInput = {
      ...CREATE,
      external_id: ' fixmen00001 ',
      title: '  A video about a mod  ',
      creator_name: ' BlockBuddy ',
      creator_url: 'https://www.youtube.com/channel/UCfixture000000000000001',
      thumbnail_url: 'https://i.ytimg.com/vi/fixmen00001/hqdefault.jpg',
      published_at: '2026-06-14T16:00:00Z',
      view_count: 1_200_000,
      status: 'published',
      featured: true,
      sort_order: 3,
    };
    expect(createMentionInput.parse(full)).toEqual({
      ...full,
      external_id: 'fixmen00001',
      title: 'A video about a mod',
      creator_name: 'BlockBuddy',
    });
  });

  it('T-ACT-63 project_id null = "About OddSense generally"; the key itself is required', () => {
    expect(createMentionInput.parse({ ...CREATE, project_id: null }).project_id).toBeNull();
    const withoutProject: Record<string, unknown> = { ...CREATE };
    delete withoutProject.project_id;
    const result = createMentionInput.safeParse(withoutProject);
    expect(issuesOf(result)).toEqual({ project_id: 'Pick a project.' });
    expect(
      issuesOf(createMentionInput.safeParse({ ...CREATE, project_id: 'metal-pipe-mace' })),
    ).toEqual({
      project_id: 'Pick a project.',
    });
  });

  it.each(MENTION_PLATFORMS.map((platform) => [platform]))(
    'T-ACT-63 platform %s is accepted',
    (platform) => {
      const input = { ...CREATE, platform, url: 'https://example.test/x' };
      expect(createMentionInput.parse(input).platform).toBe(platform);
      expect(MENTION_PLATFORM.options).toEqual([...MENTION_PLATFORMS]);
    },
  );

  it.each([
    ['platform', 'vimeo', 'Pick a platform.'],
    ['platform', 'odsens', 'Pick a platform.'],
    ['title', '', 'Type a title.'],
    ['title', '   ', 'Type a title.'],
    ['title', 'x'.repeat(201), 'Too long. 200 characters maximum.'],
    ['title', 7, 'Type a title.'],
    ['creator_name', '', "Type the creator's name."],
    ['creator_name', 'x'.repeat(81), 'Too long. 80 characters maximum.'],
    ['external_id', '', 'Type the id.'],
    ['external_id', 'x'.repeat(65), 'Too long. 64 characters maximum.'],
    ['creator_url', 'http://www.youtube.com/@seedcreator', 'Links start with https://.'],
    ['creator_url', 'not a url', 'Needs to be a full https:// link.'],
    ['creator_url', `https://example.test/${'a'.repeat(512)}`, 'Too long. 512 characters maximum.'],
    ['thumbnail_url', 'javascript:alert(1)', 'Links start with https://.'],
    ['published_at', '14 June 2026', 'Dates are ISO timestamps.'],
    ['published_at', '2026-06-14', 'Dates are ISO timestamps.'],
    ['view_count', -1, 'Views are a whole number, 0 or more.'],
    ['view_count', 1.5, 'Views are a whole number, 0 or more.'],
    ['view_count', '1200000', 'Views are a whole number, 0 or more.'],
    ['status', 'hidden', 'Pick draft or published.'],
    ['status', 'suggested', 'Pick draft or published.'],
    ['featured', 'yes', 'Featured is on or off.'],
    ['featured', undefined, 'Featured is on or off.'],
    ['sort_order', 1.5, 'Order is a whole number.'],
    ['sort_order', 2_147_483_648, 'Order is a whole number.'],
    ['sort_order', -2_147_483_649, 'Order is a whole number.'],
    ['url', 'javascript:alert(1)', 'Links start with https://.'],
    ['url', 'https://user:pass@example.test/', "Links can't carry a username or password."],
  ])('T-ACT-63 %s = %j → "%s"', (key, value, message) => {
    const result = createMentionInput.safeParse({ ...CREATE, [key]: value });
    expect(result.success).toBe(false);
    expect(issuesOf(result)).toEqual({ [key]: message });
    expectPlainWords(result);
  });

  it('T-ACT-63 bounds are inclusive: title 200, creator_name 80, external_id 64, view_count 0, int4 order', () => {
    const edge = createMentionInput.parse({
      ...CREATE,
      platform: 'other',
      title: 'x'.repeat(200),
      creator_name: 'y'.repeat(80),
      external_id: 'z'.repeat(64),
      view_count: 0,
      sort_order: 2_147_483_647,
    });
    expect(edge.title).toHaveLength(200);
    expect(edge.creator_name).toHaveLength(80);
    expect(edge.external_id).toHaveLength(64);
    expect(createMentionInput.parse({ ...CREATE, sort_order: -2_147_483_648 }).sort_order).toBe(
      -2_147_483_648,
    );
  });

  it('T-ACT-63 published_at takes Z and offset timestamps', () => {
    for (const stamp of [
      '2026-06-14T16:00:00Z',
      '2026-06-14T16:00:00.000Z',
      '2026-06-14T18:00:00+02:00',
    ]) {
      expect(createMentionInput.parse({ ...CREATE, published_at: stamp }).published_at).toBe(stamp);
    }
  });

  it('T-ACT-63 optional keys are absent-or-valued on create — null is refused', () => {
    for (const key of [
      'external_id',
      'creator_url',
      'thumbnail_url',
      'published_at',
      'view_count',
    ] as const) {
      const result = createMentionInput.safeParse({ ...CREATE, [key]: null });
      expect(result.success, key).toBe(false);
      expect(Object.keys(issuesOf(result))).toEqual([key]);
      expectPlainWords(result);
    }
  });

  it('T-ACT-63 a youtube external_id must be an 11-char video id; other platforms take any id ≤ 64', () => {
    const bad = createMentionInput.safeParse({ ...CREATE, external_id: 'too-short' });
    expect(issuesOf(bad)).toEqual({ external_id: "That isn't a YouTube video id." });
    expect(createMentionInput.parse({ ...CREATE, external_id: 'fixmen00001' }).external_id).toBe(
      'fixmen00001',
    );
    expect(
      createMentionInput.parse({
        ...CREATE,
        platform: 'tiktok',
        url: 'https://www.tiktok.com/@seedtok/video/1',
        external_id: '7301234567890123456',
      }).external_id,
    ).toBe('7301234567890123456');
    // A youtube mention with no id at all is fine (it links out — `WATCH ON YOUTUBE`).
    expect(createMentionInput.safeParse(CREATE).success).toBe(true);
  });

  it('T-ACT-63 the url stays as pasted (normalised) — canonicalising is the action, not the schema', () => {
    const parsed = createMentionInput.parse({
      ...CREATE,
      url: 'http://youtu.be/fixmen00001?si=abc',
    });
    expect(parsed.url).toBe('https://youtu.be/fixmen00001?si=abc');
  });

  it('T-ACT-63 unknown keys are stripped — source / created_by / id can never be sent', () => {
    const parsed = createMentionInput.parse({
      ...CREATE,
      id: MENTION,
      source: 'auto',
      created_by: PROJECT,
    });
    expect(parsed).toEqual({ ...CREATE, status: 'draft' });
  });
});

describe('T-ACT-64 updateMentionInput — the patch form', () => {
  it.each([
    [{ featured: true }],
    [{ featured: false }],
    [{ status: 'hidden' }],
    [{ status: 'published' }],
    [{ status: 'draft' }],
    [{ project_id: PROJECT }],
    [{ project_id: null }],
    [{ sort_order: 0 }],
    [{ title: 'New title', creator_name: 'New name' }],
    [{ platform: 'article' }],
  ] as const)('T-ACT-64 patch %j parses', (patch) => {
    expect(updateMentionInput.parse({ id: MENTION, patch })).toEqual({ id: MENTION, patch });
  });

  it('T-ACT-64 null clears the optional columns (present = !== undefined)', () => {
    const patch = {
      external_id: null,
      creator_url: null,
      thumbnail_url: null,
      published_at: null,
      view_count: null,
    };
    expect(updateMentionInput.parse({ id: MENTION, patch })).toEqual({ id: MENTION, patch });
    expect(updateMentionInput.parse({ id: MENTION, patch: { view_count: null } })).toEqual({
      id: MENTION,
      patch: { view_count: null },
    });
  });

  it('T-ACT-64 an empty patch, or one holding only keys it does not know (url), is refused', () => {
    expect(updateMentionInput.safeParse({ id: MENTION, patch: {} }).success).toBe(false);
    expect(
      updateMentionInput.safeParse({ id: MENTION, patch: { url: 'https://example.test/' } })
        .success,
    ).toBe(false);
    expect(updateMentionInput.safeParse({ id: MENTION, patch: { title: undefined } }).success).toBe(
      false,
    );
    // …while `url` beside a real key is simply stripped: the link of a mention never changes.
    expect(
      updateMentionInput.parse({
        id: MENTION,
        patch: { url: 'https://example.test/', featured: true },
      }),
    ).toEqual({ id: MENTION, patch: { featured: true } });
  });

  it.each([
    ['suggested is unreachable', { status: 'suggested' }],
    ['an unknown status', { status: 'live' }],
    ['an empty title', { title: '' }],
    ['title cannot be cleared', { title: null }],
    ['creator_name cannot be cleared', { creator_name: null }],
    ['featured cannot be cleared', { featured: null }],
    ['platform cannot be cleared', { platform: null }],
    ['a slug is not an id', { project_id: 'metal-pipe-mace' }],
    ['http creator_url', { creator_url: 'http://example.test/' }],
    ['negative views', { view_count: -1 }],
    ['fractional order', { sort_order: 1.5 }],
    ['a youtube id that is not 11 chars', { platform: 'youtube', external_id: 'nope' }],
  ])('T-ACT-64 refused — %s: patch %j', (_why, patch) => {
    expect(updateMentionInput.safeParse({ id: MENTION, patch }).success).toBe(false);
  });

  it('T-ACT-64 id must be a uuid; a patch without an id fits neither form', () => {
    expect(
      updateMentionInput.safeParse({ id: 'seedvid0001', patch: { featured: true } }).success,
    ).toBe(false);
    expect(updateMentionInput.safeParse({ patch: { featured: true } }).success).toBe(false);
    expect(updateMentionInput.safeParse({ id: MENTION }).success).toBe(false);
    expect(updateMentionInput.safeParse({}).success).toBe(false);
    expect(updateMentionInput.safeParse(null).success).toBe(false);
  });

  it('T-ACT-64 a union failure is ONE issue at path "" (the curateProject behaviour _meta rows rely on)', () => {
    const result = updateMentionInput.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0]?.path).toEqual([]);
    }
  });
});

describe('T-ACT-64 updateMentionInput — the reorder form', () => {
  const pair = (n: number) => ({
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    sort_order: n,
  });

  it('T-ACT-64 1..200 { id, sort_order } pairs parse; extra keys on a pair are stripped', () => {
    const reorder = [
      { id: MENTION, sort_order: 1 },
      { id: OTHER_MENTION, sort_order: 2 },
    ];
    expect(updateMentionInput.parse({ reorder })).toEqual({ reorder });
    expect(
      updateMentionInput.parse({ reorder: [{ id: MENTION, sort_order: 1, featured: true }] }),
    ).toEqual({ reorder: [{ id: MENTION, sort_order: 1 }] });

    const full = Array.from({ length: MENTION_REORDER_MAX }, (_, index) => pair(index + 1));
    expect(MENTION_REORDER_MAX).toBe(200);
    expect(updateMentionInput.safeParse({ reorder: full }).success).toBe(true);
    expect(updateMentionInput.safeParse({ reorder: [...full, pair(201)] }).success).toBe(false);
  });

  it('T-ACT-64 an empty list, a repeated id, a non-uuid id or a non-integer order is refused', () => {
    expect(updateMentionInput.safeParse({ reorder: [] }).success).toBe(false);
    expect(
      updateMentionInput.safeParse({
        reorder: [
          { id: MENTION, sort_order: 1 },
          { id: MENTION.toUpperCase(), sort_order: 2 },
        ],
      }).success,
    ).toBe(false);
    expect(updateMentionInput.safeParse({ reorder: [{ id: 'one', sort_order: 1 }] }).success).toBe(
      false,
    );
    expect(
      updateMentionInput.safeParse({ reorder: [{ id: MENTION, sort_order: 1.5 }] }).success,
    ).toBe(false);
    expect(updateMentionInput.safeParse({ reorder: [{ id: MENTION }] }).success).toBe(false);
    expect(updateMentionInput.safeParse({ reorder: 'all' }).success).toBe(false);
  });

  it('T-ACT-64 when both forms are sent the reorder wins and the patch is stripped', () => {
    expect(
      updateMentionInput.parse({
        reorder: [{ id: MENTION, sort_order: 1 }],
        id: MENTION,
        patch: { featured: true },
      }),
    ).toEqual({ reorder: [{ id: MENTION, sort_order: 1 }] });
  });
});

describe('T-ACT-63 the hand-written types match the schemas', () => {
  it('T-ACT-62 FetchMentionPreviewInput = z.input<fetchMentionPreviewInput>', () => {
    expectTypeOf<
      z.input<typeof fetchMentionPreviewInput>
    >().toEqualTypeOf<FetchMentionPreviewInput>();
  });

  it('T-ACT-63 CreateMentionInput = z.input<createMentionInput>; parsed values carry a status', () => {
    expectTypeOf<z.input<typeof createMentionInput>>().toEqualTypeOf<CreateMentionInput>();
    expectTypeOf<CreateMentionValues['status']>().toEqualTypeOf<'draft' | 'published'>();
  });

  it('T-ACT-64 UpdateMentionInput = z.input<updateMentionInput>', () => {
    expectTypeOf<z.input<typeof updateMentionInput>>().toEqualTypeOf<UpdateMentionInput>();
  });

  it('T-ACT-62 MentionPreviewData is exactly the ten 04 §1.6 keys', () => {
    expectTypeOf<keyof MentionPreviewData>().toEqualTypeOf<
      | 'platform'
      | 'external_id'
      | 'canonical_url'
      | 'title'
      | 'creator_name'
      | 'creator_url'
      | 'thumbnail_url'
      | 'published_at'
      | 'view_count'
      | 'source'
    >();
  });
});
