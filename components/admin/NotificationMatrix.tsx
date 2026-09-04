'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
  useActionState,
  useId,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from 'react';
import { useToast } from '@/components/layout/Toast';
import { Button } from '@/components/primitives/Button';
import { Chip } from '@/components/primitives/Chip';
import { Field } from '@/components/primitives/Field';
import { PixelLabel } from '@/components/primitives/PixelLabel';
import { StatusPill } from '@/components/primitives/StatusPill';
import { Toggle } from '@/components/primitives/Toggle';
import type { ActionError, ActionResult } from '@/lib/actions/result';
import {
  testDiscordWebhook,
  updateSettings,
  type SettingsView,
  type UpdateSettingsResult,
} from '@/lib/actions/settings';
import { maskSecret } from '@/lib/format/secret';
import {
  DELIVERY_CHANNELS,
  type ComingLaterKind,
  type DeliveryChannel,
} from '@/lib/notify/constants';
import {
  matrixDefaults,
  matrixRowsForUi,
  type MatrixEntry,
  type MatrixRow,
} from '@/lib/notify/matrix';
import { expandSyncRow, matrixDiff } from '@/lib/settings/matrixDiff';
import styles from './NotificationMatrix.module.css';

/**
 * NotificationMatrix — the `/admin/settings` client island (03 §2.10 `NotificationMatrix`, C-16a;
 * 02 §2.8; DESIGN.md §11.1 Square toggle / Toast / Admin field, §11.3 #15, §12.1 Notification
 * matrix, §12.7 #43; 00 S1.5.AC2/AC3/AC4/AC11; ADR-0030 D5 / D12; 05 T-E2E-37). The page's ONE
 * client file: it owns the whole SAVE SETTINGS form — Moderation · Notifications · the
 * server-rendered Moderators `Table` (`children`, C-19 composition) · Ko-fi · SAVE — so one
 * `updateSettings` call saves everything on the page (04 §1.3).
 *
 * Markup: the Moderators slot carries its own server `<form action>`s (ADR-0024 PRG glue on the
 * page), and forms cannot nest, so the island is a `<div>` of sections with React state behind
 * every control; only the footer strip is a `<form action={saveAction}>` (`useActionState` around
 * `updateSettings`, 03 C-17). The payload is DIFFED against the last server truth (`matrixDiff`
 * for the grid — only changed `(kind, channel)` triples, the shared Sync failed / stale row
 * expanded to both kinds through `expandSyncRow`; partial `site_settings` fields only when
 * changed), so SAVE stays disabled until something is dirty (02 §2.8 "unsaved changes → SAVE
 * enabled"). ok → `Toast` "Saved." (G-04) + the returned truth replaces the snapshot +
 * `router.refresh()`; errors stay inline (03 C-30): `validation` issues land on their field
 * (`discord_webhook_url` · `kofi_page` · `admin_notify_emails.<i>`), anything else on one
 * `role="alert"` line by the button — never a toast.
 *
 * Webhook (ADR-0030 D5; 04 §1.3): the `Field type="password"` is NEVER pre-filled — its
 * placeholder is `webhookMasked` (`…<last 4>`) when a URL is stored, else the bare
 * `https://discord.com/api/webhooks/…` hint; an untouched field means "unchanged" (omitted), the
 * ghost "Remove" beside it sends `''` (clear). "Test" → `testDiscordWebhook({ url })` with the
 * typed value, or nothing (the stored one) → the inline `role="status"` line `✔ Sent a test.` /
 * `✕ <the action's plain reason>` (never a toast; a `validation` result's words live on its first
 * issue — 04 SC-03, the S1.4 rule — so a mistyped URL reads "That doesn't look like a Discord
 * webhook URL.", never `runAction`'s generic line). The raw URL never comes back: the ok result
 * carries `discord_webhook_tail`, masked here with `maskSecret`. The password field carries
 * `autoComplete="new-password"` — the one value browsers honour to keep the typed secret out of
 * the password manager (01 INV-43: masked everywhere, never stored client-side).
 *
 * Admin emails (00 S1.5.AC4): removable `Chip`s + an add field with a plain client-side shape
 * check; duplicates ignored; the server re-validates (lowercase, ≤ 10, de-dup — 04 §1.3). The
 * signed-in admin's Google address is never pre-filled (the props carry only `admin_notify_emails`).
 *
 * Grid (DESIGN.md §12.1; 03 §2.10): a `<table>` with `<caption>` + `<th scope="col">` EMAIL ·
 * DISCORD (`PixelLabel` 11px); rows New comment · Held for review · Reported · Sync failed / stale
 * (`matrixRowsForUi` — the sync cell reads ON only when BOTH kinds are ON); cells =
 * `Toggle role="switch" accent="emerald"` named "<event> by <channel>"; the COMING LATER rows
 * (Suggested mention · New order · New tip) render `Toggle disabled` at their seeded values,
 * `aria-disabled="true"` on the row, the words COMING LATER in `--mute-dim`, 45 % opacity
 * (rendered regardless of flags — 01 INV-74). Phone: rows stack, both toggles stay inline under
 * EMAIL / DISCORD micro-labels (the module CSS). Every control ≥ 44 px (03 C-24). Tokens only.
 *
 * Ids: every id the island emits (section headings, field names, the radio group) is prefixed
 * with `useId()` so `/dev/components` can mount several instances without duplicate ids or
 * cross-wired `aria-labelledby` (the `NavMenuButton.panelId` precedent, 03 C-03; T-E2E-48).
 */
export type NotificationMatrixProps = {
  /** The 16 `(kind, channel)` cells in `matrixDefaults` order (`getAdminSettings().matrix`). */
  matrix: MatrixEntry[];
  /** The greyed COMING LATER kinds (rendered regardless — 01 INV-74). */
  comingLater: ComingLaterKind[];
  /** `…<last 4>` of the stored webhook, or `null` when none is set. Never the URL. */
  webhookMasked: string | null;
  adminEmails: string[];
  /** The pixel allay render (pending asset, ADR-0002 #25) — 28 px beside the panel title. */
  allayImageUrl?: string;
  moderationMode: SettingsView['moderation_mode'];
  commentsClosedDefault: boolean;
  kofiPage: string | null;
  /** v1: always `false` (02 §2.8 "NOT SET + Arrives with Phase 2."). */
  kofiWebhookLive: boolean;
  /** The server-rendered MODERATORS section (03 C-19 composition; ADR-0030 D5). */
  children?: ReactNode;
};

type ModerationMode = SettingsView['moderation_mode'];
type UpdateSettingsInput = Parameters<typeof updateSettings>[0];
type SaveResult = ActionResult<UpdateSettingsResult> | null;

/** The last server truth the draft is diffed against (props at mount, then each ok result). */
type Snapshot = {
  moderationMode: ModerationMode;
  commentsClosedDefault: boolean;
  /** `''` when the row holds NULL (the action's `''` = clear rule, 04 §1.3). */
  kofiPage: string;
  emails: string[];
  webhookMasked: string | null;
  matrix: MatrixEntry[];
};

/** What the admin has on screen. */
type Draft = Omit<Snapshot, 'webhookMasked'> & {
  /** The typed webhook (`''` = untouched → omitted from the payload). */
  webhookTyped: string;
  /** The ghost "Remove" was pressed → send `''` (clear). */
  clearWebhook: boolean;
};

// ---- Copy (DESIGN.md §12.1 / §12.7 #43 / 02 §2.8 / ADR-0030 D5 verbatim; prototype pass-3) ----
const MODERATION_HOLD_LABEL = 'Hold first-time commenters';
const MODERATION_HOLD_LINE =
  'Their first comment waits for you. Everything after posts straight away.';
const MODERATION_AUTO_LABEL = 'Auto-publish signed-in users';
const MODERATION_AUTO_LINE = 'Everything posts immediately. You clean up after.';
const COMMENTS_CLOSED_LABEL = 'Comments off by default on new projects';
const COMMENTS_CLOSED_HELPER = 'Existing projects keep their own setting.';
const NOTIFICATIONS_LEAD =
  'Site-level. One grid for all admins, two channels. The allay picks events up and delivers them — everything sends as allay@odsens.com.';
const PANEL_DELIVERS = 'Where the allay delivers';
const PANEL_PICKS_UP = 'What it picks up';
const WEBHOOK_LABEL = 'Discord webhook URL';
const WEBHOOK_PLACEHOLDER = 'https://discord.com/api/webhooks/…';
const WEBHOOK_HELPER = 'Masked after save.';
const TEST_OK_LINE = '✔ Sent a test.';
const EMAILS_LABEL = 'Admin emails';
const EMAIL_ADD_LABEL = 'Add an admin email';
const EMAIL_ADD_PLACEHOLDER = 'Type an address, press enter';
const EMAILS_HELPER = 'Only what’s typed here. Google emails are never reused silently.';
const GRID_HELPER =
  'The allay works for admins only — commenters never get mail. Deliveries arrive from allay@odsens.com.';
const COMING_LATER = 'COMING LATER';
const KOFI_PAGE_LABEL = 'Page name';
const KOFI_PAGE_HELPER = 'Tips land in Ko-fi. We only link out.';
const KOFI_WEBHOOK_LABEL = 'Webhook';
const KOFI_WEBHOOK_PHASE_2 = 'Arrives with Phase 2.';
const SAVE_LABEL = 'SAVE SETTINGS';
const SAVE_LINE = 'Saves everything on this page.';
const SAVED_TOAST = 'Saved.';
// Client-side email shape lines (server words win on SAVE — 04 §1.3).
const EMAIL_SHAPE_LINE = 'That doesn’t look like an email address.';
const EMAIL_MAX_LINE = 'Ten addresses is the limit.';

/** 04 §1.3 `admin_notify_emails.max(10)` (raw list) — mirrored so the add control says so first. */
const ADMIN_EMAILS_MAX = 10;
/** A plain shape check (the server's `z.email()` is the truth). */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CHANNEL_WORDS: Record<DeliveryChannel, string> = { email: 'EMAIL', discord: 'DISCORD' };

/** Every cell present (a fixture may pass a partial list; the DB never does — the migration seeds 16). */
function normaliseMatrix(entries: readonly MatrixEntry[]): MatrixEntry[] {
  return matrixDefaults.map((entry) => {
    const hit = entries.find((row) => row.kind === entry.kind && row.channel === entry.channel);
    return { kind: entry.kind, channel: entry.channel, enabled: hit ? hit.enabled : entry.enabled };
  });
}

function snapshotFromProps(props: NotificationMatrixProps): Snapshot {
  return {
    moderationMode: props.moderationMode,
    commentsClosedDefault: props.commentsClosedDefault,
    kofiPage: props.kofiPage ?? '',
    emails: [...props.adminEmails],
    webhookMasked: props.webhookMasked,
    matrix: normaliseMatrix(props.matrix),
  };
}

function snapshotFromResult(result: UpdateSettingsResult): Snapshot {
  const { settings, matrix } = result;
  return {
    moderationMode: settings.moderation_mode,
    commentsClosedDefault: settings.comments_closed_default,
    kofiPage: settings.kofi_page ?? '',
    emails: [...settings.admin_notify_emails],
    webhookMasked:
      settings.discord_webhook_set && settings.discord_webhook_tail !== null
        ? maskSecret(settings.discord_webhook_tail)
        : null,
    matrix: normaliseMatrix(matrix),
  };
}

function draftFromSnapshot(snapshot: Snapshot): Draft {
  return {
    moderationMode: snapshot.moderationMode,
    commentsClosedDefault: snapshot.commentsClosedDefault,
    kofiPage: snapshot.kofiPage,
    emails: [...snapshot.emails],
    matrix: snapshot.matrix.map((entry) => ({ ...entry })),
    webhookTyped: '',
    clearWebhook: false,
  };
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** The partial `updateSettings` input — only what changed (04 §1.3 "omitted = unchanged"). */
function buildPayload(server: Snapshot, draft: Draft): UpdateSettingsInput {
  const payload: UpdateSettingsInput = {};
  if (draft.moderationMode !== server.moderationMode)
    payload.moderation_mode = draft.moderationMode;
  if (draft.commentsClosedDefault !== server.commentsClosedDefault) {
    payload.comments_closed_default = draft.commentsClosedDefault;
  }
  if (draft.kofiPage !== server.kofiPage) payload.kofi_page = draft.kofiPage;
  if (!sameList(draft.emails, server.emails)) payload.admin_notify_emails = [...draft.emails];
  if (draft.clearWebhook) payload.discord_webhook_url = '';
  else if (draft.webhookTyped !== '') payload.discord_webhook_url = draft.webhookTyped;
  const matrix = matrixDiff(server.matrix, draft.matrix);
  if (matrix.length > 0) payload.matrix = matrix;
  return payload;
}

function isDirty(server: Snapshot, draft: Draft): boolean {
  return Object.keys(buildPayload(server, draft)).length > 0;
}

/** Field errors from a `validation` result (`issues[].path` → field; the rest → the form line). */
type FieldErrors = {
  webhook: string | null;
  kofi: string | null;
  emails: string | null;
  form: string | null;
};

const NO_ERRORS: FieldErrors = { webhook: null, kofi: null, emails: null, form: null };

/** A `validation` result's plain words live on its first issue (04 SC-03; the S1.4 rule). */
function plainWords(error: ActionError): string {
  return error.code === 'validation'
    ? (error.issues?.[0]?.message ?? error.message)
    : error.message;
}

function errorsFrom(error: ActionError): FieldErrors {
  const errors: FieldErrors = { ...NO_ERRORS };
  if (error.code === 'validation' && error.issues && error.issues.length > 0) {
    const rest: string[] = [];
    for (const issue of error.issues) {
      const root = issue.path.split('.')[0] ?? '';
      if (root === 'discord_webhook_url') errors.webhook ??= issue.message;
      else if (root === 'kofi_page') errors.kofi ??= issue.message;
      else if (root === 'admin_notify_emails') errors.emails ??= issue.message;
      else rest.push(issue.message);
    }
    if (rest.length > 0) errors.form = rest[0] ?? error.message;
    return errors;
  }
  errors.form = error.message;
  return errors;
}

export function NotificationMatrix(props: NotificationMatrixProps) {
  const { allayImageUrl, kofiWebhookLive, children } = props;
  const router = useRouter();
  const { toast } = useToast();
  const [server, setServer] = useState<Snapshot>(() => snapshotFromProps(props));
  const [draft, setDraft] = useState<Draft>(() => draftFromSnapshot(snapshotFromProps(props)));
  const [errors, setErrors] = useState<FieldErrors>(NO_ERRORS);
  const [emailDraft, setEmailDraft] = useState('');
  const [testLine, setTestLine] = useState<string | null>(null);
  const [testPending, startTest] = useTransition();
  const moderationId = useId();
  const gridHelperId = useId();
  const saveLineId = useId();
  // `Field` derives its ids from `name`, the moderation radios share a native group by `name`,
  // and each section heading is an `aria-labelledby` target: prefix all of them per instance so
  // several islands on one page (`/dev/components`, T-E2E-48) keep unique ids, separate radio
  // groups and their own section names. Nothing reads these names — state is React's.
  const uid = useId();
  const fieldName = (base: string): string => `${uid}-${base}`;
  const sectionId = (base: string): string => `${uid}-${base}`;

  // The footer `<form action>` (03 C-17): React re-binds the latest closure on every render, so a
  // submit sends exactly what is on screen. The result is handled right here, in the action's own
  // transition (no effect, no seen-ref): ok → the returned truth is the new snapshot (dirty
  // clears), toast, refresh; error → inline (03 C-30).
  const [, saveAction, savePending] = useActionState<SaveResult>(async () => {
    const result = await updateSettings(buildPayload(server, draft));
    if (result.ok) {
      const next = snapshotFromResult(result.data);
      setServer(next);
      setDraft(draftFromSnapshot(next));
      setErrors(NO_ERRORS);
      toast(SAVED_TOAST);
      router.refresh();
    } else {
      setErrors(errorsFrom(result.error));
    }
    return result;
  }, null);

  const dirty = isDirty(server, draft);
  const rows = matrixRowsForUi(draft.matrix);
  const webhookSet = server.webhookMasked !== null && !draft.clearWebhook;

  // ---- Handlers ---------------------------------------------------------------------------------

  function setModerationMode(mode: ModerationMode) {
    setDraft((current) => ({ ...current, moderationMode: mode }));
  }

  function setCell(row: MatrixRow, channel: DeliveryChannel, enabled: boolean) {
    const writes =
      row.id === 'sync'
        ? expandSyncRow(enabled, channel)
        : row.kinds.map((kind) => ({ kind, channel, enabled }));
    setDraft((current) => ({
      ...current,
      matrix: current.matrix.map((entry) => {
        const write = writes.find((w) => w.kind === entry.kind && w.channel === entry.channel);
        return write ? { ...entry, enabled: write.enabled } : entry;
      }),
    }));
  }

  function runTest() {
    const typed = draft.webhookTyped;
    startTest(async () => {
      const result = await testDiscordWebhook(typed !== '' ? { url: typed } : {});
      setTestLine(result.ok ? TEST_OK_LINE : `✕ ${plainWords(result.error)}`);
    });
  }

  function addEmail() {
    const value = emailDraft.trim().toLowerCase();
    if (value === '') return;
    if (!EMAIL_SHAPE.test(value)) {
      setErrors((current) => ({ ...current, emails: EMAIL_SHAPE_LINE }));
      return;
    }
    if (draft.emails.includes(value)) {
      setEmailDraft('');
      return;
    }
    if (draft.emails.length >= ADMIN_EMAILS_MAX) {
      setErrors((current) => ({ ...current, emails: EMAIL_MAX_LINE }));
      return;
    }
    setDraft((current) => ({ ...current, emails: [...current.emails, value] }));
    setEmailDraft('');
    setErrors((current) => ({ ...current, emails: null }));
  }

  function onAddEmailSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    addEmail();
  }

  function removeEmail(address: string) {
    setDraft((current) => ({
      ...current,
      emails: current.emails.filter((value) => value !== address),
    }));
    setErrors((current) => ({ ...current, emails: null }));
  }

  // ---- Render -----------------------------------------------------------------------------------

  return (
    <div className={styles.settings}>
      {/* ---------------------------------------------------------------- MODERATION */}
      <section className={styles.section} aria-labelledby={sectionId('moderation')}>
        <h2 id={sectionId('moderation')} className={styles.heading}>
          MODERATION
        </h2>
        <div role="radiogroup" aria-labelledby={moderationId} className={styles['choice-list']}>
          <span id={moderationId} className="visually-hidden">
            Moderation mode
          </span>
          <div className={styles.choice}>
            <Toggle
              name={fieldName('moderation_mode')}
              value="hold_first_time"
              checked={draft.moderationMode === 'hold_first_time'}
              onChange={(checked) => checked && setModerationMode('hold_first_time')}
              role="radio"
              accent="indigo"
              label={MODERATION_HOLD_LABEL}
              describedBy={`${uid}-hold-line`}
            />
            <div className={styles['choice-words']}>
              <span className={styles['choice-label']} aria-hidden="true">
                {MODERATION_HOLD_LABEL}
              </span>
              <span id={`${uid}-hold-line`} className={styles['choice-line']}>
                {MODERATION_HOLD_LINE}
              </span>
            </div>
          </div>
          <div className={styles.choice}>
            <Toggle
              name={fieldName('moderation_mode')}
              value="auto"
              checked={draft.moderationMode === 'auto'}
              onChange={(checked) => checked && setModerationMode('auto')}
              role="radio"
              accent="indigo"
              label={MODERATION_AUTO_LABEL}
              describedBy={`${uid}-auto-line`}
            />
            <div className={styles['choice-words']}>
              <span className={styles['choice-label']} aria-hidden="true">
                {MODERATION_AUTO_LABEL}
              </span>
              <span id={`${uid}-auto-line`} className={styles['choice-line']}>
                {MODERATION_AUTO_LINE}
              </span>
            </div>
          </div>
        </div>
        <div className={styles.choice}>
          <Toggle
            name="comments_closed_default"
            checked={draft.commentsClosedDefault}
            onChange={(checked) =>
              setDraft((current) => ({ ...current, commentsClosedDefault: checked }))
            }
            role="switch"
            accent="indigo"
            label={COMMENTS_CLOSED_LABEL}
            describedBy={`${uid}-closed-line`}
          />
          <div className={styles['choice-words']}>
            <span className={styles['choice-label']} aria-hidden="true">
              {COMMENTS_CLOSED_LABEL}
            </span>
            <span id={`${uid}-closed-line`} className={styles['choice-line']}>
              {COMMENTS_CLOSED_HELPER}
            </span>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- NOTIFICATIONS */}
      <section className={styles.section} aria-labelledby={sectionId('notifications')}>
        <h2 id={sectionId('notifications')} className={styles.heading}>
          NOTIFICATIONS
        </h2>
        <p className={styles.lead}>{NOTIFICATIONS_LEAD}</p>

        <div className={styles.panel}>
          <h3 className={styles['panel-title']}>
            {allayImageUrl ? (
              <Image
                src={allayImageUrl}
                alt=""
                width={28}
                height={28}
                unoptimized
                className={styles.allay}
              />
            ) : null}
            {PANEL_DELIVERS}
          </h3>

          <div className={styles['webhook-row']}>
            <div className={styles['webhook-field']}>
              <Field
                label={WEBHOOK_LABEL}
                name={fieldName('discord_webhook_url')}
                type="password"
                helper={WEBHOOK_HELPER}
                error={errors.webhook ?? undefined}
                inputProps={{
                  value: draft.webhookTyped,
                  onChange: (event) => {
                    const value = event.currentTarget.value;
                    setDraft((current) => ({ ...current, webhookTyped: value }));
                    setErrors((current) => ({ ...current, webhook: null }));
                  },
                  placeholder: webhookSet
                    ? (server.webhookMasked ?? undefined)
                    : WEBHOOK_PLACEHOLDER,
                  autoComplete: 'new-password',
                  spellCheck: false,
                }}
              />
            </div>
            <div className={styles['webhook-actions']}>
              <Button variant="secondary" type="button" onClick={runTest} pending={testPending}>
                Test
              </Button>
              {webhookSet ? (
                <Button
                  variant="ghost"
                  type="button"
                  arrow={false}
                  onClick={() => {
                    setDraft((current) => ({ ...current, clearWebhook: true, webhookTyped: '' }));
                    setTestLine(null);
                  }}
                >
                  Remove
                </Button>
              ) : null}
            </div>
          </div>
          <p
            role="status"
            className={styles['test-line']}
            data-tone={testLine === null ? undefined : testLine === TEST_OK_LINE ? 'ok' : 'no'}
          >
            {testLine}
          </p>

          <div className={styles.emails}>
            <span className={styles['emails-label']}>{EMAILS_LABEL}</span>
            {draft.emails.length > 0 ? (
              <ul className={styles['email-chips']} aria-label={EMAILS_LABEL}>
                {draft.emails.map((address) => (
                  <li key={address}>
                    <Chip
                      label={address}
                      removeLabel={`Remove ${address}`}
                      onRemove={() => removeEmail(address)}
                    />
                  </li>
                ))}
              </ul>
            ) : null}
            {/* `noValidate`: the plain shape check below answers inline instead of the browser
                bubble (03 C-30); the server's `z.email()` is the truth on SAVE. */}
            <form onSubmit={onAddEmailSubmit} className={styles['email-add']} noValidate>
              <div className={styles['email-add-field']}>
                <Field
                  label={EMAIL_ADD_LABEL}
                  name={fieldName('admin_email')}
                  type="email"
                  helper={EMAILS_HELPER}
                  error={errors.emails ?? undefined}
                  maxLength={254}
                  inputProps={{
                    value: emailDraft,
                    onChange: (event) => {
                      setEmailDraft(event.currentTarget.value);
                      setErrors((current) => ({ ...current, emails: null }));
                    },
                    placeholder: EMAIL_ADD_PLACEHOLDER,
                    autoComplete: 'off',
                  }}
                />
              </div>
              <Button variant="secondary" type="submit">
                Add
              </Button>
            </form>
          </div>
        </div>

        <div className={styles.panel}>
          <h3 className={styles['panel-title']}>{PANEL_PICKS_UP}</h3>
          <table className={styles.grid} aria-describedby={gridHelperId}>
            <caption className="visually-hidden">{PANEL_PICKS_UP}</caption>
            <thead>
              <tr>
                <th scope="col" className={styles['grid-head']}>
                  <span className="visually-hidden">Event</span>
                </th>
                {DELIVERY_CHANNELS.map((channel) => (
                  <th key={channel} scope="col" className={styles['grid-head']}>
                    <PixelLabel tone="mute-dim" size={11}>
                      {CHANNEL_WORDS[channel]}
                    </PixelLabel>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className={styles['grid-row']}
                  data-coming-later={row.comingLater ? '' : undefined}
                  aria-disabled={row.comingLater ? 'true' : undefined}
                >
                  <th scope="row" className={styles['grid-label']}>
                    <span className={styles['grid-event']}>{row.label}</span>
                    {row.comingLater ? (
                      <PixelLabel tone="mute-dim" size={11}>
                        {COMING_LATER}
                      </PixelLabel>
                    ) : null}
                  </th>
                  {DELIVERY_CHANNELS.map((channel) => (
                    <td key={channel} className={styles['grid-cell']}>
                      <span className={styles['grid-micro']} aria-hidden="true">
                        <PixelLabel tone="mute-dim" size={11}>
                          {CHANNEL_WORDS[channel]}
                        </PixelLabel>
                      </span>
                      <Toggle
                        name={`matrix-${row.id}-${channel}`}
                        checked={row.enabled[channel]}
                        onChange={
                          row.comingLater ? undefined : (checked) => setCell(row, channel, checked)
                        }
                        role="switch"
                        accent="emerald"
                        label={`${row.label} by ${channel}`}
                        disabled={row.comingLater}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p id={gridHelperId} className={styles.helper}>
            {GRID_HELPER}
          </p>
        </div>
      </section>

      {/* ---------------------------------------------------------------- MODERATORS */}
      {children}

      {/* --------------------------------------------------------------------- KO-FI */}
      <section className={styles.section} aria-labelledby={sectionId('ko-fi')}>
        <h2 id={sectionId('ko-fi')} className={styles.heading}>
          KO-FI
        </h2>
        <div className={styles['kofi-field']}>
          <Field
            label={KOFI_PAGE_LABEL}
            name={fieldName('kofi_page')}
            prefix="ko-fi.com/"
            maxLength={40}
            helper={KOFI_PAGE_HELPER}
            error={errors.kofi ?? undefined}
            inputProps={{
              value: draft.kofiPage,
              onChange: (event) => {
                const value = event.currentTarget.value;
                setDraft((current) => ({ ...current, kofiPage: value }));
                setErrors((current) => ({ ...current, kofi: null }));
              },
              autoComplete: 'off',
              spellCheck: false,
            }}
          />
        </div>
        <div className={styles['kofi-webhook']}>
          <span className={styles['kofi-webhook-label']}>{KOFI_WEBHOOK_LABEL}</span>
          <StatusPill status={kofiWebhookLive ? 'live' : 'not-set'} />
          {kofiWebhookLive ? null : (
            <span className={styles['kofi-webhook-line']}>{KOFI_WEBHOOK_PHASE_2}</span>
          )}
        </div>
      </section>

      {/* ---------------------------------------------------------------- SAVE strip */}
      <form action={saveAction} className={styles.footer} aria-describedby={saveLineId}>
        <Button variant="primary" type="submit" disabled={!dirty} pending={savePending}>
          {SAVE_LABEL}
        </Button>
        <p id={saveLineId} className={styles['footer-line']}>
          {SAVE_LINE}
        </p>
        {errors.form ? (
          <p role="alert" className={styles['footer-error']}>
            {errors.form}
          </p>
        ) : null}
      </form>
    </div>
  );
}
