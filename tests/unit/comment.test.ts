/**
 * tests/unit/comment.test.ts — `lib/validation/comment.ts` + `commentBodySchema` (05 T-UNIT-4,
 * T-UNIT-5, T-UNIT-40; 04 §1.2 body rules B1–B6; 04 §7; DESIGN.md §11.2 "Composer error";
 * ADR-0028 D5).
 *
 * T-UNIT-4 imports the zod schema from `lib/actions/comments.schema.ts` (its home — ADR-0028 D5)
 * and the pure pieces from `lib/validation/comment.ts`. `linkify` renders through
 * `react-dom/server` (the `markdown.test.ts` precedent) — pure, no DOM, no network.
 */
import { Fragment, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { commentBodySchema } from '@/lib/actions/comments.schema';
import {
  BODY_MAX,
  COMPOSER_RULE,
  LINE_BANNED,
  LINE_COMMENTS_CLOSED,
  LINE_DID_NOT_POST,
  LINE_EDIT_WINDOW,
  LINE_FORBIDDEN,
  LINE_INTERNAL,
  LINE_NOT_FOUND,
  LINE_RATE_LIMITED,
  LINE_TOO_MANY_LINKS,
  LINK_RE,
  MAX_LINKS,
  codePointLength,
  commentErrorLine,
  countLinks,
  linkify,
  normalizeBody,
  stripHtml,
  validateBody,
} from '@/lib/validation/comment';

const parsed = (raw: unknown): string => {
  const result = commentBodySchema.safeParse(raw);
  if (!result.success) throw new Error(`expected a pass: ${result.error.issues[0]?.message}`);
  return result.data;
};

const failure = (raw: unknown): string => {
  const result = commentBodySchema.safeParse(raw);
  if (result.success) throw new Error(`expected a failure, got ${JSON.stringify(result.data)}`);
  return result.error.issues[0]?.message ?? '';
};

const html = (text: string): string =>
  renderToStaticMarkup(createElement(Fragment, null, ...linkify(text)));

const EMOJI = '\u{1F600}'; // 😀 — two UTF-16 units, one code point

// ---- T-UNIT-4 ---------------------------------------------------------------------------------

describe('T-UNIT-4 commentBodySchema (B1 strip then trim, B2 length)', () => {
  it('T-UNIT-4 B1 strips tags, then trims — "  <b>hi</b>  " → "hi"', () => {
    expect(parsed('  <b>hi</b>  ')).toBe('hi');
    expect(normalizeBody('  <b>hi</b>  ')).toBe('hi');
    expect(parsed('\n\t<p>hello there</p>\n')).toBe('hello there');
  });

  it('T-UNIT-4 B2 1000 code points pass, 1001 fail', () => {
    expect(parsed('a'.repeat(1000))).toHaveLength(1000);
    expect(failure('a'.repeat(1001))).toBe(LINE_DID_NOT_POST);
    expect(BODY_MAX).toBe(1000);
  });

  it('T-UNIT-4 B2 an emoji counts as one code point, not two UTF-16 units', () => {
    expect(codePointLength(EMOJI)).toBe(1);
    expect(EMOJI.length).toBe(2);
    expect(parsed(EMOJI.repeat(1000))).toBe(EMOJI.repeat(1000));
    expect(failure(EMOJI.repeat(1001))).toBe(LINE_DID_NOT_POST);
  });

  it('T-UNIT-4 B2 the length is measured after B1 (tags and outer whitespace do not count)', () => {
    expect(parsed(`<b>${'a'.repeat(1000)}</b>`)).toHaveLength(1000);
    expect(parsed(`   ${'a'.repeat(1000)}   `)).toHaveLength(1000);
  });

  it.each([
    ['empty', ''],
    ['spaces', '     '],
    ['newlines and tabs', '\n\t \r\n'],
    ['tag-only', '<b></b>'],
    ['self-closing tag only', '<br>'],
  ])('T-UNIT-4 whitespace-only body fails (%s)', (_label, raw) => {
    expect(failure(raw)).toBe(LINE_DID_NOT_POST);
    expect(validateBody(raw)).toEqual({
      ok: false,
      code: 'validation',
      message: LINE_DID_NOT_POST,
    });
  });

  it('T-UNIT-4 a non-string body fails with plain words', () => {
    expect(commentBodySchema.safeParse(undefined).success).toBe(false);
    expect(commentBodySchema.safeParse(42).success).toBe(false);
    expect(failure(undefined)).toBe('Type a comment.');
  });
});

describe('T-UNIT-4 countLinks (B3 pattern)', () => {
  it('T-UNIT-4 LINK_RE is the 04 §1.2 pattern verbatim', () => {
    expect(String(LINK_RE)).toBe(String(/(https?:\/\/[^\s]+|www\.[^\s]+)/gi));
    expect(MAX_LINKS).toBe(1);
  });

  it.each([
    ['http://a', 1],
    ['https://a', 1],
    ['www.a.b', 1],
    ['a.com/x', 0],
    ['1.5', 0],
    ['HTTP://A', 1],
    ['WWW.A.B', 1],
    ['plain words only', 0],
    ['see http://a and www.b.c', 2],
    ['https://a https://b https://c', 3],
  ])('T-UNIT-4 countLinks(%j) = %d', (text, expected) => {
    expect(countLinks(text)).toBe(expected);
  });

  it('T-UNIT-4 countLinks is stable across calls (the global regex never carries lastIndex)', () => {
    expect(countLinks('http://a')).toBe(1);
    expect(countLinks('http://a')).toBe(1);
    expect(countLinks('www.a.b')).toBe(1);
  });
});

describe('T-UNIT-4 validateBody (B3 ≤ 1 link else too_many_links)', () => {
  it('T-UNIT-4 one link passes and the body comes back normalized', () => {
    expect(validateBody('  see https://a.b  ')).toEqual({ ok: true, body: 'see https://a.b' });
    expect(validateBody('<i>www.a.b</i>')).toEqual({ ok: true, body: 'www.a.b' });
  });

  it.each([
    'http://a http://b',
    'https://a https://b',
    'www.a.b www.c.d',
    'http://a and www.b.c',
    'https://a then www.b.c',
  ])('T-UNIT-4 two links fail with code too_many_links: %j', (raw) => {
    expect(validateBody(raw)).toEqual({
      ok: false,
      code: 'too_many_links',
      message: "That didn't post. Too many links.",
    });
  });

  it('T-UNIT-4 the too_many_links line is the DESIGN.md §11.2 copy', () => {
    expect(LINE_TOO_MANY_LINKS).toBe("That didn't post. Too many links.");
    expect(commentErrorLine('too_many_links')).toBe(LINE_TOO_MANY_LINKS);
  });

  it('T-UNIT-4 an empty or over-long body is `validation`, not `too_many_links`', () => {
    expect(validateBody('')).toMatchObject({ ok: false, code: 'validation' });
    expect(validateBody('a'.repeat(1001))).toMatchObject({ ok: false, code: 'validation' });
  });

  it('T-UNIT-4 the zod schema lets a two-link body through — the action answers `too_many_links` (ADR-0028 D5)', () => {
    // A zod issue can only surface as `validation` (04 SC-02); B3 needs its own code, so the schema
    // stops at B1/B2 and `lib/actions/comments.ts` runs `validateBody` for the link rule.
    expect(commentBodySchema.safeParse('http://a http://b').success).toBe(true);
  });

  it('T-UNIT-4 the rule beside POST reads "1000 characters, one link."', () => {
    expect(COMPOSER_RULE).toBe('1000 characters, one link.');
  });
});

// ---- T-UNIT-5 ---------------------------------------------------------------------------------

describe('T-UNIT-5 stripHtml', () => {
  it('T-UNIT-5 <b>hi</b> → hi', () => {
    expect(stripHtml('<b>hi</b>')).toBe('hi');
  });

  it('T-UNIT-5 <script>alert(1)</script>x → x', () => {
    expect(stripHtml('<script>alert(1)</script>x')).toBe('x');
    expect(stripHtml('<SCRIPT type="text/javascript">alert(1)</SCRIPT >x')).toBe('x');
    expect(stripHtml('a<script>\n  alert(1)\n</script>b')).toBe('ab');
  });

  it('T-UNIT-5 &lt; is preserved as text', () => {
    expect(stripHtml('&lt;')).toBe('&lt;');
    expect(stripHtml('&lt;b&gt;hi&lt;/b&gt;')).toBe('&lt;b&gt;hi&lt;/b&gt;');
  });

  it('T-UNIT-5 tags with attributes and self-closing tags go, their text stays', () => {
    expect(stripHtml('<a href="https://x.y" onclick="alert(1)">t</a><br/>')).toBe('t');
    expect(stripHtml('<img src=x onerror=alert(1)>after')).toBe('after');
  });

  it('T-UNIT-5 a stray < stays as text (the regex only eats a closed tag)', () => {
    expect(stripHtml('1 < 2')).toBe('1 < 2');
  });
});

describe('T-UNIT-5 linkify', () => {
  it('T-UNIT-5 linkify("see https://a.b") renders one <a rel="noopener noreferrer nofollow ugc" target="_blank">', () => {
    const out = html('see https://a.b');
    expect(out).toMatch(/^see <a [^>]*>https:\/\/a\.b<\/a>$/);
    expect(out).toMatch(/<a [^>]*href="https:\/\/a\.b"[^>]*>/);
    expect(out).toMatch(/<a [^>]*rel="noopener noreferrer nofollow ugc"[^>]*>/);
    expect(out).toMatch(/<a [^>]*target="_blank"[^>]*>/);
    expect(out.match(/<a /g)).toHaveLength(1);
  });

  it.each([
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'click javascript:alert(1) now',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
  ])('T-UNIT-5 never a javascript:/data: href — %j renders no anchor', (text) => {
    const out = html(text);
    expect(out).not.toContain('<a ');
    expect(out).not.toMatch(/href=/i);
  });

  it('T-UNIT-5 a link whose text carries javascript: only ever gets the http(s) href', () => {
    const out = html('http://a.b/?next=javascript:alert(1)');
    expect(out.match(/<a /g)).toHaveLength(1);
    expect(out).not.toMatch(/href="javascript:/i);
    expect(out).toMatch(/href="http:\/\/a\.b\//);
  });

  it('T-UNIT-5 www. links get an https:// href and keep their visible text', () => {
    const out = html('www.a.b');
    expect(out).toMatch(/<a [^>]*href="https:\/\/www\.a\.b"[^>]*>www\.a\.b<\/a>/);
  });

  it('T-UNIT-5 trailing sentence punctuation stays outside the href', () => {
    const out = html('see https://a.b.');
    expect(out).toMatch(/href="https:\/\/a\.b"/);
    expect(out).toMatch(/<\/a>\.$/);
    const wrapped = html('(https://a.b)');
    expect(wrapped).toMatch(/href="https:\/\/a\.b"/);
    expect(wrapped).toMatch(/^\(<a [^>]*>https:\/\/a\.b<\/a>\)$/);
  });

  it('T-UNIT-5 plain text renders as escaped text with no anchor — a tag in the body never becomes markup', () => {
    expect(html('just words')).toBe('just words');
    expect(linkify('just words')).toEqual(['just words']);
    const out = html('a <b>c</b> & d');
    expect(out).toContain('&lt;b&gt;');
    expect(out).not.toContain('<b>');
    expect(out).not.toContain('<a ');
  });

  it('T-UNIT-5 two links render two anchors in text order', () => {
    const out = html('http://a then www.b.c');
    expect(out.match(/<a /g)).toHaveLength(2);
    expect(out.indexOf('href="http://a"')).toBeLessThan(out.indexOf('href="https://www.b.c"'));
  });

  it('T-UNIT-5 an empty body renders nothing', () => {
    expect(linkify('')).toEqual([]);
    expect(html('')).toBe('');
  });
});

// ---- T-UNIT-40 --------------------------------------------------------------------------------

/** 04 §7 codes the comment actions can return → the one plain line under the composer. */
const ERROR_LINES = [
  ['banned', "You can't comment here."],
  ['not_found', 'That comment is gone.'],
  ['comments_closed', 'Comments are off for this one.'],
  ['validation', "That didn't post."],
  ['too_many_links', "That didn't post. Too many links."],
  ['rate_limited', 'Slow down a little.'],
  ['edit_window_expired', 'Edits close after 15 minutes.'],
  ['forbidden', 'Not allowed.'],
  ['internal', "That didn't post. Try again?"],
] as const;

describe('T-UNIT-40 commentErrorLine', () => {
  it.each(ERROR_LINES)('T-UNIT-40 %s → %j', (code, line) => {
    expect(commentErrorLine(code)).toBe(line);
  });

  it('T-UNIT-40 the exported lines match the table (one source of truth for the islands)', () => {
    expect(LINE_BANNED).toBe("You can't comment here.");
    expect(LINE_NOT_FOUND).toBe('That comment is gone.');
    expect(LINE_COMMENTS_CLOSED).toBe('Comments are off for this one.');
    expect(LINE_DID_NOT_POST).toBe("That didn't post.");
    expect(LINE_RATE_LIMITED).toBe('Slow down a little.');
    expect(LINE_EDIT_WINDOW).toBe('Edits close after 15 minutes.');
    expect(LINE_FORBIDDEN).toBe('Not allowed.');
    expect(LINE_INTERNAL).toBe("That didn't post. Try again?");
  });

  it.each(['', 'nope', 'INTERNAL', 'storage_error', 'job_failed'])(
    'T-UNIT-40 an unknown code (%j) reads as the internal line',
    (code) => {
      expect(commentErrorLine(code)).toBe(LINE_INTERNAL);
    },
  );

  it('T-UNIT-40 every mapped code yields exactly one plain line (no newlines, ends in . or ?)', () => {
    for (const [code] of ERROR_LINES) {
      const line = commentErrorLine(code);
      expect(line, code).not.toContain('\n');
      expect(line, code).toMatch(/^[A-Z].*[.?]$/);
    }
  });

  it('T-UNIT-40 the other 04 §1.2 comment-action codes (unauthenticated, onboarding_required, conflict) are mapped, not left to the fallback', () => {
    for (const code of ['unauthenticated', 'onboarding_required', 'conflict']) {
      const line = commentErrorLine(code);
      expect(line, code).not.toBe(LINE_INTERNAL);
      expect(line, code).not.toContain('\n');
      expect(line, code).toMatch(/^[A-Z].*[.?]$/);
    }
  });
});
