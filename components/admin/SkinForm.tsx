'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useActionState, useId, useState } from 'react';
import { UploadWell } from '@/components/admin/UploadWell';
import { useToast } from '@/components/layout/Toast';
import { Button } from '@/components/primitives/Button';
import { Field } from '@/components/primitives/Field';
import { Select, type SelectOption } from '@/components/primitives/Select';
import { Toggle } from '@/components/primitives/Toggle';
import type { ActionError } from '@/lib/actions/result';
import { createSkin, updateSkin } from '@/lib/actions/skins';
import { slugifyName, type SkinModel } from '@/lib/skins';
import styles from './SkinForm.module.css';

/**
 * SkinForm — the "Add a skin" / "Edit skin" island of `/admin/skins` (02 §1.3 `/admin/skins` row;
 * 03 §2.10 admin-only controls rule; 04 §1.5 `createSkin` / `updateSkin`; 00 S1.7 AC1 / AC9;
 * DESIGN.md §5 Admin field, §6 #9, §11.1 Upload well / Square toggle; ADR-0002 C7; ADR-0048 D18 /
 * ADR-0048 D19 / D27). The page's one client file for the add / edit flow: it owns every field, the texture
 * pick and the save call — the `MentionPreview` recipe (03 C-07: no other island exists to be the
 * admin form, and ADR-0024 page glue may only `redirect()`).
 *
 * Fields (ADR-0048 D19 / D27): Name (≤ 60, counter) · Slug (helper; pre-filled from the name on create through
 * `slugifyName` until the admin edits it by hand — the server's `slugSchema` still decides) ·
 * Description (`textarea`, ≤ 5000, "Markdown works.") · Model (`Select` Classic / Slim) · Only on
 * odsens (`Toggle` switch, indigo) · Status (`Select` Draft / Published) · Sort order (number) ·
 * Texture (`UploadWell kind="skin"` in PICK mode — the well checks size / type / the 64×64 IHDR and
 * hands the `File` over; nothing leaves the browser until Save). On edit the well is optional and
 * labelled "Replace texture", next to the current texture at half scale (pixelated — DESIGN.md §4).
 *
 * Save builds ONE `FormData` (04 §1.5 — the texture travels inline, SC-18) and calls `createSkin`
 * or `updateSkin({ id, …every field })`: an edit sends every key, so an emptied Description clears
 * (`''` → `null`) and an unticked switch turns `is_exclusive` off (an ABSENT checkbox would keep the
 * stored value). ok → `Toast` "Saved." + `router.refresh()` (the page re-reads the table); a create
 * also resets the form (the well remounts to `idle`). `bust_rendered: false` → the line "Saved. The
 * 3D preview will render later — the page shows a live one meanwhile." (`role="status"`). While a
 * texture is being saved: "Rendering the 3D preview…". Failure → `issues` land on their own field
 * (dotted paths on the root key; `conflict` on `slug`), anything without a field (a `Select` has no
 * error surface, a union root issue with path `''`, rate limits) in ONE `<p role="alert">` by the
 * button — never a toast (03 C-30).
 *
 * `readOnly` (moderators — 02 §1.3 auth rule; 03 §2.10): every control renders natively `disabled`
 * under `title="Admin only"`, never hidden, and the markup carries NO `<form>` and no handler, so
 * nothing can reach an action (the actions refuse a moderator regardless — 01 INV-18).
 *
 * A11y: root `role="region"` named "Add a skin" / "Edit skin"; error lines `role="alert"`; the
 * status lines `role="status"`; `Field` / `Select` ids derive from `name`, so every name is
 * prefixed per instance (`useId`) — several specimens share `/dev/components`. Hook-free effects:
 * every state change happens in a handler (react-hooks compiler rules).
 */
export type SkinFormValues = {
  id: string;
  slug: string;
  name: string;
  /** The Markdown source; `null` = no description. */
  descriptionMd: string | null;
  model: SkinModel;
  exclusive: boolean;
  status: 'draft' | 'published';
  sortOrder: number;
  /** Public URL of the stored 64×64 texture (shown beside "Replace texture"). */
  textureUrl: string;
  bustUrl: string | null;
};

export type SkinFormProps = {
  /** The row to edit (`?edit=<id>`); `null` / absent = the create form. */
  skin?: SkinFormValues | null;
  /** Moderator view: everything disabled under `title="Admin only"`, no form, no action. */
  readOnly?: boolean;
  className?: string;
};

type SubmitResult =
  Awaited<ReturnType<typeof createSkin>> | Awaited<ReturnType<typeof updateSkin>> | null;

/** Field errors by 04 §1.5 key, plus the one general line. */
type FormErrors = Partial<Record<FieldKey | 'line', string>>;
type FieldKey = 'slug' | 'name' | 'description_md' | 'sort_order' | 'texture';

const ADMIN_ONLY_TITLE = 'Admin only';
const SAVED_TOAST = 'Saved.';
const SAVE_LABEL = 'Save';
const PICK_A_TEXTURE = 'Drop the 64×64 PNG in first.';
const RENDERING_LINE = 'Rendering the 3D preview…';
const RENDER_LATER_LINE =
  'Saved. The 3D preview will render later — the page shows a live one meanwhile.';
/** 04 §1.5 bounds, mirrored as `maxLength` so the field stops where the schema does. */
const NAME_MAX = 60;
const DESCRIPTION_MAX = 5000;
/** The `skins` texture, drawn at half scale (64 → 32, an integer step — DESIGN.md §4) in a 40px well. */
const THUMB_PX = 32;

const FIELD_KEYS: ReadonlySet<string> = new Set<FieldKey>([
  'slug',
  'name',
  'description_md',
  'sort_order',
  'texture',
]);

const MODEL_OPTIONS: SelectOption[] = [
  { value: 'classic', label: 'Classic' },
  { value: 'slim', label: 'Slim' },
];

const STATUS_OPTIONS: SelectOption[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Published' },
];

function isModel(value: string): value is SkinModel {
  return value === 'classic' || value === 'slim';
}

function isStatus(value: string): value is 'draft' | 'published' {
  return value === 'draft' || value === 'published';
}

/**
 * Where an action error lands: each issue on its root field (`loaders.0` → `loaders`), a keyless
 * one (a union root issue, a `Select` key) and every non-validation code on the general line.
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

export function SkinForm({ skin = null, readOnly = false, className }: SkinFormProps) {
  const router = useRouter();
  const { toast } = useToast();
  const editing = skin;
  const [name, setName] = useState(editing?.name ?? '');
  const [slug, setSlug] = useState(editing?.slug ?? '');
  /** Once the admin types in the slug, the name stops pre-filling it (edit: always by hand). */
  const [slugTouched, setSlugTouched] = useState(editing !== null);
  const [description, setDescription] = useState(editing?.descriptionMd ?? '');
  const [model, setModel] = useState<SkinModel>(editing?.model ?? 'classic');
  const [exclusive, setExclusive] = useState(editing?.exclusive ?? false);
  const [status, setStatus] = useState<'draft' | 'published'>(editing?.status ?? 'draft');
  const [sortOrder, setSortOrder] = useState(editing === null ? '0' : String(editing.sortOrder));
  const [texture, setTexture] = useState<File | null>(null);
  /** Bumped to remount the well (`idle`) after a create — it has no reset prop. */
  const [wellKey, setWellKey] = useState(0);
  const [errors, setErrors] = useState<FormErrors>({});
  const [note, setNote] = useState<string | null>(null);
  const uid = useId();
  const fieldName = (base: string): string => `${uid}-${base}`;
  const adminOnlyId = `${uid}-admin-only`;
  const wellLabelId = `${uid}-texture-label`;

  function clearError(key: FieldKey | 'line'): void {
    setErrors((current) => {
      if (current[key] === undefined) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function onNameChange(value: string): void {
    setName(value);
    clearError('name');
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

  function onPick(file: File | null): void {
    setTexture(file);
    clearError('texture');
  }

  function reset(): void {
    setName('');
    setSlug('');
    setSlugTouched(false);
    setDescription('');
    setModel('classic');
    setExclusive(false);
    setStatus('draft');
    setSortOrder('0');
    setTexture(null);
    setWellKey((key) => key + 1);
  }

  const [, submitAction, pending] = useActionState<SubmitResult>(async () => {
    setNote(null);
    if (editing === null && texture === null) {
      setErrors({ texture: PICK_A_TEXTURE });
      return null;
    }
    // 04 §1.5: `FormData` in, strings + the `File`; the schema coerces the numbers / booleans.
    const form = new FormData();
    if (editing !== null) form.set('id', editing.id);
    form.set('slug', slug);
    form.set('name', name);
    form.set('description_md', description);
    form.set('model', model);
    form.set('is_exclusive', exclusive ? 'true' : 'false');
    form.set('status', status);
    form.set('sort_order', sortOrder);
    if (texture !== null) form.set('texture', texture, texture.name);

    const result = editing === null ? await createSkin(form) : await updateSkin(form);
    if (result.ok) {
      const rendered = 'bust_rendered' in result.data ? result.data.bust_rendered : true;
      setErrors({});
      if (editing === null) reset();
      else setTexture(null);
      if (!rendered) setNote(RENDER_LATER_LINE);
      toast(SAVED_TOAST);
      router.refresh();
      return result;
    }
    setErrors(placeErrors(result.error));
    return result;
  }, null);

  const busy = pending;
  const classes = className ? `${styles['skin-form']} ${className}` : styles['skin-form'];
  const regionName = editing === null ? 'Add a skin' : 'Edit skin';

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

  const exclusiveToggle = (
    <Toggle
      name={fieldName('exclusive')}
      checked={exclusive}
      role="switch"
      accent="indigo"
      label="Only on odsens"
      disabled={readOnly || busy}
      {...(readOnly ? {} : { onChange: setExclusive })}
    />
  );

  const fields = (
    <div className={styles['skin-form-fields']}>
      <Field
        label="Name"
        name={fieldName('name')}
        required
        maxLength={NAME_MAX}
        counter
        error={errors.name}
        disabled={readOnly}
        inputProps={{ ...textInput(name, onNameChange), autoComplete: 'off' }}
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
      <div className={styles['skin-form-wide']}>
        <Field
          label="Description"
          name={fieldName('description')}
          type="textarea"
          maxLength={DESCRIPTION_MAX}
          helper="Markdown works."
          error={errors.description_md}
          disabled={readOnly}
          inputProps={{
            ...textInput(description, (value) => {
              setDescription(value);
              clearError('description_md');
            }),
            rows: 3,
          }}
        />
      </div>
      {selectField('Model', 'model', MODEL_OPTIONS, model, (value) => {
        if (isModel(value)) setModel(value);
      })}
      {selectField('Status', 'status', STATUS_OPTIONS, status, (value) => {
        if (isStatus(value)) setStatus(value);
      })}
      <Field
        label="Sort order"
        name={fieldName('sort-order')}
        type="number"
        helper="Lowest first on /skins."
        error={errors.sort_order}
        disabled={readOnly}
        inputProps={{
          ...textInput(sortOrder, (value) => {
            setSortOrder(value);
            clearError('sort_order');
          }),
          inputMode: 'numeric',
          min: 0,
          step: 1,
        }}
      />
      <div className={styles['skin-form-toggle']}>
        <span>Only on odsens</span>
        {readOnly ? <span title={ADMIN_ONLY_TITLE}>{exclusiveToggle}</span> : exclusiveToggle}
      </div>
      <div className={`${styles['skin-form-wide']} ${styles['skin-form-well']}`}>
        <span id={wellLabelId} className={styles['skin-form-label']}>
          {editing === null ? 'Texture' : 'Replace texture'}
        </span>
        {editing !== null ? (
          <div className={styles['skin-form-current']}>
            <span className={styles['skin-form-thumb']}>
              <Image
                src={editing.textureUrl}
                alt={`${editing.name} texture`}
                width={THUMB_PX}
                height={THUMB_PX}
                unoptimized
              />
            </span>
            <span className={styles['skin-form-helper']}>
              Optional. Leave it and the current texture stays.
            </span>
          </div>
        ) : null}
        <div aria-labelledby={wellLabelId} role="group">
          <UploadWell
            key={wellKey}
            kind="skin"
            targetIds={{}}
            onPick={onPick}
            disabled={readOnly || busy}
          />
        </div>
        {errors.texture !== undefined ? (
          <p role="alert" className={styles['skin-form-error']}>
            {errors.texture}
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
        <div className={styles['skin-form-actions']}>
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
      <form action={submitAction} className={styles['skin-form-form']} noValidate>
        {fields}
        <div className={styles['skin-form-actions']}>
          <Button variant="primary" type="submit" pending={pending}>
            {SAVE_LABEL}
          </Button>
          {pending && texture !== null ? (
            <p role="status" className={styles['skin-form-status']}>
              {RENDERING_LINE}
            </p>
          ) : null}
          {!pending && note !== null ? (
            <p role="status" className={styles['skin-form-status']}>
              {note}
            </p>
          ) : null}
          {errors.line !== undefined ? (
            <p role="alert" className={styles['skin-form-error']}>
              {errors.line}
            </p>
          ) : null}
        </div>
      </form>
    </div>
  );
}
