import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { NotificationMatrix } from '@/components/admin/NotificationMatrix';
import { Button } from '@/components/primitives/Button';
import { Field } from '@/components/primitives/Field';
import { PixelLabel } from '@/components/primitives/PixelLabel';
import { sectionTitleId } from '@/components/primitives/SectionTitle';
import { Table, type TableProps } from '@/components/primitives/Table';
import type { ActionError } from '@/lib/actions/result';
import { setUserRole } from '@/lib/actions/settings';
import type { SetUserRoleInput } from '@/lib/actions/settings.schema';
import { getViewer } from '@/lib/auth';
import { getAdminSettings, listModerators, type ModeratorRow } from '@/lib/data/admin';
import { HANDLE_HELPER, HANDLE_MAX } from '@/lib/validation/handle';
import styles from './page.module.css';

/**
 * `/admin/settings` — the whole route in one slice (02 §1.3 row + §2.8; 00 S1.5 "Admin
 * `/admin/settings`", AC1/AC2/AC3/AC4/AC11; DESIGN.md §11.3 #15, §12.1 Notification matrix;
 * ADR-0002 C2 / C4; ADR-0030 D5). Dynamic + session-backed under the `app/admin/layout.tsx` gate
 * (01 INV-31). **Admin only** (02 RP-04): the ONE admin page a moderator 404s on — anon / no
 * handle / role `user` bail with `null` (the layout renders `AdminGate` / the root 404, defence in
 * depth), role `moderator` → `notFound()` (root 404, never a 403 body, 00 S1.5.AC1). The readers
 * (`getAdminSettings()` — `site_settings` masked + `notification_matrix`; `listModerators()` —
 * `public_profiles where role <> 'user'`, 01 INV-45) run on the request-cookie client AFTER the
 * role check (`site_settings` select is admin-only RLS, 05 T-RLS-12 — a moderator session would
 * read no row and the reader throws). The raw webhook URL never reaches this file: the reader
 * hands over `webhookMasked` (`…<last 4>`) and the matrix (04 §1.3; 01 INV-43).
 *
 * Composition (ADR-0030 D5; 03 §2.10 `NotificationMatrix`, C-19): the island is the page's one
 * client file and owns the SAVE SETTINGS form — Moderation · Notifications · Moderators (this
 * page's server-rendered section, passed as `children`) · Ko-fi · SAVE. The Moderators row
 * actions and the add-by-handle form are server `<form action>`s bound to the page-scoped
 * `'use server'` glue below → `lib/actions/settings.ts` `setUserRole` (auth / validation / writes
 * live there, 04 SC-01) → PRG `redirect('/admin/settings')`, errors back through
 * `?form=moderators&field=&error=` and shown inline (`Field error` / `role="alert"`, 03 C-30 —
 * never a toast; admin routes are dynamic, so reading `searchParams` is legal — 02 §0.1). The
 * viewer's own row carries no Remove (the action refuses self-demotion anyway — 04 §1.3): it
 * reads "That's you" (prototype pass-2 verbatim). `listModerators()` reads live rows, so the PRG
 * re-render shows the new role without a revalidation (02 §5: `updateSettings` = `settings` only;
 * `setUserRole` revalidates nothing).
 */
export const metadata: Metadata = {
  title: 'Settings · Admin',
};

const BASE = '/admin/settings';

/** DESIGN.md §11.3 #15 role words as the pass-2 prototype renders them. */
const ROLE_WORDS: Record<ModeratorRow['role'], string> = { admin: 'Admin', moderator: 'Mod' };
const YOU_LINE = "That's you";
const PAGE_LEAD = "Moderation, notifications, mods, Ko-fi. That's all of it.";

const COLUMNS: TableProps['columns'] = [
  { key: 'handle', header: 'Handle' },
  { key: 'role', header: 'Role' },
  { key: 'actions', header: 'Actions', align: 'end' },
];

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** The error round-trip query (`form` names the form, `field` the input, `error` the message). */
function withError(error: ActionError, field: 'handle' | null): string {
  // A `validation` result's plain words live on its first issue (04 SC-03; the S1.4 rule).
  const message =
    error.code === 'validation' ? (error.issues?.[0]?.message ?? error.message) : error.message;
  const query = new URLSearchParams({ form: 'moderators', error: message });
  if (field) query.set('field', field);
  return `${BASE}?${query.toString()}`;
}

function queryValue(value: string | string[] | undefined): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Row action glue (ADR-0024; the `/admin/projects` `curateAndRefresh` precedent): one
 * `setUserRole` call bound to `{handle, role}` at render, then PRG back to the plain URL — or
 * back with the message for the alert line under the table (`forbidden` "You can't change your
 * own role." · `conflict` "Someone has to stay admin." · `not_found`).
 */
async function setRoleAndRefresh(input: SetUserRoleInput): Promise<void> {
  'use server';
  const result = await setUserRole(input);
  redirect(result.ok ? BASE : withError(result.error, null));
}

/** Add by handle → moderator. A typed `@` is stripped (the action would answer "No @ — we add it."). */
async function addModerator(formData: FormData): Promise<void> {
  'use server';
  const raw = formData.get('handle');
  const handle = (typeof raw === 'string' ? raw : '').trim().replace(/^@/, '');
  const result = await setUserRole({ handle, role: 'moderator' });
  redirect(result.ok ? BASE : withError(result.error, 'handle'));
}

export default async function AdminSettingsPage({ searchParams }: PageProps) {
  const query = await searchParams;

  // RP-04: bail quietly for anon / no handle / role `user` (the layout renders the gate / 404);
  // a moderator gets the root 404 HERE — the one admin page that does (00 S1.5.AC1).
  const viewer = await getViewer();
  const role = viewer?.profile?.role;
  if (!viewer?.profile?.handle || role === undefined || role === 'user') return null;
  if (role !== 'admin') notFound();

  const [settings, moderators] = await Promise.all([getAdminSettings(), listModerators()]);

  // ---- Error round-trip (see header) ---------------------------------------------------------
  const errorMessage = queryValue(query.form) === 'moderators' ? queryValue(query.error) : null;
  const errorField = queryValue(query.field);
  const handleError = errorField === 'handle' && errorMessage !== null ? errorMessage : undefined;
  const tableError = errorField === null && errorMessage !== null ? errorMessage : null;

  const rows: TableProps['rows'] = moderators.map((row) => ({
    key: row.id,
    handle: <span className={styles['admin-settings-handle']}>{`@${row.handle}`}</span>,
    role: <span className={styles['admin-settings-role']}>{ROLE_WORDS[row.role]}</span>,
    actions:
      row.id === viewer.user.id ? (
        <span className={styles['admin-settings-you']}>{YOU_LINE}</span>
      ) : (
        <form action={setRoleAndRefresh.bind(null, { handle: row.handle, role: 'user' })}>
          <Button variant="ghost" type="submit" arrow={false}>
            Remove
          </Button>
        </form>
      ),
  }));

  return (
    <div className={styles['admin-settings']}>
      <header className={styles['admin-settings-head']}>
        <h1 className="visually-hidden">Settings</h1>
        <PixelLabel as="p" tone="gold" size={11}>
          ADMIN
        </PixelLabel>
        <p className={styles['admin-settings-lead']}>{PAGE_LEAD}</p>
      </header>

      <NotificationMatrix
        matrix={settings.matrix}
        comingLater={settings.comingLater}
        webhookMasked={settings.webhookMasked}
        adminEmails={settings.adminNotifyEmails}
        moderationMode={settings.moderationMode}
        commentsClosedDefault={settings.commentsClosedDefault}
        kofiPage={settings.kofiPage}
        kofiWebhookLive={false}
      >
        <section
          className={styles['admin-settings-section']}
          aria-labelledby={sectionTitleId('MODERATORS')}
        >
          <h2 id={sectionTitleId('MODERATORS')} className={styles['admin-settings-heading']}>
            MODERATORS
          </h2>
          <Table caption="Moderators table" columns={COLUMNS} rows={rows} rowKey="key" />
          {tableError ? (
            <p role="alert" className={styles['admin-settings-error']}>
              {tableError}
            </p>
          ) : null}
          <form action={addModerator} className={styles['admin-settings-add']}>
            <div className={styles['admin-settings-add-field']}>
              <Field
                label="Add by handle"
                name="handle"
                prefix="@"
                maxLength={HANDLE_MAX}
                helper={HANDLE_HELPER}
                error={handleError}
                inputProps={{
                  placeholder: 'handle to add',
                  autoComplete: 'off',
                  spellCheck: false,
                }}
              />
            </div>
            <Button variant="secondary" type="submit">
              Add mod
            </Button>
          </form>
        </section>
      </NotificationMatrix>
    </div>
  );
}
