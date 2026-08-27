import { SyncStatus, type SyncStatusProps } from '@/components/admin/SyncStatus';
import { PixelLabel } from '@/components/primitives/PixelLabel';
import { SectionTitle, sectionTitleId } from '@/components/primitives/SectionTitle';
import { StatTile } from '@/components/primitives/StatTile';
import { getViewer } from '@/lib/auth';
import { countDraftProjects, listSyncStatus, PROJECT_SYNC_SOURCES } from '@/lib/data/admin';
import styles from './page.module.css';

/**
 * `/admin` — the dashboard, S1.2 state (02 §1.3 `/admin` row: Slice "S1.1 gate; S1.2
 * `SyncStatus`; S1.4 held count; S1.6 videos list"; DESIGN.md §6 #9). This slice renders the
 * row's `StatTile` tiles (03 §2.2 first use: "`/admin` dashboard tiles") and `SyncStatus` over
 * `sync_runs`; the videos `Table`/`Toggle` arrive in S1.6. Reads go through `lib/data/admin.ts`
 * on the request-cookie client (01 INV-12; ADR-0022) — moderators get the RLS-filtered subset,
 * read-only (02 §1.3 auth rule).
 *
 * Tiles per the row's Data cell: `comments` count where `status='held'` — hard `0` until S1.4
 * wires it (the comments table does not exist yet; the `app/admin/layout.tsx`
 * `counts={{ heldComments: 0 }}` precedent), shown with the caller-side empty convention `0` +
 * "No data yet." (03 §2.2 `StatTile`, ADR-0002 #29) — and `projects` count where
 * `status='draft'` (real read; drafts are admin-only RLS, 05 T-RLS-17). Sync sources = modrinth
 * + curseforge only at S1.2 (03 §2.10 `SyncStatus` Slice cell "S1.2 (Modrinth/CF) · S1.6
 * (YouTube) · S1.8" — the jobs the row can trigger today); `canTrigger` = role admin
 * (ADR-0002 C7; moderators see "Sync now" disabled, never absent — 02 §1.3).
 *
 * The page's one `h1` is visually hidden ("Admin" — DESIGN.md §9 headings in order; `AdminShell`
 * has no heading); the "ADMIN" `PixelLabel` is an eyebrow (`as="p"`), never a heading. Title
 * comes from the layout. Role gate: the layout renders `AdminGate` / the root 404 (01 INV-31);
 * this page bails quietly for anon / no-handle / role `user` (RP-04 — the `/admin/projects`
 * precedent: a page-thrown error here would replace the anon gate).
 */
export default async function AdminPage() {
  const viewer = await getViewer();
  const role = viewer?.profile?.role;
  if (!viewer?.profile?.handle || role === undefined || role === 'user') return null;
  const canTrigger = role === 'admin';

  const [draftCount, syncSources] = await Promise.all([
    countDraftProjects(),
    listSyncStatus(PROJECT_SYNC_SOURCES),
  ]);

  const sources: SyncStatusProps['sources'] = syncSources.map((row) => ({
    source: row.source,
    lastRun: row.lastRun,
    stale: row.stale,
    triggerable: true,
  }));

  return (
    <div className={styles['admin-home']}>
      <header className={styles['admin-home-head']}>
        <h1 className="visually-hidden">Admin</h1>
        <PixelLabel as="p" tone="gold" size={11}>
          ADMIN
        </PixelLabel>
      </header>

      <div className={styles['admin-home-tiles']}>
        {/* S1.4 wires the held-comments count (comments table does not exist yet). */}
        <StatTile
          label="Held comments"
          value={0}
          context={{ text: 'No data yet.', tone: 'neutral' }}
        />
        <StatTile label="Draft projects" value={draftCount} />
      </div>

      <section className={styles['admin-home-section']} aria-labelledby={sectionTitleId('SYNC')}>
        <SectionTitle>SYNC</SectionTitle>
        <SyncStatus sources={sources} canTrigger={canTrigger} />
      </section>
    </div>
  );
}
