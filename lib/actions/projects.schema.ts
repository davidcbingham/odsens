/**
 * lib/actions/projects.schema.ts — the `<actionName>Input` zod schemas for `lib/actions/projects.ts`
 * (04 SC-02; 04 §1.4 input cells verbatim; ADR-0013).
 *
 * Why a sibling file: a `'use server'` module may export only async functions (see
 * `accounts.schema.ts`), so the schemas live in this plain module — importable from tests and from
 * the actions file. Messages are plain words (DESIGN.md §7), never zod internals (04 SC-02).
 *
 * `curateProjectInput` is the 04 §1.4 either/or: the batch `reorder` shape (ADR-0002 A11) or the
 * per-project override shape. The `extra_gallery.path` prefix rule needs `project_id` from the same
 * input, so it is a `superRefine` on the per-project object; the "object exists in the bucket" half
 * (HEAD check) needs I/O and lives in the action. `setProjectLinkInput.ref` reuses the adapter's
 * pure `parseRef` (04 §1.4 grammar: digits or CurseForge URL) so the grammar has one source of truth.
 */
import { z } from 'zod';
import { parseRef } from '@/lib/adapters/curseforge';

/** 04 §1.4: `featured_order` is an int 1..99 (both shapes). */
const featuredOrderSchema = z
  .number({ error: 'Order is a number from 1 to 99.' })
  .int({ error: 'Order is a whole number.' })
  .min(1, { error: 'Order is a number from 1 to 99.' })
  .max(99, { error: 'Order is a number from 1 to 99.' });

const projectIdSchema = z.uuid({ error: 'Pick a project.' });

/** 04 §1.4 batch shape (ADR-0002 A11): one call, one transaction, one revalidate. */
const curateProjectReorder = z.object({
  reorder: z
    .array(
      z.object({
        project_id: projectIdSchema,
        featured_order: featuredOrderSchema,
      }),
    )
    .max(99, { error: '99 projects maximum.' }),
});

const extraGalleryEntry = z.object({
  path: z.string({ error: 'Pick an image.' }),
  title: z.string().max(120, { error: 'Too long. 120 characters maximum.' }).optional(),
  description: z.string().max(500, { error: 'Too long. 500 characters maximum.' }).optional(),
  ordering: z
    .number({ error: 'Order is a whole number.' })
    .int({ error: 'Order is a whole number.' }),
});

/** 04 §1.4: every path is `project-media/<this project_id>/gallery/<name>.(png|jpg|webp)`. */
const galleryPathPattern = (projectId: string): RegExp =>
  new RegExp(`^project-media/${projectId}/gallery/[A-Za-z0-9._-]+\\.(png|jpg|webp)$`);

/** 04 §1.4 per-project shape — every field beyond `project_id` optional (partial override upsert). */
const curateProjectOverride = z
  .object({
    project_id: projectIdSchema,
    featured: z.boolean().optional(),
    featured_order: featuredOrderSchema.nullable().optional(),
    hidden: z.boolean().optional(),
    title_override: z
      .string()
      .min(1, { error: 'Type a title.' })
      .max(80, { error: 'Too long. 80 characters maximum.' })
      .nullable()
      .optional(),
    description_override: z
      .string()
      .min(1, { error: 'Type a description.' })
      .max(256, { error: 'Too long. 256 characters maximum.' })
      .nullable()
      .optional(),
    extra_gallery: z.array(extraGalleryEntry).max(20, { error: '20 images maximum.' }).optional(),
    notes_md: z
      .string()
      .max(20000, { error: 'Too long. 20000 characters maximum.' })
      .nullable()
      .optional(),
    comments_enabled: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.extra_gallery === undefined) return;
    const pattern = galleryPathPattern(value.project_id);
    value.extra_gallery.forEach((entry, index) => {
      if (!pattern.test(entry.path)) {
        ctx.addIssue({
          code: 'custom',
          path: ['extra_gallery', index, 'path'],
          message: "That image isn't in this project's gallery folder.",
        });
      }
    });
  });

export const curateProjectInput = z.union([curateProjectReorder, curateProjectOverride]);

export type CurateProjectReorderInput = {
  reorder: { project_id: string; featured_order: number }[];
};
export type CurateProjectOverrideInput = {
  project_id: string;
  featured?: boolean;
  featured_order?: number | null;
  hidden?: boolean;
  title_override?: string | null;
  description_override?: string | null;
  extra_gallery?: { path: string; title?: string; description?: string; ordering: number }[];
  notes_md?: string | null;
  comments_enabled?: boolean;
};
export type CurateProjectInput = CurateProjectReorderInput | CurateProjectOverrideInput;

export const setProjectLinkInput = z
  .object({
    project_id: projectIdSchema,
    platform: z.literal('curseforge', { error: 'Only CurseForge links are supported.' }),
    ref: z.string().max(300, { error: 'Too long. 300 characters maximum.' }).nullable(),
  })
  .superRefine((value, ctx) => {
    // 04 §1.4 grammar via the adapter's pure `parseRef`; `null` removes the link and is always valid.
    if (value.ref !== null && parseRef(value.ref) === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['ref'],
        message: 'Use a CurseForge id or project URL.',
      });
    }
  });

export type SetProjectLinkInput = {
  project_id: string;
  platform: 'curseforge';
  ref: string | null;
};
