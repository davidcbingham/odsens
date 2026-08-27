/**
 * lib/actions/admin.schema.ts — the `<actionName>Input` zod schema for `lib/actions/admin.ts`
 * (04 SC-02; 04 §1.7 input cell verbatim; ADR-0013).
 *
 * `triggerSyncInput.source` is the five triggerable sources — `notify` is not triggerable here
 * (04 §1.7: the Test button covers Discord; email is exercised by real events) and `skins` is a
 * `sync_runs` source with no standalone job, so both fall to `validation` (05 T-ACT-42). `full` is
 * only meaningful for `youtube` (walk the uploads playlist) — `full: true` on any other source is
 * rejected (05 T-ACT-42 "`full:true` accepted only for `youtube`").
 */
import { z } from 'zod';

export const triggerSyncInput = z
  .object({
    source: z.enum(['modrinth', 'curseforge', 'youtube', 'mentions', 'stats'], {
      error: 'Pick a sync source.',
    }),
    full: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.full === true && value.source !== 'youtube') {
      ctx.addIssue({
        code: 'custom',
        path: ['full'],
        message: 'A full sync is only for YouTube.',
      });
    }
  });

export type TriggerSyncInput = {
  source: 'modrinth' | 'curseforge' | 'youtube' | 'mentions' | 'stats';
  full?: boolean;
};
