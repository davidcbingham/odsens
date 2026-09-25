/**
 * components/seen-on/MentionPreview.draft.ts — the pure half of the `MentionPreview` island (03 §2.8
 * `MentionPreview`; 04 §1.6 `createMentionInput`; 00 S1.8 risk note "manual fields"; ADR-0045). A
 * plain module (no directive, no React, no zod — the `components/admin/savedMessages.ts` precedent)
 * so the island stays markup + state and `tests/unit/mention-preview-draft.test.ts` can cover every
 * rule without a DOM.
 *
 * What lives here:
 *   MentionDraft · EMPTY_DRAFT          the editable text behind the manual fields (strings — what
 *                                       the inputs hold; parsed only when PUBLISH is pressed)
 *   guessPlatform                       client-safe twin of the 04 §4.4 hostname map
 *                                       (`detectPlatform`, `lib/adapters/oembed.ts` — that module
 *                                       reads `node:dns`, so it can never reach a client bundle);
 *                                       only seeds the platform `Select` after an unreadable page
 *   draftForUrl · draftFromPreview      the two ways a draft starts
 *   previewIsComplete                   a fetched preview without a title or a creator name cannot
 *                                       be published as is (both are required, 1..200 / 1..80) →
 *                                       the island opens the manual fields instead of the card
 *   buildCreateMentionInput             draft (+ the fetched preview) → the 04 §1.6 payload, or the
 *                                       plain-words field errors for the two values only the
 *                                       client can parse (the date, the view count)
 *   fetchErrors · publishErrors         `ActionError` → where its words go (03 C-30: inline, beside
 *                                       the thing that failed; never a toast)
 *
 * Payload rules (04 §1.6; `lib/actions/mentions.schema.ts`):
 * - `status: 'published'` and `featured: false` are ALWAYS sent — the schema's default is `draft`,
 *   and a draft never reaches a public page (00 S1.8.AC2).
 * - Optional keys are omitted, never `null` (create marks them optional, not nullable).
 * - `url` = the preview's `canonical_url` when a page was read, else what the admin pasted.
 * - `external_id` / `thumbnail_url` ride along only while the draft still names the platform the
 *   preview found — an id fetched for one platform means nothing on another.
 * - A fetched `creator_url` / `thumbnail_url` the 04 §1.4 shared `URL` rule would refuse (not https,
 *   over 512 characters — common for Open Graph images) is dropped when the draft is seeded, so
 *   PUBLISH never fails on a value the admin did not type. Non-YouTube thumbnails are never
 *   rendered anyway (ADR-0002 #33).
 * - The date field holds a UTC day (`YYYY-MM-DD`, `formatDay`); an untouched date keeps the
 *   preview's exact timestamp, a typed one becomes midnight UTC of that day.
 */
import type { CreateMentionInput, MentionPreviewData } from '@/lib/actions/mentions.schema';
import type { ActionError } from '@/lib/actions/result';
import { formatDay } from '@/lib/format/date';
import type { MentionPlatform } from '@/lib/mentions';

/** What the manual fields hold — text, exactly as typed. */
export type MentionDraft = {
  platform: MentionPlatform;
  title: string;
  creatorName: string;
  /** Optional — `''` = none. */
  creatorUrl: string;
  /** Optional UTC day, `YYYY-MM-DD` — `''` = unknown. */
  date: string;
  /** Optional whole number as text — `''` = unknown (never "0 views" by accident). */
  views: string;
};

/** The manual fields a server issue can land on, by 04 §1.6 key. */
export type DraftFieldKey =
  'title' | 'creator_name' | 'creator_url' | 'published_at' | 'view_count';

/** Inline errors of the publish form: one per field, the link, and one general line. */
export type PublishErrors = Partial<Record<DraftFieldKey | 'url' | 'line', string>>;

export const NO_ERRORS: PublishErrors = {};

export const EMPTY_DRAFT: MentionDraft = {
  platform: 'other',
  title: '',
  creatorName: '',
  creatorUrl: '',
  date: '',
  views: '',
};

/** Same words as `mentionUrlSchema` (04 SC-02) — said here so an empty field costs no round trip. */
export const PASTE_A_LINK = 'Paste a link.';
export const DATE_MESSAGE = 'Dates look like 2026-06-14.';
/** Same words as the schema's `view_count` rule. */
export const VIEWS_MESSAGE = 'Views are a whole number, 0 or more.';

/** 04 §1.4 shared `URL`: https only, ≤ 512. */
const STORED_URL_MAX = 512;

/** 04 §4.4 hostname map (`PLATFORM_DOMAINS`, `lib/adapters/oembed.ts`) — parity is unit-tested. */
const PLATFORM_DOMAINS: readonly (readonly [string, MentionPlatform])[] = [
  ['youtube.com', 'youtube'],
  ['youtu.be', 'youtube'],
  ['tiktok.com', 'tiktok'],
  ['twitch.tv', 'twitch'],
  ['reddit.com', 'reddit'],
  ['redd.it', 'reddit'],
];

const DRAFT_FIELD_KEYS: ReadonlySet<string> = new Set<DraftFieldKey>([
  'title',
  'creator_name',
  'creator_url',
  'published_at',
  'view_count',
]);

/**
 * The platform a pasted link most likely is: a listed domain matches itself and its subdomains on a
 * dot boundary; anything else — another host, another scheme, not a URL — is `article` (never
 * `other`, as in the adapter). Only a starting value for the platform `Select`; the admin's pick
 * is what is published.
 */
export function guessPlatform(url: string): MentionPlatform {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return 'article';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'article';
  let host = parsed.hostname;
  while (host.endsWith('.')) host = host.slice(0, -1);
  for (const [domain, platform] of PLATFORM_DOMAINS) {
    if (host === domain || host.endsWith(`.${domain}`)) return platform;
  }
  return 'article';
}

/** True when the 04 §1.4 shared `URL` rule would accept it. */
function isStorableUrl(value: string | null): value is string {
  return value !== null && value.startsWith('https://') && value.length <= STORED_URL_MAX;
}

/** `YYYY-MM-DD` of a parseable timestamp, else `''`. */
function dayOf(value: string | null): string {
  if (value === null) return '';
  const time = Date.parse(value);
  return Number.isNaN(time) ? '' : formatDay(new Date(time));
}

/** A draft for a page that could not be read: empty fields, the platform guessed from the link. */
export function draftForUrl(url: string): MentionDraft {
  return { ...EMPTY_DRAFT, platform: guessPlatform(url) };
}

/** A draft seeded from what `fetchMentionPreview` found — the "Edit fields" starting point. */
export function draftFromPreview(preview: MentionPreviewData): MentionDraft {
  const views = preview.view_count;
  return {
    platform: preview.platform,
    title: preview.title,
    creatorName: preview.creator_name ?? '',
    creatorUrl: isStorableUrl(preview.creator_url) ? preview.creator_url : '',
    date: dayOf(preview.published_at),
    views: views !== null && Number.isSafeInteger(views) && views >= 0 ? String(views) : '',
  };
}

/** Title and creator are required on create; a preview missing either opens the manual fields. */
export function previewIsComplete(preview: MentionPreviewData): boolean {
  return preview.title.trim() !== '' && (preview.creator_name ?? '').trim() !== '';
}

/** `YYYY-MM-DD` → that UTC midnight as ISO; `null` for anything that is not a real calendar day. */
function isoFromDay(day: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const time = Date.parse(`${day}T00:00:00.000Z`);
  if (Number.isNaN(time)) return null;
  const date = new Date(time);
  // `2026-02-31` parses (as 3 March) — a day that does not read back is not a day.
  return formatDay(date) === day ? date.toISOString() : null;
}

export type BuildCreateMentionArgs = {
  /** The link field, as typed. */
  url: string;
  /** What the fetch found; `null` when the page could not be read (manual from scratch). */
  preview: MentionPreviewData | null;
  draft: MentionDraft;
  /** The "Assign to" value: a project id, or `''` = "About OddSense generally". */
  projectId: string;
};

export type BuildCreateMentionResult =
  { ok: true; input: CreateMentionInput } | { ok: false; errors: PublishErrors };

/**
 * The PUBLISH payload (see the header for the rules). Only the link, the date and the view count
 * are checked here — they are the values the client has to parse; everything else is the server's
 * to refuse, in its own words, and `publishErrors` puts those words on the right field.
 */
export function buildCreateMentionInput({
  url,
  preview,
  draft,
  projectId,
}: BuildCreateMentionArgs): BuildCreateMentionResult {
  const errors: PublishErrors = {};

  const link = preview?.canonical_url ?? url.trim();
  if (link === '') errors.url = PASTE_A_LINK;

  let publishedAt: string | undefined;
  const day = draft.date.trim();
  if (day !== '') {
    const typed = isoFromDay(day);
    if (typed === null) errors.published_at = DATE_MESSAGE;
    else if (preview !== null && dayOf(preview.published_at) === day) {
      // Untouched: keep the platform's exact moment, normalised to the ISO form the schema reads.
      publishedAt = new Date(Date.parse(preview.published_at ?? typed)).toISOString();
    } else publishedAt = typed;
  }

  let viewCount: number | undefined;
  const views = draft.views.trim();
  if (views !== '') {
    const parsed = /^\d+$/.test(views) ? Number(views) : Number.NaN;
    if (Number.isSafeInteger(parsed)) viewCount = parsed;
    else errors.view_count = VIEWS_MESSAGE;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const samePlatform = preview !== null && preview.platform === draft.platform;
  const creatorUrl = draft.creatorUrl.trim();
  const input: CreateMentionInput = {
    url: link,
    project_id: projectId === '' ? null : projectId,
    platform: draft.platform,
    title: draft.title.trim(),
    creator_name: draft.creatorName.trim(),
    status: 'published',
    featured: false,
    ...(samePlatform && preview.external_id !== null ? { external_id: preview.external_id } : {}),
    ...(creatorUrl !== '' ? { creator_url: creatorUrl } : {}),
    ...(samePlatform && isStorableUrl(preview.thumbnail_url)
      ? { thumbnail_url: preview.thumbnail_url }
      : {}),
    ...(publishedAt !== undefined ? { published_at: publishedAt } : {}),
    ...(viewCount !== undefined ? { view_count: viewCount } : {}),
  };
  return { ok: true, input };
}

/** First issue message per path, in issue order. */
function firstMessages(error: ActionError): Map<string, string> {
  const byPath = new Map<string, string>();
  for (const issue of error.issues ?? []) {
    if (!byPath.has(issue.path)) byPath.set(issue.path, issue.message);
  }
  return byPath;
}

/**
 * A failed `fetchMentionPreview`: `validation` is about the link itself (04 §1.6 — not a link, not
 * http(s), carries credentials, too long), so its words go on the link field and filling the
 * fields by hand would not help. Everything else — `upstream_error` above all, with the 04
 * message verbatim — is the `error` state: the line, then the manual fields.
 */
export function fetchErrors(error: ActionError): { url: string } | { line: string } {
  if (error.code === 'validation') {
    return { url: firstMessages(error).get('url') ?? error.message };
  }
  return { line: error.message };
}

/**
 * A failed `createMention`: `conflict` (the link is already on the list) belongs to the link field;
 * `validation` issues land on their own field; a path with no field on screen (`project_id`,
 * `external_id`, `thumbnail_url`, the union's `''`) and every other code read on the one line by
 * the button.
 */
export function publishErrors(error: ActionError): PublishErrors {
  if (error.code === 'conflict') return { url: error.message };
  if (error.code !== 'validation') return { line: error.message };

  const errors: PublishErrors = {};
  for (const [path, message] of firstMessages(error)) {
    if (path === 'url' || DRAFT_FIELD_KEYS.has(path))
      errors[path as DraftFieldKey | 'url'] = message;
    else errors.line ??= message;
  }
  return Object.keys(errors).length > 0 ? errors : { line: error.message };
}

/** True when any of the errors sits on a manual field (so the fields must be on screen). */
export function hasFieldError(errors: PublishErrors): boolean {
  return Object.keys(errors).some((key) => DRAFT_FIELD_KEYS.has(key));
}
