/**
 * tests/db/actions/deleteAccount.test.ts — T-ACT-65 (05 §7.2; 04 §1.1 `deleteAccount`; ADR-0002 #28).
 *
 * S1.1 scope: auth matrix, `{confirm:false}` → validation, avatar object removed, `auth.users` row gone
 * (profiles cascades), session cookies cleared, one `delete_account` hit recorded (1 / day). Success rows
 * run on factory users only (a deleted seed user would break every later file).
 *
 * S1.4 re-run (the last describe): a factory user with 2 comments (on two projects, one with a reply by
 * someone else), 1 like and 1 report → their comments become `status='deleted'` (rows + replies remain,
 * `author_id` NULL once the profile is gone), the like and the report are removed (`like_count`
 * re-triggered), avatar object removed, auth user gone, `revalidateTag('project:<slug>')` once per
 * distinct comment target — 04 §1.1; ADR-0002 #28.
 *
 * ADR-0021 (David's S1.1 merge decision): banned accounts may delete themselves — the banned cell is
 * A (onboarded) via `requireOnboarded({allowBanned:true})`; a banned account with a NULL handle still
 * gets `onboarding_required` (removal under a ban before onboarding stays an admin act, ADR-0019).
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
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
import { expectInternal, withDbFault, type DbCallTarget } from '@/tests/helpers/dbFault';
import {
  cleanupFactories,
  makeComment,
  makeUser,
  purgeNotificationEvents,
  restoreSeedCommentCounts,
} from '@/tests/helpers/factories';
import { SEED_COMMENTS, SEED_PROJECTS, SEED_USERS } from '@/tests/helpers/seedIds';
import { spyLog, spyRevalidateTag, type LogSpy } from '@/tests/helpers/spies';
import { listObjects, uploadFixture } from '@/tests/helpers/storage';

setupActionMocks();

const tags = spyRevalidateTag();

afterAll(async () => {
  await purgeNotificationEvents();
  await cleanupFactories();
  await restoreSeedCommentCounts();
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
    // No comments by this user → nothing to revalidate (the S1.4 cascade is the last describe).
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

// ---------------------------------------------------------------------------------------------
// T-ACT-65 — S1.4 comment cascade (04 §1.1; 05 §8 row S1.4 "cascade re-run")
// ---------------------------------------------------------------------------------------------
describe('T-ACT-65 deleteAccount comment cascade (S1.4)', () => {
  it('T-ACT-65 2 comments, 1 like, 1 report → comments deleted (replies remain), like + report gone, avatar removed, auth user gone, one revalidateTag per distinct target', async () => {
    const service = asRole('service');
    const me = await makeUser({ comment_count: 2 });
    const avatarPath = `${me}/0123456789abcdef.webp`;
    await uploadFixture('avatars', avatarPath, 'images/tiny.webp');
    const { error: patchError } = await service
      .from('profiles')
      .update({ avatar_path: avatarPath })
      .eq('id', me);
    expect(patchError).toBeNull();

    const rootOnChameleon = await makeComment({ author_id: me, body: 't_ T-ACT-65 root' });
    const rootOnMace = await makeComment({
      author_id: me,
      target_id: SEED_PROJECTS.metalPipeMace,
      body: 't_ T-ACT-65 elsewhere',
    });
    const replyByOther = await makeComment({
      author_id: SEED_USERS.seed_user,
      parent_id: rootOnChameleon,
    });
    const like = await service
      .from('comment_likes')
      .insert({ comment_id: SEED_COMMENTS.published, user_id: me });
    expect(like.error).toBeNull();
    const report = await service
      .from('comment_reports')
      .insert({ comment_id: SEED_COMMENTS.creatorReply, reporter_id: me, reason: 'spam' });
    expect(report.error).toBeNull();
    const liked = await service
      .from('comments')
      .select('like_count')
      .eq('id', SEED_COMMENTS.published)
      .single();
    expect(liked.data?.like_count).toBe(2);

    const cascadeTags = spyRevalidateTag();
    const data = expectOk(await callActionAs(deleteAccount, { confirm: true }, { profileId: me }));
    expect(data).toEqual({ deleted: true });

    // Comments: soft-deleted, body retained, author gone with the profile (FK on delete set null).
    const { data: mine } = await service
      .from('comments')
      .select('id, status, body, author_id')
      .in('id', [rootOnChameleon, rootOnMace])
      .order('body');
    expect(mine).toEqual([
      { id: rootOnMace, status: 'deleted', body: 't_ T-ACT-65 elsewhere', author_id: null },
      { id: rootOnChameleon, status: 'deleted', body: 't_ T-ACT-65 root', author_id: null },
    ]);
    const { data: reply } = await service
      .from('comments')
      .select('status, parent_id')
      .eq('id', replyByOther)
      .single();
    expect(reply).toEqual({ status: 'published', parent_id: rootOnChameleon });

    // Like + report by the user are gone; like_count re-triggered back to the seed value.
    const { data: likes } = await service.from('comment_likes').select('user_id').eq('user_id', me);
    expect(likes).toEqual([]);
    const { data: reports } = await service
      .from('comment_reports')
      .select('id')
      .eq('reporter_id', me);
    expect(reports).toEqual([]);
    const relike = await service
      .from('comments')
      .select('like_count')
      .eq('id', SEED_COMMENTS.published)
      .single();
    expect(relike.data?.like_count).toBe(1);

    // Account: avatar object removed, auth user + profile gone, one hit.
    expect(await listObjects('avatars', me)).toEqual([]);
    expect(await authUserExists(me)).toBe(false);
    expect(await readProfile(me)).toBeNull();
    expect(await countRateLimitHits('delete_account', me)).toBe(1);

    // One `project:<slug>` per distinct comment target, nothing else.
    expect([...cascadeTags.calls].sort()).toEqual([
      'project:metal-pipe-mace',
      'project:pixel-chameleon',
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-65 — a cascade step failing (T-ACT-0 (1)): internal, and the account is still there to
// retry (04 §1.1: the cascade runs BEFORE the avatar/auth deletion for exactly this reason)
// ---------------------------------------------------------------------------------------------
describe('T-ACT-65 deleteAccount cascade faults', () => {
  let logs: LogSpy;

  beforeEach(() => {
    logs = spyLog();
  });

  afterEach(() => {
    logs.restore();
  });

  it.each<{ name: string; target: DbCallTarget; commentDeleted: boolean }>([
    {
      name: 'the comments read',
      target: { table: 'comments', op: 'select' },
      commentDeleted: false,
    },
    {
      name: 'the comments cascade',
      target: { table: 'comments', op: 'update' },
      commentDeleted: false,
    },
    {
      name: 'the comment_likes cascade',
      target: { table: 'comment_likes', op: 'delete' },
      commentDeleted: true,
    },
    {
      name: 'the comment_reports cascade',
      target: { table: 'comment_reports', op: 'delete' },
      commentDeleted: true,
    },
    {
      name: 'the projects read for the tags',
      target: { table: 'projects', op: 'select' },
      commentDeleted: true,
    },
  ])(
    'T-ACT-65 $name fails → internal + one log.error line; auth user + profile survive, no revalidate',
    async ({ target, commentDeleted }) => {
      const me = await makeUser({ comment_count: 1 });
      const commentId = await makeComment({ author_id: me });
      const cascadeTags = spyRevalidateTag();
      const res = await withDbFault(target, {}, () =>
        callActionAs(deleteAccount, { confirm: true }, { profileId: me }),
      );
      expectInternal(res, 'deleteAccount', logs);
      expect(await authUserExists(me)).toBe(true);
      expect((await readProfile(me))?.id).toBe(me);
      const { data } = await asRole('service')
        .from('comments')
        .select('status')
        .eq('id', commentId)
        .single();
      expect(data?.status).toBe(commentDeleted ? 'deleted' : 'published');
      expect(cascadeTags.calls).toEqual([]);
    },
  );
});
