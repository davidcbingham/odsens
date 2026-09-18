/**
 * lib/actions/videos.schema.ts — the `<actionName>Input` zod schema for `lib/actions/videos.ts`
 * (04 SC-02; 04 §1.8 `updateVideo` Input cell verbatim; ADR-0013 — a `'use server'` module may
 * export only async functions, so the schema, its regex and its input type live in this plain
 * sibling; ADR-0002 #20 / C7).
 *
 * `updateVideoInput` = `{youtube_id: /^[A-Za-z0-9_-]{11}$/, hidden?: boolean, is_short?: boolean |
 * null}` with AT LEAST ONE of `hidden` / `is_short` present (04 §1.8). `is_short` is tri-state on
 * purpose (ADR-0043 D1): `true` / `false` = Oliver's override, `null` = clear the override so the
 * 04 §5.3 heuristic applies again — so "present" means `!== undefined`, and `null` counts as
 * present. `YOUTUBE_ID_RE` is the same rule the table enforces (`videos_youtube_id_format`,
 * migration 20260918120000). Unknown keys are stripped (zod default, like every other schema here).
 * Messages are plain words (04 SC-02; DESIGN.md §7) — they surface verbatim as `issues[].message`.
 */
import { z } from 'zod';

/** 04 §1.8 verbatim: a YouTube video id is exactly 11 URL-safe base64 characters. */
export const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

const PICK_A_VIDEO = 'Pick a video.';

export const updateVideoInput = z
  .object({
    youtube_id: z.string({ error: PICK_A_VIDEO }).regex(YOUTUBE_ID_RE, { error: PICK_A_VIDEO }),
    hidden: z.boolean({ error: 'Hidden is on or off.' }).optional(),
    is_short: z.boolean({ error: 'Short is on, off or automatic.' }).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.hidden === undefined && value.is_short === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['hidden'],
        message: 'Nothing to change.',
      });
    }
  });

export type UpdateVideoInput = {
  youtube_id: string;
  hidden?: boolean;
  /** `true` / `false` = override; `null` = clear the override (ADR-0043 D1). */
  is_short?: boolean | null;
};
