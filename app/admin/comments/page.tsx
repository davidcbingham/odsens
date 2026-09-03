import type { Metadata } from 'next';
import Link from 'next/link';
import { ModActionRow } from '@/components/comments/ModActionRow';
import { Avatar } from '@/components/primitives/Avatar';
import { PixelLabel } from '@/components/primitives/PixelLabel';
import { sectionTitleId } from '@/components/primitives/SectionTitle';
import { StatusPill, type StatusPillStatus } from '@/components/primitives/StatusPill';
import { Table, type TableProps } from '@/components/primitives/Table';
import { getViewer } from '@/lib/auth';
import { listModerationQueue, type ModerationQueueRow } from '@/lib/data/admin';
import { relativeTime } from '@/lib/format/date';
import { linkify } from '@/lib/validation/comment';
import styles from './page.module.css';

/**
 * `/admin/comments` — the moderation queue (02 §1.3 row; 00 S1.4.AC14; DESIGN.md §5 Admin table,
 * §6 #9 "clarity over flair", §11.1 Mod action row; 03 §2.2 `Table` / `StatusPill`, §2.4
 * `ModActionRow` `surface="admin"` — ADR-0028 D6). Dynamic + session-backed under the
 * `app/admin/layout.tsx` gate (01 INV-31); the read is `lib/data/admin.ts` `listModerationQueue()`
 * on the request-cookie client (01 INV-12): `comments` (every status but deleted — moderators read
 * every row, data-model §4) + RPC `moderator_thread` (unresolved report counts + the first-comment
 * flag, the mods-only read — ADR-0002 A2) + `public_profiles` + `projects_public` (target titles).
 *
 * Auth (02 §1.3 auth rule; ADR-0002 C7): a moderator may run EVERY action on this page
 * (`moderateComment`, `banUser`, `renameUserHandle`, `deleteComment` on others' comments), so unlike
 * `/admin/projects` no control here renders "Admin only" disabled; the actions re-check the role
 * server-side regardless (01 INV-18; 00 S1.4.AC14).
 *
 * One section, MODERATION QUEUE (admin header — DESIGN.md §6 #9 "poster type goes": Space Grotesk
 * 700 chalk, id via `sectionTitleId`), one `Table` in the read's order: held → reported → hidden →
 * published, newest first inside each group (00 S1.4.AC14 "held + reported first"). Columns:
 * - Comment — `Avatar` 34 `border=2` + `@handle` + relative time (`<time datetime>`; "· edited"
 *   when `editedAt`) + `StatusPill first-comment` when the RPC flags the author's first comment,
 *   over the full body as text through `linkify()` (03 §2.4 body rule — never `Markdown`).
 * - Project — link to `/projects/<slug>#comments`, or "—" when `projects_public` no longer shows it.
 * - Status — worded pill (held → HELD gold-wash · published → LIVE emerald-wash · hidden → HIDDEN
 *   neutral; ADR-0002 #47) + "n reports" in `--mute` beside it when unresolved reports exist.
 * - Actions — `ModActionRow surface="admin"`: Approve (the row's one filled accent, held only) ·
 *   Hide · Unhide · Delete · Ban user · Rename handle (DESIGN.md §5 "one accent per row"). The leaf
 *   calls the `lib/actions/comments.ts` actions itself and refreshes the route (the `SyncStatus`
 *   pattern), so this page carries no page-scoped action glue; the layout's sidebar count follows
 *   the same refresh (02 §1.3 `/admin` Data cell).
 * Empty copy verbatim per 02 §1.3 / 03 G-05 (ADR-0002 #40).
 */
export const metadata: Metadata = {
  title: 'Comments · Admin',
};

const COLUMNS: TableProps['columns'] = [
  { key: 'comment', header: 'Comment' },
  { key: 'project', header: 'Project' },
  { key: 'status', header: 'Status' },
  { key: 'actions', header: 'Actions' },
];

/** Queue status → the worded pill (03 §2.2 fill map: `published` reads LIVE). */
const PILL: Record<ModerationQueueRow['status'], StatusPillStatus> = {
  held: 'held',
  published: 'live',
  hidden: 'hidden',
};

/** "n reports" beside the pill — plain words (DESIGN.md §7). */
function reportsLine(count: number): string {
  return count === 1 ? '1 report' : `${count} reports`;
}

/**
 * Comment cell: author line (avatar, handle, time, first-comment tag) over the body. `author`
 * is `null` only when the profile is gone — `deleteAccount` soft-deletes that user's comments
 * first (00 S1.4.AC16) and the queue excludes deleted rows — so the dash is a defensive fallback.
 */
function commentCell(row: ModerationQueueRow) {
  const { author } = row;
  return (
    <div className={styles['admin-comments-comment']}>
      <div className={styles['admin-comments-meta']}>
        {author ? (
          <>
            {/* decorative: the handle text sits beside it (03 `Avatar`: alt="" when adjacent) */}
            <span aria-hidden="true">
              <Avatar src={author.avatarUrl} alt={author.handle} size={34} border={2} />
            </span>
            <span className={styles['admin-comments-handle']}>{`@${author.handle}`}</span>
          </>
        ) : (
          <span className={styles['admin-comments-none']}>—</span>
        )}
        <time
          className={styles['admin-comments-time']}
          dateTime={row.createdAt}
          suppressHydrationWarning
        >
          {relativeTime(row.createdAt)}
        </time>
        {row.editedAt ? <span className={styles['admin-comments-time']}>· edited</span> : null}
        {row.isFirstComment ? <StatusPill status="first-comment" /> : null}
      </div>
      <p className={styles['admin-comments-body']}>{linkify(row.body)}</p>
    </div>
  );
}

export default async function AdminCommentsPage() {
  // RP-04: bail quietly for anon / role `user` — the layout renders `AdminGate` / the root 404;
  // a page-thrown `notFound()` here would replace the anon gate (defence in depth, 01 INV-31).
  const viewer = await getViewer();
  const role = viewer?.profile?.role;
  if (!viewer?.profile?.handle || role === undefined || role === 'user') return null;

  const queue = await listModerationQueue();

  const rows: TableProps['rows'] = queue.map((row) => ({
    key: row.id,
    comment: commentCell(row),
    project: row.target ? (
      <Link
        className={styles['admin-comments-project']}
        href={`/projects/${row.target.slug}#comments`}
      >
        {row.target.title}
      </Link>
    ) : (
      <span className={styles['admin-comments-none']}>—</span>
    ),
    status: (
      <span className={styles['admin-comments-status']}>
        <StatusPill status={PILL[row.status]} />
        {row.reportCount > 0 ? (
          <span className={styles['admin-comments-reports']}>{reportsLine(row.reportCount)}</span>
        ) : null}
      </span>
    ),
    actions: row.author ? (
      <ModActionRow
        commentId={row.id}
        authorId={row.author.id}
        authorHandle={row.author.handle}
        status={row.status}
        surface="admin"
      />
    ) : (
      <span className={styles['admin-comments-none']}>—</span>
    ),
  }));

  return (
    <div className={styles['admin-comments']}>
      <header className={styles['admin-comments-head']}>
        <h1 className="visually-hidden">Comments</h1>
        <PixelLabel as="p" tone="gold" size={11}>
          ADMIN
        </PixelLabel>
      </header>

      <section
        className={styles['admin-comments-section']}
        aria-labelledby={sectionTitleId('MODERATION QUEUE')}
      >
        <h2 id={sectionTitleId('MODERATION QUEUE')} className={styles['admin-comments-heading']}>
          MODERATION QUEUE
        </h2>
        <Table
          caption="Moderation queue"
          columns={COLUMNS}
          rows={rows}
          rowKey="key"
          empty="Nothing held. Nice."
        />
      </section>
    </div>
  );
}
