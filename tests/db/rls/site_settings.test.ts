/**
 * tests/db/rls/site_settings.test.ts — RLS matrix for the single-row `site_settings` base table
 * (docs/build/05-test-plan.md §7.1 T-RLS-12..15; data-model §2.4/§4). Public read is the view
 * `site_settings_public` (T-RLS-132, its own file). Policies: 20260820120100_site_settings.sql.
 * Cell order: anon | user | banned | mod | admin | svc.
 *
 * `mutatesSeed` (H-1): admin/service cells write the SEED-1 row; `afterAll` restores it via psql.
 * S1.5 (05 §8 row S1.5 "12..14 (settings update)"): the last describe re-runs T-RLS-12 / T-RLS-14 after
 * an `updateSettings` write through the action (admin session) — the new values are readable by
 * admin + service only and still unwritable by every other role.
 *
 * The singleton itself (ADR-0015 addendum, 2026-08-20): production and the persistent `staging` branch
 * never run seed.sql, so the row is created by migration 20260820120500_site_settings_default_row.sql
 * (`insert … (id) values (1) on conflict (id) do nothing`) with column defaults; seed.sql only sets
 * `kofi_page` / `owner_profile_id` locally (SEED-1). The T-RLS-12 singleton cells prove the migration
 * alone yields a valid row and that re-applying it is a no-op.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { updateSettings } from '@/lib/actions/settings';
import { expectOk } from '@/tests/helpers/actionResult';
import { asRole, type TestRole } from '@/tests/helpers/asRole';
import { callAction, setupActionMocks } from '@/tests/helpers/callAction';
import { sql } from '@/tests/helpers/db';
import { REPO_ROOT } from '@/tests/helpers/envTest';
import { expectPolicy } from '@/tests/helpers/expectPolicy';
import { SEED_USERS } from '@/tests/helpers/seedIds';

setupActionMocks();

const NON_ADMIN = ['user', 'banned', 'mod'] as const satisfies readonly TestRole[];
const service = asRole('service');

/** A webhook-shaped secret for the S1.5 re-run (never a real one; token tagged `t_`). */
const WEBHOOK = 'https://discord.com/api/webhooks/123/t_rls14token';

const DEFAULT_ROW_MIGRATION = path.join(
  REPO_ROOT,
  'supabase',
  'migrations',
  '20260820120500_site_settings_default_row.sql',
);

/** SEED-1 values (05 §3; brief §1). */
const SEED_ROW = {
  id: 1,
  moderation_mode: 'auto',
  admin_notify_emails: [] as string[],
  discord_webhook_url: null,
  kofi_page: 'oddsense',
  comments_closed_default: false,
  announcement_md: null,
  owner_profile_id: SEED_USERS.oddsense,
} as const;

function restoreSeedRow(): void {
  sql(`
    insert into public.site_settings (id, moderation_mode, admin_notify_emails, discord_webhook_url,
      kofi_page, comments_closed_default, announcement_md, owner_profile_id)
    values (1, 'auto', '{}', null, 'oddsense', false, null, '${SEED_USERS.oddsense}')
    on conflict (id) do update
      set moderation_mode = excluded.moderation_mode, admin_notify_emails = excluded.admin_notify_emails,
          discord_webhook_url = excluded.discord_webhook_url, kofi_page = excluded.kofi_page,
          comments_closed_default = excluded.comments_closed_default,
          announcement_md = excluded.announcement_md, owner_profile_id = excluded.owner_profile_id
  `);
}

async function seedRow() {
  const { data, error } = await service.from('site_settings').select('*').eq('id', 1).maybeSingle();
  if (error) throw new Error(`service could not read site_settings: ${error.message}`);
  return data;
}

afterAll(() => {
  restoreSeedRow();
});

// ---------------------------------------------------------------------------------------------
// T-RLS-12 the singleton — created by migration 20260820120500, not only by seed.sql
// ---------------------------------------------------------------------------------------------
describe('T-RLS-12 site_settings singleton', () => {
  it('T-RLS-12 the row exists after reset with defaults (count = 1, moderation_mode auto)', async () => {
    expect(sql('select count(*) from public.site_settings')).toEqual([['1']]);
    const row = await seedRow();
    expect(row?.id).toBe(1);
    expect(row?.moderation_mode).toBe('auto');
    expect(row?.comments_closed_default).toBe(false);
    expect(row?.admin_notify_emails).toEqual([]);
  });

  it('T-RLS-12 migration 20260820120500 alone creates the default row and re-applying it is a no-op', async () => {
    expect(fs.existsSync(DEFAULT_ROW_MIGRATION), DEFAULT_ROW_MIGRATION).toBe(true);
    const migration = fs.readFileSync(DEFAULT_ROW_MIGRATION, 'utf8');
    expect(migration).toMatch(
      /insert\s+into\s+public\.site_settings\s*\(\s*id\s*\)\s*values\s*\(\s*1\s*\)\s*on\s+conflict\b[\s\S]*?do\s+nothing/i,
    );

    // On top of the seeded row (what a local `db reset` and every later deploy see): a no-op.
    sql(migration);
    expect(sql('select count(*) from public.site_settings')).toEqual([['1']]);
    expect((await seedRow())?.kofi_page).toBe('oddsense');

    // On an empty table (what a fresh production / staging database sees): the defaults row, with no
    // reference to a seed profile (…0001 does not exist there).
    const removed = await service.from('site_settings').delete().eq('id', 1).select('id');
    expect(removed.error).toBeNull();
    expect(removed.data).toHaveLength(1);
    sql(migration);
    expect(sql('select count(*) from public.site_settings')).toEqual([['1']]);
    const row = await seedRow();
    expect(row?.id).toBe(1);
    expect(row?.moderation_mode).toBe('auto');
    expect(row?.comments_closed_default).toBe(false);
    expect(row?.admin_notify_emails).toEqual([]);
    expect(row?.owner_profile_id).toBeNull();

    restoreSeedRow();
    expect((await seedRow())?.kofi_page).toBe('oddsense');
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-12 select — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-12 site_settings select', () => {
  it.each(['anon', ...NON_ADMIN] as const)(
    'T-RLS-12 %s cannot read the base table',
    async (role) => {
      await expectPolicy({
        table: 'site_settings',
        op: 'select',
        role,
        allowed: false,
        filter: { id: 1 },
      });
    },
  );

  it.each(['admin', 'service'] as const)(
    'T-RLS-12 %s reads the row incl. secret-ish columns',
    async (role) => {
      const { data, error } = await asRole(role).from('site_settings').select('*');
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      const row = data?.[0];
      expect(row?.id).toBe(1);
      expect(row?.kofi_page).toBe('oddsense');
      expect(row?.moderation_mode).toBe('auto');
      expect(Object.keys(row ?? {})).toEqual(
        expect.arrayContaining(['discord_webhook_url', 'admin_notify_emails', 'announcement_md']),
      );
    },
  );
});

// ---------------------------------------------------------------------------------------------
// T-RLS-13 insert (row is seeded) — D | D | D | D | D | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-13 site_settings insert', () => {
  it.each(['anon', ...NON_ADMIN, 'admin'] as const)('T-RLS-13 %s cannot insert', async (role) => {
    await expectPolicy({
      table: 'site_settings',
      op: 'insert',
      role,
      allowed: false,
      row: { id: 1, kofi_page: 't_rls13' },
    });
    expect((await seedRow())?.kofi_page).toBe('oddsense');
  });

  it('T-RLS-13 service inserts the row (after removing the seeded one)', async () => {
    const removed = await service.from('site_settings').delete().eq('id', 1).select('id');
    expect(removed.error).toBeNull();
    expect(removed.data).toHaveLength(1);
    await expectPolicy({
      table: 'site_settings',
      op: 'insert',
      role: 'service',
      allowed: true,
      row: { ...SEED_ROW },
      expectRows: 1,
    });
    expect((await seedRow())?.owner_profile_id).toBe(SEED_USERS.oddsense);
  });

  it('T-RLS-13 a second row is impossible even for service (id = 1 check)', async () => {
    const { error } = await service.from('site_settings').insert({ id: 2, kofi_page: 't_rls13' });
    expect(error).not.toBeNull();
    expect(error?.code).toBe('23514'); // check_violation
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-14 update — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-14 site_settings update', () => {
  it.each(['anon', ...NON_ADMIN] as const)('T-RLS-14 %s cannot update', async (role) => {
    await expectPolicy({
      table: 'site_settings',
      op: 'update',
      role,
      allowed: false,
      filter: { id: 1 },
      patch: { announcement_md: 't_rls14' },
    });
    expect((await seedRow())?.announcement_md).toBeNull();
  });

  it('T-RLS-14 admin updates the row', async () => {
    await expectPolicy({
      table: 'site_settings',
      op: 'update',
      role: 'admin',
      allowed: true,
      filter: { id: 1 },
      patch: { announcement_md: 't_rls14 admin', moderation_mode: 'hold_first_time' },
      expectRows: 1,
    });
    const row = await seedRow();
    expect(row?.announcement_md).toBe('t_rls14 admin');
    expect(row?.moderation_mode).toBe('hold_first_time');
    expect(row?.updated_at).not.toBe(row?.created_at); // set_updated_at fired
    restoreSeedRow();
  });

  it('T-RLS-14 service updates the row', async () => {
    await expectPolicy({
      table: 'site_settings',
      op: 'update',
      role: 'service',
      allowed: true,
      filter: { id: 1 },
      patch: { announcement_md: 't_rls14 svc' },
      expectRows: 1,
    });
    expect((await seedRow())?.announcement_md).toBe('t_rls14 svc');
    restoreSeedRow();
    expect((await seedRow())?.announcement_md).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-15 delete — D | D | D | D | D | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-15 site_settings delete', () => {
  it.each(['anon', ...NON_ADMIN, 'admin'] as const)('T-RLS-15 %s cannot delete', async (role) => {
    await expectPolicy({
      table: 'site_settings',
      op: 'delete',
      role,
      allowed: false,
      filter: { id: 1 },
    });
    expect(await seedRow()).not.toBeNull();
  });

  it('T-RLS-15 service deletes the row (then the seed is restored)', async () => {
    await expectPolicy({
      table: 'site_settings',
      op: 'delete',
      role: 'service',
      allowed: true,
      filter: { id: 1 },
      expectRows: 1,
    });
    expect(await seedRow()).toBeNull();
    restoreSeedRow();
    expect((await seedRow())?.kofi_page).toBe('oddsense');
  });
});

// ---------------------------------------------------------------------------------------------
// S1.5 re-run — T-RLS-12 / T-RLS-14 after an `updateSettings` write (04 §1.3; 05 §8 row S1.5)
// ---------------------------------------------------------------------------------------------
describe('T-RLS-12 / T-RLS-14 after updateSettings (S1.5)', () => {
  it('T-RLS-14 the admin session writes through updateSettings; T-RLS-12 admin + service read the new values, every other role is still denied', async () => {
    expectOk(
      await callAction(
        updateSettings,
        {
          moderation_mode: 'hold_first_time',
          announcement_md: 't_rls14 action',
          discord_webhook_url: WEBHOOK,
          admin_notify_emails: ['seed-admin@localhost.test'],
          comments_closed_default: true,
        },
        { role: 'admin' },
      ),
    );

    for (const role of ['anon', ...NON_ADMIN] as const) {
      await expectPolicy({
        table: 'site_settings',
        op: 'select',
        role,
        allowed: false,
        filter: { id: 1 },
      });
      await expectPolicy({
        table: 'site_settings',
        op: 'update',
        role,
        allowed: false,
        filter: { id: 1 },
        patch: { announcement_md: 't_rls14 denied' },
      });
    }

    for (const role of ['admin', 'service'] as const) {
      const { data, error } = await asRole(role).from('site_settings').select('*').eq('id', 1);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0]?.moderation_mode).toBe('hold_first_time');
      expect(data?.[0]?.announcement_md).toBe('t_rls14 action');
      expect(data?.[0]?.discord_webhook_url).toBe(WEBHOOK);
      expect(data?.[0]?.admin_notify_emails).toEqual(['seed-admin@localhost.test']);
      expect(data?.[0]?.comments_closed_default).toBe(true);
    }
    expect(sql('select count(*) from public.site_settings')).toEqual([['1']]);

    restoreSeedRow();
    expect((await seedRow())?.moderation_mode).toBe('auto');
    expect((await seedRow())?.discord_webhook_url).toBeNull();
  });
});
