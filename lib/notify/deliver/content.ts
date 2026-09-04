/**
 * lib/notify/deliver/content.ts — the pure event → words/links mapping both deliverers share
 * (04 §3.7 N5 subjects/links, N6 embed words; §1.2 comment payloads `{comment_id, target_*, excerpt,
 * author, first_time, reason, report_count}`; J-F `{source, run_id, error, started_at}`; J-S
 * `{source, last_ok_at, hours_since_ok}` — ADR-0030 D3; DESIGN.md §12.1 "The allay" / "Discord
 * embed"; docs/notifications.md §Character; 05 T-ADP-19).
 *
 * No I/O, no `server-only`: `describeEvent(event, siteUrl, now)` reads the stored payload and
 * answers one `EventContent` — the target title + link, the excerpt (already ≤ 140 code points from
 * `postComment`, clipped again defensively), the author handle (a scrubbed `{profile_id: null,
 * handle: null}` reads "a deleted account" — ADR-0030 D4), report meta, and the sync run words.
 * Dates are formatted through `lib/format/date.ts` only (01 INV-93). A payload that lacks its
 * target words (an event emitted before the title was known) falls back to plain words and the
 * admin links — `notifyDeliver` hydrates `target_title` / `target_slug` from `projects_public`
 * before rendering when it can. A sync source with no ok run at all answers `runAt: ''` — the
 * templates read that as "No good run yet." and the Discord line as "<Source> counts haven't
 * updated yet." (ADR-0030 D19: never the word "never").
 *
 * `stripLinks(text)` is the 03 E-05 "links stripped" rule applied at the source: every comment
 * excerpt loses its URLs (the 04 §1.2 B3 pattern, `lib/validation/comment.ts` `LINK_RE`) before
 * either channel quotes it, so the Discord description and the mail read the same words (04 N6);
 * the templates run their own copy as a second line of defence.
 *
 * `escapeDiscordMarkdown(text)` is the one place untrusted text (a comment excerpt, a handle, an
 * upstream error) is made safe for a Discord embed description: Discord renders markdown there —
 * masked links `[text](url)`, spoilers, code, emphasis, quotes — so every metacharacter is
 * backslash-escaped before interpolation (security gate, S1.5 build pass). Pure; the deliverer
 * applies it, the mail templates rely on React's HTML escaping instead.
 */
import { relativeTime } from '@/lib/format/date';
import type { Json } from '@/lib/supabase/types';
import { LINK_RE } from '@/lib/validation/comment';
import type { EventView } from './types';

/** 04 N6 / DESIGN.md §12.1 event words — the embed title's left half and the digest list label. */
export const EVENT_LABELS: Readonly<Record<string, string>> = {
  'comment.new': 'New comment',
  'comment.held': 'Held for review',
  'comment.reported': 'Reported comment',
  'sync.failed': 'Sync failed',
  'sync.stale': 'Sync stale',
};

/** `sync_runs.source` → display name (mirrors `emails/components/shared.tsx` `sourceLabel`). */
const SOURCE_LABELS: Readonly<Record<string, string>> = {
  modrinth: 'Modrinth',
  curseforge: 'CurseForge',
  youtube: 'YouTube',
  mentions: 'Mentions',
  notify: 'Notify',
};

/** docs/notifications.md §Character — the allay's sync lines (verbatim, shared with the templates). */
export const ALLAY_EMPTY_HANDED = "The allay came back empty-handed. It'll keep trying.";
export const ALLAY_NOTHING_ON_FIRE =
  'The site keeps showing the last good numbers. Nothing is on fire.';

/** ADR-0030 D4 — a scrubbed reference renders as this. */
export const DELETED_ACCOUNT = 'a deleted account';

/** When a comment payload carries no target words at all. */
const FALLBACK_TITLE = 'odsens';

/** Discord description excerpt cap (04 N6 `excerpt(200)`). */
export const DISCORD_EXCERPT_LENGTH = 200;

export type EventContent = {
  kind: string;
  /** `EVENT_LABELS[kind]` (falls back to the kind itself). */
  label: string;
  /** The target title (project) or `<Source> sync` for a sync event — the subject / h1 words. */
  title: string;
  /** A comment's excerpt; empty for sync events. */
  excerpt: string;
  /** The author handle; `null` = "a deleted account" (ADR-0030 D4). */
  handle: string | null;
  firstTime: boolean;
  reportCount: number;
  reasons: string[];
  /** Sync events only. */
  source: string | null;
  error: string | null;
  stale: boolean;
  /** Relative run time, already formatted (`4 min ago`, `yesterday`); `''` = no such run. */
  runAt: string;
  hoursSinceOk: number | undefined;
  /** The project page (`/projects/<slug>`), else the admin comments queue. */
  projectUrl: string;
  /** The comment on the site (`…#comments`), else the admin comments queue. */
  commentUrl: string;
  /** The "View" target per kind: comment → the site; held/reported → `/admin/comments`; sync → `/admin`. */
  link: string;
};

export type SiteLinks = { admin: string; adminComments: string; manage: string };

/** The three admin links every deliverer needs (04 N5 footer, N2 digest link, N6 View). */
export function siteLinks(siteUrl: string): SiteLinks {
  const base = siteUrl.replace(/\/+$/, '');
  return {
    admin: `${base}/admin`,
    adminComments: `${base}/admin/comments`,
    manage: `${base}/admin/settings`,
  };
}

type JsonObject = { [key: string]: Json | undefined };

function asObject(value: Json | undefined): JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
}

function asString(value: Json | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

function asNumber(value: Json | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function codePointLength(text: string): number {
  return Array.from(text).length;
}

/** Clips to `max` code points INCLUDING the ellipsis (the 04 §1.2 excerpt rule, reused for Discord). */
export function clipExcerpt(text: string, max: number): string {
  if (codePointLength(text) <= max) return text;
  return `${Array.from(text)
    .slice(0, max - 1)
    .join('')}…`;
}

/**
 * 03 E-05 / 04 N6: URLs (the B3 pattern) are removed from an excerpt before it is quoted anywhere;
 * leftover space runs collapse to one and the ends are trimmed. A link-only excerpt becomes ''.
 */
export function stripLinks(text: string): string {
  return text
    .replace(new RegExp(LINK_RE.source, 'gi'), '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function sourceLabel(source: string | null): string {
  if (source === null || source === '') return 'Sync';
  return SOURCE_LABELS[source] ?? source.charAt(0).toUpperCase() + source.slice(1);
}

export function eventLabel(kind: string): string {
  return EVENT_LABELS[kind] ?? kind;
}

export function isSyncKind(kind: string): boolean {
  return kind === 'sync.failed' || kind === 'sync.stale';
}

/** The words a mail or embed is built from — see the file header. */
export function describeEvent(event: EventView, siteUrl: string, now: Date): EventContent {
  const links = siteLinks(siteUrl);
  const payload = asObject(event.payload);
  const kind = event.kind;
  const label = eventLabel(kind);

  if (isSyncKind(kind)) {
    const source = asString(payload.source);
    const stale = kind === 'sync.stale';
    const at = stale ? asString(payload.last_ok_at) : asString(payload.started_at);
    const hours = asNumber(payload.hours_since_ok);
    // `''` = no run to date from (a stale source with no ok run, or an unparseable date) — the
    // templates drop the run line and say "No good run yet." (ADR-0030 D19).
    let runAt: string;
    try {
      runAt =
        at === null ? (stale ? '' : relativeTime(event.created_at, now)) : relativeTime(at, now);
    } catch {
      runAt = '';
    }
    return {
      kind,
      label,
      title: `${sourceLabel(source)} sync`,
      excerpt: '',
      handle: null,
      firstTime: false,
      reportCount: 0,
      reasons: [],
      source,
      error: asString(payload.error),
      stale,
      runAt,
      hoursSinceOk: hours === null ? undefined : hours,
      projectUrl: links.admin,
      commentUrl: links.admin,
      link: links.admin,
    };
  }

  const slug = asString(payload.target_slug);
  const title = asString(payload.target_title) ?? FALLBACK_TITLE;
  const projectUrl =
    slug === null ? links.adminComments : `${siteUrl.replace(/\/+$/, '')}/projects/${slug}`;
  const commentUrl = slug === null ? links.adminComments : `${projectUrl}#comments`;
  const author = asObject(payload.author);
  const handle = asString(author.handle);
  const reason = asString(payload.reason);
  const reportCount = asNumber(payload.report_count) ?? 0;
  return {
    kind,
    label,
    title,
    excerpt: stripLinks(asString(payload.excerpt) ?? ''),
    handle: handle === '' ? null : handle,
    firstTime: payload.first_time === true,
    reportCount,
    // `comment.held` stores `reason: 'first_time' | 'reports'` (why it was held), not a report reason.
    reasons: kind === 'comment.reported' && reason !== null ? [reason] : [],
    source: null,
    error: null,
    stale: false,
    runAt: '',
    hoursSinceOk: undefined,
    projectUrl,
    commentUrl,
    link: kind === 'comment.new' ? commentUrl : links.adminComments,
  };
}

/**
 * Discord markdown metacharacters — emphasis, code, spoilers, masked links, and the line-leading
 * quote/heading/list markers — each backslash-escaped so untrusted text renders literally in an
 * embed description (Discord consumes `\\` before any punctuation). Pure; idempotent on already
 * plain text.
 */
const DISCORD_MARKDOWN_CHARS = /[\\*_~`|>[\]()]/g;
const DISCORD_LINE_MARKERS = /^([ \t]*)([#-])/gm;

export function escapeDiscordMarkdown(text: string): string {
  return text
    .replace(DISCORD_MARKDOWN_CHARS, (char) => `\\${char}`)
    .replace(
      DISCORD_LINE_MARKERS,
      (_match, indent: string, marker: string) => `${indent}\\${marker}`,
    );
}

/** "@handle" for the embed; a scrubbed handle reads "a deleted account" (no `@`). */
export function handleWords(handle: string | null): string {
  return handle === null ? DELETED_ACCOUNT : `@${handle}`;
}

/** N2: `/admin/comments` when any row is a comment event, else `/admin` (sync only). */
export function digestLink(kinds: readonly string[], siteUrl: string): string {
  const links = siteLinks(siteUrl);
  return kinds.some((kind) => !isSyncKind(kind)) ? links.adminComments : links.admin;
}
