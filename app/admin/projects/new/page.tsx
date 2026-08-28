import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Breadcrumb } from '@/components/primitives/Breadcrumb';
import { Button } from '@/components/primitives/Button';
import { Field } from '@/components/primitives/Field';
import { Select, type SelectOption } from '@/components/primitives/Select';
import { createExclusiveProject } from '@/lib/actions/projects';
import type { CreateExclusiveProjectInput } from '@/lib/actions/projects.schema';
import type { ActionError } from '@/lib/actions/result';
import { getViewer } from '@/lib/auth';
import styles from './page.module.css';

/**
 * `/admin/projects/new` — the S1.3 create form for exclusive projects (02 §1.3 row: admin-only
 * mutations, `Field`/`Select`/`Button`; 00 S1.3 "Admin"; DESIGN.md §6 #9 admin, §5 Admin field).
 * Server Component (03 C-16), no client island — the whole page is the 03 C-17 `<form action>`
 * mechanism. Dynamic + session-backed under the `app/admin/layout.tsx` gate (01 INV-31); the page
 * repeats the sibling quiet-bail viewer check (RP-04) — anon / role `user` return `null` so the
 * layout's `AdminGate` / root 404 stand. Header mirrors `[id]`: `Breadcrumb` + plain h1 (the
 * "ADMIN" `PixelLabel` eyebrow is `/admin`-only).
 *
 * One form, one page-scoped `'use server'` closure (`createDraft`): it builds the TYPED 04 §1.4
 * `CreateExclusiveProjectInput` — comma fields (`categories` / `loaders` / `game_versions`) split
 * on `,`, trimmed, empties dropped, the KEY OMITTED when nothing is left (the schema defaults
 * them to `[]`); optional text/url fields omitted when blank (create has no null semantics —
 * unlike the `[id]` page's `orNull` overrides) — and calls `createExclusiveProject` (auth /
 * validation / insert / logging live in `lib/actions/projects.ts`, 04 SC-01/SC-06). ok →
 * `redirect` to `/admin/projects/<id>` — the edit page carries the uploads (data-model §6
 * canonical flow, 05 T-E2E-35: create draft → redirect → upload there; hence NO `UploadWell`
 * here). error → PRG back to this URL with the sibling `?form=&field=&error=` query; the page
 * maps field errors onto the matching `Field error` prop (dotted issue paths like `loaders.0`
 * map to their root field) and everything else — including `project_type`: `Select` has no error
 * surface — to the `<p role="alert">` under the form. Values are lost on the error round-trip
 * (accepted S1.2 trade-off, same as the siblings). A created draft is invisible everywhere until
 * publish (ADR-0002 #38: no preview URLs).
 *
 * Moderators (ADR-0002 C7; 02 §1.3 auth rule / 03 §2.10 preamble): the form renders DISABLED —
 * every control `disabled`, the submit inside the `title="Admin only"` wrapper with the
 * `visually-hidden` explainer (the `[id]` page's `saveButton` treatment) — never hidden; the
 * action refuses them server-side regardless (01 INV-18).
 */
type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const metadata: Metadata = {
  title: 'New project · Admin',
};

const ADMIN_ONLY_TITLE = 'Admin only';
const BASE = '/admin/projects/new';

/** 04 §1.4 `PROJECT_TYPE` as `Select` options (labels per the 02 §1.3 form spec). */
const TYPE_OPTIONS: SelectOption[] = [
  { value: 'mod', label: 'Mod' },
  { value: 'datapack', label: 'Datapack' },
  { value: 'resourcepack', label: 'Resource pack' },
  { value: 'plugin', label: 'Plugin' },
];

/** The `name`s that have a `Field` to carry an inline error (everything else → the form alert). */
const FORM_FIELDS = [
  'slug',
  'title',
  'description',
  'body_md',
  'categories',
  'loaders',
  'game_versions',
  'license',
  'source_url',
  'issues_url',
  'discord_url',
];

/** Required text field: trimmed as-is — the schema supplies the "Type a …" message when empty. */
function requiredText(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Optional text/url field: trimmed, `undefined` when blank — the caller omits the key (header). */
function orOmit(value: FormDataEntryValue | null): string | undefined {
  const text = typeof value === 'string' ? value.trim() : '';
  return text === '' ? undefined : text;
}

/** Comma field → list: split on `,`, trimmed, empties dropped; `undefined` when nothing is left. */
function orList(value: FormDataEntryValue | null): string[] | undefined {
  const items = (typeof value === 'string' ? value : '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
  return items.length > 0 ? items : undefined;
}

/** The error round-trip query (`form` names the form, `field` the input, `error` the message). */
function withError(base: string, form: 'create', error: ActionError): string {
  const query = new URLSearchParams({ form, error: error.message });
  if (error.field) query.set('field', error.field);
  return `${base}?${query.toString()}`;
}

function queryValue(value: string | string[] | undefined): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export default async function NewProjectPage({ searchParams }: PageProps) {
  const query = await searchParams;

  // RP-04: bail quietly for anon / role `user` — the layout renders `AdminGate` / the root 404;
  // a page-thrown `notFound()` here would replace the anon gate (defence in depth, 01 INV-31).
  const viewer = await getViewer();
  const role = viewer?.profile?.role;
  if (!viewer?.profile?.handle || role === undefined || role === 'user') return null;
  const canCurate = role === 'admin';

  // ---- Error round-trip (see header) ---------------------------------------------------------
  const errorForm = queryValue(query.form);
  const errorField = queryValue(query.field);
  const errorMessage = queryValue(query.error);
  // Dotted issue paths (`loaders.0`) land on the root field's inline error.
  const errorFieldRoot = errorField === null ? null : (errorField.split('.')[0] ?? null);
  const fieldError = (field: string): string | undefined =>
    errorForm === 'create' && errorFieldRoot === field && errorMessage !== null
      ? errorMessage
      : undefined;
  const formError =
    errorForm === 'create' &&
    errorMessage !== null &&
    (errorFieldRoot === null || !FORM_FIELDS.includes(errorFieldRoot))
      ? errorMessage
      : null;

  // ---- Server-function glue (03 C-17 `<form action>`; typed input per 04 §1.4) ----------------

  async function createDraft(formData: FormData): Promise<void> {
    'use server';
    const body_md = orOmit(formData.get('body_md'));
    const categories = orList(formData.get('categories'));
    const loaders = orList(formData.get('loaders'));
    const game_versions = orList(formData.get('game_versions'));
    const license = orOmit(formData.get('license'));
    const source_url = orOmit(formData.get('source_url'));
    const issues_url = orOmit(formData.get('issues_url'));
    const discord_url = orOmit(formData.get('discord_url'));
    const result = await createExclusiveProject({
      slug: requiredText(formData.get('slug')),
      title: requiredText(formData.get('title')),
      description: requiredText(formData.get('description')),
      // The `<Select>` only offers the 04 §1.4 values; the action re-validates against
      // `PROJECT_TYPE` regardless (04 SC-02), so the cast never reaches the database wrong.
      project_type: requiredText(
        formData.get('project_type'),
      ) as CreateExclusiveProjectInput['project_type'],
      ...(body_md !== undefined ? { body_md } : {}),
      ...(categories !== undefined ? { categories } : {}),
      ...(loaders !== undefined ? { loaders } : {}),
      ...(game_versions !== undefined ? { game_versions } : {}),
      ...(license !== undefined ? { license } : {}),
      ...(source_url !== undefined ? { source_url } : {}),
      ...(issues_url !== undefined ? { issues_url } : {}),
      ...(discord_url !== undefined ? { discord_url } : {}),
    });
    redirect(
      result.ok ? `/admin/projects/${result.data.id}` : withError(BASE, 'create', result.error),
    );
  }

  // ---- Moderator rendering helpers (03 §2.10 rule) -------------------------------------------

  const saveButton = (idSuffix: string, label: string, variant: 'primary' | 'secondary') =>
    canCurate ? (
      <Button variant={variant} type="submit">
        {label}
      </Button>
    ) : (
      <span title={ADMIN_ONLY_TITLE}>
        <Button variant={variant} disabled aria-describedby={`admin-only-${idSuffix}`}>
          {label}
        </Button>
        <span id={`admin-only-${idSuffix}`} className="visually-hidden">
          {ADMIN_ONLY_TITLE}
        </span>
      </span>
    );

  return (
    <div className={styles['admin-project-new']}>
      <header className={styles['admin-project-new-head']}>
        <Breadcrumb
          items={[{ label: 'Projects', href: '/admin/projects' }, { label: 'New project' }]}
        />
        <h1 className={styles['admin-project-new-title']}>New project</h1>
        <p className={styles['admin-project-new-intro']}>
          A project that lives only on odsens. Modrinth-shaped, so it fits every card and page.
        </p>
      </header>

      <form action={createDraft} className={styles['admin-project-new-form']}>
        <Field
          label="Slug"
          name="slug"
          required
          helper="Lowercase letters, numbers and dashes. 3–64 characters. Fixed once published."
          error={fieldError('slug')}
          disabled={!canCurate}
        />
        <Field
          label="Title"
          name="title"
          required
          maxLength={80}
          counter
          error={fieldError('title')}
          disabled={!canCurate}
        />
        <Field
          label="Description"
          name="description"
          type="textarea"
          required
          maxLength={256}
          counter
          helper="One or two sentences for cards and search."
          error={fieldError('description')}
          disabled={!canCurate}
          inputProps={{ rows: 3 }}
        />
        <Field
          label="Body"
          name="body_md"
          type="textarea"
          helper="Markdown. Headings, lists and links work."
          error={fieldError('body_md')}
          disabled={!canCurate}
          inputProps={{ rows: 8 }}
        />
        <Select label="Type" name="project_type" options={TYPE_OPTIONS} disabled={!canCurate} />
        <Field
          label="Categories"
          name="categories"
          helper="Comma-separated, up to 10."
          error={fieldError('categories')}
          disabled={!canCurate}
        />
        <Field
          label="Loaders"
          name="loaders"
          helper="Comma-separated: fabric, forge, neoforge, quilt, paper, spigot, bukkit, purpur, folia, velocity, bungeecord, waterfall, sponge, datapack, minecraft."
          error={fieldError('loaders')}
          disabled={!canCurate}
        />
        <Field
          label="Game versions"
          name="game_versions"
          helper="Comma-separated, like 1.21, 1.21.1."
          error={fieldError('game_versions')}
          disabled={!canCurate}
        />
        <Field
          label="Licence"
          name="license"
          maxLength={64}
          error={fieldError('license')}
          disabled={!canCurate}
        />
        <Field
          label="Source link"
          name="source_url"
          type="url"
          helper="https:// only."
          error={fieldError('source_url')}
          disabled={!canCurate}
        />
        <Field
          label="Issues link"
          name="issues_url"
          type="url"
          error={fieldError('issues_url')}
          disabled={!canCurate}
        />
        <Field
          label="Discord link"
          name="discord_url"
          type="url"
          error={fieldError('discord_url')}
          disabled={!canCurate}
        />
        {formError ? (
          <p role="alert" className={styles['admin-project-new-error']}>
            {formError}
          </p>
        ) : null}
        <div className={styles['admin-project-new-actions']}>
          {saveButton('create', 'Create draft', 'primary')}
        </div>
      </form>

      <p className={styles['admin-project-new-note']}>
        Drafts are invisible until you publish. Files and pictures upload from the project page
        after this step.
      </p>
    </div>
  );
}
