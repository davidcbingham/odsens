/**
 * tests/db/actions/completeOnboarding.test.ts — T-ACT-1 / T-ACT-2 / T-ACT-3 (05 §7.2; 04 §1.1
 * `completeOnboarding`; 01 INV-47; ADR-0002 #63).
 *
 * Subjects: the seed `nohandle` user for the one "nohandle → A" row (`mutatesSeed` — the handle is set
 * back to NULL and its onboarding hits are forgotten right after, H-1) and factory users (`makeUser({
 * handle: null })`) everywhere a success or a rate-limit counter would otherwise stick to a seed row.
 * Every call records one `onboarding` hit (the limiter runs before `check_handle`), so validation loops
 * clear the subject's hits between cases instead of burning through the 10 / 10 min budget.
 */
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { completeOnboarding } from '@/lib/actions/accounts';
import { avatarTooSmall } from '@/lib/files';
import { RATE_LIMITED_MESSAGE } from '@/lib/rate-limit';
import { sizeLimitMessage, typeMessage } from '@/lib/validation/files';
import {
  HANDLE_RESERVED,
  HANDLE_TAKEN,
  REASON_CHARSET,
  RESERVED_HANDLES,
  handleReason,
} from '@/lib/validation/handle';
import { sha256Hex } from '@/lib/hash';
import {
  clearRateLimitHits,
  countRateLimitHits,
  freeHandle,
  patchProfile,
  readProfile,
} from '@/tests/helpers/arrange';
import { expectFail, expectOk } from '@/tests/helpers/actionResult';
import { asRole, SEED_ROLE_IDS, type SeedRole } from '@/tests/helpers/asRole';
import { callAction, callActionAs, setupActionMocks } from '@/tests/helpers/callAction';
import { expectInternal, withDbFault, withDbHook } from '@/tests/helpers/dbFault';
import { cleanupFactories, makeUser } from '@/tests/helpers/factories';
import { fixtureFile } from '@/tests/helpers/fixtures';
import { spyLog, spyRevalidateTag, type LogSpy } from '@/tests/helpers/spies';
import { listObjects } from '@/tests/helpers/storage';

setupActionMocks();

const tags = spyRevalidateTag();

afterAll(async () => {
  await cleanupFactories();
});

function onboardingForm(handle: string, avatar?: File): FormData {
  const form = new FormData();
  form.set('handle', handle);
  if (avatar) form.set('avatar', avatar);
  return form;
}

// ---------------------------------------------------------------------------------------------
// T-ACT-1 — auth matrix
// ---------------------------------------------------------------------------------------------

describe('T-ACT-1 completeOnboarding auth matrix', () => {
  it('T-ACT-1 anon → unauthenticated', async () => {
    const res = await callAction(completeOnboarding, { handle: freeHandle() }, { role: 'anon' });
    expectFail(res, 'unauthenticated');
  });

  it('T-ACT-1 nohandle (seed_newbie) → ok, handle set [mutatesSeed: restored]', async () => {
    const id = SEED_ROLE_IDS.nohandle;
    const handle = freeHandle();
    try {
      const data = expectOk(await callAction(completeOnboarding, { handle }, { role: 'nohandle' }));
      expect(data).toEqual({ handle, avatar_path: null });
      const row = await readProfile(id);
      expect(row?.handle).toBe(handle);
      expect(row?.handle_changed_at).toBeNull(); // a first handle is not a "change" (04 §1.1)
      expect(row?.role).toBe('user');
    } finally {
      await patchProfile(id, { handle: null });
      await clearRateLimitHits('onboarding', id);
    }
    expect((await readProfile(id))?.handle).toBeNull();
  });

  it('T-ACT-1 banned with a null handle (factory) → banned; handle stays null, no hit (ADR-0019)', async () => {
    const id = await makeUser({ banned: true, handle: null });
    const error = expectFail(
      await callActionAs(completeOnboarding, { handle: freeHandle() }, { profileId: id }),
      'banned',
    );
    expect(error.message).toBe('This account is banned.');
    const row = await readProfile(id);
    expect(row?.handle).toBeNull();
    expect(row?.is_banned).toBe(true);
    // `requireUser` throws before the limiter (04 SC-05: before touching the DB for the action).
    expect(await countRateLimitHits('onboarding', id)).toBe(0);
  });

  it('T-ACT-1 banned (seed, already onboarded) → banned — before the conflict check; row unchanged (ADR-0019)', async () => {
    const before = await readProfile(SEED_ROLE_IDS.banned);
    const res = await callAction(completeOnboarding, { handle: freeHandle() }, { role: 'banned' });
    expect(expectFail(res, 'banned').message).toBe('This account is banned.');
    expect(await readProfile(SEED_ROLE_IDS.banned)).toEqual(before);
  });

  it.each<SeedRole>(['user', 'mod', 'admin'])(
    'T-ACT-1 %s (already onboarded) → conflict, row unchanged',
    async (role) => {
      const before = await readProfile(SEED_ROLE_IDS[role]);
      const res = await callAction(completeOnboarding, { handle: freeHandle() }, { role });
      const error = expectFail(res, 'conflict');
      expect(error.message).toBe('You already have a handle.');
      expect(await readProfile(SEED_ROLE_IDS[role])).toEqual(before);
    },
  );
});

// ---------------------------------------------------------------------------------------------
// T-ACT-2 — handle validation (H1–H5) + rate limit
// ---------------------------------------------------------------------------------------------

describe('T-ACT-2 completeOnboarding handle validation', () => {
  let subject: string;

  beforeAll(async () => {
    subject = await makeUser({ handle: null });
  });

  beforeEach(async () => {
    await clearRateLimitHits('onboarding', subject);
  });

  const structural = [
    'ab',
    'a'.repeat(21),
    'bad-name',
    'bad.name',
    'bad name',
    'bad@name',
    '@handle',
    'someone@localhost.test',
  ];

  it.each(structural)('T-ACT-2 H1 "%s" → validation with the plain reason', async (handle) => {
    const res = await callActionAs(completeOnboarding, { handle }, { profileId: subject });
    const error = expectFail(res, 'validation');
    expect(error.field).toBe('handle');
    expect(error.message).toBe(handleReason(handle));
    expect(error.issues).toEqual([{ path: 'handle', message: handleReason(handle) }]);
    expect((await readProfile(subject))?.handle).toBeNull();
  });

  it('T-ACT-2 H3 list has the 22 entries of 04 §1.1 in order', () => {
    expect(RESERVED_HANDLES).toHaveLength(22);
    expect(RESERVED_HANDLES.slice(0, 5)).toEqual([
      'admin',
      'administrator',
      'oddsense',
      'odsens',
      'moderator',
    ]);
  });

  it.each([...RESERVED_HANDLES])('T-ACT-2 H3 reserved "%s" → handle_reserved', async (entry) => {
    const res = await callActionAs(completeOnboarding, { handle: entry }, { profileId: subject });
    if (entry.length < 3) {
      // `me` can never be "reserved": H1 (3–20 chars) is checked first (04 §1.1 order invalid →
      // reserved → taken), so the RPC says 'invalid' and the action maps it to `validation`.
      const error = expectFail(res, 'validation');
      expect(error.message).toBe(handleReason(entry));
      return;
    }
    const error = expectFail(res, 'handle_reserved');
    expect(error.message).toBe(HANDLE_RESERVED);
    expect(error.field).toBe('handle');
  });

  it.each(['Admin', 'ODDSENSE', 'OdSens', 'Null', 'EVERYONE'])(
    'T-ACT-2 H3 is case-insensitive: "%s" → handle_reserved',
    async (entry) => {
      const res = await callActionAs(completeOnboarding, { handle: entry }, { profileId: subject });
      expectFail(res, 'handle_reserved');
    },
  );

  it.each(['seed_user', 'SEED_USER', 'Seed_User'])(
    'T-ACT-2 H2 taken "%s" → handle_taken (citext)',
    async (handle) => {
      const res = await callActionAs(completeOnboarding, { handle }, { profileId: subject });
      const error = expectFail(res, 'handle_taken');
      expect(error.message).toBe(HANDLE_TAKEN);
      expect(error.field).toBe('handle');
      expect((await readProfile(subject))?.handle).toBeNull();
    },
  );

  it('T-ACT-2 11th call in 10 minutes → rate_limited', async () => {
    const id = await makeUser({ handle: null });
    for (let i = 0; i < 10; i += 1) {
      // 'ab' never reaches a write, but every call records one `onboarding` hit (04 §5.5).
      expectFail(
        await callActionAs(completeOnboarding, { handle: 'ab' }, { profileId: id }),
        'validation',
      );
    }
    const res = await callActionAs(completeOnboarding, { handle: freeHandle() }, { profileId: id });
    const error = expectFail(res, 'rate_limited');
    expect(error.message).toBe(RATE_LIMITED_MESSAGE);
    expect((await readProfile(id))?.handle).toBeNull();
  });

  it('T-ACT-2 "Seed_User_9" → ok (last: it onboards the subject)', async () => {
    const data = expectOk(
      await callActionAs(completeOnboarding, { handle: 'Seed_User_9' }, { profileId: subject }),
    );
    expect(data).toEqual({ handle: 'Seed_User_9', avatar_path: null });
    expect((await readProfile(subject))?.handle).toBe('Seed_User_9');
    // and a second attempt is a conflict, not a rename
    expectFail(
      await callActionAs(completeOnboarding, { handle: freeHandle() }, { profileId: subject }),
      'conflict',
    );
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-3 — side effects (avatar pipeline, INV-47) + no revalidateTag
// ---------------------------------------------------------------------------------------------

async function downloadAvatar(path: string): Promise<Buffer> {
  const { data, error } = await asRole('service').storage.from('avatars').download(path);
  if (error || !data) throw new Error(`download ${path}: ${error?.message ?? 'no data'}`);
  return Buffer.from(await data.arrayBuffer());
}

describe('T-ACT-3 completeOnboarding side effects', () => {
  it('T-ACT-3 avatar-600.png → 512×512 WebP, metadata stripped, at avatars/<id>/<hash16>.webp', async () => {
    const id = await makeUser({ handle: null });
    const handle = freeHandle();
    const form = onboardingForm(handle, await fixtureFile('images', 'avatar-600.png'));
    const data = expectOk(await callActionAs(completeOnboarding, form, { profileId: id }));

    expect(data.handle).toBe(handle);
    expect(data.avatar_path).toMatch(new RegExp(`^${id}/[0-9a-f]{16}\\.webp$`));
    const avatarPath = data.avatar_path ?? '';
    const row = await readProfile(id);
    expect(row?.handle).toBe(handle);
    expect(row?.avatar_path).toBe(avatarPath);

    expect(await listObjects('avatars', id)).toEqual([avatarPath]);
    const bytes = await downloadAvatar(avatarPath);
    expect(bytes.byteLength).toBeLessThanOrEqual(1_048_576);
    const meta = await sharp(bytes).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(512);
    expect(meta.height).toBe(512);
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    // the source PNG carried tEXt chunks — none survives the re-encode
    expect(bytes.includes(Buffer.from('Software'))).toBe(false);
    // content-addressed: {hash16} = first 16 hex of sha256 over the RE-ENCODED bytes (04 SC-21)
    expect(avatarPath.endsWith(`/${sha256Hex(bytes).slice(0, 16)}.webp`)).toBe(true);
  });

  it('T-ACT-3 exif.jpg (orientation 6) → rotated, square, no EXIF left', async () => {
    const id = await makeUser({ handle: null });
    const form = onboardingForm(freeHandle(), await fixtureFile('images', 'exif.jpg'));
    const data = expectOk(await callActionAs(completeOnboarding, form, { profileId: id }));
    const meta = await sharp(await downloadAvatar(data.avatar_path ?? '')).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([512, 512, 'webp']);
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
  });

  const rejected: Array<{ fixture: string; source: 'images' | 'files'; message: string }> = [
    { source: 'images', fixture: 'bad.svg', message: typeMessage('svg', 'avatar') },
    { source: 'images', fixture: 'bad.gif', message: typeMessage('gif', 'avatar') },
    // PNG bytes behind a .jar name pass the magic-byte gate (it IS a png) and fail on size: 16×16
    { source: 'files', fixture: 'png-as.jar', message: avatarTooSmall(16, 16) },
    { source: 'images', fixture: 'tiny.jpg', message: avatarTooSmall(32, 32) },
  ];

  it.each(rejected)(
    'T-ACT-3 $fixture as avatar → validation, nothing written',
    async ({ source, fixture, message }) => {
      const id = await makeUser({ handle: null });
      const form = onboardingForm(freeHandle(), await fixtureFile(source, fixture));
      const error = expectFail(
        await callActionAs(completeOnboarding, form, { profileId: id }),
        'validation',
      );
      expect(error.field).toBe('avatar');
      expect(error.message).toBe(message);
      expect(error.issues).toEqual([{ path: 'avatar', message }]);
      const row = await readProfile(id);
      expect(row?.handle).toBeNull();
      expect(row?.avatar_path).toBeNull();
      expect(await listObjects('avatars', id)).toEqual([]);
    },
  );

  it('T-ACT-3 a File declaring > 1 MB → validation before decoding', async () => {
    const id = await makeUser({ handle: null });
    const file = await fixtureFile('images', 'avatar-600.png');
    Object.defineProperty(file, 'size', { value: 1_048_577 });
    const form = onboardingForm(freeHandle(), file);
    const error = expectFail(
      await callActionAs(completeOnboarding, form, { profileId: id }),
      'validation',
    );
    expect(error.field).toBe('avatar');
    expect(error.message).toBe(sizeLimitMessage(1_048_577, 'avatar'));
    expect(error.message).toMatch(/^That's 1 MB\. The limit is 1\.$/);
    expect((await readProfile(id))?.handle).toBeNull();
    expect(await listObjects('avatars', id)).toEqual([]);
  });

  it('T-ACT-3 a mislabelled File (png bytes typed image/jpeg) is judged by its bytes', async () => {
    const id = await makeUser({ handle: null });
    const file = await fixtureFile('images', 'avatar-600.png', {
      name: 'photo.jpg',
      type: 'image/jpeg',
    });
    const data = expectOk(
      await callActionAs(completeOnboarding, onboardingForm(freeHandle(), file), { profileId: id }),
    );
    expect(data.avatar_path).toMatch(/\.webp$/);
  });

  it('T-ACT-3 no revalidateTag call anywhere in this file (accounts touch no ISR tag)', () => {
    expect(tags.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-2 — the races between check_handle and the write (the unique index / the `.is('handle',
// null)` guard answer), the RPC's verdict over the TS rules, and DB faults (T-ACT-0 (1))
// ---------------------------------------------------------------------------------------------
describe('T-ACT-2 completeOnboarding races + DB faults', () => {
  let logs: LogSpy;

  beforeEach(() => {
    logs = spyLog();
  });

  afterEach(() => {
    logs.restore();
  });

  it('T-ACT-2 the handle is taken between check_handle and the write → handle_taken (the unique index answers), subject stays un-onboarded', async () => {
    const subject = await makeUser({ handle: null });
    const rival = await makeUser();
    const handle = freeHandle();
    const res = await withDbHook(
      { rpc: 'check_handle' },
      () => patchProfile(rival, { handle }),
      () => callActionAs(completeOnboarding, { handle }, { profileId: subject }),
      { when: 'after' },
    );
    const error = expectFail(res, 'handle_taken');
    expect(error.field).toBe('handle');
    expect((await readProfile(subject))?.handle).toBeNull();
    expect((await readProfile(rival))?.handle).toBe(handle);
  });

  it("T-ACT-2 a double submit: the subject's own handle lands between check_handle and the write → conflict", async () => {
    const subject = await makeUser({ handle: null });
    const handle = freeHandle();
    const res = await withDbHook(
      { rpc: 'check_handle' },
      () => patchProfile(subject, { handle }),
      () => callActionAs(completeOnboarding, { handle }, { profileId: subject }),
      { when: 'after' },
    );
    const error = expectFail(res, 'conflict');
    expect(error.message).toBe('You already have a handle.');
    expect((await readProfile(subject))?.handle).toBe(handle);
  });

  it("T-ACT-2 the RPC says 'invalid' for a handle the TS rules accept → validation with the charset line", async () => {
    const subject = await makeUser({ handle: null });
    const error = expectFail(
      await withDbFault({ rpc: 'check_handle' }, { result: { data: 'invalid', error: null } }, () =>
        callActionAs(completeOnboarding, { handle: freeHandle() }, { profileId: subject }),
      ),
      'validation',
    );
    expect(error.message).toBe(REASON_CHARSET);
    expect(error.issues).toEqual([{ path: 'handle', message: REASON_CHARSET }]);
    expect((await readProfile(subject))?.handle).toBeNull();
  });

  it('T-ACT-2 the profiles write fails → internal + one log.error line, subject stays un-onboarded', async () => {
    const subject = await makeUser({ handle: null });
    const res = await withDbFault({ table: 'profiles', op: 'update' }, {}, () =>
      callActionAs(completeOnboarding, { handle: freeHandle() }, { profileId: subject }),
    );
    expectInternal(res, 'completeOnboarding', logs);
    expect((await readProfile(subject))?.handle).toBeNull();
  });
});
