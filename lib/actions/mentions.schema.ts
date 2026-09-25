/**
 * lib/actions/mentions.schema.ts — the `<actionName>Input` zod schemas for `lib/actions/mentions.ts`
 * (04 SC-02; 04 §1.6 `fetchMentionPreview` / `createMention` / `updateMention` Input cells;
 * ADR-0013 — a `'use server'` module may export only async functions, so the schemas, the input
 * types and the result shapes live in this plain sibling; ADR-0002 C7; ADR-0045).
 *
 * `url` (all three start here): the 04 §1.6 rules are SCHEMA rules, so a bad link is `validation`
 * before anything is resolved or requested (05 T-ACT-62: `javascript:` / `file:` / userinfo →
 * `validation`) — parseable, ≤ 2048, scheme `http:` / `https:` only, no credentials, and `http:`
 * upgraded to `https:` (`readMentionUrl`, `lib/validation/mention-url.ts`). The parsed value is the
 * normalised href of what was pasted — NOT the canonical form: `fetchMentionPreview` reads the
 * page the admin pasted, and `createMention` canonicalises in the action (`canonicalMentionUrl`),
 * where the `conflict` answer lives. `assertPublicHost` repeats scheme + credentials as defence in
 * depth (04 §4.4).
 *
 * `createMentionInput` — 04 §1.6 verbatim: `project_id` is REQUIRED and nullable (`null` = "About
 * OddSense generally"); `status` ∈ draft | published, default draft; `featured` required; the
 * optional keys are absent-or-valued (never `null`). Text is trimmed; `title` 1..200,
 * `creator_name` 1..80, `external_id` 1..64 — the `mentions` CHECKs. `creator_url` /
 * `thumbnail_url` are the 04 §1.4 shared `URL` (https, ≤ 512). A `youtube` row's `external_id` must
 * be an 11-char video id (the `mentions_youtube_external_id_format` CHECK — refused here, in words,
 * instead of as a constraint error). `sort_order` is bounded to the column's `integer` range.
 *
 * `updateMentionInput` — either form (04 §1.6; the `curateProjectInput` union precedent):
 *   `{ id, patch }`   every create key EXCEPT `url`, all optional, AT LEAST ONE present; the keys
 *                     that are optional on create may also be `null` = clear the stored value (the
 *                     `updateExclusiveProjectInput` precedent), so "present" means `!== undefined`.
 *                     `patch.status` ∈ draft | published | hidden — `suggested` is unreachable
 *                     from both schemas (nothing in v1 writes it; Approve in S2.4 =
 *                     `patch.status = 'published'`). Whether a patched `external_id` fits the
 *                     row's platform needs the stored row — the action's check.
 *   `{ reorder }`     1..200 `{ id, sort_order }` pairs, each id once (one transaction — RPC
 *                     `reorder_mentions`).
 * A value that fits neither form fails the union as ONE issue with path `''` (zod reports no
 * per-branch paths) — the `curateProject` behaviour.
 *
 * Unknown keys are stripped (zod default, like every other schema here). Messages are plain words
 * (04 SC-02; DESIGN.md §7) — they surface verbatim as `issues[].message`. The input TYPES are
 * hand-written (the repo idiom — islands `import type` them, zod never ships: ADR-0008 D3) and
 * pinned to the schemas by `tests/unit/mentions-schema.test.ts`.
 */
import { z } from 'zod';
import { YOUTUBE_ID_RE } from '@/lib/actions/videos.schema';
import { MENTION_PLATFORMS, type MentionPlatform } from '@/lib/mentions';
import type { Database } from '@/lib/supabase/types';
import {
  MENTION_URL_MAX,
  readMentionUrl,
  type MentionUrlProblem,
} from '@/lib/validation/mention-url';

/** 04 §1.6 `updateMentionInput`: "`reorder` … max 200" (= `ADMIN_MENTIONS_LIMIT`, `lib/data/admin.ts`). */
export const MENTION_REORDER_MAX = 200;

/** `mentions.sort_order` is a Postgres `integer`. */
const INT4_MIN = -2_147_483_648;
const INT4_MAX = 2_147_483_647;

const PASTE_A_LINK = 'Paste a link.';
const URL_MESSAGES: Record<MentionUrlProblem, string> = {
  unparseable: "That doesn't look like a link.",
  too_long: `Too long. ${MENTION_URL_MAX} characters maximum.`,
  scheme: 'Links start with https://.',
  credentials: "Links can't carry a username or password.",
};

/** 04 §1.6 / data-model §2.3b `mention_platform`. */
export const MENTION_PLATFORM = z.enum(MENTION_PLATFORMS, { error: 'Pick a platform.' });

/** 04 §1.6 `url` (see the header): validates, then hands on the https href of what was pasted. */
export const mentionUrlSchema = z
  .string({ error: PASTE_A_LINK })
  .trim()
  .min(1, { error: PASTE_A_LINK })
  .transform((value, ctx) => {
    const result = readMentionUrl(value);
    if (result.ok) return result.url;
    ctx.addIssue({ code: 'custom', message: URL_MESSAGES[result.problem] });
    return z.NEVER;
  });

/** 04 §1.4 shared: `URL` — https only, ≤ 512 (module-private in `projects.schema.ts`; same rules). */
const httpsUrlSchema = z
  .url({ error: 'Needs to be a full https:// link.' })
  .startsWith('https://', { error: 'Links start with https://.' })
  .max(512, { error: 'Too long. 512 characters maximum.' });

const mentionIdSchema = z.uuid({ error: 'Pick a mention.' });
const projectIdSchema = z.uuid({ error: 'Pick a project.' });

/** `mentions_external_id_length`: 1..64. */
const EXTERNAL_ID_MAX = 64;

const externalIdSchema = z
  .string({ error: 'Type the id.' })
  .trim()
  .min(1, { error: 'Type the id.' })
  .max(EXTERNAL_ID_MAX, { error: `Too long. ${EXTERNAL_ID_MAX} characters maximum.` });

const titleSchema = z
  .string({ error: 'Type a title.' })
  .trim()
  .min(1, { error: 'Type a title.' })
  .max(200, { error: 'Too long. 200 characters maximum.' });

const creatorNameSchema = z
  .string({ error: "Type the creator's name." })
  .trim()
  .min(1, { error: "Type the creator's name." })
  .max(80, { error: 'Too long. 80 characters maximum.' });

const publishedAtSchema = z.iso.datetime({ offset: true, error: 'Dates are ISO timestamps.' });

const VIEWS_MESSAGE = 'Views are a whole number, 0 or more.';
const viewCountSchema = z
  .number({ error: VIEWS_MESSAGE })
  .int({ error: VIEWS_MESSAGE })
  .min(0, { error: VIEWS_MESSAGE });

const ORDER_MESSAGE = 'Order is a whole number.';
const sortOrderSchema = z
  .number({ error: ORDER_MESSAGE })
  .int({ error: ORDER_MESSAGE })
  .min(INT4_MIN, { error: ORDER_MESSAGE })
  .max(INT4_MAX, { error: ORDER_MESSAGE });

const featuredSchema = z.boolean({ error: 'Featured is on or off.' });

/** One source for the words: `updateMention` says them too, about the STORED half of the pair. */
export const NOT_A_YOUTUBE_ID = "That isn't a YouTube video id.";

/**
 * The `mentions_youtube_external_id_format` CHECK, in words — only when both keys are in hand, and
 * only for an id that passed its own 1..64 rule (one problem, one issue).
 */
function refineYoutubeId(
  value: { platform?: MentionPlatform; external_id?: string | null },
  ctx: z.core.$RefinementCtx,
): void {
  if (value.platform !== 'youtube' || typeof value.external_id !== 'string') return;
  const id = value.external_id;
  if (id.length >= 1 && id.length <= EXTERNAL_ID_MAX && !YOUTUBE_ID_RE.test(id)) {
    ctx.addIssue({ code: 'custom', path: ['external_id'], message: NOT_A_YOUTUBE_ID });
  }
}

export const fetchMentionPreviewInput = z.object({ url: mentionUrlSchema });

export const createMentionInput = z
  .object({
    url: mentionUrlSchema,
    project_id: projectIdSchema.nullable(),
    platform: MENTION_PLATFORM,
    external_id: externalIdSchema.optional(),
    title: titleSchema,
    creator_name: creatorNameSchema,
    creator_url: httpsUrlSchema.optional(),
    thumbnail_url: httpsUrlSchema.optional(),
    published_at: publishedAtSchema.optional(),
    view_count: viewCountSchema.optional(),
    status: z.enum(['draft', 'published'], { error: 'Pick draft or published.' }).default('draft'),
    featured: featuredSchema,
    sort_order: sortOrderSchema.optional(),
  })
  .superRefine(refineYoutubeId);

const mentionPatchSchema = z
  .object({
    project_id: projectIdSchema.nullable().optional(),
    platform: MENTION_PLATFORM.optional(),
    external_id: externalIdSchema.nullable().optional(),
    title: titleSchema.optional(),
    creator_name: creatorNameSchema.optional(),
    creator_url: httpsUrlSchema.nullable().optional(),
    thumbnail_url: httpsUrlSchema.nullable().optional(),
    published_at: publishedAtSchema.nullable().optional(),
    view_count: viewCountSchema.nullable().optional(),
    status: z
      .enum(['draft', 'published', 'hidden'], { error: 'Pick draft, published or hidden.' })
      .optional(),
    featured: featuredSchema.optional(),
    sort_order: sortOrderSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (Object.values(value).every((entry) => entry === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'Nothing to change.' });
    }
    refineYoutubeId(value, ctx);
  });

const updateMentionPatch = z.object({ id: mentionIdSchema, patch: mentionPatchSchema });

const updateMentionReorder = z.object({
  reorder: z
    .array(z.object({ id: mentionIdSchema, sort_order: sortOrderSchema }))
    .min(1, { error: 'Nothing to reorder.' })
    .max(MENTION_REORDER_MAX, { error: `${MENTION_REORDER_MAX} mentions maximum.` })
    .superRefine((items, ctx) => {
      const seen = new Set<string>();
      items.forEach((item, index) => {
        const id = item.id.toLowerCase();
        if (seen.has(id)) {
          ctx.addIssue({ code: 'custom', path: [index, 'id'], message: 'Each mention once.' });
        }
        seen.add(id);
      });
    }),
});

export const updateMentionInput = z.union([updateMentionReorder, updateMentionPatch]);

// ---- Input types (what callers pass — hand-written; pinned to `z.input` by the unit test) ------

export type FetchMentionPreviewInput = { url: string };

export type CreateMentionInput = {
  url: string;
  /** `null` = "About OddSense generally". */
  project_id: string | null;
  platform: MentionPlatform;
  external_id?: string;
  title: string;
  creator_name: string;
  creator_url?: string;
  thumbnail_url?: string;
  published_at?: string;
  view_count?: number;
  /** Default `draft` — the PUBLISH button sends `published` explicitly. */
  status?: 'draft' | 'published';
  featured: boolean;
  sort_order?: number;
};

/** `null` clears a stored optional value; an absent key keeps it. At least one key. */
export type MentionPatch = {
  project_id?: string | null;
  platform?: MentionPlatform;
  external_id?: string | null;
  title?: string;
  creator_name?: string;
  creator_url?: string | null;
  thumbnail_url?: string | null;
  published_at?: string | null;
  view_count?: number | null;
  status?: 'draft' | 'published' | 'hidden';
  featured?: boolean;
  sort_order?: number;
};

export type UpdateMentionPatchInput = { id: string; patch: MentionPatch };
export type UpdateMentionReorderInput = { reorder: { id: string; sort_order: number }[] };
export type UpdateMentionInput = UpdateMentionReorderInput | UpdateMentionPatchInput;

// ---- Parsed values (what the action body receives from `runAction`) ---------------------------

export type FetchMentionPreviewValues = z.output<typeof fetchMentionPreviewInput>;
export type CreateMentionValues = z.output<typeof createMentionInput>;
export type UpdateMentionValues = z.output<typeof updateMentionInput>;

// ---- Result shapes (04 §1.6 Returns cells) ----------------------------------------------------

/** One `mentions` row as stored — what `createMention` / `updateMention({id, patch})` return. */
export type MentionRow = Database['public']['Tables']['mentions']['Row'];

/**
 * `fetchMentionPreview` data — exactly these ten keys (05 T-ACT-62). `source` = the highest step of
 * the 04 §5.4 chain that answered: `data_api` when the Data API returned the video, else `oembed`,
 * else `og` (ADR-0045). `thumbnail_url` is https or `null`; a non-YouTube one is stored but never
 * rendered (ADR-0002 #33).
 */
export type MentionPreviewData = {
  platform: MentionPlatform;
  external_id: string | null;
  canonical_url: string;
  title: string;
  creator_name: string | null;
  creator_url: string | null;
  thumbnail_url: string | null;
  published_at: string | null;
  view_count: number | null;
  source: 'oembed' | 'data_api' | 'og';
};

export type CreateMentionData = { mention: MentionRow };
export type UpdateMentionData = { mention: MentionRow } | { reordered: number };
