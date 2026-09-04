/**
 * tests/db/actions/updateSettings.test.ts — T-ACT-25, T-ACT-26, T-ACT-27 (+ T-ACT-69 SC-24 audit
 * line) (05 §7.2; 04 §1.3 `updateSettings`; 02 §5 `settings` tag only; 00 S1.5.AC2/AC3/AC4/AC11;
 * ADR-0002 C2 / C7; ADR-0030 D5 / D12; migrations 20260820120100 + 20260903120000).
 *
 * `requireRole('admin')` (moderators `forbidden` — the whole route is admin-only), then the service
 * client patches `site_settings` row 1 (omitted = unchanged, `''` = clear → NULL on the webhook and
 * `kofi_page`), upserts the v1 `notification_matrix` cells, revalidates `settings` exactly once and
 * ONLY when something was written, logs the keys-only audit line and returns the row WITHOUT the
 * webhook URL (`discord_webhook_set` + `discord_webhook_tail` = the raw last 4) plus the 16 matrix
 * cells in `matrixDefaults` order.
 *
 * The last describe covers the page-side readers of lib/data/admin.ts (`getAdminSettings` — the
 * cookie client under admin RLS, webhook masked `…<last 4>` and never raw; `listModerators` —
 * `public_profiles where role <> 'user'`, admins first then handle A→Z; `sortMatrixEntries`) so the
 * shape Lane G renders is proven against the same stack (02 §2.8 Data; 03 §2.10 props).
 *
 * `mutatesSeed` (H-1): SEED-1 / SEED-2 are written by every success row; `afterEach` restores both
 * through `restoreSeedSettings()` (service). Addresses use `@localhost.test` (F-3).
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setUserRole, updateSettings } from '@/lib/actions/settings';
import type { UpdateSettingsInput } from '@/lib/actions/settings.schema';
import { VALIDATION_MESSAGE } from '@/lib/actions/run';
import { getAdminSettings, listModerators, sortMatrixEntries } from '@/lib/data/admin';
import { matrixDefaults } from '@/lib/notify/matrix';
import { expectFail, expectOk } from '@/tests/helpers/actionResult';
import { asRole, SEED_ROLE_IDS } from '@/tests/helpers/asRole';
import { callAction, setupActionMocks, withActionContext } from '@/tests/helpers/callAction';
import { restoreSeedSettings, SEED_SITE_SETTINGS } from '@/tests/helpers/contentReset';
import { expectInternal, withDbFault } from '@/tests/helpers/dbFault';
import { cleanupFactories, makeUser } from '@/tests/helpers/factories';
import { spyLog, spyRevalidateTag, type LogSpy } from '@/tests/helpers/spies';

setupActionMocks();

const service = asRole('service');
const tags = spyRevalidateTag();

const WEBHOOK = 'https://discord.com/api/webhooks/123/t_testtoken';
const WEBHOOK_TOKEN = 't_testtoken';
const WEBHOOK_APP = 'https://discordapp.com/api/webhooks/987/t_apptoken';
const EMAIL_A = 'seed-admin@localhost.test';
const EMAIL_B = 'other-admin@localhost.test';

type SettingsRow = {
  id: number;
  moderation_mode: 'auto' | 'hold_first_time';
  admin_notify_emails: string[];
  discord_webhook_url: string | null;
  kofi_page: string | null;
  comments_closed_default: boolean;
  announcement_md: string | null;
  owner_profile_id: string | null;
};

type Cell = { kind: string; channel: string; enabled: boolean };

let logs: LogSpy;

async function readRow(): Promise<SettingsRow> {
  const { data, error } = await service
    .from('site_settings')
    .select(
      'id, moderation_mode, admin_notify_emails, discord_webhook_url, kofi_page, comments_closed_default, announcement_md, owner_profile_id',
    )
    .eq('id', 1)
    .single();
  if (error) throw new Error(`service could not read site_settings: ${error.message}`);
  return data;
}

async function rowCount(): Promise<number> {
  const { count, error } = await service
    .from('site_settings')
    .select('id', { count: 'exact', head: true });
  if (error) throw new Error(`service could not count site_settings: ${error.message}`);
  return count ?? 0;
}

async function readCell(kind: string, channel: 'email' | 'discord'): Promise<boolean> {
  const { data, error } = await service
    .from('notification_matrix')
    .select('enabled')
    .eq('kind', kind)
    .eq('channel', channel)
    .single();
  if (error) throw new Error(`service could not read notification_matrix: ${error.message}`);
  return data.enabled;
}

async function readMatrix(): Promise<Cell[]> {
  const { data, error } = await service
    .from('notification_matrix')
    .select('kind, channel, enabled');
  if (error) throw new Error(`service could not read notification_matrix: ${error.message}`);
  return data
    .map((row) => ({ kind: row.kind, channel: row.channel, enabled: row.enabled }))
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.channel.localeCompare(b.channel));
}

function adminLines(): Array<Record<string, unknown>> {
  return (logs.lines as Array<Record<string, unknown>>).filter((line) => line.msg === 'admin');
}

async function patchRow(patch: Partial<SettingsRow>): Promise<void> {
  const { error } = await service.from('site_settings').update(patch).eq('id', 1);
  if (error) throw new Error(`service could not patch site_settings: ${error.message}`);
}

/** The seed row as `readRow()` returns it. */
const SEED_ROW: SettingsRow = { ...SEED_SITE_SETTINGS };

/** The 16 default cells in the sorted shape `readMatrix()` returns. */
const SEED_CELLS: Cell[] = matrixDefaults
  .map((entry) => ({ ...entry }))
  .sort((a, b) => a.kind.localeCompare(b.kind) || a.channel.localeCompare(b.channel));

beforeEach(() => {
  logs = spyLog();
  tags.calls.length = 0;
});

afterEach(async () => {
  logs.restore();
  await restoreSeedSettings();
});

afterAll(async () => {
  await restoreSeedSettings();
  await cleanupFactories();
});

// ---------------------------------------------------------------------------------------------
// T-ACT-25 auth matrix — anon D · user D forbidden · banned D · mod D forbidden · admin A
// ---------------------------------------------------------------------------------------------
describe('T-ACT-25 updateSettings auth', () => {
  it('T-ACT-25 anon → unauthenticated, row untouched, no tag', async () => {
    const error = expectFail(
      await callAction(updateSettings, { moderation_mode: 'hold_first_time' }, { role: 'anon' }),
      'unauthenticated',
    );
    expect(error.message).toBe('Sign in first.');
    expect(await readRow()).toEqual(SEED_ROW);
    expect(tags.calls).toEqual([]);
    expect(adminLines()).toEqual([]);
  });

  it.each([
    { role: 'user' as const },
    // The seed banned account has role `user` — `requireRole`'s rank check fires (04 SC-04).
    { role: 'banned' as const },
    // ADR-0002 C2 / C7: settings are admin-only; moderators get `forbidden`.
    { role: 'mod' as const },
  ])(
    'T-ACT-25 $role → forbidden, row + matrix untouched, no tag, no audit line',
    async ({ role }) => {
      const error = expectFail(
        await callAction(
          updateSettings,
          {
            moderation_mode: 'hold_first_time',
            matrix: [{ kind: 'comment.new', channel: 'email', enabled: false }],
          },
          { role },
        ),
        'forbidden',
      );
      expect(error.message).toBe('Not allowed.');
      expect(await readRow()).toEqual(SEED_ROW);
      expect(await readMatrix()).toEqual(SEED_CELLS);
      expect(tags.calls).toEqual([]);
      expect(adminLines()).toEqual([]);
    },
  );

  it('T-ACT-25 admin → ok: an empty partial writes nothing, revalidates nothing, still returns the view + audit line', async () => {
    const data = expectOk(await callAction(updateSettings, {}, { role: 'admin' }));
    expect(data.settings).toEqual({
      moderation_mode: 'auto',
      admin_notify_emails: [],
      kofi_page: 'oddsense',
      comments_closed_default: false,
      announcement_md: null,
      discord_webhook_set: false,
      discord_webhook_tail: null,
    });
    expect(data.matrix).toEqual(matrixDefaults.map((entry) => ({ ...entry })));
    expect(tags.calls).toEqual([]);
    expect(adminLines()).toHaveLength(1);
    expect(await readRow()).toEqual(SEED_ROW);
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-26 validation (04 §1.3) — every row through callAction as admin (plain issues, nothing written)
// ---------------------------------------------------------------------------------------------
describe('T-ACT-26 updateSettings validation', () => {
  it.each<{ name: string; input: unknown; path: string }>([
    {
      name: 'moderation_mode outside the enum',
      input: { moderation_mode: 'manual' },
      path: 'moderation_mode',
    },
    {
      name: 'discord_webhook_url http://',
      input: { discord_webhook_url: 'http://discord.com/api/webhooks/123/abc' },
      path: 'discord_webhook_url',
    },
    {
      name: 'discord_webhook_url on another host',
      input: { discord_webhook_url: 'https://example.com/api/webhooks/123/abc' },
      path: 'discord_webhook_url',
    },
    {
      name: 'discord_webhook_url with trailing whitespace (no trim)',
      input: { discord_webhook_url: `${WEBHOOK} ` },
      path: 'discord_webhook_url',
    },
    {
      name: 'discord_webhook_url with a query string',
      input: { discord_webhook_url: `${WEBHOOK}?wait=true` },
      path: 'discord_webhook_url',
    },
    {
      name: 'admin_notify_emails: 11 entries (max 10 on the raw list)',
      input: {
        admin_notify_emails: Array.from({ length: 11 }, (_, i) => `t_${i}@localhost.test`),
      },
      path: 'admin_notify_emails',
    },
    {
      name: 'admin_notify_emails: 11 entries even when they collapse to one',
      input: { admin_notify_emails: Array.from({ length: 11 }, () => EMAIL_A) },
      path: 'admin_notify_emails',
    },
    {
      name: 'admin_notify_emails: not an email',
      input: { admin_notify_emails: ['not-an-email'] },
      path: 'admin_notify_emails.0',
    },
    {
      name: 'admin_notify_emails: a bare handle',
      input: { admin_notify_emails: [EMAIL_A, 'seed_user'] },
      path: 'admin_notify_emails.1',
    },
    {
      name: 'admin_notify_emails: longer than 254',
      input: { admin_notify_emails: [`${'a'.repeat(250)}@localhost.test`] },
      path: 'admin_notify_emails.0',
    },
    {
      name: 'admin_notify_emails: not an array',
      input: { admin_notify_emails: EMAIL_A },
      path: 'admin_notify_emails',
    },
    { name: 'kofi_page with a space', input: { kofi_page: 'odd sense' }, path: 'kofi_page' },
    { name: 'kofi_page with a dot', input: { kofi_page: 'odd.sense' }, path: 'kofi_page' },
    { name: 'kofi_page longer than 40', input: { kofi_page: 'a'.repeat(41) }, path: 'kofi_page' },
    {
      name: 'announcement_md longer than 2000',
      input: { announcement_md: 'a'.repeat(2001) },
      path: 'announcement_md',
    },
    {
      name: 'matrix: a COMING LATER kind (tip.new)',
      input: { matrix: [{ kind: 'tip.new', channel: 'email', enabled: true }] },
      path: 'matrix.0.kind',
    },
    {
      name: 'matrix: a log-only kind (comment.reply)',
      input: { matrix: [{ kind: 'comment.reply', channel: 'email', enabled: true }] },
      path: 'matrix.0.kind',
    },
    {
      name: 'matrix: unknown channel',
      input: { matrix: [{ kind: 'comment.new', channel: 'push', enabled: true }] },
      path: 'matrix.0.channel',
    },
    {
      name: 'matrix: enabled is not a boolean',
      input: { matrix: [{ kind: 'comment.new', channel: 'email', enabled: 'yes' }] },
      path: 'matrix.0.enabled',
    },
    {
      name: 'matrix: a bad entry among good ones',
      input: {
        matrix: [
          { kind: 'comment.new', channel: 'email', enabled: false },
          { kind: 'order.new', channel: 'discord', enabled: false },
        ],
      },
      path: 'matrix.1.kind',
    },
    {
      name: 'comments_closed_default as a string',
      input: { comments_closed_default: 'true' },
      path: 'comments_closed_default',
    },
  ])('T-ACT-26 $name → validation, nothing written', async ({ input, path }) => {
    const error = expectFail(
      await callAction(updateSettings, input as UpdateSettingsInput, { role: 'admin' }),
      'validation',
    );
    expect(error.message).toBe(VALIDATION_MESSAGE);
    expect(error.field).toBe(path);
    expect(error.issues?.[0]?.path).toBe(path);
    for (const issue of error.issues ?? []) {
      expect(issue.message).not.toMatch(/invalid_type|expected|received|ZodError|\$Zod/i);
      expect(issue.message).toMatch(/^[A-Z]/);
    }
    expect(await readRow()).toEqual(SEED_ROW);
    expect(await readMatrix()).toEqual(SEED_CELLS);
    expect(tags.calls).toEqual([]);
    expect(adminLines()).toEqual([]);
  });

  it("T-ACT-26 discord_webhook_url '' → stored NULL (clear); response says not set", async () => {
    await patchRow({ discord_webhook_url: WEBHOOK });
    const data = expectOk(
      await callAction(updateSettings, { discord_webhook_url: '' }, { role: 'admin' }),
    );
    expect((await readRow()).discord_webhook_url).toBeNull();
    expect(data.settings.discord_webhook_set).toBe(false);
    expect(data.settings.discord_webhook_tail).toBeNull();
    expect(tags.calls).toEqual(['settings']);
  });

  it('T-ACT-26 discord_webhook_url omitted → unchanged (the other fields still save)', async () => {
    await patchRow({ discord_webhook_url: WEBHOOK });
    const data = expectOk(
      await callAction(updateSettings, { kofi_page: 't_kofi' }, { role: 'admin' }),
    );
    const row = await readRow();
    expect(row.discord_webhook_url).toBe(WEBHOOK);
    expect(row.kofi_page).toBe('t_kofi');
    expect(data.settings.discord_webhook_set).toBe(true);
    expect(data.settings.discord_webhook_tail).toBe('oken');
  });

  it('T-ACT-26 discord_webhook_url accepts discordapp.com', async () => {
    expectOk(
      await callAction(updateSettings, { discord_webhook_url: WEBHOOK_APP }, { role: 'admin' }),
    );
    expect((await readRow()).discord_webhook_url).toBe(WEBHOOK_APP);
  });

  it('T-ACT-26 admin_notify_emails are trimmed, lowercased and de-duplicated (first appearance kept); 10 unique entries pass', async () => {
    const data = expectOk(
      await callAction(
        updateSettings,
        {
          admin_notify_emails: [
            ` Seed-Admin@Localhost.test`,
            'seed-admin@localhost.test',
            'Other-Admin@localhost.test ',
            'SEED-ADMIN@LOCALHOST.TEST',
          ],
        },
        { role: 'admin' },
      ),
    );
    expect(data.settings.admin_notify_emails).toEqual([EMAIL_A, EMAIL_B]);
    expect((await readRow()).admin_notify_emails).toEqual([EMAIL_A, EMAIL_B]);

    const ten = Array.from({ length: 10 }, (_, i) => `t_${i}@localhost.test`);
    expectOk(await callAction(updateSettings, { admin_notify_emails: ten }, { role: 'admin' }));
    expect((await readRow()).admin_notify_emails).toEqual(ten);

    expectOk(await callAction(updateSettings, { admin_notify_emails: [] }, { role: 'admin' }));
    expect((await readRow()).admin_notify_emails).toEqual([]);
  });

  it("T-ACT-26 kofi_page '' → stored NULL; announcement_md null and ≤ 2000 accepted", async () => {
    expectOk(
      await callAction(
        updateSettings,
        { kofi_page: '', announcement_md: 'a'.repeat(2000) },
        { role: 'admin' },
      ),
    );
    let row = await readRow();
    expect(row.kofi_page).toBeNull();
    expect(row.announcement_md).toBe('a'.repeat(2000));

    expectOk(
      await callAction(
        updateSettings,
        { kofi_page: 'Odd_Sense-1', announcement_md: null },
        {
          role: 'admin',
        },
      ),
    );
    row = await readRow();
    expect(row.kofi_page).toBe('Odd_Sense-1');
    expect(row.announcement_md).toBeNull();
  });

  it('T-ACT-26 unknown keys are stripped (never a validation error, never written)', async () => {
    const data = expectOk(
      await callAction(
        updateSettings,
        { moderation_mode: 'auto', owner_profile_id: SEED_ROLE_IDS.user } as UpdateSettingsInput,
        { role: 'admin' },
      ),
    );
    expect((await readRow()).owner_profile_id).toBe(SEED_ROLE_IDS.admin);
    expect(data.settings.moderation_mode).toBe('auto');
    const line = adminLines()[0] as { meta: { fields: string[] } };
    expect(line.meta.fields).toEqual(['moderation_mode']);
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-27 side effects — row 1 only · matrix upserted · one `settings` tag, never `projects` ·
// the URL never comes back · SC-24 audit line (T-ACT-69)
// ---------------------------------------------------------------------------------------------
describe('T-ACT-27 updateSettings side effects', () => {
  it('T-ACT-27 a full save updates row 1, upserts the matrix cells, revalidates `settings` once, never returns the URL, logs keys only', async () => {
    const input: UpdateSettingsInput = {
      moderation_mode: 'hold_first_time',
      admin_notify_emails: [EMAIL_A],
      discord_webhook_url: WEBHOOK,
      kofi_page: 't_kofi',
      comments_closed_default: true,
      announcement_md: 't_ann',
      matrix: [
        { kind: 'comment.new', channel: 'email', enabled: false },
        { kind: 'sync.failed', channel: 'discord', enabled: true },
      ],
    };
    const res = await callAction(updateSettings, input, { role: 'admin' });
    const data = expectOk(res);

    // Row 1 updated, never a second row.
    expect(await rowCount()).toBe(1);
    expect(await readRow()).toEqual({
      ...SEED_ROW,
      moderation_mode: 'hold_first_time',
      admin_notify_emails: [EMAIL_A],
      discord_webhook_url: WEBHOOK,
      kofi_page: 't_kofi',
      comments_closed_default: true,
      announcement_md: 't_ann',
    });

    // Matrix: the two cells flipped, the other 14 untouched.
    expect(await readCell('comment.new', 'email')).toBe(false);
    expect(await readCell('sync.failed', 'discord')).toBe(true);
    expect(await readMatrix()).toEqual(
      SEED_CELLS.map((cell) =>
        cell.kind === 'comment.new' && cell.channel === 'email'
          ? { ...cell, enabled: false }
          : cell.kind === 'sync.failed' && cell.channel === 'discord'
            ? { ...cell, enabled: true }
            : cell,
      ),
    );

    // Exactly one `settings` tag and no `projects` tag (02 §5; 04 §1.3).
    expect(tags.calls).toEqual(['settings']);

    // The response: the view without the URL, the tail, the ordered 16-cell matrix.
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain('discord_webhook_url');
    expect(serialized).not.toContain(WEBHOOK_TOKEN);
    expect(serialized).not.toContain(WEBHOOK);
    expect(data.settings).toEqual({
      moderation_mode: 'hold_first_time',
      admin_notify_emails: [EMAIL_A],
      kofi_page: 't_kofi',
      comments_closed_default: true,
      announcement_md: 't_ann',
      discord_webhook_set: true,
      discord_webhook_tail: 'oken',
    });
    expect(data.matrix).toHaveLength(16);
    expect(data.matrix.map((cell) => `${cell.kind} ${cell.channel}`)).toEqual(
      matrixDefaults.map((cell) => `${cell.kind} ${cell.channel}`),
    );
    expect(data.matrix[0]).toEqual({ kind: 'comment.new', channel: 'email', enabled: false });
    expect(data.matrix.find((c) => c.kind === 'sync.failed' && c.channel === 'discord')).toEqual({
      kind: 'sync.failed',
      channel: 'discord',
      enabled: true,
    });

    // SC-24 (T-ACT-69): one keys-only admin line; no value, email, URL or token in any log line.
    const lines = adminLines();
    expect(lines).toHaveLength(1);
    const line = lines[0] as { action: string; id: string; meta: Record<string, unknown> };
    expect(line.action).toBe('updateSettings');
    expect(String(line.id)).toMatch(/^[0-9a-f-]{36}$/);
    expect(Object.keys(line.meta).sort()).toEqual([
      'actor_profile_id',
      'fields',
      'target_id',
      'target_type',
    ]);
    expect(line.meta.actor_profile_id).toBe(SEED_ROLE_IDS.admin);
    expect(line.meta.target_type).toBe('site_settings');
    expect(line.meta.target_id).toBe('1');
    expect([...(line.meta.fields as string[])].sort()).toEqual(Object.keys(input).sort());
    const allLines = JSON.stringify(logs.lines);
    expect(allLines).not.toContain(WEBHOOK_TOKEN);
    expect(allLines).not.toContain(EMAIL_A);
    expect(allLines).not.toContain('t_ann');
  });

  it('T-ACT-27 comments_closed_default alone → exactly one `settings` tag, no `projects` tag', async () => {
    expectOk(
      await callAction(updateSettings, { comments_closed_default: true }, { role: 'admin' }),
    );
    expect((await readRow()).comments_closed_default).toBe(true);
    expect(tags.calls).toEqual(['settings']);
    expect(tags.calls).not.toContain('projects');
  });

  it('T-ACT-27 a matrix-only save leaves the row alone and still revalidates `settings` once', async () => {
    expectOk(
      await callAction(
        updateSettings,
        { matrix: [{ kind: 'comment.held', channel: 'discord', enabled: false }] },
        { role: 'admin' },
      ),
    );
    expect(await readRow()).toEqual(SEED_ROW);
    expect(await readCell('comment.held', 'discord')).toBe(false);
    expect(tags.calls).toEqual(['settings']);
  });

  it('T-ACT-27 an empty matrix writes nothing and revalidates nothing', async () => {
    expectOk(await callAction(updateSettings, { matrix: [] }, { role: 'admin' }));
    expect(await readMatrix()).toEqual(SEED_CELLS);
    expect(tags.calls).toEqual([]);
  });

  it('T-ACT-27 duplicate matrix cells in one save: the last value wins (no 21000 from the upsert)', async () => {
    const data = expectOk(
      await callAction(
        updateSettings,
        {
          matrix: [
            { kind: 'comment.reported', channel: 'email', enabled: false },
            { kind: 'comment.reported', channel: 'email', enabled: true },
            { kind: 'comment.reported', channel: 'email', enabled: false },
          ],
        },
        { role: 'admin' },
      ),
    );
    expect(await readCell('comment.reported', 'email')).toBe(false);
    expect(data.matrix.find((c) => c.kind === 'comment.reported' && c.channel === 'email')).toEqual(
      { kind: 'comment.reported', channel: 'email', enabled: false },
    );
    expect(tags.calls).toEqual(['settings']);
  });

  it('T-ACT-27 saving the same values twice is idempotent (row + matrix equal, one tag per call)', async () => {
    const input: UpdateSettingsInput = {
      moderation_mode: 'hold_first_time',
      matrix: [{ kind: 'sync.stale', channel: 'email', enabled: false }],
    };
    expectOk(await callAction(updateSettings, input, { role: 'admin' }));
    const afterFirst = { row: await readRow(), matrix: await readMatrix() };
    expectOk(await callAction(updateSettings, input, { role: 'admin' }));
    expect({ row: await readRow(), matrix: await readMatrix() }).toEqual(afterFirst);
    expect(tags.calls).toEqual(['settings', 'settings']);
  });

  it('T-ACT-27 the response after a save without a webhook says not set (tail null), and never carries the key', async () => {
    const res = await callAction(updateSettings, { announcement_md: 't_x' }, { role: 'admin' });
    const data = expectOk(res);
    expect(data.settings.discord_webhook_set).toBe(false);
    expect(data.settings.discord_webhook_tail).toBeNull();
    expect(JSON.stringify(res)).not.toContain('discord_webhook_url');
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-0 (1) — a DB failure → internal + one log.error line; nothing revalidated
// ---------------------------------------------------------------------------------------------
describe('T-ACT-0 updateSettings faults', () => {
  it('T-ACT-0 the site_settings update fails → internal, row untouched, no tag, no audit line', async () => {
    const res = await withDbFault({ table: 'site_settings', op: 'update' }, {}, () =>
      callAction(updateSettings, { moderation_mode: 'hold_first_time' }, { role: 'admin' }),
    );
    expectInternal(res, 'updateSettings', logs);
    expect(await readRow()).toEqual(SEED_ROW);
    expect(tags.calls).toEqual([]);
    expect(adminLines()).toEqual([]);
  });

  it('T-ACT-0 the matrix upsert fails → internal, no tag (the row patch before it stays — the next SAVE revalidates)', async () => {
    const res = await withDbFault({ table: 'notification_matrix', op: 'upsert' }, {}, () =>
      callAction(
        updateSettings,
        {
          kofi_page: 't_fault',
          matrix: [{ kind: 'comment.new', channel: 'email', enabled: false }],
        },
        { role: 'admin' },
      ),
    );
    expectInternal(res, 'updateSettings', logs);
    expect(await readCell('comment.new', 'email')).toBe(true);
    expect((await readRow()).kofi_page).toBe('t_fault');
    expect(tags.calls).toEqual([]);
    expect(adminLines()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// The /admin/settings readers (lib/data/admin.ts — 02 §2.8 Data; 03 §2.10 props; 01 INV-43/INV-45)
// ---------------------------------------------------------------------------------------------
describe('S1.5 /admin/settings readers (lib/data/admin.ts)', () => {
  const cellKeys = (cells: readonly { kind: string; channel: string }[]): string[] =>
    cells.map((cell) => `${cell.kind} ${cell.channel}`);
  const byHandle = (a: string, b: string): number =>
    a.toLowerCase().localeCompare(b.toLowerCase()) || a.localeCompare(b);

  it('getAdminSettings (admin session) returns the row with the webhook masked `…<last 4>` and never raw; the matrix in matrixDefaults order', async () => {
    expectOk(
      await callAction(
        updateSettings,
        {
          moderation_mode: 'hold_first_time',
          discord_webhook_url: WEBHOOK,
          admin_notify_emails: [EMAIL_A],
          kofi_page: 't_kofi',
          comments_closed_default: true,
          announcement_md: 't_ann',
          matrix: [{ kind: 'comment.new', channel: 'discord', enabled: false }],
        },
        { role: 'admin' },
      ),
    );
    const view = await withActionContext({ role: 'admin' }, () => getAdminSettings());
    expect(view.webhookSet).toBe(true);
    expect(view.webhookMasked).toBe('…oken');
    const text = JSON.stringify(view);
    expect(text).not.toContain(WEBHOOK_TOKEN);
    expect(text).not.toContain('/api/webhooks/');
    expect(view.moderationMode).toBe('hold_first_time');
    expect(view.adminNotifyEmails).toEqual([EMAIL_A]);
    expect(view.kofiPage).toBe('t_kofi');
    expect(view.commentsClosedDefault).toBe(true);
    expect(view.announcementMd).toBe('t_ann');
    expect(cellKeys(view.matrix)).toEqual(cellKeys(matrixDefaults));
    expect(view.matrix[1]).toEqual({ kind: 'comment.new', channel: 'discord', enabled: false });
    expect(view.matrix.filter((c) => c.kind !== 'comment.new' || c.channel !== 'discord')).toEqual(
      matrixDefaults.filter((c) => c.kind !== 'comment.new' || c.channel !== 'discord'),
    );
    expect(view.comingLater).toEqual(['mention.suggested', 'order.new', 'tip.new']);
  });

  it('getAdminSettings without a webhook → webhookSet false, webhookMasked null (the seed state)', async () => {
    const view = await withActionContext({ role: 'admin' }, () => getAdminSettings());
    expect(view.webhookSet).toBe(false);
    expect(view.webhookMasked).toBeNull();
    expect(view.adminNotifyEmails).toEqual([]);
    expect(view.kofiPage).toBe('oddsense');
    expect(view.matrix).toEqual(matrixDefaults.map((entry) => ({ ...entry })));
  });

  it('getAdminSettings on a moderator session throws — RLS hides the row (the page 404s moderators before reading)', async () => {
    await expect(withActionContext({ role: 'mod' }, () => getAdminSettings())).rejects.toThrow(
      /no row/,
    );
  });

  it('listModerators: public_profiles where role <> user — admins first, then moderators, handle A→Z; Remove drops the row at once', async () => {
    await makeUser({ role: 'moderator', handle: 't_zz_mod' });
    await makeUser({ role: 'moderator', handle: 't_AA_mod' });
    await makeUser({ role: 'admin', handle: 't_xx_admin' });
    await makeUser({ role: 'user', handle: 't_plain_user' });
    await makeUser({ role: 'moderator', handle: null }); // no handle → not addressable, skipped

    const rows = await withActionContext({ role: 'admin' }, () => listModerators());
    const handles = rows.map((row) => row.handle);
    expect(rows.every((row) => row.role === 'admin' || row.role === 'moderator')).toBe(true);
    const admins = rows.filter((row) => row.role === 'admin').map((row) => row.handle);
    const mods = rows.filter((row) => row.role === 'moderator').map((row) => row.handle);
    expect(handles).toEqual([...admins, ...mods]);
    expect(admins).toEqual([...admins].sort(byHandle));
    expect(mods).toEqual([...mods].sort(byHandle));
    expect(admins).toEqual(expect.arrayContaining(['oddsense', 't_xx_admin']));
    expect(mods).toEqual(expect.arrayContaining(['seed_mod', 't_AA_mod', 't_zz_mod']));
    expect(mods.indexOf('t_AA_mod')).toBeLessThan(mods.indexOf('t_zz_mod'));
    expect(handles).not.toContain('t_plain_user');
    expect(handles).not.toContain('seed_user');
    expect(rows.every((row) => Object.keys(row).sort().join() === 'handle,id,role')).toBe(true);
    expect(JSON.stringify(rows)).not.toMatch(/@localhost\.test|is_banned|email/);

    expectOk(
      await callAction(setUserRole, { handle: 't_zz_mod', role: 'user' }, { role: 'admin' }),
    );
    const after = await withActionContext({ role: 'admin' }, () => listModerators());
    expect(after.map((row) => row.handle)).not.toContain('t_zz_mod');
    // The view is readable by every role (a moderator session sees the same list).
    const asMod = await withActionContext({ role: 'mod' }, () => listModerators());
    expect(asMod).toEqual(after);
  });

  it('sortMatrixEntries: defaults order, missing cells filled from matrixDefaults, Phase 2 channels / log-only kinds dropped, last duplicate wins', () => {
    const sorted = sortMatrixEntries([
      { kind: 'tip.new', channel: 'discord', enabled: false },
      { kind: 'comment.new', channel: 'push', enabled: true },
      { kind: 'comment.reply', channel: 'email', enabled: true },
      { kind: 'comment.new', channel: 'email', enabled: false },
      { kind: 'comment.new', channel: 'email', enabled: true },
    ]);
    expect(cellKeys(sorted)).toEqual(cellKeys(matrixDefaults));
    expect(sorted[0]).toEqual({ kind: 'comment.new', channel: 'email', enabled: true });
    expect(sorted[15]).toEqual({ kind: 'tip.new', channel: 'discord', enabled: false });
    expect(sorted[1]).toEqual({ kind: 'comment.new', channel: 'discord', enabled: true }); // default
    expect(sortMatrixEntries([])).toEqual(matrixDefaults.map((entry) => ({ ...entry })));
  });
});
