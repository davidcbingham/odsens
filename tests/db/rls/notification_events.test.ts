/**
 * tests/db/rls/notification_events.test.ts — RLS matrix for `notification_events`
 * (docs/build/05-test-plan.md §7.1 T-RLS-90..93; data-model §2.6 / §4; docs/notifications.md
 * "Data"; 04 SC-22). Policies: supabase/migrations/20260903090300_notification_events.sql — select /
 * update / delete = `is_admin()`; insert = NO policy and no JWT grant (service only — `lib/notify/
 * emit.ts` writes through the service client; the admin cell is D ⓘ). Cell order of every cell
 * comment: anon | user | banned | mod | admin | svc.
 *
 * SEED-12 keeps the table at 0 rows, so every row here is arranged through `service` and the
 * table is emptied again in `afterAll` (`purgeNotificationEvents`, H-1).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { asRole, type TestRole } from '@/tests/helpers/asRole';
import { expectPolicy } from '@/tests/helpers/expectPolicy';
import { purgeNotificationEvents } from '@/tests/helpers/factories';
import { SEED_COMMENTS, SEED_USERS } from '@/tests/helpers/seedIds';

const NON_ADMIN = ['anon', 'user', 'banned', 'mod'] as const satisfies readonly TestRole[];
const NON_SERVICE = [...NON_ADMIN, 'admin'] as const satisfies readonly TestRole[];
const service = asRole('service');

/** One event row through service — the shape `emit()` writes (04 SC-22 payload rules). */
async function arrangeEvent(kind = 'comment.new'): Promise<string> {
  const { data, error } = await service
    .from('notification_events')
    .insert({
      kind,
      actor_id: SEED_USERS.seed_user,
      subject_type: 'comment',
      subject_id: SEED_COMMENTS.published,
      payload: {
        comment_id: SEED_COMMENTS.published,
        author: { profile_id: SEED_USERS.seed_user, handle: 'seed_user' },
      },
    })
    .select('id')
    .single();
  if (error) throw new Error(`arrange: notification_events insert failed: ${error.message}`);
  return data.id;
}

async function eventExists(id: string): Promise<boolean> {
  const { data, error } = await service.from('notification_events').select('id').eq('id', id);
  if (error) throw new Error(`service could not read notification_events: ${error.message}`);
  return (data ?? []).length === 1;
}

afterAll(purgeNotificationEvents);

// ---------------------------------------------------------------------------------------------
// T-RLS-90 select — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-90 notification_events select', () => {
  it.each(NON_ADMIN)('T-RLS-90 %s cannot read an event', async (role) => {
    const id = await arrangeEvent();
    await expectPolicy({
      table: 'notification_events',
      op: 'select',
      role,
      allowed: false,
      filter: { id },
    });
  });

  it.each(['admin', 'service'] as const)('T-RLS-90 %s reads an event', async (role) => {
    const id = await arrangeEvent();
    await expectPolicy({
      table: 'notification_events',
      op: 'select',
      role,
      allowed: true,
      filter: { id },
      expectRows: 1,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-91 insert — D | D | D | D | D ⓘ | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-91 notification_events insert', () => {
  it.each(NON_SERVICE)('T-RLS-91 %s cannot insert an event', async (role) => {
    const before = await service
      .from('notification_events')
      .select('*', { count: 'exact', head: true });
    await expectPolicy({
      table: 'notification_events',
      op: 'insert',
      role,
      allowed: false,
      row: {
        kind: 'comment.new',
        subject_type: 'comment',
        subject_id: SEED_COMMENTS.published,
      },
    });
    const after = await service
      .from('notification_events')
      .select('*', { count: 'exact', head: true });
    expect(after.count).toBe(before.count);
  });

  it('T-RLS-91 service inserts an event (the emit() path)', async () => {
    await expectPolicy({
      table: 'notification_events',
      op: 'insert',
      role: 'service',
      allowed: true,
      row: {
        kind: 'comment.held',
        actor_id: SEED_USERS.seed_user2,
        subject_type: 'comment',
        subject_id: SEED_COMMENTS.held,
      },
      expectRows: 1,
    });
  });

  it('T-RLS-91 the kind CHECK refuses a name outside the catalog (23514)', async () => {
    const { error } = await service.from('notification_events').insert({
      kind: 'comment.unknown',
      subject_type: 'comment',
      subject_id: SEED_COMMENTS.published,
    });
    expect(error?.code).toBe('23514');
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-92 update — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-92 notification_events update', () => {
  it.each(NON_ADMIN)('T-RLS-92 %s cannot update an event', async (role) => {
    const id = await arrangeEvent();
    await expectPolicy({
      table: 'notification_events',
      op: 'update',
      role,
      allowed: false,
      filter: { id },
      patch: { subject_type: 't_rls92' },
    });
    const { data } = await service
      .from('notification_events')
      .select('subject_type')
      .eq('id', id)
      .single();
    expect(data?.subject_type).toBe('comment');
  });

  it.each(['admin', 'service'] as const)('T-RLS-92 %s updates an event', async (role) => {
    const id = await arrangeEvent();
    await expectPolicy({
      table: 'notification_events',
      op: 'update',
      role,
      allowed: true,
      filter: { id },
      patch: { subject_type: `t_rls92_${role}` },
      expectRows: 1,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-93 delete — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-93 notification_events delete', () => {
  it.each(NON_ADMIN)('T-RLS-93 %s cannot delete an event', async (role) => {
    const id = await arrangeEvent();
    await expectPolicy({
      table: 'notification_events',
      op: 'delete',
      role,
      allowed: false,
      filter: { id },
    });
    expect(await eventExists(id)).toBe(true);
  });

  it.each(['admin', 'service'] as const)('T-RLS-93 %s deletes an event', async (role) => {
    const id = await arrangeEvent();
    await expectPolicy({
      table: 'notification_events',
      op: 'delete',
      role,
      allowed: true,
      filter: { id },
      expectRows: 1,
    });
    expect(await eventExists(id)).toBe(false);
  });
});
