/**
 * tests/unit/fixture-server.test.ts — the e2e fixture server TWINS answer alike
 * (`tests/helpers/fixtureServer.ts` in-process, `scripts/fixture-server.mjs` as a real process —
 * ADR-0002 #73; 05 CI-5; ADR-0037 D10 `.json` fallback; ADR-0045 single-`id` rule). These are the
 * routes the S1.8 mention preview needs in e2e (05 T-ADP-15 → T-E2E-39): `OEMBED_BASE` →
 * `/youtube/oembed`, and `getVideoMeta('seedvid0009')` → `/youtube/videos?…&id=seedvid0009` served
 * from `youtube/videos/seedvid0009.json`, while every multi-id sync request still gets `videos.json`.
 * Loopback only (05 H-5): both servers listen on 127.0.0.1, on ports the OS hands out.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../helpers/envTest';
import {
  FIXTURE_ROOT,
  resolveIdFixturePath,
  startFixtureServer,
  stopFixtureServer,
} from '../helpers/fixtureServer';

type VideosBody = { items: { id: string }[] };

/** A port nothing listens on right now (the OS picks it; released before the twin binds it). */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

const bases: { helper: string; script: string } = { helper: '', script: '' };
let child: ChildProcess | null = null;

beforeAll(async () => {
  const helperPort = await freePort();
  await startFixtureServer(helperPort);
  bases.helper = `http://127.0.0.1:${String(helperPort)}`;

  const scriptPort = await freePort();
  const started = spawn(
    process.execPath,
    [path.join('scripts', 'fixture-server.mjs'), String(scriptPort)],
    { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  child = started;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('fixture-server.mjs did not start')), 10_000);
    started.once('error', reject);
    started.once('exit', (code) =>
      reject(new Error(`fixture-server.mjs exited (${String(code)})`)),
    );
    started.stdout.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('serving tests/fixtures')) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  bases.script = `http://127.0.0.1:${String(scriptPort)}`;
}, 20_000);

afterAll(async () => {
  await stopFixtureServer();
  child?.removeAllListeners('exit');
  child?.kill('SIGTERM');
});

describe('T-ADP-15 fixture server single-id rule (ADR-0045) — pure resolver', () => {
  const under = (...parts: string[]): string => path.join(FIXTURE_ROOT, ...parts);

  it.each([
    [
      '/youtube/videos?part=snippet,statistics&id=seedvid0009&key=test',
      under('youtube', 'videos', 'seedvid0009.json'),
    ],
    ['/youtube/videos?id=seedvid0009', under('youtube', 'videos', 'seedvid0009.json')],
    ['/youtube/videos?id=a-b_c-d_e-f', under('youtube', 'videos', 'a-b_c-d_e-f.json')],
    ['/youtube/videos', null], // no query
    ['/youtube/videos?part=statistics', null], // no id
    ['/youtube/videos?id=', null], // an empty id
    ['/youtube/videos?id=seedvid0009,fixvid00001', null], // a comma list — the sync batches
    ['/youtube/videos?id=seedvid0009%2Cfixvid00001', null], // … however it is encoded
    ['/youtube/videos?id=seedvid0009&id=fixvid00001', null], // two id params
    ['/youtube/videos?id=../../../package', null], // never a path
    ['/youtube/videos?id=..%2F..%2Fchannels', null],
    ['/youtube/videos?id=seedvid0009.json', null],
    ['/youtube/videos?ID=seedvid0009', null], // the param name is `id`
    ['/videos?id=seedvid0009', null], // not `<source>/<path>`
    ['/../../etc/passwd?id=seedvid0009', null], // escapes the fixture root
  ])('T-ADP-15 resolveIdFixturePath(%j) → %j', (urlPath, expected) => {
    expect(resolveIdFixturePath(urlPath)).toBe(expected);
  });
});

describe.each(['helper', 'script'] as const)(
  'T-ADP-15 fixture server (%s twin) — the S1.8 mention-preview routes',
  (twin) => {
    const get = (pathAndQuery: string, init?: RequestInit): Promise<Response> =>
      fetch(`${bases[twin]}${pathAndQuery}`, init);
    const videoIds = async (pathAndQuery: string): Promise<string[]> => {
      const response = await get(pathAndQuery);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
      return ((await response.json()) as VideosBody).items.map((entry) => entry.id);
    };

    it('T-ADP-15 OEMBED_BASE target: GET /youtube/oembed?url=…&format=json → youtube/oembed.json through the .json fallback', async () => {
      const response = await get(
        '/youtube/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dseedvid0009&format=json',
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
      expect(await response.json()).toMatchObject({
        title: 'I played every OdSens datapack at once',
        author_name: 'BlockBuddy',
      });
    });

    it('T-ADP-15 exactly one id with a file → that file: /youtube/videos?…&id=seedvid0009 → videos/seedvid0009.json', async () => {
      expect(
        await videoIds('/youtube/videos?part=snippet,statistics&id=seedvid0009&key=test'),
      ).toEqual(['seedvid0009']);
      expect(await videoIds('/youtube/videos?id=seedvid0009')).toEqual(['seedvid0009']);
      const head = await get('/youtube/videos?id=seedvid0009', { method: 'HEAD' });
      expect(head.status).toBe(200);
      expect(await head.text()).toBe('');
    });

    it('T-ADP-15 every other request is answered as before: a multi-id batch, two id params, an id with no file, no id, a path-shaped id → videos.json (21 items)', async () => {
      for (const query of [
        '?part=snippet,contentDetails,statistics&id=seedvid0009,fixvid00001&key=test',
        '?part=statistics&id=seedvid0009%2Cfixvid00001',
        '?id=seedvid0009&id=fixvid00001',
        '?part=statistics&id=fixvid00001&key=test',
        '?part=statistics',
        '',
        '?id=../../../package',
        '?id=..%2F..%2Fchannels',
      ]) {
        const ids = await videoIds(`/youtube/videos${query}`);
        expect(ids).toHaveLength(21);
        expect(ids).not.toContain('seedvid0009');
      }
    });

    it('T-ADP-15 the rule changes nothing else: the S1.5a .json fallback, a plain file, a POST route, and a 404 stay what they were', async () => {
      const project = await get('/modrinth/project/sd000101?id=seedvid0009');
      expect(project.status).toBe(200);
      expect(await project.json()).toMatchObject({ id: 'sd000101' });
      const feed = await get('/youtube/rss.xml?channel_id=UCseedchannel000000000000');
      expect(feed.status).toBe(200);
      expect(feed.headers.get('content-type')).toBe('application/xml; charset=utf-8');
      expect((await get('/youtube/nothing-here?id=seedvid0009')).status).toBe(404);
      expect((await get('/youtube?id=seedvid0009')).status).toBe(404);
      const post = await get('/resend/emails', { method: 'POST', body: '{}' });
      expect(post.status).toBe(200);
      expect((await get('/youtube/videos?id=seedvid0009', { method: 'DELETE' })).status).toBe(405);
    });

    it('T-ADP-15 the oembed HTML fixtures are served as text/html (what a contentTypes check would accept)', async () => {
      const page = await get('/oembed/og-page.html');
      expect(page.status).toBe(200);
      expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(await page.text()).toContain('og:title');
    });
  },
);
