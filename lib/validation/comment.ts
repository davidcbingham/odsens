/**
 * lib/validation/comment.ts — comment body rules B1–B6 (04 §1.2 "Body rules"; 01 INV-66;
 * ADR-0002 C16), the plain-text renderer `linkify()` and the composer copy `commentErrorLine()`
 * (05 T-UNIT-4, 5, 40; DESIGN.md §11.2 "Composer error").
 *
 * Plain, client-safe module — NO zod, no server-only imports (ADR-0008 D3): the comment islands
 * (`Composer`, `Comment`, `CommentThread`) import it, so anything here ships to the browser. The zod
 * form `commentBodySchema` lives in `lib/actions/comments.schema.ts` and refines on `validateBody()`
 * below, so the rules and their copy have one source of truth (the `handleSchema` precedent —
 * ADR-0028 D5).
 *
 * Rules: B1 strip HTML tags (`/<[^>]*>/g` → ''; a `<script>` element goes with its contents —
 * 05 T-UNIT-5) then trim · B2 1..1000 code points after B1 ·
 * B3 ≤ 1 link, counted with `/(https?:\/\/[^\s]+|www\.[^\s]+)/gi` (`countLinks`) · B4 stored as
 * plain text · rendering auto-linkifies with `linkify()` (never `lib/markdown.ts`, which is
 * server-only) · B6 copy per DESIGN.md §11.2 ("That didn't post. Too many links.").
 *
 * Copy (04 §7 owner + DESIGN.md §11.2): every code a comment action can return maps to ONE plain
 * line for the composer; the rule "1000 characters, one link." is printed beside POST at all times.
 */
import { createElement, type ReactNode } from 'react';

/** B2 — code points after B1. */
export const BODY_MAX = 1000;
/** B3 — links per comment. */
export const MAX_LINKS = 1;
/** B3 — the 04 §1.2 link pattern, verbatim. */
export const LINK_RE = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;

/** Printed beside POST (DESIGN.md §11.2 "the rule restated beside POST"). */
export const COMPOSER_RULE = '1000 characters, one link.';

export const LINE_DID_NOT_POST = "That didn't post.";
export const LINE_TOO_MANY_LINKS = "That didn't post. Too many links.";
export const LINE_RATE_LIMITED = 'Slow down a little.';
export const LINE_COMMENTS_CLOSED = 'Comments are off for this one.';
export const LINE_BANNED = "You can't comment here.";
export const LINE_EDIT_WINDOW = 'Edits close after 15 minutes.';
export const LINE_FORBIDDEN = 'Not allowed.';
export const LINE_NOT_FOUND = 'That comment is gone.';
export const LINE_CONFLICT = 'That already happened.';
export const LINE_SIGN_IN = 'Sign in first.';
export const LINE_ONBOARDING = 'Pick a handle first.';
export const LINE_INTERNAL = "That didn't post. Try again?";

/** A `<script>` element goes with its contents — script text is never a comment (05 T-UNIT-5). */
const SCRIPT_BLOCK_RE = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi;

/**
 * B1 — every tag becomes nothing (`/<[^>]*>/g`, 04 §1.2); a `<script>` element loses its contents
 * too (`<script>alert(1)</script>x` → `x`, 05 T-UNIT-5); entities are left as text.
 */
export function stripHtml(raw: string): string {
  return raw.replace(SCRIPT_BLOCK_RE, '').replace(/<[^>]*>/g, '');
}

/** B1 in full: strip, then trim. */
export function normalizeBody(raw: string): string {
  return stripHtml(raw).trim();
}

/** Code points, not UTF-16 units — an emoji counts as one (05 T-UNIT-4). */
export function codePointLength(text: string): number {
  return Array.from(text).length;
}

/** B3 — `http://a`, `https://a`, `www.a.b` count; `a.com/x` and `1.5` do not. */
export function countLinks(text: string): number {
  return (text.match(LINK_RE) ?? []).length;
}

export type BodyCheck =
  | { ok: true; body: string }
  | { ok: false; code: 'validation' | 'too_many_links'; message: string };

/**
 * The pure B1–B3 check with the composer copy: empty / too long → `validation`
 * ("That didn't post." — the rule sits beside POST), two links → `too_many_links`. The action
 * returns the same codes (04 §1.2 postComment / editComment Errors).
 */
export function validateBody(raw: string): BodyCheck {
  const body = normalizeBody(raw);
  if (body === '' || codePointLength(body) > BODY_MAX) {
    return { ok: false, code: 'validation', message: LINE_DID_NOT_POST };
  }
  if (countLinks(body) > MAX_LINKS) {
    return { ok: false, code: 'too_many_links', message: LINE_TOO_MANY_LINKS };
  }
  return { ok: true, body };
}

/** Punctuation a sentence leaves after a URL — kept as text, never inside the href. */
const TRAILING_PUNCTUATION = /[.,;:!?)\]]+$/;

/**
 * Plain text → React nodes with `<a>` for each B3 link (01 INV-66). Only `http(s)://` and
 * `www.` matches exist, so a `javascript:` or `data:` href can never be produced; every link gets
 * `rel="noopener noreferrer nofollow ugc" target="_blank"` (same attributes as INV-65 links).
 */
export function linkify(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = new RegExp(LINK_RE.source, 'gi');
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(re)) {
    const start = match.index ?? 0;
    const raw = match[0];
    const trailing = TRAILING_PUNCTUATION.exec(raw)?.[0] ?? '';
    const url = trailing ? raw.slice(0, raw.length - trailing.length) : raw;
    if (start > last) nodes.push(text.slice(last, start));
    const href = /^www\./i.test(url) ? `https://${url}` : url;
    nodes.push(
      createElement(
        'a',
        {
          key: `l${key}`,
          href,
          rel: 'noopener noreferrer nofollow ugc',
          target: '_blank',
        },
        url,
      ),
    );
    if (trailing) nodes.push(trailing);
    last = start + raw.length;
    key += 1;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** Every code the comment actions can return (04 §1.2 Errors ∪ §7) → one plain line. */
const ERROR_LINES: Readonly<Record<string, string>> = {
  too_many_links: LINE_TOO_MANY_LINKS,
  validation: LINE_DID_NOT_POST,
  rate_limited: LINE_RATE_LIMITED,
  comments_closed: LINE_COMMENTS_CLOSED,
  banned: LINE_BANNED,
  edit_window_expired: LINE_EDIT_WINDOW,
  forbidden: LINE_FORBIDDEN,
  not_found: LINE_NOT_FOUND,
  conflict: LINE_CONFLICT,
  unauthenticated: LINE_SIGN_IN,
  onboarding_required: LINE_ONBOARDING,
  internal: LINE_INTERNAL,
};

/** The line under the composer for an action error code; an unknown code reads as `internal`. */
export function commentErrorLine(code: string): string {
  return ERROR_LINES[code] ?? LINE_INTERNAL;
}
