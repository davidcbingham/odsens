import type { Metadata } from 'next';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { ReorderableList, type ReorderableItem } from '@/components/admin/ReorderableList';
import { SavedToast } from '@/components/admin/SavedToast';
import { isSavedMessageKey } from '@/components/admin/savedMessages';
import { SkinForm } from '@/components/admin/SkinForm';
import { Button } from '@/components/primitives/Button';
import { PixelLabel } from '@/components/primitives/PixelLabel';
import { sectionTitleId } from '@/components/primitives/SectionTitle';
import { StatusPill } from '@/components/primitives/StatusPill';
import { Table, type TableProps } from '@/components/primitives/Table';
import { updateSkin } from '@/lib/actions/skins';
import type { UpdateSkinPatchInput } from '@/lib/actions/skins.schema';
import { getViewer } from '@/lib/auth';
import { getAdminSkin, listAdminSkins, type AdminSkinListItem } from '@/lib/data/admin';
import { formatCount } from '@/lib/format/number';
import styles from './page.module.css';

/**
 * `/admin/skins` — the skins admin (02 §1.3 `/admin/skins` row + auth rule; 00 S1.7 Scope IN
 * "Admin" + AC1 / AC9 / AC10; DESIGN.md §6 #9, §5 Admin table / field; ADR-0002 C7; ADR-0048
 * ADR-0048 D19 / D27). Dynamic + session-backed under the `app/admin/layout.tsx` gate (01 INV-31); reads go
 * through `lib/data/admin.ts` on the request-cookie client (01 INV-12 / INV-15; ADR-0022) — an
 * admin reads every status, a moderator the RLS-filtered published rows only (05 T-RLS-53/54),
 * read-only. One route, four sections:
 *
 * 1. ADD A SKIN / EDIT SKIN — the `SkinForm` island (03 C-07: it calls `createSkin` / `updateSkin`
 *    itself and refreshes this page on success). `?edit=<id>` switches the SAME island to edit mode
 *    with the row pre-filled (`getAdminSkin`), the heading "EDIT SKIN" and a ghost "Cancel" back to
 *    the bare URL; an id that is not a uuid, not a row, or not readable by this session (a
 *    moderator on a draft) opens the create form instead. The island is keyed by the row so a
 *    switch between two `?edit=` ids starts its state afresh. A plain `<div>` wraps it: the island
 *    IS the region "Add a skin" — a `<section>` of the same name around it would double the landmark.
 * 2. ORDER — `ReorderableList` "Skin order": the PUBLISHED rows by `sort_order`, exactly what
 *    `/skins` shows (02 §1.1: `sort_order` asc, so the first row is the page's default selection).
 *    One completed reorder (drag, handle arrow key, or a Move button) = ONE `updateSkin({reorder})`
 *    with sequential `sort_order` 1..n through the `reorderSkins` glue. Rendered only when a skin
 *    is published.
 * 3. ALL SKINS — `Table`, newest created first (`listAdminSkins` orders by `created_at`, NOT
 *    `sort_order`, so a reorder never reshuffles it and the reorder glue needs no PRG). Columns
 *    Skin (the 64×64 texture at half scale, pixelated — DESIGN.md §4 — over name + slug) · Model ·
 *    Downloads (`record_skin_download`'s counter) · Status (`StatusPill` DRAFT / LIVE) · Actions:
 *    Publish / Unpublish (page-scoped glue → `updateSkin({id, status})` + PRG `?saved=saved` →
 *    `SavedToast` "Saved.") and Edit (a link to `?edit=<id>`). Empty copy "Nothing here yet."
 *    verbatim per 02 §1.3.
 *
 * Wiring (ADR-0024 module-private glue; ADR-0038 D1): every row action is a server `<form action>`
 * bound (`.bind`, 03 C-19) to `updateSkinAndRefresh` — ONE `updateSkin` call, then PRG: tag-only
 * revalidation does not re-render an untagged dynamic route inside the action round trip. ok →
 * `?saved=saved`; a refused or failed call lands on the bare URL and re-renders the unchanged
 * truth (the row has no error surface; the action logs it server-side).
 *
 * Moderators (02 §1.3 auth rule; 03 §2.10 admin-only controls rule): every mutation control is
 * rendered — natively `disabled` under `title="Admin only"`, never hidden, and with NO `<form>`
 * around it, so no request can leave the page; the island takes `readOnly`; Edit stays a link (it
 * opens the same read-only form). The actions refuse them server-side regardless (01 INV-18).
 *
 * The page's one `h1` is visually hidden (the admin list-page precedent); "ADMIN" is an eyebrow.
 * Role gate: the layout renders `AdminGate` / the root 404; this page bails quietly for anon /
 * no-handle / role `user` (RP-04 — a page-thrown `notFound()` would replace the anon gate).
 */
export const metadata: Metadata = {
  title: 'Skins · Admin',
};

const ADMIN_ONLY_TITLE = 'Admin only';
const BASE = '/admin/skins';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The 64×64 texture drawn at half scale (an integer step — DESIGN.md §4) in a 40px well. */
const THUMB_PX = 32;

/**
 * 03 §2.10 `ReorderableList.onReorder` glue: ids in the new order → the 04 §1.5 batch shape,
 * `sort_order` = position (1-based, sequential). One call, one transaction (`reorder_skins`), one
 * revalidate. Role check, validation and writes live in `updateSkin` (04 SC-01 / SC-06); the
 * result is intentionally unread — `ReorderableList` has no error surface (03 §2.10) and the
 * action never throws to the client.
 */
async function reorderSkins(ids: string[]): Promise<void> {
  'use server';
  await updateSkin({ reorder: ids.map((id, index) => ({ id, sort_order: index + 1 })) });
}

/**
 * Row-action glue (see header): one `updateSkin({id, …})` call, then PRG back to this URL so the
 * dynamic page re-renders the stored state; only a successful save earns the "Saved." toast.
 * Trailing bound-call arguments (the form's `FormData`) are ignored — the input was fixed at render.
 */
async function updateSkinAndRefresh(input: UpdateSkinPatchInput): Promise<void> {
  'use server';
  const result = await updateSkin(input);
  redirect(result.ok ? `${BASE}?saved=saved` : BASE); // ADR-0038 D1
}

const COLUMNS: TableProps['columns'] = [
  { key: 'skin', header: 'Skin' },
  { key: 'model', header: 'Model' },
  { key: 'downloads', header: 'Downloads', align: 'end' },
  { key: 'status', header: 'Status' },
  { key: 'actions', header: 'Actions', align: 'end' },
];

const MODEL_WORDS = { classic: 'Classic', slim: 'Slim' } as const;

/** The 32px pixelated texture in its 40px well (the table cell and the ORDER row share it). */
function textureThumb(skin: AdminSkinListItem) {
  return (
    <span className={styles['admin-skins-thumb']}>
      <Image
        src={skin.textureUrl}
        alt={`${skin.name} texture`}
        width={THUMB_PX}
        height={THUMB_PX}
        unoptimized
      />
    </span>
  );
}

/** One worded row button; moderators get it disabled inside a `title` wrapper, with no form. */
function statusButton(skin: AdminSkinListItem, canCurate: boolean) {
  const publish = skin.status === 'draft';
  const content = (
    <>
      {publish ? 'Publish' : 'Unpublish'}
      <span className="visually-hidden">{` ${skin.name}`}</span>
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
      action={updateSkinAndRefresh.bind(null, {
        id: skin.id,
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

export default async function AdminSkinsPage({ searchParams }: PageProps) {
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

  const [skins, editing] = await Promise.all([
    listAdminSkins(),
    editId === null ? Promise.resolve(null) : getAdminSkin(editId),
  ]);

  // What `/skins` shows (02 §1.1): published, `sort_order` asc; the table's own order (newest
  // first) breaks a tie, so the list is stable between renders.
  const published = skins
    .filter((skin) => skin.status === 'published')
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const rows: TableProps['rows'] = skins.map((skin) => ({
    key: skin.id,
    skin: (
      <span className={styles['admin-skins-skin']} data-status={skin.status}>
        {textureThumb(skin)}
        <span className={styles['admin-skins-name']}>
          <span className={styles['admin-skins-title']}>{skin.name}</span>
          <span className={styles['admin-skins-meta']}>{skin.slug}</span>
        </span>
      </span>
    ),
    model: <span className={styles['admin-skins-model']}>{MODEL_WORDS[skin.model]}</span>,
    downloads: (
      <span className={styles['admin-skins-downloads']}>{formatCount(skin.downloads)}</span>
    ),
    status: <StatusPill status={skin.status} />,
    actions: (
      <div className={styles['admin-skins-actions']}>
        {statusButton(skin, canCurate)}
        <Button variant="ghost" size="sm" arrow={false} href={`${BASE}?edit=${skin.id}`}>
          Edit
          <span className="visually-hidden">{` ${skin.name}`}</span>
        </Button>
      </div>
    ),
  }));

  const orderItems: ReorderableItem[] = published.map((skin) => ({
    id: skin.id,
    title: skin.name,
    node: (
      <span className={styles['admin-skins-order']}>
        {textureThumb(skin)}
        <span className={styles['admin-skins-name']}>
          <span className={styles['admin-skins-order-title']}>{skin.name}</span>
          <span className={styles['admin-skins-meta']}>{skin.slug}</span>
        </span>
      </span>
    ),
  }));

  return (
    <div className={styles['admin-skins']}>
      {savedToast}
      <header className={styles['admin-skins-head']}>
        <h1 className="visually-hidden">Skins</h1>
        <PixelLabel as="p" tone="gold" size={11}>
          ADMIN
        </PixelLabel>
        <p className={styles['admin-skins-intro']}>
          Drop a 64×64 skin, name it, publish it. The site renders the 3D view.
        </p>
      </header>

      <div className={styles['admin-skins-section']}>
        <div className={styles['admin-skins-heading-row']}>
          <h2 className={styles['admin-skins-heading']}>
            {editing === null ? 'ADD A SKIN' : 'EDIT SKIN'}
          </h2>
          {editing !== null ? (
            <Button variant="ghost" size="sm" arrow={false} href={BASE}>
              Cancel
            </Button>
          ) : null}
        </div>
        <SkinForm key={editing?.id ?? 'new'} skin={editing} readOnly={!canCurate} />
      </div>

      {orderItems.length > 0 ? (
        <section
          className={styles['admin-skins-section']}
          aria-labelledby={sectionTitleId('ORDER')}
        >
          <h2 id={sectionTitleId('ORDER')} className={styles['admin-skins-heading']}>
            ORDER
          </h2>
          <p className={styles['admin-skins-order-help']}>
            The order on /skins, top to bottom; the first one opens by default. Drag a handle or use
            the arrows.
          </p>
          <ReorderableList
            items={orderItems}
            onReorder={reorderSkins}
            label="Skin order"
            disabled={!canCurate}
          />
        </section>
      ) : null}

      <section
        className={styles['admin-skins-section']}
        aria-labelledby={sectionTitleId('ALL SKINS')}
      >
        <div className={styles['admin-skins-heading-row']}>
          <h2 id={sectionTitleId('ALL SKINS')} className={styles['admin-skins-heading']}>
            ALL SKINS
            <span className="visually-hidden">{` ${skins.length} total`}</span>
          </h2>
          <span aria-hidden="true">
            <PixelLabel informational tone="mute-dim">
              {`${skins.length} TOTAL`}
            </PixelLabel>
          </span>
        </div>
        <Table
          caption="All skins"
          columns={COLUMNS}
          rows={rows}
          rowKey="key"
          empty="Nothing here yet."
        />
      </section>
    </div>
  );
}
