/**
 * tests/db/rls/project_downloads.test.ts — RLS matrix for `project_downloads` (docs/build/05-test-plan.md
 * §7.1 T-RLS-44..47; data-model §2.2/§4; ADR-0002 #75). Policies:
 * supabase/migrations/20260827200100_project_downloads.sql — select/delete = admin only
 * (`is_admin()`); insert/update have NO policy and no `authenticated` grant at all — service role
 * only, because production rows are written solely by the security-definer RPC `record_download`
 * (whose execute grants are asserted in _rpc-grants.test.ts, T-RLS-129). Cell order of every cell
 * comment: anon | user | banned | mod | admin | svc.
 *
 * Fixtures are a factory exclusive chain (project source 'odsens' published → version → file with a
 * `storage_path`) plus log rows: the arranged row comes through service `.rpc('record_download', …)`
 * — the production write path — and stays untouched (denied cells target it and are proven no-ops
 * through `service`); allowed write cells get fresh rows via direct service inserts. Everything falls
 * to `cleanupFactories` (log rows cascade from the factory project's FK).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRole, type TestRole } from '@/tests/helpers/asRole';
import { expectPolicy, type RowValues } from '@/tests/helpers/expectPolicy';
import { cleanupFactories, makeFile, makeProject, makeVersion } from '@/tests/helpers/factories';

/** Every role denied on select/delete — insert/update add admin to this list (T-RLS-45/46). */
const NON_ADMIN = ['anon', 'user', 'banned', 'mod'] as const satisfies readonly TestRole[];
const NON_SERVICE = [...NON_ADMIN, 'admin'] as const satisfies readonly TestRole[];
const service = asRole('service');

/** ip/ua of the arranged log row (HMAC-shaped stand-ins — never raw PII, SC-17). */
const ARRANGED_IP = 't_rls_dl_ip';
const ARRANGED_UA = 't_rls_dl_ua';

let projectId: string;
let fileId: string;
let logId: string;

/** A fresh log row via direct service insert (allowed-write cells consume these). */
async function insertLogRow(tag: string): Promise<string> {
  const id = randomUUID();
  const { error } = await service.from('project_downloads').insert({
    id,
    project_id: projectId,
    file_id: fileId,
    ip_hash: `t_${tag}_ip`,
    ua_hash: `t_${tag}_ua`,
  });
  if (error) throw new Error(`arrange: project_downloads insert failed: ${error.message}`);
  return id;
}

beforeAll(async () => {
  projectId = await makeProject({ source: 'odsens', status: 'published' });
  const versionId = await makeVersion({ project_id: projectId });
  fileId = await makeFile({
    version_id: versionId,
    storage_path: `project-files/${projectId}/${versionId}/t_rls44.zip`,
  });
  // Arrange through the production write path (04 §2.3 D4): one RPC call = one log row.
  const { error } = await service.rpc('record_download', {
    p_file_id: fileId,
    p_ip_hash: ARRANGED_IP,
    p_ua_hash: ARRANGED_UA,
  });
  if (error) throw new Error(`arrange: record_download failed: ${error.message}`);
  const { data, error: readError } = await service
    .from('project_downloads')
    .select('id, project_id')
    .eq('file_id', fileId)
    .single();
  if (readError || !data) {
    throw new Error(`arrange: log row read failed: ${readError?.message ?? 'no row'}`);
  }
  expect(data.project_id).toBe(projectId); // the RPC resolved file → version → project
  logId = data.id;
});

afterAll(cleanupFactories);

// ---------------------------------------------------------------------------------------------
// T-RLS-44 select (ADR-0002 #75) — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-44 project_downloads select', () => {
  it.each(NON_ADMIN)('T-RLS-44 %s cannot read the download log', async (role) => {
    await expectPolicy({
      table: 'project_downloads',
      op: 'select',
      role,
      allowed: false,
      filter: { id: logId },
    });
  });

  it.each(['admin', 'service'] as const)('T-RLS-44 %s reads the log row', async (role) => {
    await expectPolicy({
      table: 'project_downloads',
      op: 'select',
      role,
      allowed: true,
      filter: { id: logId },
      expectRows: 1,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-45 insert — D | D | D | D | D | A (record_download / service only)
// ---------------------------------------------------------------------------------------------
function logRow(id: string): RowValues {
  return {
    id,
    project_id: projectId,
    file_id: fileId,
    ip_hash: 't_rls45_ip',
    ua_hash: 't_rls45_ua',
  };
}

describe('T-RLS-45 project_downloads insert', () => {
  it.each(NON_SERVICE)('T-RLS-45 %s cannot insert a log row', async (role) => {
    const id = randomUUID();
    await expectPolicy({
      table: 'project_downloads',
      op: 'insert',
      role,
      allowed: false,
      row: logRow(id),
    });
    const { data } = await service.from('project_downloads').select('id').eq('id', id);
    expect(data).toEqual([]);
  });

  it('T-RLS-45 svc inserts a log row', async () => {
    await expectPolicy({
      table: 'project_downloads',
      op: 'insert',
      role: 'service',
      allowed: true,
      row: logRow(randomUUID()),
      expectRows: 1,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-46 update — D | D | D | D | D | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-46 project_downloads update', () => {
  it.each(NON_SERVICE)('T-RLS-46 %s cannot update a log row', async (role) => {
    await expectPolicy({
      table: 'project_downloads',
      op: 'update',
      role,
      allowed: false,
      filter: { id: logId },
      patch: { ip_hash: 't_rls46_patched' },
    });
    const { data } = await service
      .from('project_downloads')
      .select('ip_hash')
      .eq('id', logId)
      .single();
    expect(data?.ip_hash).toBe(ARRANGED_IP);
  });

  it('T-RLS-46 svc updates a log row (factory)', async () => {
    const id = await insertLogRow('rls46');
    await expectPolicy({
      table: 'project_downloads',
      op: 'update',
      role: 'service',
      allowed: true,
      filter: { id },
      patch: { ip_hash: 't_rls46_svc' },
      expectRows: 1,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-47 delete (purge) — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-47 project_downloads delete (purge)', () => {
  it.each(NON_ADMIN)('T-RLS-47 %s cannot delete a log row', async (role) => {
    await expectPolicy({
      table: 'project_downloads',
      op: 'delete',
      role,
      allowed: false,
      filter: { id: logId },
    });
    const { data } = await service.from('project_downloads').select('id').eq('id', logId);
    expect(data).toHaveLength(1);
  });

  it.each(['admin', 'service'] as const)(
    'T-RLS-47 %s deletes a log row (factory)',
    async (role) => {
      const id = await insertLogRow(`rls47_${role}`);
      await expectPolicy({
        table: 'project_downloads',
        op: 'delete',
        role,
        allowed: true,
        filter: { id },
        expectRows: 1,
      });
    },
  );

  it('T-RLS-47 svc purge_project_downloads(90) removes only rows older than 90 days', async () => {
    const oldId = randomUUID();
    const { error: arrangeError } = await service.from('project_downloads').insert({
      id: oldId,
      project_id: projectId,
      file_id: fileId,
      ip_hash: 't_rls47_old_ip',
      ua_hash: 't_rls47_old_ua',
      created_at: new Date(Date.now() - 91 * 86_400_000).toISOString(),
    });
    expect(arrangeError).toBeNull();

    const { data, error } = await service.rpc('purge_project_downloads', { p_days: 90 });
    expect(error).toBeNull();
    expect(typeof data).toBe('number');
    expect(data as number).toBeGreaterThanOrEqual(1);

    const purged = await service.from('project_downloads').select('id').eq('id', oldId);
    expect(purged.data).toEqual([]);
    // The recent arranged row survives the purge.
    const kept = await service.from('project_downloads').select('id').eq('id', logId);
    expect(kept.data).toHaveLength(1);
  });
});
