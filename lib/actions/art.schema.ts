/**
 * lib/actions/art.schema.ts — the `<actionName>Input` zod schemas for `lib/actions/art.ts`
 * (04 SC-02; 04 §1.4.5 two-phase pattern + §1.5 `createArt` / `updateArt` Input cells as built —
 * ADR-0048 D6 / D8; ADR-0013 — a `'use server'` module may export only async functions, so the
 * schemas, the input types and the result shapes live in this plain sibling; ADR-0002 C7).
 *
 * Both actions are phase-discriminated (the `uploadProjectMediaInput` precedent): `begin` declares
 * the upload (size cap + mime allow-list checked here, on the DECLARED values — the commit phase
 * re-validates the actual bytes), `commit` names the stored object and carries the metadata.
 * Size copy carries the actual numbers via `lib/validation/files.ts` `sizeLimitMessage` so the
 * `UploadWell` pre-check prints identical words (03 §2.10).
 *
 * Metadata (04 §1.5 verbatim): `slug` = the 04 "Shared" `slugSchema`; `title` 1..80; `kind` ∈
 * `ART_KINDS`; `year` optional — a whole number 2015..(this year + 1) — or `null`; `credit`
 * optional ≤ 40 of `[A-Za-z0-9_ .-]` (a HANDLE, never a real name — the helper copy says so) or
 * `null`; `downloadable` reads `'true'` / `true` as on (default off); `status` ∈ draft | published
 * (default draft); `sort_order` a whole number (int4; default 0). `width` / `height` are NEVER
 * input: the commit derives them from the bytes (unknown keys are stripped — a client-supplied
 * pair is simply ignored, T-ACT-60).
 *
 * `updateArtInput` — three forms: `{ phase:'begin', id, … }` (a pending path under the EXISTING
 * id), `{ phase:'commit', id, path?, …patch }` (at least one key besides `id` / `phase`; `path` =
 * a replacement image, validated / moved like a create, the old object deleted after the
 * ownership check), `{ reorder }` (1..200 pairs, each id once — RPC `reorder_art`).
 *
 * Messages are plain words (04 SC-02; DESIGN.md §7). The input TYPES are hand-written (islands
 * `import type` them, zod never ships: ADR-0008 D3).
 */
import { z } from 'zod';
import { ART_KINDS } from '@/lib/art';
import type { Database } from '@/lib/supabase/types';
import { UPLOAD_KINDS, sizeLimitMessage, typeMessage } from '@/lib/validation/files';
import { slugSchema } from '@/lib/validation/slug';

/** `updateArtInput` `reorder` bound — 200 pairs a call (the `MENTION_REORDER_MAX` precedent; the ORDER list shows published rows only). */
export const ART_REORDER_MAX = 200;

export const ART_TITLE_MAX = 80;
export const ART_CREDIT_MAX = 40;
/** 04 §1.5: `year` 2015.. — the channel's first year. */
export const ART_YEAR_MIN = 2015;
/** 04 §1.5 `credit` grammar — a handle, never a real name. */
export const ART_CREDIT_RE = /^[A-Za-z0-9_ .-]*$/;

/** `art.sort_order` is a Postgres `integer`. */
const INT4_MIN = -2_147_483_648;
const INT4_MAX = 2_147_483_647;

/** 04 §1.5 / data-model §2.4 `art_kind`. */
export const ART_KIND = z.enum(ART_KINDS, { error: 'Pick a kind.' });
export const ART_STATUS = z.enum(['draft', 'published'], { error: 'Pick draft or published.' });

const artIdSchema = z.uuid({ error: 'Pick a piece.' });

/** A declared filename: non-empty, sane length (the stored name is content-addressed anyway). */
const filenameSchema = z
  .string({ error: 'Pick a file.' })
  .min(1, { error: 'Pick a file.' })
  .max(255, { error: 'That filename is too long.' });

/** A `begin`-returned path echoed back at commit (parsed strictly in the action, INV-53). */
const pathSchema = z
  .string({ error: 'Send the upload path back.' })
  .min(1, { error: 'Send the upload path back.' })
  .max(300, { error: "That path isn't one of ours." });

const artSizeSchema = z
  .number({ error: 'Say how big the file is.' })
  .int({ error: 'Size is a whole number of bytes.' })
  .min(1, { error: "That file is empty. There's nothing to upload." })
  .refine((size) => size <= UPLOAD_KINDS.art.maxBytes, {
    error: (issue) => sizeLimitMessage(issue.input as number, 'art'),
  });

const artMimeSchema = z.enum(['image/png', 'image/jpeg', 'image/webp'], {
  error: typeMessage(null, 'art'),
});

const titleSchema = z
  .string({ error: 'Type a title.' })
  .trim()
  .min(1, { error: 'Type a title.' })
  .max(ART_TITLE_MAX, { error: `Too long. ${ART_TITLE_MAX} characters maximum.` });

/** This year + 1 (UTC), read at parse time so the bound moves with the calendar. */
function maxYear(): number {
  return new Date().getUTCFullYear() + 1;
}

const YEAR_MESSAGE = `A year from ${ART_YEAR_MIN} to next year, or leave it empty.`;
const yearSchema = z
  .number({ error: YEAR_MESSAGE })
  .int({ error: YEAR_MESSAGE })
  .min(ART_YEAR_MIN, { error: YEAR_MESSAGE })
  .refine((year) => year <= maxYear(), { error: YEAR_MESSAGE });

const CREDIT_MESSAGE = 'A handle: letters, numbers, spaces, _ . - only. 40 characters maximum.';
const creditSchema = z
  .string({ error: CREDIT_MESSAGE })
  .trim()
  .max(ART_CREDIT_MAX, { error: CREDIT_MESSAGE })
  .regex(ART_CREDIT_RE, { error: CREDIT_MESSAGE });

const ORDER_MESSAGE = 'Order is a whole number.';
const sortOrderSchema = z
  .number({ error: ORDER_MESSAGE })
  .int({ error: ORDER_MESSAGE })
  .min(INT4_MIN, { error: ORDER_MESSAGE })
  .max(INT4_MAX, { error: ORDER_MESSAGE });

/** `'true'` / `true` → on; anything else → off; absent stays absent. */
const booleanish = z.preprocess(
  (value) => (value === undefined ? undefined : value === 'true' || value === true),
  z.boolean({ error: 'Downloadable is on or off.' }).optional(),
);

/** A blank optional text field means "none": `''` / whitespace → `null`. */
const blankToNull = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? null : value;

/** A blank year field means "none"; a numeric string (FormData) becomes a number. */
const yearFromForm = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  return text === '' ? null : Number(text);
};

// ---------------------------------------------------------------------------------------------
// createArt — bucket `art` (public-read), ≤ 10 MB, png/jpeg/webp (04 §1.5)
// ---------------------------------------------------------------------------------------------

const createArtBegin = z.object({
  phase: z.literal('begin'),
  filename: filenameSchema,
  size_bytes: artSizeSchema,
  mime: artMimeSchema,
});

const createArtCommit = z.object({
  phase: z.literal('commit'),
  path: pathSchema,
  slug: slugSchema,
  title: titleSchema,
  kind: ART_KIND,
  year: z.preprocess(yearFromForm, yearSchema.nullable().optional()),
  credit: z.preprocess(blankToNull, creditSchema.nullable().optional()),
  downloadable: booleanish.transform((value) => value ?? false),
  status: ART_STATUS.default('draft'),
  sort_order: sortOrderSchema.default(0),
});

export const createArtInput = z.discriminatedUnion('phase', [createArtBegin, createArtCommit]);

// ---------------------------------------------------------------------------------------------
// updateArt — begin (a replacement under the existing id) | commit (patch, optional path) | reorder
// ---------------------------------------------------------------------------------------------

const updateArtBegin = z.object({
  phase: z.literal('begin'),
  id: artIdSchema,
  filename: filenameSchema,
  size_bytes: artSizeSchema,
  mime: artMimeSchema,
});

const updateArtCommit = z
  .object({
    phase: z.literal('commit'),
    id: artIdSchema,
    path: pathSchema.optional(),
    slug: slugSchema.optional(),
    title: titleSchema.optional(),
    kind: ART_KIND.optional(),
    year: z.preprocess(yearFromForm, yearSchema.nullable().optional()),
    credit: z.preprocess(blankToNull, creditSchema.nullable().optional()),
    downloadable: booleanish,
    status: ART_STATUS.optional(),
    sort_order: sortOrderSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const patchKeys = Object.entries(value).filter(([key]) => key !== 'phase' && key !== 'id');
    if (patchKeys.every(([, entry]) => entry === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'Nothing to change.' });
    }
  });

const updateArtReorder = z.object({
  reorder: z
    .array(z.object({ id: artIdSchema, sort_order: sortOrderSchema }))
    .min(1, { error: 'Nothing to reorder.' })
    .max(ART_REORDER_MAX, { error: `${ART_REORDER_MAX} pieces maximum.` })
    .superRefine((items, ctx) => {
      const seen = new Set<string>();
      items.forEach((item, index) => {
        const id = item.id.toLowerCase();
        if (seen.has(id)) {
          ctx.addIssue({ code: 'custom', path: [index, 'id'], message: 'Each piece once.' });
        }
        seen.add(id);
      });
    }),
});

export const updateArtInput = z.union([
  updateArtReorder,
  z.discriminatedUnion('phase', [updateArtBegin, updateArtCommit]),
]);

// ---- Input types (what callers pass — hand-written) ---------------------------------------------

export type ArtKindInput = (typeof ART_KINDS)[number];
export type ArtStatusInput = 'draft' | 'published';
export type ArtMimeInput = 'image/png' | 'image/jpeg' | 'image/webp';

export type CreateArtBeginInput = {
  phase: 'begin';
  filename: string;
  size_bytes: number;
  mime: ArtMimeInput;
};
export type CreateArtCommitInput = {
  phase: 'commit';
  /** The `begin` path (or, on a retry after a slug conflict, the final path the first commit moved to). */
  path: string;
  slug: string;
  title: string;
  kind: ArtKindInput;
  /** 2015..next year; `null` / absent = not said. */
  year?: number | null;
  /** A handle, never a real name; `null` / absent = none. */
  credit?: string | null;
  /** Default false. */
  downloadable?: boolean;
  /** Default `draft`. */
  status?: ArtStatusInput;
  /** Default 0. */
  sort_order?: number;
};
export type CreateArtInput = CreateArtBeginInput | CreateArtCommitInput;

export type UpdateArtBeginInput = {
  phase: 'begin';
  id: string;
  filename: string;
  size_bytes: number;
  mime: ArtMimeInput;
};
/** `null` clears `year` / `credit`; an absent key keeps the stored value. At least one key besides `id`. */
export type UpdateArtCommitInput = {
  phase: 'commit';
  id: string;
  /** A replacement image's pending path (from an `updateArt` `begin` under this id). */
  path?: string;
  slug?: string;
  title?: string;
  kind?: ArtKindInput;
  year?: number | null;
  credit?: string | null;
  downloadable?: boolean;
  status?: ArtStatusInput;
  sort_order?: number;
};
export type UpdateArtReorderInput = { reorder: { id: string; sort_order: number }[] };
export type UpdateArtInput = UpdateArtReorderInput | UpdateArtBeginInput | UpdateArtCommitInput;

// ---- Parsed values (what the action body receives from `runAction`) ---------------------------

export type CreateArtValues = z.output<typeof createArtInput>;
export type UpdateArtValues = z.output<typeof updateArtInput>;

// ---- Result shapes (04 §1.5 Returns cells) ----------------------------------------------------

/** One `art` row as stored — what a commit returns. */
export type ArtRow = Database['public']['Tables']['art']['Row'];

export type SignedUploadData = { path: string; token: string; signed_url: string };
export type CreateArtData = SignedUploadData | { art: ArtRow };
export type UpdateArtData = SignedUploadData | { art: ArtRow } | { reordered: number };
