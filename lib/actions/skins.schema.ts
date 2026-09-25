/**
 * lib/actions/skins.schema.ts — the `<actionName>Input` zod schemas for `lib/actions/skins.ts`
 * (04 SC-02; 04 §1.5 `createSkin` / `updateSkin` Input cells as built — ADR-0048 D6 / D8; ADR-0013 —
 * a `'use server'` module may export only async functions, so the schemas, the input types and the
 * result shapes live in this plain sibling; ADR-0002 C7).
 *
 * `createSkinInput` — arrives as `FormData` from the `SkinForm` island (`runAction` converts: every
 * value a string except the `File`; an empty file input is dropped), so the numeric / boolean keys
 * are FORM-shaped here: `sort_order` coerces `'3'` → 3 (a whole number ≥ 0; blank / absent → 0),
 * `is_exclusive` reads `'true'` / `true` as on and anything else as off (absent → false — the
 * `updateProfileInput` `booleanish` precedent); `description_md` blank → absent (`undefined`).
 * `slug` = the 04 "Shared" `slugSchema` (regex + reserved list); `name` 1..60, `description_md`
 * ≤ 5000 — the `skins` CHECKs; `model` ∈ classic | slim; `status` ∈ draft | published, default
 * draft. `texture` is REQUIRED on create (a real `File` — the 64×64 / PNG / ≤ 64 KB rules need the
 * bytes and live in the action, ADR-0048 D7).
 *
 * `updateSkinInput` — either form (the `updateMentionInput` union precedent):
 *   `{ id, …patch }`   every create key optional, `texture` optional, AT LEAST ONE key besides
 *                      `id`; `description_md` may be `null` = clear (a blank string from a form
 *                      means the same — the admin emptied the field).
 *   `{ reorder }`      1..200 `{ id, sort_order }` pairs, each id once (one transaction — RPC
 *                      `reorder_skins`).
 * A value that fits neither form fails the union as ONE issue with path `''` — the `updateMention`
 * behaviour (05 T-ACT-64 pins it for mentions; the same zod).
 *
 * Unknown keys are stripped (zod default). Messages are plain words (04 SC-02; DESIGN.md §7). The
 * input TYPES are hand-written (islands `import type` them, zod never ships: ADR-0008 D3).
 */
import { z } from 'zod';
import { fileSchema } from '@/lib/actions/accounts.schema';
import type { Database } from '@/lib/supabase/types';
import { slugSchema } from '@/lib/validation/slug';

/** 04 §1.5 `updateSkinInput` `reorder` bound (= `ADMIN_SKINS_LIMIT`, `lib/data/admin.ts`). */
export const SKIN_REORDER_MAX = 200;

export const SKIN_NAME_MAX = 60;
export const SKIN_DESCRIPTION_MAX = 5000;

/** `skins.sort_order` is a Postgres `integer`. */
const INT4_MAX = 2_147_483_647;

/** 04 §1.5 / data-model §2.4 `skin_model`. */
export const SKIN_MODEL = z.enum(['classic', 'slim'], { error: 'Pick classic or slim.' });
export const SKIN_STATUS = z.enum(['draft', 'published'], { error: 'Pick draft or published.' });

const skinIdSchema = z.uuid({ error: 'Pick a skin.' });

const nameSchema = z
  .string({ error: 'Type a name.' })
  .trim()
  .min(1, { error: 'Type a name.' })
  .max(SKIN_NAME_MAX, { error: `Too long. ${SKIN_NAME_MAX} characters maximum.` });

const descriptionSchema = z
  .string({ error: 'Type the description.' })
  .max(SKIN_DESCRIPTION_MAX, { error: `Too long. ${SKIN_DESCRIPTION_MAX} characters maximum.` });

/** A blank textarea is "no description": `''` / whitespace → `undefined` (create), else the text. */
const blankToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

/** On update a blank textarea CLEARS the stored text: `''` / whitespace → `null`. */
const blankToNull = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? null : value;

const ORDER_MESSAGE = 'Order is a whole number, 0 or more.';

/**
 * `'3'` → 3 (FormData), a number stays, blank / absent → `undefined` (the key is "not sent");
 * then a whole number 0..int4. Create maps the absent value to 0, a patch leaves the column alone.
 */
const sortOrderFromForm = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return value;
    const text = value.trim();
    return text === '' ? undefined : Number(text);
  },
  z
    .number({ error: ORDER_MESSAGE })
    .int({ error: ORDER_MESSAGE })
    .min(0, { error: ORDER_MESSAGE })
    .max(INT4_MAX, { error: ORDER_MESSAGE })
    .optional(),
);

/** `'true'` / `true` → on; anything else → off; absent stays absent (create maps it to false). */
const booleanish = z.preprocess(
  (value) => (value === undefined ? undefined : value === 'true' || value === true),
  z.boolean({ error: 'Exclusive is on or off.' }).optional(),
);

export const createSkinInput = z.object({
  slug: slugSchema,
  name: nameSchema,
  description_md: z.preprocess(blankToUndefined, descriptionSchema.optional()),
  model: SKIN_MODEL,
  is_exclusive: booleanish.transform((value) => value ?? false),
  status: SKIN_STATUS.default('draft'),
  sort_order: sortOrderFromForm.transform((value) => value ?? 0),
  texture: fileSchema,
});

const skinPatchSchema = z
  .object({
    id: skinIdSchema,
    slug: slugSchema.optional(),
    name: nameSchema.optional(),
    description_md: z.preprocess(blankToNull, descriptionSchema.nullable().optional()),
    model: SKIN_MODEL.optional(),
    is_exclusive: booleanish,
    status: SKIN_STATUS.optional(),
    sort_order: sortOrderFromForm,
    texture: fileSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const patchKeys = Object.entries(value).filter(([key]) => key !== 'id');
    if (patchKeys.every(([, entry]) => entry === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'Nothing to change.' });
    }
  });

const ORDER_INT_MESSAGE = 'Order is a whole number.';
const reorderSortOrderSchema = z
  .number({ error: ORDER_INT_MESSAGE })
  .int({ error: ORDER_INT_MESSAGE })
  .min(-INT4_MAX - 1, { error: ORDER_INT_MESSAGE })
  .max(INT4_MAX, { error: ORDER_INT_MESSAGE });

const updateSkinReorder = z.object({
  reorder: z
    .array(z.object({ id: skinIdSchema, sort_order: reorderSortOrderSchema }))
    .min(1, { error: 'Nothing to reorder.' })
    .max(SKIN_REORDER_MAX, { error: `${SKIN_REORDER_MAX} skins maximum.` })
    .superRefine((items, ctx) => {
      const seen = new Set<string>();
      items.forEach((item, index) => {
        const id = item.id.toLowerCase();
        if (seen.has(id)) {
          ctx.addIssue({ code: 'custom', path: [index, 'id'], message: 'Each skin once.' });
        }
        seen.add(id);
      });
    }),
});

export const updateSkinInput = z.union([updateSkinReorder, skinPatchSchema]);

// ---- Input types (what callers pass — hand-written) ---------------------------------------------

export type SkinModelInput = 'classic' | 'slim';
export type SkinStatusInput = 'draft' | 'published';

/** Also accepted as `FormData` with the same keys (strings + the `File`). */
export type CreateSkinInput = {
  slug: string;
  name: string;
  description_md?: string;
  model: SkinModelInput;
  /** Default false. */
  is_exclusive?: boolean;
  /** Default `draft`. */
  status?: SkinStatusInput;
  /** Whole number ≥ 0; default 0. */
  sort_order?: number;
  /** The 64×64 PNG, ≤ 64 KB (04 SC-18: inline). */
  texture: File;
};

/** `null` clears the description; an absent key keeps the stored value. At least one key besides `id`. */
export type UpdateSkinPatchInput = {
  id: string;
  slug?: string;
  name?: string;
  description_md?: string | null;
  model?: SkinModelInput;
  is_exclusive?: boolean;
  status?: SkinStatusInput;
  sort_order?: number;
  /** A replacement texture: same path, `render_bust_path` cleared and re-rendered. */
  texture?: File;
};
export type UpdateSkinReorderInput = { reorder: { id: string; sort_order: number }[] };
export type UpdateSkinInput = UpdateSkinReorderInput | UpdateSkinPatchInput;

// ---- Parsed values (what the action body receives from `runAction`) ---------------------------

export type CreateSkinValues = z.output<typeof createSkinInput>;
export type UpdateSkinValues = z.output<typeof updateSkinInput>;

// ---- Result shapes (04 §1.5 Returns cells) ----------------------------------------------------

/** One `skins` row as stored — what `createSkin` / `updateSkin({id, …})` return. */
export type SkinRow = Database['public']['Tables']['skins']['Row'];

/** `bust_rendered` = the row now carries a cached bust (`render_bust_path` set) — 04 §1.5 / §3.8. */
export type CreateSkinData = { skin: SkinRow; bust_rendered: boolean };
export type UpdateSkinData = { skin: SkinRow; bust_rendered: boolean } | { reordered: number };
