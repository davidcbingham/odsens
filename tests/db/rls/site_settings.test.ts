/**
 * tests/db/rls/site_settings.test.ts — RLS matrix for the single-row `site_settings` base table
 * (docs/build/05-test-plan.md §7.1 T-RLS-12..15; data-model §2.4/§4). Public read is the view
 * `site_settings_public` (T-RLS-132, its own file). Policies: 20260820120100_site_settings.sql.
 * Cell order: anon | user | banned | mod | admin | svc.
 *
 * `mutatesSeed` (H-1): admin/service cells write the SEED-1 row; `afterAll` restores it via psql.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { asRole, type TestRole } from '@/tests/helpers/asRole';
import { sql } from '@/tests/helpers/db';
import { expectPolicy } from '@/tests/helpers/expectPolicy';
import { SEED_USERS } from '@/tests/helpers/seedIds';

const NON_ADMIN = ['user', 'banned', 'mod'] as const satisfies readonly TestRole[];
const service = asRole('service');

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
