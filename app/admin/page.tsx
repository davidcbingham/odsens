import { redirect } from 'next/navigation';
import { SavedToast } from '@/components/admin/SavedToast';
import { isSavedMessageKey } from '@/components/admin/savedMessages';
import { SyncStatus, type SyncStatusProps } from '@/components/admin/SyncStatus';
import { Button } from '@/components/primitives/Button';
import { PixelLabel } from '@/components/primitives/PixelLabel';
import { sectionTitleId } from '@/components/primitives/SectionTitle';
import { StatTile } from '@/components/primitives/StatTile';
import { StatusPill } from '@/components/primitives/StatusPill';
import { Table, type TableProps } from '@/components/primitives/Table';
import { Toggle } from '@/components/primitives/Toggle';
import { updateVideo } from '@/lib/actions/videos';
import type { UpdateVideoInput } from '@/lib/actions/videos.schema';
import { getViewer } from '@/lib/auth';
import {
  countDraftProjects,
  countHeldComments,
  DASHBOARD_SYNC_SOURCES,
  listAdminVideos,
  listSyncStatus,
  type AdminVideoListItem,
} from '@/lib/data/admin';
import { formatDate } from '@/lib/format/date';
import { formatDuration } from '@/lib/format/duration';
import styles from './page.module.css';

/**
 * `/admin` — the dashboard, S1.6 state (02 §1.3 `/admin` row: Slice "S1.1 gate; S1.2
 * `SyncStatus`; S1.4 held count; S1.6 videos list"; DESIGN.md §6 #9). Renders the row's
 * `StatTile` tiles (03 §2.2 first use: "`/admin` dashboard tiles"), `SyncStatus` over `sync_runs`
 * and, since S1.6, the VIDEOS list — the home of `updateVideo` (04 §1.8; ADR-0002 #20: there is NO
 * `/admin/videos` route, 01 INV-75). Reads go through `lib/data/admin.ts` on the request-cookie
 * client (01 INV-12; ADR-0022) — moderators get the RLS-filtered subset, read-only (02 §1.3 auth
 * rule).
 *
 * Tiles per the row's Data cell: `comments` count where `status='held'` (S1.4 — the real
 * `countHeldComments()` read, the same number the sidebar shows; moderators read every comment
 * row, so it is exact for both roles) and `projects` count where `status='draft'` (drafts are
 * admin-only RLS, 05 T-RLS-17). Neither tile carries the "No data yet." context — that
 * convention is for `/admin/stats` before a snapshot exists (ADR-0002 #29); here a `0` is the
 * real answer. Sync sources = `DASHBOARD_SYNC_SOURCES`: modrinth + curseforge + youtube since
 * S1.6 (03 §2.10 `SyncStatus` Slice cell "S1.2 (Modrinth/CF) · S1.6 (YouTube) · S1.8" — the jobs
 * the row can trigger today; `/admin/projects` keeps its two); `canTrigger` = role admin
 * (ADR-0002 C7; moderators see "Sync now" disabled, never absent — 02 §1.3).
 *
 * VIDEOS (ADR-0043 D11 — composed from existing primitives only, DESIGN.md §12.7 "no bespoke
 * design"; DESIGN.md §5 Admin table): a `Table` of every video the session may read, newest
 * first, long videos and Shorts together, no thumbnails (the admin surface makes no `i.ytimg.com`
 * request). Columns Video (title over `youtube_id · length`) · Published (`formatDate`) · Status
 * (`StatusPill` `hidden` / `live` — the only two video words the pill has; Short state reads off
 * its toggle's ON / OFF word, 03 C-26) · Hidden `Toggle` · Short `Toggle` + a ghost "Auto"
 * `Button` ONLY on rows that carry an `is_short` override (ADR-0043 D1: the Short toggle always
 * sends an explicit boolean = an override; "Auto" sends `is_short: null`, handing the row back to
 * the 04 §5.3 heuristic). Two indigo toggles per row is the `/admin/projects` precedent for the
 * "one accent per row" rule. Empty = one `--mute` line (03 G-05).
 *
 * Wiring (ADR-0024 module-private glue; ADR-0038 D1 extended to `/admin` by ADR-0043 D11): each
 * toggle's `onChange` is the module-level `updateVideoAndRefresh` server function BOUND to
 * `{youtube_id, hidden|is_short: !current}` (the Next "additional arguments" `.bind` pattern —
 * 03 C-19 "no functions except server actions"); "Auto" is a server `<form action>` bound the same
 * way (03 C-17). The glue makes ONE `updateVideo` call, then `redirect`s back here (PRG): tag-only
 * revalidation does not re-render an untagged dynamic route in the action round trip, so without
 * the redirect the controlled `Toggle` would stay stale. A successful call lands on
 * `?saved=saved` → `SavedToast` says "Saved." once and strips the query; a refused or failed call
 * lands on the bare URL and simply re-renders the unchanged truth (`Toggle` has no error surface;
 * the action logs it server-side). No new client island.
 *
 * Moderators (ADR-0002 C7; 03 §2.10 admin-only controls rule): both toggles render DISABLED
 * inside a `title="Admin only"` wrapper (`Toggle` passes through no `title` — the `SyncStatus` /
 * `/admin/projects` precedent) and "Auto" renders `disabled` the same way — never absent; the
 * action refuses them server-side regardless (01 INV-18). RLS hides `hidden` rows from a
 * moderator (05 T-RLS-49), so every row they see reads LIVE.
 *
 * The page's one `h1` is visually hidden ("Admin" — DESIGN.md §9 headings in order; `AdminShell`
 * has no heading); the "ADMIN" `PixelLabel` is an eyebrow (`as="p"`), never a heading. Title
 * comes from the layout. Role gate: the layout renders `AdminGate` / the root 404 (01 INV-31);
 * this page bails quietly for anon / no-handle / role `user` (RP-04 — the `/admin/projects`
 * precedent: a page-thrown error here would replace the anon gate).
 */
const ADMIN_ONLY_TITLE = 'Admin only';

/**
 * Videos-list glue (see header): one `updateVideo` call, then PRG back to this URL so the dynamic
 * page re-renders the stored state. Role check, validation and the write live in `updateVideo`
 * (04 SC-01 / SC-06); only a successful save earns the "Saved." toast (02 §1.3 `/admin` row).
 * Trailing bound-call arguments (the `Toggle` value, a form's `FormData`) are ignored — the input
 * was fixed at render.
 */
async function updateVideoAndRefresh(input: UpdateVideoInput): Promise<void> {
  'use server';
  const result = await updateVideo(input);
  redirect(result.ok ? '/admin?saved=saved' : '/admin'); // ADR-0038 D1 via ADR-0043 D11
}

const VIDEO_COLUMNS: TableProps['columns'] = [
  { key: 'video', header: 'Video' },
  { key: 'published', header: 'Published' },
  { key: 'status', header: 'Status' },
  { key: 'hidden', header: 'Hidden' },
  { key: 'short', header: 'Short' },
];

/** A Hidden / Short `Toggle` cell; moderators get it disabled inside a `title` wrapper (03 §2.10). */
function videoToggle(video: AdminVideoListItem, flag: 'hidden' | 'short', canEdit: boolean) {
  const checked = flag === 'hidden' ? video.hidden : video.isShort;
  const label = flag === 'hidden' ? `Hide ${video.title}` : `Mark ${video.title} as a Short`;
  const name = `${flag}-${video.youtubeId}`;
  if (!canEdit) {
    return (
      <span title={ADMIN_ONLY_TITLE}>
        <Toggle
          name={name}
          checked={checked}
          role="switch"
          accent="indigo"
          label={label}
          disabled
        />
      </span>
    );
  }
  // The 04 §1.8 input, bound at render: one flip = one `updateVideo` call + PRG. A Short flip
  // always carries an explicit boolean — that IS the override (ADR-0043 D1).
  const input: UpdateVideoInput =
    flag === 'hidden'
      ? { youtube_id: video.youtubeId, hidden: !checked }
      : { youtube_id: video.youtubeId, is_short: !checked };
  return (
    <Toggle
      name={name}
      checked={checked}
      onChange={updateVideoAndRefresh.bind(null, input)}
      role="switch"
      accent="indigo"
      label={label}
    />
  );
}

/** "Auto" — only on a row with an override; clears it (`is_short: null` → 04 §5.3 applies again). */
function autoShortButton(video: AdminVideoListItem, canEdit: boolean) {
  if (video.isShortOverride === null) return null;
  const content = (
    <>
      Auto
      <span className="visually-hidden">{` — let the Shorts rule decide for ${video.title}`}</span>
    </>
  );
  if (!canEdit) {
    return (
      <span title={ADMIN_ONLY_TITLE}>
        <Button variant="ghost" size="sm" arrow={false} disabled>
          {content}
        </Button>
      </span>
    );
  }
  return (
    <form
      action={updateVideoAndRefresh.bind(null, { youtube_id: video.youtubeId, is_short: null })}
    >
      <Button variant="ghost" size="sm" type="submit" arrow={false}>
        {content}
      </Button>
    </form>
  );
}

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AdminPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const savedRaw = Array.isArray(query.saved) ? query.saved[0] : query.saved;
  const savedToast = isSavedMessageKey(savedRaw) ? <SavedToast messageKey={savedRaw} /> : null;

  const viewer = await getViewer();
  const role = viewer?.profile?.role;
  if (!viewer?.profile?.handle || role === undefined || role === 'user') return null;
  const isAdmin = role === 'admin';

  const [heldCount, draftCount, syncSources, videos] = await Promise.all([
    countHeldComments(),
    countDraftProjects(),
    listSyncStatus(DASHBOARD_SYNC_SOURCES),
    listAdminVideos(),
  ]);

  const sources: SyncStatusProps['sources'] = syncSources.map((row) => ({
    source: row.source,
    lastRun: row.lastRun,
    stale: row.stale,
    triggerable: true,
  }));

  const videoRows: TableProps['rows'] = videos.map((video) => {
    const length = formatDuration(video.durationSeconds);
    return {
      key: video.id,
      video: (
        <span className={styles['admin-home-video']}>
          <span className={styles['admin-home-video-title']}>{video.title}</span>
          <span className={styles['admin-home-video-meta']}>
            {length === '' ? video.youtubeId : `${video.youtubeId} · ${length}`}
          </span>
        </span>
      ),
      published: (
        <time className={styles['admin-home-video-date']} dateTime={video.publishedAt}>
          {formatDate(video.publishedAt)}
        </time>
      ),
      status: <StatusPill status={video.hidden ? 'hidden' : 'live'} />,
      hidden: videoToggle(video, 'hidden', isAdmin),
      short: (
        <span className={styles['admin-home-video-short']}>
          {videoToggle(video, 'short', isAdmin)}
          {autoShortButton(video, isAdmin)}
        </span>
      ),
    };
  });

  return (
    <div className={styles['admin-home']}>
      {savedToast}
      <header className={styles['admin-home-head']}>
        <h1 className="visually-hidden">Admin</h1>
        <PixelLabel as="p" tone="gold" size={11}>
          ADMIN
        </PixelLabel>
      </header>

      <div className={styles['admin-home-tiles']}>
        <StatTile label="Held comments" value={heldCount} />
        <StatTile label="Draft projects" value={draftCount} />
      </div>

      <section className={styles['admin-home-section']} aria-labelledby={sectionTitleId('SYNC')}>
        <h2 id={sectionTitleId('SYNC')} className={styles['admin-home-heading']}>
          SYNC
        </h2>
        <SyncStatus sources={sources} canTrigger={isAdmin} />
      </section>

      <section className={styles['admin-home-section']} aria-labelledby={sectionTitleId('VIDEOS')}>
        <div className={styles['admin-home-heading-row']}>
          <h2 id={sectionTitleId('VIDEOS')} className={styles['admin-home-heading']}>
            VIDEOS
            <span className="visually-hidden">{` ${videos.length} total`}</span>
          </h2>
          <span aria-hidden="true">
            <PixelLabel informational tone="mute-dim">
              {`${videos.length} TOTAL`}
            </PixelLabel>
          </span>
        </div>
        <Table
          caption="Videos"
          columns={VIDEO_COLUMNS}
          rows={videoRows}
          rowKey="key"
          empty="No videos yet."
        />
      </section>
    </div>
  );
}
