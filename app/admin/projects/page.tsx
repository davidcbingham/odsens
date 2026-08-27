import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ReorderableList, type ReorderableItem } from '@/components/admin/ReorderableList';
import { SyncStatus, type SyncStatusProps } from '@/components/admin/SyncStatus';
import { Button } from '@/components/primitives/Button';
import { PixelLabel } from '@/components/primitives/PixelLabel';
import { SectionTitle, sectionTitleId } from '@/components/primitives/SectionTitle';
import { StatusPill } from '@/components/primitives/StatusPill';
import { Table, type TableProps } from '@/components/primitives/Table';
import { Toggle } from '@/components/primitives/Toggle';
import { TypeBadge } from '@/components/primitives/TypeBadge';
import { curateProject } from '@/lib/actions/projects';
import type { CurateProjectInput } from '@/lib/actions/projects.schema';
import { getViewer } from '@/lib/auth';
import {
  adminProjectStatus,
  listAdminProjects,
  listSyncStatus,
  PROJECT_SYNC_SOURCES,
  type AdminProjectListItem,
} from '@/lib/data/admin';
import { formatCount } from '@/lib/format/number';
import styles from './page.module.css';

/**
 * `/admin/projects` — the curation list (02 §1.3 row; 00 S1.2 "Admin"; DESIGN.md §6 #9, §11.1
 * Admin table; ADR-0002 A11: feature / hide / reorder controls live ON THIS LIST, per-project
 * extras on `/admin/projects/[id]`). Dynamic + session-backed under the `app/admin/layout.tsx`
 * gate (01 INV-31); reads go through `lib/data/admin.ts` on the request-cookie client under the
 * S1.2 RLS policies (01 INV-12/INV-15; ADR-0022) — admins see every status, moderators the
 * RLS-filtered subset, read-only (02 §1.3 auth rule).
 *
 * Sections (each labelled by its 03 §2.2 `SectionTitle` — Bungee gold arrives with S1.2):
 * 1. ALL PROJECTS — `Table` of every project incl. hidden/draft (05 T-E2E-34); columns Project ·
 *    Type (`TypeBadge`) · Status (`StatusPill` draft/hidden/live, fills ADR-0002 #47) ·
 *    Downloads · Featured / Hidden `Toggle`s (first `Toggle` use — 02 §1.3) · Open. Empty copy
 *    verbatim per ADR-0002 #40 / 03 G-05. Each toggle's `onChange` is the module-level
 *    `curateAndRefresh` server function BOUND to the per-project shape
 *    `{project_id, featured|hidden: !current}` (the Next "additional arguments" `.bind` pattern
 *    — C-19 "no functions except server actions"). The wrapper `redirect`s back to this URL
 *    after the action — the `[id]` page's PRG precedent — because tag-only revalidation does
 *    not re-render an untagged dynamic route in the action round trip, so a bare bound
 *    `curateProject` would leave the rendered toggle stale until the next navigation.
 * 2. FEATURED ORDER — `ReorderableList` of the featured projects; one completed reorder =
 *    ONE `curateProject` call with the batch shape `{reorder: [{project_id, featured_order}]}`
 *    (ADR-0002 A11; 03 §2.10 "the parent calls `curateProject` once") via the module-level
 *    `reorderFeatured` server function below — the page-side glue 03 prescribes, all auth /
 *    validation / writes stay in `lib/actions/projects.ts` (04 SC-01).
 * 3. SYNC — `SyncStatus` fed from `sync_runs` for modrinth/curseforge (02 §1.3 Data cell;
 *    ADR-0002 #56); "Sync now" = `triggerSync` inside the island; `canTrigger` = role admin.
 *
 * Moderators (ADR-0002 C7; 03 §2.10 admin-only controls rule): every mutation control renders
 * DISABLED — native `disabled` + `title="Admin only"` on the control's wrapper (the `SyncStatus`
 * precedent: `Toggle` passes through no `title`) — never hidden; the actions refuse them
 * server-side regardless (01 INV-18).
 */
export const metadata: Metadata = {
  title: 'Projects · Admin',
};

const ADMIN_ONLY_TITLE = 'Admin only';

/**
 * 03 §2.10 `ReorderableList.onReorder` glue: ids in the new order → the 04 §1.4 batch shape,
 * `featured_order` = position (1-based). One call, one transaction, one revalidate (ADR-0002
 * A11). Role check, validation and writes live in `curateProject` (04 SC-01/SC-06); the result
 * is intentionally unread — `ReorderableList` has no error surface (03 §2.10) and the action
 * never throws to the client.
 */
async function reorderFeatured(ids: string[]): Promise<void> {
  'use server';
  await curateProject({
    reorder: ids.map((project_id, index) => ({ project_id, featured_order: index + 1 })),
  });
}

/**
 * Toggle glue (see header): one `curateProject` call, then PRG back to this URL so the dynamic
 * page re-renders the stored state (`Toggle` is controlled and has no error surface — a refused
 * or failed call simply re-renders the unchanged truth; the action logs it server-side).
 */
async function curateAndRefresh(input: CurateProjectInput): Promise<void> {
  'use server';
  await curateProject(input);
  redirect('/admin/projects');
}

const COLUMNS: TableProps['columns'] = [
  { key: 'project', header: 'Project' },
  { key: 'type', header: 'Type' },
  { key: 'status', header: 'Status' },
  { key: 'downloads', header: 'Downloads', align: 'end' },
  { key: 'featured', header: 'Featured' },
  { key: 'hidden', header: 'Hidden' },
  { key: 'open', header: 'Curate', align: 'end' },
];

/** A feature/hide `Toggle` cell; moderators get it disabled inside a `title` wrapper (03 §2.10). */
function curationToggle(
  project: AdminProjectListItem,
  flag: 'featured' | 'hidden',
  canCurate: boolean,
) {
  const checked = project[flag];
  const label = `${flag === 'featured' ? 'Feature' : 'Hide'} ${project.title}`;
  if (!canCurate) {
    return (
      <span title={ADMIN_ONLY_TITLE}>
        <Toggle
          name={`${flag}-${project.id}`}
          checked={checked}
          role="switch"
          accent="indigo"
          label={label}
          disabled
        />
      </span>
    );
  }
  // The 04 §1.4 per-project shape, bound at render (Next "additional arguments" pattern): one
  // flip = one `curateProject` call + PRG; the refreshed page then renders the stored state.
  const input =
    flag === 'featured'
      ? { project_id: project.id, featured: !checked }
      : { project_id: project.id, hidden: !checked };
  return (
    <Toggle
      name={`${flag}-${project.id}`}
      checked={checked}
      onChange={curateAndRefresh.bind(null, input)}
      role="switch"
      accent="indigo"
      label={label}
    />
  );
}

export default async function AdminProjectsPage() {
  // RP-04: bail quietly for anon / role `user` — the layout renders `AdminGate` / the root 404;
  // a page-thrown `notFound()` here would replace the anon gate (defence in depth, 01 INV-31).
  const viewer = await getViewer();
  const role = viewer?.profile?.role;
  if (!viewer?.profile?.handle || role === undefined || role === 'user') return null;
  const canCurate = role === 'admin';

  const [projects, syncSources] = await Promise.all([
    listAdminProjects(),
    listSyncStatus(PROJECT_SYNC_SOURCES),
  ]);

  const rows: TableProps['rows'] = projects.map((project) => ({
    key: project.id,
    project: (
      <span className={styles['admin-projects-name']}>
        <span className={styles['admin-projects-title']}>{project.title}</span>
        <span className={styles['admin-projects-slug']}>{project.slug}</span>
      </span>
    ),
    type: <TypeBadge type={project.projectType} />,
    status: <StatusPill status={adminProjectStatus(project.status, project.hidden)} />,
    downloads: (
      <span className={styles['admin-projects-downloads']}>
        {formatCount(project.downloadsTotal)}
      </span>
    ),
    featured: curationToggle(project, 'featured', canCurate),
    hidden: curationToggle(project, 'hidden', canCurate),
    open: (
      <Button variant="ghost" size="sm" href={`/admin/projects/${project.id}`}>
        Open
      </Button>
    ),
  }));

  // Featured projects in current order (order asc, unordered last, then title) — ADR-0002 A11.
  const featured = projects
    .filter((project) => project.featured)
    .sort(
      (a, b) =>
        (a.featuredOrder ?? Number.MAX_SAFE_INTEGER) -
          (b.featuredOrder ?? Number.MAX_SAFE_INTEGER) || a.title.localeCompare(b.title),
    );
  const featuredItems: ReorderableItem[] = featured.map((project) => ({
    id: project.id,
    title: project.title,
    node: <span className={styles['admin-projects-order-title']}>{project.title}</span>,
  }));

  const sources: SyncStatusProps['sources'] = syncSources.map((row) => ({
    source: row.source,
    lastRun: row.lastRun,
    stale: row.stale,
    triggerable: true,
  }));

  return (
    <div className={styles['admin-projects']}>
      <header className={styles['admin-projects-head']}>
        <h1 className="visually-hidden">Projects</h1>
        <PixelLabel as="p" tone="gold" size={11}>
          ADMIN
        </PixelLabel>
      </header>

      <section
        className={styles['admin-projects-section']}
        aria-labelledby={sectionTitleId('ALL PROJECTS')}
      >
        <SectionTitle count={{ value: projects.length, word: 'TOTAL' }}>ALL PROJECTS</SectionTitle>
        <Table
          caption="All projects"
          columns={COLUMNS}
          rows={rows}
          rowKey="key"
          empty="No projects yet. Run a sync."
        />
      </section>

      {featuredItems.length > 0 ? (
        <section
          className={styles['admin-projects-section']}
          aria-labelledby={sectionTitleId('FEATURED ORDER')}
        >
          <SectionTitle>FEATURED ORDER</SectionTitle>
          <p className={styles['admin-projects-order-help']}>
            First is the Home hero. The next four fill the Featured row.
          </p>
          <ReorderableList
            items={featuredItems}
            onReorder={reorderFeatured}
            label="Featured projects"
            disabled={!canCurate}
          />
        </section>
      ) : null}

      <section
        className={styles['admin-projects-section']}
        aria-labelledby={sectionTitleId('SYNC')}
      >
        <SectionTitle>SYNC</SectionTitle>
        <SyncStatus sources={sources} canTrigger={canCurate} />
      </section>
    </div>
  );
}
