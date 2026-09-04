/**
 * tests/db/rls/notification_recipients.test.ts — RLS matrix for `notification_recipients`
 * (docs/build/05-test-plan.md §7.1 T-RLS-94..97 + the `updated_at` clause of T-RLS-126;
 * data-model §2.6 / §4; docs/notifications.md "Data" / "Pipeline"; 04 §3.6 F2/F3; 01 INV-70).
 * Policies: supabase/migrations/20260903120100_notification_recipients.sql — select / update / delete
 * = `is_admin()`; insert = NO policy and no JWT insert grant (service only — `notifyFanOut` writes
 * through the service client; the admin cell is D). Cell order of every cell comment:
 * anon | user | banned | mod | admin | svc.
 *
 * SEED-12 keeps the table at 0 rows, so every row is arranged through service (`makeNotificationEvent`
 * + `makeRecipient`) and removed again in `afterAll` (`cleanupFactories`, then `purgeNotificationEvents`
 * for the untracked rows — H-1). `address` masking (`…<last 4>`) is an app rule (04 F2), not a column
 * rule: the admin select cell only proves the row — `address` included — is readable.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { asRole, loose, type TestRole } from '@/tests/helpers/asRole';
import { expectPolicy } from '@/tests/helpers/expectPolicy';
import {
  cleanupFactories,
  makeNotificationEvent,
  makeRecipient,
  makeUser,
  purgeNotificationEvents,
} from '@/tests/helpers/factories';

const NON_ADMIN = ['anon', 'user', 'banned', 'mod'] as const satisfies readonly TestRole[];
const NON_SERVICE = [...NON_ADMIN, 'admin'] as const satisfies readonly TestRole[];
const service = asRole('service');

const ADMIN_ADDRESS = 'seed-admin@localhost.test';
const WEBHOOK = 'https://discord.com/api/webhooks/123/t_rls94token';

/** One pending email row on a fresh `comment.new` event — the fan-out shape (04 F2). */
async function arrangeRow(
  overrides: Parameters<typeof makeRecipient>[0] = {},
): Promise<{ eventId: string; id: string }> {
  const eventId = await makeNotificationEvent();
  const id = await makeRecipient({ event_id: eventId, address: ADMIN_ADDRESS, ...overrides });
  return { eventId, id };
}

async function readRow(id: string) {
  const { data, error } = await service
    .from('notification_recipients')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`service could not read notification_recipients: ${error.message}`);
  return data;
}

async function countRows(): Promise<number> {
  const { count, error } = await service
    .from('notification_recipients')
    .select('*', { count: 'exact', head: true });
  if (error) throw new Error(`service could not count notification_recipients: ${error.message}`);
  return count ?? 0;
}

afterAll(async () => {
  await cleanupFactories();
  await purgeNotificationEvents();
});

// ---------------------------------------------------------------------------------------------
// T-RLS-94 select — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-94 notification_recipients select', () => {
  it.each(NON_ADMIN)('T-RLS-94 %s cannot read a recipient row', async (role) => {
    const { id } = await arrangeRow();
    await expectPolicy({
      table: 'notification_recipients',
      op: 'select',
      role,
      allowed: false,
      filter: { id },
    });
  });

  it.each(['admin', 'service'] as const)(
    'T-RLS-94 %s reads the row, address included (masking is the app’s job — 04 F2)',
    async (role) => {
      const { id, eventId } = await arrangeRow();
      await expectPolicy({
        table: 'notification_recipients',
        op: 'select',
        role,
        allowed: true,
        filter: { id },
        expectRows: 1,
      });
      const { data, error } = await asRole(role)
        .from('notification_recipients')
        .select('event_id, profile_id, channel, address, status, attempts, sent_at, error')
        .eq('id', id)
        .single();
      expect(error).toBeNull();
      expect(data).toEqual({
        event_id: eventId,
        profile_id: null,
        channel: 'email',
        address: ADMIN_ADDRESS,
        status: 'pending',
        attempts: 0,
        sent_at: null,
        error: null,
      });
    },
  );
});

// ---------------------------------------------------------------------------------------------
// T-RLS-95 insert — D | D | D | D | D | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-95 notification_recipients insert', () => {
  it.each(NON_SERVICE)('T-RLS-95 %s cannot insert a recipient row', async (role) => {
    const eventId = await makeNotificationEvent();
    const before = await countRows();
    await expectPolicy({
      table: 'notification_recipients',
      op: 'insert',
      role,
      allowed: false,
      row: { event_id: eventId, channel: 'email', address: ADMIN_ADDRESS },
    });
    expect(await countRows()).toBe(before);
  });

  it('T-RLS-95 service inserts the fan-out rows (defaults: pending, 0 attempts, profile_id null)', async () => {
    const eventId = await makeNotificationEvent({ kind: 'comment.held' });
    await expectPolicy({
      table: 'notification_recipients',
      op: 'insert',
      role: 'service',
      allowed: true,
      row: { event_id: eventId, channel: 'email', address: ADMIN_ADDRESS },
      expectRows: 1,
    });
    await expectPolicy({
      table: 'notification_recipients',
      op: 'insert',
      role: 'service',
      allowed: true,
      row: { event_id: eventId, channel: 'discord', address: WEBHOOK },
      expectRows: 1,
    });
    const { data, error } = await service
      .from('notification_recipients')
      .select('channel, address, status, attempts, profile_id, sent_at, error')
      .eq('event_id', eventId);
    expect(error).toBeNull();
    // Sorted here: `channel` is an enum, which PostgREST orders by declaration order.
    expect([...(data ?? [])].sort((a, b) => a.channel.localeCompare(b.channel))).toEqual([
      {
        channel: 'discord',
        address: WEBHOOK,
        status: 'pending',
        attempts: 0,
        profile_id: null,
        sent_at: null,
        error: null,
      },
      {
        channel: 'email',
        address: ADMIN_ADDRESS,
        status: 'pending',
        attempts: 0,
        profile_id: null,
        sent_at: null,
        error: null,
      },
    ]);
  });

  it("T-RLS-95 the unique index (event_id, channel, coalesce(address, '')) refuses a duplicate address (23505) — 04 F3 / INV-70", async () => {
    const { eventId } = await arrangeRow();
    const dup = await service
      .from('notification_recipients')
      .insert({ event_id: eventId, channel: 'email', address: ADMIN_ADDRESS });
    expect(dup.error?.code).toBe('23505');
    // Another address on the same (event, channel) and the same address on another channel are new keys.
    const other = await service
      .from('notification_recipients')
      .insert({ event_id: eventId, channel: 'email', address: 'seed-mod@localhost.test' })
      .select('id');
    expect(other.error).toBeNull();
    expect(other.data).toHaveLength(1);
    const otherChannel = await service
      .from('notification_recipients')
      .insert({ event_id: eventId, channel: 'discord', address: ADMIN_ADDRESS })
      .select('id');
    expect(otherChannel.error).toBeNull();
    expect(otherChannel.data).toHaveLength(1);
  });

  it('T-RLS-95 two NULL-address rows for one (event, channel) collide too (skipped rows are idempotent)', async () => {
    const eventId = await makeNotificationEvent({ kind: 'comment.reply' });
    const first = await service
      .from('notification_recipients')
      .insert({ event_id: eventId, channel: 'discord', address: null, status: 'skipped' })
      .select('id');
    expect(first.error).toBeNull();
    const second = await service
      .from('notification_recipients')
      .insert({ event_id: eventId, channel: 'discord', address: null, status: 'skipped' });
    expect(second.error?.code).toBe('23505');
    const { count } = await service
      .from('notification_recipients')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', eventId);
    expect(count).toBe(1);
  });

  it('T-RLS-95 status is the enum (22P02) and event_id must exist (23503)', async () => {
    const { eventId } = await arrangeRow();
    const badStatus = await loose(service).from('notification_recipients').insert({
      event_id: eventId,
      channel: 'email',
      address: 't_rls95@localhost.test',
      status: 'bogus',
    });
    expect(badStatus.error?.code).toBe('22P02');
    const orphan = await service.from('notification_recipients').insert({
      event_id: '00000000-0000-4000-8000-0000000000ff',
      channel: 'email',
      address: 't_rls95@localhost.test',
    });
    expect(orphan.error?.code).toBe('23503');
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-96 update — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-96 notification_recipients update', () => {
  it.each(NON_ADMIN)('T-RLS-96 %s cannot mark a row', async (role) => {
    const { id } = await arrangeRow();
    await expectPolicy({
      table: 'notification_recipients',
      op: 'update',
      role,
      allowed: false,
      filter: { id },
      patch: { status: 'sent' },
    });
    expect((await readRow(id))?.status).toBe('pending');
  });

  it.each(['admin', 'service'] as const)(
    'T-RLS-96 %s marks a row sent (the 04 N4 shape)',
    async (role) => {
      const { id } = await arrangeRow();
      const sentAt = new Date().toISOString();
      await expectPolicy({
        table: 'notification_recipients',
        op: 'update',
        role,
        allowed: true,
        filter: { id },
        patch: { status: 'sent', sent_at: sentAt, attempts: 1 },
        expectRows: 1,
      });
      const row = await readRow(id);
      expect(row?.status).toBe('sent');
      expect(row?.attempts).toBe(1);
      expect(row?.sent_at).not.toBeNull();
    },
  );

  it('T-RLS-126 updated_at moves on every notification_recipients update (the N1 backoff clock)', async () => {
    const { id } = await arrangeRow();
    const before = (await readRow(id))?.updated_at ?? '';
    const { error } = await service
      .from('notification_recipients')
      .update({ attempts: 1, error: 't_rls126 upstream 500' })
      .eq('id', id);
    expect(error).toBeNull();
    const after = (await readRow(id))?.updated_at ?? '';
    expect(new Date(after).getTime()).toBeGreaterThan(new Date(before).getTime());
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-97 delete — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-97 notification_recipients delete', () => {
  it.each(NON_ADMIN)('T-RLS-97 %s cannot delete a row', async (role) => {
    const { id } = await arrangeRow();
    await expectPolicy({
      table: 'notification_recipients',
      op: 'delete',
      role,
      allowed: false,
      filter: { id },
    });
    expect(await readRow(id)).not.toBeNull();
  });

  it.each(['admin', 'service'] as const)('T-RLS-97 %s deletes a row', async (role) => {
    const { id } = await arrangeRow();
    await expectPolicy({
      table: 'notification_recipients',
      op: 'delete',
      role,
      allowed: true,
      filter: { id },
      expectRows: 1,
    });
    expect(await readRow(id)).toBeNull();
  });

  it('T-RLS-97 rows cascade with their event; profile_id nulls when the profile goes', async () => {
    const { id, eventId } = await arrangeRow();
    const removed = await service
      .from('notification_events')
      .delete()
      .eq('id', eventId)
      .select('id');
    expect(removed.error).toBeNull();
    expect(removed.data).toHaveLength(1);
    expect(await readRow(id)).toBeNull();

    const profileId = await makeUser({ role: 'admin' });
    const withProfile = await arrangeRow({ profile_id: profileId });
    expect((await readRow(withProfile.id))?.profile_id).toBe(profileId);
    const { error } = await service.auth.admin.deleteUser(profileId);
    expect(error).toBeNull();
    const row = await readRow(withProfile.id);
    expect(row).not.toBeNull();
    expect(row?.profile_id).toBeNull();
  });
});
