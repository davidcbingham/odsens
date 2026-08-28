import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import {
  ProjectFileWell,
  UploadWell,
  type ProjectFileWellProps,
  type UploadWellProps,
} from '@/components/admin/UploadWell';
import { Button } from '@/components/primitives/Button';
import { Field } from '@/components/primitives/Field';
import { PixelLabel } from '@/components/primitives/PixelLabel';
import { sectionTitleId } from '@/components/primitives/SectionTitle';
import { Select } from '@/components/primitives/Select';
import { StatusPill } from '@/components/primitives/StatusPill';
import { Toggle } from '@/components/primitives/Toggle';
import { TypeBadge } from '@/components/primitives/TypeBadge';
import {
  curateProject,
  publishProject,
  setProjectLink,
  updateExclusiveProject,
} from '@/lib/actions/projects';
import type { ActionError } from '@/lib/actions/result';
import { uploadProjectFile, uploadProjectMedia } from '@/lib/actions/uploads';
import { getViewer } from '@/lib/auth';
import { adminProjectStatus, getAdminProject, listAdminProjectVersions } from '@/lib/data/admin';
import { parseGalleryEntries, resolveMediaUrl } from '@/lib/data/projects';
import { formatDate } from '@/lib/format/date';
import { formatCount } from '@/lib/format/number';
import { formatFileSize } from '@/lib/format/size';
import styles from './page.module.css';

/**
 * `/admin/projects/[id]` — S1.2 curate view for synced projects + the S1.3 exclusive editor,
 * branched on `projects.source` (02 §1.3 row; ADR-0002 A11 keeps feature / hide / reorder on
 * `/admin/projects`). Synced (`modrinth`): overrides, notes, comments toggle, CF id, extra
 * gallery — now with the S1.3 `UploadWell` under the gallery list (ADR-0002 C10). Exclusive
 * (`odsens`): publish controls (`publishProject`, ADR-0002 #65 preconditions / #38 no draft
 * previews), the real-columns details form (`updateExclusiveProject` — slug draft-only), icon +
 * gallery uploads (`uploadProjectMedia`) and versions & files (`uploadProjectFile`,
 * `ProjectFileWell` — ADR-0026 partial unique). Server Component (03 C-16); the upload wells are
 * the page's only client islands (03 C-16a `UploadWell`, C-17 exception 4 — the signed-URL PUT).
 * Dynamic + session-backed under the `app/admin/layout.tsx` gate (01 INV-31); reads are
 * `lib/data/admin.ts` `getAdminProject` / `listAdminProjectVersions` on the request-cookie client
 * (01 INV-12/INV-15; ADR-0022) — unknown id (or a row RLS hides from a moderator, 05
 * T-RLS-17/18) → `notFound()` (02 §1.3 Files cell). Media previews resolve Storage paths through
 * `resolveMediaUrl` (data-model §2 — the public detail's builder) into `next/image`.
 *
 * Forms — the 03 C-17 `<form action>` mechanism: each form posts to a page-scoped `'use server'`
 * closure that builds the TYPED 04 §1.4 input and calls the `lib/actions/projects.ts` action
 * (auth / validation / writes / revalidation all live there, 04 SC-01/SC-06). Results surface
 * without a client hook: ok → `redirect` back to the plain URL (PRG); error → `redirect` back
 * with `?form=&field=&error=` and the page hands the message to the matching `Field error`
 * (inline `role="alert"` + `aria-invalid` — 03 §2.2 Field a11y / C-30 "errors inline, never
 * toast"; admin routes are dynamic, so reading `searchParams` is legal — 02 §0.1; RP-03 restricts
 * public pages only). `publishProject` `precondition_failed` (the message lists what is missing,
 * 05 T-ACT-37) lands on the PUBLISH form's `role="alert"` line the same way. `comments_enabled`
 * lives on `project_overrides` for every project, so the toggle renders on both branches
 * (`curateProject` + PRG redirect — the list page's `curateAndRefresh` mechanism).
 *
 * Moderators (ADR-0002 C7; 03 §2.10 rule): every field, toggle, button and upload well renders
 * DISABLED (`disabled` + `title="Admin only"` on the control's wrapper + the `Button`
 * `aria-describedby` explainer — the `SyncStatus` precedent), never hidden; the actions refuse
 * them server-side regardless (01 INV-18).
 */
type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const ADMIN_ONLY_TITLE = 'Admin only';

/**
 * The wells type `action` as the wire shape (`Record<string, unknown>` in — the client island
 * cannot know the 04 §1.4.5 input unions). The references below ARE the server actions
 * (serializable, 03 C-17 exception 4) — the assertion only widens the parameter for the prop;
 * zod re-validates every call server-side (04 SC-02), so nothing rests on the compile-time type.
 */
const uploadProjectMediaAction = uploadProjectMedia as unknown as UploadWellProps['action'];
const uploadProjectFileAction = uploadProjectFile as unknown as ProjectFileWellProps['action'];

/** The `Select Type` options (04 §1.4 `PROJECT_TYPE`), narrowed without zod (03 C-16 page). */
const PROJECT_TYPES = ['mod', 'datapack', 'resourcepack', 'plugin'] as const;
type ProjectTypeValue = (typeof PROJECT_TYPES)[number];
const PROJECT_TYPE_OPTIONS: { value: ProjectTypeValue; label: string }[] = [
  { value: 'mod', label: 'Mod' },
  { value: 'datapack', label: 'Datapack' },
  { value: 'resourcepack', label: 'Resource pack' },
  { value: 'plugin', label: 'Plugin' },
];

/** Empty input = "no override" — the 04 §1.4 nullable columns clear on `null`. */
function orNull(value: FormDataEntryValue | null): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text === '' ? null : text;
}

/** Empty input = "not this save" — the 04 §1.4 partial-update fields stay untouched. */
function orUndefined(value: FormDataEntryValue | null): string | undefined {
  const text = typeof value === 'string' ? value.trim() : '';
  return text === '' ? undefined : text;
}

/** Comma-separated field → trimmed non-empty items (the stored `text[]` shape, 04 §1.4). */
function commaList(value: FormDataEntryValue | null): string[] {
  return typeof value === 'string'
    ? value
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part !== '')
    : [];
}

function projectTypeValue(value: FormDataEntryValue | null): ProjectTypeValue | undefined {
  return typeof value === 'string' && (PROJECT_TYPES as readonly string[]).includes(value)
    ? (value as ProjectTypeValue)
    : undefined;
}

/** The error round-trip query (`form` names the form, `field` the input, `error` the message). */
type FormName = 'overrides' | 'link' | 'publish' | 'details';

function withError(base: string, form: FormName, error: ActionError): string {
  const query = new URLSearchParams({ form, error: error.message });
  if (error.field) query.set('field', error.field);
  return `${base}?${query.toString()}`;
}

function queryValue(value: string | string[] | undefined): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  // Same request-scoped read as the page (React cache). Unknown/unreadable → the layout's
  // "Admin" title stands; the page itself 404s.
  const project = await getAdminProject(id).catch(() => null);
  if (!project) return {};
  return { title: `${project.title} · Admin` };
}

export default async function AdminProjectPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const query = await searchParams;

  // RP-04: bail quietly for anon / role `user` — the layout renders `AdminGate` / the root 404;
  // a page-thrown `notFound()` here would replace the anon gate (defence in depth, 01 INV-31).
  const viewer = await getViewer();
  const role = viewer?.profile?.role;
  if (!viewer?.profile?.handle || role === undefined || role === 'user') return null;
  const canCurate = role === 'admin';

  const project = await getAdminProject(id);
  if (!project) notFound();
  const exclusive = project.source === 'odsens';
  const versions = exclusive ? await listAdminProjectVersions(id) : [];

  const base = `/admin/projects/${id}`;
  const override = project.override;
  const commentsEnabled = override?.commentsEnabled ?? true;
  const link = project.curseforgeLink;

  // ---- Error round-trip (see header) ---------------------------------------------------------
  const errorForm = queryValue(query.form);
  const errorField = queryValue(query.field);
  const errorMessage = queryValue(query.error);
  const fieldError = (form: FormName, field: string): string | undefined =>
    errorForm === form && errorField === field && errorMessage !== null ? errorMessage : undefined;
  const formLevelError = (form: FormName, fields: readonly string[]): string | null =>
    errorForm === form &&
    errorMessage !== null &&
    (errorField === null || !fields.includes(errorField))
      ? errorMessage
      : null;
  const OVERRIDE_FIELDS = ['title_override', 'description_override', 'notes_md'];
  const overridesFormError = formLevelError('overrides', OVERRIDE_FIELDS);
  const linkError = errorForm === 'link' && errorMessage !== null ? errorMessage : undefined;
  // `project_type` has no inline slot (`Select` carries no error prop) — it lands form-level.
  const DETAILS_FIELDS = [
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
  const detailsFormError = formLevelError('details', DETAILS_FIELDS);
  const publishError = errorForm === 'publish' && errorMessage !== null ? errorMessage : null;

  // ---- Server-function glue (03 C-17 `<form action>`; typed inputs per 04 §1.4) ---------------

  async function saveOverrides(formData: FormData): Promise<void> {
    'use server';
    const result = await curateProject({
      project_id: id,
      title_override: orNull(formData.get('title_override')),
      description_override: orNull(formData.get('description_override')),
      notes_md: orNull(formData.get('notes_md')),
    });
    redirect(result.ok ? base : withError(base, 'overrides', result.error));
  }

  async function saveLink(formData: FormData): Promise<void> {
    'use server';
    const result = await setProjectLink({
      project_id: id,
      platform: 'curseforge',
      ref: orNull(formData.get('ref')),
    });
    redirect(result.ok ? base : withError(base, 'link', result.error));
  }

  // PRG for the comments Toggle too (the list page's `curateAndRefresh` rationale): tag-only
  // revalidation does not re-render this dynamic route in the action round trip, so the
  // controlled Toggle would stay stale without the redirect.
  async function saveCommentsEnabled(input: {
    project_id: string;
    comments_enabled: boolean;
  }): Promise<void> {
    'use server';
    await curateProject(input);
    redirect(base);
  }

  // The details form edits the real `projects` columns (04 §1.4 `{id} & Partial<create>`): empty
  // required fields are simply not sent; the clearable optionals (licence + the three links) send
  // `null` to clear; the comma fields are always sent — a blanked field stores `[]`.
  async function saveDetails(formData: FormData): Promise<void> {
    'use server';
    const result = await updateExclusiveProject({
      id,
      slug: orUndefined(formData.get('slug')),
      title: orUndefined(formData.get('title')),
      description: orUndefined(formData.get('description')),
      body_md: orUndefined(formData.get('body_md')),
      project_type: projectTypeValue(formData.get('project_type')),
      categories: commaList(formData.get('categories')),
      loaders: commaList(formData.get('loaders')),
      game_versions: commaList(formData.get('game_versions')),
      license: orNull(formData.get('license')),
      source_url: orNull(formData.get('source_url')),
      issues_url: orNull(formData.get('issues_url')),
      discord_url: orNull(formData.get('discord_url')),
    });
    redirect(result.ok ? base : withError(base, 'details', result.error));
  }

  // Bound per button (`.bind` — the `saveCommentsEnabled` precedent): Publish / Hide / Back to
  // draft are each a tiny form. `precondition_failed` lists what is missing (05 T-ACT-37).
  async function setStatus(status: 'draft' | 'published' | 'hidden'): Promise<void> {
    'use server';
    const result = await publishProject({ id, status });
    redirect(result.ok ? base : withError(base, 'publish', result.error));
  }

  // ---- Moderator rendering helpers (03 §2.10 rule) -------------------------------------------

  const saveButton = (
    idSuffix: string,
    label: string,
    variant: 'primary' | 'secondary' | 'ghost',
  ) =>
    canCurate ? (
      <Button variant={variant} type="submit" arrow={false}>
        {label}
      </Button>
    ) : (
      <span title={ADMIN_ONLY_TITLE}>
        <Button
          variant={variant}
          disabled
          arrow={false}
          aria-describedby={`admin-only-${idSuffix}`}
        >
          {label}
        </Button>
        <span id={`admin-only-${idSuffix}`} className="visually-hidden">
          {ADMIN_ONLY_TITLE}
        </span>
      </span>
    );

  const adminOnly = (control: ReactNode): ReactNode =>
    canCurate ? control : <span title={ADMIN_ONLY_TITLE}>{control}</span>;

  // Comments live on `project_overrides` for every project (synced AND exclusive), so the toggle
  // renders on both branches.
  const commentsToggle = (
    <div className={styles['admin-project-toggle-row']}>
      <span className={styles['admin-project-toggle-label']}>Comments</span>
      {canCurate ? (
        <Toggle
          name="comments_enabled"
          checked={commentsEnabled}
          onChange={saveCommentsEnabled.bind(null, {
            project_id: id,
            comments_enabled: !commentsEnabled,
          })}
          role="switch"
          accent="emerald"
          label={`Comments on ${project.title}`}
        />
      ) : (
        <span title={ADMIN_ONLY_TITLE}>
          <Toggle
            name="comments_enabled"
            checked={commentsEnabled}
            role="switch"
            accent="emerald"
            label={`Comments on ${project.title}`}
            disabled
          />
        </span>
      )}
      <p className={styles['admin-project-toggle-help']}>
        Off closes the thread. Old comments stay.
      </p>
    </div>
  );

  // ---- EXCLUSIVE branch (`source='odsens'` — the S1.3 editor) --------------------------------

  if (exclusive) {
    const statusWord = adminProjectStatus(project.status, override?.hidden ?? false);
    const stateSentence =
      project.status === 'draft'
        ? 'This project is a draft. Nobody sees it.'
        : project.status === 'published'
          ? `Live on /projects/${project.slug}.`
          : 'Hidden.';
    const gallery = parseGalleryEntries(project.gallery);

    return (
      <div className={styles['admin-project']}>
        <header className={styles['admin-project-head']}>
          <PixelLabel as="p" tone="gold" size={11}>
            ADMIN
          </PixelLabel>
          <div className={styles['admin-project-status-row']}>
            <h1 className={styles['admin-project-title']}>{project.title}</h1>
            <StatusPill status={statusWord} />
          </div>
          <div className={styles['admin-project-meta']}>
            <TypeBadge type={project.projectType} />
            <span className={styles['admin-project-source']}>
              {project.source} · {project.slug} · {formatCount(project.downloadsTotal)} downloads
            </span>
          </div>
        </header>

        <section
          className={styles['admin-project-section']}
          aria-labelledby={sectionTitleId('PUBLISH')}
        >
          <h2 id={sectionTitleId('PUBLISH')} className={styles['admin-project-heading']}>
            PUBLISH
          </h2>
          <p className={styles['admin-project-state']}>{stateSentence}</p>
          <div className={styles['admin-project-actions']}>
            {project.status === 'published' ? (
              <form action={setStatus.bind(null, 'hidden')}>
                {saveButton('hide', 'Hide', 'secondary')}
              </form>
            ) : (
              <form action={setStatus.bind(null, 'published')}>
                {saveButton('publish', 'Publish', 'primary')}
              </form>
            )}
            {project.status !== 'draft' ? (
              <form action={setStatus.bind(null, 'draft')}>
                {saveButton('unpublish', 'Back to draft', 'ghost')}
              </form>
            ) : null}
          </div>
          {publishError ? (
            <p role="alert" className={styles['admin-project-error']}>
              {publishError}
            </p>
          ) : null}
          {commentsToggle}
        </section>

        <section
          className={styles['admin-project-section']}
          aria-labelledby={sectionTitleId('DETAILS')}
        >
          <h2 id={sectionTitleId('DETAILS')} className={styles['admin-project-heading']}>
            DETAILS
          </h2>
          <form action={saveDetails} className={styles['admin-project-form']}>
            <Field
              label="Slug"
              name="slug"
              defaultValue={project.slug}
              maxLength={64}
              helper="Fixed once published."
              error={fieldError('details', 'slug')}
              disabled={!canCurate}
            />
            <Field
              label="Title"
              name="title"
              defaultValue={project.title}
              maxLength={80}
              counter
              error={fieldError('details', 'title')}
              disabled={!canCurate}
            />
            <Field
              label="Description"
              name="description"
              type="textarea"
              defaultValue={project.description}
              maxLength={256}
              counter
              helper="One or two sentences for cards and search."
              error={fieldError('details', 'description')}
              disabled={!canCurate}
              inputProps={{ rows: 3 }}
            />
            <Field
              label="Body"
              name="body_md"
              type="textarea"
              defaultValue={project.bodyMd}
              maxLength={65536}
              helper="Markdown. The About tab."
              error={fieldError('details', 'body_md')}
              disabled={!canCurate}
              inputProps={{ rows: 10 }}
            />
            <Select
              label="Type"
              name="project_type"
              options={PROJECT_TYPE_OPTIONS}
              defaultValue={project.projectType}
              disabled={!canCurate}
            />
            <Field
              label="Categories"
              name="categories"
              defaultValue={project.categories.join(', ')}
              helper="Comma separated."
              error={fieldError('details', 'categories')}
              disabled={!canCurate}
            />
            <Field
              label="Loaders"
              name="loaders"
              defaultValue={project.loaders.join(', ')}
              helper="Comma separated. fabric, forge, paper and friends."
              error={fieldError('details', 'loaders')}
              disabled={!canCurate}
            />
            <Field
              label="Game versions"
              name="game_versions"
              defaultValue={project.gameVersions.join(', ')}
              helper="Comma separated. 1.21 or 24w14a."
              error={fieldError('details', 'game_versions')}
              disabled={!canCurate}
            />
            <Field
              label="Licence"
              name="license"
              defaultValue={project.license ?? ''}
              maxLength={64}
              helper="Empty clears it."
              error={fieldError('details', 'license')}
              disabled={!canCurate}
            />
            <Field
              label="Source link"
              name="source_url"
              type="url"
              defaultValue={project.sourceUrl ?? ''}
              maxLength={512}
              helper="Full https:// link. Empty clears it."
              error={fieldError('details', 'source_url')}
              disabled={!canCurate}
            />
            <Field
              label="Issues link"
              name="issues_url"
              type="url"
              defaultValue={project.issuesUrl ?? ''}
              maxLength={512}
              helper="Full https:// link. Empty clears it."
              error={fieldError('details', 'issues_url')}
              disabled={!canCurate}
            />
            <Field
              label="Discord link"
              name="discord_url"
              type="url"
              defaultValue={project.discordUrl ?? ''}
              maxLength={512}
              helper="Full https:// link. Empty clears it."
              error={fieldError('details', 'discord_url')}
              disabled={!canCurate}
            />
            {detailsFormError ? (
              <p role="alert" className={styles['admin-project-error']}>
                {detailsFormError}
              </p>
            ) : null}
            <div className={styles['admin-project-actions']}>
              {saveButton('details', 'Save', 'primary')}
            </div>
          </form>
        </section>

        <section
          className={styles['admin-project-section']}
          aria-labelledby={sectionTitleId('ICON')}
        >
          <h2 id={sectionTitleId('ICON')} className={styles['admin-project-heading']}>
            ICON
          </h2>
          {project.iconUrl !== null ? (
            <div className={styles['admin-project-icon']}>
              <Image
                src={resolveMediaUrl(project.iconUrl)}
                alt={`${project.title} icon`}
                width={96}
                height={96}
                className={styles['admin-project-icon-img']}
              />
            </div>
          ) : (
            <p className={styles['admin-project-empty']}>No icon yet.</p>
          )}
          {adminOnly(
            <UploadWell
              kind="project-media"
              targetIds={{ project_id: id, kind: 'icon' }}
              action={uploadProjectMediaAction}
              disabled={!canCurate}
            />,
          )}
          <p className={styles['admin-project-helper']}>
            Square, 64 to 1024 pixels. Publish needs one.
          </p>
        </section>

        <section
          className={styles['admin-project-section']}
          aria-labelledby={sectionTitleId('GALLERY')}
        >
          <h2 id={sectionTitleId('GALLERY')} className={styles['admin-project-heading']}>
            GALLERY
          </h2>
          {gallery.length > 0 ? (
            <ul className={styles['admin-project-gallery']}>
              {gallery.map((entry) => (
                <li key={entry.url} className={styles['admin-project-gallery-item']}>
                  <span className={styles['admin-project-gallery-path']}>{entry.url}</span>
                  {entry.title !== null ? (
                    <span className={styles['admin-project-gallery-title']}>{entry.title}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles['admin-project-empty']}>No images yet.</p>
          )}
          {adminOnly(
            <UploadWell
              kind="project-media"
              targetIds={{ project_id: id, kind: 'gallery' }}
              action={uploadProjectMediaAction}
              multiple
              disabled={!canCurate}
            />,
          )}
        </section>

        <section
          className={styles['admin-project-section']}
          aria-labelledby={sectionTitleId('VERSIONS & FILES')}
        >
          <h2 id={sectionTitleId('VERSIONS & FILES')} className={styles['admin-project-heading']}>
            VERSIONS &amp; FILES
          </h2>
          {versions.length > 0 ? (
            <ul className={styles['admin-project-versions']}>
              {versions.map((version) => (
                <li key={version.id} className={styles['admin-project-version']}>
                  <div className={styles['admin-project-version-head']}>
                    <span className={styles['admin-project-version-number']}>
                      v{version.versionNumber}
                    </span>
                    {version.name !== null && version.name !== '' ? (
                      <span className={styles['admin-project-version-name']}>{version.name}</span>
                    ) : null}
                  </div>
                  <p className={styles['admin-project-version-meta']}>
                    {[
                      version.versionType,
                      version.gameVersions.join(', '),
                      version.loaders.join(', '),
                      formatDate(version.datePublished),
                    ]
                      .filter((part) => part !== '')
                      .join(' · ')}
                  </p>
                  <ul className={styles['admin-project-files']}>
                    {version.files.map((file) => (
                      <li key={file.id} className={styles['admin-project-file']}>
                        <span className={styles['admin-project-file-name']}>{file.filename}</span>
                        <span className={styles['admin-project-file-size']}>
                          {formatFileSize(file.sizeBytes)}
                        </span>
                        {file.sha512 !== null ? (
                          <span className={styles['admin-project-file-hash']} title={file.sha512}>
                            {`${file.sha512.slice(0, 16)}…`}
                          </span>
                        ) : null}
                        {file.primary ? (
                          <span className={styles['admin-project-file-primary']}>PRIMARY</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles['admin-project-empty']}>No versions yet.</p>
          )}
          <h3 className={styles['admin-project-subheading']}>Add a version or file</h3>
          <p className={styles['admin-project-helper']}>
            Same version number = new file on that version. New number = new version.
          </p>
          {adminOnly(
            <ProjectFileWell
              projectId={id}
              action={uploadProjectFileAction}
              disabled={!canCurate}
            />,
          )}
        </section>
      </div>
    );
  }

  // ---- SYNCED branch (`source='modrinth'` — the S1.2 curate view) ----------------------------

  return (
    <div className={styles['admin-project']}>
      <header className={styles['admin-project-head']}>
        <PixelLabel as="p" tone="gold" size={11}>
          ADMIN
        </PixelLabel>
        <h1 className={styles['admin-project-title']}>{project.title}</h1>
        <div className={styles['admin-project-meta']}>
          <TypeBadge type={project.projectType} />
          <StatusPill status={adminProjectStatus(project.status, override?.hidden ?? false)} />
          <span className={styles['admin-project-source']}>
            {project.source} · {project.slug} · {formatCount(project.downloadsTotal)} downloads
          </span>
        </div>
      </header>

      <section
        className={styles['admin-project-section']}
        aria-labelledby={sectionTitleId('OVERRIDES')}
      >
        <h2 id={sectionTitleId('OVERRIDES')} className={styles['admin-project-heading']}>
          OVERRIDES
        </h2>
        <form action={saveOverrides} className={styles['admin-project-form']}>
          <Field
            label="Title override"
            name="title_override"
            defaultValue={override?.titleOverride ?? ''}
            maxLength={80}
            counter
            helper="Empty keeps the synced title."
            error={fieldError('overrides', 'title_override')}
            disabled={!canCurate}
          />
          <Field
            label="Description override"
            name="description_override"
            type="textarea"
            defaultValue={override?.descriptionOverride ?? ''}
            maxLength={256}
            counter
            helper="Empty keeps the synced description."
            error={fieldError('overrides', 'description_override')}
            disabled={!canCurate}
            inputProps={{ rows: 3 }}
          />
          <Field
            label="Notes"
            name="notes_md"
            type="textarea"
            defaultValue={override?.notesMd ?? ''}
            maxLength={20000}
            helper="Markdown. Shows under About as a note."
            error={fieldError('overrides', 'notes_md')}
            disabled={!canCurate}
            inputProps={{ rows: 6 }}
          />
          {overridesFormError ? (
            <p role="alert" className={styles['admin-project-error']}>
              {overridesFormError}
            </p>
          ) : null}
          <div className={styles['admin-project-actions']}>
            {saveButton('save', 'Save', 'primary')}
          </div>
        </form>

        {commentsToggle}
      </section>

      <section
        className={styles['admin-project-section']}
        aria-labelledby={sectionTitleId('CURSEFORGE')}
      >
        <h2 id={sectionTitleId('CURSEFORGE')} className={styles['admin-project-heading']}>
          CURSEFORGE
        </h2>
        <form action={saveLink} className={styles['admin-project-form']}>
          <Field
            label="CurseForge id or URL"
            name="ref"
            defaultValue={link?.externalId ?? ''}
            maxLength={300}
            helper={
              link
                ? `Linked. ${formatCount(link.downloads)} downloads counted.`
                : 'Digits or the project URL. Empty removes the link.'
            }
            error={linkError}
            disabled={!canCurate}
          />
          <div className={styles['admin-project-actions']}>
            {saveButton('link', 'Save link', 'secondary')}
          </div>
        </form>
      </section>

      <section
        className={styles['admin-project-section']}
        aria-labelledby={sectionTitleId('EXTRA GALLERY')}
      >
        <h2 id={sectionTitleId('EXTRA GALLERY')} className={styles['admin-project-heading']}>
          EXTRA GALLERY
        </h2>
        {override && override.extraGallery.length > 0 ? (
          <ul className={styles['admin-project-gallery']}>
            {override.extraGallery.map((entry) => (
              <li key={entry.path} className={styles['admin-project-gallery-item']}>
                <span className={styles['admin-project-gallery-path']}>{entry.path}</span>
                {entry.title ? (
                  <span className={styles['admin-project-gallery-title']}>{entry.title}</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles['admin-project-empty']}>No extra images yet.</p>
        )}
        {adminOnly(
          <UploadWell
            kind="project-media"
            targetIds={{ project_id: id, kind: 'gallery' }}
            action={uploadProjectMediaAction}
            multiple
            disabled={!canCurate}
          />,
        )}
        <p className={styles['admin-project-helper']}>
          Images upload to the project&apos;s own gallery folder.
        </p>
      </section>
    </div>
  );
}
