/**
 * tests/db/actions/deleteAccount.test.ts — T-ACT-65 (05 §7.2; 04 §1.1 `deleteAccount`; ADR-0002 #28).
 *
 * S1.1 scope: auth matrix, `{confirm:false}` → validation, avatar object removed, `auth.users` row gone
 * (profiles cascades), session cookies cleared, one `delete_account` hit recorded (1 / day). The comment /
 * like / report cascade and `revalidateTag('project:<slug>')` are S1.4 — those tables do not exist yet
 * (the action carries the `// S1.4` marker). Success rows run on factory users only (a deleted seed user
 * would break every later file).
 *
 * ADR-0021 (David's S1.1 merge decision): banned accounts may delete themselves — the banned cell is
 * A (onboarded) via `requireOnboarded({allowBanned:true})`; a banned account with a NULL handle still
 * gets `onboarding_required` (removal under a ban before onboarding stays an admin act, ADR-0019).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { deleteAccount } from '@/lib/actions/accounts';
import type { DeleteAccountInput } from '@/lib/actions/accounts.schema';
import { RATE_LIMITED_MESSAGE } from '@/lib/rate-limit';
import { countRateLimitHits, readProfile } from '@/tests/helpers/arrange';
import { expectFail, expectOk } from '@/tests/helpers/actionResult';
import { asRole, SEED_ROLE_IDS } from '@/tests/helpers/asRole';
import {
  callAction,
  callActionAs,
  lastActionCookies,
  setupActionMocks,
} from '@/tests/helpers/callAction';
import { cleanupFactories, makeUser } from '@/tests/helpers/factories';
import { spyRevalidateTag } from '@/tests/helpers/spies';
import { listObjects, uploadFixture } from '@/tests/helpers/storage';

setupActionMocks();

const tags = spyRevalidateTag();

afterAll(async () => {
  await cleanupFactories();
});

async function authUserExists(id: string): Promise<boolean> {
  const { data, error } = await asRole('service').auth.admin.getUserById(id);
  if (error) return false;
  return data.user !== null;
}

describe('T-ACT-65 deleteAccount', () => {
  it('T-ACT-65 anon → unauthenticated', async () => {
    expectFail(
      await callAction(deleteAccount, { confirm: true }, { role: 'anon' }),
      'unauthenticated',
    );
  });

  it('T-ACT-65 nohandle → onboarding_required, no hit recorded', async () => {
    expectFail(
      await callAction(deleteAccount, { confirm: true }, { role: 'nohandle' }),
      'onboarding_required',
    );
    expect(await authUserExists(SEED_ROLE_IDS.nohandle)).toBe(true);
    expect(await countRateLimitHits('delete_account', SEED_ROLE_IDS.nohandle)).toBe(0);
  });

  it('T-ACT-65 {confirm:false} → validation before anything (seed_user untouched)', async () => {
    const error = expectFail(
      await callAction(deleteAccount, { confirm: false } as unknown as DeleteAccountInput, {
        role: 'user',
      }),
      'validation',
    );
    expect(error.issues?.[0]?.path).toBe('confirm');
    expect(error.issues?.[0]?.message).toBe('Confirm first.');
    expect(await authUserExists(SEED_ROLE_IDS.user)).toBe(true);
    expect(await countRateLimitHits('delete_account', SEED_ROLE_IDS.user)).toBe(0);
  });

  it('T-ACT-65 user with an avatar → ok; object removed, auth user + profile gone, cookies cleared, one hit', async () => {
    const id = await makeUser();
    const avatarPath = `${id}/0123456789abcdef.webp`;
    await uploadFixture('avatars', avatarPath, 'images/tiny.webp');
    const { error: patchError } = await asRole('service')
      .from('profiles')
      .update({ avatar_path: avatarPath })
      .eq('id', id);
    expect(patchError).toBeNull();
    expect(await listObjects('avatars', id)).toEqual([avatarPath]);

    const data = expectOk(await callActionAs(deleteAccount, { confirm: true }, { profileId: id }));
    expect(data).toEqual({ deleted: true });

    expect(await listObjects('avatars', id)).toEqual([]);
    expect(await authUserExists(id)).toBe(false);
    expect(await readProfile(id)).toBeNull();
    const jar = lastActionCookies().getAll();
    expect(jar.filter((c) => /^sb-.+-auth-token/.test(c.name))).toEqual([]);
    expect(await countRateLimitHits('delete_account', id)).toBe(1);
    // S1.4: comments → status 'deleted', likes/reports removed, revalidateTag('project:<slug>') per target.
    expect(tags.calls).toEqual([]);
  });

  it.each([
    { label: 'mod', overrides: { role: 'moderator' as const } },
    { label: 'admin', overrides: { role: 'admin' as const } },
  ])('T-ACT-65 $label (factory) → ok, auth user gone', async ({ overrides }) => {
    const id = await makeUser(overrides);
    expectOk(await callActionAs(deleteAccount, { confirm: true }, { profileId: id }));
    expect(await authUserExists(id)).toBe(false);
    expect(await readProfile(id)).toBeNull();
  });

  it('T-ACT-65 banned (factory, with avatar) → ok — banned accounts may delete themselves (ADR-0021)', async () => {
    const id = await makeUser({ banned: true });
    const avatarPath = `${id}/0123456789abcdef.webp`;
    await uploadFixture('avatars', avatarPath, 'images/tiny.webp');
    const { error: patchError } = await asRole('service')
      .from('profiles')
      .update({ avatar_path: avatarPath })
      .eq('id', id);
    expect(patchError).toBeNull();

    const data = expectOk(await callActionAs(deleteAccount, { confirm: true }, { profileId: id }));
    expect(data).toEqual({ deleted: true });

    expect(await listObjects('avatars', id)).toEqual([]);
    expect(await authUserExists(id)).toBe(false);
    expect(await readProfile(id)).toBeNull();
    expect(await countRateLimitHits('delete_account', id)).toBe(1);
  });

  it('T-ACT-65 banned with a NULL handle → onboarding_required; auth user survives, no hit (ADR-0021)', async () => {
    const id = await makeUser({ banned: true, handle: null });
    expectFail(
      await callActionAs(deleteAccount, { confirm: true }, { profileId: id }),
      'onboarding_required',
    );
    expect(await authUserExists(id)).toBe(true);
    expect((await readProfile(id))?.is_banned).toBe(true);
    expect(await countRateLimitHits('delete_account', id)).toBe(0);
  });

  it('T-ACT-65 deleting only touches the caller (own only): other rows survive', async () => {
    const victim = await makeUser();
    const me = await makeUser();
    expectOk(await callActionAs(deleteAccount, { confirm: true }, { profileId: me }));
    expect(await authUserExists(victim)).toBe(true);
    expect(await authUserExists(SEED_ROLE_IDS.user)).toBe(true);
  });

  it('T-ACT-65 second call the same day → rate_limited (1 / day), user still exists', async () => {
    // A deleted user cannot call again, so the "same day" hit is recorded through the RPC first:
    // the limiter keys on the profile id, exactly what a repeat call would count.
    const id = await makeUser();
    const { data: first, error } = await asRole('service').rpc('rate_limit_ok', {
      p_scope: 'delete_account',
      p_key: id,
      p_max: 1,
      p_window: '1 day',
    });
    expect(error).toBeNull();
    expect(first).toBe(true);

    const limited = expectFail(
      await callActionAs(deleteAccount, { confirm: true }, { profileId: id }),
      'rate_limited',
    );
    expect(limited.message).toBe(RATE_LIMITED_MESSAGE);
    expect(await authUserExists(id)).toBe(true);
    expect(await countRateLimitHits('delete_account', id)).toBe(2);
  });
});
