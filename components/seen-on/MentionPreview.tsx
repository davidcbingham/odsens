'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { useToast } from '@/components/layout/Toast';
import { Button } from '@/components/primitives/Button';
import { Field } from '@/components/primitives/Field';
import { PixelLabel } from '@/components/primitives/PixelLabel';
import { PlatformMark } from '@/components/primitives/PlatformMark';
import { Select, type SelectOption } from '@/components/primitives/Select';
import { createMention, fetchMentionPreview } from '@/lib/actions/mentions';
import type { MentionPreviewData } from '@/lib/actions/mentions.schema';
import type { ActionResult } from '@/lib/actions/result';
import { formatDate } from '@/lib/format/date';
import { formatCount } from '@/lib/format/number';
import {
  MENTION_PLATFORMS,
  mentionThumbnail,
  platformLabel,
  type MentionPlatform,
} from '@/lib/mentions';
import {
  EMPTY_DRAFT,
  NO_ERRORS,
  PASTE_A_LINK,
  buildCreateMentionInput,
  draftForUrl,
  draftFromPreview,
  fetchErrors,
  hasFieldError,
  previewIsComplete,
  publishErrors,
  type DraftFieldKey,
  type MentionDraft,
  type PublishErrors,
} from './MentionPreview.draft';
import styles from './MentionPreview.module.css';

/**
 * MentionPreview — the "Add a mention" island of `/admin/mentions` (03 §2.8 `MentionPreview`, C-16a;
 * DESIGN.md §12.2 Admin → Mentions "paste URL → auto-fetched preview card (thumb, title, creator,
 * views, date) → assign to a project or "About OddSense generally" → PUBLISH"; 02 §1.3
 * `/admin/mentions` row; 00 S1.8.AC1 / AC2 + risk note "manual fields"; ADR-0002 C7 / #33;
 * ADR-0045). The page's one client file for the add flow: it owns the link `Field`, the "Fetch"
 * call (`fetchMentionPreview`), the preview / manual editing state and the PUBLISH call
 * (`createMention`) — 03 says the preview renders "inside the client admin form", and no other
 * island exists to be that form (a server page cannot hand a fetched preview down: ADR-0024 glue
 * may only `redirect()`), so the 03 props are this island's INITIAL state (the page passes
 * `preview={null}`; `/dev/components` fixtures show each 03 §3 state statically).
 *
 * States (one `data-state` on the root — 03 C-12 / §3):
 *   `empty`    dashed `--line-strong` slot "Paste a link above."; PUBLISH is rendered DISABLED (a
 *              moderator never gets past this state and must still see the control — ADR-0045)
 *   `preview`  the fetched card: thumb · title · platform mark + "Platform · creator" · views
 *              (Silkscreen `--emerald`) · date; ghost "Edit fields" → `manual`
 *   `error`    the action's message VERBATIM in a `role="alert"` line (04 §1.6: "Couldn't read
 *              that page. You can fill the fields by hand.") above the manual fields
 *   `manual`   Title · Creator · Platform (`Select`, all six incl. `other`) · Creator link · Date ·
 *              Views, seeded from the preview when there is one. A fetched preview with no title
 *              or no creator name (both required on create) opens here instead of the card.
 * "Assign to" (`Select`: "About OddSense generally" first and default = `project_id: null`, then
 * the projects) and PUBLISH sit in ONE row under every state, so nothing jumps between states.
 *
 * Thumbnail (ADR-0002 #33; 01 INV-54): the card renders `mentionThumbnail()` — the
 * `i.ytimg.com/vi/<id>/hqdefault.jpg` literal built from a well-formed YouTube id — through
 * `next/image`, and NOTHING else: the fetched `thumbnail_url` is never an image source. Every
 * other platform (and a YouTube link without an id) shows the `PlatformMark` well.
 *
 * Wiring (ADR-0013; 03 C-07 / C-17 — the `NotificationMatrix` recipe): each `<form action>` is a
 * `useActionState` closure that calls the action and handles the result in its own transition.
 * Fetch ok → `preview` (or `manual`, see above); `validation` → the words on the link field (the
 * link itself is wrong — by-hand fields would not help); anything else → `error`. PUBLISH always
 * sends `status: 'published'`, `featured: false` (`buildCreateMentionInput`); ok → back to `empty`,
 * focus on the link field for the next paste, `Toast` "Saved." (03 G-04) + `router.refresh()`;
 * `conflict` → the link field; `validation` issues → their own field (the manual fields open when
 * an issue lands on one that is not on screen); anything else → one `role="alert"` line by the
 * button. Errors are never toasts (03 C-30); pending = `Button pending` (`aria-busy`, label
 * unchanged — ADR-0002 #46). Editing the link after a fetch drops what was fetched (it described
 * another page); hand-typed fields with no fetched preview behind them are kept.
 *
 * Moderators (`readOnly` — 02 §1.3 auth rule; 03 §2.10 admin-only controls rule; ADR-0045): every
 * control renders natively `disabled` under `title="Admin only"` — never hidden — and the markup
 * carries NO `<form>` and no handler, so nothing can reach an action.
 *
 * A11y: root `role="region"` (named "Add a mention") + `aria-live="polite"` so a fetched card or
 * the empty slot coming back is announced; the two control groups opt out (`aria-live="off"`) —
 * otherwise opening the `Select` list or typing would be read out as region changes. Error lines
 * are `role="alert"` and exist only while there is an error. `Field` / `Select` ids derive from
 * `name`, so every name is prefixed per instance (`useId`) — several specimens share
 * `/dev/components`.
 */
export type MentionPreviewProps = {
  /** Initial fetched preview (04 §1.6 return shape). The page passes `null`. */
  preview: MentionPreviewData | null;
  /** Initial error line — opens in the `error` state (fixtures). */
  error?: string;
  /** "Assign to" options; "About OddSense generally" is added here, first. */
  projects: { id: string; title: string }[];
  /** Open with the manual fields showing (fixtures; seeded from `preview` when given). */
  manual?: boolean;
  /** Moderator view: everything disabled under `title="Admin only"`, no form, no action. */
  readOnly?: boolean;
  className?: string;
};

type State = 'empty' | 'preview' | 'error' | 'manual';
type FetchResult = ActionResult<MentionPreviewData> | null;
type PublishResult = Awaited<ReturnType<typeof createMention>> | null;

const ADMIN_ONLY_TITLE = 'Admin only';
const SAVED_TOAST = 'Saved.';
/** `project_id: null` — 00 S1.8 Scope IN wording. */
const GENERAL_LABEL = 'About OddSense generally';
const GENERAL_VALUE = '';
/** 04 §1.6 bounds, mirrored as `maxLength` so the field stops where the schema does. */
const URL_MAX = 2048;
const TITLE_MAX = 200;
const CREATOR_MAX = 80;
const CREATOR_URL_MAX = 512;

const PLATFORM_OPTIONS: SelectOption[] = MENTION_PLATFORMS.map((platform) => ({
  value: platform,
  label: platformLabel(platform),
}));

/** Draft key → the 04 §1.6 key its error arrives under (`platform` has no error surface). */
const FIELD_ERROR_KEYS: Record<keyof MentionDraft, DraftFieldKey | null> = {
  platform: null,
  title: 'title',
  creatorName: 'creator_name',
  creatorUrl: 'creator_url',
  date: 'published_at',
  views: 'view_count',
};

function isPlatform(value: string): value is MentionPlatform {
  return (MENTION_PLATFORMS as readonly string[]).includes(value);
}

function initialState(props: MentionPreviewProps): State {
  if (props.error) return 'error';
  if (props.preview === null) return props.manual ? 'manual' : 'empty';
  return props.manual || !previewIsComplete(props.preview) ? 'manual' : 'preview';
}

/** "212K VIEWS" — `null` when the platform gave no count (never "0 VIEWS" by default). */
function viewsLabel(count: number | null): string | null {
  if (count === null) return null;
  return `${formatCount(count)} ${count === 1 ? 'VIEW' : 'VIEWS'}`;
}

/** The fetched card (03 §2.8 `preview`): thumb + title + creator + views + date. */
function PreviewCard({ preview }: { preview: MentionPreviewData }) {
  const thumbnail = mentionThumbnail({
    platform: preview.platform,
    externalId: preview.external_id,
  });
  const views = viewsLabel(preview.view_count);
  // `formatDate` throws on an unparseable value; an Open Graph date can be anything.
  const published =
    preview.published_at !== null && !Number.isNaN(Date.parse(preview.published_at))
      ? preview.published_at
      : null;
  const creator = (preview.creator_name ?? '').trim();
  const platform = platformLabel(preview.platform);

  return (
    <div className={styles['mention-preview-card']}>
      <div className={styles['mention-preview-thumb']}>
        {thumbnail !== null ? (
          <Image src={thumbnail} alt="" fill sizes="200px" />
        ) : (
          <PlatformMark platform={preview.platform} size={26} />
        )}
      </div>
      <div className={styles['mention-preview-body']}>
        <p className={styles['mention-preview-title']}>{preview.title}</p>
        <div className={styles['mention-preview-meta']}>
          <span className={styles['mention-preview-creator']}>
            <span aria-hidden="true">
              <PlatformMark platform={preview.platform} size={24} />
            </span>
            {creator === '' ? platform : `${platform} · ${creator}`}
          </span>
          {views !== null ? (
            <PixelLabel size={11} tone="emerald" informational>
              {views}
            </PixelLabel>
          ) : null}
          {published !== null ? (
            <time className={styles['mention-preview-date']} dateTime={published}>
              {formatDate(published)}
            </time>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function MentionPreview(props: MentionPreviewProps) {
  const { projects, readOnly = false, className } = props;
  const router = useRouter();
  const { toast } = useToast();
  const [state, setState] = useState<State>(() => initialState(props));
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState<MentionPreviewData | null>(props.preview);
  const [fetchLine, setFetchLine] = useState<string | null>(props.error ?? null);
  const [draft, setDraft] = useState<MentionDraft>(() =>
    props.preview ? draftFromPreview(props.preview) : EMPTY_DRAFT,
  );
  const [projectId, setProjectId] = useState(GENERAL_VALUE);
  const [errors, setErrors] = useState<PublishErrors>(NO_ERRORS);
  /** Where focus goes after the control that held it left the page (03 C-25: never to `body`). */
  const focusNext = useRef<'url' | 'title' | null>(null);
  const uid = useId();
  const fieldName = (base: string): string => `${uid}-${base}`;
  const slotId = `${uid}-slot`;
  const adminOnlyId = `${uid}-admin-only`;

  useEffect(() => {
    const target = focusNext.current;
    if (target === null) return;
    focusNext.current = null;
    document.getElementById(`field-${fieldName(target)}`)?.focus();
  });

  function reset(): void {
    setState('empty');
    setUrl('');
    setPreview(null);
    setFetchLine(null);
    setDraft(EMPTY_DRAFT);
    setProjectId(GENERAL_VALUE);
    setErrors(NO_ERRORS);
  }

  function onUrlChange(value: string): void {
    setUrl(value);
    clearError('url');
    // What was fetched described the old link — drop it. Hand-typed fields (no preview behind
    // them) are the admin's own words and stay.
    if (preview !== null) {
      setPreview(null);
      setDraft(EMPTY_DRAFT);
      setFetchLine(null);
      setErrors(NO_ERRORS);
      setState('empty');
    }
  }

  /** Editing a field takes its error line away (the words described the old value). */
  function clearError(key: keyof PublishErrors): void {
    setErrors((current) => {
      if (current[key] === undefined) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function setField<K extends keyof MentionDraft>(key: K, value: MentionDraft[K]): void {
    setDraft((current) => ({ ...current, [key]: value }));
    const errorKey = FIELD_ERROR_KEYS[key];
    if (errorKey !== null) clearError(errorKey);
  }

  const [, fetchAction, fetchPending] = useActionState<FetchResult>(async () => {
    if (url.trim() === '') {
      setErrors({ url: PASTE_A_LINK });
      return null;
    }
    const result = await fetchMentionPreview({ url });
    if (result.ok) {
      setPreview(result.data);
      setDraft(draftFromPreview(result.data));
      setFetchLine(null);
      setErrors(NO_ERRORS);
      setState(previewIsComplete(result.data) ? 'preview' : 'manual');
      return result;
    }
    const where = fetchErrors(result.error);
    if ('url' in where) {
      setErrors({ url: where.url });
      return result;
    }
    setPreview(null);
    // Keep anything already typed by hand; otherwise start from the link's likely platform.
    setDraft((current) => (state === 'empty' || preview !== null ? draftForUrl(url) : current));
    setFetchLine(where.line);
    setErrors(NO_ERRORS);
    setState('error');
    return result;
  }, null);

  const [, publishAction, publishPending] = useActionState<PublishResult>(async () => {
    const built = buildCreateMentionInput({ url, preview, draft, projectId });
    if (!built.ok) {
      setErrors(built.errors);
      if (state === 'preview' && hasFieldError(built.errors)) setState('manual');
      return null;
    }
    const result = await createMention(built.input);
    if (result.ok) {
      reset();
      focusNext.current = 'url';
      toast(SAVED_TOAST);
      router.refresh();
      return result;
    }
    const next = publishErrors(result.error);
    setErrors(next);
    // An issue on a field that is not on screen (the card shows no inputs) opens the fields.
    if (state === 'preview' && hasFieldError(next)) setState('manual');
    return result;
  }, null);

  function editFields(): void {
    setState('manual');
    focusNext.current = 'title';
  }

  const busy = fetchPending || publishPending;
  const showFields = state === 'manual' || state === 'error';
  const assignOptions: SelectOption[] = [
    { value: GENERAL_VALUE, label: GENERAL_LABEL },
    ...projects.map((project) => ({ value: project.id, label: project.title })),
  ];

  // ---- Pieces shared by the admin (forms) and moderator (no forms) arrangements ----------------

  const linkField = (
    <Field
      label="Link"
      name={fieldName('url')}
      type="url"
      maxLength={URL_MAX}
      error={errors.url}
      disabled={readOnly}
      inputProps={{
        value: url,
        placeholder: 'https://www.youtube.com/watch?v=…',
        autoComplete: 'off',
        spellCheck: false,
        // While a call is in flight the link is frozen (read-only keeps focus; `disabled` drops it).
        ...(readOnly
          ? { readOnly: true, title: ADMIN_ONLY_TITLE }
          : {
              readOnly: busy,
              onChange: (event: { currentTarget: { value: string } }) =>
                onUrlChange(event.currentTarget.value),
            }),
      }}
    />
  );

  const body = (
    <>
      {state === 'empty' ? (
        <p id={slotId} className={styles['mention-preview-slot']}>
          Paste a link above.
        </p>
      ) : null}
      {state === 'error' && fetchLine !== null ? (
        <p role="alert" className={styles['mention-preview-error']}>
          {fetchLine}
        </p>
      ) : null}
      {state === 'preview' && preview !== null ? <PreviewCard preview={preview} /> : null}
    </>
  );

  const fieldInput = (key: Exclude<keyof MentionDraft, 'platform'>) =>
    readOnly
      ? { value: draft[key], readOnly: true, title: ADMIN_ONLY_TITLE }
      : {
          value: draft[key],
          onChange: (event: { currentTarget: { value: string } }) =>
            setField(key, event.currentTarget.value),
        };

  const fields = showFields ? (
    <div className={styles['mention-preview-fields']} aria-live="off">
      <div className={styles['mention-preview-field-wide']}>
        <Field
          label="Title"
          name={fieldName('title')}
          maxLength={TITLE_MAX}
          error={errors.title}
          disabled={readOnly}
          inputProps={fieldInput('title')}
        />
      </div>
      <Field
        label="Creator"
        name={fieldName('creator')}
        maxLength={CREATOR_MAX}
        helper="The channel or account name, as shown in public."
        error={errors.creator_name}
        disabled={readOnly}
        inputProps={fieldInput('creatorName')}
      />
      {readOnly ? (
        <div title={ADMIN_ONLY_TITLE}>
          <Select
            label="Platform"
            name={fieldName('platform')}
            options={PLATFORM_OPTIONS}
            defaultValue={draft.platform}
            disabled
          />
        </div>
      ) : (
        <Select
          label="Platform"
          name={fieldName('platform')}
          options={PLATFORM_OPTIONS}
          value={draft.platform}
          onChange={(value) => {
            if (isPlatform(value)) setField('platform', value);
          }}
        />
      )}
      <div className={styles['mention-preview-field-wide']}>
        <Field
          label="Creator link"
          name={fieldName('creator-url')}
          type="url"
          maxLength={CREATOR_URL_MAX}
          helper="Optional. Their channel or profile page."
          error={errors.creator_url}
          disabled={readOnly}
          inputProps={{ ...fieldInput('creatorUrl'), autoComplete: 'off', spellCheck: false }}
        />
      </div>
      <Field
        label="Date"
        name={fieldName('date')}
        helper="Optional. Like 2026-06-14."
        error={errors.published_at}
        disabled={readOnly}
        inputProps={{ ...fieldInput('date'), placeholder: 'YYYY-MM-DD', autoComplete: 'off' }}
      />
      <Field
        label="Views"
        name={fieldName('views')}
        helper="Optional. Leave empty if the page doesn't say."
        error={errors.view_count}
        disabled={readOnly}
        inputProps={{ ...fieldInput('views'), inputMode: 'numeric', autoComplete: 'off' }}
      />
    </div>
  ) : null;

  const classes = className
    ? `${styles['mention-preview']} ${className}`
    : styles['mention-preview'];
  const helper = (
    <p className={styles['mention-preview-helper']}>
      {`"${GENERAL_LABEL}" is in the list for videos that aren't about one project.`}
    </p>
  );

  if (readOnly) {
    // Moderator arrangement: the same controls, natively disabled under `title="Admin only"`,
    // with NO `<form>` and no handler anywhere — nothing here can start a request.
    return (
      <div
        className={classes}
        data-state={state}
        role="region"
        aria-label="Add a mention"
        aria-live="polite"
      >
        <div className={styles['mention-preview-link']} aria-live="off">
          <div className={styles['mention-preview-link-field']}>{linkField}</div>
          <span title={ADMIN_ONLY_TITLE}>
            <Button variant="secondary" disabled aria-describedby={adminOnlyId}>
              Fetch
            </Button>
          </span>
        </div>
        {body}
        {state === 'preview' ? (
          <div className={styles['mention-preview-edit']} aria-live="off">
            <span title={ADMIN_ONLY_TITLE}>
              <Button variant="ghost" arrow={false} disabled aria-describedby={adminOnlyId}>
                Edit fields
              </Button>
            </span>
          </div>
        ) : null}
        {fields}
        <div className={styles['mention-preview-assign']} aria-live="off">
          <div className={styles['mention-preview-assign-select']} title={ADMIN_ONLY_TITLE}>
            <Select
              label="Assign to"
              name={fieldName('project')}
              options={assignOptions}
              defaultValue={GENERAL_VALUE}
              disabled
            />
          </div>
          <span className={styles['mention-preview-publish']} title={ADMIN_ONLY_TITLE}>
            <Button variant="primary" disabled aria-describedby={adminOnlyId}>
              PUBLISH
            </Button>
          </span>
        </div>
        <span id={adminOnlyId} className="visually-hidden">
          {ADMIN_ONLY_TITLE}
        </span>
        {helper}
      </div>
    );
  }

  return (
    <div
      className={classes}
      data-state={state}
      role="region"
      aria-label="Add a mention"
      aria-live="polite"
    >
      {/* `noValidate`: the action answers inline in plain words instead of the browser's bubble
          (the `NotificationMatrix` add-email precedent). */}
      <form
        action={fetchAction}
        className={styles['mention-preview-link']}
        aria-live="off"
        noValidate
      >
        <div className={styles['mention-preview-link-field']}>{linkField}</div>
        <Button variant="secondary" type="submit" pending={fetchPending} disabled={publishPending}>
          Fetch
        </Button>
      </form>
      {body}
      <form action={publishAction} className={styles['mention-preview-form']} noValidate>
        {state === 'preview' ? (
          <div className={styles['mention-preview-edit']} aria-live="off">
            <Button variant="ghost" arrow={false} onClick={editFields} disabled={busy}>
              Edit fields
            </Button>
          </div>
        ) : null}
        {fields}
        <div className={styles['mention-preview-assign']} aria-live="off">
          <div className={styles['mention-preview-assign-select']}>
            <Select
              label="Assign to"
              name={fieldName('project')}
              options={assignOptions}
              value={projectId}
              onChange={setProjectId}
            />
          </div>
          <span className={styles['mention-preview-publish']}>
            {errors.line !== undefined ? (
              <span role="alert" className={styles['mention-preview-error']}>
                {errors.line}
              </span>
            ) : null}
            <Button
              variant="primary"
              type="submit"
              pending={publishPending}
              disabled={state === 'empty' || fetchPending}
              {...(state === 'empty' ? { 'aria-describedby': slotId } : {})}
            >
              PUBLISH
            </Button>
          </span>
        </div>
      </form>
      {helper}
    </div>
  );
}
