/**
 * tests/unit/mention-preview-render.test.tsx — the server-rendered markup of `MentionPreview` and of
 * `ReorderableList`'s Move up / Move down buttons (03 §2.8 `MentionPreview`, §3 states, §2.10
 * admin-only controls rule; ADR-0002 #33; ADR-0045) — the contract 05 T-E2E-39 / T-E2E-42 / T-E2E-48
 * read in a browser, pinned without one: one `data-state` per fixture, `role="region"` +
 * `aria-live`, an alert ONLY in the error state, the YouTube thumbnail from `i.ytimg.com` and no
 * `<img>` from anywhere else, PUBLISH present-but-disabled in `empty`, and the moderator view with
 * every control disabled under `title="Admin only"` and NO `<form>`. An id-less helper test file
 * (05 ADR-R9); titles carry the id of the e2e they back.
 *
 * `renderToStaticMarkup` (the `comment.test.ts` precedent — no DOM library, 01 INV-78). The two
 * actions, the router and `next/image` are mocked: the island must render without calling anything,
 * and the mocked image prints its `src` so the host can be asserted.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ fetchMentionPreview: 0, createMention: 0 }));

vi.mock('@/lib/actions/mentions', () => ({
  fetchMentionPreview: async () => {
    calls.fetchMentionPreview += 1;
    return { ok: false, error: { code: 'internal', message: 'Something broke.' } };
  },
  createMention: async () => {
    calls.createMention += 1;
    return { ok: false, error: { code: 'internal', message: 'Something broke.' } };
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => undefined }),
}));

vi.mock('next/image', () => ({
  default: ({ src, alt }: { src: string; alt: string }) =>
    createElement('img', { src, alt, 'data-next-image': '' }),
}));

import { ReorderableList } from '@/components/admin/ReorderableList';
import { MentionPreview, type MentionPreviewProps } from '@/components/seen-on/MentionPreview';
import { mentionPreviewFixtures } from '../fixtures/ui/mentionPreview';
import { reorderableListFixtures } from '../fixtures/ui/reorderableList';

function fixture(label: string): MentionPreviewProps {
  const found = mentionPreviewFixtures.find((entry) => entry.label === label);
  if (!found) throw new Error(`no fixture "${label}"`);
  return found.props;
}

function render(props: MentionPreviewProps): string {
  return renderToStaticMarkup(createElement(MentionPreview, props));
}

/** Every `<tag …>` opening of the given element, as written. */
function tags(html: string, tag: string): string[] {
  return html.match(new RegExp(`<${tag}\\b[^>]*>`, 'g')) ?? [];
}

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

const UNREADABLE = 'Couldn&#x27;t read that page. You can fill the fields by hand.';

describe('T-E2E-48 MentionPreview — every 03 §3 state renders from its fixture', () => {
  it.each([
    ['MentionPreview · empty', 'empty'],
    ['MentionPreview · preview', 'preview'],
    ['MentionPreview · preview, no image', 'preview'],
    ['MentionPreview · error', 'error'],
    ['MentionPreview · manual', 'manual'],
    ['MentionPreview · moderator', 'empty'],
  ])('T-E2E-48 %s → data-state="%s" on a polite region', (label, state) => {
    const html = render(fixture(label));
    const root = tags(html, 'div')[0] ?? '';
    expect(root).toContain(`data-state="${state}"`);
    expect(root).toContain('role="region"');
    expect(root).toContain('aria-label="Add a mention"');
    expect(root).toContain('aria-live="polite"');
    expect(count(html, 'data-state=')).toBe(1);
  });

  it('T-E2E-48 the fixtures cover all four states and the moderator view', () => {
    const states = new Set(
      mentionPreviewFixtures.map(({ props }) => /data-state="([a-z]+)"/.exec(render(props))?.[1]),
    );
    expect([...states].sort()).toEqual(['empty', 'error', 'manual', 'preview']);
    expect(mentionPreviewFixtures.some(({ props }) => props.readOnly === true)).toBe(true);
    for (const { label } of mentionPreviewFixtures) {
      expect(label.split(/\s+/).length, `${label} fits the PixelLabel guard`).toBeLessThanOrEqual(
        5,
      );
    }
  });

  it('T-E2E-48 rendering calls no action', () => {
    for (const { props } of mentionPreviewFixtures) render(props);
    expect(calls).toEqual({ fetchMentionPreview: 0, createMention: 0 });
  });
});

describe('T-E2E-39 MentionPreview — empty', () => {
  const html = render(fixture('MentionPreview · empty'));

  it('T-E2E-39 shows the slot line, the link field and an enabled Fetch', () => {
    expect(html).toContain('Paste a link above.');
    expect(html).toContain('>Link</label>');
    const fetchButton = tags(html, 'button').find((tag) =>
      tag.includes('data-variant="secondary"'),
    );
    expect(fetchButton).toBeDefined();
    expect(fetchButton).not.toContain('disabled');
  });

  it('T-E2E-39 PUBLISH is present but disabled, described by the slot line', () => {
    const publish = tags(html, 'button').find((tag) => tag.includes('data-variant="primary"'));
    expect(publish).toBeDefined();
    expect(publish).toContain('disabled=""');
    const describedBy = /aria-describedby="([^"]+)"/.exec(publish ?? '')?.[1];
    expect(describedBy).toBeDefined();
    expect(html).toContain(`<p id="${describedBy}"`);
    expect(html).toContain('>PUBLISH<');
  });

  it('T-E2E-39 "Assign to" lists "About OddSense generally" first, then the projects', () => {
    expect(html).toContain('>Assign to</span>');
    const options = [...html.matchAll(/role="option"[^>]*>.*?<span[^>]*>([^<]+)<\/span>/g)].map(
      (match) => match[1],
    );
    expect(options).toEqual([
      'About OddSense generally',
      'Duck Crosshair',
      'Heavy Spear',
      'Metal Pipe Mace',
    ]);
  });

  it('T-E2E-39 no manual fields, no card, no alert, no image', () => {
    expect(html).not.toContain('>Title</label>');
    expect(html).not.toContain('Edit fields');
    expect(html).not.toContain('role="alert"');
    expect(tags(html, 'img')).toEqual([]);
  });

  it('T-E2E-39 two forms: the fetch form and the publish form', () => {
    expect(tags(html, 'form')).toHaveLength(2);
  });

  it('T-E2E-39 the helper line explains the general option', () => {
    expect(html).toContain(
      '&quot;About OddSense generally&quot; is in the list for videos that aren&#x27;t about one project.',
    );
  });
});

describe('T-E2E-39 MentionPreview — preview card', () => {
  it('T-E2E-39 YouTube: thumb from i.ytimg.com built from the id, title, creator, views, date', () => {
    const html = render(fixture('MentionPreview · preview'));
    const images = tags(html, 'img').filter((tag) => tag.includes('data-next-image'));
    // One `next/image` besides the `PlatformMark` logo(s): the thumbnail.
    const thumbs = images.filter((tag) => tag.includes('i.ytimg.com'));
    expect(thumbs).toHaveLength(1);
    expect(thumbs[0]).toContain('src="https://i.ytimg.com/vi/gallery0001/hqdefault.jpg"');
    expect(thumbs[0]).toContain('alt=""');
    expect(html).toContain('PixelPete tried the pipe mace');
    expect(html).toContain('YouTube · PixelPete');
    expect(html).toContain('212K VIEWS');
    expect(html).toContain('<time');
    expect(html).toContain('dateTime="2026-05-14T16:00:00.000Z"');
    expect(html).toContain('14 May 2026');
    expect(html).toContain('Edit fields');
    expect(html).not.toContain('>Title</label>');
    expect(html).not.toContain('role="alert"');
  });

  it('T-E2E-39 every image source is i.ytimg.com or a local brand mark — never the fetched URL', () => {
    for (const { label, props } of mentionPreviewFixtures) {
      const sources = tags(render(props), 'img').map((tag) => /src="([^"]*)"/.exec(tag)?.[1] ?? '');
      for (const src of sources) {
        expect(
          src.startsWith('https://i.ytimg.com/vi/') || src.startsWith('/brand/marks/'),
          `${label}: ${src}`,
        ).toBe(true);
      }
    }
  });

  it('T-E2E-39 non-YouTube: the PlatformMark well, no remote image, no views, no date', () => {
    const html = render(fixture('MentionPreview · preview, no image'));
    expect(html).not.toContain('example.test');
    expect(html).not.toContain('i.ytimg.com');
    expect(html).toContain('role="img" aria-label="TikTok"');
    expect(html).toContain('TikTok · beelo');
    expect(html).not.toContain('VIEWS');
    expect(html).not.toContain('<time');
  });

  it('T-E2E-39 a YouTube preview WITHOUT a well-formed id gets the mark, not an image', () => {
    const base = fixture('MentionPreview · preview');
    if (base.preview === null) throw new Error('fixture has a preview');
    for (const external_id of [null, 'short', 'has/slash00', '../../../etc']) {
      const html = render({ ...base, preview: { ...base.preview, external_id } });
      expect(html, String(external_id)).not.toContain('i.ytimg.com');
      expect(html).toContain('role="img" aria-label="YouTube"');
    }
  });

  it('T-E2E-39 singular "1 VIEW"; a real zero is shown; an unparseable date prints no <time>', () => {
    const base = fixture('MentionPreview · preview');
    if (base.preview === null) throw new Error('fixture has a preview');
    expect(render({ ...base, preview: { ...base.preview, view_count: 1 } })).toContain('1 VIEW<');
    expect(render({ ...base, preview: { ...base.preview, view_count: 0 } })).toContain('0 VIEWS');
    const undated = render({ ...base, preview: { ...base.preview, published_at: 'soon' } });
    expect(undated).not.toContain('<time');
  });

  it('T-E2E-39 a preview with no creator name opens the manual fields instead of the card', () => {
    const base = fixture('MentionPreview · preview');
    if (base.preview === null) throw new Error('fixture has a preview');
    const html = render({ ...base, preview: { ...base.preview, creator_name: null } });
    expect(html).toContain('data-state="manual"');
    expect(html).toContain('>Creator</label>');
    expect(html).toContain('value="PixelPete tried the pipe mace"');
  });
});

describe('T-E2E-39 MentionPreview — error and manual', () => {
  it('T-E2E-39 error: the action’s message verbatim in ONE alert, then the manual fields', () => {
    const html = render(fixture('MentionPreview · error'));
    expect(count(html, 'role="alert"')).toBe(1);
    expect(html).toContain(`role="alert"`);
    expect(html).toContain(UNREADABLE);
    for (const label of ['Title', 'Creator', 'Creator link', 'Date', 'Views']) {
      expect(html, label).toContain(`>${label}</label>`);
    }
    expect(html).toContain('>Platform</span>');
    const publish = tags(html, 'button').find((tag) => tag.includes('data-variant="primary"'));
    expect(publish).not.toContain('disabled');
  });

  it('T-E2E-39 the platform Select offers all six platforms, `other` included', () => {
    const html = render(fixture('MentionPreview · error'));
    for (const word of ['YouTube', 'TikTok', 'Twitch', 'Reddit', 'Article', 'Other']) {
      expect(html, word).toContain(`>${word}</span>`);
    }
  });

  it('T-E2E-39 manual: fields seeded from the preview, no alert, PUBLISH enabled', () => {
    const html = render(fixture('MentionPreview · manual'));
    expect(html).not.toContain('role="alert"');
    expect(html).toContain('value="PixelPete tried the pipe mace"');
    expect(html).toContain('value="PixelPete"');
    expect(html).toContain('value="https://www.youtube.com/@pixelpete"');
    expect(html).toContain('value="2026-05-14"');
    expect(html).toContain('value="212000"');
    expect(html).not.toContain('Edit fields');
    const publish = tags(html, 'button').find((tag) => tag.includes('data-variant="primary"'));
    expect(publish).not.toContain('disabled');
  });

  it('T-E2E-39 field ids are unique inside one island', () => {
    const html = render(fixture('MentionPreview · manual'));
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('T-E2E-39 MentionPreview — moderator (readOnly)', () => {
  it.each(mentionPreviewFixtures.map(({ label, props }) => [label, props] as const))(
    'T-E2E-39 %s as a moderator: no <form>, every control disabled under "Admin only"',
    (_label, props) => {
      const html = render({ ...props, readOnly: true });
      expect(tags(html, 'form')).toEqual([]);
      const buttons = tags(html, 'button');
      expect(buttons.length).toBeGreaterThanOrEqual(3); // Fetch · Assign to · PUBLISH
      for (const tag of buttons) expect(tag, tag).toContain('disabled=""');
      const inputs = tags(html, 'input').filter((tag) => !tag.includes('type="hidden"'));
      expect(inputs.length).toBeGreaterThanOrEqual(1);
      for (const tag of inputs) {
        expect(tag, tag).toContain('disabled=""');
        expect(tag, tag).toContain('title="Admin only"');
      }
      expect(html).toContain('>Fetch<');
      expect(html).toContain('>PUBLISH<');
      expect(html).toContain('>Assign to</span>');
    },
  );

  it('T-E2E-39 each moderator button sits under a title="Admin only" wrapper', () => {
    const html = render(fixture('MentionPreview · moderator'));
    // Fetch, the "Assign to" select and PUBLISH each get their own wrapper.
    expect(count(html, '<span title="Admin only">')).toBeGreaterThanOrEqual(1);
    expect(count(html, 'title="Admin only"')).toBeGreaterThanOrEqual(4); // + the link input
    expect(html).toContain('>Admin only</span>');
    expect(html).not.toContain('role="alert"');
  });
});

describe('T-E2E-39 ReorderableList — visible Move up / Move down buttons', () => {
  function renderList(label: string): string {
    const found = reorderableListFixtures.find((entry) => entry.label === label);
    if (!found) throw new Error(`no fixture "${label}"`);
    return renderToStaticMarkup(
      createElement(ReorderableList, { ...found.props, onReorder: () => undefined }),
    );
  }

  function buttonsNamed(html: string, prefix: string): string[] {
    return tags(html, 'button').filter((tag) => tag.includes(`aria-label="${prefix}`));
  }

  it('T-E2E-39 every row has its handle plus one Move up and one Move down', () => {
    const html = renderList('ReorderableList · rest');
    expect(tags(html, 'li')).toHaveLength(4);
    expect(buttonsNamed(html, 'Move up ')).toHaveLength(4);
    expect(buttonsNamed(html, 'Move down ')).toHaveLength(4);
    expect(tags(html, 'button')).toHaveLength(12);
    expect(html).toContain('aria-label="Move up Heavy Spear"');
    expect(html).toContain('aria-label="Move down Heavy Spear"');
  });

  it('T-E2E-39 the handle keeps its name, and no new name contains it (substring lookups)', () => {
    const html = renderList('ReorderableList · rest');
    expect(html).toContain('aria-label="Move Pixel Chameleon"');
    const names = [...html.matchAll(/aria-label="([^"]+)"/g)].map((match) => match[1] ?? '');
    const matching = names.filter((name) => name.toLowerCase().includes('move pixel chameleon'));
    expect(matching).toEqual(['Move Pixel Chameleon']);
  });

  it('T-E2E-39 the ends are aria-disabled (focus stays), never natively disabled', () => {
    const html = renderList('ReorderableList · rest');
    const ups = buttonsNamed(html, 'Move up ');
    const downs = buttonsNamed(html, 'Move down ');
    expect(ups[0]).toContain('aria-disabled="true"');
    expect(downs[3]).toContain('aria-disabled="true"');
    for (const tag of [...ups.slice(1), ...downs.slice(0, 3)]) {
      expect(tag, tag).not.toContain('aria-disabled');
    }
    for (const tag of [...ups, ...downs]) {
      expect(tag, tag).not.toContain('disabled=""');
      expect(tag, tag).not.toContain('title=');
    }
  });

  it('T-E2E-39 a single row: both directions are at an end', () => {
    const html = renderList('ReorderableList · single');
    expect(buttonsNamed(html, 'Move up ')[0]).toContain('aria-disabled="true"');
    expect(buttonsNamed(html, 'Move down ')[0]).toContain('aria-disabled="true"');
  });

  it('T-E2E-39 moderator: handle and both buttons disabled + aria-disabled + "Admin only"', () => {
    const html = renderList('ReorderableList · moderator');
    const buttons = tags(html, 'button');
    expect(buttons).toHaveLength(12);
    for (const tag of buttons) {
      expect(tag, tag).toContain('disabled=""');
      expect(tag, tag).toContain('aria-disabled="true"');
      expect(tag, tag).toContain('title="Admin only"');
    }
  });
});
