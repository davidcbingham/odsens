/**
 * tests/db/rls/_meta.test.ts — T-RLS-123 (docs/build/05-test-plan.md §7.1, H-3, 01 INV-28).
 * Every table in `public` has RLS enabled and ≥1 policy, and every such table has its matrix file
 * `tests/db/rls/<table>.test.ts`. Runs through psql (brew install libpq) against the local stack.
 * At S0 there are no tables yet, so the per-table assertions pass vacuously — the catalog query and
 * the fs check are real from day one.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { hasPsql, sql } from '@/tests/helpers/db';

const RLS_DIR = path.resolve(import.meta.dirname);

const CATALOG_QUERY = `
  select c.relname,
         c.relrowsecurity,
         (select count(*) from pg_policies p
            where p.schemaname = 'public' and p.tablename = c.relname) as policies
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
  order by c.relname
`;

type TableRow = { name: string; rls: boolean; policies: number };

function loadTables(): TableRow[] {
  return sql(CATALOG_QUERY).map(([name, rls, policies]) => ({
    name: name ?? '',
    rls: rls === 't',
    policies: Number(policies ?? '0'),
  }));
}

describe('T-RLS-123 RLS meta', () => {
  it('T-RLS-123 psql is available for catalog checks', () => {
    expect(
      hasPsql(),
      'psql is required for tests/db/rls/_meta.test.ts — install it with `brew install libpq` (then `brew link --force libpq`).',
    ).toBe(true);
  });

  it('T-RLS-123 every public table has RLS enabled and at least one policy', () => {
    const tables = loadTables();
    const missingRls = tables.filter((t) => !t.rls).map((t) => t.name);
    const missingPolicies = tables.filter((t) => t.policies < 1).map((t) => t.name);
    expect(missingRls, 'tables with RLS disabled (01 INV-28)').toEqual([]);
    expect(missingPolicies, 'tables without any policy (01 INV-28)').toEqual([]);
  });

  it('T-RLS-123 every public table has tests/db/rls/<table>.test.ts', () => {
    const tables = loadTables();
    const withoutFile = tables
      .map((t) => t.name)
      .filter((name) => !fs.existsSync(path.join(RLS_DIR, `${name}.test.ts`)));
    expect(withoutFile, 'tables missing their RLS matrix file (05 H-3)').toEqual([]);
  });
});
