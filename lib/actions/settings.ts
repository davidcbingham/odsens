'use server';
/**
 * lib/actions/settings.ts — `updateSettings`, `testDiscordWebhook`, `setUserRole` (04 §1.3 — every
 * cell; SC-02..SC-08, SC-15, SC-24, SC-25; §5.5 `discord_test`; 02 §2.8 + §5 (`settings` tag only);
 * 00 S1.5.AC2/AC3/AC4/AC11; 01 INV-43 / INV-70; ADR-0002 C2 / C7 / C9; ADR-0013; ADR-0030 D5 / D12 /
 * D14; 05 T-ACT-25..28, T-ACT-66, T-ACT-69).
 *
 * Every action = `return runAction(name, schema, input, fn)` (never throws to the client). Order
 * inside each `fn`: `requireRole('admin')` (the whole route is admin-only — ADR-0002 C2/C7; a
 * moderator answers `forbidden`) → I/O preconditions → rate limit (`testDiscordWebhook` only, right
 * before the outbound call — a call rejected by a precondition records no hit) → writes through the
 * SERVICE client (04 SC-06 — only after the role check; RLS would also let an admin JWT through, the
 * DB is the second gate) → `revalidateTag('settings', 'max')` (updateSettings only, once, and only
 * when something was written — 02 §5 owns the tag set: `settings`, never `projects`) → SC-24 keys-only
 * audit line → `ok`.
 *
 * The Discord webhook URL is a secret (04 §4.6; 01 INV-43): it is never returned to the client (the
 * result carries `discord_webhook_set` + `discord_webhook_tail` = `secretTail(url)`, the raw last 4 —
 * `maskSecret(tail)` renders the same `…<last 4>` the page shows), never logged (SC-24 `fields` are
 * keys only; `lib/log.ts` also redacts webhook-shaped values), and never echoed in an error message
 * (`createDiscord` masks it in every thrown `AdapterError`).
 *
 * Input schemas live in `./settings.schema.ts` (a `'use server'` module may export only async
 * functions — ADR-0013); the pure matrix helpers in `lib/notify/*` / `lib/data/admin.ts`.
 */
import { revalidateTag } from 'next/cache';
import { fail, ok, type ActionResult } from '@/lib/actions/result';
import { runAction, type ActionContext } from '@/lib/actions/run';
import {
  setUserRoleInput,
  testDiscordWebhookInput,
  updateSettingsInput,
  type ModerationMode,
  type SetUserRoleInput,
  type TestDiscordWebhookInput,
  type UpdateSettingsData,
  type UpdateSettingsInput,
  type UserRole,
} from '@/lib/actions/settings.schema';
import { AdapterError } from '@/lib/adapters/http';
import { DISCORD_COLORS, createDiscord } from '@/lib/adapters/discord';
import { requireRole } from '@/lib/auth';
import { sortMatrixEntries } from '@/lib/data/admin';
import { env } from '@/lib/env';
import { secretTail } from '@/lib/format/secret';
import { log } from '@/lib/log';
import type { MatrixEntry } from '@/lib/notify/matrix';
import { assertRateLimit } from '@/lib/rate-limit';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/types';

type AdminClient = ReturnType<typeof createAdminClient>;
type SiteSettingsPatch = Database['public']['Tables']['site_settings']['Update'];

const SETTINGS_ROW_ID = 1;
const TAG_SETTINGS = 'settings';

const NOT_FOUND_PROFILE = "That account doesn't exist.";
const LINE_OWN_ROLE = "You can't change your own role.";
const LINE_LAST_ADMIN = 'Someone has to stay admin.';
const LINE_BANNED_TARGET = 'Unban that account first.';
const LINE_NO_WEBHOOK = 'Add a webhook URL first.';
const LINE_DISCORD_NO_ANSWER = "Discord didn't answer.";

/** 04 §1.3 `testDiscordWebhook` Effects — the embed, verbatim (title · description · INDIGO). */
const TEST_EMBED_TITLE = 'Test — odsens';
const TEST_EMBED_DESCRIPTION = 'The allay says hi.';

/** What `updateSettings` returns — the `site_settings` row minus the secret (04 §1.3 Returns). */
export type SettingsView = {
  moderation_mode: ModerationMode;
  admin_notify_emails: string[];
  kofi_page: string | null;
  comments_closed_default: boolean;
  announcement_md: string | null;
  discord_webhook_set: boolean;
  /** `secretTail(url)` — the raw last 4 characters, `null` when unset (`maskSecret(tail)` = the UI string). */
  discord_webhook_tail: string | null;
};

export type UpdateSettingsResult = { settings: SettingsView; matrix: MatrixEntry[] };

// ---------------------------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------------------------

/** SC-24: keys-only audit line, logged before every `ok:true` return of a `requireRole` action. */
function logAdmin(
  action: string,
  ctx: ActionContext,
  actorId: string,
  target: { type: string; id: string | null },
  input: object,
): void {
  log.info({
    action,
    id: ctx.id,
    msg: 'admin',
    meta: {
      actor_profile_id: actorId,
      target_type: target.type,
      target_id: target.id,
      fields: Object.keys(input),
    },
  });
}

const SETTINGS_COLUMNS =
  'moderation_mode, admin_notify_emails, discord_webhook_url, kofi_page, comments_closed_default, announcement_md';

/** The row as stored (service read) → the client-safe view. The URL stops here. */
async function readSettingsView(admin: AdminClient): Promise<SettingsView> {
  const { data, error } = await admin
    .from('site_settings')
    .select(SETTINGS_COLUMNS)
    .eq('id', SETTINGS_ROW_ID)
    .maybeSingle();
  if (error) throw new Error(`site_settings read failed: ${error.code}`);
  if (data === null) throw new Error('site_settings read failed: no row');
  const url = data.discord_webhook_url;
  const set = url !== null && url !== '';
  return {
    moderation_mode: data.moderation_mode,
    admin_notify_emails: data.admin_notify_emails,
    kofi_page: data.kofi_page,
    comments_closed_default: data.comments_closed_default,
    announcement_md: data.announcement_md,
    discord_webhook_set: set,
    discord_webhook_tail: set ? secretTail(url) : null,
  };
}

async function readMatrix(admin: AdminClient): Promise<MatrixEntry[]> {
  const { data, error } = await admin.from('notification_matrix').select('kind, channel, enabled');
  if (error) throw new Error(`notification_matrix read failed: ${error.code}`);
  return sortMatrixEntries(data);
}

/** The stored webhook URL (service read) — `null` when unset. Never leaves this module. */
async function readStoredWebhookUrl(admin: AdminClient): Promise<string | null> {
  const { data, error } = await admin
    .from('site_settings')
    .select('discord_webhook_url')
    .eq('id', SETTINGS_ROW_ID)
    .maybeSingle();
  if (error) throw new Error(`site_settings read failed: ${error.code}`);
  const url = data?.discord_webhook_url ?? null;
  return url === '' ? null : url;
}

/**
 * The partial `site_settings` update (04 §1.3 "all optional — omitted = unchanged"). `''` on the
 * two clearable text columns means clear → NULL (the webhook per 04 §1.3 verbatim; `kofi_page` by
 * the same rule — `/support` reads NULL as "no page"). Emails arrive normalised from the schema.
 */
function settingsPatch(data: UpdateSettingsData): SiteSettingsPatch {
  const patch: SiteSettingsPatch = {};
  if (data.moderation_mode !== undefined) patch.moderation_mode = data.moderation_mode;
  if (data.admin_notify_emails !== undefined) patch.admin_notify_emails = data.admin_notify_emails;
  if (data.discord_webhook_url !== undefined) {
    patch.discord_webhook_url = data.discord_webhook_url === '' ? null : data.discord_webhook_url;
  }
  if (data.kofi_page !== undefined) patch.kofi_page = data.kofi_page === '' ? null : data.kofi_page;
  if (data.comments_closed_default !== undefined) {
    patch.comments_closed_default = data.comments_closed_default;
  }
  if (data.announcement_md !== undefined) patch.announcement_md = data.announcement_md;
  return patch;
}

/**
 * The matrix rows to upsert — v1 kinds only (the schema already refuses COMING LATER kinds, 04 §1.3),
 * one row per `(kind, channel)` with the LAST value winning: Postgres refuses an `insert … on conflict
 * do update` that touches the same row twice (SQLSTATE 21000), so duplicates are folded here.
 */
function matrixRows(
  entries: NonNullable<UpdateSettingsData['matrix']>,
): Database['public']['Tables']['notification_matrix']['Insert'][] {
  const byKey = new Map<string, (typeof entries)[number]>();
  for (const entry of entries) byKey.set(`${entry.kind} ${entry.channel}`, entry);
  return [...byKey.values()].map((entry) => ({
    kind: entry.kind,
    channel: entry.channel,
    enabled: entry.enabled,
  }));
}

// ---------------------------------------------------------------------------------------------
// updateSettings — 04 §1.3 (SAVE SETTINGS)
// ---------------------------------------------------------------------------------------------

export async function updateSettings(
  input: UpdateSettingsInput,
): Promise<ActionResult<UpdateSettingsResult>> {
  return runAction('updateSettings', updateSettingsInput, input, async (data, ctx) => {
    const { user } = await requireRole('admin');
    const admin = createAdminClient();

    let written = false;

    const patch = settingsPatch(data);
    if (Object.keys(patch).length > 0) {
      // Row 1 only (`site_settings_single_row` CHECK — there is never a second row to hit).
      const { data: updated, error } = await admin
        .from('site_settings')
        .update(patch)
        .eq('id', SETTINGS_ROW_ID)
        .select('id');
      if (error) throw new Error(`site_settings update failed: ${error.code}`);
      if (updated.length !== 1) throw new Error('site_settings update failed: no row');
      written = true;
    }

    const rows = data.matrix === undefined ? [] : matrixRows(data.matrix);
    if (rows.length > 0) {
      const { error } = await admin
        .from('notification_matrix')
        .upsert(rows, { onConflict: 'kind,channel' });
      if (error) throw new Error(`notification_matrix upsert failed: ${error.code}`);
      written = true;
    }

    // 02 §5: `settings` only — `/projects/[slug]` and `/support` carry the tag; listing pages show
    // no settings state, so no `projects` tag even when `comments_closed_default` changed.
    if (written) revalidateTag(TAG_SETTINGS, 'max');

    const [settings, matrix] = await Promise.all([readSettingsView(admin), readMatrix(admin)]);
    logAdmin(
      'updateSettings',
      ctx,
      user.id,
      { type: 'site_settings', id: String(SETTINGS_ROW_ID) },
      data,
    );
    return ok({ settings, matrix });
  });
}

// ---------------------------------------------------------------------------------------------
// testDiscordWebhook — 04 §1.3 (the Test button; 05 T-ACT-28)
// ---------------------------------------------------------------------------------------------

export async function testDiscordWebhook(
  input: TestDiscordWebhookInput,
): Promise<ActionResult<{ status: number }>> {
  return runAction('testDiscordWebhook', testDiscordWebhookInput, input, async (data, ctx) => {
    const { user } = await requireRole('admin');

    // Input URL if given (already regex-checked by the schema), else the stored one; neither →
    // `validation` before any hit is recorded or any request leaves.
    const url = data.url ?? (await readStoredWebhookUrl(createAdminClient()));
    if (url === null) {
      return fail('validation', LINE_NO_WEBHOOK, {
        field: 'url',
        issues: [{ path: 'url', message: LINE_NO_WEBHOOK }],
      });
    }

    await assertRateLimit('discord_test', user.id);

    // Nothing is stored (04 §1.3 Effects). The adapter is built from `lib/env.ts` once per call
    // (SC-25); its errors name the webhook as `…<last 4>` only.
    const discord = createDiscord({ env });
    let status: number;
    try {
      ({ status } = await discord.postEmbed(url, {
        title: TEST_EMBED_TITLE,
        description: TEST_EMBED_DESCRIPTION,
        color: DISCORD_COLORS.indigo,
      }));
    } catch (error) {
      if (error instanceof AdapterError) {
        // An HTTP status is the plain reason (DESIGN.md §12.1 "✕ Discord said no: <status>"); a
        // transport failure (status 0 — timeout, DNS, refused) has none to show.
        return fail(
          'upstream_error',
          error.status > 0 ? `Discord said no: ${error.status}` : LINE_DISCORD_NO_ANSWER,
        );
      }
      throw error;
    }

    logAdmin('testDiscordWebhook', ctx, user.id, { type: 'site_settings', id: null }, data);
    return ok({ status });
  });
}

// ---------------------------------------------------------------------------------------------
// setUserRole — 04 §1.3 (Moderators table: Make mod / Remove / add by handle; 05 T-ACT-66)
// ---------------------------------------------------------------------------------------------

type TargetProfile = { id: string; handle: string | null; role: UserRole; is_banned: boolean };

/** Case-insensitive lookup on the citext column (`eq` on citext compares case-insensitively). */
async function readProfileByHandle(
  admin: AdminClient,
  handle: string,
): Promise<TargetProfile | null> {
  const { data, error } = await admin
    .from('profiles')
    .select('id, handle, role, is_banned')
    .eq('handle', handle)
    .maybeSingle();
  if (error) throw new Error(`profiles read failed: ${error.code}`);
  return data;
}

/** Admins other than `excludeId` (the target under change). */
async function countOtherAdmins(admin: AdminClient, excludeId: string): Promise<number> {
  const { count, error } = await admin
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'admin')
    .neq('id', excludeId);
  if (error) throw new Error(`profiles count failed: ${error.code}`);
  return count ?? 0;
}

export async function setUserRole(
  input: SetUserRoleInput,
): Promise<ActionResult<{ profile_id: string; handle: string; role: UserRole }>> {
  return runAction('setUserRole', setUserRoleInput, input, async (data, ctx) => {
    const { user } = await requireRole('admin');
    const admin = createAdminClient();

    const target = await readProfileByHandle(admin, data.handle);
    if (target === null || target.handle === null) return fail('not_found', NOT_FOUND_PROFILE);

    const demoting = data.role !== 'admin';
    // 04 §1.3: target ≠ self when demoting — the common lockout, refused before any count.
    if (target.id === user.id && demoting) return fail('forbidden', LINE_OWN_ROLE);

    // A banned account never holds a staff role: 04 §1.2 `banUser` refuses mods/admins ("demote
    // first via `setUserRole`"), and this is the same fence from the other side (S1.5 security
    // gate — ADR-0030 D14). `requireRole` reads the role only, so a promoted banned account would
    // keep live moderator/admin action rights while the proxy parks its browser on `/banned`.
    // Demoting to `user` is always allowed (it is how the state gets repaired).
    if (target.is_banned && data.role !== 'user') return fail('conflict', LINE_BANNED_TARGET);

    // 04 §1.3: at least one admin must remain. With the actor being an admin and the target
    // someone else this only fires under a concurrent demotion — checked before AND after the
    // write, and the write is undone when the second check finds the room empty.
    const demotingAdmin = target.role === 'admin' && demoting;
    if (demotingAdmin && (await countOtherAdmins(admin, target.id)) === 0) {
      return fail('conflict', LINE_LAST_ADMIN);
    }

    const { error } = await admin.from('profiles').update({ role: data.role }).eq('id', target.id);
    if (error) throw new Error(`profiles update failed: ${error.code}`);

    if (demotingAdmin && (await countOtherAdmins(admin, target.id)) === 0) {
      const { error: revertError } = await admin
        .from('profiles')
        .update({ role: 'admin' })
        .eq('id', target.id);
      if (revertError) throw new Error(`profiles revert failed: ${revertError.code}`);
      return fail('conflict', LINE_LAST_ADMIN);
    }

    // No revalidation: roles live on `profiles`, read per request (`requireRole` / RLS), not in ISR.
    logAdmin('setUserRole', ctx, user.id, { type: 'profile', id: target.id }, data);
    return ok({ profile_id: target.id, handle: target.handle, role: data.role });
  });
}
