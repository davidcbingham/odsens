/**
 * tests/unit/markdown.test.ts — `lib/markdown.ts` `renderMarkdown` (05 T-UNIT-14; 01 INV-65 /
 * INV-54 / INV-86; ADR-0002 A12 + #34; 03 §2.2 `Markdown`).
 *
 * Renders to static HTML via `react-dom/server` — pure, no DOM, no network. The seed-shaped
 * body mirrors SEED-4 `…0103.body_md` (h2 + list + link + a `<script>` tag); the canonical
 * SQL lands with the schema/seed work, this replica proves the sanitiser over the same shape.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  MARKDOWN_IMAGE_HOSTS,
  isAllowedImageHost,
  renderMarkdown,
  type MarkdownVariant,
} from '@/lib/markdown';

const html = (source: string, variant?: MarkdownVariant): string =>
  renderToStaticMarkup(renderMarkdown(source, variant));

describe('T-UNIT-14 GFM tables/lists/links render', () => {
  it('T-UNIT-14 renders a GFM table', () => {
    const out = html('| a | b |\n| - | - |\n| 1 | 2 |');
    expect(out).toContain('<table');
    expect(out).toContain('<th');
    expect(out).toContain('<td');
  });

  it('T-UNIT-14 renders lists', () => {
    const out = html('- one\n- two');
    expect(out).toContain('<ul');
    expect(out.match(/<li/g)).toHaveLength(2);
  });

  it('T-UNIT-14 renders links', () => {
    const out = html('[docs](https://example.com/docs)');
    expect(out).toContain('href="https://example.com/docs"');
  });
});

describe('T-UNIT-14 sanitisation (rehype-sanitize + skipHtml)', () => {
  it('T-UNIT-14 removes <script> wholesale', () => {
    const out = html('before\n\n<script>alert("x")</script>\n\nafter');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert');
    expect(out).toContain('before');
    expect(out).toContain('after');
  });

  it('T-UNIT-14 removes <iframe>', () => {
    const out = html('<iframe src="https://evil.example"></iframe>');
    expect(out).not.toContain('<iframe');
    expect(out).not.toContain('evil.example');
  });

  it('T-UNIT-14 removes <style>', () => {
    expect(html('<style>body{color:red}</style>')).not.toContain('<style');
  });

  it('T-UNIT-14 removes on*= attributes (raw HTML skipped, text kept)', () => {
    const out = html('Click <b onclick="alert(1)">me</b> now');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('alert');
    expect(out).toContain('me');
  });

  it('T-UNIT-14 drops javascript: hrefs', () => {
    expect(html('[x](javascript:alert(1))')).not.toContain('javascript:');
  });

  it('T-UNIT-14 drops data: hrefs', () => {
    expect(html('[x](data:text/html;base64,AAAA)')).not.toContain('data:');
  });
});

describe('T-UNIT-14 external link attributes (INV-65)', () => {
  it('T-UNIT-14 external links get target=_blank + full rel + sr text + ↗ icon', () => {
    const out = html('[docs](https://example.com/docs)');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer nofollow ugc"');
    expect(out).toContain('(opens in new tab)');
    expect(out).toContain('data-icon="external"');
    expect(out).toContain('aria-hidden="true"');
  });

  it('T-UNIT-14 relative links stay plain (no target, no rel)', () => {
    const out = html('[home](/projects)');
    expect(out).toContain('href="/projects"');
    expect(out).not.toContain('target=');
    expect(out).not.toContain('rel=');
  });

  it('T-UNIT-14 mailto links keep their href without _blank', () => {
    const out = html('[mail](mailto:allay@odsens.com)');
    expect(out).toContain('href="mailto:allay@odsens.com"');
    expect(out).not.toContain('target=');
  });
});

describe('T-UNIT-14 image host allowlist (INV-54 five hosts, ADR-0002 #34)', () => {
  it('T-UNIT-14 the allowlist is exactly the Supabase host + the four CDN hosts', () => {
    const supabaseHost = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL as string).hostname;
    expect(MARKDOWN_IMAGE_HOSTS).toHaveLength(5);
    expect(MARKDOWN_IMAGE_HOSTS).toEqual([
      supabaseHost,
      'cdn.modrinth.com',
      'cdn-raw.modrinth.com',
      'i.ytimg.com',
      'yt3.ggpht.com',
    ]);
  });

  it('T-UNIT-14 isAllowedImageHost accepts only http(s) URLs on listed hosts', () => {
    expect(isAllowedImageHost('https://cdn.modrinth.com/data/AA/icon.png')).toBe(true);
    expect(isAllowedImageHost('https://cdn-raw.modrinth.com/x.png')).toBe(true);
    expect(isAllowedImageHost('https://i.ytimg.com/vi/x/hq.jpg')).toBe(true);
    expect(isAllowedImageHost('https://evil.example/x.png')).toBe(false);
    expect(isAllowedImageHost('https://cdn.modrinth.com.evil.example/x.png')).toBe(false);
    expect(isAllowedImageHost('data:image/png;base64,AAAA')).toBe(false);
    expect(isAllowedImageHost('not a url')).toBe(false);
  });

  it('T-UNIT-14 an allowed-host image renders as an <img> (next/image)', () => {
    const out = html('![shot](https://cdn.modrinth.com/data/AABB/images/shot.png)');
    expect(out).toContain('<img');
    expect(out).toContain('cdn.modrinth.com');
    expect(out).toContain('alt="shot"');
  });

  it('T-UNIT-14 a disallowed-host image renders as a plain link, never an <img>', () => {
    const out = html('![pic](https://evil.example/pic.png)');
    expect(out).not.toContain('<img');
    expect(out).toContain('href="https://evil.example/pic.png"');
    expect(out).toContain('pic');
    expect(out).toContain('rel="noopener noreferrer nofollow ugc"');
  });
});

describe('T-UNIT-14 heading demotion keeps one h1 (INV-65)', () => {
  it('T-UNIT-14 about demotes h1 → h2', () => {
    const out = html('# Top\n\n## Mid', 'about');
    expect(out).not.toContain('<h1');
    expect(out).toContain('<h2>Top</h2>');
    expect(out).toContain('<h2>Mid</h2>');
  });

  it('T-UNIT-14 note demotes h1 → h2 like about', () => {
    const out = html('# Top', 'note');
    expect(out).not.toContain('<h1');
    expect(out).toContain('<h2>Top</h2>');
  });

  it('T-UNIT-14 changelog demotes h1/h2 → h4', () => {
    const out = html('# A\n\n## B\n\n### C', 'changelog');
    expect(out).not.toContain('<h1');
    expect(out).not.toContain('<h2');
    expect(out).toContain('<h4>A</h4>');
    expect(out).toContain('<h4>B</h4>');
    expect(out).toContain('<h3>C</h3>');
  });
});

describe('T-UNIT-14 `> NOTE:` blockquote maps to NoteCallout', () => {
  it('T-UNIT-14 a NOTE blockquote renders the callout with the prefix stripped', () => {
    const out = html('> NOTE: Back up your world first.');
    expect(out).toContain('aria-label="Note"');
    expect(out).toContain('Back up your world first.');
    expect(out).not.toContain('NOTE:');
    expect(out).not.toContain('<blockquote');
  });

  it('T-UNIT-14 an ordinary blockquote stays a blockquote', () => {
    const out = html('> Just a quote.');
    expect(out).toContain('<blockquote');
    expect(out).not.toContain('aria-label="Note"');
  });
});

describe('T-UNIT-14 seed …0103.body_md shape contains no <script>', () => {
  // Mirrors SEED-4 `…0103` body_md requirements (05 §3): an h2, a list, a link, a <script> tag.
  const SEED_0103_BODY_MD = [
    '## What it is',
    '',
    '- one odd thing',
    '- another odd thing',
    '',
    '[OddSense on Modrinth](https://modrinth.com/user/OddSense)',
    '',
    "<script>alert('seed')</script>",
    '',
  ].join('\n');

  it('T-UNIT-14 renders the content and drops the script', () => {
    const out = html(SEED_0103_BODY_MD, 'about');
    expect(out).toContain('<h2>What it is</h2>');
    expect(out).toContain('<ul');
    expect(out).toContain('href="https://modrinth.com/user/OddSense"');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert');
  });
});
