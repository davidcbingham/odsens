/**
 * lib/notify/deliver/discord.ts — the Discord `Deliverer` (04 §3.7 N3/N6; §4.6 via
 * `lib/adapters/discord.ts`; 01 INV-70 — this file and `deliver/email.ts` are the only adapter
 * importers besides `testDiscordWebhook`; DESIGN.md §12.1 "Discord embed"; docs/notifications.md
 * §Character; ADR-0030 D7; 05 T-ACT-30, T-ACT-31, T-ADP-19).
 *
 * Embed per row (04 N6): `{title: '<Event> — <target title>', description: excerpt(200), url: link,
 * color}` — for a sync event the title's right half is the bare source name ("Sync failed —
 * Modrinth", DESIGN.md §12.1 frame; the mail h1 keeps "<Source> sync", ADR-0030 D15) — event words New comment · Held for review · Reported comment · Sync failed · Sync stale;
 * description `@handle: "…"` for a comment ("First comment from @handle: …" when held first-time,
 * plus a "<n> reports · <reason>" line when reported) or the allay's sync lines ("The allay came back
 * empty-handed. It'll keep trying." · the stale hours, or "<Source> counts haven't updated yet." for a
 * source with no ok run (ADR-0030 D19) · "Cause: …" · "Nothing is on fire."); colour indigo default ·
 * gold `comment.held` / `comment.reported` · alert `sync.*` (`DISCORD_COLORS`). Every untrusted
 * string in a description — excerpt, handle, project title, upstream error — passes through
 * `escapeDiscordMarkdown` first (Discord renders markdown and masked links in descriptions; a
 * commenter must not be able to plant `[Approve](https://…)` in the admin channel).
 * `url` = the View target (the comment on the site · `/admin/comments` · `/admin`). Digest (N2,
 * ADR-0030 D7): ONE embed titled "<N> things from the allay" listing ≤ 25 `<Event> — <title>: "…"`
 * lines, linking `/admin/comments` (or `/admin` when every row is a sync event).
 *
 * `postEmbed(row.address, embed)` per row (or once per digest), sequential — the job caps a tick at
 * `DISCORD_PER_TICK` rows. The address IS the webhook secret: it never reaches a log line or an
 * error text (the adapter masks every thrown message to `…<last 4>`); a row without one answers
 * `not_configured` (04 N7).
 */
import 'server-only';
import { DISCORD_COLORS, createDiscord, type DiscordEmbedInput } from '@/lib/adapters/discord';
import { env } from '@/lib/env';
import {
  ALLAY_EMPTY_HANDED,
  ALLAY_NOTHING_ON_FIRE,
  DISCORD_EXCERPT_LENGTH,
  clipExcerpt,
  describeEvent,
  digestLink,
  escapeDiscordMarkdown,
  eventLabel,
  handleWords,
  sourceLabel,
  type EventContent,
} from './content';
import {
  clipRecipientError,
  type DeliverContext,
  type DeliverResult,
  type Deliverer,
  type RecipientRow,
} from './types';

/** ADR-0030 D7: the digest embed lists at most this many lines. */
export const DIGEST_LINES_MAX = 25;
/** Discord's embed description ceiling (4096) with headroom. */
const DESCRIPTION_LIMIT = 4000;
/** Digest line excerpts are shorter so 25 lines fit the description. */
const DIGEST_EXCERPT_LENGTH = 120;

/** 04 N7 wording. */
export const NOT_CONFIGURED = 'not_configured';

/** 04 N6 colour per kind: indigo default · gold held/reported · alert sync.*. */
export function colorFor(kind: string): number {
  if (kind === 'comment.held' || kind === 'comment.reported') return DISCORD_COLORS.gold;
  if (kind === 'sync.failed' || kind === 'sync.stale') return DISCORD_COLORS.alert;
  return DISCORD_COLORS.indigo;
}

/** `"<excerpt>"` clipped to the N6 cap, markdown-escaped (untrusted comment text). */
function quoted(excerpt: string, max = DISCORD_EXCERPT_LENGTH): string {
  return `"${escapeDiscordMarkdown(clipExcerpt(excerpt, max))}"`;
}

/** The embed description for one event (04 N6 excerpt(200); the allay lines for sync). */
export function describeForDiscord(content: EventContent): string {
  if (content.source !== null || content.kind.startsWith('sync.')) {
    const lines = [ALLAY_EMPTY_HANDED];
    if (content.stale) {
      const name = sourceLabel(content.source);
      lines.push(
        typeof content.hoursSinceOk === 'number'
          ? `${name} counts haven't updated in ${Math.max(0, Math.round(content.hoursSinceOk))} hours.`
          : content.runAt === ''
            ? `${name} counts haven't updated yet.` // no ok run to date from (ADR-0030 D19)
            : `${name} counts haven't updated since ${content.runAt}.`,
      );
    }
    const cause = content.error?.trim() ?? '';
    if (cause !== '') {
      lines.push(`Cause: ${escapeDiscordMarkdown(clipExcerpt(cause, DISCORD_EXCERPT_LENGTH))}`);
    }
    lines.push(ALLAY_NOTHING_ON_FIRE);
    return lines.join('\n').slice(0, DESCRIPTION_LIMIT);
  }

  const who = escapeDiscordMarkdown(handleWords(content.handle));
  const lead =
    content.kind === 'comment.held' && content.firstTime
      ? `First comment from ${who}: ${quoted(content.excerpt)}`
      : `${who}: ${quoted(content.excerpt)}`;
  if (content.kind === 'comment.reported') {
    const count = `${content.reportCount} ${content.reportCount === 1 ? 'report' : 'reports'}`;
    const why = escapeDiscordMarkdown(content.reasons.map((r) => r.replace(/_/g, ' ')).join(', '));
    return `${lead}\n${why ? `${count} · ${why}` : count}`.slice(0, DESCRIPTION_LIMIT);
  }
  return lead.slice(0, DESCRIPTION_LIMIT);
}

/** One row → its embed (04 N6). */
export function buildSingleEmbed(row: RecipientRow, ctx: DeliverContext): DiscordEmbedInput {
  const content = describeEvent(row.event, ctx.siteUrl, ctx.now);
  return {
    title: `${content.label} — ${content.source === null ? content.title : sourceLabel(content.source)}`,
    description: describeForDiscord(content),
    url: content.link,
    color: colorFor(row.event.kind),
  };
}

/** N2 digest → one embed of ≤ 25 lines (ADR-0030 D7). */
export function buildDigestEmbed(rows: RecipientRow[], ctx: DeliverContext): DiscordEmbedInput {
  const lines = rows.slice(0, DIGEST_LINES_MAX).map((row) => {
    const content = describeEvent(row.event, ctx.siteUrl, ctx.now);
    const title = escapeDiscordMarkdown(
      content.source === null ? content.title : sourceLabel(content.source),
    );
    const excerpt =
      content.excerpt === '' ? '' : `: ${quoted(content.excerpt, DIGEST_EXCERPT_LENGTH)}`;
    return `${eventLabel(row.event.kind)} — ${title}${excerpt}`;
  });
  const more = rows.length - lines.length;
  if (more > 0) lines.push(`…and ${more} more in admin.`);
  return {
    title: `${rows.length} things from the allay`,
    description: lines.join('\n').slice(0, DESCRIPTION_LIMIT),
    url: digestLink(
      rows.map((row) => row.event.kind),
      ctx.siteUrl,
    ),
    color: DISCORD_COLORS.indigo,
  };
}

/** The embed for a group under `ctx.mode` — `single` builds `rows[0]`, `digest` the whole group. */
export function buildEmbed(rows: RecipientRow[], ctx: DeliverContext): DiscordEmbedInput {
  const first = rows[0];
  if (first === undefined) throw new Error('buildEmbed: empty group');
  return ctx.mode === 'digest' ? buildDigestEmbed(rows, ctx) : buildSingleEmbed(first, ctx);
}

function errorText(error: unknown): string {
  return clipRecipientError(error instanceof Error ? error.message : String(error));
}

/**
 * 04 N3 — the Discord deliverer. `single`: one post per row, sequential; `digest`: one post for
 * the group. Rows without an address answer `not_configured` (N7).
 */
export const deliverDiscord: Deliverer = async (rows, ctx) => {
  const result: DeliverResult = { sent: [], failed: [] };
  if (rows.length === 0) return result;
  const discord = createDiscord({ env });

  const groups: RecipientRow[][] = ctx.mode === 'digest' ? [rows] : rows.map((row) => [row]);
  for (const group of groups) {
    const first = group[0];
    if (first === undefined) continue;
    if (first.address === null || first.address === '') {
      for (const row of group) result.failed.push({ id: row.id, error: NOT_CONFIGURED });
      continue;
    }
    try {
      await discord.postEmbed(first.address, buildEmbed(group, ctx));
      for (const row of group) result.sent.push(row.id);
    } catch (error) {
      const text = errorText(error);
      for (const row of group) result.failed.push({ id: row.id, error: text });
    }
  }
  return result;
};
