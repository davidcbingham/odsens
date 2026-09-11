/**
 * lib/actions/settings.schema.ts — the `<actionName>Input` zod schemas for `lib/actions/settings.ts`
 * (04 SC-02; 04 §1.3 input cells verbatim — `updateSettings`, `testDiscordWebhook`, `setUserRole`;
 * 05 T-UNIT-28 `discordWebhookUrlSchema`; ADR-0013 — a `'use server'` module may export only async
 * functions, so the schemas live in this plain sibling and tests import them from here).
 *
 * `updateSettingsInput` is a partial update: every key optional, an omitted key = unchanged.
 *   - `admin_notify_emails`: each entry trimmed + lowercased before the email check (≤ 254), the RAW
 *     list capped at 10 (05 §7.2 row "max 10 (11 → D)"), then de-duplicated in the output.
 *   - `discord_webhook_url`: the 04 §1.3 regex OR `''` (= clear); no trim — trailing whitespace fails
 *     (T-UNIT-28). `testDiscordWebhookInput.url` is the same regex WITHOUT the `''` branch.
 *   - `matrix`: v1 kinds only (`V1_MATRIX_KINDS`) — a COMING LATER kind → `validation`.
 * `setUserRoleInput.handle` is H1 only (`^[A-Za-z0-9_]{3,20}$`, `lib/validation/handle.ts`): NOT the H3
 * reserved list, because the seed admin's handle `oddsense` is itself reserved and must resolve.
 * Messages are plain words (DESIGN.md §7; never "invalid input", no error codes).
 */
import { z } from 'zod';
import { DELIVERY_CHANNELS, V1_MATRIX_KINDS } from '@/lib/notify/constants';
import {
  HANDLE_MAX,
  HANDLE_MIN,
  HANDLE_RE,
  REASON_AT_SIGN,
  REASON_CHARSET,
  REASON_TOO_LONG,
  REASON_TOO_SHORT,
} from '@/lib/validation/handle';

/** 04 §1.3 — verbatim; the discord adapter carries the same pattern (T-UNIT-28 asserts parity). */
export const DISCORD_WEBHOOK_URL_RE =
  /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/;

/** 04 §1.3 `kofi_page` — a Ko-fi page name, 1..40 of `[A-Za-z0-9_-]`. */
export const KOFI_PAGE_RE = /^[A-Za-z0-9_-]{1,40}$/;

export const ADMIN_EMAILS_MAX = 10;
export const EMAIL_MAX = 254;
export const ANNOUNCEMENT_MAX = 2000;

export const MODERATION_MODES = ['auto', 'hold_first_time'] as const;
export type ModerationMode = (typeof MODERATION_MODES)[number];

export const USER_ROLES = ['user', 'moderator', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

const WEBHOOK_MESSAGE = "That doesn't look like a Discord webhook URL.";

/** A set webhook URL (no `''`): what `testDiscordWebhook` accepts. */
export const discordWebhookUrlValue = z
  .string({ error: WEBHOOK_MESSAGE })
  .regex(DISCORD_WEBHOOK_URL_RE, { error: WEBHOOK_MESSAGE });

/** `updateSettings.discord_webhook_url` — the URL, or `''` to clear (T-UNIT-28). */
export const discordWebhookUrlSchema = discordWebhookUrlValue.or(z.literal(''));

/** One admin address: trim → lowercase → email shape ≤ 254 (04 §1.3 "lowercased"). */
export const adminEmailSchema = z
  .string({ error: 'Type an email address.' })
  .trim()
  .toLowerCase()
  .pipe(
    z
      .email({ error: "That doesn't look like an email address." })
      .max(EMAIL_MAX, { error: 'That email address is too long.' }),
  );

/** The list: raw length ≤ 10, then de-duplicated (order of first appearance kept). */
export const adminEmailsSchema = z
  .array(adminEmailSchema)
  .max(ADMIN_EMAILS_MAX, { error: 'Ten admin emails at most.' })
  .transform((list) => Array.from(new Set(list)));

export const kofiPageSchema = z
  .string({ error: 'Type a Ko-fi page name.' })
  .regex(KOFI_PAGE_RE, { error: 'Letters, numbers, - and _.' })
  .or(z.literal(''));

export const matrixWriteSchema = z.object({
  kind: z.enum(V1_MATRIX_KINDS, { error: "That row isn't switchable yet." }),
  channel: z.enum(DELIVERY_CHANNELS, { error: 'Pick email or Discord.' }),
  enabled: z.boolean({ error: 'Say on or off.' }),
});

export const updateSettingsInput = z.object({
  moderation_mode: z.enum(MODERATION_MODES, { error: 'Pick a moderation mode.' }).optional(),
  admin_notify_emails: adminEmailsSchema.optional(),
  discord_webhook_url: discordWebhookUrlSchema.optional(),
  kofi_page: kofiPageSchema.optional(),
  comments_closed_default: z.boolean({ error: 'Say on or off.' }).optional(),
  announcement_md: z
    .string({ error: 'Type an announcement.' })
    .max(ANNOUNCEMENT_MAX, { error: 'Keep the announcement under 2000 characters.' })
    .nullable()
    .optional(),
  matrix: z.array(matrixWriteSchema).optional(),
});

/** What callers send (before parsing — emails may still be mixed-case / duplicated). */
export type UpdateSettingsInput = {
  moderation_mode?: ModerationMode;
  admin_notify_emails?: string[];
  discord_webhook_url?: string;
  kofi_page?: string;
  comments_closed_default?: boolean;
  announcement_md?: string | null;
  matrix?: {
    kind: (typeof V1_MATRIX_KINDS)[number];
    channel: 'email' | 'discord';
    enabled: boolean;
  }[];
};

/** What the action works with after `updateSettingsInput.parse` (emails normalised + unique). */
export type UpdateSettingsData = z.output<typeof updateSettingsInput>;

export const testDiscordWebhookInput = z.object({
  url: discordWebhookUrlValue.optional(),
});
export type TestDiscordWebhookInput = { url?: string };

/** H1 with the `handleReason` copy, minus H3 (see the header). */
export const roleHandleSchema = z.string({ error: 'Type a handle.' }).superRefine((value, ctx) => {
  const reason = value.includes('@')
    ? REASON_AT_SIGN
    : value.length < HANDLE_MIN
      ? REASON_TOO_SHORT
      : value.length > HANDLE_MAX
        ? REASON_TOO_LONG
        : HANDLE_RE.test(value)
          ? null
          : REASON_CHARSET;
  if (reason !== null) ctx.addIssue({ code: 'custom', message: reason });
});

export const setUserRoleInput = z.object({
  handle: roleHandleSchema,
  role: z.enum(USER_ROLES, { error: 'Pick a role.' }),
});
export type SetUserRoleInput = { handle: string; role: UserRole };
