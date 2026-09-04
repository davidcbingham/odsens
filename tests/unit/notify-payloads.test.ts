/**
 * tests/unit/notify-payloads.test.ts — 05 T-ADP-19: the payload each deliverer hands its adapter,
 * per event kind (`comment.new`, `comment.held`, `comment.reported`, `sync.failed`, `sync.stale`)
 * plus the N2 digest, for both channels (04 §3.7 N5/N6; ADR-0030 D7; DESIGN.md §12.1; docs/
 * notifications.md §Character). Snapshots live under `tests/fixtures/{resend,discord}/__snapshots__/`
 * as `<kind>.json.snap` (raw output — prettier leaves `.snap` alone; `check-fixtures.mjs` scans them:
 * the only address is `seed-admin@localhost.test`, F-3).
 *
 * Resend payload = `{to, subject, html, text}` from `renderEmail` (the adapter adds `from` and the
 * `X-Entity-Ref-ID` header); Discord payload = the `DiscordEmbedInput` from `buildEmbed` (the adapter
 * adds `username:'allay'` and `timestamp`). Assertions beyond the snapshots: the allay copy lines
 * ("The allay picked this up on", "holding it until you decide", "came back empty-handed"), the footer
 * "The allay emails you because <switch> is on." + the `/admin/settings` link, the N5 subjects, the N6
 * titles/colours, the null-handle "a deleted account" (ADR-0030 D4), that a comment excerpt's link
 * never reaches the mail body (03 E-05 "links stripped"), the T-ADP-18 clause "description never
 * contains an email or a bare profile id" on every embed, the ADR-0030 D19 "No good run yet." /
 * "counts haven't updated yet." words (never "never"), and that untrusted text is Discord-markdown-
 * escaped in embed descriptions (a masked link `[Approve](https://…)` renders literally). Pure — no
 * network (H-5); the clock is fixed so relative run times are stable.
 */
import { describe, expect, it } from 'vitest';
import { DISCORD_COLORS } from '@/lib/adapters/discord';
import { escapeDiscordMarkdown } from '@/lib/notify/deliver/content';
import { buildEmbed } from '@/lib/notify/deliver/discord';
import { renderEmail } from '@/lib/notify/deliver/email';
import type { DeliverContext, RecipientRow } from '@/lib/notify/deliver/types';

const SITE = 'http://localhost:3000';
const NOW = new Date('2026-09-03T12:00:00Z');
const ADDRESS = 'seed-admin@localhost.test';
const WEBHOOK = 'https://discord.com/api/webhooks/123/t_snapshottoken';
const PROJECT_ID = '00000000-0000-4000-8000-000000000101';
const COMMENT_ID = '00000000-0000-4000-8000-000000000201';
const RUN_ID = '00000000-0000-4000-8000-000000000801';
const USER_ID = '00000000-0000-4000-8000-000000000003';

const SNAP = {
  resend: '../fixtures/resend/__snapshots__',
  discord: '../fixtures/discord/__snapshots__',
};

function ctx(mode: DeliverContext['mode']): DeliverContext {
  return { runId: RUN_ID, siteUrl: SITE, mode, now: NOW };
}

let counter = 0;
function row(
  channel: 'email' | 'discord',
  kind: string,
  payload: Record<string, unknown>,
  createdAt = '2026-09-03T11:55:00Z',
): RecipientRow {
  counter += 1;
  const n = String(counter).padStart(4, '0');
  return {
    id: `00000000-0000-4000-8000-00000000f${n.slice(1)}`,
    event_id: `00000000-0000-4000-8000-00000000e${n.slice(1)}`,
    channel,
    address: channel === 'email' ? ADDRESS : WEBHOOK,
    attempts: 0,
    created_at: createdAt,
    event: {
      id: `00000000-0000-4000-8000-00000000e${n.slice(1)}`,
      kind,
      payload: payload as RecipientRow['event']['payload'],
      subject_type: kind.startsWith('sync.') ? 'sync_run' : 'comment',
      subject_id: kind.startsWith('sync.') ? RUN_ID : COMMENT_ID,
      created_at: createdAt,
    },
  };
}

/** The 04 §1.2 comment payload shape (`postComment` → `emit`). */
const comment = (extra: Record<string, unknown> = {}) => ({
  comment_id: COMMENT_ID,
  target_type: 'project',
  target_id: PROJECT_ID,
  target_title: 'Metal Pipe Mace',
  target_slug: 'metal-pipe-mace',
  excerpt: 'this mace is unreasonably fun. the sound gets me every time',
  author: { profile_id: USER_ID, handle: 'creeperfan9' },
  first_time: false,
  ...extra,
});

const KINDS: { name: string; kind: string; payload: Record<string, unknown> }[] = [
  { name: 'comment.new', kind: 'comment.new', payload: comment() },
  {
    name: 'comment.held',
    kind: 'comment.held',
    payload: comment({ first_time: true, reason: 'first_time' }),
  },
  {
    name: 'comment.reported',
    kind: 'comment.reported',
    payload: comment({ report_count: 2, reason: 'spam' }),
  },
  {
    name: 'sync.failed',
    kind: 'sync.failed',
    payload: {
      source: 'modrinth',
      run_id: RUN_ID,
      error: 'list: GET https://api.modrinth.com/v2/user/OddSense/projects → 429',
      started_at: '2026-09-03T11:56:00Z',
    },
  },
  {
    name: 'sync.stale',
    kind: 'sync.stale',
    payload: { source: 'youtube', last_ok_at: '2026-09-02T10:00:00Z', hours_since_ok: 26 },
  },
];

/** DESIGN.md §12.1 / docs/notifications.md §Character — the lines T-ADP-19 names. */
const ALLAY = {
  pickedUp: 'The allay picked this up on',
  holding: 'holding it until you decide',
  emptyHanded: 'came back empty-handed',
};
const FOOTER = /The allay emails you because [a-z-]+ mail is on\./;
const MANAGE = `${SITE}/admin/settings`;

function unescapeHtml(html: string): string {
  return html
    .replace(/<!-- -->/g, '')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

describe('T-ADP-19 resend payloads (deliver/email.ts)', () => {
  it.each(KINDS)(
    'T-ADP-19 $name → {to, subject, html, text} snapshot',
    async ({ name, kind, payload }) => {
      const rows = [row('email', kind, payload)];
      const mail = await renderEmail(rows, ctx('single'));
      const sent = { to: ADDRESS, subject: mail.subject, text: mail.text, html: mail.html };
      await expect(JSON.stringify(sent, null, 2)).toMatchFileSnapshot(
        `${SNAP.resend}/${name}.json.snap`,
      );

      const html = unescapeHtml(mail.html);
      expect(html).toMatch(FOOTER);
      expect(mail.text).toMatch(FOOTER);
      expect(html).toContain(MANAGE);
      expect(mail.text).toContain(MANAGE);
      expect(mail.subject).not.toMatch(/[!\p{Extended_Pictographic}]/u);
      expect(mail.html).not.toContain(ADDRESS);
    },
  );

  it('T-ADP-19 comment.new carries the allay lead line + the N5 subject', async () => {
    const mail = await renderEmail([row('email', 'comment.new', comment())], ctx('single'));
    expect(mail.subject).toBe('New comment on Metal Pipe Mace');
    expect(unescapeHtml(mail.html)).toContain(ALLAY.pickedUp);
    expect(mail.text).toContain(ALLAY.pickedUp);
    expect(mail.text).toContain(`${SITE}/projects/metal-pipe-mace#comments`);
  });

  it('T-ADP-19 comment.held carries "holding it until you decide" + Approve → /admin/comments', async () => {
    const mail = await renderEmail(
      [row('email', 'comment.held', comment({ first_time: true }))],
      ctx('single'),
    );
    expect(mail.subject).toBe('Held for review: Metal Pipe Mace');
    expect(unescapeHtml(mail.html)).toContain(ALLAY.holding);
    expect(mail.text).toContain(ALLAY.holding);
    expect(mail.text).toContain('First comment from creeperfan9');
    expect(mail.html).toContain(`${SITE}/admin/comments`);
  });

  it('T-ADP-19 comment.reported carries the count + reason and the N5 subject', async () => {
    const mail = await renderEmail(
      [row('email', 'comment.reported', comment({ report_count: 2, reason: 'spam' }))],
      ctx('single'),
    );
    expect(mail.subject).toBe('Reported comment on Metal Pipe Mace');
    expect(mail.text).toContain('2 reports · spam');
  });

  it('T-ADP-19 sync.failed / sync.stale carry "came back empty-handed" + the source subjects', async () => {
    const failed = await renderEmail(
      [row('email', 'sync.failed', KINDS[3]!.payload)],
      ctx('single'),
    );
    expect(failed.subject).toBe('Sync failed: modrinth');
    expect(unescapeHtml(failed.html)).toContain(ALLAY.emptyHanded);
    expect(failed.text).toContain(ALLAY.emptyHanded);
    expect(failed.text).toContain('Cause:');
    expect(failed.text).toContain('Last run 4 min ago.');

    const stale = await renderEmail([row('email', 'sync.stale', KINDS[4]!.payload)], ctx('single'));
    expect(stale.subject).toBe('Sync stale: youtube');
    expect(stale.text).toContain("YouTube counts haven't updated in 26 hours.");
    expect(stale.text).toContain('Last good run yesterday.');
  });

  it('T-ADP-19 a scrubbed author renders "a deleted account" (ADR-0030 D4)', async () => {
    const mail = await renderEmail(
      [row('email', 'comment.new', comment({ author: { profile_id: null, handle: null } }))],
      ctx('single'),
    );
    expect(mail.text).toContain('from a deleted account');
  });

  it('T-ADP-19 a comment excerpt carrying a link reaches the mail with the link stripped (03 E-05)', async () => {
    const spam = comment({
      excerpt: 'free diamonds at https://spam.example/free?x=1 and www.spam.example/2 now',
      author: { profile_id: USER_ID, handle: 'blockhead_42' },
    });
    for (const kind of ['comment.new', 'comment.held', 'comment.reported']) {
      const mail = await renderEmail([row('email', kind, spam)], ctx('single'));
      for (const out of [unescapeHtml(mail.html), mail.text]) {
        expect(out).not.toContain('spam.example');
        expect(out).toContain('"free diamonds at and now"');
      }
    }
    const digest = await renderEmail(
      Array.from({ length: 6 }, (_, i) =>
        row('email', 'comment.new', spam, `2026-09-03T11:5${i}:00Z`),
      ),
      ctx('digest'),
    );
    expect(digest.text).not.toContain('spam.example');
    expect(digest.text).toContain('"free diamonds at and now"');
  });

  it('T-ADP-19 digest → one "<N> things from the allay" mail listing every item (snapshot)', async () => {
    const rows = [
      row('email', 'comment.new', comment(), '2026-09-03T11:50:00Z'),
      row('email', 'comment.held', comment({ first_time: true }), '2026-09-03T11:51:00Z'),
      row(
        'email',
        'comment.reported',
        comment({ report_count: 1, reason: 'spam' }),
        '2026-09-03T11:52:00Z',
      ),
      row('email', 'sync.failed', KINDS[3]!.payload, '2026-09-03T11:53:00Z'),
      row('email', 'sync.stale', KINDS[4]!.payload, '2026-09-03T11:54:00Z'),
      row('email', 'comment.new', comment({ excerpt: 'second one' }), '2026-09-03T11:55:00Z'),
    ];
    const mail = await renderEmail(rows, ctx('digest'));
    expect(mail.subject).toBe('6 things from the allay');
    const html = unescapeHtml(mail.html);
    expect(html).toContain('The allay picked up 6 things');
    expect(html).toContain('The allay emails you because digest mail is on.');
    expect(mail.text).toContain(`${SITE}/admin/comments`);
    expect(mail.text).toContain('second one');
    await expect(
      JSON.stringify(
        { to: ADDRESS, subject: mail.subject, text: mail.text, html: mail.html },
        null,
        2,
      ),
    ).toMatchFileSnapshot(`${SNAP.resend}/digest.json.snap`);
  });
});

describe('T-ADP-19 discord payloads (deliver/discord.ts)', () => {
  it.each(KINDS)('T-ADP-19 $name → embed snapshot', async ({ name, kind, payload }) => {
    const embed = buildEmbed([row('discord', kind, payload)], ctx('single'));
    await expect(JSON.stringify(embed, null, 2)).toMatchFileSnapshot(
      `${SNAP.discord}/${name}.json.snap`,
    );
    expect(embed.title).toMatch(/^[A-Z][a-z ]+ — .+$/);
    expect(JSON.stringify(embed)).not.toContain(WEBHOOK);
    // T-ADP-18: the description never carries an email or a bare profile id.
    expect(JSON.stringify(embed)).not.toContain(USER_ID);
    expect(JSON.stringify(embed)).not.toContain(ADDRESS);
    expect(embed.description).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
    );
    expect(embed.description).not.toMatch(/\S+@\S+\.\S+/);
    expect(embed.description.length).toBeLessThanOrEqual(4096);
  });

  it('T-ADP-19 comment.new: "New comment — <title>", @handle: "…", link to the comment, indigo', () => {
    const embed = buildEmbed([row('discord', 'comment.new', comment())], ctx('single'));
    expect(embed.title).toBe('New comment — Metal Pipe Mace');
    expect(embed.description).toBe(
      '@creeperfan9: "this mace is unreasonably fun. the sound gets me every time"',
    );
    expect(embed.url).toBe(`${SITE}/projects/metal-pipe-mace#comments`);
    expect(embed.color).toBe(DISCORD_COLORS.indigo);
  });

  it('T-ADP-19 comment.held / comment.reported are gold and link the admin queue', () => {
    const held = buildEmbed(
      [row('discord', 'comment.held', comment({ first_time: true }))],
      ctx('single'),
    );
    expect(held.title).toBe('Held for review — Metal Pipe Mace');
    expect(held.description).toContain('First comment from @creeperfan9:');
    expect(held.color).toBe(DISCORD_COLORS.gold);
    expect(held.url).toBe(`${SITE}/admin/comments`);

    const reported = buildEmbed(
      [row('discord', 'comment.reported', comment({ report_count: 2, reason: 'spam' }))],
      ctx('single'),
    );
    expect(reported.title).toBe('Reported comment — Metal Pipe Mace');
    expect(reported.description).toContain('2 reports · spam');
    expect(reported.color).toBe(DISCORD_COLORS.gold);
  });

  it('T-ADP-19 sync.failed / sync.stale are alert, carry the allay line and link /admin', () => {
    const failed = buildEmbed([row('discord', 'sync.failed', KINDS[3]!.payload)], ctx('single'));
    expect(failed.title).toBe('Sync failed — Modrinth');
    expect(failed.description).toContain(ALLAY.emptyHanded);
    expect(failed.description).toContain('Cause: ');
    expect(failed.color).toBe(DISCORD_COLORS.alert);
    expect(failed.url).toBe(`${SITE}/admin`);

    const stale = buildEmbed([row('discord', 'sync.stale', KINDS[4]!.payload)], ctx('single'));
    expect(stale.title).toBe('Sync stale — YouTube');
    expect(stale.description).toContain("YouTube counts haven't updated in 26 hours.");
    expect(stale.color).toBe(DISCORD_COLORS.alert);
  });

  it('T-ADP-19 a scrubbed author reads "a deleted account" (no @, no uuid, no address)', () => {
    const embed = buildEmbed(
      [row('discord', 'comment.new', comment({ author: { profile_id: null, handle: null } }))],
      ctx('single'),
    );
    expect(embed.description.startsWith('a deleted account: "')).toBe(true);
    expect(embed.description).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(embed.description).not.toMatch(/@\S+@/);
    expect(embed.description).not.toContain('@');
  });

  it('T-ADP-19 a comment excerpt carrying a link reaches the embed with the link stripped (03 E-05 / 04 N6)', () => {
    const spam = comment({
      excerpt: 'free diamonds at https://spam.example/free?x=1 and www.spam.example/2 now',
      author: { profile_id: USER_ID, handle: 'creeperfan9' },
    });
    const embed = buildEmbed([row('discord', 'comment.new', spam)], ctx('single'));
    expect(embed.description).toBe('@creeperfan9: "free diamonds at and now"');
    expect(embed.description).not.toContain('spam.example');
    // The digest lines follow the same rule.
    const digest = buildEmbed(
      Array.from({ length: 6 }, (_, i) =>
        row('discord', 'comment.new', spam, `2026-09-03T11:5${i}:00Z`),
      ),
      ctx('digest'),
    );
    expect(digest.description).not.toContain('spam.example');
    expect(digest.description).toContain('"free diamonds at and now"');
    // A link-only excerpt quotes nothing rather than the URL.
    const only = buildEmbed(
      [row('discord', 'comment.new', comment({ excerpt: 'https://spam.example/only' }))],
      ctx('single'),
    );
    expect(only.description).toBe('@creeperfan9: ""');
  });

  it('T-ADP-19 a stale source with no ok run reads "<Source> counts haven\'t updated yet." — never "never" (ADR-0030 D19)', () => {
    const embed = buildEmbed(
      [
        row('discord', 'sync.stale', {
          source: 'curseforge',
          last_ok_at: null,
          hours_since_ok: null,
        }),
      ],
      ctx('single'),
    );
    expect(embed.description).toContain("CurseForge counts haven't updated yet.");
    expect(embed.description).not.toContain('never');
    expect(embed.description).not.toContain("haven't updated since");
    // A sync.failed row whose started_at is unparseable drops the run words without inventing any.
    const odd = buildEmbed(
      [row('discord', 'sync.failed', { source: 'modrinth', started_at: 'not a date', error: 'x' })],
      ctx('single'),
    );
    expect(odd.description).not.toContain('never');
  });

  it('T-ADP-19 untrusted text is Discord-markdown-escaped: a masked link, spoiler, code or emphasis renders literally', () => {
    const hostile = comment({
      excerpt: 'click [Approve](https://evil.example/x) ||spoiler|| `code` **bold** _it_ ~~gone~~',
      author: { profile_id: USER_ID, handle: 'under_score_9' },
    });
    const embed = buildEmbed([row('discord', 'comment.new', hostile)], ctx('single'));
    // The masked link's URL is gone first (E-05 `stripLinks` — the B3 pattern eats through the
    // closing paren), then every remaining metacharacter is escaped.
    expect(embed.description).toBe(
      '@under\\_score\\_9: "click \\[Approve\\]\\( \\|\\|spoiler\\|\\| \\`code\\` \\*\\*bold\\*\\* \\_it\\_ \\~\\~gone\\~\\~"',
    );
    expect(embed.description).not.toContain('evil.example');
    expect(embed.description).not.toMatch(/(^|[^\\])\[[^\]]*\]\(/); // no live masked link
    expect(embed.url).toBe(`${SITE}/projects/metal-pipe-mace#comments`); // the View link is ours

    // The reported reason, the digest title and the sync cause go through the same escape.
    const reported = buildEmbed(
      [row('discord', 'comment.reported', comment({ report_count: 1, reason: 'spam_links' }))],
      ctx('single'),
    );
    expect(reported.description).toContain('1 report · spam links');
    const cause = buildEmbed(
      [
        row('discord', 'sync.failed', {
          source: 'modrinth',
          run_id: RUN_ID,
          error: 'GET https://api.modrinth.com/v2/user/Odd_Sense/projects → 500 [body]',
          started_at: '2026-09-03T11:56:00Z',
        }),
      ],
      ctx('single'),
    );
    expect(cause.description).toContain(
      'Cause: GET https://api.modrinth.com/v2/user/Odd\\_Sense/projects → 500 \\[body\\]',
    );
    const digest = buildEmbed(
      Array.from({ length: 6 }, (_, i) =>
        row(
          'discord',
          'comment.new',
          comment({ target_title: '[Forge] Mace *Deluxe*', excerpt: `> quote ${i}` }),
          `2026-09-03T11:5${i}:00Z`,
        ),
      ),
      ctx('digest'),
    );
    for (const line of digest.description.split('\n')) {
      expect(line).toMatch(/^New comment — \\\[Forge\\\] Mace \\\*Deluxe\\\*: "\\> quote \d"$/);
    }
  });

  it('T-ADP-19 escapeDiscordMarkdown is pure, idempotent on plain text and escapes line-leading # / - markers', () => {
    expect(escapeDiscordMarkdown('plain words, nothing odd.')).toBe('plain words, nothing odd.');
    expect(escapeDiscordMarkdown('# heading\n- item\n  - nested\nmid-word-dash')).toBe(
      '\\# heading\n\\- item\n  \\- nested\nmid-word-dash',
    );
    expect(escapeDiscordMarkdown('a\\b')).toBe('a\\\\b');
  });

  it('T-ADP-19 a 200+ character excerpt is clipped to 200 code points with an ellipsis', () => {
    const long = 'x'.repeat(250);
    const embed = buildEmbed(
      [row('discord', 'comment.new', comment({ excerpt: long }))],
      ctx('single'),
    );
    expect(embed.description).toBe(`@creeperfan9: "${'x'.repeat(199)}…"`);
  });

  it('T-ADP-19 digest → ONE embed "<N> things from the allay" with ≤ 25 lines (snapshot)', async () => {
    const rows = [
      row('discord', 'comment.new', comment(), '2026-09-03T11:50:00Z'),
      row('discord', 'comment.held', comment({ first_time: true }), '2026-09-03T11:51:00Z'),
      row(
        'discord',
        'comment.reported',
        comment({ report_count: 1, reason: 'spam' }),
        '2026-09-03T11:52:00Z',
      ),
      row('discord', 'sync.failed', KINDS[3]!.payload, '2026-09-03T11:53:00Z'),
      row('discord', 'sync.stale', KINDS[4]!.payload, '2026-09-03T11:54:00Z'),
      row('discord', 'comment.new', comment({ excerpt: 'second one' }), '2026-09-03T11:55:00Z'),
    ];
    const embed = buildEmbed(rows, ctx('digest'));
    expect(embed.title).toBe('6 things from the allay');
    expect(embed.description.split('\n')).toHaveLength(6);
    expect(embed.description).toContain('New comment — Metal Pipe Mace: "this mace');
    expect(embed.description).toContain('Sync failed — Modrinth');
    expect(embed.url).toBe(`${SITE}/admin/comments`);
    expect(embed.color).toBe(DISCORD_COLORS.indigo);
    await expect(JSON.stringify(embed, null, 2)).toMatchFileSnapshot(
      `${SNAP.discord}/digest.json.snap`,
    );

    // 30 rows → 25 lines + the "…and 5 more" line; sync-only groups link /admin.
    const many = Array.from({ length: 30 }, (_, i) =>
      row(
        'discord',
        'sync.stale',
        { source: 'modrinth', last_ok_at: null, hours_since_ok: null },
        `2026-09-03T10:${String(i).padStart(2, '0')}:00Z`,
      ),
    );
    const big = buildEmbed(many, ctx('digest'));
    expect(big.title).toBe('30 things from the allay');
    expect(big.description.split('\n')).toHaveLength(26);
    expect(big.description).toContain('…and 5 more in admin.');
    expect(big.url).toBe(`${SITE}/admin`);
  });
});
