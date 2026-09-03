/**
 * lib/actions/comments.schema.ts — the `<actionName>Input` zod schemas for `lib/actions/comments.ts`
 * (04 SC-02; 04 §1.2 input cells; 01 INV-18; ADR-0013 — a `'use server'` module may export only
 * async functions, so the schemas live in this sibling and tests import them from here).
 *
 * `TARGET` is `z.literal('project')` in v1 (04 §1.2 shared definitions; ADR-0002 C21): the DB
 * column keeps four values, the schema accepts one — a non-project target fails parsing →
 * `validation` (05 T-ACT-15). `commentBodySchema` is the zod face of the zod-free `validateBody()`
 * in `lib/validation/comment.ts` (ADR-0008 D3 / ADR-0028 D5): it strips HTML, trims and bounds the
 * length (B1/B2) and yields the normalized body; the link rule (B3) is answered by the action so
 * it can return the distinct code `too_many_links` (04 §7) instead of a generic `validation`.
 * Messages are plain words (DESIGN.md §7).
 */
import { z } from 'zod';
import { normalizeBody, validateBody } from '@/lib/validation/comment';

const uuid = (what: string) => z.uuid({ error: `Pick a ${what}.` });

/** 04 §1.2 shared definition — v1 accepts only `project`. */
export const TARGET = z.object({
  target_type: z.literal('project', { error: 'Comments live on projects.' }),
  target_id: uuid('project'),
});

/**
 * B1 + B2 (strip → trim → 1..1000 code points), yielding the normalized body. A link overflow
 * passes the schema on purpose — the action answers the distinct code `too_many_links` (B3).
 */
export const commentBodySchema = z.string({ error: 'Type a comment.' }).transform((raw, ctx) => {
  const body = normalizeBody(raw);
  const check = validateBody(raw);
  if (!check.ok && check.code === 'validation') {
    ctx.addIssue({ code: 'custom', message: check.message });
    return z.NEVER;
  }
  return body;
});

export const postCommentInput = TARGET.extend({
  body: commentBodySchema,
  parent_id: uuid('comment').optional(),
});
export type PostCommentInput = {
  target_type: 'project';
  target_id: string;
  body: string;
  parent_id?: string;
};

export const editCommentInput = z.object({
  comment_id: uuid('comment'),
  body: commentBodySchema,
});
export type EditCommentInput = { comment_id: string; body: string };

export const deleteCommentInput = z.object({ comment_id: uuid('comment') });
export type DeleteCommentInput = { comment_id: string };

export const toggleLikeInput = z.object({ comment_id: uuid('comment') });
export type ToggleLikeInput = { comment_id: string };

export const REPORT_REASONS = ['spam', 'rude', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

const optionalNote = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().max(300, { error: 'Keep the note under 300 characters.' }).optional(),
);

export const reportCommentInput = z.object({
  comment_id: uuid('comment'),
  reason: z.enum(REPORT_REASONS, { error: 'Pick a reason.' }),
  note: optionalNote,
});
export type ReportCommentInput = { comment_id: string; reason: ReportReason; note?: string };

export const MODERATE_ACTIONS = ['approve', 'hide', 'unhide', 'delete'] as const;

export const moderateCommentInput = z.object({
  comment_id: uuid('comment'),
  action: z.enum(MODERATE_ACTIONS, { error: 'Pick an action.' }),
});
export type ModerateCommentInput = {
  comment_id: string;
  action: (typeof MODERATE_ACTIONS)[number];
};

/** `'true'`/`'false'` FormData strings coerce; anything else reaches zod and fails `validation`. */
const strictBoolean = z.preprocess(
  (value) => (value === 'true' ? true : value === 'false' ? false : value),
  z.boolean({ error: 'Say banned or not.' }),
);

export const banUserInput = z.object({
  profile_id: uuid('person'),
  banned: strictBoolean,
  reason: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().max(200, { error: 'Keep the reason under 200 characters.' }).optional(),
  ),
});
export type BanUserInput = { profile_id: string; banned: boolean; reason?: string };

/**
 * `handle` is a plain string here on purpose (the `completeOnboarding` / `updateProfile` precedent):
 * 04 §1.2 has RPC `check_handle` decide `handle_taken` / `handle_reserved` / `validation` in that
 * order (05 T-ACT-67) — a zod-level H3 check would turn every reserved name into `validation`.
 */
export const renameUserHandleInput = z.object({
  profile_id: uuid('person'),
  handle: z
    .string({ error: 'Pick a handle.' })
    .max(64, { error: 'Too long. 20 characters maximum.' }),
});
export type RenameUserHandleInput = { profile_id: string; handle: string };
