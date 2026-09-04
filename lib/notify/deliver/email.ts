/**
 * lib/notify/deliver/email.ts — the email `Deliverer` (04 §3.7 N3/N5; §4.5 via `lib/adapters/resend.ts`;
 * 03 §2.11 templates + §6 E-01..E-08; 01 INV-70 — this file and `deliver/discord.ts` are the only
 * adapter importers besides `testDiscordWebhook`; ADR-0030 D6/D7/D13; 05 T-ACT-30, T-ACT-31,
 * T-ADP-19, T-UNIT-26).
 *
 * Subjects (04 N5 / T-UNIT-26): `comment.new` "New comment on <title>" · `comment.held` "Held for
 * review: <title>" · `comment.reported` "Reported comment on <title>" · `sync.failed` "Sync failed:
 * <source>" · `sync.stale` "Sync stale: <source>" · digest "<N> things from the allay" — no emoji,
 * no exclamation marks (DESIGN.md §7); the title half is clipped so the whole subject is ≤ 60 code
 * points including the ellipsis (03 E-06, `SUBJECT_MAX`). Templates per kind: `CommentNew` · `CommentHeld` ·
 * `CommentReported` · `SyncFailed` (`stale: true` for `sync.stale`) · `Digest` (N2, > 5 rows).
 *
 * Each send: render the template to `html` + `text` (both async in @react-email/components) →
 * `createResend({env}).sendEmail({to: row.address, subject, html, text, headers: {'X-Entity-Ref-ID':
 * row.id}})` — sequentially (Resend ≤ 2 req/s, 04 §4.5); never `replyTo` (D13). A digest is one send
 * to the group's address (its `X-Entity-Ref-ID` is the first row's id) and every row shares the
 * outcome. Failures carry `error.message` (≤ 500) — adapter messages never contain the address or the
 * key. N7 (`RESEND_API_KEY` unset) is `notifyDeliver`'s decision before this module is called; if
 * reached without a key every row still answers `not_configured` rather than throwing.
 */
import 'server-only';
import { createElement, type ReactElement } from 'react';
import { render } from '@react-email/components';
import { CommentHeld } from '@/emails/templates/CommentHeld';
import { CommentNew } from '@/emails/templates/CommentNew';
import { CommentReported } from '@/emails/templates/CommentReported';
import { Digest } from '@/emails/templates/Digest';
import { SyncFailed } from '@/emails/templates/SyncFailed';
import { createResend } from '@/lib/adapters/resend';
import { env } from '@/lib/env';
import { clipExcerpt, describeEvent, digestLink, siteLinks, sourceLabel } from './content';
import {
  clipRecipientError,
  type DeliverContext,
  type DeliverResult,
  type Deliverer,
  type RecipientRow,
} from './types';

/** ADR-0030 D7: the digest lists at most this many items (the count still says how many there were). */
export const DIGEST_ITEMS_MAX = 25;

/** 04 N7 wording. */
export const NOT_CONFIGURED = 'not_configured';

/** 03 E-06: a subject is at most this many code points, ellipsis included. */
export const SUBJECT_MAX = 60;

/** `prefix` + the title clipped into the room that is left (never below one code point). */
function fit(prefix: string, title: string): string {
  return `${prefix}${clipExcerpt(title, Math.max(1, SUBJECT_MAX - Array.from(prefix).length))}`;
}

/**
 * 04 N5 / 05 T-UNIT-26 subject per kind. For `sync.*` pass the source (`modrinth`); for `'digest'`
 * pass the count (`digestSubject` is the typed twin). Unknown kinds fall back to "<kind>: <title>".
 * Every result is ≤ `SUBJECT_MAX` code points (03 E-06) — a long project title ends in "…".
 */
export function subjectFor(kind: string, title: string): string {
  switch (kind) {
    case 'comment.new':
      return fit('New comment on ', title);
    case 'comment.held':
      return fit('Held for review: ', title);
    case 'comment.reported':
      return fit('Reported comment on ', title);
    case 'sync.failed':
      return fit('Sync failed: ', title);
    case 'sync.stale':
      return fit('Sync stale: ', title);
    case 'digest':
      return fit('', `${title} things from the allay`);
    default:
      return fit(`${kind}: `, title);
  }
}

/** N2 digest subject — "<N> things from the allay". */
export function digestSubject(count: number): string {
  return subjectFor('digest', String(count));
}

export type EmailMessage = { subject: string; element: ReactElement };

/** One row → its subject + template element (04 N5). */
export function buildSingleEmail(row: RecipientRow, ctx: DeliverContext): EmailMessage {
  const content = describeEvent(row.event, ctx.siteUrl, ctx.now);
  const links = siteLinks(ctx.siteUrl);
  const common = { manageUrl: links.manage, siteUrl: ctx.siteUrl };
  const project = { title: content.title, url: content.projectUrl };
  const comment = { handle: content.handle, excerpt: content.excerpt, url: content.commentUrl };

  switch (row.event.kind) {
    case 'comment.held':
      return {
        subject: subjectFor(row.event.kind, content.title),
        element: createElement(CommentHeld, {
          project,
          comment,
          approveUrl: links.adminComments,
          firstTime: content.firstTime,
          ...common,
        }),
      };
    case 'comment.reported':
      return {
        subject: subjectFor(row.event.kind, content.title),
        element: createElement(CommentReported, {
          project,
          comment,
          reportCount: content.reportCount,
          reasons: content.reasons,
          url: links.adminComments,
          ...common,
        }),
      };
    case 'sync.failed':
    case 'sync.stale':
      return {
        subject: subjectFor(row.event.kind, content.source ?? 'sync'),
        element: createElement(SyncFailed, {
          source: content.source ?? 'sync',
          error: content.error,
          runAt: content.runAt,
          stale: content.stale,
          adminUrl: links.admin,
          hoursSinceOk: content.hoursSinceOk,
          ...common,
        }),
      };
    default:
      // `comment.new` and any future comment-shaped kind fanned out to email.
      return {
        subject: subjectFor(row.event.kind, content.title),
        element: createElement(CommentNew, { project, comment, ...common }),
      };
  }
}

/** N2 digest → `Digest` (ADR-0030 D7): ≤ 25 `{kind, title, excerpt}` items, count = the whole group. */
export function buildDigestEmail(rows: RecipientRow[], ctx: DeliverContext): EmailMessage {
  const links = siteLinks(ctx.siteUrl);
  const items = rows.slice(0, DIGEST_ITEMS_MAX).map((row) => {
    const content = describeEvent(row.event, ctx.siteUrl, ctx.now);
    return {
      kind: row.event.kind,
      title: content.source === null ? content.title : sourceLabel(content.source),
      excerpt: content.excerpt,
    };
  });
  return {
    subject: digestSubject(rows.length),
    element: createElement(Digest, {
      count: rows.length,
      items,
      url: digestLink(
        rows.map((row) => row.event.kind),
        ctx.siteUrl,
      ),
      manageUrl: links.manage,
      siteUrl: ctx.siteUrl,
    }),
  };
}

export type RenderedEmail = { subject: string; html: string; text: string };

/** The message for a group under `ctx.mode` — `single` renders `rows[0]`, `digest` the whole group. */
export async function renderEmail(
  rows: RecipientRow[],
  ctx: DeliverContext,
): Promise<RenderedEmail> {
  const first = rows[0];
  if (first === undefined) throw new Error('renderEmail: empty group');
  const message =
    ctx.mode === 'digest' ? buildDigestEmail(rows, ctx) : buildSingleEmail(first, ctx);
  const html = await render(message.element);
  const text = await render(message.element, { plainText: true });
  return { subject: message.subject, html, text };
}

function errorText(error: unknown): string {
  return clipRecipientError(error instanceof Error ? error.message : String(error));
}

/**
 * 04 N3 — the email deliverer. `single`: one render + one send per row, sequential; `digest`: one
 * render + one send for the group. Rows without an address answer `not_configured` (N7).
 */
export const deliverEmail: Deliverer = async (rows, ctx) => {
  const result: DeliverResult = { sent: [], failed: [] };
  if (rows.length === 0) return result;

  if (env.RESEND_API_KEY === undefined) {
    for (const row of rows) result.failed.push({ id: row.id, error: NOT_CONFIGURED });
    return result;
  }
  const resend = createResend({ env });

  const groups: RecipientRow[][] = ctx.mode === 'digest' ? [rows] : rows.map((row) => [row]);
  for (const group of groups) {
    const first = group[0];
    if (first === undefined) continue;
    if (first.address === null || first.address === '') {
      for (const row of group) result.failed.push({ id: row.id, error: NOT_CONFIGURED });
      continue;
    }
    try {
      const mail = await renderEmail(group, ctx);
      await resend.sendEmail({
        to: first.address,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        headers: { 'X-Entity-Ref-ID': first.id },
      });
      for (const row of group) result.sent.push(row.id);
    } catch (error) {
      const text = errorText(error);
      for (const row of group) result.failed.push({ id: row.id, error: text });
    }
  }
  return result;
};
