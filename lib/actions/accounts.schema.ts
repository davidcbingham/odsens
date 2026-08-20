/**
 * lib/actions/accounts.schema.ts — the `<actionName>Input` zod schemas for `lib/actions/accounts.ts`
 * (04 SC-02; 01 INV-18).
 *
 * Why a sibling file: Next 16 compiles a `'use server'` module so that ONLY async functions may be
 * exported from it ("Only async functions are allowed to be exported in a 'use server' file"), so the
 * schemas cannot live in `accounts.ts` itself. This plain module has no directive and is importable
 * from tests (05 T-ACT-0 (2)) and from the actions file. Messages are plain words (DESIGN.md §7);
 * structural handle reasons come from the RPC path via `handleReason` (see `accounts.ts`).
 *
 * `handleSchema` (01 INV-49 / 05 T-UNIT-1) lives here rather than in `lib/validation/handle.ts` because
 * that module is reached from the `HandleField` client island and must stay zod-free (ADR-0008
 * Decision 3). It refines on the pure `validateHandle()`, so the copy has one source of truth.
 */
import { z } from 'zod';
import { validateHandle } from '@/lib/validation/handle';

/** H1 + H3 as a zod string with the same plain-words messages as `handleReason` (one source of truth). */
export const handleSchema = z.string().superRefine((value, ctx) => {
  const check = validateHandle(value);
  if (!check.ok) ctx.addIssue({ code: 'custom', message: check.reason });
});

/** A real `File` (from `FormData` or a typed call). */
export const fileSchema = z.custom<File>((value) => value instanceof File, {
  error: "That file didn't upload. Try again.",
});

export const checkHandleInput = z.object({
  handle: z
    .string({ error: 'Type a handle.' })
    .max(64, { error: 'Too long. 20 characters maximum.' }),
});
export type CheckHandleInput = { handle: string };

export const completeOnboardingInput = z.object({
  handle: z.string({ error: 'Pick a handle.' }),
  avatar: fileSchema.optional(),
});
export type CompleteOnboardingInput = { handle: string; avatar?: File };

const booleanish = z.preprocess((value) => value === 'true' || value === true, z.boolean());

export const updateProfileInput = z
  .object({
    handle: z.string({ error: 'Type a handle.' }).optional(),
    avatar: fileSchema.optional(),
    removeAvatar: booleanish.optional(),
  })
  .refine(
    (value) =>
      value.handle !== undefined || value.avatar !== undefined || value.removeAvatar === true,
    { error: 'Nothing to save.' },
  );
export type UpdateProfileInput = { handle?: string; avatar?: File; removeAvatar?: boolean };

export const deleteAccountInput = z.object({
  confirm: z.literal(true, { error: 'Confirm first.' }),
});
export type DeleteAccountInput = { confirm: true };
