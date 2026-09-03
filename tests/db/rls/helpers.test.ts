/**
 * tests/db/rls/helpers.test.ts — T-RLS-124 (docs/build/05-test-plan.md §7.1) for the helper
 * functions: `public.is_admin()` / `public.is_moderator()` (S0 helpers migration), `public.set_updated_at()`,
 * and the S1.4 visibility predicate `public.comment_target_visible(text, uuid)` (ADR-0028 D4;
 * migration 20260903090000_comments.sql — `project` → `project_is_visible()`, every other target
 * type → false until its thread opens, ADR-0002 C21).
 *
 * Role matrix (SEED-3 identities, 05 §1.4): is_admin → admin only; is_moderator → mod AND admin;
 * both false for anon / user / banned, and for service (no JWT subject → the auth.uid() guard
 * short-circuits before touching `profiles`).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRole, type TestRole } from '@/tests/helpers/asRole';
import { sql } from '@/tests/helpers/db';
import { cleanupFactories, makeProject } from '@/tests/helpers/factories';
import { SEED_PROJECTS } from '@/tests/helpers/seedIds';

const service = asRole('service');

async function helper(role: TestRole, name: 'is_admin' | 'is_moderator'): Promise<boolean> {
  const { data, error } = await asRole(role).rpc(name);
  expect(error, `${role} ${name}()`).toBeNull();
  return data === true;
}

describe('T-RLS-124 role helpers', () => {
  it('T-RLS-124 is_admin() and is_moderator() are false for anon (no error)', async () => {
    expect(await helper('anon', 'is_admin')).toBe(false);
    expect(await helper('anon', 'is_moderator')).toBe(false);
  });

  it('T-RLS-124 is_admin() and is_moderator() are callable by service and false without a session', async () => {
    expect(await helper('service', 'is_admin')).toBe(false);
    expect(await helper('service', 'is_moderator')).toBe(false);
  });

  it.each([
    ['user', false, false],
    ['banned', false, false],
    ['nohandle', false, false],
    ['mod', false, true],
    ['admin', true, true],
  ] as const)('T-RLS-124 %s → is_admin %s, is_moderator %s', async (role, admin, mod) => {
    expect(await helper(role, 'is_admin')).toBe(admin);
    expect(await helper(role, 'is_moderator')).toBe(mod);
  });

  it('T-RLS-124 helpers are security definer + stable, and set_updated_at() exists', () => {
    const rows = sql(
      "select p.proname, p.prosecdef, p.provolatile from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('is_admin','is_moderator','set_updated_at','comment_target_visible') order by 1",
    );
    const byName = new Map(
      rows.map(([name, secdef, volatility]) => [name, { secdef, volatility }]),
    );
    expect(byName.get('is_admin')).toEqual({ secdef: 't', volatility: 's' });
    expect(byName.get('is_moderator')).toEqual({ secdef: 't', volatility: 's' });
    expect(byName.get('comment_target_visible')).toEqual({ secdef: 't', volatility: 's' });
    expect(byName.has('set_updated_at')).toBe(true);
  });
});

describe('T-RLS-124 comment_target_visible() (S1.4, ADR-0028 D4)', () => {
  let draftId: string;
  let hiddenId: string;

  async function visible(
    role: TestRole,
    targetId: string,
    targetType = 'project',
  ): Promise<boolean> {
    const { data, error } = await asRole(role).rpc('comment_target_visible', {
      p_target_type: targetType,
      p_target_id: targetId,
    });
    expect(error, `${role} comment_target_visible(${targetType}, ${targetId})`).toBeNull();
    return data === true;
  }

  beforeAll(async () => {
    draftId = await makeProject({ source: 'odsens', status: 'draft' });
    hiddenId = await makeProject({ status: 'published' });
    const { error } = await service
      .from('project_overrides')
      .insert({ project_id: hiddenId, hidden: true });
    if (error) throw new Error(`arrange: project_overrides insert failed: ${error.message}`);
  });

  afterAll(cleanupFactories);

  it.each(['anon', 'user', 'banned', 'mod', 'admin', 'service'] as const)(
    'T-RLS-124 %s: a published, not-hidden project is visible; draft and hidden projects are not',
    async (role) => {
      expect(await visible(role, SEED_PROJECTS.pixelChameleon)).toBe(true);
      expect(await visible(role, SEED_PROJECTS.seedExclusivePack)).toBe(true);
      expect(await visible(role, draftId)).toBe(false);
      expect(await visible(role, hiddenId)).toBe(false);
    },
  );

  it.each(['skin', 'art', 'video'] as const)(
    'T-RLS-124 target_type %s → false in v1 (ADR-0002 C21)',
    async (targetType) => {
      expect(await visible('user', SEED_PROJECTS.pixelChameleon, targetType)).toBe(false);
    },
  );
});
