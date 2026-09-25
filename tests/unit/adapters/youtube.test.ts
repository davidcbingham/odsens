/**
 * tests/unit/adapters/youtube.test.ts — `lib/adapters/youtube.ts` (05 T-ADP-9..13, T-UNIT-29 and the
 * youtube half of T-ADP-20; T-ADP-14/15 — `videoIdFromUrl` / `oembed`, consumed from S1.8 — land
 * here with the functions; 04 §4.3 export list, §5.3 Shorts rows; ADR-0043 D2/D3; ADR-0045 — the
 * S1.8 additions: `listVideoStats` (T-ADP-13 legs), `getVideoMeta` + `OEMBED_BASE` (T-ADP-15 legs)).
 * Fixtures: `tests/fixtures/youtube/{rss.xml, rss-malformed.xml, videos-list.json,
 * videos-mentions.json, playlist-items.json, channels.json, oembed.json, videos/seedvid0009.json}`
 * (F-5; hand-made in the upstream shapes — README) + the fixture-server aliases `videos.json` /
 * `playlistItems.json`.
 * The set: 21 uploads `fixvid00001..fixvid00021` (never a seed id) — 1 live
 * (`…08`), 1 upcoming (`…09`), 3 Shorts (`…03` by duration, `…04` `#shorts` in the title, `…05`
 * `#Shorts` in the description), 16 long; the feed carries the newest 15. Variants (a second page,
 * a looping token, 120 ids) are derived in memory (F-6). Pure over `mockFetch` (05 H-5).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { AdapterError } from '@/lib/adapters/http';
import {
  MAX_UPLOAD_PAGES,
  VIDEOS_BATCH,
  YOUTUBE_API,
  YOUTUBE_OEMBED,
  YOUTUBE_RSS,
  createYoutube,
  isShort,
  mapVideo,
  parseDuration,
  parseRss,
  pickThumbnail,
  videoIdFromUrl,
  type YoutubeVideoItem,
} from '@/lib/adapters/youtube';
import { loadFixture, loadFixtureText } from '../../helpers/fixtures';
import { mockFetch } from '../../helpers/mockFetch';

const UA = 'odsens.com/test (localhost)';
const KEY = 'test-yt-key-hunter2';
const CHANNEL = 'UCseedchannel000000000000';
const UPLOADS = 'UUseedchannel000000000000';
const ENV = { MODRINTH_USER_AGENT: UA, YOUTUBE_CHANNEL_ID: CHANNEL, YOUTUBE_API_KEY: KEY };
const ENV_NO_KEY = { MODRINTH_USER_AGENT: UA, YOUTUBE_CHANNEL_ID: CHANNEL };

type VideosList = { items: YoutubeVideoItem[] };
type PlaylistItems = {
  items: { contentDetails: { videoId: string } }[];
  nextPageToken?: string;
};

const rssXml = await loadFixtureText('youtube', 'rss.xml');
const rssMalformedXml = await loadFixtureText('youtube', 'rss-malformed.xml');
const videosList = await loadFixture<VideosList>('youtube', 'videos-list.json');
const videosMentions = await loadFixture<VideosList>('youtube', 'videos-mentions.json');
const playlistItems = await loadFixture<PlaylistItems>('youtube', 'playlist-items.json');
const channels = await loadFixture('youtube', 'channels.json');
const oembedFixture = await loadFixture('youtube', 'oembed.json');
const seedVideo = await loadFixture<{ items: Record<string, unknown>[] }>(
  'youtube',
  'videos/seedvid0009.json',
);

const fixvid = (n: number): string => `fixvid${String(n).padStart(5, '0')}`;
const ALL_IDS = Array.from({ length: 21 }, (_, index) => fixvid(index + 1));

function item(id: string): YoutubeVideoItem {
  const found = videosList.items.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`fixture video ${id} missing from videos-list.json`);
  return found;
}

const xml = (body: string): Response =>
  new Response(body, { status: 200, headers: { 'content-type': 'application/xml' } });

const caught = (promise: Promise<unknown>): Promise<AdapterError | null> =>
  promise.then(
    () => null,
    (thrown: unknown) => thrown as AdapterError,
  );

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('T-ADP-9 youtube fetchRss (04 §4.3, §3.3 step 1)', () => {
  it('T-ADP-9 fetchRss(channelId) on rss.xml → {youtube_id, title, published_at, thumbnail_url, description}; URL is the keyless feed with the SC-10 UA', async () => {
    const headers: Record<string, string | null> = {};
    const fetchSpy = vi.fn(
      mockFetch({
        [YOUTUBE_RSS]: (request) => {
          headers['user-agent'] = request.headers.get('user-agent');
          headers.accept = request.headers.get('accept');
          return xml(rssXml);
        },
      }),
    );
    const youtube = createYoutube({ fetch: fetchSpy, env: ENV });
    const videos = await youtube.fetchRss(CHANNEL);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      'https://www.youtube.com/feeds/videos.xml?channel_id=UCseedchannel000000000000',
    );
    expect(String(fetchSpy.mock.calls[0]?.[0])).not.toContain('key=');
    expect(headers['user-agent']).toBe(UA);
    expect(headers.accept).toContain('application/atom+xml');

    // The feed = the newest 15 uploads, in feed order — live `…08` and upcoming `…09` included
    // (the feed has no live flag; ADR-0043 D2 drops them at `listVideos`).
    expect(videos.map((video) => video.youtube_id)).toEqual(ALL_IDS.slice(0, 15));
    expect(videos[0]).toEqual({
      youtube_id: 'fixvid00001',
      title: 'I Rebuilt My Base & Regretted It', // `&amp;` decoded
      published_at: '2026-05-30T15:00:07.000Z', // `+00:00` normalised to toISOString()
      thumbnail_url: 'https://i.ytimg.com/vi/fixvid00001/hqdefault.jpg',
      description:
        'Turns out a lava moat needs a plan.\n\nMods used are listed on the site.\nMusic: none, just vibes.',
    });
    // media:thumbnail@url is returned VERBATIM — the job, not the adapter, writes the i.ytimg.com
    // literal (01 INV-54 allows `i.ytimg.com` only).
    expect(videos[2]?.thumbnail_url).toBe('https://i3.ytimg.com/vi/fixvid00003/hqdefault.jpg');
    expect(
      videos.filter((video) => !video.thumbnail_url?.startsWith('https://i.ytimg.com/')),
    ).toHaveLength(1);
    // An empty <media:description> is null, never ''.
    expect(videos.find((video) => video.youtube_id === 'fixvid00011')?.description).toBeNull();
    expect(youtube.unitsUsed).toBe(0); // RSS is free
  });

  it('T-ADP-9 fetchRss() defaults to env.YOUTUBE_CHANNEL_ID, honours YOUTUBE_RSS_BASE and ignores a JSON content type', async () => {
    const base = 'http://127.0.0.1:4010/youtube/rss.xml';
    const fetchSpy = vi.fn(
      mockFetch({
        [base]: () =>
          new Response(rssXml, { status: 200, headers: { 'content-type': 'application/json' } }),
      }),
    );
    const youtube = createYoutube({
      fetch: fetchSpy,
      env: { ...ENV_NO_KEY, YOUTUBE_RSS_BASE: base },
    });
    expect(await youtube.fetchRss()).toHaveLength(15);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(`${base}?channel_id=${CHANNEL}`);
  });

  it('T-ADP-9 rss-malformed.xml → typed parse_error (body ≤ 300), not retried', async () => {
    const fetchSpy = vi.fn(mockFetch({ [YOUTUBE_RSS]: () => xml(rssMalformedXml) }));
    const youtube = createYoutube({ fetch: fetchSpy, env: ENV });
    const error = await caught(youtube.fetchRss(CHANNEL));
    expect(error).toBeInstanceOf(AdapterError);
    expect(error).toMatchObject({ status: 200, code: 'parse_error' });
    expect(error?.body).toBe(rssMalformedXml.slice(0, 300));
    expect(error?.message).toContain(`${YOUTUBE_RSS}?channel_id=${CHANNEL}`);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('T-ADP-9 fetchRss goes through the SC-09 loop: 5xx retried ≤ 3 with backoff, 404 not retried', async () => {
    vi.useFakeTimers();
    const retried = vi.fn(
      mockFetch({ [YOUTUBE_RSS]: () => new Response('boom', { status: 500 }) }),
    );
    const settled = caught(createYoutube({ fetch: retried, env: ENV }).fetchRss());
    await vi.runAllTimersAsync();
    expect(await settled).toMatchObject({ status: 500, code: 'http_error', body: 'boom' });
    expect(retried).toHaveBeenCalledTimes(4);

    vi.useRealTimers();
    const once = vi.fn(mockFetch({ [YOUTUBE_RSS]: () => new Response('gone', { status: 404 }) }));
    await expect(createYoutube({ fetch: once, env: ENV }).fetchRss()).rejects.toMatchObject({
      status: 404,
    });
    expect(once).toHaveBeenCalledTimes(1);
  });

  const entry = (inner: string): string =>
    `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry>${inner}</entry></feed>`;
  const GOOD =
    '<yt:videoId>fixvid00001</yt:videoId><title>T</title><published>2026-01-01T00:00:00+00:00</published>';

  it.each([
    ['no <feed> root', '<html><body>Sign in</body></html>', 'not an Atom feed'],
    ['no </feed>', '<feed><title>x</title>', 'not an Atom feed'],
    ['<entry> opens ≠ closes', '<feed><entry></entry><entry></feed>', 'unbalanced <entry>'],
    ['entry without yt:videoId', entry('<title>T</title>'), 'yt:videoId'],
    ['yt:videoId of the wrong length', entry(GOOD.replace('fixvid00001', 'short')), 'yt:videoId'],
    ['entry without title', entry(GOOD.replace('<title>T</title>', '')), 'title'],
    ['empty title', entry(GOOD.replace('<title>T</title>', '<title> </title>')), 'title'],
    ['entry without published', entry(GOOD.replace(/<published>.*<\/published>/, '')), 'published'],
    [
      'unparseable published',
      entry(GOOD.replace('2026-01-01T00:00:00+00:00', 'soon')),
      'published',
    ],
  ])('T-ADP-9 parseRss: %s → typed parse_error', (_label, body, why) => {
    let thrown: unknown;
    try {
      parseRss(body);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AdapterError);
    expect(thrown).toMatchObject({ status: 200, code: 'parse_error' });
    expect((thrown as AdapterError).message).toContain(why);
    expect((thrown as AdapterError).message).toContain(YOUTUBE_RSS);
  });

  it('T-ADP-9 parseRss: a complete feed with no entries → []; missing thumbnail/description → null', () => {
    expect(
      parseRss('<feed xmlns="http://www.w3.org/2005/Atom"><title>OdSens</title></feed>'),
    ).toEqual([]);
    expect(parseRss(entry(GOOD))).toEqual([
      {
        youtube_id: 'fixvid00001',
        title: 'T',
        published_at: '2026-01-01T00:00:00.000Z',
        thumbnail_url: null,
        description: null,
      },
    ]);
    // A thumbnail tag with no url attribute, and one with an empty url, both read as null.
    expect(parseRss(entry(`${GOOD}<media:thumbnail width="480"/>`))[0]?.thumbnail_url).toBeNull();
    expect(parseRss(entry(`${GOOD}<media:thumbnail url="" />`))[0]?.thumbnail_url).toBeNull();
  });

  it('T-ADP-9 parseRss decodes entities once, keeps CDATA verbatim, reads single-quoted attributes, never leaks a key into the label', () => {
    const [video] = parseRss(
      entry(
        '<yt:videoId>fixvid00001</yt:videoId>' +
          '<title type="text">Tom &amp; Jerry &lt;3 &quot;q&quot; &apos;a&apos; &#39;d&#39; &#x1F600; &amp;lt; &bogus; &#0;</title>' +
          '<published>2026-01-01T00:00:00Z</published>' +
          "<media:group><media:thumbnail width='480' url='https://i2.ytimg.com/vi/fixvid00001/hqdefault.jpg?a=1&amp;b=2'/>" +
          '<media:description>before &amp; <![CDATA[<b>raw &amp; kept</b>]]> after &gt;</media:description></media:group>',
      ),
    );
    expect(video?.title).toBe(`Tom & Jerry <3 "q" 'a' 'd' \u{1F600} &lt; &bogus; &#0;`);
    expect(video?.thumbnail_url).toBe('https://i2.ytimg.com/vi/fixvid00001/hqdefault.jpg?a=1&b=2');
    expect(video?.description).toBe('before & <b>raw &amp; kept</b> after >');

    let thrown: unknown;
    try {
      parseRss('nope', 'https://feeds.test/videos.xml?channel_id=UC1&key=hunter2');
    } catch (error) {
      thrown = error;
    }
    expect((thrown as AdapterError).message).toContain('key=[redacted]');
    expect((thrown as AdapterError).message).not.toContain('hunter2');
  });
});

describe('T-ADP-10 youtube listVideos + parseDuration (04 §4.3, §3.3 step 2)', () => {
  it('T-ADP-10 listVideos(ids) → one request, part=snippet,contentDetails,statistics, key as a query param, SC-10 UA + Accept', async () => {
    const headers: Record<string, string | null> = {};
    const fetchSpy = vi.fn(
      mockFetch({
        [`${YOUTUBE_API}/videos`]: (request) => {
          headers['user-agent'] = request.headers.get('user-agent');
          headers.accept = request.headers.get('accept');
          return Response.json(videosList);
        },
      }),
    );
    const youtube = createYoutube({ fetch: fetchSpy, env: ENV });
    const videos = await youtube.listVideos(['fixvid00001', 'fixvid00002', 'fixvid00001']);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // Commas stay literal, duplicate ids are asked for once, `key` goes last.
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics&id=fixvid00001,fixvid00002&key=${KEY}`,
    );
    expect(headers['user-agent']).toBe(UA);
    expect(headers.accept).toBe('application/json');
    expect(videos).toHaveLength(19); // the fixture answers with all 21; live + upcoming dropped
    expect(youtube.unitsUsed).toBe(1);
  });

  it('T-ADP-10 listVideos batches ids into requests of ≤ 50, sequentially; [] → no request', async () => {
    const batches: string[][] = [];
    const fetchSpy = vi.fn(
      mockFetch({
        [`${YOUTUBE_API}/videos`]: (request) => {
          batches.push(new URL(request.url).searchParams.get('id')?.split(',') ?? []);
          return Response.json({ items: [] });
        },
      }),
    );
    const youtube = createYoutube({ fetch: fetchSpy, env: ENV });
    const ids = Array.from({ length: 101 }, (_, index) => `b${String(index).padStart(10, '0')}`);
    expect(await youtube.listVideos(ids)).toEqual([]);
    expect(batches.map((batch) => batch.length)).toEqual([VIDEOS_BATCH, 50, 1]);
    expect(batches.flat()).toEqual(ids);

    expect(await youtube.listVideos([])).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(youtube.unitsUsed).toBe(3);
  });

  it('T-ADP-10 the key is redacted from thrown errors: 403 not retried, message/body carry no key', async () => {
    const fetchSpy = vi.fn(
      mockFetch({
        [`${YOUTUBE_API}/videos`]: (request) =>
          // A hostile upstream that echoes the request URL (key included) and the bare key back.
          new Response(`{"error":{"code":403,"message":"bad ${request.url} (${KEY})"}}`, {
            status: 403,
          }),
      }),
    );
    const error = await caught(
      createYoutube({ fetch: fetchSpy, env: ENV }).listVideos(['fixvid00001']),
    );
    expect(error).toBeInstanceOf(AdapterError);
    expect(error).toMatchObject({ status: 403, code: 'http_error' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    for (const text of [error?.message ?? '', error?.body ?? '', String(error)]) {
      expect(text).not.toContain(KEY);
    }
    expect(error?.message).toContain('key=[redacted]');
    expect(error?.body).toContain('key=[redacted] ([redacted])');
  });

  it('T-ADP-10 a key cut in half by the 300-char body truncation does not leak its head either', async () => {
    const impl = mockFetch({
      [`${YOUTUBE_API}/videos`]: () => new Response(`${'x'.repeat(290)}${KEY}`, { status: 400 }), // 10 key chars survive the cut
    });
    const error = await caught(
      createYoutube({ fetch: impl, env: ENV }).listVideos(['fixvid00001']),
    );
    expect(error?.body).toBe(`${'x'.repeat(290)}[redacted]`);
    expect(error?.body).not.toContain(KEY.slice(0, 6));
    // A short coincidental overlap (< 6 chars) is left alone.
    const short = mockFetch({
      [`${YOUTUBE_API}/videos`]: () =>
        new Response(`ends with ${KEY.slice(0, 4)}`, { status: 400 }),
    });
    const kept = await caught(
      createYoutube({ fetch: short, env: ENV }).listVideos(['fixvid00001']),
    );
    expect(kept?.body).toBe(`ends with ${KEY.slice(0, 4)}`);
  });

  it('T-ADP-10 the key is redacted from network errors and parse errors too; 5xx is retried ≤ 3', async () => {
    vi.useFakeTimers();
    const dead = (async (input: RequestInfo | URL) => {
      throw new TypeError(`fetch failed for ${String(input)} using ${KEY}`);
    }) as typeof fetch;
    const network = caught(createYoutube({ fetch: dead, env: ENV }).listVideos(['fixvid00001']));
    await vi.runAllTimersAsync();
    const networkError = await network;
    expect(networkError).toMatchObject({ status: 0, code: 'network_error' });
    expect(networkError?.message).not.toContain(KEY);

    const flaky = vi.fn(
      mockFetch({ [`${YOUTUBE_API}/videos`]: () => new Response('x', { status: 503 }) }),
    );
    const retried = caught(createYoutube({ fetch: flaky, env: ENV }).listVideos(['fixvid00001']));
    await vi.runAllTimersAsync();
    expect(await retried).toMatchObject({ status: 503 });
    expect(flaky).toHaveBeenCalledTimes(4);

    vi.useRealTimers();
    const malformed = mockFetch({ [`${YOUTUBE_API}/videos`]: () => Response.json({}) });
    const parseError = await caught(
      createYoutube({ fetch: malformed, env: ENV }).listVideos(['fixvid00001']),
    );
    expect(parseError).toMatchObject({ status: 200, code: 'parse_error', body: '{}' });
    expect(parseError?.message).toContain('key=[redacted]');
    expect(parseError?.message).not.toContain(KEY);
  });

  it('T-ADP-10 a non-AdapterError from the transport layer passes through untouched', async () => {
    const odd = mockFetch({
      [`${YOUTUBE_API}/videos`]: () =>
        ({
          ok: true,
          status: 200,
          text: () => Promise.reject(new RangeError('stream broke')),
        }) as unknown as Response,
    });
    await expect(
      createYoutube({ fetch: odd, env: ENV }).listVideos(['fixvid00001']),
    ).rejects.toBeInstanceOf(RangeError);
  });

  it.each([
    ['PT45S', 45],
    ['PT1M', 60],
    ['PT1M1S', 61],
    ['PT1H2M3S', 3723],
    ['P1DT1S', 86401],
    ['P1W', 604800],
    ['P0D', 0], // what a live / upcoming item reports
    ['PT0S', 0],
    ['', null],
    ['P', null],
    ['PT', null],
    ['P1DT', null],
    ['PT1.5S', null],
    ['P1Y', null],
    ['45', null],
    ['pt45s', null],
    ['PT45S ', null],
  ] as const)('T-ADP-10 parseDuration(%j) → %j', (iso, expected) => {
    expect(parseDuration(iso)).toBe(expected);
  });
});

describe('T-ADP-11 youtube isShort + live exclusion (04 §5.3, ADR-0002 #67/#77)', () => {
  it.each([
    ['PT45S no tag', { duration_seconds: 45, title: 'Pipe bonk', description: 'One bonk.' }, true],
    ['PT1M (= 60 s) no tag', { duration_seconds: 60, title: 'Bonk', description: null }, true],
    ['PT61S no tag', { duration_seconds: 61, title: 'Bonk', description: '' }, false],
    [
      'PT2M + #Shorts in description',
      {
        duration_seconds: 120,
        title: 'Heavy Spear',
        description: 'Fast tour.\n\n#Shorts #minecraft',
      },
      true,
    ],
    [
      'PT1M30S + #shorts in title',
      { duration_seconds: 90, title: 'What #shorts', description: null },
      true,
    ],
    ['PT10M', { duration_seconds: 600, title: 'Showcase', description: 'Long one.' }, false],
    ['duration null', { duration_seconds: null, title: 'Bonk', description: null }, false],
    [
      'duration null even with #shorts',
      { duration_seconds: null, title: 'Bonk #shorts', description: '#shorts' },
      false,
    ],
    [
      '#shortsighted is not the tag (\\b)',
      { duration_seconds: 600, title: '#shortsighted', description: null },
      false,
    ],
    [
      'word#shorts is not the tag (\\B)',
      { duration_seconds: 600, title: 'my#shorts', description: null },
      false,
    ],
  ] as const)('T-ADP-11 isShort: %s → %j', (_label, video, expected) => {
    expect(isShort(video)).toBe(expected);
  });

  it('T-ADP-11 the tag regex runs on title + " " + description (a tag split across the two never matches)', () => {
    expect(isShort({ duration_seconds: 600, title: 'ends with #', description: 'shorts' })).toBe(
      false,
    );
    expect(isShort({ duration_seconds: 600, title: 'x', description: '#SHORTS' })).toBe(true);
  });

  it('T-ADP-11 live / upcoming (liveBroadcastContent !== "none") are excluded from the mapped list', async () => {
    const impl = mockFetch({ [`${YOUTUBE_API}/videos`]: () => Response.json(videosList) });
    const videos = await createYoutube({ fetch: impl, env: ENV }).listVideos(ALL_IDS);
    const ids = videos.map((video) => video.youtube_id);
    expect(item('fixvid00008').snippet.liveBroadcastContent).toBe('live');
    expect(item('fixvid00009').snippet.liveBroadcastContent).toBe('upcoming');
    expect(ids).not.toContain('fixvid00008');
    expect(ids).not.toContain('fixvid00009');
    expect(ids).toEqual(ALL_IDS.filter((id) => id !== 'fixvid00008' && id !== 'fixvid00009'));
    // The fixture set's Shorts: by duration, by title tag, by description tag — 16 long remain.
    expect(videos.filter((video) => video.is_short).map((video) => video.youtube_id)).toEqual([
      'fixvid00003',
      'fixvid00004',
      'fixvid00005',
    ]);
    expect(videos.filter((video) => !video.is_short)).toHaveLength(16);
    // `fixvid00021` is PT1M1S — one second over, no tag → long.
    expect(videos.find((video) => video.youtube_id === 'fixvid00021')).toMatchObject({
      duration_seconds: 61,
      is_short: false,
    });
  });

  it('T-ADP-11 a missing liveBroadcastContent reads as "none" (kept)', async () => {
    const source = item('fixvid00001');
    const snippet = { ...source.snippet, liveBroadcastContent: undefined }; // JSON drops it
    const impl = mockFetch({
      [`${YOUTUBE_API}/videos`]: () => Response.json({ items: [{ ...source, snippet }] }),
    });
    const videos = await createYoutube({ fetch: impl, env: ENV }).listVideos(['fixvid00001']);
    expect(videos.map((video) => video.youtube_id)).toEqual(['fixvid00001']);
  });
});

describe('T-ADP-12 youtube mapVideo + listUploads (04 §4.3, §3.3 step 3)', () => {
  it('T-ADP-12 mapVideo(item) → the nine videos columns, counts as numbers, best thumbnail', () => {
    expect(mapVideo(item('fixvid00001'))).toEqual({
      youtube_id: 'fixvid00001',
      title: 'I Rebuilt My Base & Regretted It',
      description:
        'Turns out a lava moat needs a plan.\n\nMods used are listed on the site.\nMusic: none, just vibes.',
      thumbnail_url: 'https://i.ytimg.com/vi/fixvid00001/maxresdefault.jpg',
      published_at: '2026-05-30T15:00:07.000Z',
      duration_seconds: 724,
      is_short: false,
      view_count: 48211,
      like_count: 2140,
    });
    // No maxres → standard; only default → default.
    expect(mapVideo(item('fixvid00002')).thumbnail_url).toBe(
      'https://i.ytimg.com/vi/fixvid00002/sddefault.jpg',
    );
    expect(mapVideo(item('fixvid00003')).thumbnail_url).toBe(
      'https://i.ytimg.com/vi/fixvid00003/hqdefault.jpg',
    );
    expect(mapVideo(item('fixvid00020')).thumbnail_url).toBe(
      'https://i.ytimg.com/vi/fixvid00020/default.jpg',
    );
    expect(mapVideo(item('fixvid00010')).duration_seconds).toBe(3723);
  });

  it('T-ADP-12 missing statistics → view_count / like_count null (not 0); hidden likes → like_count null only', () => {
    expect(item('fixvid00006').statistics).toBeUndefined();
    expect(mapVideo(item('fixvid00006'))).toMatchObject({ view_count: null, like_count: null });
    expect(mapVideo(item('fixvid00007'))).toMatchObject({ view_count: 7044, like_count: null });
  });

  it('T-ADP-12 mapVideo tolerates sparse items: no contentDetails, no thumbnails, no description, junk counts', () => {
    const sparse: YoutubeVideoItem = {
      id: 'fixvid00099',
      snippet: { title: 'Sparse #shorts', publishedAt: '2026-01-01T00:00:00Z' },
      statistics: { viewCount: 'lots', likeCount: 12 },
    };
    expect(mapVideo(sparse)).toEqual({
      youtube_id: 'fixvid00099',
      title: 'Sparse #shorts',
      description: '',
      thumbnail_url: null,
      published_at: '2026-01-01T00:00:00.000Z',
      duration_seconds: null,
      is_short: false, // unknown duration is never a Short, tag or not
      view_count: null,
      like_count: 12,
    });
    expect(
      mapVideo({
        ...sparse,
        contentDetails: { duration: 'nonsense' },
        statistics: { viewCount: '-4', likeCount: '' },
      }),
    ).toMatchObject({ duration_seconds: null, view_count: null, like_count: null });
    expect(mapVideo({ ...sparse, contentDetails: {} }).duration_seconds).toBeNull();
  });

  it('T-ADP-12 listUploads(channelId) over playlist-items.json → all 21 ids; playlistId = "UU" + channelId.slice(2), 50/page', async () => {
    const fetchSpy = vi.fn(
      mockFetch({ [`${YOUTUBE_API}/playlistItems`]: () => Response.json(playlistItems) }),
    );
    const youtube = createYoutube({ fetch: fetchSpy, env: ENV });
    expect(await youtube.listUploads(CHANNEL)).toEqual(ALL_IDS);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&playlistId=${UPLOADS}&maxResults=50&key=${KEY}`,
    );
    expect(youtube.unitsUsed).toBe(1);
  });

  it('T-ADP-12 listUploads pages with nextPageToken until the last page (two pages derived in memory), defaulting to env.YOUTUBE_CHANNEL_ID', async () => {
    const tokens: (string | null)[] = [];
    const fetchSpy = vi.fn(
      mockFetch({
        [`${YOUTUBE_API}/playlistItems`]: (request) => {
          const token = new URL(request.url).searchParams.get('pageToken');
          tokens.push(token);
          return Response.json(
            token === null
              ? { items: playlistItems.items.slice(0, 10), nextPageToken: 'PAGE/2=' }
              : // Page 2 repeats one id of page 1 — the result is de-duplicated.
                { items: playlistItems.items.slice(9), nextPageToken: '' },
          );
        },
      }),
    );
    const youtube = createYoutube({ fetch: fetchSpy, env: ENV });
    expect(await youtube.listUploads()).toEqual(ALL_IDS);
    expect(tokens).toEqual([null, 'PAGE/2=']);
    expect(String(fetchSpy.mock.calls[1]?.[0])).toContain('&pageToken=PAGE%2F2%3D&key=');
    expect(youtube.unitsUsed).toBe(2);
  });

  it('T-ADP-12 listUploads stops on a repeated nextPageToken (a server that ignores pageToken) instead of looping', async () => {
    const fetchSpy = vi.fn(
      mockFetch({
        [`${YOUTUBE_API}/playlistItems`]: () =>
          Response.json({ ...playlistItems, nextPageToken: 'SAME' }),
      }),
    );
    const youtube = createYoutube({ fetch: fetchSpy, env: ENV });
    expect(await youtube.listUploads()).toEqual(ALL_IDS);
    expect(fetchSpy).toHaveBeenCalledTimes(2); // page 1, then the page "SAME" that answers "SAME" again
  });

  it('T-ADP-12 listUploads stops at the MAX_UPLOAD_PAGES cap when every page names a fresh token', async () => {
    let page = 0;
    const fetchSpy = vi.fn(
      mockFetch({
        [`${YOUTUBE_API}/playlistItems`]: () => {
          page += 1;
          return Response.json({
            items: [{ contentDetails: { videoId: `p${String(page).padStart(10, '0')}` } }],
            nextPageToken: `token-${page}`,
          });
        },
      }),
    );
    const youtube = createYoutube({ fetch: fetchSpy, env: ENV });
    expect(await youtube.listUploads()).toHaveLength(MAX_UPLOAD_PAGES);
    expect(fetchSpy).toHaveBeenCalledTimes(MAX_UPLOAD_PAGES);
    expect(youtube.unitsUsed).toBe(MAX_UPLOAD_PAGES);
  });

  it('T-ADP-12 listUploads: malformed body ({}) → typed parse_error; a failing page fails the walk', async () => {
    const malformed = mockFetch({ [`${YOUTUBE_API}/playlistItems`]: () => Response.json({}) });
    await expect(createYoutube({ fetch: malformed, env: ENV }).listUploads()).rejects.toMatchObject(
      { code: 'parse_error' },
    );
    const denied = mockFetch({
      [`${YOUTUBE_API}/playlistItems`]: () => new Response('nope', { status: 404 }),
    });
    await expect(createYoutube({ fetch: denied, env: ENV }).listUploads()).rejects.toMatchObject({
      status: 404,
      code: 'http_error',
    });
  });
});

describe('T-ADP-13 youtube quota guard + channelStats (04 §4.3 Quota, 00 S1.6 AC9)', () => {
  it('T-ADP-13 unitsUsed: a full sync over the fixtures (RSS + uploads walk + videos) spends 2 units ≤ 10', async () => {
    const youtube = createYoutube({
      fetch: mockFetch({
        [YOUTUBE_RSS]: () => xml(rssXml),
        [`${YOUTUBE_API}/playlistItems`]: () => Response.json(playlistItems),
        [`${YOUTUBE_API}/videos`]: () => Response.json(videosList),
      }),
      env: ENV,
    });
    expect(youtube.unitsUsed).toBe(0);
    const rss = await youtube.fetchRss();
    expect(youtube.unitsUsed).toBe(0); // RSS free
    const walked = await youtube.listUploads();
    const ids = [...new Set([...rss.map((video) => video.youtube_id), ...walked])];
    expect(ids).toHaveLength(21);
    expect(await youtube.listVideos(ids)).toHaveLength(19);
    expect(youtube.unitsUsed).toBe(2); // 1 playlistItems page + 1 videos call per 50 ids
    expect(youtube.unitsUsed).toBeLessThanOrEqual(10);
  });

  it('T-ADP-13 refreshMentions-sized input: 120 ids → 3 videos calls, 3 units; per instance, retries not re-counted', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fetchSpy = vi.fn(
      mockFetch({
        [`${YOUTUBE_API}/videos`]: () => {
          calls += 1;
          // The first attempt of the first batch fails once — an SC-09 retry, not a new unit.
          return calls === 1
            ? new Response('busy', { status: 503 })
            : Response.json(videosMentions);
        },
      }),
    );
    const youtube = createYoutube({ fetch: fetchSpy, env: ENV });
    const ids = Array.from({ length: 120 }, (_, index) => `m${String(index).padStart(10, '0')}`);
    const pending = youtube.listVideos(ids);
    await vi.runAllTimersAsync();
    const videos = await pending;
    expect(fetchSpy).toHaveBeenCalledTimes(4); // 3 batches (50/50/20) + 1 retry
    expect(youtube.unitsUsed).toBe(3);
    expect(videos).toHaveLength(6); // videos-mentions.json (2 items) × 3 answers
    expect(videos[1]).toMatchObject({
      youtube_id: 'fixmen00002',
      is_short: true,
      like_count: null,
    });
    expect(createYoutube({ fetch: fetchSpy, env: ENV }).unitsUsed).toBe(0); // a fresh instance starts at 0
  });

  it('T-ADP-13 channelStats(channelId) → {views, subs} from channels.json, 1 unit', async () => {
    const fetchSpy = vi.fn(
      mockFetch({ [`${YOUTUBE_API}/channels`]: () => Response.json(channels) }),
    );
    const youtube = createYoutube({ fetch: fetchSpy, env: ENV });
    expect(await youtube.channelStats(CHANNEL)).toEqual({ views: 1284530, subs: 21400 });
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${CHANNEL}&key=${KEY}`,
    );
    expect(youtube.unitsUsed).toBe(1);
  });

  it('T-ADP-13 channelStats: hidden subscriber count → subs null; unknown channel → not_found; junk viewCount → parse_error', async () => {
    const hidden = mockFetch({
      [`${YOUTUBE_API}/channels`]: () =>
        Response.json({
          items: [
            { statistics: { viewCount: '10', subscriberCount: '5', hiddenSubscriberCount: true } },
          ],
        }),
    });
    expect(await createYoutube({ fetch: hidden, env: ENV }).channelStats()).toEqual({
      views: 10,
      subs: null,
    });
    const absent = mockFetch({
      [`${YOUTUBE_API}/channels`]: () =>
        Response.json({ items: [{ statistics: { viewCount: 10 } }] }),
    });
    expect(await createYoutube({ fetch: absent, env: ENV }).channelStats()).toEqual({
      views: 10,
      subs: null,
    });

    for (const body of [{ items: [] }, { pageInfo: { totalResults: 0 } }]) {
      const none = mockFetch({ [`${YOUTUBE_API}/channels`]: () => Response.json(body) });
      const error = await caught(createYoutube({ fetch: none, env: ENV }).channelStats('UCnobody'));
      expect(error).toMatchObject({ status: 200, code: 'not_found' });
      expect(error?.message).not.toContain(KEY);
    }

    const junk = mockFetch({
      [`${YOUTUBE_API}/channels`]: () =>
        Response.json({ items: [{ statistics: { viewCount: 'many' } }] }),
    });
    await expect(createYoutube({ fetch: junk, env: ENV }).channelStats()).rejects.toMatchObject({
      code: 'parse_error',
    });
  });

  it('T-ADP-13 YOUTUBE_API_BASE overrides the Data-API host (ADR-0002 #73 — the :4010 fixture server paths)', async () => {
    const base = 'http://127.0.0.1:4010/youtube';
    const fetchSpy = vi.fn(
      mockFetch({
        [`${base}/videos`]: () => Response.json(videosList),
        [`${base}/playlistItems`]: () => Response.json(playlistItems),
        [`${base}/channels`]: () => Response.json(channels),
      }),
    );
    const youtube = createYoutube({ fetch: fetchSpy, env: { ...ENV, YOUTUBE_API_BASE: base } });
    await youtube.listUploads();
    await youtube.listVideos(['fixvid00001']);
    await youtube.channelStats();
    expect(fetchSpy.mock.calls.map((call) => String(call[0]).split('?')[0])).toEqual([
      `${base}/playlistItems`,
      `${base}/videos`,
      `${base}/channels`,
    ]);
  });

  it('T-ADP-13 no YOUTUBE_API_KEY: the adapter constructs, RSS works, Data-API methods throw "unsupported" with no request and no unit', async () => {
    const fetchSpy = vi.fn(mockFetch({ [YOUTUBE_RSS]: () => xml(rssXml) }));
    const youtube = createYoutube({ fetch: fetchSpy, env: ENV_NO_KEY });
    expect(youtube.hasKey).toBe(false);
    expect(createYoutube({ fetch: fetchSpy, env: ENV }).hasKey).toBe(true);
    expect(await youtube.fetchRss()).toHaveLength(15);
    for (const call of [
      () => youtube.listVideos(['fixvid00001']),
      () => youtube.listUploads(),
      () => youtube.channelStats(),
    ]) {
      const error = await caught(call());
      expect(error).toBeInstanceOf(AdapterError);
      expect(error).toMatchObject({ status: 0, code: 'unsupported' });
    }
    expect(fetchSpy).toHaveBeenCalledTimes(1); // the RSS call only
    expect(youtube.unitsUsed).toBe(0);
  });
});

describe('T-ADP-13 youtube listVideoStats (04 §3.4 — refreshMentions; ADR-0045)', () => {
  it('T-ADP-13 listVideoStats(ids) → one request with part=statistics ONLY, duplicates asked once, key last; {youtube_id, view_count} as numbers; 1 unit', async () => {
    const headers: Record<string, string | null> = {};
    const fetchSpy = vi.fn(
      mockFetch({
        [`${YOUTUBE_API}/videos`]: (request) => {
          headers['user-agent'] = request.headers.get('user-agent');
          headers.accept = request.headers.get('accept');
          return Response.json(videosMentions);
        },
      }),
    );
    const youtube = createYoutube({ fetch: fetchSpy, env: ENV });
    const stats = await youtube.listVideoStats(['fixmen00001', 'fixmen00002', 'fixmen00001']);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=fixmen00001,fixmen00002&key=${KEY}`,
    );
    expect(headers).toEqual({ 'user-agent': UA, accept: 'application/json' });
    // The full `videos.list` items of the fixture parse under the lean schema — nothing but the count is kept.
    expect(stats).toEqual([
      { youtube_id: 'fixmen00001', view_count: 95400 },
      { youtube_id: 'fixmen00002', view_count: 401200 },
    ]);
    expect(youtube.unitsUsed).toBe(1);
  });

  it('T-ADP-13 listVideoStats: 120 ids → 3 videos calls (50 / 50 / 20), 3 units; an SC-09 retry is not a new unit', async () => {
    vi.useFakeTimers();
    const batches: string[][] = [];
    let calls = 0;
    const fetchSpy = vi.fn(
      mockFetch({
        [`${YOUTUBE_API}/videos`]: (request) => {
          calls += 1;
          if (calls === 1) return new Response('busy', { status: 503 });
          const url = new URL(request.url);
          expect(url.searchParams.get('part')).toBe('statistics');
          batches.push(url.searchParams.get('id')?.split(',') ?? []);
          return Response.json({ items: [] });
        },
      }),
    );
    const youtube = createYoutube({ fetch: fetchSpy, env: ENV });
    const ids = Array.from({ length: 120 }, (_, index) => `m${String(index).padStart(10, '0')}`);
    const pending = youtube.listVideoStats(ids);
    await vi.runAllTimersAsync();
    expect(await pending).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledTimes(4); // 3 batches + 1 retry
    expect(batches.map((batch) => batch.length)).toEqual([VIDEOS_BATCH, 50, 20]);
    expect(batches.flat()).toEqual(ids);
    expect(youtube.unitsUsed).toBe(3);
  });

  it('T-ADP-13 listVideoStats: malformed ids are never sent (a hand-typed external_id), and a list of nothing but those makes no request', async () => {
    const asked: (string | null)[] = [];
    const fetchSpy = vi.fn(
      mockFetch({
        [`${YOUTUBE_API}/videos`]: (request) => {
          asked.push(new URL(request.url).searchParams.get('id'));
          return Response.json({ items: [] });
        },
      }),
    );
    const youtube = createYoutube({ fetch: fetchSpy, env: ENV });
    const junk = [
      '',
      'short',
      'twelve-chars',
      'bad id 0001',
      'a,b,c,d,e,f',
      '../../../etc',
      'fixmen0000&',
      'fixmen0000#',
      'ｆixmen00001', // a full-width letter
    ];
    await youtube.listVideoStats(['fixmen00001', ...junk, 'a-b_c-d_e-f']);
    expect(asked).toEqual(['fixmen00001,a-b_c-d_e-f']);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
      `${YOUTUBE_API}/videos?part=statistics&id=fixmen00001,a-b_c-d_e-f&key=${KEY}`,
    );

    expect(await youtube.listVideoStats(junk)).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(youtube.unitsUsed).toBe(1);
  });

  it('T-ADP-13 listVideoStats([]) → [] with no request and no unit', async () => {
    const fetchSpy = vi.fn(mockFetch({}));
    const youtube = createYoutube({ fetch: fetchSpy, env: ENV });
    expect(await youtube.listVideoStats([])).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(youtube.unitsUsed).toBe(0);
  });

  it('T-ADP-13 listVideoStats: hidden statistics → view_count null (never 0); an id upstream does not answer is simply absent', async () => {
    const impl = mockFetch({
      [`${YOUTUBE_API}/videos`]: () =>
        Response.json({
          items: [
            { id: 'fixmen00001' }, // no statistics at all
            { id: 'fixmen00002', statistics: { likeCount: '9' } }, // the count alone is hidden
            { id: 'fixvid00001', statistics: { viewCount: 'lots' } }, // junk
            { id: 'fixvid00002', statistics: { viewCount: '0' } }, // a real zero stays a zero
            { id: 'fixvid00003', statistics: { viewCount: 17 } }, // a number, not a string
          ],
        }),
    });
    const stats = await createYoutube({ fetch: impl, env: ENV }).listVideoStats([
      'fixmen00001',
      'fixmen00002',
      'fixvid00001',
      'fixvid00002',
      'fixvid00003',
      'fixvid00004', // asked for, not answered
    ]);
    expect(stats).toEqual([
      { youtube_id: 'fixmen00001', view_count: null },
      { youtube_id: 'fixmen00002', view_count: null },
      { youtube_id: 'fixvid00001', view_count: null },
      { youtube_id: 'fixvid00002', view_count: 0 },
      { youtube_id: 'fixvid00003', view_count: 17 },
    ]);
  });

  it('T-ADP-13 listVideoStats does NOT drop live / upcoming items (listVideos does — a view count is a view count)', async () => {
    const impl = mockFetch({ [`${YOUTUBE_API}/videos`]: () => Response.json(videosList) });
    const youtube = createYoutube({ fetch: impl, env: ENV });
    const stats = await youtube.listVideoStats(ALL_IDS);
    expect(stats).toHaveLength(21); // listVideos maps 19 of the same answer
    expect(stats.find((entry) => entry.youtube_id === 'fixvid00008')).toEqual({
      youtube_id: 'fixvid00008', // liveBroadcastContent: live
      view_count: 312,
    });
    expect(stats.find((entry) => entry.youtube_id === 'fixvid00009')).toEqual({
      youtube_id: 'fixvid00009', // upcoming
      view_count: 0,
    });
    expect(stats.find((entry) => entry.youtube_id === 'fixvid00006')?.view_count).toBeNull();
  });

  it('T-ADP-13 listVideoStats: no YOUTUBE_API_KEY → typed unsupported, 0 requests, 0 units', async () => {
    const fetchSpy = vi.fn(mockFetch({}));
    const youtube = createYoutube({ fetch: fetchSpy, env: ENV_NO_KEY });
    const error = await caught(youtube.listVideoStats(['fixmen00001']));
    expect(error).toBeInstanceOf(AdapterError);
    expect(error).toMatchObject({ status: 0, code: 'unsupported', body: '' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(youtube.unitsUsed).toBe(0);
  });

  it('T-ADP-13 listVideoStats: YOUTUBE_API_BASE is honoured; a failing batch fails the call with the key redacted; a malformed body is a parse_error', async () => {
    const base = 'http://127.0.0.1:4010/youtube';
    const viaBase = vi.fn(mockFetch({ [`${base}/videos`]: () => Response.json(videosMentions) }));
    const stats = await createYoutube({
      fetch: viaBase,
      env: { ...ENV, YOUTUBE_API_BASE: base },
    }).listVideoStats(['fixmen00001']);
    expect(stats).toHaveLength(2);
    expect(String(viaBase.mock.calls[0]?.[0])).toBe(
      `${base}/videos?part=statistics&id=fixmen00001&key=${KEY}`,
    );

    const denied = vi.fn(
      mockFetch({
        [`${YOUTUBE_API}/videos`]: (request) =>
          new Response(`quota: ${request.url}`, { status: 403 }),
      }),
    );
    const youtube = createYoutube({ fetch: denied, env: ENV });
    const error = await caught(youtube.listVideoStats(['fixmen00001']));
    expect(error).toMatchObject({ status: 403, code: 'http_error' });
    expect(denied).toHaveBeenCalledTimes(1);
    expect(youtube.unitsUsed).toBe(1); // the failed request still spent its unit
    for (const text of [error?.message ?? '', error?.body ?? '']) expect(text).not.toContain(KEY);
    expect(error?.message).toContain('key=[redacted]');

    const malformed = mockFetch({
      [`${YOUTUBE_API}/videos`]: () => Response.json({ items: [{ id: 'not-eleven' }] }),
    });
    await expect(
      createYoutube({ fetch: malformed, env: ENV }).listVideoStats(['fixmen00001']),
    ).rejects.toMatchObject({ status: 200, code: 'parse_error' });
  });
});

describe('T-UNIT-29 pickThumbnail', () => {
  const t = (name: string) => ({ url: `https://i.ytimg.com/vi/fixvid00001/${name}.jpg` });

  it.each([
    [
      'all five → maxres',
      {
        default: t('default'),
        medium: t('mq'),
        high: t('hq'),
        standard: t('sd'),
        maxres: t('maxres'),
      },
      'maxres',
    ],
    [
      'no maxres → standard',
      { default: t('default'), medium: t('mq'), high: t('hq'), standard: t('sd') },
      'sd',
    ],
    ['no standard → high', { default: t('default'), medium: t('mq'), high: t('hq') }, 'hq'],
    ['no high → medium', { default: t('default'), medium: t('mq') }, 'mq'],
    ['default only → default', { default: t('default') }, 'default'],
    ['an empty url is skipped', { maxres: { url: '' }, high: t('hq') }, 'hq'],
  ])('T-UNIT-29 pickThumbnail: %s', (_label, thumbnails, expected) => {
    expect(pickThumbnail(thumbnails)).toBe(`https://i.ytimg.com/vi/fixvid00001/${expected}.jpg`);
  });

  it('T-UNIT-29 pickThumbnail: empty / null / undefined → null', () => {
    expect(pickThumbnail({})).toBeNull();
    expect(pickThumbnail(null)).toBeNull();
    expect(pickThumbnail(undefined)).toBeNull();
  });
});

describe('T-ADP-14 youtube videoIdFromUrl (04 §4.3 — consumed from S1.8)', () => {
  it.each([
    ['https://www.youtube.com/watch?v=seedvid0001&t=1s', 'seedvid0001'],
    ['https://youtu.be/seedvid0001', 'seedvid0001'],
    ['https://youtu.be/seedvid0001?si=abc', 'seedvid0001'],
    ['https://www.youtube.com/shorts/seedvid0001', 'seedvid0001'],
    ['https://www.youtube.com/live/seedvid0001', 'seedvid0001'],
    ['https://www.youtube.com/embed/seedvid0001', 'seedvid0001'],
    ['https://www.youtube.com/embed/seedvid0001/', 'seedvid0001'],
    ['https://m.youtube.com/watch?v=seedvid0001', 'seedvid0001'],
    ['http://YOUTUBE.com/watch?v=a-b_c-d_e-f', 'a-b_c-d_e-f'],
    ['https://www.youtube-nocookie.com/embed/seedvid0001', 'seedvid0001'],
    ['https://www.youtube.com/@OdSens', null],
    ['https://www.youtube.com/watch', null],
    ['https://www.youtube.com/watch?v=tooshort', null],
    ['https://www.youtube.com/watch?v=seedvid0001x', null], // 12 chars
    ['https://www.youtube.com/shorts/seed.vid001', null],
    ['https://youtu.be/', null],
    ['https://example.com/watch?v=seedvid0001', null],
    ['https://notyoutube.com/shorts/seedvid0001', null],
    ['ftp://www.youtube.com/watch?v=seedvid0001', null],
    ['not a url', null],
  ] as const)('T-ADP-14 videoIdFromUrl(%j) → %j', (url, expected) => {
    expect(videoIdFromUrl(url)).toBe(expected);
  });
});

describe('T-ADP-15 youtube oembed (04 §4.3, §5.4 step 2 — consumed from S1.8)', () => {
  const WATCH = 'https://www.youtube.com/watch?v=fixmen00001';

  it('T-ADP-15 oembed(url) → GET https://www.youtube.com/oembed?url=<enc>&format=json (no key, 0 units) → {title, creator_name, creator_url, thumbnail_url}', async () => {
    const fetchSpy = vi.fn(mockFetch({ [YOUTUBE_OEMBED]: () => Response.json(oembedFixture) }));
    const youtube = createYoutube({ fetch: fetchSpy, env: ENV });
    expect(await youtube.oembed(WATCH)).toEqual({
      title: 'I played every OdSens datapack at once',
      creator_name: 'BlockBuddy',
      creator_url: 'https://www.youtube.com/@BlockBuddy',
      thumbnail_url: 'https://i.ytimg.com/vi/fixmen00001/hqdefault.jpg',
    });
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      'https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dfixmen00001&format=json',
    );
    expect(String(fetchSpy.mock.calls[0]?.[0])).not.toContain('key=');
    expect(youtube.unitsUsed).toBe(0);
  });

  it.each([401, 404])(
    'T-ADP-15 oembed: %i (private / removed) → typed not_found, not retried',
    async (status) => {
      const fetchSpy = vi.fn(
        mockFetch({ [YOUTUBE_OEMBED]: () => new Response('Not Found', { status }) }),
      );
      const error = await caught(createYoutube({ fetch: fetchSpy, env: ENV_NO_KEY }).oembed(WATCH));
      expect(error).toBeInstanceOf(AdapterError);
      expect(error).toMatchObject({ status, code: 'not_found', body: 'Not Found' });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    },
  );

  it('T-ADP-15 oembed: other failures stay http_error; a body without the fields → parse_error; no thumbnail → null', async () => {
    const forbidden = mockFetch({ [YOUTUBE_OEMBED]: () => new Response('no', { status: 403 }) });
    await expect(createYoutube({ fetch: forbidden, env: ENV }).oembed(WATCH)).rejects.toMatchObject(
      {
        status: 403,
        code: 'http_error',
      },
    );
    const malformed = mockFetch({ [YOUTUBE_OEMBED]: () => Response.json({ title: 'x' }) });
    await expect(createYoutube({ fetch: malformed, env: ENV }).oembed(WATCH)).rejects.toMatchObject(
      {
        code: 'parse_error',
      },
    );
    const empty = mockFetch({ [YOUTUBE_OEMBED]: () => new Response(null, { status: 204 }) });
    await expect(createYoutube({ fetch: empty, env: ENV }).oembed(WATCH)).rejects.toMatchObject({
      code: 'parse_error',
    });
    const bare = mockFetch({
      [YOUTUBE_OEMBED]: () => Response.json({ title: 'x', author_name: 'n', author_url: 'u' }),
    });
    expect((await createYoutube({ fetch: bare, env: ENV }).oembed(WATCH)).thumbnail_url).toBeNull();
  });
});

describe('T-ADP-15 youtube OEMBED_BASE + getVideoMeta (04 §5.4 steps 2–3; ADR-0045)', () => {
  const WATCH = 'https://www.youtube.com/watch?v=seedvid0009';
  const META_URL = `${YOUTUBE_API}/videos?part=snippet,statistics&id=seedvid0009&key=${KEY}`;

  /** The fixture item with a few fields swapped — derived in memory (F-6). */
  function seedItem(patch: {
    id?: string;
    snippet?: Record<string, unknown>;
    statistics?: Record<string, unknown> | null;
  }): Record<string, unknown> {
    const source = seedVideo.items[0] ?? {};
    const item: Record<string, unknown> = {
      ...source,
      id: patch.id ?? source.id,
      snippet: { ...(source.snippet as Record<string, unknown>), ...patch.snippet },
    };
    if (patch.statistics === null) delete item.statistics;
    else if (patch.statistics !== undefined) item.statistics = patch.statistics;
    return item;
  }

  const answering = (items: unknown[]): typeof fetch =>
    mockFetch({ [`${YOUTUBE_API}/videos`]: () => Response.json({ items }) });

  it('T-ADP-15 OEMBED_BASE moves the oEmbed ENDPOINT only (the pasted URL stays an encoded query value); unset → the real host', async () => {
    const base = 'http://127.0.0.1:4010/youtube/oembed';
    const fetchSpy = vi.fn(mockFetch({ [base]: () => Response.json(oembedFixture) }));
    const youtube = createYoutube({ fetch: fetchSpy, env: { ...ENV, OEMBED_BASE: base } });
    expect(await youtube.oembed(WATCH)).toMatchObject({ creator_name: 'BlockBuddy' });
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      'http://127.0.0.1:4010/youtube/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dseedvid0009&format=json',
    );
    expect(youtube.unitsUsed).toBe(0);

    // The 401/404 → not_found rule travels with the override.
    const gone = mockFetch({ [base]: () => new Response('Not Found', { status: 404 }) });
    await expect(
      createYoutube({ fetch: gone, env: { ...ENV, OEMBED_BASE: base } }).oembed(WATCH),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' });

    // It does not touch the Data API or the feed, and the default is still YOUTUBE_OEMBED.
    const real = vi.fn(mockFetch({ [YOUTUBE_OEMBED]: () => Response.json(oembedFixture) }));
    await createYoutube({ fetch: real, env: ENV }).oembed(WATCH);
    expect(String(real.mock.calls[0]?.[0]).startsWith('https://www.youtube.com/oembed?url=')).toBe(
      true,
    );
    const data = vi.fn(mockFetch({ [`${YOUTUBE_API}/videos`]: () => Response.json(seedVideo) }));
    await createYoutube({ fetch: data, env: { ...ENV, OEMBED_BASE: base } }).getVideoMeta(
      'seedvid0009',
    );
    expect(data.mock.calls[0]?.[0]).toBe(META_URL);
  });

  it('T-ADP-15 getVideoMeta(id) over videos/seedvid0009.json → one request part=snippet,statistics for ONE id, 1 unit → the eight fields', async () => {
    const fetchSpy = vi.fn(
      mockFetch({ [`${YOUTUBE_API}/videos`]: () => Response.json(seedVideo) }),
    );
    const youtube = createYoutube({ fetch: fetchSpy, env: ENV });
    expect(await youtube.getVideoMeta('seedvid0009')).toEqual({
      youtube_id: 'seedvid0009',
      title: 'I tried the Metal Pipe Mace in hardcore',
      channel_title: 'Fixture Creator',
      channel_id: 'UCfixturecreator000000001',
      channel_url: 'https://www.youtube.com/channel/UCfixturecreator000000001',
      thumbnail_url: 'https://i.ytimg.com/vi/seedvid0009/hqdefault.jpg',
      published_at: '2026-07-04T15:00:00.000Z',
      view_count: 48213,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(META_URL);
    expect(youtube.unitsUsed).toBe(1);
  });

  it('T-ADP-15 getVideoMeta matches the id STRICTLY: an answer carrying only other ids → null; the match is taken wherever it sits, never items[0]', async () => {
    // What the e2e fixture server answers for an id it has no file for: the whole 21-video list.
    const strangers = mockFetch({ [`${YOUTUBE_API}/videos`]: () => Response.json(videosList) });
    expect(
      await createYoutube({ fetch: strangers, env: ENV }).getVideoMeta('seedvid0009'),
    ).toBeNull();
    expect(
      await createYoutube({ fetch: answering([]), env: ENV }).getVideoMeta('seedvid0009'),
    ).toBeNull();

    // A near-miss id (same prefix, different case) is a stranger too; one odd stranger does not fail the read.
    const mixed = answering([
      item('fixvid00001'),
      { id: 'SEEDVID0009', snippet: { title: 'wrong case' } },
      { id: 'weird', snippet: {} },
      seedItem({}),
    ]);
    expect(
      await createYoutube({ fetch: mixed, env: ENV }).getVideoMeta('seedvid0009'),
    ).toMatchObject({
      youtube_id: 'seedvid0009',
      title: 'I tried the Metal Pipe Mace in hardcore',
    });
  });

  it('T-ADP-15 getVideoMeta keeps a thumbnail only from https://i.ytimg.com/ — the best size that lives there, else null', async () => {
    const thumbs = (map: Record<string, string>): Record<string, unknown> => ({
      thumbnails: Object.fromEntries(Object.entries(map).map(([size, url]) => [size, { url }])),
    });
    const cases: [Record<string, string>, string | null][] = [
      [
        {
          maxres: 'https://i9.ytimg.com/vi/seedvid0009/maxresdefault.jpg',
          standard: 'https://i.ytimg.com.evil.example/vi/seedvid0009/sddefault.jpg',
          high: 'https://i.ytimg.com/vi/seedvid0009/hqdefault.jpg',
          default: 'https://i.ytimg.com/vi/seedvid0009/default.jpg',
        },
        'https://i.ytimg.com/vi/seedvid0009/hqdefault.jpg',
      ],
      [{ high: 'http://i.ytimg.com/vi/seedvid0009/hqdefault.jpg' }, null], // not https
      [{ high: 'https://evil.example/https://i.ytimg.com/x.jpg' }, null],
      [{}, null],
    ];
    for (const [map, expected] of cases) {
      const youtube = createYoutube({
        fetch: answering([seedItem({ snippet: thumbs(map) })]),
        env: ENV,
      });
      expect((await youtube.getVideoMeta('seedvid0009'))?.thumbnail_url).toBe(expected);
    }
    const none = createYoutube({
      fetch: answering([seedItem({ snippet: { thumbnails: undefined } })]),
      env: ENV,
    });
    expect((await none.getVideoMeta('seedvid0009'))?.thumbnail_url).toBeNull();
  });

  it('T-ADP-15 getVideoMeta builds the creator link from channelId — and only from a url-safe one; a missing channel is null, never made up', async () => {
    const hostile = createYoutube({
      fetch: answering([
        seedItem({ snippet: { channelId: '../../@someone?x=1', channelTitle: '  ' } }),
      ]),
      env: ENV,
    });
    expect(await hostile.getVideoMeta('seedvid0009')).toMatchObject({
      channel_title: null,
      channel_id: null,
      channel_url: null,
    });
    const absent = createYoutube({
      fetch: answering([seedItem({ snippet: { channelId: undefined, channelTitle: undefined } })]),
      env: ENV,
    });
    expect(await absent.getVideoMeta('seedvid0009')).toMatchObject({
      channel_title: null,
      channel_id: null,
      channel_url: null,
    });
  });

  it('T-ADP-15 getVideoMeta does NOT drop a live item; hidden statistics → view_count null; an unparseable publishedAt → null', async () => {
    const live = createYoutube({
      fetch: answering([
        seedItem({
          snippet: { liveBroadcastContent: 'live', publishedAt: 'soon' },
          statistics: null,
        }),
      ]),
      env: ENV,
    });
    expect(await live.getVideoMeta('seedvid0009')).toMatchObject({
      youtube_id: 'seedvid0009',
      published_at: null,
      view_count: null,
    });
    const hidden = createYoutube({
      fetch: answering([seedItem({ statistics: { likeCount: '3' } })]),
      env: ENV,
    });
    expect((await hidden.getVideoMeta('seedvid0009'))?.view_count).toBeNull();
  });

  it('T-ADP-15 getVideoMeta: the matched item must carry a title → typed parse_error (key-free, empty body); a malformed body → parse_error', async () => {
    for (const snippet of [{ title: '   ' }, { title: undefined }]) {
      const error = await caught(
        createYoutube({ fetch: answering([seedItem({ snippet })]), env: ENV }).getVideoMeta(
          'seedvid0009',
        ),
      );
      expect(error).toBeInstanceOf(AdapterError);
      expect(error).toMatchObject({ status: 200, code: 'parse_error', body: '' });
      expect(error?.message).not.toContain(KEY);
    }
    const noSnippet = await caught(
      createYoutube({ fetch: answering([{ id: 'seedvid0009' }]), env: ENV }).getVideoMeta(
        'seedvid0009',
      ),
    );
    expect(noSnippet).toMatchObject({ code: 'parse_error' });

    const malformed = mockFetch({ [`${YOUTUBE_API}/videos`]: () => Response.json({}) });
    const error = await caught(
      createYoutube({ fetch: malformed, env: ENV }).getVideoMeta('seedvid0009'),
    );
    expect(error).toMatchObject({ status: 200, code: 'parse_error' });
    expect(error?.message).toContain('key=[redacted]');
    expect(error?.message).not.toContain(KEY);
  });

  it('T-ADP-15 getVideoMeta: a malformed id → null with no request and no unit; an upstream failure is thrown with the key redacted', async () => {
    const fetchSpy = vi.fn(mockFetch({}));
    const youtube = createYoutube({ fetch: fetchSpy, env: ENV });
    for (const id of [
      '',
      'short',
      'seedvid0009,fixvid00001',
      'seedvid0009&part=id',
      '../videos/x',
    ]) {
      expect(await youtube.getVideoMeta(id)).toBeNull();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(youtube.unitsUsed).toBe(0);

    const denied = mockFetch({
      [`${YOUTUBE_API}/videos`]: (request) => new Response(`no: ${request.url}`, { status: 403 }),
    });
    const error = await caught(
      createYoutube({ fetch: denied, env: ENV }).getVideoMeta('seedvid0009'),
    );
    expect(error).toMatchObject({ status: 403, code: 'http_error' });
    for (const text of [error?.message ?? '', error?.body ?? '']) expect(text).not.toContain(KEY);
  });

  it('T-ADP-15 getVideoMeta: no YOUTUBE_API_KEY → typed unsupported, 0 requests, 0 units (oembed still works keyless)', async () => {
    const fetchSpy = vi.fn(mockFetch({ [YOUTUBE_OEMBED]: () => Response.json(oembedFixture) }));
    const youtube = createYoutube({ fetch: fetchSpy, env: ENV_NO_KEY });
    const error = await caught(youtube.getVideoMeta('seedvid0009'));
    expect(error).toBeInstanceOf(AdapterError);
    expect(error).toMatchObject({ status: 0, code: 'unsupported', body: '' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(youtube.unitsUsed).toBe(0);
    expect((await youtube.oembed(WATCH)).creator_name).toBe('BlockBuddy');
  });

  it('T-ADP-15 the single-id fixture is one videos.list item "seedvid0009" — and the sync alias videos.json never carries it', () => {
    expect(seedVideo.items.map((entry) => entry.id)).toEqual(['seedvid0009']);
    expect(videosList.items.map((video) => video.id)).not.toContain('seedvid0009');
  });
});

describe('T-ADP-20 youtube takes env by injection (04 SC-25)', () => {
  it.each(['MODRINTH_USER_AGENT', 'YOUTUBE_CHANNEL_ID'] as const)(
    'T-ADP-20 createYoutube with a partial env (no %s) throws a zod error naming it, no request',
    (missing) => {
      const fetchSpy = vi.fn(mockFetch({}));
      const partial = { ...ENV, [missing]: undefined };
      let thrown: unknown;
      try {
        createYoutube({ fetch: fetchSpy, env: partial });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(ZodError);
      expect((thrown as ZodError).issues.map((issue) => issue.path.join('.'))).toContain(missing);
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it('T-ADP-20 a blank YOUTUBE_API_KEY is a zod error (lib/env.ts turns blank into unset before it gets here); the factory re-exposes the pure functions', () => {
    expect(() => createYoutube({ env: { ...ENV, YOUTUBE_API_KEY: '' } })).toThrow(ZodError);
    const youtube = createYoutube({ env: ENV });
    expect(youtube.parseDuration).toBe(parseDuration);
    expect(youtube.pickThumbnail).toBe(pickThumbnail);
    expect(youtube.isShort).toBe(isShort);
    expect(youtube.mapVideo).toBe(mapVideo);
    expect(youtube.parseRss).toBe(parseRss);
    expect(youtube.videoIdFromUrl).toBe(videoIdFromUrl);
  });
});

describe('youtube fixtures (05 F-5; `.json` aliases for the fixture server)', () => {
  it('T-ADP-12 the fixture-server aliases are byte-for-byte copies of the canonical F-5 files', async () => {
    expect(await loadFixtureText('youtube', 'videos.json')).toBe(
      await loadFixtureText('youtube', 'videos-list.json'),
    );
    expect(await loadFixtureText('youtube', 'playlistItems.json')).toBe(
      await loadFixtureText('youtube', 'playlist-items.json'),
    );
    // The aliased playlist file is what the e2e server answers for EVERY pageToken — it must be the
    // last page, or a sync over :4010 would walk until the page cap.
    expect(playlistItems.nextPageToken).toBeUndefined();
  });

  it('T-ADP-12 F-5 content: ≥1 short by duration, ≥1 #shorts in the title, ≥1 long, ≥1 missing statistics; no seed ids; every upload older than the seed videos', () => {
    const ids = videosList.items.map((video) => video.id);
    expect(ids).toEqual(ALL_IDS);
    expect(playlistItems.items.map((entry) => entry.contentDetails.videoId)).toEqual(ALL_IDS);
    expect(ids.filter((id) => id.startsWith('seedvid'))).toEqual([]);
    expect(parseDuration(item('fixvid00003').contentDetails?.duration ?? '')).toBeLessThanOrEqual(
      60,
    );
    expect(item('fixvid00004').snippet.title).toMatch(/\B#shorts\b/i);
    expect(videosList.items.some((video) => video.statistics === undefined)).toBe(true);
    // SEED-11's oldest row (`seedvid0007`) is 2026-06-12: a sync over the fixtures never becomes the
    // newest video on `/videos` or Home.
    for (const video of videosList.items) {
      expect(Date.parse(video.snippet.publishedAt)).toBeLessThan(
        Date.parse('2026-06-12T00:00:00Z'),
      );
    }
  });
});
