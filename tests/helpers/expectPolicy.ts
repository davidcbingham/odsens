/**
 * tests/helpers/expectPolicy.ts — docs/build/05-test-plan.md §1.3 `expectPolicy` contract.
 *
 * Runs one table op through `asRole(role)` and asserts the RLS outcome:
 *   allowed:true  → no error; when `expectRows` is given the affected/returned row count matches
 *   allowed:false → a PostgREST permission error (HTTP 401/403 or SQLSTATE 42501) OR zero rows
 *                   affected — RLS silently filters selects/updates/deletes. To tell "0 rows because
 *                   denied" from "0 rows because none exist", the target row is first proven to exist
 *                   through `service` whenever `filter` (or `row` with an `id`) is given.
 *
 * Table names are the registry spelling; the string type keeps the helper usable before the first
 * table lands (S1.1) — the per-table matrix files pass real names.
 */
import { expect } from 'vitest';
import { asRole, loose, type TestRole } from './asRole';

export type PolicyOp = 'select' | 'insert' | 'update' | 'delete';

type Scalar = string | number | boolean | null;
export type RowValues = Record<string, Scalar | Scalar[]>;
export type RowFilter = Record<string, Scalar>;

export type ExpectPolicyArgs = {
  table: string;
  op: PolicyOp;
  role: TestRole;
  allowed: boolean;
  /** insert: the row to insert. update/delete/select: optional `{ id }` shortcut for `filter`. */
  row?: RowValues;
  /** update: the columns to change. */
  patch?: RowValues;
  /** eq-filters that select the target row(s) for select/update/delete. */
  filter?: RowFilter;
  /** allowed:true only — assert this many rows were returned/affected. */
  expectRows?: number;
};

type OpOutcome = { error: { code?: string; message: string } | null; status: number; rows: number };

const DENIED_STATUSES = new Set([401, 403]);
const DENIED_SQLSTATE = '42501';

// The matrix runner is table-driven (names arrive as strings from the per-table files), so it drives a
// minimal structural view of the PostgREST builder instead of the generated `Database` type — it must
// compile before and after every `supabase gen types` regen.
type QueryOutcome = {
  data: unknown[] | null;
  error: { code?: string; message: string } | null;
  status: number;
};
type LooseFilter = PromiseLike<QueryOutcome> & {
  eq(column: string, value: Scalar): LooseFilter;
  select(columns: string): LooseFilter;
};
type LooseQuery = {
  select(columns: string): LooseFilter;
  insert(row: RowValues): { select(columns: string): LooseFilter };
  update(patch: RowValues): LooseFilter;
  delete(): LooseFilter;
};

function fromTable(role: TestRole, table: string): LooseQuery {
  return loose(asRole(role)).from(table) as unknown as LooseQuery;
}

function resolveFilter(args: ExpectPolicyArgs): RowFilter | undefined {
  if (args.filter) return args.filter;
  const id = args.row?.['id'];
  if (id !== undefined && !Array.isArray(id)) return { id };
  return undefined;
}

function applyFilter(q: LooseFilter, filter: RowFilter): LooseFilter {
  let query = q;
  for (const [column, value] of Object.entries(filter)) {
    query = query.eq(column, value);
  }
  return query;
}

async function proveRowExists(table: string, filter: RowFilter): Promise<void> {
  const { data, error } = await applyFilter(fromTable('service', table).select('*'), filter);
  if (error) {
    throw new Error(
      `expectPolicy: service could not read ${table} to prove the row exists: ${error.message}`,
    );
  }
  if (!data || data.length === 0) {
    throw new Error(
      `expectPolicy: no row in ${table} matches ${JSON.stringify(filter)} — seed/arrange it via service first ` +
        '(a denied op cannot be told apart from a missing row otherwise).',
    );
  }
}

async function runOp(args: ExpectPolicyArgs, filter: RowFilter | undefined): Promise<OpOutcome> {
  const table = fromTable(args.role, args.table);
  switch (args.op) {
    case 'select': {
      let q = table.select('*');
      if (filter) q = applyFilter(q, filter);
      const { data, error, status } = await q;
      return { error, status, rows: data?.length ?? 0 };
    }
    case 'insert': {
      if (!args.row) throw new Error('expectPolicy: insert needs `row`');
      const { data, error, status } = await table.insert(args.row).select('*');
      return { error, status, rows: data?.length ?? 0 };
    }
    case 'update': {
      if (!args.patch) throw new Error('expectPolicy: update needs `patch`');
      if (!filter) throw new Error('expectPolicy: update needs `filter` (or `row.id`)');
      const { data, error, status } = await applyFilter(table.update(args.patch), filter).select(
        '*',
      );
      return { error, status, rows: data?.length ?? 0 };
    }
    case 'delete': {
      if (!filter) throw new Error('expectPolicy: delete needs `filter` (or `row.id`)');
      const { data, error, status } = await applyFilter(table.delete(), filter).select('*');
      return { error, status, rows: data?.length ?? 0 };
    }
  }
}

function describeOp(args: ExpectPolicyArgs): string {
  return `${args.role} ${args.op} ${args.table}`;
}

/** Asserts one cell of the RLS matrix (05 §1.3). */
export async function expectPolicy(args: ExpectPolicyArgs): Promise<void> {
  const filter = resolveFilter(args);
  const label = describeOp(args);

  if (!args.allowed && filter && args.op !== 'insert') {
    await proveRowExists(args.table, filter);
  }

  const outcome = await runOp(args, filter);

  if (args.allowed) {
    expect(
      outcome.error,
      `${label} should be allowed but failed: ${outcome.error?.message ?? ''}`,
    ).toBeNull();
    if (args.expectRows !== undefined) {
      expect(outcome.rows, `${label} affected rows`).toBe(args.expectRows);
    }
    return;
  }

  const deniedByError =
    outcome.error !== null &&
    (DENIED_STATUSES.has(outcome.status) || outcome.error.code === DENIED_SQLSTATE);
  const deniedByFilter = outcome.error === null && outcome.rows === 0;
  expect(
    deniedByError || deniedByFilter,
    `${label} should be denied; got status ${String(outcome.status)}, rows ${String(outcome.rows)}, ` +
      `error ${outcome.error ? `${outcome.error.code ?? '?'} ${outcome.error.message}` : 'none'}`,
  ).toBe(true);
}
