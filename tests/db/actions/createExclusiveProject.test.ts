/**
 * tests/db/actions/createExclusiveProject.test.ts — T-ACT-34 / T-ACT-35 (05 §7.2; 04 §1.4
 * `createExclusiveProject`; ADR-0002 C7 admin-only, #38 no draft previews; lib/validation/slug.ts;
 * migration 20260827090000).
 *
 * Auth matrix (T-ACT-34): anon `unauthenticated` · user D `forbidden` · banned D `forbidden` (the
 * seed banned account has role `user`, so `requireRole`'s rank check answers — 04 SC-04) · mod D
 * `forbidden` (ADR-0002 C7: exclusive projects are admin-only) · admin A (draft row created).
 *
 * Validation (T-ACT-35): slug regex + `RESERVED_SLUGS` → `validation`; taken slug → `conflict` —
 * against BOTH seed slugs (`metal-pipe-mace`, a Modrinth row, proving cross-source uniqueness, and
 * `seed-exclusive-pack`) and case-insensitively against a mixed-case factory slug (the citext half:
 * an uppercase INPUT like `Metal-Pipe-Mace` never reaches the DB — the schema regex rejects it —
 * so case-insensitivity is proven with a lowercase input vs a mixed-case stored slug). `title` /
 * `description` / `body_md` boundaries; `loaders` outside `LOADERS`; extra `source` / `external_id`
 * / `downloads_*` / `status` keys are stripped by zod (row lands as `source='odsens'`,
 * `external_id NULL`, `status='draft'`, downloads all 0); NO revalidation on create (a draft is
 * invisible everywhere — ADR-0002 #38).
 *
 * Rows the ACTION inserts are not factory-tracked, so they are tracked locally and deleted in
 * `afterAll`; factory rows fall to `cleanupFactories`. Seed rows are never mutated (05 H-1).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createExclusiveProject } from '@/lib/actions/projects';
import type { CreateExclusiveProjectInput } from '@/lib/actions/projects.schema';
import { expectFail, expectOk } from '@/tests/helpers/actionResult';
import { asRole } from '@/tests/helpers/asRole';
import { callAction, setupActionMocks } from '@/tests/helpers/callAction';
import { cleanupFactories, makeProject } from '@/tests/helpers/factories';
import { spyRevalidateTag } from '@/tests/helpers/spies';

setupActionMocks();

const service = asRole('service');

/** Projects inserted by the ACTION (no factory tracks them) — removed before the factory sweep. */
const actionProjects: string[] = [];

afterAll(async () => {
  if (actionProjects.length > 0) {
    const { error } = await service.from('projects').delete().in('id', actionProjects);
    if (error) throw new Error(`action-created project cleanup failed: ${error.message}`);
  }
  await cleanupFactories();
});

/** A fresh valid slug per call — unique across parallel suites hitting the same local stack. */
const uniqueSlug = (): string => `t-${randomUUID().replace(/-/g, '').slice(0, 16)}`;

function validInput(
  overrides: Partial<CreateExclusiveProjectInput> = {},
): CreateExclusiveProjectInput {
  return {
    slug: uniqueSlug(),
    title: 't_ exclusive project',
    description: 't_ exclusive project description',
    project_type: 'datapack',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------------------------
// T-ACT-34 — auth matrix (anon | user | banned | mod | admin)
// ---------------------------------------------------------------------------------------------

describe('T-ACT-34 createExclusiveProject auth matrix', () => {
  it.each([
    { role: 'anon' as const, code: 'unauthenticated' as const, message: 'Sign in first.' },
    { role: 'user' as const, code: 'forbidden' as const, message: 'Not allowed.' },
    // The seed banned account has role `user` — `requireRole`'s rank check fires (04 SC-04).
    { role: 'banned' as const, code: 'forbidden' as const, message: 'Not allowed.' },
    // ADR-0002 C7: exclusive projects are admin-only; moderators get `forbidden`.
    { role: 'mod' as const, code: 'forbidden' as const, message: 'Not allowed.' },
  ])('T-ACT-34 $role → $code', async ({ role, code, message }) => {
    const error = expectFail(
      await callAction(createExclusiveProject, validInput(), { role }),
      code,
    );
    expect(error.message).toBe(message);
  });

  it('T-ACT-34 admin → A: draft odsens row created, {id, slug} returned', async () => {
    const slug = uniqueSlug();
    const data = expectOk(
      await callAction(createExclusiveProject, validInput({ slug }), { role: 'admin' }),
    );
    actionProjects.push(data.id);
    expect(data.slug).toBe(slug);

    const { data: row, error } = await service
      .from('projects')
      .select('source, status, published_at')
      .eq('id', data.id)
      .single();
    expect(error).toBeNull();
    expect(row).toEqual({ source: 'odsens', status: 'draft', published_at: null });
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-35 — validation (04 §1.4 input cell), slug conflicts, ignored keys, no revalidation
// ---------------------------------------------------------------------------------------------

describe('T-ACT-35 createExclusiveProject validation', () => {
  it.each<{ name: string; input: CreateExclusiveProjectInput; field: string }>([
    { name: "slug 'ab' (too short)", input: validInput({ slug: 'ab' }), field: 'slug' },
    { name: "slug '-abc' (leading dash)", input: validInput({ slug: '-abc' }), field: 'slug' },
    { name: "slug 'abc-' (trailing dash)", input: validInput({ slug: 'abc-' }), field: 'slug' },
    { name: 'slug 65 chars', input: validInput({ slug: 'a'.repeat(65) }), field: 'slug' },
    // RESERVED_SLUGS, 04 order verbatim (lib/validation/slug.ts).
    { name: "reserved slug 'new'", input: validInput({ slug: 'new' }), field: 'slug' },
    { name: "reserved slug 'edit'", input: validInput({ slug: 'edit' }), field: 'slug' },
    { name: "reserved slug 'admin'", input: validInput({ slug: 'admin' }), field: 'slug' },
    { name: "reserved slug 'api'", input: validInput({ slug: 'api' }), field: 'slug' },
    { name: "reserved slug 'projects'", input: validInput({ slug: 'projects' }), field: 'slug' },
    {
      name: 'project_type outside the enum',
      input: Object.assign(validInput(), { project_type: 'shader' }),
      field: 'project_type',
    },
    { name: 'title empty', input: validInput({ title: '' }), field: 'title' },
    { name: 'title 81 chars', input: validInput({ title: 'x'.repeat(81) }), field: 'title' },
    { name: 'description empty', input: validInput({ description: '' }), field: 'description' },
    {
      name: 'description 257 chars',
      input: validInput({ description: 'x'.repeat(257) }),
      field: 'description',
    },
    {
      name: 'body_md 65537 chars',
      input: validInput({ body_md: 'x'.repeat(65537) }),
      field: 'body_md',
    },
    {
      name: 'loaders outside LOADERS',
      input: validInput({ loaders: ['fabric', 'not-a-loader'] }),
      field: 'loaders.1',
    },
  ])('T-ACT-35 $name → validation', async ({ input, field }) => {
    const error = expectFail(
      await callAction(createExclusiveProject, input, { role: 'admin' }),
      'validation',
    );
    expect(error.field).toBe(field);
  });

  it("T-ACT-35 taken slug vs the Modrinth seed slug ('Metal-Pipe-Mace' → metal-pipe-mace) → conflict", async () => {
    // 04 §1.4: "slug conflict (citext, incl. Modrinth slugs)" — the exclusive namespace shares one
    // unique citext column with synced rows. The uppercase form itself is regex-rejected input, so
    // the lowercase form carries the cross-source half; the citext half is the next test.
    const error = expectFail(
      await callAction(createExclusiveProject, validInput({ slug: 'metal-pipe-mace' }), {
        role: 'admin',
      }),
      'conflict',
    );
    expect(error.message).toBe("That slug's taken.");
    expect(error.field).toBe('slug');
  });

  it('T-ACT-35 taken slug is case-insensitive (citext): lowercase input vs a mixed-case stored slug → conflict', async () => {
    const tag = randomUUID().replace(/-/g, '').slice(0, 12);
    await makeProject({ slug: `T-${tag.toUpperCase()}-CASE` });
    const error = expectFail(
      await callAction(createExclusiveProject, validInput({ slug: `t-${tag}-case` }), {
        role: 'admin',
      }),
      'conflict',
    );
    expect(error.message).toBe("That slug's taken.");
    expect(error.field).toBe('slug');
  });

  it('T-ACT-35 taken slug vs the exclusive seed slug (seed-exclusive-pack) → conflict', async () => {
    const error = expectFail(
      await callAction(createExclusiveProject, validInput({ slug: 'seed-exclusive-pack' }), {
        role: 'admin',
      }),
      'conflict',
    );
    expect(error.message).toBe("That slug's taken.");
    expect(error.field).toBe('slug');
  });

  it('T-ACT-35 extra source/external_id/downloads_modrinth/status keys ignored; max boundaries accepted; NO revalidate', async () => {
    const tags = spyRevalidateTag();
    const slug = uniqueSlug();
    // zod strips unknown object keys (04 §1.4) — these must not leak into the insert.
    const input = Object.assign(
      validInput({
        slug,
        title: 'x'.repeat(80),
        description: 'y'.repeat(256),
        body_md: 'z'.repeat(65536),
      }),
      {
        source: 'modrinth',
        external_id: 'sd999999',
        downloads_modrinth: 4242,
        status: 'published',
      },
    );
    const data = expectOk(await callAction(createExclusiveProject, input, { role: 'admin' }));
    actionProjects.push(data.id);

    const { data: row, error } = await service
      .from('projects')
      .select(
        'source, external_id, status, downloads_modrinth, downloads_curseforge, downloads_direct, title, description, body_md',
      )
      .eq('id', data.id)
      .single();
    expect(error).toBeNull();
    expect(row).toEqual({
      source: 'odsens',
      external_id: null,
      status: 'draft',
      downloads_modrinth: 0,
      downloads_curseforge: 0,
      downloads_direct: 0,
      title: 'x'.repeat(80),
      description: 'y'.repeat(256),
      body_md: 'z'.repeat(65536),
    });

    // ADR-0002 #38: a draft is invisible everywhere — nothing to revalidate on create.
    expect(tags.calls).toEqual([]);
  });
});
