/**
 * tests/db/actions/updateProfile.test.ts — T-ACT-4 / T-ACT-5 / T-ACT-6 (05 §7.2; 04 §1.1
 * `updateProfile`; ADR-0002 #27 rename 1 / 7 days from `profiles.handle_changed_at`).
 *
 * Success rows run on factory users (a seed row must not end up with an avatar or a new handle, H-1);
 * the D rows use seed roles (nothing is written). `public_profiles` visibility is asserted through the
 * anon client. "Comments by that user show the new handle" is a join, asserted in S1.4 (no comments yet).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { updateProfile } from '@/lib/actions/accounts';
import type { UpdateProfileInput } from '@/lib/actions/accounts.schema';
import { formatDay } from '@/lib/format/date';
import { RATE_LIMITED_MESSAGE } from '@/lib/rate-limit';
import { HANDLE_RESERVED, HANDLE_TAKEN, handleReason } from '@/lib/validation/handle';
import { freeHandle, patchProfile, readProfile } from '@/tests/helpers/arrange';
import { expectFail, expectOk } from '@/tests/helpers/actionResult';
import { asRole, SEED_ROLE_IDS } from '@/tests/helpers/asRole';
import { callAction, callActionAs, setupActionMocks } from '@/tests/helpers/callAction';
import { cleanupFactories, makeUser } from '@/tests/helpers/factories';
import { fixtureFile } from '@/tests/helpers/fixtures';
import { spyRevalidateTag } from '@/tests/helpers/spies';
import { listObjects } from '@/tests/helpers/storage';

setupActionMocks();

const tags = spyRevalidateTag();
const DAY_MS = 24 * 60 * 60 * 1000;

afterAll(async () => {
  await cleanupFactories();
});

async function avatarForm(fixture: string, extra: Record<string, string> = {}): Promise<FormData> {
  const form = new FormData();
  form.set('avatar', await fixtureFile('images', fixture));
  for (const [key, value] of Object.entries(extra)) form.set(key, value);
  return form;
}

// ---------------------------------------------------------------------------------------------
// T-ACT-4 — auth matrix (change avatar)
// ---------------------------------------------------------------------------------------------

describe('T-ACT-4 updateProfile auth matrix (change avatar)', () => {
  it('T-ACT-4 anon → unauthenticated', async () => {
    const res = await callAction(updateProfile, await avatarForm('avatar-600.png'), {
      role: 'anon',
    });
    expectFail(res, 'unauthenticated');
  });

  it('T-ACT-4 nohandle → onboarding_required, nothing written', async () => {
    const res = await callAction(updateProfile, await avatarForm('avatar-600.png'), {
      role: 'nohandle',
    });
    const error = expectFail(res, 'onboarding_required');
    expect(error.message).toBe('Pick a handle first.');
    expect((await readProfile(SEED_ROLE_IDS.nohandle))?.avatar_path).toBeNull();
    expect(await listObjects('avatars', SEED_ROLE_IDS.nohandle)).toEqual([]);
  });

  it.each([
    { label: 'user', overrides: {} },
    { label: 'banned', overrides: { banned: true } },
    { label: 'mod', overrides: { role: 'moderator' as const } },
    { label: 'admin', overrides: { role: 'admin' as const } },
  ])('T-ACT-4 $label (factory, own row) → ok with avatar_path set', async ({ overrides }) => {
    const id = await makeUser(overrides);
    const before = await readProfile(id);
    const data = expectOk(
      await callActionAs(updateProfile, await avatarForm('avatar-600.png'), { profileId: id }),
    );
    expect(data.handle).toBe(before?.handle);
    expect(data.avatar_path).toMatch(new RegExp(`^${id}/[0-9a-f]{16}\\.webp$`));
    const after = await readProfile(id);
    expect(after?.avatar_path).toBe(data.avatar_path);
    expect(after?.handle).toBe(before?.handle);
    expect(after?.handle_changed_at).toBeNull();
    expect(after?.role).toBe(before?.role);
    expect(after?.is_banned).toBe(before?.is_banned);
    expect(await listObjects('avatars', id)).toEqual([data.avatar_path]);
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-5 — handle change
// ---------------------------------------------------------------------------------------------

describe('T-ACT-5 updateProfile handle change', () => {
  it('T-ACT-5 same validation as onboarding: validation / handle_reserved / handle_taken', async () => {
    const id = await makeUser();
    const before = await readProfile(id);

    for (const handle of ['ab', 'a'.repeat(21), 'bad-name', 'bad@name']) {
      const error = expectFail(
        await callActionAs(updateProfile, { handle }, { profileId: id }),
        'validation',
      );
      expect(error.field).toBe('handle');
      expect(error.message).toBe(handleReason(handle));
    }
    for (const handle of ['Admin', 'odsens', 'MODS']) {
      const error = expectFail(
        await callActionAs(updateProfile, { handle }, { profileId: id }),
        'handle_reserved',
      );
      expect(error.message).toBe(HANDLE_RESERVED);
    }
    for (const handle of ['seed_user', 'SEED_USER', 'oddsense']) {
      // `oddsense` is reserved AND taken — reserved wins (04 §1.1 order: invalid → reserved → taken)
      const res = await callActionAs(updateProfile, { handle }, { profileId: id });
      if (handle === 'oddsense') {
        expectFail(res, 'handle_reserved');
      } else {
        expect(expectFail(res, 'handle_taken').message).toBe(HANDLE_TAKEN);
      }
    }
    expect(await readProfile(id)).toEqual(before);
  });

  it('T-ACT-5 the same handle in another case → ok no-op (no handle_changed_at)', async () => {
    const id = await makeUser();
    const before = await readProfile(id);
    const current = before?.handle ?? '';
    const data = expectOk(
      await callActionAs(updateProfile, { handle: current.toUpperCase() }, { profileId: id }),
    );
    expect(data.handle).toBe(current);
    const after = await readProfile(id);
    expect(after?.handle).toBe(current); // stored spelling untouched
    expect(after?.handle_changed_at).toBeNull();
  });

  it('T-ACT-5 rename → handle_changed_at = now(), visible in public_profiles; 2nd within 7 days → rate_limited; 8 days later → ok', async () => {
    const id = await makeUser();
    const first = freeHandle();
    const started = Date.now();

    const data = expectOk(await callActionAs(updateProfile, { handle: first }, { profileId: id }));
    expect(data.handle).toBe(first);
    const row = await readProfile(id);
    expect(row?.handle).toBe(first);
    const changedAt = new Date(row?.handle_changed_at ?? '').getTime();
    expect(Math.abs(changedAt - started)).toBeLessThan(60_000);

    const { data: pub, error } = await asRole('anon')
      .from('public_profiles')
      .select('id, handle')
      .eq('id', id)
      .maybeSingle();
    expect(error).toBeNull();
    expect(pub).toEqual({ id, handle: first });
    // Comments by this user show the new handle through a join on public_profiles — asserted in S1.4.

    const second = freeHandle();
    const limited = expectFail(
      await callActionAs(updateProfile, { handle: second }, { profileId: id }),
      'rate_limited',
    );
    expect(limited.field).toBe('handle');
    expect(limited.message).toBe(
      `You can change it again on ${formatDay(new Date(changedAt + 7 * DAY_MS))}.`,
    );
    expect(limited.message).toMatch(/^You can change it again on \d{4}-\d{2}-\d{2}\.$/);
    expect((await readProfile(id))?.handle).toBe(first);

    // 7-day rule counts from profiles.handle_changed_at (ADR-0002 #27): move it back 8 days.
    await patchProfile(id, { handle_changed_at: new Date(Date.now() - 8 * DAY_MS).toISOString() });
    expectOk(await callActionAs(updateProfile, { handle: second }, { profileId: id }));
    const after = await readProfile(id);
    expect(after?.handle).toBe(second);
    expect(new Date(after?.handle_changed_at ?? '').getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it('T-ACT-5 an invalid avatar does not leave a half-applied rename', async () => {
    const id = await makeUser();
    const before = await readProfile(id);
    const form = await avatarForm('bad.gif', { handle: freeHandle() });
    expectFail(await callActionAs(updateProfile, form, { profileId: id }), 'validation');
    expect(await readProfile(id)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-6 — avatar replace / remove / limit / stripped keys
// ---------------------------------------------------------------------------------------------

describe('T-ACT-6 updateProfile avatar effects', () => {
  it('T-ACT-6 new avatar → old object deleted after the new one exists; remove → NULL + object gone', async () => {
    const id = await makeUser();

    const first = expectOk(
      await callActionAs(updateProfile, await avatarForm('avatar-600.png'), { profileId: id }),
    ).avatar_path;
    expect(first).toBeTruthy();
    expect(await listObjects('avatars', id)).toEqual([first]);

    const second = expectOk(
      await callActionAs(updateProfile, await avatarForm('exif.jpg'), { profileId: id }),
    ).avatar_path;
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
    expect((await readProfile(id))?.avatar_path).toBe(second);
    expect(await listObjects('avatars', id)).toEqual([second]);

    const form = new FormData();
    form.set('removeAvatar', 'true');
    const removed = expectOk(await callActionAs(updateProfile, form, { profileId: id }));
    expect(removed.avatar_path).toBeNull();
    expect((await readProfile(id))?.avatar_path).toBeNull();
    expect(await listObjects('avatars', id)).toEqual([]);

    // removing when there is nothing is still ok
    expect(
      expectOk(await callActionAs(updateProfile, { removeAvatar: true }, { profileId: id }))
        .avatar_path,
    ).toBeNull();
  });

  it('T-ACT-6 11th avatar change in 10 minutes → rate_limited', async () => {
    const id = await makeUser();
    for (let i = 0; i < 10; i += 1) {
      // every attempt records an `avatar` hit before the bytes are looked at (04 §5.5)
      expectFail(
        await callActionAs(updateProfile, await avatarForm('bad.gif'), { profileId: id }),
        'validation',
      );
    }
    const error = expectFail(
      await callActionAs(updateProfile, await avatarForm('avatar-600.png'), { profileId: id }),
      'rate_limited',
    );
    expect(error.message).toBe(RATE_LIMITED_MESSAGE);
    expect((await readProfile(id))?.avatar_path).toBeNull();
    expect(await listObjects('avatars', id)).toEqual([]);
  });

  it('T-ACT-6 role / is_banned keys are stripped (FormData and object) — row unchanged, ok', async () => {
    const id = await makeUser();
    const before = await readProfile(id);

    const form = new FormData();
    form.set('removeAvatar', 'true');
    form.set('role', 'admin');
    form.set('is_banned', 'true');
    form.set('comment_count', '99');
    form.set('handle_changed_at', '2020-01-01T00:00:00Z');
    expectOk(await callActionAs(updateProfile, form, { profileId: id }));

    const sneaky = {
      removeAvatar: true,
      role: 'admin',
      is_banned: true,
      email_hash: 'x',
    } as unknown as UpdateProfileInput;
    expectOk(await callActionAs(updateProfile, sneaky, { profileId: id }));

    const after = await readProfile(id);
    expect(after?.role).toBe('user');
    expect(after?.is_banned).toBe(false);
    expect(after?.comment_count).toBe(before?.comment_count);
    expect(after?.handle_changed_at).toBeNull();
    expect(after?.email_hash).toBeNull();
    expect(after?.handle).toBe(before?.handle);
  });

  it('T-ACT-6 no revalidateTag call anywhere in this file', () => {
    expect(tags.calls).toEqual([]);
  });
});
