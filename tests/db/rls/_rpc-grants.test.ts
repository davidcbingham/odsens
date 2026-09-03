/**
 * tests/db/rls/_rpc-grants.test.ts — T-RLS-129 (docs/build/05-test-plan.md §7.1): execute grants on
 * the RPCs, asserted in the catalog (`has_function_privilege`) AND behaviourally through PostgREST.
 *   check_handle(text)                              anon D · authenticated A
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
 * Not yet in the schema (asserted absent so this file is revisited when it lands):
 *   record_skin_download → S1.7.
 * Every table-reading RPC is `security definer` with `search_path = public` (01 INV-49); `is_reserved_handle`
 * reads no table and stays invoker-rights on purpose (ADR-0020).
 *
 * T-RLS-133 (`can_comment` behaviour) is `mutatesSeed`: `site_settings.comments_closed_default` flips
 * to true through `service` and is restored in `afterAll`; its factory projects fall to
 * `cleanupFactories`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRole, asUser } from '@/tests/helpers/asRole';
import { sql } from '@/tests/helpers/db';
import {
  cleanupFactories,
  makeFile,
  makeProject,
  makeUser,
  makeVersion,
} from '@/tests/helpers/factories';
import { SEED_COMMENTS, SEED_PROJECTS, SEED_USERS } from '@/tests/helpers/seedIds';

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
  it('T-RLS-129 check_handle: anon denied, authenticated allowed, never PUBLIC', () => {
    expect(canExecute('anon', FUNCTIONS.check_handle)).toBe(false);
    expect(canExecute('authenticated', FUNCTIONS.check_handle)).toBe(true);
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

  it('T-RLS-129 later-slice RPCs are not present yet (record_skin_download S1.7)', () => {
    const rows = sql(
      "select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('record_skin_download')",
    );
    expect(rows).toEqual([]);
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
