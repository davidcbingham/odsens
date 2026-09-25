'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useActionState, useId, useState } from 'react';
import { UploadWell, type UploadWellProps } from '@/components/admin/UploadWell';
import { useToast } from '@/components/layout/Toast';
import { Button } from '@/components/primitives/Button';
import { Field } from '@/components/primitives/Field';
import { Select, type SelectOption } from '@/components/primitives/Select';
import { Toggle } from '@/components/primitives/Toggle';
import { createArt, updateArt } from '@/lib/actions/art';
import type { CreateArtCommitInput, UpdateArtCommitInput } from '@/lib/actions/art.schema';
import type { ActionError } from '@/lib/actions/result';
import { ART_KINDS, isArtKind, type ArtKind } from '@/lib/art';
import { slugifyName } from '@/lib/skins';
import styles from './ArtForm.module.css';

/**
 * ArtForm — the "Add art" / "Edit art" island of `/admin/art` (02 §1.3 `/admin/art` row; 03 §2.10
 * admin-only controls rule, `UploadWell` deferred-commit mode; 04 §1.4.5 two-phase uploads + §1.5
 * `createArt` / `updateArt`; 00 S1.7 AC7 / AC9; DESIGN.md §5 Admin field, §6 #9, §11.1 Upload well /
 * Square toggle; ADR-0002 C7; ADR-0048 D18 / D19 / D27). The page's one client file for the add /
 * edit flow: it owns every field, the image upload and the commit call — the `SkinForm` twin.
 *
 * Fields (ADR-0048 D19 / D27): Title (≤ 80, counter) · Slug (pre-filled from the title until edited by hand) ·
 * Kind (`Select` Avatar / Thumbnail / Icon / Render / Other) · Year (number, "2015 to next year.
 * Leave empty if you'd rather not say.") · Credit (≤ 40, "A handle, never a real name.") ·
 * Visitors can download it (`Toggle` switch) · Status · Sort order · Image (`UploadWell kind="art"`
 * in DEFERRED-COMMIT mode: `begin` → PUT → "Ready to save." with `action={createArt}` on create —
 * the `begin` mints the art id inside the returned path (ADR-0048 D3) — or `action={updateArt}` +
 * `targetIds={{ id }}` on edit; the well's limits line prints `UPLOAD_KINDS.art`, 04 U4).
 *
 * Save → `createArt({ phase:'commit', path, …metadata })` / `updateArt({ phase:'commit', id, path?,
 * …metadata })` — plain objects, the 04 §1.5 keys: `year` `null` when the field is empty, `credit`
 * `null` when blank, `sort_order` a number; an edit sends every key so an emptied Year / Credit
 * clears and an unticked switch turns `downloadable` off. A create with no picture yet answers
 * inline ("Add a picture first.") without a call. ok → `Toast` "Saved." + `router.refresh()`; a
 * create resets the form (the well remounts to `idle`). Failure → `issues` on their field
 * (`conflict` on `slug`; the well's own `path` issue under the well), anything without a field in
 * ONE `<p role="alert">` by the button — never a toast (03 C-30).
 *
 * Slug conflict on CREATE: the commit had already moved the pending object to its content-addressed
 * final path before the insert refused the slug (04 U3), and the form holds only the PENDING path
 * the well handed over — so the picture has to be dropped again after the slug is fixed; the form
 * says so on the general line and remounts the well. (The object at the final path is an orphan
 * until U1's cleanup; a `conflict` answer carrying the final path would spare the second drop —
 * recorded for the docs stage.)
 *
 * `readOnly` (moderators — 02 §1.3 auth rule; 03 §2.10): every control renders natively `disabled`
 * under `title="Admin only"`, never hidden, NO `<form>`, no handler (01 INV-18 server-side too).
 *
 * A11y: root `role="region"` named "Add art" / "Edit art"; error lines `role="alert"`; ids
 * prefixed per instance (`useId`). No effects: every state change happens in a handler.
 */
export type ArtFormValues = {
  id: string;
  slug: string;
  title: string;
  kind: ArtKind;
  year: number | null;
  /** A handle, never a real name. */
  credit: string | null;
  downloadable: boolean;
  status: 'draft' | 'published';
  sortOrder: number;
  /** Public URL of the stored image (shown beside "Replace image"). */
  imageUrl: string;
  /** Natural size, server-derived at commit. */
  width: number;
  height: number;
};

export type ArtFormProps = {
  /** The row to edit (`?edit=<id>`); `null` / absent = the create form. */
  art?: ArtFormValues | null;
  /** Moderator view: everything disabled under `title="Admin only"`, no form, no action. */
  readOnly?: boolean;
  className?: string;
};

type SubmitResult =
  Awaited<ReturnType<typeof createArt>> | Awaited<ReturnType<typeof updateArt>> | null;

type Pending = { path: string; filename: string; sizeBytes: number };

type FieldKey = 'slug' | 'title' | 'year' | 'credit' | 'sort_order' | 'path';
/** Field errors by 04 §1.5 key, plus the one general line. */
type FormErrors = Partial<Record<FieldKey | 'line', string>>;

const ADMIN_ONLY_TITLE = 'Admin only';
const SAVED_TOAST = 'Saved.';
const SAVE_LABEL = 'Save';
const PICK_A_PICTURE = 'Add a picture first.';
const DROP_AGAIN_LINE = 'Fix the slug, then drop the picture again.';
/** 04 §1.5 bounds, mirrored as `maxLength` so the field stops where the schema does. */
const TITLE_MAX = 80;
const CREDIT_MAX = 40;
/** The current image, contained in a 48px well (the table's thumb size). */
const THUMB_PX = 48;

const FIELD_KEYS: ReadonlySet<string> = new Set<FieldKey>([
  'slug',
  'title',
  'year',
  'credit',
  'sort_order',
  'path',
]);

/** 04 §1.5 `ART_KIND` as `Select` options (singular words — the filter row's plurals are `kindLabel`). */
const KIND_WORDS: Record<ArtKind, string> = {
  avatar: 'Avatar',
  thumbnail: 'Thumbnail',
  icon: 'Icon',
  render: 'Render',
  other: 'Other',
};
const KIND_OPTIONS: SelectOption[] = ART_KINDS.map((kind) => ({
  value: kind,
  label: KIND_WORDS[kind],
}));

const STATUS_OPTIONS: SelectOption[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Published' },
];

/**
 * The wells type `action` as the wire shape (`Record<string, unknown>` in — the island cannot know
 * the 04 §1.4.5 input unions); the references ARE the server actions (03 C-17 exception 4) and zod
 * re-validates every call server-side (04 SC-02) — the `/admin/projects/[id]` cast.
 */
const createArtAction = createArt as unknown as NonNullable<UploadWellProps['action']>;
const updateArtAction = updateArt as unknown as NonNullable<UploadWellProps['action']>;

function isStatus(value: string): value is 'draft' | 'published' {
  return value === 'draft' || value === 'published';
}

/** A number field's text → the 04 value: blank → `null`, else `Number` (NaN lets the schema speak). */
function numberOrNull(text: string): number | null {
  const trimmed = text.trim();
  return trimmed === '' ? null : Number(trimmed);
}

/**
 * Where an action error lands: each issue on its root field, a keyless one (a `Select` key, a union
 * root issue with path `''`) and every non-validation code on the general line.
 */
function placeErrors(error: ActionError): FormErrors {
  const out: FormErrors = {};
  for (const issue of error.issues ?? []) {
    const root = issue.path.split('.')[0] ?? '';
    if (FIELD_KEYS.has(root)) {
      out[root as FieldKey] ??= issue.message;
    } else {
      out.line ??= issue.message;
    }
  }
  if (error.field !== undefined && FIELD_KEYS.has(error.field)) {
    out[error.field as FieldKey] ??= error.message;
  }
  if (Object.keys(out).length === 0) out.line = error.message;
  return out;
}

export function ArtForm({ art = null, readOnly = false, className }: ArtFormProps) {
  const router = useRouter();
  const { toast } = useToast();
  const editing = art;
  const [title, setTitle] = useState(editing?.title ?? '');
  const [slug, setSlug] = useState(editing?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(editing !== null);
  const [kind, setKind] = useState<ArtKind>(editing?.kind ?? 'avatar');
  const [year, setYear] = useState(
    editing?.year === null || editing === null ? '' : String(editing.year),
  );
  const [credit, setCredit] = useState(editing?.credit ?? '');
  const [downloadable, setDownloadable] = useState(editing?.downloadable ?? false);
  const [status, setStatus] = useState<'draft' | 'published'>(editing?.status ?? 'draft');
  const [sortOrder, setSortOrder] = useState(editing === null ? '0' : String(editing.sortOrder));
  const [pendingUpload, setPendingUpload] = useState<Pending | null>(null);
  /** Bumped to remount the well (`idle`) after a create or a slug conflict — it has no reset prop. */
  const [wellKey, setWellKey] = useState(0);
  const [errors, setErrors] = useState<FormErrors>({});
  const uid = useId();
  const fieldName = (base: string): string => `${uid}-${base}`;
  const adminOnlyId = `${uid}-admin-only`;
  const wellLabelId = `${uid}-image-label`;

  function clearError(key: FieldKey | 'line'): void {
    setErrors((current) => {
      if (current[key] === undefined) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function onTitleChange(value: string): void {
    setTitle(value);
    clearError('title');
    if (!slugTouched) {
      setSlug(slugifyName(value));
      clearError('slug');
    }
  }

  function onSlugChange(value: string): void {
    setSlug(value);
    setSlugTouched(true);
    clearError('slug');
  }

  function onUploaded(pending: Pending | null): void {
    setPendingUpload(pending);
    clearError('path');
  }

  function reset(): void {
    setTitle('');
    setSlug('');
    setSlugTouched(false);
    setKind('avatar');
    setYear('');
    setCredit('');
    setDownloadable(false);
    setStatus('draft');
    setSortOrder('0');
    setPendingUpload(null);
    setWellKey((key) => key + 1);
  }

  const [, submitAction, pending] = useActionState<SubmitResult>(async () => {
    if (editing === null && pendingUpload === null) {
      setErrors({ path: PICK_A_PICTURE });
      return null;
    }
    const metadata = {
      slug,
      title,
      kind,
      year: numberOrNull(year),
      credit: credit.trim() === '' ? null : credit.trim(),
      downloadable,
      status,
      sort_order: sortOrder.trim() === '' ? 0 : Number(sortOrder),
    };
    let result: Exclude<SubmitResult, null>;
    if (editing === null) {
      const input: CreateArtCommitInput = {
        phase: 'commit',
        path: pendingUpload?.path ?? '',
        ...metadata,
      };
      result = await createArt(input);
    } else {
      const input: UpdateArtCommitInput = {
        phase: 'commit',
        id: editing.id,
        ...(pendingUpload !== null ? { path: pendingUpload.path } : {}),
        ...metadata,
      };
      result = await updateArt(input);
    }
    if (result.ok) {
      setErrors({});
      if (editing === null) reset();
      else setPendingUpload(null);
      toast(SAVED_TOAST);
      router.refresh();
      return result;
    }
    const placed = placeErrors(result.error);
    if (editing === null && result.error.code === 'conflict') {
      // The commit moved the object before the slug refused (04 U3); the pending path is gone.
      setPendingUpload(null);
      setWellKey((key) => key + 1);
      placed.line ??= DROP_AGAIN_LINE;
    }
    setErrors(placed);
    return result;
  }, null);

  const busy = pending;
  const classes = className ? `${styles['art-form']} ${className}` : styles['art-form'];
  const regionName = editing === null ? 'Add art' : 'Edit art';

  /** Controlled `Field` input props — frozen while a save is in flight, inert for a moderator. */
  const textInput = (
    value: string,
    onChange: (value: string) => void,
  ): NonNullable<Parameters<typeof Field>[0]['inputProps']> =>
    readOnly
      ? { value, readOnly: true, title: ADMIN_ONLY_TITLE }
      : {
          value,
          readOnly: busy,
          onChange: (event: { currentTarget: { value: string } }) =>
            onChange(event.currentTarget.value),
        };

  const selectField = (
    label: string,
    base: string,
    options: SelectOption[],
    value: string,
    onChange: (value: string) => void,
  ) =>
    readOnly ? (
      <div title={ADMIN_ONLY_TITLE}>
        <Select
          label={label}
          name={fieldName(base)}
          options={options}
          defaultValue={value}
          disabled
        />
      </div>
    ) : (
      <Select
        label={label}
        name={fieldName(base)}
        options={options}
        value={value}
        onChange={onChange}
        disabled={busy}
      />
    );

  const downloadToggle = (
    <Toggle
      name={fieldName('downloadable')}
      checked={downloadable}
      role="switch"
      accent="indigo"
      label="Visitors can download it"
      disabled={readOnly || busy}
      {...(readOnly ? {} : { onChange: setDownloadable })}
    />
  );

  const fields = (
    <div className={styles['art-form-fields']}>
      <Field
        label="Title"
        name={fieldName('title')}
        required
        maxLength={TITLE_MAX}
        counter
        error={errors.title}
        disabled={readOnly}
        inputProps={{ ...textInput(title, onTitleChange), autoComplete: 'off' }}
      />
      <Field
        label="Slug"
        name={fieldName('slug')}
        required
        helper="Lowercase letters, numbers and dashes. 3–64 characters."
        error={errors.slug}
        disabled={readOnly}
        inputProps={{ ...textInput(slug, onSlugChange), autoComplete: 'off', spellCheck: false }}
      />
      {selectField('Kind', 'kind', KIND_OPTIONS, kind, (value) => {
        if (isArtKind(value)) setKind(value);
      })}
      <Field
        label="Year"
        name={fieldName('year')}
        type="number"
        helper="2015 to next year. Leave empty if you'd rather not say."
        error={errors.year}
        disabled={readOnly}
        inputProps={{
          ...textInput(year, (value) => {
            setYear(value);
            clearError('year');
          }),
          inputMode: 'numeric',
          step: 1,
        }}
      />
      <Field
        label="Credit"
        name={fieldName('credit')}
        maxLength={CREDIT_MAX}
        helper="A handle, never a real name."
        error={errors.credit}
        disabled={readOnly}
        inputProps={{
          ...textInput(credit, (value) => {
            setCredit(value);
            clearError('credit');
          }),
          autoComplete: 'off',
        }}
      />
      {selectField('Status', 'status', STATUS_OPTIONS, status, (value) => {
        if (isStatus(value)) setStatus(value);
      })}
      <Field
        label="Sort order"
        name={fieldName('sort-order')}
        type="number"
        helper="Lowest first on /art."
        error={errors.sort_order}
        disabled={readOnly}
        inputProps={{
          ...textInput(sortOrder, (value) => {
            setSortOrder(value);
            clearError('sort_order');
          }),
          inputMode: 'numeric',
          step: 1,
        }}
      />
      <div className={styles['art-form-toggle']}>
        <span>Visitors can download it</span>
        {readOnly ? <span title={ADMIN_ONLY_TITLE}>{downloadToggle}</span> : downloadToggle}
      </div>
      <div className={`${styles['art-form-wide']} ${styles['art-form-well']}`}>
        <span id={wellLabelId} className={styles['art-form-label']}>
          {editing === null ? 'Image' : 'Replace image'}
        </span>
        {editing !== null ? (
          <div className={styles['art-form-current']}>
            <span className={styles['art-form-thumb']}>
              <Image src={editing.imageUrl} alt={editing.title} fill sizes={`${THUMB_PX}px`} />
            </span>
            <span className={styles['art-form-helper']}>
              {`${editing.width}×${editing.height}. Optional — leave it and the current picture stays.`}
            </span>
          </div>
        ) : null}
        <div aria-labelledby={wellLabelId} role="group">
          <UploadWell
            key={wellKey}
            kind="art"
            action={editing === null ? createArtAction : updateArtAction}
            targetIds={editing === null ? {} : { id: editing.id }}
            onUploaded={onUploaded}
            disabled={readOnly || busy}
          />
        </div>
        {errors.path !== undefined ? (
          <p role="alert" className={styles['art-form-error']}>
            {errors.path}
          </p>
        ) : null}
      </div>
    </div>
  );

  if (readOnly) {
    // Moderator arrangement: the same controls, natively disabled under `title="Admin only"`,
    // with NO `<form>` and no handler anywhere — nothing here can start a request.
    return (
      <div className={classes} role="region" aria-label={regionName}>
        {fields}
        <div className={styles['art-form-actions']}>
          <span title={ADMIN_ONLY_TITLE}>
            <Button variant="primary" disabled aria-describedby={adminOnlyId}>
              {SAVE_LABEL}
            </Button>
          </span>
          <span id={adminOnlyId} className="visually-hidden">
            {ADMIN_ONLY_TITLE}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={classes} role="region" aria-label={regionName}>
      {/* `noValidate`: the action answers inline in plain words instead of the browser's bubble. */}
      <form action={submitAction} className={styles['art-form-form']} noValidate>
        {fields}
        <div className={styles['art-form-actions']}>
          <Button variant="primary" type="submit" pending={pending}>
            {SAVE_LABEL}
          </Button>
          {errors.line !== undefined ? (
            <p role="alert" className={styles['art-form-error']}>
              {errors.line}
            </p>
          ) : null}
        </div>
      </form>
    </div>
  );
}
