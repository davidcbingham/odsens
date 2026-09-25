/**
 * tests/unit/mention-preview-draft.test.ts — `components/seen-on/MentionPreview.draft.ts`
 * (ADR-0045): the pure rules behind the `/admin/mentions` add flow that 05 T-E2E-39 drives in a
 * browser — what PUBLISH sends (`buildCreateMentionInput`: always `status: 'published'`, optional
 * keys omitted never `null`, the canonical link, ids and thumbnails only while the platform still
 * matches, the two client-parsed values), how a draft starts (`draftFromPreview`, `draftForUrl`,
 * `previewIsComplete`), and where an `ActionError`'s words go (`fetchErrors`, `publishErrors` — 03
 * C-30: inline, beside the thing that failed). `guessPlatform` is pinned to the adapter's
 * `detectPlatform` (04 §4.4) so the client-safe twin cannot drift. An id-less helper test file (05
 * ADR-R9); titles carry the id of the e2e they back. The payloads are also run through the real
 * `createMentionInput` schema — what the island builds must be what the action accepts. Pure — no
 * DOM, no DB, no network; `server-only` is mocked by the unit setup file.
 */
import { describe, expect, it } from 'vitest';
import {
  DATE_MESSAGE,
  EMPTY_DRAFT,
  PASTE_A_LINK,
  VIEWS_MESSAGE,
  buildCreateMentionInput,
  draftForUrl,
  draftFromPreview,
  fetchErrors,
  guessPlatform,
  hasFieldError,
  previewIsComplete,
  publishErrors,
  storedLink,
  type MentionDraft,
} from '@/components/seen-on/MentionPreview.draft';
import { createMentionInput, type MentionPreviewData } from '@/lib/actions/mentions.schema';
import type { ActionError } from '@/lib/actions/result';
import { detectPlatform } from '@/lib/adapters/oembed';
import { mentionPreviewFixtures } from '../fixtures/ui/mentionPreview';

const PROJECT = '00000000-0000-4000-8000-000000000101';
const UNREADABLE = "Couldn't read that page. You can fill the fields by hand.";

const YOUTUBE: MentionPreviewData = {
  platform: 'youtube',
  external_id: 'seedvid0009',
  canonical_url: 'https://www.youtube.com/watch?v=seedvid0009',
  title: 'A fixture video about the mace',
  creator_name: 'BlockBuddy',
  creator_url: 'https://www.youtube.com/channel/UCfixture000000000000001',
  thumbnail_url: 'https://i.ytimg.com/vi/seedvid0009/hqdefault.jpg',
  published_at: '2026-06-14T16:30:45Z',
  view_count: 212_345,
  source: 'data_api',
};

const ARTICLE: MentionPreviewData = {
  platform: 'article',
  external_id: null,
  canonical_url: 'https://blog.example.test/mods/pipe-mace',
  title: 'Ten loud mods',
  creator_name: 'Example Blog',
  creator_url: null,
  thumbnail_url: null,
  published_at: null,
  view_count: null,
  source: 'og',
};

function draft(overrides: Partial<MentionDraft> = {}): MentionDraft {
  return { ...EMPTY_DRAFT, title: 'A title', creatorName: 'A creator', ...overrides };
}

function built(args: Parameters<typeof buildCreateMentionInput>[0]) {
  const result = buildCreateMentionInput(args);
  if (!result.ok) throw new Error(`expected a payload, got ${JSON.stringify(result.errors)}`);
  return result.input;
}

function refused(args: Parameters<typeof buildCreateMentionInput>[0]) {
  const result = buildCreateMentionInput(args);
  if (result.ok) throw new Error('expected field errors, got a payload');
  return result.errors;
}

function validation(issues: { path: string; message: string }[]): ActionError {
  return { code: 'validation', message: 'Check the form.', field: issues[0]?.path, issues };
}

describe('T-E2E-39 guessPlatform — the platform Select default after an unreadable page', () => {
  const LINKS = [
    'https://www.youtube.com/watch?v=seedvid0009',
    'https://youtu.be/seedvid0009',
    'https://m.youtube.com/watch?v=seedvid0009',
    'http://youtube.com/shorts/seedvid0009',
    'https://www.tiktok.com/@seedtok/video/1',
    'https://vm.tiktok.com/abc/',
    'https://clips.twitch.tv/Some-Clip',
    'https://www.twitch.tv/videos/1',
    'https://www.reddit.com/r/minecraftmods/comments/1',
    'https://old.reddit.com/r/minecraftmods',
    'https://redd.it/abc123',
    'https://blog.example.test/post',
    'https://evilyoutube.com/watch?v=seedvid0009',
    'https://youtube.com.evil.test/watch',
    'https://youtube.com./watch?v=seedvid0009',
    'https://YOUTUBE.com/watch?v=seedvid0009',
    'ftp://youtube.com/file',
    'javascript:alert(1)',
    'youtube.com/watch?v=seedvid0009',
    'not a link',
    '',
  ];

  it.each(LINKS)('T-E2E-39 %j reads the same as the adapter’s detectPlatform', (link) => {
    expect(guessPlatform(link)).toBe(detectPlatform(link));
  });

  it('T-E2E-39 the six listed domains map to their platform, everything else is an article', () => {
    expect(guessPlatform('https://youtu.be/seedvid0009')).toBe('youtube');
    expect(guessPlatform('https://www.tiktok.com/@a/video/1')).toBe('tiktok');
    expect(guessPlatform('https://clips.twitch.tv/x')).toBe('twitch');
    expect(guessPlatform('https://redd.it/x')).toBe('reddit');
    expect(guessPlatform('https://blog.example.test/x')).toBe('article');
    expect(guessPlatform('  https://www.youtube.com/watch?v=seedvid0009  ')).toBe('youtube');
  });

  it('T-E2E-39 draftForUrl = empty fields + the guessed platform', () => {
    expect(draftForUrl('https://www.tiktok.com/@a/video/1')).toEqual({
      ...EMPTY_DRAFT,
      platform: 'tiktok',
    });
    expect(draftForUrl('nonsense')).toEqual({ ...EMPTY_DRAFT, platform: 'article' });
  });
});

describe('T-E2E-39 draftFromPreview / previewIsComplete — how "Edit fields" starts', () => {
  it('T-E2E-39 a full YouTube preview seeds every field as text', () => {
    expect(draftFromPreview(YOUTUBE)).toEqual({
      platform: 'youtube',
      title: 'A fixture video about the mace',
      creatorName: 'BlockBuddy',
      creatorUrl: 'https://www.youtube.com/channel/UCfixture000000000000001',
      date: '2026-06-14',
      views: '212345',
    });
  });

  it('T-E2E-39 nulls become empty text — never "0" views, never an invented date', () => {
    expect(draftFromPreview(ARTICLE)).toEqual({
      platform: 'article',
      title: 'Ten loud mods',
      creatorName: 'Example Blog',
      creatorUrl: '',
      date: '',
      views: '',
    });
    expect(draftFromPreview({ ...ARTICLE, creator_name: null }).creatorName).toBe('');
  });

  it('T-E2E-39 a zero view count the platform really reported is kept', () => {
    expect(draftFromPreview({ ...YOUTUBE, view_count: 0 }).views).toBe('0');
  });

  it.each([
    ['http://www.youtube.com/@plain', 'not https'],
    [`https://example.test/${'a'.repeat(512)}`, 'over 512 characters'],
  ])('T-E2E-39 a fetched creator link the schema would refuse is dropped (%s — %s)', (link) => {
    expect(draftFromPreview({ ...YOUTUBE, creator_url: link }).creatorUrl).toBe('');
  });

  it.each(['yesterday', '', '2026-13-45T00:00:00Z'])(
    'T-E2E-39 an unparseable fetched date %j seeds no date',
    (value) => {
      expect(draftFromPreview({ ...ARTICLE, published_at: value }).date).toBe('');
    },
  );

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'T-E2E-39 a view count that is not a whole number ≥ 0 (%s) seeds none',
    (value) => {
      expect(draftFromPreview({ ...YOUTUBE, view_count: value }).views).toBe('');
    },
  );

  it('T-E2E-39 the date is the UTC day, whatever offset the platform wrote', () => {
    expect(draftFromPreview({ ...YOUTUBE, published_at: '2026-06-14T23:30:00-05:00' }).date).toBe(
      '2026-06-15',
    );
  });

  it('T-E2E-39 a preview needs a title AND a creator name to show as a card', () => {
    expect(previewIsComplete(YOUTUBE)).toBe(true);
    expect(previewIsComplete({ ...YOUTUBE, creator_name: null })).toBe(false);
    expect(previewIsComplete({ ...YOUTUBE, creator_name: '   ' })).toBe(false);
    expect(previewIsComplete({ ...YOUTUBE, title: '' })).toBe(false);
    expect(previewIsComplete({ ...YOUTUBE, title: ' \n ' })).toBe(false);
  });
});

describe('T-E2E-39 storedLink — the address the card and the manual fields show (ADR-0046)', () => {
  it('T-E2E-39 a fetched page → its canonical_url verbatim, whatever was pasted', () => {
    expect(storedLink('https://youtu.be/abc?si=tracking', YOUTUBE)).toBe(YOUTUBE.canonical_url);
    expect(storedLink('', YOUTUBE)).toBe(YOUTUBE.canonical_url);
    const elsewhere = { ...YOUTUBE, canonical_url: 'https://example.test/other' };
    expect(storedLink('https://example.test/pasted', elsewhere)).toBe('https://example.test/other');
  });

  it('T-E2E-39 no page read → the pasted link trimmed, normalised and upgraded to https (the readMentionUrl rule)', () => {
    expect(storedLink('  http://127.0.0.1:4010/x  ', null)).toBe('https://127.0.0.1:4010/x');
    expect(storedLink('HTTPS://Example.TEST/Path?q=1#frag', null)).toBe(
      'https://example.test/Path?q=1#frag',
    );
    expect(storedLink('https://example.test', null)).toBe('https://example.test/');
  });

  it('T-E2E-39 the same string buildCreateMentionInput sends as url, on both paths', () => {
    const fetched = buildCreateMentionInput({
      url: 'https://youtu.be/abc',
      preview: YOUTUBE,
      draft: draftFromPreview(YOUTUBE),
      projectId: '',
    });
    if (!fetched.ok) throw new Error('fetched path builds');
    expect(fetched.input.url).toBe(storedLink('https://youtu.be/abc', YOUTUBE));
    // By hand the client sends the trimmed text and the server upgrades the scheme — the line
    // shows the upgraded form, which is what the row will hold.
    const typed = buildCreateMentionInput({
      url: ' https://example.test/post ',
      preview: null,
      draft: { ...EMPTY_DRAFT, title: 'x', creatorName: 'y' },
      projectId: '',
    });
    if (!typed.ok) throw new Error('typed path builds');
    expect(storedLink(' https://example.test/post ', null)).toBe(typed.input.url);
  });

  it("T-E2E-39 nothing pasted → ''; text that is not a URL is shown as typed (the schema refuses it)", () => {
    expect(storedLink('', null)).toBe('');
    expect(storedLink('   ', null)).toBe('');
    expect(storedLink('not a link', null)).toBe('not a link');
  });
});

describe('T-E2E-39 buildCreateMentionInput — what PUBLISH sends', () => {
  it('T-E2E-39 an untouched YouTube preview → the full 04 §1.6 payload, published, not featured', () => {
    const input = built({
      url: 'https://youtu.be/seedvid0009?si=abc',
      preview: YOUTUBE,
      draft: draftFromPreview(YOUTUBE),
      projectId: PROJECT,
    });
    expect(input).toEqual({
      url: 'https://www.youtube.com/watch?v=seedvid0009',
      project_id: PROJECT,
      platform: 'youtube',
      external_id: 'seedvid0009',
      title: 'A fixture video about the mace',
      creator_name: 'BlockBuddy',
      creator_url: 'https://www.youtube.com/channel/UCfixture000000000000001',
      thumbnail_url: 'https://i.ytimg.com/vi/seedvid0009/hqdefault.jpg',
      published_at: '2026-06-14T16:30:45.000Z',
      view_count: 212_345,
      status: 'published',
      featured: false,
    });
    expect(createMentionInput.safeParse(input).success).toBe(true);
  });

  it('T-E2E-39 "About OddSense generally" (the empty value) → project_id null', () => {
    const input = built({
      url: '',
      preview: ARTICLE,
      draft: draftFromPreview(ARTICLE),
      projectId: '',
    });
    expect(input.project_id).toBeNull();
  });

  it('T-E2E-39 optional keys are OMITTED, never null (create refuses null)', () => {
    const input = built({
      url: '',
      preview: ARTICLE,
      draft: draftFromPreview(ARTICLE),
      projectId: '',
    });
    expect(input).toEqual({
      url: 'https://blog.example.test/mods/pipe-mace',
      project_id: null,
      platform: 'article',
      title: 'Ten loud mods',
      creator_name: 'Example Blog',
      status: 'published',
      featured: false,
    });
    expect(Object.values(input).every((value) => value !== undefined)).toBe(true);
    expect(createMentionInput.safeParse(input).success).toBe(true);
  });

  it('T-E2E-39 by hand, no preview → the typed link (trimmed), the typed fields, nothing fetched', () => {
    const input = built({
      url: '  https://www.tiktok.com/@seedtok/video/1  ',
      preview: null,
      draft: draft({
        platform: 'tiktok',
        title: '  this mod makes no sense  ',
        creatorName: ' seedtok ',
        creatorUrl: ' https://www.tiktok.com/@seedtok ',
        date: '2026-05-02',
        views: ' 1200 ',
      }),
      projectId: PROJECT,
    });
    expect(input).toEqual({
      url: 'https://www.tiktok.com/@seedtok/video/1',
      project_id: PROJECT,
      platform: 'tiktok',
      title: 'this mod makes no sense',
      creator_name: 'seedtok',
      creator_url: 'https://www.tiktok.com/@seedtok',
      published_at: '2026-05-02T00:00:00.000Z',
      view_count: 1200,
      status: 'published',
      featured: false,
    });
    expect(createMentionInput.safeParse(input).success).toBe(true);
  });

  it('T-E2E-39 an untouched date keeps the platform’s exact moment; a retyped day is midnight UTC', () => {
    const kept = built({
      url: '',
      preview: YOUTUBE,
      draft: draftFromPreview(YOUTUBE),
      projectId: '',
    });
    expect(kept.published_at).toBe('2026-06-14T16:30:45.000Z');
    const retyped = built({
      url: '',
      preview: YOUTUBE,
      draft: { ...draftFromPreview(YOUTUBE), date: '2026-06-01' },
      projectId: '',
    });
    expect(retyped.published_at).toBe('2026-06-01T00:00:00.000Z');
    const cleared = built({
      url: '',
      preview: YOUTUBE,
      draft: { ...draftFromPreview(YOUTUBE), date: '' },
      projectId: '',
    });
    expect('published_at' in cleared).toBe(false);
  });

  it('T-E2E-39 a fetched offset timestamp is sent in the Z form the schema reads', () => {
    const preview = { ...YOUTUBE, published_at: '2026-06-14T23:30:00-05:00' };
    const input = built({ url: '', preview, draft: draftFromPreview(preview), projectId: '' });
    expect(input.published_at).toBe('2026-06-15T04:30:00.000Z');
    expect(createMentionInput.safeParse(input).success).toBe(true);
  });

  it('T-E2E-39 changing the platform drops the fetched id and thumbnail', () => {
    const input = built({
      url: '',
      preview: YOUTUBE,
      draft: { ...draftFromPreview(YOUTUBE), platform: 'other' },
      projectId: '',
    });
    expect(input.platform).toBe('other');
    expect('external_id' in input).toBe(false);
    expect('thumbnail_url' in input).toBe(false);
    expect(createMentionInput.safeParse(input).success).toBe(true);
  });

  it.each([
    ['http://img.example.test/a.jpg', 'not https'],
    [`https://img.example.test/${'a'.repeat(512)}`, 'over 512 characters'],
  ])('T-E2E-39 a fetched thumbnail the schema would refuse is not sent (%s — %s)', (thumb) => {
    const preview = { ...ARTICLE, thumbnail_url: thumb };
    const input = built({ url: '', preview, draft: draftFromPreview(preview), projectId: '' });
    expect('thumbnail_url' in input).toBe(false);
  });

  it('T-E2E-39 cleared views / creator link are omitted; a typed 0 is sent as 0', () => {
    const base = draftFromPreview(YOUTUBE);
    const cleared = built({
      url: '',
      preview: YOUTUBE,
      draft: { ...base, views: '  ', creatorUrl: '' },
      projectId: '',
    });
    expect('view_count' in cleared).toBe(false);
    expect('creator_url' in cleared).toBe(false);
    const zero = built({
      url: '',
      preview: YOUTUBE,
      draft: { ...base, views: '0' },
      projectId: '',
    });
    expect(zero.view_count).toBe(0);
  });

  it('T-E2E-39 a typed creator link is sent as typed — the server owns that rule', () => {
    const input = built({
      url: 'https://blog.example.test/x',
      preview: null,
      draft: draft({ creatorUrl: 'http://plain.example.test' }),
      projectId: '',
    });
    expect(input.creator_url).toBe('http://plain.example.test');
    expect(createMentionInput.safeParse(input).success).toBe(false);
  });

  it('T-E2E-39 no link at all → "Paste a link." on the link field, nothing sent', () => {
    expect(refused({ url: '   ', preview: null, draft: draft(), projectId: '' })).toEqual({
      url: PASTE_A_LINK,
    });
  });

  it.each([
    '14/06/2026',
    '2026-6-14',
    '2026-02-31',
    '2026-13-01',
    '0000-00-00',
    'June',
    '20260614',
  ])('T-E2E-39 date %j → the date field’s own line', (date) => {
    expect(
      refused({
        url: 'https://a.example.test',
        preview: null,
        draft: draft({ date }),
        projectId: '',
      }),
    ).toEqual({ published_at: DATE_MESSAGE });
  });

  it('T-E2E-39 a leap day is a day', () => {
    const input = built({
      url: 'https://a.example.test',
      preview: null,
      draft: draft({ date: '2028-02-29' }),
      projectId: '',
    });
    expect(input.published_at).toBe('2028-02-29T00:00:00.000Z');
  });

  it.each(['-1', '1.5', '1e3', '12k', '1,200', '99999999999999999999'])(
    'T-E2E-39 views %j → the views field’s own line',
    (views) => {
      expect(
        refused({
          url: 'https://a.example.test',
          preview: null,
          draft: draft({ views }),
          projectId: '',
        }),
      ).toEqual({ view_count: VIEWS_MESSAGE });
    },
  );

  it('T-E2E-39 every client-side problem is reported at once', () => {
    expect(
      refused({
        url: '',
        preview: null,
        draft: draft({ date: 'soon', views: 'lots' }),
        projectId: '',
      }),
    ).toEqual({ url: PASTE_A_LINK, published_at: DATE_MESSAGE, view_count: VIEWS_MESSAGE });
  });

  it('T-E2E-39 an empty title or creator is NOT refused here — the action says it, in its words', () => {
    const input = built({
      url: 'https://a.example.test',
      preview: null,
      draft: { ...EMPTY_DRAFT },
      projectId: '',
    });
    expect(input.title).toBe('');
    expect(input.creator_name).toBe('');
    const parsed = createMentionInput.safeParse(input);
    expect(parsed.success).toBe(false);
  });

  it('T-E2E-39 every gallery fixture with a preview builds a payload the schema accepts', () => {
    for (const { label, props } of mentionPreviewFixtures) {
      if (props.preview === null) continue;
      const input = built({
        url: '',
        preview: props.preview,
        draft: draftFromPreview(props.preview),
        projectId: props.projects[0]?.id ?? '',
      });
      expect(createMentionInput.safeParse(input).success, label).toBe(true);
    }
  });
});

describe('T-E2E-39 fetchErrors — where a failed Fetch says so', () => {
  it('T-E2E-39 upstream_error → the line, verbatim (then the manual fields)', () => {
    expect(fetchErrors({ code: 'upstream_error', message: UNREADABLE })).toEqual({
      line: UNREADABLE,
    });
  });

  it('T-E2E-39 validation → the link field, with the url issue’s own words', () => {
    expect(
      fetchErrors(validation([{ path: 'url', message: "That doesn't look like a link." }])),
    ).toEqual({ url: "That doesn't look like a link." });
  });

  it('T-E2E-39 validation without a url issue falls back to the message', () => {
    expect(fetchErrors(validation([{ path: '', message: 'Check this field.' }]))).toEqual({
      url: 'Check the form.',
    });
    expect(fetchErrors({ code: 'validation', message: 'Check the form.' })).toEqual({
      url: 'Check the form.',
    });
  });

  it.each(['rate_limited', 'forbidden', 'unauthenticated', 'internal'] as const)(
    'T-E2E-39 %s → the line (never a toast)',
    (code) => {
      expect(fetchErrors({ code, message: 'Words.' })).toEqual({ line: 'Words.' });
    },
  );
});

describe('T-E2E-39 publishErrors — where a failed PUBLISH says so', () => {
  it('T-E2E-39 conflict → the link field', () => {
    expect(
      publishErrors({
        code: 'conflict',
        message: 'That link is already on the list.',
        field: 'url',
      }),
    ).toEqual({ url: 'That link is already on the list.' });
  });

  it('T-E2E-39 validation issues land on their own field', () => {
    const errors = publishErrors(
      validation([
        { path: 'title', message: 'Type a title.' },
        { path: 'creator_name', message: "Type the creator's name." },
        { path: 'creator_url', message: 'Links start with https://.' },
        { path: 'published_at', message: 'Dates are ISO timestamps.' },
        { path: 'view_count', message: VIEWS_MESSAGE },
        { path: 'url', message: 'Links start with https://.' },
      ]),
    );
    expect(errors).toEqual({
      title: 'Type a title.',
      creator_name: "Type the creator's name.",
      creator_url: 'Links start with https://.',
      published_at: 'Dates are ISO timestamps.',
      view_count: VIEWS_MESSAGE,
      url: 'Links start with https://.',
    });
    expect(hasFieldError(errors)).toBe(true);
  });

  it('T-E2E-39 the first issue per field wins', () => {
    expect(
      publishErrors(
        validation([
          { path: 'title', message: 'Type a title.' },
          { path: 'title', message: 'Too long. 200 characters maximum.' },
        ]),
      ),
    ).toEqual({ title: 'Type a title.' });
  });

  it.each(['project_id', 'external_id', 'thumbnail_url', 'platform', ''])(
    'T-E2E-39 an issue with no field on screen (%j) reads on the line by the button',
    (path) => {
      const errors = publishErrors(validation([{ path, message: 'Pick a project.' }]));
      expect(errors).toEqual({ line: 'Pick a project.' });
      expect(hasFieldError(errors)).toBe(false);
    },
  );

  it('T-E2E-39 field issues and an off-screen issue together: fields + ONE line (the first)', () => {
    expect(
      publishErrors(
        validation([
          { path: 'external_id', message: "That isn't a YouTube video id." },
          { path: 'title', message: 'Type a title.' },
          { path: 'project_id', message: "That project doesn't exist." },
        ]),
      ),
    ).toEqual({ title: 'Type a title.', line: "That isn't a YouTube video id." });
  });

  it('T-E2E-39 validation with no issues at all → the message on the line', () => {
    expect(publishErrors({ code: 'validation', message: 'Check the form.' })).toEqual({
      line: 'Check the form.',
    });
    expect(publishErrors(validation([]))).toEqual({ line: 'Check the form.' });
  });

  it.each(['forbidden', 'unauthenticated', 'rate_limited', 'internal', 'not_found'] as const)(
    'T-E2E-39 %s → the line (never a toast — 03 C-30)',
    (code) => {
      const errors = publishErrors({ code, message: 'Words.' });
      expect(errors).toEqual({ line: 'Words.' });
      expect(hasFieldError(errors)).toBe(false);
    },
  );

  it('T-E2E-39 a link-only error is not a manual-field error (the card may stay)', () => {
    expect(hasFieldError({ url: 'That link is already on the list.' })).toBe(false);
    expect(hasFieldError({})).toBe(false);
    expect(hasFieldError({ view_count: VIEWS_MESSAGE })).toBe(true);
  });
});
