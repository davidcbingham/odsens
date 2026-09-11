/**
 * tests/db/rls/site_settings_public.test.ts — matrix for the `site_settings_public` view
 * (docs/build/05-test-plan.md §7.1 T-RLS-132; ADR-0002 C6 + A3; data-model §2.4). Definer view,
 * SELECT granted to every role; column set is exactly comments_closed_default, kofi_page,
 * owner_profile_id, moderation_mode. Seed values per SEED-1 (`moderation_mode = 'auto'` — the
 * earlier 'hold_first_time' in the T-RLS-132 cell was a typo, 05 §12 note 2026-08-20).
 * The first describe is read-only. S1.5 (05 §8 row S1.5 "132 (re-run after `updateSettings`)"): the
 * last describe writes the row through `updateSettings` (admin session) and re-asserts the view —
 * every role sees the new public values, the secret columns stay hidden — then restores SEED-1 +
 * SEED-2 (`restoreSeedSettings`, H-1 `mutatesSeed`).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { updateSettings } from '@/lib/actions/settings';
import { expectOk } from '@/tests/helpers/actionResult';
import { asRole, type TestRole } from '@/tests/helpers/asRole';
import { callAction, setupActionMocks } from '@/tests/helpers/callAction';
import { restoreSeedSettings } from '@/tests/helpers/contentReset';
import { sql } from '@/tests/helpers/db';
import { expectPolicy } from '@/tests/helpers/expectPolicy';
import { SEED_USERS } from '@/tests/helpers/seedIds';

setupActionMocks();

const ALL_ROLES = [
  'anon',
  'user',
  'banned',
  'mod',
  'admin',
  'service',
] as const satisfies readonly TestRole[];
const NON_SERVICE = [
  'anon',
  'user',
  'banned',
  'mod',
  'admin',
] as const satisfies readonly TestRole[];
const PUBLIC_COLUMNS = [
  'comments_closed_default',
  'kofi_page',
  'owner_profile_id',
  'moderation_mode',
] as const;

describe('T-RLS-132 site_settings_public', () => {
  it.each(ALL_ROLES)(
    'T-RLS-132 %s selects the single row with exactly the four public columns',
    async (role) => {
      const { data, error } = await asRole(role).from('site_settings_public').select('*');
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(Object.keys(data?.[0] ?? {}).sort()).toEqual([...PUBLIC_COLUMNS].sort());
      expect(data?.[0]).toEqual({
        comments_closed_default: false,
        kofi_page: 'oddsense',
        owner_profile_id: SEED_USERS.oddsense,
        moderation_mode: 'auto',
      });
    },
  );

  it('T-RLS-132 the catalog column set matches (no discord_webhook_url / admin_notify_emails / announcement_md)', () => {
    const columns = sql(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'site_settings_public' order by ordinal_position",
    ).map(([name]) => name);
    expect(columns).toEqual([...PUBLIC_COLUMNS]);
  });

  it('T-RLS-132 hidden columns cannot be selected through the view', async () => {
    for (const column of ['discord_webhook_url', 'admin_notify_emails', 'announcement_md', 'id']) {
      const { error } = await asRole('anon')
        .from('site_settings_public')
        .select(column as 'kofi_page');
      expect(error, `${column} must not be selectable`).not.toBeNull();
    }
  });

  it.each(NON_SERVICE)(
    'T-RLS-132 %s cannot insert/update/delete through the view',
    async (role) => {
      await expectPolicy({
        table: 'site_settings_public',
        op: 'insert',
        role,
        allowed: false,
        row: { kofi_page: 't_rls132' },
      });
      await expectPolicy({
        table: 'site_settings_public',
        op: 'update',
        role,
        allowed: false,
        filter: { kofi_page: 'oddsense' },
        patch: { kofi_page: 't_rls132' },
      });
      await expectPolicy({
        table: 'site_settings_public',
        op: 'delete',
        role,
        allowed: false,
        filter: { kofi_page: 'oddsense' },
      });
      const { data } = await asRole('service').from('site_settings_public').select('kofi_page');
      expect(data).toEqual([{ kofi_page: 'oddsense' }]);
    },
  );
});

// ---------------------------------------------------------------------------------------------
// S1.5 re-run — T-RLS-132 after an `updateSettings` write (04 §1.3; 02 RP-23; 05 §8 row S1.5)
// ---------------------------------------------------------------------------------------------
describe('T-RLS-132 after updateSettings (S1.5)', () => {
  const WEBHOOK = 'https://discord.com/api/webhooks/123/t_rls132token';
  const EMAIL = 'seed-admin@localhost.test';

  afterAll(async () => {
    await restoreSeedSettings();
  });

  it('T-RLS-132 every role sees the new public values through the view; the secrets never do', async () => {
    expectOk(
      await callAction(
        updateSettings,
        {
          moderation_mode: 'hold_first_time',
          comments_closed_default: true,
          kofi_page: 't_rls132',
          discord_webhook_url: WEBHOOK,
          admin_notify_emails: [EMAIL],
          announcement_md: 't_rls132 hidden',
        },
        { role: 'admin' },
      ),
    );

    for (const role of ALL_ROLES) {
      const { data, error } = await asRole(role).from('site_settings_public').select('*');
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(Object.keys(data?.[0] ?? {}).sort()).toEqual([...PUBLIC_COLUMNS].sort());
      expect(data?.[0]).toEqual({
        comments_closed_default: true,
        kofi_page: 't_rls132',
        owner_profile_id: SEED_USERS.oddsense,
        moderation_mode: 'hold_first_time',
      });
      const text = JSON.stringify(data);
      expect(text).not.toContain('t_rls132token');
      expect(text).not.toContain(EMAIL);
      expect(text).not.toContain('t_rls132 hidden');
    }

    for (const column of ['discord_webhook_url', 'admin_notify_emails', 'announcement_md']) {
      const { error } = await asRole('admin')
        .from('site_settings_public')
        .select(column as 'kofi_page');
      expect(error, `${column} must not be selectable`).not.toBeNull();
    }
  });
});
