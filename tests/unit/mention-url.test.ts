/**
 * tests/unit/mention-url.test.ts — `lib/validation/mention-url.ts` (ADR-0045): the pure URL rules
 * behind 05 T-ACT-63 "`url` unique (canonicalised: strip `utm_*`, `si`, `feature`; YouTube → the
 * watch form) → `conflict`" (`canonicalMentionUrl`) and behind T-ACT-62's `validation` rows —
 * `javascript:` / `file:` / userinfo are refused as URL SYNTAX, before any DNS or request
 * (`readMentionUrl`; 04 §1.6 Input cell: ≤ 2048, http(s) only, no credentials, http → https). An
 * id-less helper test file (05 ADR-R9); titles carry the id of the action test they back. Pure — no
 * DB, no network; `server-only` (behind `videoIdFromUrl`) is mocked by the unit setup file.
 */
import { describe, expect, it } from 'vitest';
import { MENTION_URL_MAX, canonicalMentionUrl, readMentionUrl } from '@/lib/validation/mention-url';

const WATCH = 'https://www.youtube.com/watch?v=fixmen00001';

describe('T-ACT-63 canonicalMentionUrl — the uniqueness key', () => {
  it.each([
    ['https://www.youtube.com/watch?v=fixmen00001', 'already canonical'],
    ['http://www.youtube.com/watch?v=fixmen00001', 'http'],
    ['https://youtube.com/watch?v=fixmen00001', 'no www.'],
    ['https://m.youtube.com/watch?v=fixmen00001', 'm. host'],
    ['https://music.youtube.com/watch?v=fixmen00001', 'music. host'],
    ['https://youtu.be/fixmen00001', 'youtu.be'],
    ['https://youtu.be/fixmen00001?si=AbCdEf123&t=42', 'youtu.be with si + t'],
    ['https://www.youtube.com/shorts/fixmen00001', '/shorts/'],
    ['https://www.youtube.com/live/fixmen00001?feature=share', '/live/ with feature'],
    ['https://www.youtube.com/embed/fixmen00001', '/embed/'],
    ['https://www.youtube.com/watch?v=fixmen00001&list=PL123&index=4&t=10s', 'list + index + t'],
    ['https://www.youtube.com/watch?utm_source=x&v=fixmen00001#t=1m', 'utm + fragment'],
    ['  https://youtu.be/fixmen00001  ', 'surrounding whitespace'],
  ])('T-ACT-63 %s → the watch form (%s)', (url) => {
    expect(canonicalMentionUrl(url)).toBe(WATCH);
  });

  it('T-ACT-63 two spellings of one video collide on the same key (→ conflict)', () => {
    const spellings = [
      'https://youtu.be/fixmen00001?si=one',
      'http://m.youtube.com/watch?v=fixmen00001&feature=youtu.be',
      'https://www.youtube.com/shorts/fixmen00001?utm_campaign=x',
    ];
    expect(new Set(spellings.map(canonicalMentionUrl))).toEqual(new Set([WATCH]));
  });

  it('T-ACT-63 a YouTube URL that names no video (channel, playlist, bad id) keeps its own shape', () => {
    expect(canonicalMentionUrl('https://www.youtube.com/@seedcreator?si=abc')).toBe(
      'https://www.youtube.com/@seedcreator',
    );
    expect(canonicalMentionUrl('https://www.youtube.com/playlist?list=PL123&feature=share')).toBe(
      'https://www.youtube.com/playlist?list=PL123',
    );
    expect(canonicalMentionUrl('https://www.youtube.com/watch?v=short')).toBe(
      'https://www.youtube.com/watch?v=short',
    );
  });

  it.each([
    [
      'https://www.tiktok.com/@seedtok/video/1?utm_source=copy&utm_medium=android',
      'https://www.tiktok.com/@seedtok/video/1',
    ],
    [
      'https://blog.example.test/post?id=7&utm_campaign=spring&page=2',
      'https://blog.example.test/post?id=7&page=2',
    ],
    ['https://blog.example.test/post?si=abc&feature=share', 'https://blog.example.test/post'],
    [
      'https://blog.example.test/post?UTM_Source=x&SI=y&Feature=z&keep=1',
      'https://blog.example.test/post?keep=1',
    ],
    ['https://blog.example.test/post?%75tm_source=x&a=1', 'https://blog.example.test/post?a=1'],
    ['https://blog.example.test/post?', 'https://blog.example.test/post'],
    ['https://blog.example.test/post?&&a=1&', 'https://blog.example.test/post?a=1'],
  ])('T-ACT-63 %s → %s (utm_*, si, feature stripped — names case-insensitive)', (url, expected) => {
    expect(canonicalMentionUrl(url)).toBe(expected);
  });

  it('T-ACT-63 kept params keep their order and their exact encoding', () => {
    expect(
      canonicalMentionUrl('https://blog.example.test/p?b=%20c+d&utm_medium=1&a=x%2Fy&e&f='),
    ).toBe('https://blog.example.test/p?b=%20c+d&a=x%2Fy&e&f=');
  });

  it('T-ACT-63 only whole names match: site, signal, features and my_utm_x stay', () => {
    const url = 'https://blog.example.test/p?site=1&signal=2&features=3&my_utm_x=4';
    expect(canonicalMentionUrl(url)).toBe(url);
  });

  it('T-ACT-63 a name that cannot be decoded is compared as typed (and kept)', () => {
    expect(canonicalMentionUrl('https://blog.example.test/p?%E0%A4%A=1&utm_source=x')).toBe(
      'https://blog.example.test/p?%E0%A4%A=1',
    );
  });

  it('T-ACT-63 http is upgraded; the host is lower-cased and a default port dropped by the parser', () => {
    expect(canonicalMentionUrl('http://Blog.Example.TEST:80/Post')).toBe(
      'https://blog.example.test/Post',
    );
    expect(canonicalMentionUrl('https://blog.example.test:443/post')).toBe(
      'https://blog.example.test/post',
    );
  });

  it('T-ACT-63 nothing else is touched: path case, trailing slash, fragment, a non-default port', () => {
    expect(canonicalMentionUrl('https://blog.example.test/Post/')).toBe(
      'https://blog.example.test/Post/',
    );
    expect(canonicalMentionUrl('https://blog.example.test/post#comments')).toBe(
      'https://blog.example.test/post#comments',
    );
    expect(canonicalMentionUrl('https://blog.example.test:8443/post?utm_source=x')).toBe(
      'https://blog.example.test:8443/post',
    );
    // A `?` inside the fragment is not a query.
    expect(canonicalMentionUrl('https://blog.example.test/post#a?utm_source=x')).toBe(
      'https://blog.example.test/post#a?utm_source=x',
    );
  });

  it('T-ACT-63 idempotent', () => {
    for (const url of [
      'https://youtu.be/fixmen00001?si=x',
      'http://blog.example.test/post?utm_source=x&a=1',
      'https://www.reddit.com/r/feedthebeast/comments/abc/title/?utm_name=iossmf',
    ]) {
      const once = canonicalMentionUrl(url);
      expect(canonicalMentionUrl(once)).toBe(once);
    }
  });

  it('T-ACT-63 never throws: a string that does not parse comes back unchanged', () => {
    expect(canonicalMentionUrl('not a url')).toBe('not a url');
    expect(canonicalMentionUrl('')).toBe('');
  });
});

describe('T-ACT-62 readMentionUrl — what the url field accepts', () => {
  it.each([
    ['https://www.youtube.com/watch?v=fixmen00001', 'https://www.youtube.com/watch?v=fixmen00001'],
    ['https://blog.example.test', 'https://blog.example.test/'],
    ['  https://blog.example.test/post \n', 'https://blog.example.test/post'],
    ['https://blog.example.test/post?utm_source=x', 'https://blog.example.test/post?utm_source=x'],
  ])('T-ACT-62 %j is accepted as %s (normalised, NOT canonicalised)', (raw, url) => {
    expect(readMentionUrl(raw)).toEqual({ ok: true, url });
  });

  it.each([
    ['http://blog.example.test/post', 'https://blog.example.test/post'],
    ['HTTP://Blog.Example.test/post', 'https://blog.example.test/post'],
    ['http://blog.example.test:80/post', 'https://blog.example.test/post'],
    ['http://blog.example.test:8080/post', 'https://blog.example.test:8080/post'],
  ])('T-ACT-62 %s is upgraded to %s (04 §1.6 "http: upgraded to https")', (raw, url) => {
    expect(readMentionUrl(raw)).toEqual({ ok: true, url });
  });

  it.each([
    'javascript:alert(1)',
    'file:///etc/passwd',
    'data:text/html,<script>alert(1)</script>',
    'ftp://example.test/file',
    'mailto:someone@example.test',
    'blob:https://example.test/0000',
    'view-source:https://example.test/',
  ])('T-ACT-62 %s → scheme (http and https only)', (raw) => {
    expect(readMentionUrl(raw)).toEqual({ ok: false, problem: 'scheme' });
  });

  it.each([
    'https://user:pass@blog.example.test/post',
    'https://user@blog.example.test/post',
    'https://:pass@blog.example.test/post',
    'http://admin:admin@127.0.0.1/',
    'https://blog.example.test%40evil.test@internal.example.test/',
  ])('T-ACT-62 %s → credentials (userinfo is never accepted)', (raw) => {
    expect(readMentionUrl(raw)).toEqual({ ok: false, problem: 'credentials' });
  });

  it.each([
    '',
    '   ',
    'not a url',
    'blog.example.test/post',
    '//blog.example.test/post',
    'https://',
  ])('T-ACT-62 %j → unparseable', (raw) => {
    expect(readMentionUrl(raw)).toEqual({ ok: false, problem: 'unparseable' });
  });

  it('T-ACT-62 ≤ 2048 characters — the pasted text and the normalised href both', () => {
    const base = 'https://blog.example.test/';
    const fits = base + 'a'.repeat(MENTION_URL_MAX - base.length);
    expect(fits).toHaveLength(MENTION_URL_MAX);
    expect(readMentionUrl(fits)).toEqual({ ok: true, url: fits });
    expect(readMentionUrl(`${fits}a`)).toEqual({ ok: false, problem: 'too_long' });
    // 1000 × `ü` is 1026 characters pasted but percent-encodes to 6026.
    expect(readMentionUrl(base + 'ü'.repeat(1000))).toEqual({ ok: false, problem: 'too_long' });
  });

  it('T-ACT-62 host rules are not syntax: a private address parses here (assertPublicHost refuses it)', () => {
    expect(readMentionUrl('http://127.0.0.1/')).toEqual({ ok: true, url: 'https://127.0.0.1/' });
    expect(readMentionUrl('https://localhost/x')).toEqual({ ok: true, url: 'https://localhost/x' });
  });
});
