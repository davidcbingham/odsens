/**
 * tests/db/rls/_rpc-grants.test.ts — T-RLS-129 (docs/build/05-test-plan.md §7.1): execute grants on
 * the RPCs, asserted in the catalog (`has_function_privilege`) AND behaviourally through PostgREST.
 *   check_handle(text)                              anon D · authenticated A · service D (S1.5)
 *   rate_limit_ok(text,text,integer,interval)       anon/authenticated D · service A
 *   purge_rate_limit_hits(integer)                  anon/authenticated D · service A
 *   is_reserved_handle(text)                        anon/authenticated/service A — pure, immutable,
 *                                                   invoker rights (no table access), the one SQL copy
 *                                                   of the H3 list (ADR-0020)
 *   record_download(uuid,text,text)                 anon/authenticated D · service A (S1.3)
 *   purge_project_downloads(integer)                anon/authenticated D · service A (S1.3)
 *   can_comment(text,uuid)                          anon D · authenticated A · service A (S1.4,
 *                                                   T-RLS-133 — called inside the insert policies)
 *   comment_target_visible(text,uuid)               anon/authenticated/service A (S1.4, ADR-0028 D4)
 *   moderator_thread(text,uuid)                     anon D · authenticated A (raises 42501 unless
 *                                                   `is_moderator()`) · service_role NOT granted —
 *                                                   the mods-only client read (S1.4, T-RLS-134)
 *   migration_versions()                            anon/authenticated D · service A — the applied
 *                                                   version list `scripts/wait-for-schema.mjs` polls
 *                                                   before `next build` (S1.5, ADR-0029 D3)
 *   fold_project(uuid,uuid)                         anon/authenticated D · service A — the S1.5a fold
 *                                                   `linkProjectListing` issues through the service
 *                                                   client (T-RLS-137, ADR-0037 D3; migration
 *                                                   20260911120300); definer, search_path=public,
 *                                                   VOLATILE (it writes). S1.8: the body gains the
 *                                                   mentions re-parent (20260919120200) — grants
 *                                                   and signature unchanged (T-RLS-137 still holds)
 *   reorder_mentions(jsonb)                         anon/authenticated D · service A — the S1.8
 *                                                   one-statement reorder `updateMention({reorder})`
 *                                                   issues through the service client (ADR-0045;
 *                                                   migration 20260919120100); definer,
 *                                                   search_path=public, VOLATILE, returns integer
 *   record_skin_download(uuid)                      anon/authenticated D · service A — the S1.7
 *                                                   `/api/download/[fileId]` kind-skin counter
 *                                                   (04 §2.3 D4; ADR-0002 C8; ADR-0048 D5;
 *                                                   migration 20260925120100); raises on an unknown
 *                                                   or draft skin (the `record_download` fail-closed
 *                                                   twin); definer, search_path=public, VOLATILE
 *   reorder_skins(jsonb) · reorder_art(jsonb)       anon/authenticated D · service A — the S1.7
 *                                                   copies of `reorder_mentions` over `skins` / `art`
 *                                                   (`updateSkin` / `updateArt` `{ reorder }`,
 *                                                   04 §1.5; ADR-0048 D5); same shape, same
 *                                                   errcodes, same grants
 * S1.5 (ADR-0030 D11, migration 20260903120200): `check_handle` is ALSO denied to `service_role` and
 * `can_comment`'s set is re-stated with an every-role revoke, so the cells above hold on Supabase
 * images whose default ACL grants EXECUTE on new functions to every API role (the PR #8 CI lesson).
 * Every table-reading RPC is `security definer` with `search_path = public` (01 INV-49); `is_reserved_handle`
 * reads no table and stays invoker-rights on purpose (ADR-0020).
 *
 * T-RLS-133 (`can_comment` behaviour) is `mutatesSeed`: `site_settings.comments_closed_default` flips
 * to true through `service` and is restored in `afterAll`; its factory projects fall to
 * `cleanupFactories`. The `reorder_mentions` / `reorder_skins` / `reorder_art` behaviour cases use
 * factory rows only (the seed rows' `sort_order` is asserted untouched); `record_skin_download`
 * bumps a factory skin only (the SEED-7 counters are asserted untouched).
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRole, asUser } from '@/tests/helpers/asRole';
import { sql } from '@/tests/helpers/db';
import { REPO_ROOT } from '@/tests/helpers/envTest';
import {
  cleanupFactories,
  makeArt,
  makeFile,
  makeMention,
  makeProject,
  makeSkin,
  makeUser,
  makeVersion,
} from '@/tests/helpers/factories';
import {
  SEED_ART,
  SEED_COMMENTS,
  SEED_MENTIONS,
  SEED_PROJECTS,
  SEED_SKINS,
  SEED_USERS,
} from '@/tests/helpers/seedIds';

const FUNCTIONS = {
  check_handle: 'public.check_handle(text)',
  rate_limit_ok: 'public.rate_limit_ok(text,text,integer,interval)',
  purge_rate_limit_hits: 'public.purge_rate_limit_hits(integer)',
  is_reserved_handle: 'public.is_reserved_handle(text)',
  record_download: 'public.record_download(uuid,text,text)',
  purge_project_downloads: 'public.purge_project_downloads(integer)',
  can_comment: 'public.can_comment(text,uuid)',
  comment_target_visible: 'public.comment_target_visible(text,uuid)',
  moderator_thread: 'public.moderator_thread(text,uuid)',
  migration_versions: 'public.migration_versions()',
  fold_project: 'public.fold_project(uuid,uuid)',
  reorder_mentions: 'public.reorder_mentions(jsonb)',
  record_skin_download: 'public.record_skin_download(uuid)',
  reorder_skins: 'public.reorder_skins(jsonb)',
  reorder_art: 'public.reorder_art(jsonb)',
} as const;

function canExecute(role: 'anon' | 'authenticated' | 'service_role', fn: string): boolean {
  const value = sql(`select has_function_privilege('${role}', '${fn}', 'execute')`)[0]?.[0];
  return value === 't';
}

/** True when the function's ACL grants EXECUTE to PUBLIC (an `=X/owner` entry). */
function publicCanExecute(name: string): boolean {
  const rows = sql(
    `select coalesce(p.proacl::text, '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = '${name}'`,
  );
  expect(rows, `${name} must exist`).toHaveLength(1);
  const acl = rows[0]?.[0] ?? '';
  // A NULL ACL would mean the default (PUBLIC execute) — the migrations always revoke explicitly.
  expect(acl, `${name} must have an explicit ACL`).not.toBe('');
  return /(^\{|,)=X\//.test(acl);
}

describe('T-RLS-129 RPC grants (catalog)', () => {
  it('T-RLS-129 check_handle: anon denied, authenticated allowed, service_role denied (ADR-0030 D11), never PUBLIC', () => {
    expect(canExecute('anon', FUNCTIONS.check_handle)).toBe(false);
    expect(canExecute('authenticated', FUNCTIONS.check_handle)).toBe(true);
    expect(canExecute('service_role', FUNCTIONS.check_handle)).toBe(false);
    expect(publicCanExecute('check_handle')).toBe(false);
  });

  it.each([
    'rate_limit_ok',
    'purge_rate_limit_hits',
    'record_download',
    'purge_project_downloads',
  ] as const)(
    'T-RLS-129 %s: anon/authenticated denied, service_role allowed, never PUBLIC',
    (name) => {
      expect(canExecute('anon', FUNCTIONS[name])).toBe(false);
      expect(canExecute('authenticated', FUNCTIONS[name])).toBe(false);
      expect(canExecute('service_role', FUNCTIONS[name])).toBe(true);
      expect(publicCanExecute(name)).toBe(false);
    },
  );

  it('T-RLS-129 is_reserved_handle: every API role may call it, never PUBLIC; immutable SQL, invoker rights (ADR-0020)', () => {
    for (const role of ['anon', 'authenticated', 'service_role'] as const) {
      expect(canExecute(role, FUNCTIONS.is_reserved_handle), role).toBe(true);
    }
    expect(publicCanExecute('is_reserved_handle')).toBe(false);
    // Not security definer on purpose: it reads no table, so it is left out of the definer list below.
    const rows = sql(
      "select p.provolatile, p.prosecdef, l.lanname from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang where n.nspname = 'public' and p.proname = 'is_reserved_handle'",
    );
    expect(rows).toEqual([['i', 'f', 'sql']]);
  });

  it('T-RLS-129 every S1.1 RPC is security definer with search_path = public', () => {
    const rows = sql(
      "select p.proname, p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('check_handle','rate_limit_ok','purge_rate_limit_hits','handle_new_user') order by 1",
    );
    expect(rows.map(([name]) => name)).toEqual([
      'check_handle',
      'handle_new_user',
      'purge_rate_limit_hits',
      'rate_limit_ok',
    ]);
    for (const [name, secdef, config] of rows) {
      expect(secdef, `${name} security definer`).toBe('t');
      expect(config, `${name} search_path`).toContain('search_path=public');
    }
  });

  it('T-RLS-129 every S1.3 RPC is security definer with search_path = public', () => {
    const rows = sql(
      "select p.proname, p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('record_download','purge_project_downloads') order by 1",
    );
    expect(rows.map(([name]) => name)).toEqual(['purge_project_downloads', 'record_download']);
    for (const [name, secdef, config] of rows) {
      expect(secdef, `${name} security definer`).toBe('t');
      expect(config, `${name} search_path`).toContain('search_path=public');
    }
  });

  it('T-RLS-129 can_comment: anon denied, authenticated + service_role allowed, never PUBLIC (S1.4)', () => {
    expect(canExecute('anon', FUNCTIONS.can_comment)).toBe(false);
    expect(canExecute('authenticated', FUNCTIONS.can_comment)).toBe(true);
    expect(canExecute('service_role', FUNCTIONS.can_comment)).toBe(true);
    expect(publicCanExecute('can_comment')).toBe(false);
  });

  it('T-RLS-129 comment_target_visible: every API role may call it, never PUBLIC (ADR-0028 D4)', () => {
    for (const role of ['anon', 'authenticated', 'service_role'] as const) {
      expect(canExecute(role, FUNCTIONS.comment_target_visible), role).toBe(true);
    }
    expect(publicCanExecute('comment_target_visible')).toBe(false);
  });

  it('T-RLS-134 moderator_thread: anon denied, authenticated allowed (the function gates on is_moderator), service_role not granted, never PUBLIC', () => {
    expect(canExecute('anon', FUNCTIONS.moderator_thread)).toBe(false);
    expect(canExecute('authenticated', FUNCTIONS.moderator_thread)).toBe(true);
    expect(canExecute('service_role', FUNCTIONS.moderator_thread)).toBe(false);
    expect(publicCanExecute('moderator_thread')).toBe(false);
  });

  it('T-RLS-129 every S1.4 RPC and trigger function is security definer with search_path = public', () => {
    const rows = sql(
      "select p.proname, p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('can_comment','comment_target_visible','moderator_thread','comments_set_status','comments_guard','comments_bump_comment_count','comment_likes_count') order by 1",
    );
    expect(rows.map(([name]) => name)).toEqual([
      'can_comment',
      'comment_likes_count',
      'comment_target_visible',
      'comments_bump_comment_count',
      'comments_guard',
      'comments_set_status',
      'moderator_thread',
    ]);
    for (const [name, secdef, config] of rows) {
      expect(secdef, `${name} security definer`).toBe('t');
      expect(config, `${name} search_path`).toContain('search_path=public');
    }
    // The two read helpers are STABLE (policy-callable); the trigger functions are volatile by nature.
    const stable = sql(
      "select p.proname, p.provolatile from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('can_comment','comment_target_visible','moderator_thread') order by 1",
    );
    expect(stable).toEqual([
      ['can_comment', 's'],
      ['comment_target_visible', 's'],
      ['moderator_thread', 's'],
    ]);
  });

  it.each(['record_skin_download', 'reorder_skins', 'reorder_art'] as const)(
    'T-RLS-129 %s: anon/authenticated denied, service_role allowed, never PUBLIC (S1.7)',
    (name) => {
      expect(canExecute('anon', FUNCTIONS[name])).toBe(false);
      expect(canExecute('authenticated', FUNCTIONS[name])).toBe(false);
      expect(canExecute('service_role', FUNCTIONS[name])).toBe(true);
      expect(publicCanExecute(name)).toBe(false);
    },
  );

  it('T-RLS-129 every S1.7 RPC is a volatile plpgsql security-definer function with search_path = public', () => {
    const rows = sql(
      "select p.proname, p.prosecdef, p.provolatile, l.lanname, coalesce(array_to_string(p.proconfig, ','), ''), pg_get_function_result(p.oid), pg_get_function_identity_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang where n.nspname = 'public' and p.proname in ('record_skin_download','reorder_skins','reorder_art') order by 1",
    );
    expect(rows).toEqual([
      ['record_skin_download', 't', 'v', 'plpgsql', 'search_path=public', 'void', 'p_skin_id uuid'],
      ['reorder_art', 't', 'v', 'plpgsql', 'search_path=public', 'integer', 'p_items jsonb'],
      ['reorder_skins', 't', 'v', 'plpgsql', 'search_path=public', 'integer', 'p_items jsonb'],
    ]);
  });
});

describe('T-RLS-129 RPC grants (behaviour through PostgREST)', () => {
  it('T-RLS-129 check_handle: anon key without a session is denied', async () => {
    const { data, error } = await asRole('anon').rpc('check_handle', { p_handle: 'seed_user' });
    expect(error).not.toBeNull();
    expect(error?.code).toBe('42501');
    expect(data).toBeNull();
  });

  it('T-RLS-129 is_reserved_handle answers anon and authenticated alike (ADR-0020)', async () => {
    for (const role of ['anon', 'user'] as const) {
      const reserved = await asRole(role).rpc('is_reserved_handle', { p_handle: 'OddSense' });
      expect(reserved.error, role).toBeNull();
      expect(reserved.data, role).toBe(true);
      const free = await asRole(role).rpc('is_reserved_handle', { p_handle: 'seed_user' });
      expect(free.error, role).toBeNull();
      expect(free.data, role).toBe(false);
    }
  });

  it('T-RLS-129 check_handle: authenticated callers get the four verdicts', async () => {
    const user = asRole('user');
    const verdict = async (p_handle: string): Promise<string | null> => {
      const { data, error } = await user.rpc('check_handle', { p_handle });
      expect(error).toBeNull();
      return data;
    };
    expect(await verdict('ab')).toBe('invalid'); // H1: too short
    expect(await verdict('a'.repeat(21))).toBe('invalid'); // H1: too long
    expect(await verdict('has-dash')).toBe('invalid'); // H1: charset
    expect(await verdict('admin')).toBe('reserved'); // H3
    expect(await verdict('oddsense')).toBe('reserved'); // H3 wins over "taken"
    expect(await verdict('seed_mod')).toBe('taken');
    expect(await verdict('SEED_MOD')).toBe('taken'); // H2: case-insensitive
    expect(await verdict('seed_user')).toBe('available'); // own handle is not "taken"
    expect(await verdict('t_free_handle')).toBe('available');

    // Every JWT role may call it (onboarding and renames need it), incl. the handle-less newbie.
    for (const role of ['nohandle', 'banned', 'mod', 'admin'] as const) {
      const { data, error } = await asRole(role).rpc('check_handle', { p_handle: 'seed_user2' });
      expect(error, role).toBeNull();
      expect(data).toBe('taken');
    }
  });

  it.each(['anon', 'user', 'mod', 'admin'] as const)(
    'T-RLS-129 %s cannot call rate_limit_ok / purge_rate_limit_hits',
    async (role) => {
      const client = asRole(role);
      const ok = await client.rpc('rate_limit_ok', {
        p_scope: 't_rls_129',
        p_key: role,
        p_max: 1,
        p_window: '1 minute',
      });
      expect(ok.error?.code).toBe('42501');
      expect(ok.data).toBeNull();
      const purge = await client.rpc('purge_rate_limit_hits', { p_days: 1 });
      expect(purge.error?.code).toBe('42501');
      expect(purge.data).toBeNull();
      // The denied call recorded nothing.
      expect(sql("select count(*) from public.rate_limit_hits where scope = 't_rls_129'")).toEqual([
        ['0'],
      ]);
    },
  );

  it('T-RLS-129 service can call rate_limit_ok and purge_rate_limit_hits', async () => {
    const service = asRole('service');
    const ok = await service.rpc('rate_limit_ok', {
      p_scope: 't_rls_129',
      p_key: 'service',
      p_max: 1,
      p_window: '1 minute',
    });
    expect(ok.error).toBeNull();
    expect(ok.data).toBe(true);
    const purge = await service.rpc('purge_rate_limit_hits', { p_days: 1 });
    expect(purge.error).toBeNull();
    expect(typeof purge.data).toBe('number');
    sql("delete from public.rate_limit_hits where scope = 't_rls_129'");
  });
});

describe('T-RLS-129 record_download / purge_project_downloads (behaviour, S1.3)', () => {
  // A factory exclusive chain — record_download only accepts a direct file (storage_path set).
  // The log rows it writes cascade from the project when cleanupFactories removes it.
  let projectId: string;
  let fileId: string;

  beforeAll(async () => {
    projectId = await makeProject({ source: 'odsens', status: 'published' });
    const versionId = await makeVersion({ project_id: projectId });
    fileId = await makeFile({
      version_id: versionId,
      storage_path: `project-files/${projectId}/${versionId}/t_rls129.zip`,
    });
  });

  afterAll(cleanupFactories);

  it.each(['anon', 'user', 'mod', 'admin'] as const)(
    'T-RLS-129 %s cannot call record_download / purge_project_downloads',
    async (role) => {
      const client = asRole(role);
      const rec = await client.rpc('record_download', {
        p_file_id: fileId,
        p_ip_hash: 't_rls129_ip',
        p_ua_hash: 't_rls129_ua',
      });
      expect(rec.error?.code).toBe('42501');
      const purge = await client.rpc('purge_project_downloads', { p_days: 90 });
      expect(purge.error?.code).toBe('42501');
      expect(purge.data).toBeNull();
      // The denied call recorded nothing: no log row, counters untouched.
      expect(
        sql(`select count(*) from public.project_downloads where file_id = '${fileId}'`),
      ).toEqual([['0']]);
    },
  );

  it('T-RLS-129 service record_download increments the file + project counters and logs one row', async () => {
    const service = asRole('service');
    const { error } = await service.rpc('record_download', {
      p_file_id: fileId,
      p_ip_hash: 't_rls129_ip',
      p_ua_hash: 't_rls129_ua',
    });
    expect(error).toBeNull();

    const file = await service
      .from('project_files')
      .select('download_count')
      .eq('id', fileId)
      .single();
    expect(file.data?.download_count).toBe(1);
    const project = await service
      .from('projects')
      .select('downloads_direct')
      .eq('id', projectId)
      .single();
    expect(project.data?.downloads_direct).toBe(1);
    const log = await service
      .from('project_downloads')
      .select('project_id, ip_hash, ua_hash')
      .eq('file_id', fileId);
    expect(log.error).toBeNull();
    expect(log.data).toEqual([
      { project_id: projectId, ip_hash: 't_rls129_ip', ua_hash: 't_rls129_ua' },
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-133 can_comment(p_target_type, p_target_id) — behaviour (S1.4; 04 §1.2 "Comments enabled";
// ADR-0002 C21). mutatesSeed: `site_settings.comments_closed_default` (restored in afterAll).
// ---------------------------------------------------------------------------------------------
describe('T-RLS-133 can_comment (behaviour)', () => {
  const service = asRole('service');
  let draftId: string;
  let hiddenId: string;
  let plainId: string;
  let openId: string;

  async function setClosedDefault(value: boolean): Promise<void> {
    const { error } = await service
      .from('site_settings')
      .update({ comments_closed_default: value })
      .eq('id', 1);
    if (error) throw new Error(`arrange: site_settings update failed: ${error.message}`);
  }

  async function canComment(
    role: 'user' | 'user0' | 'banned' | 'mod' | 'admin' | 'service',
    targetId: string,
    targetType = 'project',
  ): Promise<boolean> {
    const { data, error } = await asRole(role).rpc('can_comment', {
      p_target_type: targetType,
      p_target_id: targetId,
    });
    expect(error, `${role} can_comment(${targetType}, ${targetId})`).toBeNull();
    return data === true;
  }

  beforeAll(async () => {
    draftId = await makeProject({ source: 'odsens', status: 'draft' });
    hiddenId = await makeProject({ status: 'published' });
    plainId = await makeProject({ status: 'published' });
    openId = await makeProject({ status: 'published' });
    const hiddenRow = await service
      .from('project_overrides')
      .insert({ project_id: hiddenId, hidden: true });
    if (hiddenRow.error)
      throw new Error(`arrange: project_overrides insert failed: ${hiddenRow.error.message}`);
    const openRow = await service
      .from('project_overrides')
      .insert({ project_id: openId, comments_enabled: true });
    if (openRow.error)
      throw new Error(`arrange: project_overrides insert failed: ${openRow.error.message}`);
  });

  afterAll(async () => {
    await setClosedDefault(false);
    await cleanupFactories();
  });

  it('T-RLS-133 user → true on …0102, false on …0103 (comments_enabled=false), false on draft / hidden projects', async () => {
    expect(await canComment('user', SEED_PROJECTS.pixelChameleon)).toBe(true);
    expect(await canComment('user', SEED_PROJECTS.seedExclusivePack)).toBe(false);
    expect(await canComment('user', draftId)).toBe(false);
    expect(await canComment('user', hiddenId)).toBe(false);
    expect(await canComment('user', plainId)).toBe(true);
  });

  it.each(['user0', 'mod', 'admin'] as const)(
    'T-RLS-133 %s follows the same visibility / enabled rules (no role bypass)',
    async (role) => {
      expect(await canComment(role, SEED_PROJECTS.pixelChameleon)).toBe(true);
      expect(await canComment(role, SEED_PROJECTS.seedExclusivePack)).toBe(false);
      expect(await canComment(role, draftId)).toBe(false);
      expect(await canComment(role, hiddenId)).toBe(false);
    },
  );

  it('T-RLS-133 banned → false on every target (is_banned wins)', async () => {
    for (const id of [
      SEED_PROJECTS.pixelChameleon,
      SEED_PROJECTS.seedExclusivePack,
      plainId,
      openId,
    ]) {
      expect(await canComment('banned', id), id).toBe(false);
    }
  });

  it.each(['moderator', 'admin'] as const)(
    'T-RLS-133 a banned %s → false as well (is_banned is respected for staff)',
    async (role) => {
      const id = await makeUser({ role, banned: true });
      const { data, error } = await asUser(id).rpc('can_comment', {
        p_target_type: 'project',
        p_target_id: SEED_PROJECTS.pixelChameleon,
      });
      expect(error).toBeNull();
      expect(data).toBe(false);
    },
  );

  it('T-RLS-133 comments_closed_default=true closes a project without an override; an override comments_enabled=true reopens it (mutatesSeed)', async () => {
    await setClosedDefault(true);
    expect(await canComment('user', plainId)).toBe(false);
    expect(await canComment('user', openId)).toBe(true);
    // SEED-6: …0102's override says comments_enabled=true, so it stays open under the site default.
    expect(await canComment('user', SEED_PROJECTS.pixelChameleon)).toBe(true);
    await setClosedDefault(false);
    expect(await canComment('user', plainId)).toBe(true);
  });

  it.each(['skin', 'art', 'video', 'workroom'] as const)(
    'T-RLS-133 a non-project target_type (%s) → false in v1 (ADR-0002 C21)',
    async (targetType) => {
      expect(await canComment('user', SEED_PROJECTS.pixelChameleon, targetType)).toBe(false);
      expect(await canComment('admin', SEED_PROJECTS.pixelChameleon, targetType)).toBe(false);
    },
  );

  it('T-RLS-133 anon (no session) → execute denied (42501)', async () => {
    const { data, error } = await asRole('anon').rpc('can_comment', {
      p_target_type: 'project',
      p_target_id: SEED_PROJECTS.pixelChameleon,
    });
    expect(error?.code).toBe('42501');
    expect(data).toBeNull();
  });

  it('T-RLS-133 service (no JWT subject) → false: the helper never says yes without a user', async () => {
    expect(await canComment('service', SEED_PROJECTS.pixelChameleon)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-134 moderator_thread(p_target_type, p_target_id) — behaviour (S1.4; ADR-0002 A2;
// 04 §1.2 "Moderator read"): mods/admins get the held / hidden / reported rows of a target with
// body, author_id, is_first_comment and report_count; everyone else is refused.
// ---------------------------------------------------------------------------------------------
describe('T-RLS-134 moderator_thread (behaviour)', () => {
  const THREAD_COLUMNS = [
    'author_id',
    'body',
    'created_at',
    'edited_at',
    'id',
    'is_first_comment',
    'like_count',
    'parent_id',
    'report_count',
    'status',
    'target_id',
    'target_type',
  ];

  it.each(['mod', 'admin'] as const)(
    'T-RLS-134 %s reads the held …0203 and hidden …0204 with body, is_first_comment and report_count; published-unreported and deleted rows excluded',
    async (role) => {
      const { data, error } = await asRole(role).rpc('moderator_thread', {
        p_target_type: 'project',
        p_target_id: SEED_PROJECTS.pixelChameleon,
      });
      expect(error).toBeNull();
      const rows = data ?? [];
      const ids = rows.map((row) => row.id);
      expect(ids).toContain(SEED_COMMENTS.held);
      expect(ids).toContain(SEED_COMMENTS.hidden);
      expect(ids).not.toContain(SEED_COMMENTS.published);
      expect(ids).not.toContain(SEED_COMMENTS.creatorReply);
      expect(ids).not.toContain(SEED_COMMENTS.deleted);

      const held = rows.find((row) => row.id === SEED_COMMENTS.held);
      expect(held).toMatchObject({
        status: 'held',
        body: 'first comment here, the tail is great',
        author_id: SEED_USERS.seed_user2,
        is_first_comment: true, // seed_user2 comment_count 0
        report_count: 0,
        target_type: 'project',
        target_id: SEED_PROJECTS.pixelChameleon,
      });
      const hidden = rows.find((row) => row.id === SEED_COMMENTS.hidden);
      expect(hidden).toMatchObject({
        status: 'hidden',
        body: 'cheap diamonds at totally-legit.example, no questions asked',
        author_id: SEED_USERS.seed_banned,
        is_first_comment: false, // seed_banned comment_count 1
        report_count: 1, // the SEED-9 unresolved 'spam' report
      });
      for (const row of rows) {
        expect(Object.keys(row).sort()).toEqual(THREAD_COLUMNS);
        expect(JSON.stringify(row)).not.toMatch(/email/i);
      }
    },
  );

  it.each(['anon', 'user', 'banned', 'nohandle'] as const)(
    'T-RLS-134 %s is refused (42501) and gets no rows',
    async (role) => {
      const { data, error } = await asRole(role).rpc('moderator_thread', {
        p_target_type: 'project',
        p_target_id: SEED_PROJECTS.pixelChameleon,
      });
      expect(error?.code).toBe('42501');
      expect(data).toBeNull();
    },
  );

  it('T-RLS-134 comments_public is unchanged: anon still gets …0203 as a body-less slot (T-RLS-128)', async () => {
    const { data, error } = await asRole('anon')
      .from('comments_public')
      .select('id, status, body, author_id')
      .eq('id', SEED_COMMENTS.held)
      .single();
    expect(error).toBeNull();
    expect(data).toEqual({ id: SEED_COMMENTS.held, status: 'held', body: null, author_id: null });
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-129 migration_versions() — S1.5, ADR-0029 D3 (migration 20260903120400). The build's schema
// wait reads it with the service key; every other role is refused; it is never PUBLIC.
// ---------------------------------------------------------------------------------------------
describe('T-RLS-129 migration_versions() (ADR-0029 D3)', () => {
  /** The version set the checkout carries = the filename prefixes under supabase/migrations/. */
  function checkoutVersions(): string[] {
    return fs
      .readdirSync(path.join(REPO_ROOT, 'supabase', 'migrations'))
      .filter((name) => name.endsWith('.sql'))
      .map((name) => name.slice(0, name.indexOf('_')))
      .sort();
  }

  it('T-RLS-129 migration_versions: anon/authenticated denied, service_role allowed, never PUBLIC', () => {
    expect(canExecute('anon', FUNCTIONS.migration_versions)).toBe(false);
    expect(canExecute('authenticated', FUNCTIONS.migration_versions)).toBe(false);
    expect(canExecute('service_role', FUNCTIONS.migration_versions)).toBe(true);
    expect(publicCanExecute('migration_versions')).toBe(false);
  });

  it('T-RLS-129 migration_versions is a stable security-definer SQL function with search_path = public', () => {
    const rows = sql(
      "select p.prosecdef, p.provolatile, l.lanname, coalesce(array_to_string(p.proconfig, ','), ''), pg_get_function_result(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang where n.nspname = 'public' and p.proname = 'migration_versions'",
    );
    expect(rows).toEqual([['t', 's', 'sql', 'search_path=public', 'SETOF text']]);
  });

  it('T-RLS-129 service reads the applied version list = the checkout’s migration files (POST and GET)', async () => {
    const expected = checkoutVersions();
    expect(expected).toContain('20260903120400');
    const post = await asRole('service').rpc('migration_versions');
    expect(post.error).toBeNull();
    expect(post.data).toEqual(expected);
    // `stable` → PostgREST also serves it over GET (the wait script may use either).
    const get = await asRole('service').rpc('migration_versions', undefined, { get: true });
    expect(get.error).toBeNull();
    expect(get.data).toEqual(expected);
  });

  it.each(['anon', 'user', 'mod', 'admin'] as const)(
    'T-RLS-129 %s cannot call migration_versions (42501)',
    async (role) => {
      const { data, error } = await asRole(role).rpc('migration_versions');
      expect(error?.code).toBe('42501');
      expect(data).toBeNull();
    },
  );

  it('T-RLS-129 service_role cannot call check_handle (ADR-0030 D11 — the server never does)', async () => {
    const { data, error } = await asRole('service').rpc('check_handle', { p_handle: 'seed_user' });
    expect(error?.code).toBe('42501');
    expect(data).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-137 fold_project(p_duplicate_id, p_canonical_id) — S1.5a, ADR-0037 D3/D9 (migration
// 20260911120300). The fold `linkProjectListing` issues through the service client after
// `requireRole('admin')`; every JWT role and PUBLIC are refused; definer + search_path = public;
// VOLATILE (the one RPC here that writes across tables). Behaviour (merge order, dedupe, counters,
// redirect) is T-ACT-81 (tests/db/actions/linkProjectListing.fold.test.ts); here only the grant
// cells and that a refused call / a failed precondition writes nothing.
// ---------------------------------------------------------------------------------------------
describe('T-RLS-137 fold_project grants (ADR-0037 D3)', () => {
  it('T-RLS-137 fold_project: anon/authenticated denied, service_role allowed, never PUBLIC', () => {
    expect(canExecute('anon', FUNCTIONS.fold_project)).toBe(false);
    expect(canExecute('authenticated', FUNCTIONS.fold_project)).toBe(false);
    expect(canExecute('service_role', FUNCTIONS.fold_project)).toBe(true);
    expect(publicCanExecute('fold_project')).toBe(false);
  });

  it('T-RLS-137 fold_project is a volatile plpgsql security-definer function with search_path = public returning jsonb', () => {
    const rows = sql(
      "select p.prosecdef, p.provolatile, l.lanname, coalesce(array_to_string(p.proconfig, ','), ''), pg_get_function_result(p.oid), pg_get_function_identity_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang where n.nspname = 'public' and p.proname = 'fold_project'",
    );
    expect(rows).toEqual([
      [
        't',
        'v',
        'plpgsql',
        'search_path=public',
        'jsonb',
        'p_duplicate_id uuid, p_canonical_id uuid',
      ],
    ]);
  });

  it.each(['anon', 'user', 'mod', 'admin'] as const)(
    'T-RLS-137 %s cannot call fold_project (42501) and the seed rows are untouched',
    async (role) => {
      const { data, error } = await asRole(role).rpc('fold_project', {
        p_duplicate_id: SEED_PROJECTS.metalPipeMace,
        p_canonical_id: SEED_PROJECTS.seedExclusivePack,
      });
      expect(error?.code).toBe('42501');
      expect(data).toBeNull();
      expect(
        sql(
          `select count(*) from public.projects where id in ('${SEED_PROJECTS.metalPipeMace}', '${SEED_PROJECTS.seedExclusivePack}')`,
        ),
      ).toEqual([['2']]);
      expect(sql('select count(*) from public.project_redirects')).toEqual([['0']]);
    },
  );

  it('T-RLS-137 service may call fold_project; a failed precondition raises a plain P0002 message and writes nothing', async () => {
    // Same id twice: refused before any lock or write (the seed rows are never folded — 05 H-1).
    const { data, error } = await asRole('service').rpc('fold_project', {
      p_duplicate_id: SEED_PROJECTS.metalPipeMace,
      p_canonical_id: SEED_PROJECTS.metalPipeMace,
    });
    expect(error?.code).toBe('P0002');
    expect(error?.message).toBe('A project cannot be folded into itself.');
    expect(data).toBeNull();
    expect(sql('select count(*) from public.project_redirects')).toEqual([['0']]);
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-129 reorder_mentions(p_items jsonb) — S1.8, ADR-0045 (migration 20260919120100). The
// one-statement reorder `updateMention({ reorder })` issues through the service client after
// `requireRole('admin')` (04 §1.6 "reorder runs in one transaction"; the action-level cases are
// T-ACT-64). Every JWT role and PUBLIC are refused; definer + search_path = public; VOLATILE.
// Behaviour: every listed row takes its `sort_order` in ONE call; a listed id that is not a row →
// P0002 and NOTHING applied; a payload the action would never send → 22023, nothing applied.
// Factory mentions only — the SEED-10 rows' order is asserted untouched (05 H-1).
// ---------------------------------------------------------------------------------------------
describe('T-RLS-129 reorder_mentions grants + behaviour (ADR-0045)', () => {
  const service = asRole('service');
  type Item = { id: string; sort_order: number };

  afterAll(cleanupFactories);

  /** `sort_order` of the given mentions, keyed by id (service read). */
  async function orderOf(ids: string[]): Promise<Record<string, number>> {
    const { data, error } = await service.from('mentions').select('id, sort_order').in('id', ids);
    expect(error).toBeNull();
    return Object.fromEntries((data ?? []).map((row) => [row.id, row.sort_order]));
  }

  async function seedOrder(): Promise<Record<string, number>> {
    return orderOf([SEED_MENTIONS.youtube, SEED_MENTIONS.tiktok]);
  }

  const SEED_ORDER = { [SEED_MENTIONS.youtube]: 1, [SEED_MENTIONS.tiktok]: 2 };

  it('T-RLS-129 reorder_mentions: anon/authenticated denied, service_role allowed, never PUBLIC', () => {
    expect(canExecute('anon', FUNCTIONS.reorder_mentions)).toBe(false);
    expect(canExecute('authenticated', FUNCTIONS.reorder_mentions)).toBe(false);
    expect(canExecute('service_role', FUNCTIONS.reorder_mentions)).toBe(true);
    expect(publicCanExecute('reorder_mentions')).toBe(false);
  });

  it('T-RLS-129 reorder_mentions is a volatile plpgsql security-definer function with search_path = public returning integer', () => {
    const rows = sql(
      "select p.prosecdef, p.provolatile, l.lanname, coalesce(array_to_string(p.proconfig, ','), ''), pg_get_function_result(p.oid), pg_get_function_identity_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang where n.nspname = 'public' and p.proname = 'reorder_mentions'",
    );
    expect(rows).toEqual([['t', 'v', 'plpgsql', 'search_path=public', 'integer', 'p_items jsonb']]);
  });

  it.each(['anon', 'user', 'banned', 'mod', 'admin'] as const)(
    'T-RLS-129 %s cannot call reorder_mentions (42501) and no sort_order moves',
    async (role) => {
      const id = await makeMention({ sort_order: 5 });
      const { data, error } = await asRole(role).rpc('reorder_mentions', {
        p_items: [
          { id, sort_order: 1 },
          { id: SEED_MENTIONS.youtube, sort_order: 9 },
        ],
      });
      expect(error?.code).toBe('42501');
      expect(data).toBeNull();
      expect(await orderOf([id])).toEqual({ [id]: 5 });
      expect(await seedOrder()).toEqual(SEED_ORDER);
    },
  );

  it('T-RLS-129 service reorders every listed mention in ONE call and returns the count; unlisted rows and other columns stay put', async () => {
    const [a, b, c, bystander] = await Promise.all([
      makeMention({ sort_order: 1, featured: true }),
      makeMention({ sort_order: 2, featured: true }),
      makeMention({ sort_order: 3, featured: true, status: 'hidden' }),
      makeMention({ sort_order: 4 }),
    ]);
    const before = await service
      .from('mentions')
      .select('id, updated_at')
      .in('id', [a, b, c, bystander]);
    const stampBefore = new Map((before.data ?? []).map((row) => [row.id, row.updated_at]));

    const items: Item[] = [
      { id: c, sort_order: 1 },
      { id: a, sort_order: 2 },
      { id: b, sort_order: 3 },
    ];
    const { data, error } = await service.rpc('reorder_mentions', { p_items: items });
    expect(error).toBeNull();
    expect(data).toBe(3);

    expect(await orderOf([a, b, c, bystander])).toEqual({ [c]: 1, [a]: 2, [b]: 3, [bystander]: 4 });
    const after = await service
      .from('mentions')
      .select('id, status, featured, updated_at')
      .in('id', [a, b, c, bystander]);
    const rows = new Map((after.data ?? []).map((row) => [row.id, row]));
    // Only `sort_order` is written: a hidden row stays hidden and featured; the trigger stamps the
    // listed rows (01 INV-97) and leaves the unlisted one alone.
    expect(rows.get(c)).toMatchObject({ status: 'hidden', featured: true });
    expect(rows.get(bystander)).toMatchObject({ status: 'published', featured: false });
    for (const id of [a, b, c]) {
      expect(Date.parse(rows.get(id)?.updated_at ?? ''), id).toBeGreaterThan(
        Date.parse(stampBefore.get(id) ?? ''),
      );
    }
    expect(rows.get(bystander)?.updated_at).toBe(stampBefore.get(bystander));
    expect(await seedOrder()).toEqual(SEED_ORDER);
  });

  it('T-RLS-129 an unknown id → P0002 with a plain message and NOTHING applied (the known rows keep their order)', async () => {
    const [a, b] = await Promise.all([
      makeMention({ sort_order: 1 }),
      makeMention({ sort_order: 2 }),
    ]);
    const { data, error } = await service.rpc('reorder_mentions', {
      p_items: [
        { id: b, sort_order: 1 },
        { id: randomUUID(), sort_order: 2 },
        { id: a, sort_order: 3 },
      ],
    });
    expect(error?.code).toBe('P0002');
    expect(error?.message).toBe('One of those mentions could not be found.');
    expect(data).toBeNull();
    expect(await orderOf([a, b])).toEqual({ [a]: 1, [b]: 2 });
  });

  it('T-RLS-129 an empty list is a no-op → 0', async () => {
    const { data, error } = await service.rpc('reorder_mentions', { p_items: [] });
    expect(error).toBeNull();
    expect(data).toBe(0);
    expect(await seedOrder()).toEqual(SEED_ORDER);
  });

  it('T-RLS-129 a payload the action would never send → 22023 and nothing applied (not an array · a missing field · an id listed twice)', async () => {
    const id = await makeMention({ sort_order: 5 });
    const payloads: Array<[string, unknown]> = [
      ['not an array', { id, sort_order: 1 }],
      ['null', null],
      ['no sort_order', [{ id }]],
      ['no id', [{ sort_order: 1 }]],
      [
        'listed twice',
        [
          { id, sort_order: 1 },
          { id, sort_order: 2 },
        ],
      ],
    ];
    for (const [label, p_items] of payloads) {
      const { data, error } = await service.rpc('reorder_mentions', {
        p_items: p_items as Item[],
      });
      expect(error?.code, label).toBe('22023');
      expect(data, label).toBeNull();
    }
    expect(await orderOf([id])).toEqual({ [id]: 5 });
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-129 record_skin_download(p_skin_id uuid) — S1.7, ADR-0048 D5 (migration 20260925120100).
// `/api/download/[fileId]` calls it through the service client for kind `skin` after
// `resolveDownloadable` said "published" (04 §2.3 D4; the route-level cases are T-ACT-76). Every JWT
// role is refused; a draft or unknown id raises (fail-closed — nothing counted). Factory skins only
// (`fixture: null` — the counter needs no object); the SEED-7 counters are asserted untouched.
// ---------------------------------------------------------------------------------------------
describe('T-RLS-129 record_skin_download behaviour (S1.7)', () => {
  const service = asRole('service');

  afterAll(cleanupFactories);

  async function downloadsOf(id: string): Promise<number> {
    const { data, error } = await service.from('skins').select('downloads').eq('id', id).single();
    expect(error).toBeNull();
    return data?.downloads ?? -1;
  }

  it.each(['anon', 'user', 'banned', 'mod', 'admin'] as const)(
    'T-RLS-129 %s cannot call record_skin_download (42501) and nothing is counted',
    async (role) => {
      const id = await makeSkin({ fixture: null });
      const { data, error } = await asRole(role).rpc('record_skin_download', { p_skin_id: id });
      expect(error?.code).toBe('42501');
      expect(data).toBeNull();
      expect(await downloadsOf(id)).toBe(0);
    },
  );

  it('T-RLS-129 service counts a published skin: +1 per call, only that row', async () => {
    const [id, bystander] = await Promise.all([
      makeSkin({ fixture: null }),
      makeSkin({ fixture: null }),
    ]);
    const seedBefore = await Promise.all([
      downloadsOf(SEED_SKINS.skinA),
      downloadsOf(SEED_SKINS.skinB),
    ]);
    const first = await service.rpc('record_skin_download', { p_skin_id: id });
    expect(first.error).toBeNull();
    expect(await downloadsOf(id)).toBe(1);
    const second = await service.rpc('record_skin_download', { p_skin_id: id });
    expect(second.error).toBeNull();
    expect(await downloadsOf(id)).toBe(2);
    expect(await downloadsOf(bystander)).toBe(0);
    expect([await downloadsOf(SEED_SKINS.skinA), await downloadsOf(SEED_SKINS.skinB)]).toEqual(
      seedBefore,
    );
  });

  it('T-RLS-129 a DRAFT skin raises (P0001, plain message) and stays at 0 — the fail-closed backstop', async () => {
    const id = await makeSkin({ status: 'draft', fixture: null });
    const { data, error } = await service.rpc('record_skin_download', { p_skin_id: id });
    expect(error?.code).toBe('P0001');
    expect(error?.message).toBe(`record_skin_download: unknown or unpublished skin ${id}`);
    expect(data).toBeNull();
    expect(await downloadsOf(id)).toBe(0);
  });

  it('T-RLS-129 an unknown id raises the same way', async () => {
    const id = randomUUID();
    const { error } = await service.rpc('record_skin_download', { p_skin_id: id });
    expect(error?.code).toBe('P0001');
    expect(error?.message).toBe(`record_skin_download: unknown or unpublished skin ${id}`);
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-129 reorder_skins / reorder_art (p_items jsonb) — S1.7, ADR-0048 D5 (migration
// 20260925120100): copies of `reorder_mentions` over `skins` / `art` — `updateSkin` / `updateArt`
// `{ reorder }` issue them through the service client after `requireRole('admin')` (04 §1.5; the
// action-level cases are T-ACT-59 / T-ACT-60). Same cells as the mentions block, parametrised.
// Factory rows only (`fixture: null`) — the SEED-7 / SEED-8 order is asserted untouched (05 H-1).
// ---------------------------------------------------------------------------------------------
type ReorderTarget = {
  fn: 'reorder_skins' | 'reorder_art';
  table: 'skins' | 'art';
  make: (sortOrder: number, status?: 'draft' | 'published') => Promise<string>;
  seedIds: readonly [string, string];
  seedOrder: Record<string, number>;
  missing: string;
};

const REORDER_TARGETS: readonly ReorderTarget[] = [
  {
    fn: 'reorder_skins',
    table: 'skins',
    make: (sort_order, status = 'published') => makeSkin({ sort_order, status, fixture: null }),
    seedIds: [SEED_SKINS.skinA, SEED_SKINS.skinB],
    seedOrder: { [SEED_SKINS.skinA]: 2, [SEED_SKINS.skinB]: 1 },
    missing: 'One of those skins could not be found.',
  },
  {
    fn: 'reorder_art',
    table: 'art',
    make: (sort_order, status = 'published') => makeArt({ sort_order, status, fixture: null }),
    seedIds: [SEED_ART.avatar, SEED_ART.thumb],
    seedOrder: { [SEED_ART.avatar]: 1, [SEED_ART.thumb]: 2 },
    missing: 'One of those pieces could not be found.',
  },
];

describe.each(REORDER_TARGETS)('T-RLS-129 $fn grants + behaviour (S1.7)', (target) => {
  const service = asRole('service');
  type Item = { id: string; sort_order: number };

  afterAll(cleanupFactories);

  /** `sort_order` of the given rows, keyed by id (service read). */
  async function orderOf(ids: string[]): Promise<Record<string, number>> {
    const { data, error } = await service.from(target.table).select('id, sort_order').in('id', ids);
    expect(error).toBeNull();
    return Object.fromEntries((data ?? []).map((row) => [row.id, row.sort_order]));
  }

  const seedOrder = (): Promise<Record<string, number>> => orderOf([...target.seedIds]);

  it.each(['anon', 'user', 'banned', 'mod', 'admin'] as const)(
    `T-RLS-129 %s cannot call ${target.fn} (42501) and no sort_order moves`,
    async (role) => {
      const id = await target.make(5);
      const { data, error } = await asRole(role).rpc(target.fn, {
        p_items: [
          { id, sort_order: 1 },
          { id: target.seedIds[0], sort_order: 9 },
        ],
      });
      expect(error?.code).toBe('42501');
      expect(data).toBeNull();
      expect(await orderOf([id])).toEqual({ [id]: 5 });
      expect(await seedOrder()).toEqual(target.seedOrder);
    },
  );

  it(`T-RLS-129 service ${target.fn} reorders every listed row in ONE call and returns the count; unlisted rows and other columns stay put`, async () => {
    const [a, b, c, bystander] = await Promise.all([
      target.make(1),
      target.make(2),
      target.make(3, 'draft'),
      target.make(4),
    ]);
    const before = await service
      .from(target.table)
      .select('id, updated_at')
      .in('id', [a, b, c, bystander]);
    const stampBefore = new Map((before.data ?? []).map((row) => [row.id, row.updated_at]));

    const items: Item[] = [
      { id: c, sort_order: 1 },
      { id: a, sort_order: 2 },
      { id: b, sort_order: 3 },
    ];
    const { data, error } = await service.rpc(target.fn, { p_items: items });
    expect(error).toBeNull();
    expect(data).toBe(3);

    expect(await orderOf([a, b, c, bystander])).toEqual({ [c]: 1, [a]: 2, [b]: 3, [bystander]: 4 });
    const after = await service
      .from(target.table)
      .select('id, status, updated_at')
      .in('id', [a, b, c, bystander]);
    const rows = new Map((after.data ?? []).map((row) => [row.id, row]));
    // Only `sort_order` is written: a draft stays a draft; the trigger stamps the listed rows
    // (01 INV-97) and leaves the unlisted one alone.
    expect(rows.get(c)?.status).toBe('draft');
    expect(rows.get(bystander)?.status).toBe('published');
    for (const id of [a, b, c]) {
      expect(Date.parse(rows.get(id)?.updated_at ?? ''), id).toBeGreaterThan(
        Date.parse(stampBefore.get(id) ?? ''),
      );
    }
    expect(rows.get(bystander)?.updated_at).toBe(stampBefore.get(bystander));
    expect(await seedOrder()).toEqual(target.seedOrder);
  });

  it(`T-RLS-129 ${target.fn}: an unknown id → P0002 with a plain message and NOTHING applied`, async () => {
    const [a, b] = await Promise.all([target.make(1), target.make(2)]);
    const { data, error } = await service.rpc(target.fn, {
      p_items: [
        { id: b, sort_order: 1 },
        { id: randomUUID(), sort_order: 2 },
        { id: a, sort_order: 3 },
      ],
    });
    expect(error?.code).toBe('P0002');
    expect(error?.message).toBe(target.missing);
    expect(data).toBeNull();
    expect(await orderOf([a, b])).toEqual({ [a]: 1, [b]: 2 });
  });

  it(`T-RLS-129 ${target.fn}: an empty list is a no-op → 0`, async () => {
    const { data, error } = await service.rpc(target.fn, { p_items: [] });
    expect(error).toBeNull();
    expect(data).toBe(0);
    expect(await seedOrder()).toEqual(target.seedOrder);
  });

  it(`T-RLS-129 ${target.fn}: a payload the action would never send → 22023 and nothing applied (not an array · a missing field · an id listed twice)`, async () => {
    const id = await target.make(5);
    const payloads: Array<[string, unknown]> = [
      ['not an array', { id, sort_order: 1 }],
      ['null', null],
      ['no sort_order', [{ id }]],
      ['no id', [{ sort_order: 1 }]],
      [
        'listed twice',
        [
          { id, sort_order: 1 },
          { id, sort_order: 2 },
        ],
      ],
    ];
    for (const [label, p_items] of payloads) {
      const { data, error } = await service.rpc(target.fn, { p_items: p_items as Item[] });
      expect(error?.code, label).toBe('22023');
      expect(data, label).toBeNull();
    }
    expect(await orderOf([id])).toEqual({ [id]: 5 });
  });
});
