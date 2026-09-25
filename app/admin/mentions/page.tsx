import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ReorderableList, type ReorderableItem } from '@/components/admin/ReorderableList';
import { SavedToast } from '@/components/admin/SavedToast';
import { isSavedMessageKey } from '@/components/admin/savedMessages';
import { SyncStatus, type SyncStatusProps } from '@/components/admin/SyncStatus';
import { Button } from '@/components/primitives/Button';
import { EmptyState } from '@/components/primitives/EmptyState';
import { PixelLabel } from '@/components/primitives/PixelLabel';
import { PlatformMark } from '@/components/primitives/PlatformMark';
import { sectionTitleId } from '@/components/primitives/SectionTitle';
import { StatusPill } from '@/components/primitives/StatusPill';
import { Table, type TableProps } from '@/components/primitives/Table';
import { MentionPreview } from '@/components/seen-on/MentionPreview';
import { updateMention } from '@/lib/actions/mentions';
import type { UpdateMentionInput, UpdateMentionPatchInput } from '@/lib/actions/mentions.schema';
import { getViewer } from '@/lib/auth';
import {
  adminMentionStatus,
  listAdminMentions,
  listMentionProjectOptions,
  listSyncStatus,
  MENTIONS_SYNC_SOURCES,
  type AdminMentionListItem,
} from '@/lib/data/admin';
import { formatCount } from '@/lib/format/number';
import { platformLabel } from '@/lib/mentions';
import styles from './page.module.css';

/**
 * `/admin/mentions` — Seen on curation (02 §1.3 `/admin/mentions` row + auth rule; 00 S1.8 Scope IN
 * "Admin" + AC1 / AC2 / AC8 / AC10 / AC12; DESIGN.md §12.2 Admin → Mentions, §6 #9; ADR-0002 C7;
 * ADR-0045). Dynamic + session-backed under the `app/admin/layout.tsx` gate (01 INV-31); reads go
 * through `lib/data/admin.ts` on the request-cookie client (01 INV-12 / INV-15; ADR-0022) — an
 * admin reads every status, a moderator the RLS-filtered published rows only (05 T-RLS-102/103;
 * ADR-0045: the policy is not widened, so every row a moderator sees reads LIVE or FEATURED),
 * read-only.
 *
 * Two views, URL-driven and server-rendered — two links with `aria-current="page"` (03 C-13: no v1
 * component is an ARIA tablist; the `EditorSections` `?section=` precedent), `?tab=suggested` for
 * the second; any other value is the first:
 *
 * MENTIONS
 * 1. ADD A MENTION — the `MentionPreview` island (03 §2.8): paste a link → Fetch → preview card or
 *    manual fields → "Assign to" → PUBLISH. It calls `fetchMentionPreview` / `createMention` itself
 *    (03 C-07) and refreshes this page on success. A plain `<div>` wraps it: the island IS the
 *    region "Add a mention" — a `<section>` of the same name around it would double the landmark.
 * 2. FEATURED ORDER — `ReorderableList` "Featured mentions": the published + featured rows by
 *    `sort_order`, exactly what the Home IN THE WILD strip reads (02 §2.1 item 3). Reordering is
 *    not a `Table` prop (03 §2.2), so the artboard's in-row ⠿ becomes this list — the
 *    `/admin/projects` precedent. One completed reorder (drag, handle arrow key, or a Move up /
 *    Move down button) = ONE `updateMention({reorder})` with sequential `sort_order` 1..n (05
 *    T-ACT-64) through the `reorderMentions` glue. Rendered only when something is featured.
 * 3. ALL MENTIONS — `Table`, newest added first (`listAdminMentions` orders by `created_at`, NOT
 *    `sort_order`, so a reorder never reshuffles it and the reorder glue needs no PRG). Columns
 *    Mention (title — a link out to the mention — over "Platform · creator") · Project (or "About
 *    OddSense") · Views · Status (`StatusPill` FEATURED / LIVE / HIDDEN / DRAFT; SUGGESTED if one
 *    is ever present) · Actions: LIVE → Feature + Hide · FEATURED → Unfeature + Hide · HIDDEN →
 *    Show · DRAFT → Publish · SUGGESTED → none (nothing in v1 writes one). "Feature" also sends
 *    `sort_order` = one past the last featured row, so a newly featured mention joins the END of
 *    the Home strip instead of tying at the column default 0. Empty copy verbatim per 02 §1.3.
 * 4. SYNC — `SyncStatus` over `MENTIONS_SYNC_SOURCES` (`sync_runs.source = 'mentions'`, the hourly
 *    view-count refresh — 04 §3.4); "Sync now" = `triggerSync({source:'mentions'})` inside the
 *    island, wired exactly as `/admin/projects` wires its sources (ADR-0045).
 *
 * SUGGESTED — the v1.5 stub (00 S1.8.AC10; DESIGN.md §12.2 "Suggested tab (v1.5)"): one
 * `EmptyState`, no Approve / Dismiss, no count, nothing that mutates; no job writes `suggested`.
 *
 * Wiring (ADR-0024 module-private glue; ADR-0038 D1 extended here by ADR-0045): every row action is
 * a server `<form action>` bound (`.bind`, 03 C-19) to `updateMentionAndRefresh` — ONE
 * `updateMention` call, then PRG: tag-only revalidation does not re-render an untagged dynamic
 * route inside the action round trip. ok → `?saved=saved` → `SavedToast` says "Saved." once and
 * strips the query; a refused or failed call lands on the bare URL and re-renders the unchanged
 * truth (the row has no error surface; the action logs it server-side).
 *
 * Moderators (02 §1.3 auth rule; 03 §2.10 admin-only controls rule): every mutation control is
 * rendered — natively `disabled` under `title="Admin only"`, never hidden, and with NO `<form>`
 * around it, so no request can leave the page; the actions refuse them server-side regardless (01
 * INV-18).
 *
 * The page's one `h1` is visually hidden (the admin list-page precedent); "ADMIN" is an eyebrow.
 * Role gate: the layout renders `AdminGate` / the root 404; this page bails quietly for anon /
 * no-handle / role `user` (RP-04 — a page-thrown `notFound()` would replace the anon gate).
 */
export const metadata: Metadata = {
  title: 'Mentions · Admin',
};

const ADMIN_ONLY_TITLE = 'Admin only';
const BASE = '/admin/mentions';
/** 00 S1.8 Scope IN: `project_id` null = "About OddSense generally"; the table says it short. */
const GENERAL_PROJECT = 'About OddSense';

/**
 * 03 §2.10 `ReorderableList.onReorder` glue: ids in the new order → the 04 §1.6 batch shape,
 * `sort_order` = position (1-based, sequential — 05 T-ACT-64). One call, one transaction
 * (`reorder_mentions`), one revalidate. Role check, validation and writes live in `updateMention`
 * (04 SC-01 / SC-06); the result is intentionally unread — `ReorderableList` has no error surface
 * (03 §2.10) and the action never throws to the client.
 */
async function reorderMentions(ids: string[]): Promise<void> {
  'use server';
  await updateMention({ reorder: ids.map((id, index) => ({ id, sort_order: index + 1 })) });
}

/**
 * Row-action glue (see header): one `updateMention({id, patch})` call, then PRG back to this URL so
 * the dynamic page re-renders the stored state; only a successful save earns the "Saved." toast.
 * Trailing bound-call arguments (the form's `FormData`) are ignored — the input was fixed at render.
 */
async function updateMentionAndRefresh(input: UpdateMentionInput): Promise<void> {
  'use server';
  const result = await updateMention(input);
  redirect(result.ok ? `${BASE}?saved=saved` : BASE); // ADR-0038 D1 via ADR-0045
}

const COLUMNS: TableProps['columns'] = [
  { key: 'mention', header: 'Mention' },
  { key: 'project', header: 'Project' },
  { key: 'views', header: 'Views', align: 'end' },
  { key: 'status', header: 'Status' },
  { key: 'actions', header: 'Actions', align: 'end' },
];

type RowAction = { word: string; patch: UpdateMentionPatchInput['patch'] };

/** The worded buttons a row gets, by its pill (DESIGN.md §12.2 "Feature/Hide actions"). */
function rowActions(mention: AdminMentionListItem, nextFeaturedOrder: number): RowAction[] {
  switch (adminMentionStatus(mention.status, mention.featured)) {
    case 'live':
      return [
        { word: 'Feature', patch: { featured: true, sort_order: nextFeaturedOrder } },
        { word: 'Hide', patch: { status: 'hidden' } },
      ];
    case 'featured':
      return [
        { word: 'Unfeature', patch: { featured: false } },
        { word: 'Hide', patch: { status: 'hidden' } },
      ];
    case 'hidden':
      return [{ word: 'Show', patch: { status: 'published' } }];
    case 'draft':
      return [{ word: 'Publish', patch: { status: 'published' } }];
    case 'suggested':
      return [];
  }
}

/** One worded row button; moderators get it disabled inside a `title` wrapper, with no form. */
function actionButton(mention: AdminMentionListItem, action: RowAction, canCurate: boolean) {
  const content = (
    <>
      {action.word}
      <span className="visually-hidden">{` ${mention.title}`}</span>
    </>
  );
  if (!canCurate) {
    return (
      <span key={action.word} title={ADMIN_ONLY_TITLE}>
        <Button variant="secondary" size="sm" disabled>
          {content}
        </Button>
      </span>
    );
  }
  return (
    <form
      key={action.word}
      action={updateMentionAndRefresh.bind(null, { id: mention.id, patch: action.patch })}
    >
      <Button variant="secondary" size="sm" type="submit">
        {content}
      </Button>
    </form>
  );
}

function projectCell(mention: AdminMentionListItem): string {
  if (mention.projectId === null) return GENERAL_PROJECT;
  // Attached to a project this session cannot read (a moderator + a hidden / draft project).
  return mention.projectTitle ?? '—';
}

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AdminMentionsPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const savedRaw = Array.isArray(query.saved) ? query.saved[0] : query.saved;
  const savedToast = isSavedMessageKey(savedRaw) ? <SavedToast messageKey={savedRaw} /> : null;
  const tabRaw = Array.isArray(query.tab) ? query.tab[0] : query.tab;
  const tab: 'mentions' | 'suggested' = tabRaw === 'suggested' ? 'suggested' : 'mentions';

  // RP-04: bail quietly for anon / role `user` — the layout renders `AdminGate` / the root 404;
  // a page-thrown `notFound()` here would replace the anon gate (defence in depth, 01 INV-31).
  const viewer = await getViewer();
  const role = viewer?.profile?.role;
  if (!viewer?.profile?.handle || role === undefined || role === 'user') return null;
  const canCurate = role === 'admin';

  const head = (
    <>
      {savedToast}
      <header className={styles['admin-mentions-head']}>
        <h1 className="visually-hidden">Mentions</h1>
        <PixelLabel as="p" tone="gold" size={11}>
          ADMIN
        </PixelLabel>
        <p className={styles['admin-mentions-intro']}>
          Paste a link, check the preview, publish. Nothing shows up on its own.
        </p>
      </header>
      <nav aria-label="Mentions views" className={styles['admin-mentions-tabs']}>
        <Link
          href={BASE}
          className={styles['admin-mentions-tab']}
          aria-current={tab === 'mentions' ? 'page' : undefined}
        >
          Mentions
        </Link>
        <Link
          href={`${BASE}?tab=suggested`}
          className={styles['admin-mentions-tab']}
          aria-current={tab === 'suggested' ? 'page' : undefined}
        >
          Suggested
          <PixelLabel size={11} informational fill="indigo-wash">
            COMING LATER
          </PixelLabel>
        </Link>
      </nav>
    </>
  );

  if (tab === 'suggested') {
    // 00 S1.8.AC10: the stub — no rows, no Approve / Dismiss, no count, nothing that mutates.
    return (
      <div className={styles['admin-mentions']}>
        {head}
        <EmptyState
          title="NOTHING SUGGESTED"
          line="Auto-found mentions will wait here for a yes or no. Not yet."
        />
      </div>
    );
  }

  const [mentions, projects, syncSources] = await Promise.all([
    listAdminMentions(),
    listMentionProjectOptions(),
    listSyncStatus(MENTIONS_SYNC_SOURCES),
  ]);

  // What the Home strip reads (02 §2.1 item 3): published + featured, `sort_order` asc; the table's
  // own order (newest added first) breaks a tie, so the list is stable between renders.
  const featured = mentions
    .filter((mention) => mention.status === 'published' && mention.featured)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const nextFeaturedOrder = featured.reduce((max, m) => Math.max(max, m.sortOrder), 0) + 1;

  const rows: TableProps['rows'] = mentions.map((mention) => {
    const status = adminMentionStatus(mention.status, mention.featured);
    return {
      key: mention.id,
      mention: (
        <span className={styles['admin-mentions-mention']} data-status={status}>
          <span aria-hidden="true">
            <PlatformMark platform={mention.platform} size={24} />
          </span>
          <span className={styles['admin-mentions-name']}>
            <a
              className={styles['admin-mentions-title']}
              href={mention.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {mention.title}
              <span className="visually-hidden"> (opens in new tab)</span>
            </a>
            <span className={styles['admin-mentions-meta']}>
              {`${platformLabel(mention.platform)} · ${mention.creatorName}`}
            </span>
          </span>
        </span>
      ),
      project: (
        <span className={styles['admin-mentions-project']} data-status={status}>
          {projectCell(mention)}
        </span>
      ),
      views: (
        <span className={styles['admin-mentions-views']} data-status={status}>
          {mention.viewCount === null ? '—' : formatCount(mention.viewCount)}
        </span>
      ),
      status: <StatusPill status={status} />,
      actions: (
        <div className={styles['admin-mentions-actions']}>
          {rowActions(mention, nextFeaturedOrder).map((action) =>
            actionButton(mention, action, canCurate),
          )}
        </div>
      ),
    };
  });

  const featuredItems: ReorderableItem[] = featured.map((mention) => ({
    id: mention.id,
    title: mention.title,
    node: (
      <span className={styles['admin-mentions-order']}>
        <span className={styles['admin-mentions-order-title']}>{mention.title}</span>
        <span className={styles['admin-mentions-meta']}>
          {`${platformLabel(mention.platform)} · ${mention.creatorName}`}
        </span>
      </span>
    ),
  }));

  const sources: SyncStatusProps['sources'] = syncSources.map((row) => ({
    source: row.source,
    lastRun: row.lastRun,
    stale: row.stale,
    triggerable: true,
  }));

  return (
    <div className={styles['admin-mentions']}>
      {head}

      <div className={styles['admin-mentions-section']}>
        <h2 className={styles['admin-mentions-heading']}>ADD A MENTION</h2>
        <MentionPreview preview={null} projects={projects} readOnly={!canCurate} />
      </div>

      {featuredItems.length > 0 ? (
        <section
          className={styles['admin-mentions-section']}
          aria-labelledby={sectionTitleId('FEATURED ORDER')}
        >
          <h2 id={sectionTitleId('FEATURED ORDER')} className={styles['admin-mentions-heading']}>
            FEATURED ORDER
          </h2>
          <p className={styles['admin-mentions-order-help']}>
            The first four fill the Home strip, top to bottom. Drag a handle or use the arrows.
          </p>
          <ReorderableList
            items={featuredItems}
            onReorder={reorderMentions}
            label="Featured mentions"
            disabled={!canCurate}
          />
        </section>
      ) : null}

      <section
        className={styles['admin-mentions-section']}
        aria-labelledby={sectionTitleId('ALL MENTIONS')}
      >
        <div className={styles['admin-mentions-heading-row']}>
          <h2 id={sectionTitleId('ALL MENTIONS')} className={styles['admin-mentions-heading']}>
            ALL MENTIONS
            <span className="visually-hidden">{` ${mentions.length} total`}</span>
          </h2>
          <span aria-hidden="true">
            <PixelLabel informational tone="mute-dim">
              {`${mentions.length} TOTAL`}
            </PixelLabel>
          </span>
        </div>
        <Table
          caption="All mentions"
          columns={COLUMNS}
          rows={rows}
          rowKey="key"
          empty="Nothing pasted yet."
        />
      </section>

      <section
        className={styles['admin-mentions-section']}
        aria-labelledby={sectionTitleId('SYNC')}
      >
        <h2 id={sectionTitleId('SYNC')} className={styles['admin-mentions-heading']}>
          SYNC
        </h2>
        <SyncStatus sources={sources} canTrigger={canCurate} />
      </section>
    </div>
  );
}
