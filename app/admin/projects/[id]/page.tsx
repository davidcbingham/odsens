import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { Button } from '@/components/primitives/Button';
import { Field } from '@/components/primitives/Field';
import { PixelLabel } from '@/components/primitives/PixelLabel';
import { SectionTitle, sectionTitleId } from '@/components/primitives/SectionTitle';
import { StatusPill } from '@/components/primitives/StatusPill';
import { Toggle } from '@/components/primitives/Toggle';
import { TypeBadge } from '@/components/primitives/TypeBadge';
import { curateProject, setProjectLink } from '@/lib/actions/projects';
import type { ActionError } from '@/lib/actions/result';
import { getViewer } from '@/lib/auth';
import { adminProjectStatus, getAdminProject } from '@/lib/data/admin';
import { formatCount } from '@/lib/format/number';
import styles from './page.module.css';

/**
 * `/admin/projects/[id]` — the S1.2 curate view for synced projects (02 §1.3 row: per-project
 * extras ONLY — overrides, notes, comments toggle, extra gallery, CF id; feature / hide / reorder
 * live on `/admin/projects`, ADR-0002 A11; S1.3 extends this route with the exclusive edit form
 * and `UploadWell`). Dynamic + session-backed under the `app/admin/layout.tsx` gate (01 INV-31);
 * the one read is `lib/data/admin.ts` `getAdminProject` on the request-cookie client (01
 * INV-12/INV-15; ADR-0022) — unknown id (or a row RLS hides from a moderator, 05 T-RLS-17/18) →
 * `notFound()` (02 §1.3 Files cell).
 *
 * Forms — the 03 C-17 `<form action>` mechanism, no client island (the projects curate view has
 * none on the C-16a list): each form posts to a page-scoped `'use server'` closure that builds
 * the TYPED 04 §1.4 input and calls the `lib/actions/projects.ts` action (auth / validation /
 * writes / revalidation all live there, 04 SC-01/SC-06). Results surface without a client hook:
 * ok → `redirect` back to the plain URL (PRG — the refreshed render shows the stored values);
 * error → `redirect` back with `?form=&field=&error=` and the page hands the message to the
 * matching `Field error` (inline `role="alert"` + `aria-invalid` — 03 §2.2 Field a11y / C-30
 * "errors inline, never toast"; admin routes are dynamic, so reading `searchParams` is legal —
 * 02 §0.1; RP-03 restricts public pages only). The `setProjectLink` no-key degradation
 * (`upstream_error` "CurseForge key not configured", 04 §1.4 precondition) surfaces on the same
 * path. `comments_enabled` saves immediately through a bound `curateProject` (the list-page
 * `Toggle` mechanism — `Toggle` is controlled, 03 §2.2).
 *
 * Moderators (ADR-0002 C7; 03 §2.10 rule): every field, toggle and save button renders DISABLED
 * (`disabled` + `title="Admin only"` on the control's wrapper + the `Button` `aria-describedby`
 * explainer — the `SyncStatus` precedent), never hidden; the actions refuse them server-side
 * regardless (01 INV-18). Extra gallery is a read-only list in S1.2 (ADR-0002 C10: the upload
 * UI + `project-media` bucket land in S1.3).
 */
type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const ADMIN_ONLY_TITLE = 'Admin only';

/** Empty input = "no override" — the 04 §1.4 nullable columns clear on `null`. */
function orNull(value: FormDataEntryValue | null): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text === '' ? null : text;
}

/** The error round-trip query (`form` names the form, `field` the input, `error` the message). */
function withError(base: string, form: 'overrides' | 'link', error: ActionError): string {
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

  const base = `/admin/projects/${id}`;
  const override = project.override;
  const commentsEnabled = override?.commentsEnabled ?? true;
  const link = project.curseforgeLink;

  // ---- Error round-trip (see header) ---------------------------------------------------------
  const errorForm = queryValue(query.form);
  const errorField = queryValue(query.field);
  const errorMessage = queryValue(query.error);
  const fieldError = (form: 'overrides' | 'link', field: string): string | undefined =>
    errorForm === form && errorField === field && errorMessage !== null ? errorMessage : undefined;
  const OVERRIDE_FIELDS = ['title_override', 'description_override', 'notes_md'];
  const overridesFormError =
    errorForm === 'overrides' &&
    errorMessage !== null &&
    (errorField === null || !OVERRIDE_FIELDS.includes(errorField))
      ? errorMessage
      : null;
  const linkError = errorForm === 'link' && errorMessage !== null ? errorMessage : undefined;

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
        <SectionTitle>OVERRIDES</SectionTitle>
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

        <div className={styles['admin-project-toggle-row']}>
          <span className={styles['admin-project-toggle-label']}>Comments</span>
          {canCurate ? (
            <Toggle
              name="comments_enabled"
              checked={commentsEnabled}
              onChange={curateProject.bind(null, {
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
      </section>

      <section
        className={styles['admin-project-section']}
        aria-labelledby={sectionTitleId('CURSEFORGE')}
      >
        <SectionTitle>CURSEFORGE</SectionTitle>
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
        <SectionTitle>EXTRA GALLERY</SectionTitle>
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
      </section>
    </div>
  );
}
