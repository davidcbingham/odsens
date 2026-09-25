import type { Metadata } from 'next';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { ArtForm } from '@/components/admin/ArtForm';
import { ReorderableList, type ReorderableItem } from '@/components/admin/ReorderableList';
import { SavedToast } from '@/components/admin/SavedToast';
import { isSavedMessageKey } from '@/components/admin/savedMessages';
import { Button } from '@/components/primitives/Button';
import { PixelLabel } from '@/components/primitives/PixelLabel';
import { sectionTitleId } from '@/components/primitives/SectionTitle';
import { StatusPill } from '@/components/primitives/StatusPill';
import { Table, type TableProps } from '@/components/primitives/Table';
import { updateArt } from '@/lib/actions/art';
import type { UpdateArtCommitInput } from '@/lib/actions/art.schema';
import type { ArtKind } from '@/lib/art';
import { getViewer } from '@/lib/auth';
import { getAdminArt, listAdminArt, type AdminArtListItem } from '@/lib/data/admin';
import styles from './page.module.css';

/**
 * `/admin/art` — the art admin (02 §1.3 `/admin/art` row + auth rule; 00 S1.7 Scope IN "Admin" +
 * AC7 / AC9 / AC10; DESIGN.md §6 #9, §5 Admin table / field; ADR-0002 C7; ADR-0048 D19 / D27). Dynamic
 * + session-backed under the `app/admin/layout.tsx` gate (01 INV-31); reads go through
 * `lib/data/admin.ts` on the request-cookie client (01 INV-12 / INV-15; ADR-0022) — an admin reads
 * every status, a moderator the RLS-filtered published rows only (05 T-RLS-58/59), read-only. One
 * route, three sections — the `/admin/skins` twin:
 *
 * 1. ADD ART / EDIT ART — the `ArtForm` island (03 C-07: it calls `createArt` / `updateArt` itself,
 *    two-phase through its `UploadWell`, and refreshes this page on success). `?edit=<id>` switches
 *    the SAME island to edit mode with the row pre-filled (`getAdminArt`), the heading "EDIT ART"
 *    and a ghost "Cancel" back to the bare URL; an id that is not a uuid, not a row, or not readable
 *    by this session opens the create form instead. Keyed by the row so a switch between two
 *    `?edit=` ids starts afresh. A plain `<div>` wraps it: the island IS the region "Add art".
 * 2. ORDER — `ReorderableList` "Art order": the PUBLISHED rows by `sort_order`, exactly the masonry
 *    order on `/art` (02 §1.1). One completed reorder = ONE `updateArt({reorder})` with sequential
 *    `sort_order` 1..n through the `reorderArt` glue. Rendered only when a piece is published.
 * 3. ALL ART — `Table`, newest created first (`listAdminArt` orders by `created_at`, NOT
 *    `sort_order`, so a reorder never reshuffles it). Columns Art (a 48px `next/image` thumb, the
 *    picture contained at its natural aspect — never cropped, §6 #6) · Title (over slug) · Kind ·
 *    Size (`w×h`, server-derived at commit) · Status (`StatusPill` DRAFT / LIVE) · Actions:
 *    Publish / Unpublish (page-scoped glue → `updateArt({phase:'commit', id, status})` + PRG
 *    `?saved=saved` → `SavedToast` "Saved.") and Edit (a link to `?edit=<id>`). Empty copy
 *    "Nothing here yet." verbatim per 02 §1.3.
 *
 * Wiring (ADR-0024 module-private glue; ADR-0038 D1): every row action is a server `<form action>`
 * bound (`.bind`, 03 C-19) to `updateArtAndRefresh` — ONE `updateArt` call, then PRG (tag-only
 * revalidation does not re-render an untagged dynamic route inside the action round trip). ok →
 * `?saved=saved`; a refused or failed call lands on the bare URL and re-renders the unchanged truth.
 *
 * Moderators (02 §1.3 auth rule; 03 §2.10 admin-only controls rule): every mutation control is
 * rendered — natively `disabled` under `title="Admin only"`, never hidden, and with NO `<form>`
 * around it; the island takes `readOnly`; Edit stays a link (it opens the same read-only form).
 * The actions refuse them server-side regardless (01 INV-18).
 *
 * The page's one `h1` is visually hidden (the admin list-page precedent); "ADMIN" is an eyebrow.
 * Role gate: the layout renders `AdminGate` / the root 404; this page bails quietly for anon /
 * no-handle / role `user` (RP-04 — a page-thrown `notFound()` would replace the anon gate).
 */
export const metadata: Metadata = {
  title: 'Art · Admin',
};

const ADMIN_ONLY_TITLE = 'Admin only';
const BASE = '/admin/art';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The table / ORDER thumb well (ADR-0048 D19 / D27: 48px, natural aspect contained). */
const THUMB_PX = 48;

/**
 * 03 §2.10 `ReorderableList.onReorder` glue: ids in the new order → the 04 §1.5 batch shape,
 * `sort_order` = position (1-based, sequential). One call, one transaction (`reorder_art`), one
 * revalidate. Role check, validation and writes live in `updateArt` (04 SC-01 / SC-06); the
 * result is intentionally unread — `ReorderableList` has no error surface (03 §2.10).
 */
async function reorderArt(ids: string[]): Promise<void> {
  'use server';
  await updateArt({ reorder: ids.map((id, index) => ({ id, sort_order: index + 1 })) });
}

/**
 * Row-action glue (see header): one `updateArt({phase:'commit', id, …})` call, then PRG back to
 * this URL so the dynamic page re-renders the stored state; only a successful save earns the
 * "Saved." toast. Trailing bound-call arguments (the form's `FormData`) are ignored.
 */
async function updateArtAndRefresh(input: UpdateArtCommitInput): Promise<void> {
  'use server';
  const result = await updateArt(input);
  redirect(result.ok ? `${BASE}?saved=saved` : BASE); // ADR-0038 D1
}

const COLUMNS: TableProps['columns'] = [
  { key: 'art', header: 'Art' },
  { key: 'title', header: 'Title' },
  { key: 'kind', header: 'Kind' },
  { key: 'size', header: 'Size', align: 'end' },
  { key: 'status', header: 'Status' },
  { key: 'actions', header: 'Actions', align: 'end' },
];

/** Singular kind words (the `/art` filter row's plurals are `kindLabel`). */
const KIND_WORDS: Record<ArtKind, string> = {
  avatar: 'Avatar',
  thumbnail: 'Thumbnail',
  icon: 'Icon',
  render: 'Render',
  other: 'Other',
};

/** The 48px well with the picture contained (the table cell and the ORDER row share it). */
function artThumb(art: AdminArtListItem) {
  return (
    <span className={styles['admin-art-thumb']}>
      <Image src={art.imageUrl} alt={art.title} fill sizes={`${THUMB_PX}px`} />
    </span>
  );
}

/** One worded row button; moderators get it disabled inside a `title` wrapper, with no form. */
function statusButton(art: AdminArtListItem, canCurate: boolean) {
  const publish = art.status === 'draft';
  const content = (
    <>
      {publish ? 'Publish' : 'Unpublish'}
      <span className="visually-hidden">{` ${art.title}`}</span>
    </>
  );
  if (!canCurate) {
    return (
      <span title={ADMIN_ONLY_TITLE}>
        <Button variant="secondary" size="sm" disabled>
          {content}
        </Button>
      </span>
    );
  }
  return (
    <form
      action={updateArtAndRefresh.bind(null, {
        phase: 'commit',
        id: art.id,
        status: publish ? 'published' : 'draft',
      })}
    >
      <Button variant="secondary" size="sm" type="submit">
        {content}
      </Button>
    </form>
  );
}

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AdminArtPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const savedRaw = Array.isArray(query.saved) ? query.saved[0] : query.saved;
  const savedToast = isSavedMessageKey(savedRaw) ? <SavedToast messageKey={savedRaw} /> : null;
  const editRaw = Array.isArray(query.edit) ? query.edit[0] : query.edit;
  const editId = typeof editRaw === 'string' && UUID_RE.test(editRaw) ? editRaw : null;

  // RP-04: bail quietly for anon / role `user` — the layout renders `AdminGate` / the root 404;
  // a page-thrown `notFound()` here would replace the anon gate (defence in depth, 01 INV-31).
  const viewer = await getViewer();
  const role = viewer?.profile?.role;
  if (!viewer?.profile?.handle || role === undefined || role === 'user') return null;
  const canCurate = role === 'admin';

  const [pieces, editing] = await Promise.all([
    listAdminArt(),
    editId === null ? Promise.resolve(null) : getAdminArt(editId),
  ]);

  // What `/art` shows (02 §1.1): published, `sort_order` asc; the table's own order (newest
  // first) breaks a tie, so the list is stable between renders.
  const published = pieces
    .filter((art) => art.status === 'published')
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const rows: TableProps['rows'] = pieces.map((art) => ({
    key: art.id,
    art: artThumb(art),
    title: (
      <span className={styles['admin-art-name']} data-status={art.status}>
        <span className={styles['admin-art-title']}>{art.title}</span>
        <span className={styles['admin-art-meta']}>{art.slug}</span>
      </span>
    ),
    kind: <span className={styles['admin-art-kind']}>{KIND_WORDS[art.kind]}</span>,
    size: <span className={styles['admin-art-size']}>{`${art.width}×${art.height}`}</span>,
    status: <StatusPill status={art.status} />,
    actions: (
      <div className={styles['admin-art-actions']}>
        {statusButton(art, canCurate)}
        <Button variant="ghost" size="sm" arrow={false} href={`${BASE}?edit=${art.id}`}>
          Edit
          <span className="visually-hidden">{` ${art.title}`}</span>
        </Button>
      </div>
    ),
  }));

  const orderItems: ReorderableItem[] = published.map((art) => ({
    id: art.id,
    title: art.title,
    node: (
      <span className={styles['admin-art-order']}>
        {artThumb(art)}
        <span className={styles['admin-art-name']}>
          <span className={styles['admin-art-order-title']}>{art.title}</span>
          <span className={styles['admin-art-meta']}>
            {`${KIND_WORDS[art.kind]} · ${art.width}×${art.height}`}
          </span>
        </span>
      </span>
    ),
  }));

  return (
    <div className={styles['admin-art']}>
      {savedToast}
      <header className={styles['admin-art-head']}>
        <h1 className="visually-hidden">Art</h1>
        <PixelLabel as="p" tone="gold" size={11}>
          ADMIN
        </PixelLabel>
        <p className={styles['admin-art-intro']}>
          Pictures only. Natural size, no cropping. Credit is a handle, never a name.
        </p>
      </header>

      <div className={styles['admin-art-section']}>
        <div className={styles['admin-art-heading-row']}>
          <h2 className={styles['admin-art-heading']}>
            {editing === null ? 'ADD ART' : 'EDIT ART'}
          </h2>
          {editing !== null ? (
            <Button variant="ghost" size="sm" arrow={false} href={BASE}>
              Cancel
            </Button>
          ) : null}
        </div>
        <ArtForm key={editing?.id ?? 'new'} art={editing} readOnly={!canCurate} />
      </div>

      {orderItems.length > 0 ? (
        <section className={styles['admin-art-section']} aria-labelledby={sectionTitleId('ORDER')}>
          <h2 id={sectionTitleId('ORDER')} className={styles['admin-art-heading']}>
            ORDER
          </h2>
          <p className={styles['admin-art-order-help']}>
            The order on /art, first to last. Drag a handle or use the arrows.
          </p>
          <ReorderableList
            items={orderItems}
            onReorder={reorderArt}
            label="Art order"
            disabled={!canCurate}
          />
        </section>
      ) : null}

      <section className={styles['admin-art-section']} aria-labelledby={sectionTitleId('ALL ART')}>
        <div className={styles['admin-art-heading-row']}>
          <h2 id={sectionTitleId('ALL ART')} className={styles['admin-art-heading']}>
            ALL ART
            <span className="visually-hidden">{` ${pieces.length} total`}</span>
          </h2>
          <span aria-hidden="true">
            <PixelLabel informational tone="mute-dim">
              {`${pieces.length} TOTAL`}
            </PixelLabel>
          </span>
        </div>
        <Table
          caption="All art"
          columns={COLUMNS}
          rows={rows}
          rowKey="key"
          empty="Nothing here yet."
        />
      </section>
    </div>
  );
}
