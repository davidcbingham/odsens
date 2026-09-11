/**
 * tests/unit/emails.test.tsx — 05 T-UNIT-3: the React Email templates (`emails/**`; 03 §2.11 + §6
 * E-02..E-08; ADR-0030 D4/D7). For `CommentNew`, `CommentHeld`, `CommentReported`, `SyncFailed` and
 * `Digest`: the rendered HTML carries the `ODSENS` wordmark `<img alt="odsens">`, exactly ONE
 * `EmailButton` (gold only for `CommentHeld`), a "Manage in Settings." link to `/admin/settings`, the
 * allay lead line, the footer "The allay emails you because <switch> is on.", no font `<link>` / web
 * font, explicit `bgcolor` + `background-color` on body and card, `lang="en"`, the dark colour-scheme
 * metas, one `<h1>`, no radius/shadow; the plain-text render (`render(…, {plainText:true})`) carries
 * the same links; HTML + text snapshots live under `tests/fixtures/emails/__snapshots__/`; the prop
 * types contain no `email`/`name` keys (E-08); a null handle reads "a deleted account" (D4).
 * The wordmark is the 2× file at 84×20 attributes (E-07 / ADR-0030 D15); the `Digest` kind labels
 * equal `lib/notify/deliver/content.ts` `EVENT_LABELS` (04 N6 — mail and Discord digest agree);
 * a stale source with no good run reads "No good run yet." (ADR-0030 D19); every excerpt has its
 * links stripped (E-05). Snapshot files end in `.snap` (raw render output — prettier must not
 * reformat them).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { render } from '@react-email/components';
import { CommentHeld } from '@/emails/templates/CommentHeld';
import { CommentNew } from '@/emails/templates/CommentNew';
import { CommentReported } from '@/emails/templates/CommentReported';
import { DIGEST_KIND_LABELS, Digest } from '@/emails/templates/Digest';
import { SyncFailed } from '@/emails/templates/SyncFailed';
import { EVENT_LABELS } from '@/lib/notify/deliver/content';

const SITE = 'http://localhost:3000';
const MANAGE = `${SITE}/admin/settings`;
const SNAPSHOTS = path.join('..', 'fixtures', 'emails', '__snapshots__');

const project = { title: 'Metal Pipe Mace', url: `${SITE}/projects/metal-pipe-mace` };
const comment = {
  handle: 'creeperfan9',
  excerpt: 'this mace is unreasonably fun. the sound gets me every time',
  url: `${SITE}/projects/metal-pipe-mace#comments`,
};

/** React escapes `'`/`"` in text and separates adjacent text nodes with `<!-- -->` — compare copy without either. */
function unescape(html: string): string {
  return html
    .replace(/<!-- -->/g, '')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

type Case = {
  name: string;
  element: React.ReactElement;
  tone: 'indigo' | 'gold';
  buttonHref: string;
  badge: string;
  lead: string;
  why: string;
  signoff: string;
};

const CASES: Case[] = [
  {
    name: 'CommentNew',
    element: <CommentNew project={project} comment={comment} manageUrl={MANAGE} />,
    tone: 'indigo',
    buttonHref: comment.url,
    badge: 'NEW COMMENT',
    lead: 'The allay picked this up on',
    why: 'The allay emails you because comment mail is on.',
    signoff: "— the allay. It picks things up and brings them to you. That's the whole job.",
  },
  {
    name: 'CommentHeld',
    element: (
      <CommentHeld
        project={{ title: 'Heavy Spear', url: `${SITE}/projects/heavy-spear` }}
        comment={{
          handle: 'netherrose',
          excerpt: 'does this work with the shield rework mod?',
          url: `${SITE}/projects/heavy-spear#comments`,
        }}
        approveUrl={`${SITE}/admin/comments`}
        manageUrl={MANAGE}
        firstTime
      />
    ),
    tone: 'gold',
    buttonHref: `${SITE}/admin/comments`,
    badge: 'HELD FOR REVIEW',
    lead: 'The allay is holding it until you decide:',
    why: 'The allay emails you because held-comment mail is on.',
    signoff:
      '— the allay, still holding the comment. It can hold it all day. Approve is one click.',
  },
  {
    name: 'CommentReported',
    element: (
      <CommentReported
        project={project}
        comment={{ ...comment, handle: 'blockhead_42', excerpt: 'free diamonds at my site' }}
        reportCount={2}
        reasons={['spam', 'off_topic']}
        url={`${SITE}/admin/comments`}
        manageUrl={MANAGE}
      />
    ),
    tone: 'indigo',
    buttonHref: `${SITE}/admin/comments`,
    badge: 'REPORTED',
    lead: 'Someone reported a comment on',
    why: 'The allay emails you because reported-comment mail is on.',
    signoff: '— the allay. It just carries the report. The call is yours.',
  },
  {
    name: 'SyncFailed',
    element: (
      <SyncFailed
        source="modrinth"
        error="429 rate limit on /v2/project/metal-pipe-mace"
        runAt="3 Sep 2026, 14:10"
        stale={false}
        adminUrl={`${SITE}/admin`}
        manageUrl={MANAGE}
      />
    ),
    tone: 'indigo',
    buttonHref: `${SITE}/admin`,
    badge: 'FAILED',
    lead: "The allay came back empty-handed. It'll keep trying.",
    why: 'The allay emails you because sync mail is on.',
    signoff: "— the allay. It'll keep trying. This usually fixes itself.",
  },
  {
    name: 'Digest',
    element: (
      <Digest
        count={6}
        items={[
          {
            kind: 'comment.new',
            title: 'Metal Pipe Mace',
            excerpt: 'this mace is unreasonably fun',
          },
          {
            kind: 'comment.new',
            title: 'Metal Pipe Mace',
            excerpt: 'the sound gets me every time',
          },
          {
            kind: 'comment.held',
            title: 'Heavy Spear',
            excerpt: 'does this work with the shield rework mod?',
          },
          { kind: 'comment.reported', title: 'Heavy Spear', excerpt: 'free diamonds at my site' },
          { kind: 'sync.failed', title: 'Modrinth', excerpt: '429 rate limit' },
          {
            kind: 'comment.new',
            title: 'Copper Golem Pack',
            excerpt: 'the little guy waves. 10/10',
          },
        ]}
        url={`${SITE}/admin/comments`}
        manageUrl={MANAGE}
      />
    ),
    tone: 'indigo',
    buttonHref: `${SITE}/admin/comments`,
    badge: 'DIGEST',
    lead: 'The allay picked up 6 things. Here they are:',
    why: 'The allay emails you because digest mail is on.',
    signoff: "— the allay. It waited until there was a pile. Here's the pile.",
  },
];

describe.each(CASES)('T-UNIT-3 $name (03 §2.11, §6 E-02..E-08)', (c) => {
  it(`T-UNIT-3 ${c.name} html: wordmark, one button (${c.tone}), manage link, allay line, footer, dark metas, one h1`, async () => {
    const html = unescape(await render(c.element));

    // E-07 / ADR-0030 D15: the 2× wordmark PNG at 84×20 attributes, absolute URL, alt text.
    const imgs = html.match(/<img\b[^>]*>/g) ?? [];
    expect(imgs).toHaveLength(1);
    expect(imgs[0]).toContain('alt="odsens"');
    expect(imgs[0]).toContain(`src="${SITE}/brand/email/wordmark@2x.png"`);
    expect(imgs[0]).toMatch(/width="84"/);
    expect(imgs[0]).toMatch(/height="20"/);

    // E-05: exactly one EmailButton; gold only in CommentHeld.
    const buttons = html.match(/data-email-button="[a-z]+"/g) ?? [];
    expect(buttons).toEqual([`data-email-button="${c.tone}"`]);
    expect(html).toContain(`href="${c.buttonHref}"`);
    if (c.name !== 'CommentHeld') expect(html).not.toContain('#ffc61f');

    // E-05 badge, lead line, footer why + Manage in Settings + sign-off.
    expect(html).toContain(`>${c.badge}<`);
    expect(html).toContain(c.lead);
    expect(html).toContain(c.why);
    expect(html).toContain(`href="${MANAGE}"`);
    expect(html).toContain('Manage in Settings.');
    expect(html).toContain(c.signoff);

    // E-03/E-04: no web fonts, no remote CSS, explicit dark backgrounds, colour-scheme metas, radius 0, no shadows.
    expect(html).not.toMatch(/<link\b[^>]*(stylesheet|fonts\.)/);
    expect(html).not.toMatch(/@font-face|fonts\.googleapis|@import/);
    expect(html).toMatch(/<body\b[^>]*bgcolor="#0d131b"[^>]*>/);
    expect(html).toMatch(/<body\b[^>]*background-color:#0d131b/);
    expect(html).toMatch(/<table\b[^>]*bgcolor="#151e29"[^>]*background-color:#151e29/);
    expect(html).toContain('<meta name="color-scheme" content="dark"');
    expect(html).toContain('<meta name="supported-color-schemes" content="dark"');
    expect(html).not.toMatch(/border-radius|box-shadow|animation|<script/);
    expect(html).toMatch(/<html\b[^>]*lang="en"/);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toMatch(/max-width:600px/);
  });

  it(`T-UNIT-3 ${c.name} text: plain-text render carries the same links and copy`, async () => {
    const text = await render(c.element, { plainText: true });
    expect(text).toContain(MANAGE);
    expect(text).toContain(c.buttonHref);
    expect(text).toContain(c.why);
    expect(text).toContain(c.lead);
    expect(text).not.toMatch(/<[a-z]+[\s>]/);
  });

  it(`T-UNIT-3 ${c.name} snapshots (tests/fixtures/emails/__snapshots__)`, async () => {
    const html = await render(c.element);
    const text = await render(c.element, { plainText: true });
    await expect(html).toMatchFileSnapshot(path.join(SNAPSHOTS, `${c.name}.html.snap`));
    await expect(text).toMatchFileSnapshot(path.join(SNAPSHOTS, `${c.name}.txt.snap`));
  });
});

describe('T-UNIT-3 variants', () => {
  it('T-UNIT-3 a null handle renders "a deleted account" (ADR-0030 D4) in every comment template', async () => {
    const gone = { ...comment, handle: null };
    const news = unescape(
      await render(<CommentNew project={project} comment={gone} manageUrl={MANAGE} />),
    );
    const held = unescape(
      await render(
        <CommentHeld
          project={project}
          comment={gone}
          approveUrl={`${SITE}/admin/comments`}
          manageUrl={MANAGE}
          firstTime
        />,
      ),
    );
    const reported = unescape(
      await render(
        <CommentReported
          project={project}
          comment={gone}
          reportCount={1}
          reasons={['spam']}
          url={`${SITE}/admin/comments`}
          manageUrl={MANAGE}
        />,
      ),
    );
    for (const html of [news, held, reported]) expect(html).toContain('a deleted account');
    expect(news).toContain(
      'from <strong style="color:#eef1f6;font-weight:bold">a deleted account</strong>:',
    );
    expect(reported).toContain('1 report · spam');
  });

  it('T-UNIT-3 CommentHeld without firstTime keeps the plain holding line and the gold button', async () => {
    const html = unescape(
      await render(
        <CommentHeld
          project={project}
          comment={comment}
          approveUrl={`${SITE}/admin/comments`}
          manageUrl={MANAGE}
        />,
      ),
    );
    expect(html).not.toContain('First comment from');
    expect(html).toContain('The allay is holding it until you decide:');
    expect(html.match(/data-email-button="gold"/g)).toHaveLength(1);
    expect(html).toContain(`href="${comment.url}"`);
  });

  it('T-UNIT-3 SyncFailed stale: STALE badge, the hours line, no cause box when error is null', async () => {
    const html = unescape(
      await render(
        <SyncFailed
          source="modrinth"
          error={null}
          runAt="3 Sep 2026, 14:10"
          stale
          hoursSinceOk={26}
          adminUrl={`${SITE}/admin`}
          manageUrl={MANAGE}
        />,
      ),
    );
    expect(html).toContain('>STALE<');
    expect(html).toContain("Modrinth counts haven't updated in 26 hours.");
    expect(html).not.toContain('Cause:');
    expect(html).toContain('Last good run 3 Sep 2026, 14:10.');
    const fallback = unescape(
      await render(
        <SyncFailed
          source="curseforge"
          error=""
          runAt="yesterday"
          stale
          adminUrl={`${SITE}/admin`}
          manageUrl={MANAGE}
        />,
      ),
    );
    expect(fallback).toContain("CurseForge counts haven't updated since yesterday.");
  });

  it('T-UNIT-3 excerpts are escaped, never raw HTML (INV-65)', async () => {
    const html = await render(
      <CommentNew
        project={project}
        comment={{ ...comment, excerpt: '<img src=x onerror=alert(1)> & <b>bold</b>' }}
        manageUrl={MANAGE}
      />,
    );
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<b>bold</b>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; &lt;b&gt;bold&lt;/b&gt;');
  });

  it('T-UNIT-3 siteUrl: explicit prop wins, else the origin of manageUrl (E-07)', async () => {
    const explicit = await render(
      <CommentNew
        project={project}
        comment={comment}
        manageUrl={MANAGE}
        siteUrl="https://odsens.com/"
      />,
    );
    expect(explicit).toContain('src="https://odsens.com/brand/email/wordmark@2x.png"');
    const derived = await render(
      <CommentNew
        project={project}
        comment={comment}
        manageUrl="https://staging.odsens.com/admin/settings"
      />,
    );
    expect(derived).toContain('src="https://staging.odsens.com/brand/email/wordmark@2x.png"');
  });

  it('T-UNIT-3 Digest: every item listed with its kind label; a larger count adds the "more" line', async () => {
    const html = unescape(
      await render(
        <Digest
          count={30}
          items={[
            { kind: 'comment.new', title: 'A', excerpt: 'x' },
            { kind: 'sync.stale', title: 'Modrinth', excerpt: '' },
          ]}
          url={`${SITE}/admin`}
          manageUrl={MANAGE}
        />,
      ),
    );
    expect(html).toContain('New comment</strong> — A');
    expect(html).toContain('Sync stale</strong> — Modrinth');
    expect(html).toContain('…and 28 more in admin.');
  });

  it('T-UNIT-3 Digest kind labels are the 04 N6 event words — the same table as EVENT_LABELS, so the mail and the Discord digest agree', async () => {
    expect(DIGEST_KIND_LABELS).toEqual(EVENT_LABELS);
    expect(Object.keys(DIGEST_KIND_LABELS).sort()).toEqual([
      'comment.held',
      'comment.new',
      'comment.reported',
      'sync.failed',
      'sync.stale',
    ]);
    const html = unescape(
      await render(
        <Digest
          count={5}
          items={[
            { kind: 'comment.new', title: 'A', excerpt: '' },
            { kind: 'comment.held', title: 'B', excerpt: '' },
            { kind: 'comment.reported', title: 'C', excerpt: '' },
            { kind: 'sync.failed', title: 'Modrinth', excerpt: '' },
            { kind: 'sync.stale', title: 'YouTube', excerpt: '' },
          ]}
          url={`${SITE}/admin/comments`}
          manageUrl={MANAGE}
        />,
      ),
    );
    expect(html).toContain('New comment</strong> — A');
    expect(html).toContain('Held for review</strong> — B');
    expect(html).toContain('Reported comment</strong> — C');
    expect(html).toContain('Sync failed</strong> — Modrinth');
    expect(html).toContain('Sync stale</strong> — YouTube');
    expect(html).not.toContain('>Reported</strong>');
  });

  it('T-UNIT-3 SyncFailed with no good run reads "No good run yet." (ADR-0030 D19) and drops the run line', async () => {
    const stale = await render(
      <SyncFailed
        source="curseforge"
        error={null}
        runAt=""
        stale
        adminUrl={`${SITE}/admin`}
        manageUrl={MANAGE}
      />,
    );
    const html = unescape(stale);
    const text = await render(
      <SyncFailed
        source="curseforge"
        error={null}
        runAt=""
        stale
        adminUrl={`${SITE}/admin`}
        manageUrl={MANAGE}
      />,
      { plainText: true },
    );
    for (const out of [html, text]) {
      expect(out).toContain('No good run yet.');
      expect(out).toContain("The allay came back empty-handed. It'll keep trying.");
      expect(out).not.toContain('never');
      expect(out).not.toContain("haven't updated since");
      expect(out).not.toContain('Last good run');
    }
    expect(html.match(/No good run yet\./g)).toHaveLength(1);
    // A failed run with no formatted time drops "Last run …" rather than printing an empty one.
    const failed = unescape(
      await render(
        <SyncFailed
          source="modrinth"
          error="boom"
          runAt=""
          stale={false}
          adminUrl={`${SITE}/admin`}
          manageUrl={MANAGE}
        />,
      ),
    );
    expect(failed).not.toContain('Last run');
    expect(failed).not.toContain('No good run yet.');
    expect(failed).toContain('Cause:');
  });

  it('T-UNIT-3 links are stripped from every excerpt before it reaches the mail (E-05)', async () => {
    const spam = {
      ...comment,
      handle: 'blockhead_42',
      excerpt: 'free diamonds at https://spam.example/free?x=1 and www.spam.example/2 now',
    };
    const elements = [
      <CommentNew key="new" project={project} comment={spam} manageUrl={MANAGE} />,
      <CommentHeld
        key="held"
        project={project}
        comment={spam}
        approveUrl={`${SITE}/admin/comments`}
        manageUrl={MANAGE}
      />,
      <CommentReported
        key="reported"
        project={project}
        comment={spam}
        reportCount={1}
        reasons={['spam']}
        url={`${SITE}/admin/comments`}
        manageUrl={MANAGE}
      />,
      <Digest
        key="digest"
        count={2}
        items={[
          { kind: 'comment.new', title: 'A', excerpt: spam.excerpt },
          { kind: 'comment.reported', title: 'B', excerpt: 'https://spam.example/only' },
        ]}
        url={`${SITE}/admin/comments`}
        manageUrl={MANAGE}
      />,
    ];
    for (const element of elements) {
      const html = unescape(await render(element));
      const text = await render(element, { plainText: true });
      for (const out of [html, text]) {
        expect(out).not.toContain('spam.example');
        expect(out).not.toContain('https://spam');
        expect(out).toContain('"free diamonds at and now"');
      }
    }
    // A link-only excerpt leaves the digest row without a quote line rather than an empty pair of quotes.
    const digest = unescape(await render(elements[3]!));
    expect(digest).toContain('Reported comment</strong> — B</p>');
  });
});

describe('T-UNIT-3 prop types carry no PII keys (03 E-08)', () => {
  const TEMPLATES = ['CommentNew', 'CommentHeld', 'CommentReported', 'SyncFailed', 'Digest'];
  it.each(TEMPLATES)('T-UNIT-3 %s Props type has no `email`/`name` key', (name) => {
    const source = readFileSync(
      path.join(process.cwd(), 'emails', 'templates', `${name}.tsx`),
      'utf8',
    );
    const match = source.match(new RegExp(`export type ${name}Props = \\{([\\s\\S]*?)\\n\\};`));
    expect(match, `${name}Props type found`).not.toBeNull();
    const body = match?.[1] ?? '';
    expect(body).toMatch(/\bhandle\b|\bcount\b|\bsource\b/);
    expect(body).not.toMatch(/\b(email|name|realName|displayName)\s*\??:/);
    expect(source).not.toMatch(/dangerouslySetInnerHTML/);
  });
});
