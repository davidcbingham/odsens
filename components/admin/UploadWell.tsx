'use client';

import { useRouter } from 'next/navigation';
import {
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent as ReactDragEvent,
  type ReactNode,
} from 'react';
import { Button } from '@/components/primitives/Button';
import { Field } from '@/components/primitives/Field';
import { CheckGrid } from '@/components/primitives/CheckGrid';
import { Select } from '@/components/primitives/Select';
import { LOADER_OPTIONS } from '@/lib/format/loader';
import { Toggle } from '@/components/primitives/Toggle';
import type { ActionResult } from '@/lib/actions/result';
import { formatFileSize } from '@/lib/format/size';
import { UPLOAD_KINDS, pngDimensions, sizeLimitMessage, typeMessage } from '@/lib/validation/files';
import styles from './UploadWell.module.css';

/**
 * UploadWell — the admin drop-zone uploader (03 §2.10 `UploadWell`; DESIGN.md §11.1 Upload well;
 * 04 §1.4.5 two-phase contract; ADR-0002 C7/C10/#31). Client island (03 C-16a). States are one
 * `data-state` on the root (03 C-12): `idle` (dashed `--line-strong`, "Drop a file here / or
 * pick one") · `dragover` (`--slab-raised` fill, dashed `--indigo-lift`, "Let go." + the file
 * name when the DataTransfer exposes it — usually not during dragover; omitted silently then) ·
 * `uploading` (solid `--indigo-lift` border, name, percent, flat bar, Cancel; covers begin → PUT →
 * commit, "Checking…" with the bar full while commit runs) · `done` (`--emerald` square `✔`,
 * name + size via `formatFileSize`, Remove — a local reset only; committed rows are managed
 * elsewhere) · `error` (`--danger-wash` fill, `--danger-field` border, `role="alert"` message,
 * Try again).
 *
 * Network (01 INV-09; 03 C-17 exception 4): the phase-discriminated action (`begin`/`commit`)
 * and the XHR PUT of the file bytes to the returned `signed_url` — nothing else. The client
 * pre-check before `begin` (03: size/ext only, no magic-byte read) prints the server's exact
 * copy via `sizeLimitMessage`/`typeMessage`; failed `begin`/`commit` results surface
 * `error.message` verbatim; a failed PUT says "That upload didn't go through. Try again."
 * On commit: `done`, `onCommitted(row)`, then `router.refresh()` so the server-rendered page
 * around the island shows the new row. Limits line under the well at all times, 13px
 * `--mute-dim`, computed from `UPLOAD_KINDS[kind]` (04 U4).
 *
 * The drop zone is a `<label>` wrapping a visually-hidden `<input type=file>` (keyboard: Enter
 * opens the picker natively); progress is `role=progressbar aria-valuenow`; Cancel/Remove/Try
 * again are ghost `Button`s (≥44px targets, 03 C-24). `multiple` re-arms the picker after
 * `done` (Remove doubles as clear). `disabled` renders the well inert — `aria-disabled="true"`,
 * `title="Admin only"`, input disabled, drag handlers inert — never hidden (03 §2.10 admin-only
 * controls rule; 02 §1.3).
 *
 * Two additive modes (S1.7 D18, ADR-0048; 03 C-03 additive props — with neither prop the well
 * behaves exactly as above):
 *   pick mode        `onPick` given: after the client pre-check (and, for `kind="skin"`, the first
 *                    24 bytes read for a 64×64 IHDR — "Skins need to be 64×64.") the well goes
 *                    `done` and hands the `File` to the parent; no `begin`, no PUT, no `commit`
 *                    (`action` is optional here). The parent form sends the bytes itself
 *                    (`SkinForm` → `createSkin` FormData, 04 §1.5).
 *   deferred commit  `onUploaded` given: `begin` → PUT → `done` ("Ready to save.") WITHOUT
 *                    `commit`; the parent's own commit call carries the `path` (`ArtForm` →
 *                    `createArt` / `updateArt` `{phase:'commit', path, …}`). No `router.refresh`
 *                    — nothing is committed yet.
 * In both modes Remove (and a fresh pick, or a failed one) hands the parent `null` first, so a
 * file the well no longer shows is never submitted.
 */
export type UploadWellProps = {
  /** `UPLOAD_KINDS` key (lib/validation/files.ts): accept list + cap + limits copy. */
  kind: 'project-media' | 'project-file' | 'skin' | 'art';
  /**
   * The phase-discriminated server action (or a client wrapper around one) — 04 §1.4.5.
   * Method syntax on purpose (bivariant params): the 03 §2.10 row types this prop as
   * `typeof uploadProjectFile | typeof uploadProjectMedia | …`, so the typed actions must be
   * passable directly; an arrow-syntax property would reject them under strictFunctionTypes.
   * Optional only in pick mode (`onPick`), where the well never calls it.
   */
  action?(input: Record<string, unknown>): Promise<ActionResult<unknown>>;
  /** Spread into both phase inputs (e.g. `{project_id, kind}` / `{project_id, version_number}`). */
  targetIds: Record<string, string>;
  /** Gallery: re-arm after `done`. */
  multiple?: boolean;
  onCommitted?: (row: unknown) => void;
  /**
   * Pick mode (ADR-0048 D18): the checked `File` after the client pre-check, or `null` when the well is
   * cleared (Remove, a failed re-pick). No network in this mode.
   */
  onPick?: (file: File | null) => void;
  /**
   * Deferred-commit mode (ADR-0048 D18): the uploaded object's pending `path` (+ name and size for the
   * parent's own line) after `begin` → PUT, or `null` when cleared. The parent commits it.
   */
  onUploaded?: (pending: { path: string; filename: string; sizeBytes: number } | null) => void;
  /** Moderator view: rendered disabled + `title="Admin only"` (03 §2.10 preamble). */
  disabled?: boolean;
  /**
   * The `title` shown while disabled. Defaults to the moderator rule's "Admin only";
   * `ProjectFileWell` swaps in its not-ready gate copy so an ADMIN with empty version fields
   * never sees the moderator wording (additive optional prop, C-03 precedent).
   */
  disabledTitle?: string;
  className?: string;
};

type UploadWellKind = UploadWellProps['kind'];

type WellState =
  | { name: 'idle' }
  | { name: 'dragover'; filename: string | null }
  | { name: 'uploading'; filename: string; percent: number; checking: boolean }
  | { name: 'done'; filename: string; sizeBytes: number }
  | { name: 'error'; message: string };

const ADMIN_ONLY_TITLE = 'Admin only';
const PUT_FAILED = "That upload didn't go through. Try again.";
/** 04 §1.5 / T-E2E-38 — the verbatim skin size line (the server's `createSkin` says the same). */
const SKIN_SIZE_MESSAGE = 'Skins need to be 64×64.';
/** PNG signature + IHDR length/type + width/height = the first 24 bytes (`pngDimensions`). */
const PNG_HEADER_BYTES = 24;

const KB = 1024;
const MB = 1024 * KB;

function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return null;
  return name.slice(dot + 1).toLowerCase();
}

/** Extension → the declared media MIME (`begin` input + PUT Content-Type; jpg/jpeg → jpeg). */
function mediaMimeFor(ext: string): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    default:
      return null;
  }
}

/** `accept` for the picker: extensions for files, MIME types for media (images, skins, art) — from `UPLOAD_KINDS`. */
function acceptFor(kind: UploadWellKind): string {
  const rule = UPLOAD_KINDS[kind];
  if (kind === 'project-file') return rule.exts.map((ext) => `.${ext}`).join(',');
  const mimes: string[] = [];
  for (const ext of rule.exts) {
    const mime = mediaMimeFor(ext);
    if (mime !== null && !mimes.includes(mime)) mimes.push(mime);
  }
  return mimes.join(',');
}

/**
 * ".jar .zip .mrpack · 100 MB max" / "png · jpg · webp · 5 MB per image" (art: "… 10 MB per image")
 * / "png · 64×64 · 64 KB max" — every number from `UPLOAD_KINDS` (04 U4).
 */
function limitsLine(kind: UploadWellKind): string {
  const rule = UPLOAD_KINDS[kind];
  const cap = Math.round(rule.maxBytes / MB);
  if (kind === 'project-file') {
    return `${rule.exts.map((ext) => `.${ext}`).join(' ')} · ${cap} MB max`;
  }
  if (rule.width !== undefined && rule.height !== undefined) {
    const capKb = Math.round(rule.maxBytes / KB);
    return `${rule.exts.join(' · ')} · ${rule.width}×${rule.height} · ${capKb} KB max`;
  }
  const names = rule.exts.filter((ext) => ext !== 'jpeg');
  return `${names.join(' · ')} · ${cap} MB per image`;
}

/** Pick mode, `kind="skin"`: the IHDR of the first 24 bytes must say 64×64 (no full read). */
async function isSkinSized(
  file: File,
  rule: (typeof UPLOAD_KINDS)[UploadWellKind],
): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, PNG_HEADER_BYTES).arrayBuffer());
  const dims = pngDimensions(head);
  return dims !== null && dims.width === rule.width && dims.height === rule.height;
}

/** The `begin` result's `{path, signed_url}` — shape-checked, no zod in components (03 C-16). */
function readSignedUpload(data: unknown): { path: string; signedUrl: string } | null {
  if (typeof data !== 'object' || data === null) return null;
  const record = data as Record<string, unknown>;
  const path = record['path'];
  const signedUrl = record['signed_url'];
  return typeof path === 'string' && typeof signedUrl === 'string' ? { path, signedUrl } : null;
}

type PutOutcome = 'ok' | 'failed' | 'aborted';

/** XHR PUT to the signed URL — the one place with upload progress events (03 §2.10). */
function putFile(
  url: string,
  file: File,
  contentType: string,
  xhrRef: { current: XMLHttpRequest | null },
  onProgress: (percent: number) => void,
): Promise<PutOutcome> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    const settle = (outcome: PutOutcome): void => {
      xhrRef.current = null;
      resolve(outcome);
    };
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => settle(xhr.status >= 200 && xhr.status < 300 ? 'ok' : 'failed');
    xhr.onerror = () => settle('failed');
    xhr.onabort = () => settle('aborted');
    xhr.send(file);
  });
}

export function UploadWell({
  kind,
  action,
  targetIds,
  multiple = false,
  onCommitted,
  onPick,
  onUploaded,
  disabled = false,
  disabledTitle = ADMIN_ONLY_TITLE,
  className,
}: UploadWellProps) {
  const router = useRouter();
  const [state, setState] = useState<WellState>({ name: 'idle' });
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const cancelRequested = useRef(false);
  const dragDepth = useRef(0);
  const beforeDrag = useRef<WellState | null>(null);

  const classes = className ? `${styles['upload-well']} ${className}` : styles['upload-well'];
  const dragInert = disabled || state.name === 'uploading';
  const showDrop =
    state.name === 'idle' || state.name === 'dragover' || (state.name === 'done' && multiple);
  // ADR-0048 D18: `onPick` wins over `onUploaded`; neither → the two-phase upload as before.
  const mode: 'pick' | 'deferred' | 'commit' =
    onPick !== undefined ? 'pick' : onUploaded !== undefined ? 'deferred' : 'commit';

  /** The new modes: whatever the parent held from before is void the moment a new pick starts. */
  function clearParent(): void {
    if (mode === 'pick') onPick?.(null);
    else if (mode === 'deferred') onUploaded?.(null);
  }

  async function handleFile(file: File): Promise<void> {
    if (disabled) return;
    cancelRequested.current = false;
    clearParent();

    // Client pre-check before `begin` — size/ext only, the server's exact copy (03 §2.10).
    const rule = UPLOAD_KINDS[kind];
    if (file.size > rule.maxBytes) {
      setState({ name: 'error', message: sizeLimitMessage(file.size, kind) });
      return;
    }
    const ext = extensionOf(file.name);
    if (ext === null || !rule.exts.includes(ext)) {
      setState({ name: 'error', message: typeMessage(ext, kind) });
      return;
    }
    const mediaMime = kind === 'project-file' ? null : mediaMimeFor(ext);
    if (kind !== 'project-file' && mediaMime === null) {
      setState({ name: 'error', message: typeMessage(ext, kind) });
      return;
    }

    if (mode === 'pick') {
      // Skins: the IHDR must say 64×64 — the server's exact line (04 §1.5; T-E2E-38).
      if (rule.width !== undefined && !(await isSkinSized(file, rule))) {
        setState({ name: 'error', message: SKIN_SIZE_MESSAGE });
        return;
      }
      setState({ name: 'done', filename: file.name, sizeBytes: file.size });
      onPick?.(file);
      return;
    }

    if (action === undefined) {
      // A two-phase well without an action is a wiring error; say so the way a failed PUT would.
      setState({ name: 'error', message: PUT_FAILED });
      return;
    }

    setState({ name: 'uploading', filename: file.name, percent: 0, checking: false });

    const begin = await action({
      phase: 'begin',
      ...targetIds,
      filename: file.name,
      size_bytes: file.size,
      // MIME is extension-derived for media and omitted for project files (04 §1.4.5).
      ...(mediaMime !== null ? { mime: mediaMime } : {}),
    });
    if (cancelRequested.current) {
      setState({ name: 'idle' });
      return;
    }
    if (!begin.ok) {
      setState({ name: 'error', message: begin.error.message });
      return;
    }
    const signed = readSignedUpload(begin.data);
    if (signed === null) {
      setState({ name: 'error', message: PUT_FAILED });
      return;
    }

    // The `project-files` bucket's allowed_mime_types requires exactly application/zip.
    const contentType = mediaMime ?? 'application/zip';
    const outcome = await putFile(signed.signedUrl, file, contentType, xhrRef, (percent) => {
      setState({ name: 'uploading', filename: file.name, percent, checking: false });
    });
    if (outcome === 'aborted' || cancelRequested.current) {
      setState({ name: 'idle' });
      return;
    }
    if (outcome === 'failed') {
      setState({ name: 'error', message: PUT_FAILED });
      return;
    }

    if (mode === 'deferred') {
      // The parent's own commit call carries the path (ADR-0048 D18); nothing to refresh yet.
      setState({ name: 'done', filename: file.name, sizeBytes: file.size });
      onUploaded?.({ path: signed.path, filename: file.name, sizeBytes: file.size });
      return;
    }

    setState({ name: 'uploading', filename: file.name, percent: 100, checking: true });
    const commit = await action({ phase: 'commit', ...targetIds, path: signed.path });
    if (!commit.ok) {
      setState({ name: 'error', message: commit.error.message });
      return;
    }

    setState({ name: 'done', filename: file.name, sizeBytes: file.size });
    onCommitted?.(commit.data);
    router.refresh();
  }

  function handlePick(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.currentTarget.files?.item(0) ?? null;
    event.currentTarget.value = ''; // re-picking the same file must fire change again
    if (file !== null) void handleFile(file);
  }

  function handleCancel(): void {
    cancelRequested.current = true;
    xhrRef.current?.abort();
  }

  function reset(): void {
    clearParent();
    setState({ name: 'idle' });
  }

  function handleDragEnter(event: ReactDragEvent<HTMLDivElement>): void {
    if (dragInert) return;
    event.preventDefault();
    dragDepth.current += 1;
    if (state.name === 'dragover') return;
    beforeDrag.current = state;
    // items[0].getAsFile() is often unavailable during dragover — omit the name silently then.
    setState({
      name: 'dragover',
      filename: event.dataTransfer.items[0]?.getAsFile()?.name ?? null,
    });
  }

  function handleDragOver(event: ReactDragEvent<HTMLDivElement>): void {
    if (dragInert) return;
    event.preventDefault();
  }

  function handleDragLeave(): void {
    if (dragInert) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0 && state.name === 'dragover') {
      setState(beforeDrag.current ?? { name: 'idle' });
      beforeDrag.current = null;
    }
  }

  function handleDrop(event: ReactDragEvent<HTMLDivElement>): void {
    if (dragInert) return;
    event.preventDefault();
    dragDepth.current = 0;
    const restore = beforeDrag.current;
    beforeDrag.current = null;
    const file = event.dataTransfer.files.item(0);
    if (file === null) {
      setState(restore ?? { name: 'idle' });
      return;
    }
    void handleFile(file);
  }

  function renderDrop(): ReactNode {
    return (
      <label className={styles['upload-well-drop']}>
        <input
          type="file"
          accept={acceptFor(kind)}
          className="visually-hidden"
          disabled={disabled}
          onChange={handlePick}
        />
        {state.name === 'dragover' ? (
          <>
            <span className={styles['upload-well-lead']}>Let go.</span>
            {state.filename !== null ? (
              <span className={styles['upload-well-sub']}>{state.filename}</span>
            ) : null}
          </>
        ) : (
          <>
            <span className={styles['upload-well-lead']}>Drop a file here</span>
            <span className={styles['upload-well-sub']}>or pick one</span>
          </>
        )}
      </label>
    );
  }

  return (
    <div
      className={classes}
      data-state={state.name}
      {...(disabled ? { 'aria-disabled': 'true' as const, title: disabledTitle } : {})}
    >
      <div
        className={styles['upload-well-zone']}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {state.name === 'uploading' ? (
          <div className={styles['upload-well-progress']}>
            <span className={styles['upload-well-name']}>{state.filename}</span>
            <span className={styles['upload-well-percent']}>
              {state.checking ? 'Checking…' : `Uploading… ${state.percent}%`}
            </span>
            <div
              className={styles['upload-well-bar']}
              role="progressbar"
              aria-label="Upload progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={state.percent}
            >
              <div
                className={styles['upload-well-bar-fill']}
                style={{ width: `${state.percent}%` }}
              />
            </div>
            {state.checking ? null : (
              <Button
                variant="ghost"
                arrow={false}
                className={styles['upload-well-action']}
                onClick={handleCancel}
              >
                Cancel
              </Button>
            )}
          </div>
        ) : null}
        {state.name === 'done' ? (
          <div className={styles['upload-well-done']}>
            <span className={styles['upload-well-check']} aria-hidden="true">
              ✔
            </span>
            {mode === 'deferred' ? (
              <span className={styles['upload-well-ready']}>Ready to save.</span>
            ) : (
              <span className="visually-hidden">{mode === 'pick' ? 'Chosen' : 'Uploaded'}</span>
            )}
            <span className={styles['upload-well-name']}>{state.filename}</span>
            <span className={styles['upload-well-size']}>{formatFileSize(state.sizeBytes)}</span>
            <Button
              variant="ghost"
              arrow={false}
              className={styles['upload-well-action']}
              onClick={reset}
            >
              Remove
            </Button>
          </div>
        ) : null}
        {state.name === 'error' ? (
          <div className={styles['upload-well-alert']}>
            <p role="alert" className={styles['upload-well-message']}>
              {state.message}
            </p>
            <Button
              variant="ghost"
              arrow={false}
              className={styles['upload-well-action']}
              onClick={reset}
            >
              Try again
            </Button>
          </div>
        ) : null}
        {showDrop ? renderDrop() : null}
      </div>
      <p className={styles['upload-well-limits']}>{limitsLine(kind)}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// ProjectFileWell — version fields + file well for the admin exclusive editor (S1.3)
// ---------------------------------------------------------------------------------------------

/**
 * ProjectFileWell — the "new version + file" composite for the admin exclusive editor
 * (03 §2.10 `UploadWell` S1.3 first use; 04 §1.4 `uploadProjectFile` contract; ADR-0026).
 * Client island — same file as `UploadWell` because the frozen 03 §1.4 island list is per-file.
 * Controlled `Field`/`Select` version fields above an `UploadWell kind="project-file"`; at
 * `commit` the action wrapper merges `{ version: { version_number, name?, changelog_md?,
 * game_versions, loaders, version_type }, primary }` into the input (`begin` passes through
 * untouched; comma-separated fields are trimmed, empties dropped). Until the version number,
 * ≥1 game version and ≥1 loader are filled, the well renders disabled behind "Fill the version
 * fields first." — the server re-validates everything regardless (01 INV-18). `disabled`
 * (moderator view, 03 §2.10 admin-only controls rule) forwards to every field and the well.
 */
export type ProjectFileWellProps = {
  projectId: string;
  /** `uploadProjectFile` passed from the server page (04 §1.4); method syntax as on `UploadWell`. */
  action(input: Record<string, unknown>): Promise<ActionResult<unknown>>;
  disabled?: boolean;
  className?: string;
};

/** Comma-separated field → trimmed entries, empties dropped. */
function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

/** Controlled-`Field` change handler (input and textarea share the one `inputProps` shape). */
function inputChange(
  setter: (value: string) => void,
): (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void {
  return (event) => setter(event.currentTarget.value);
}

const CHANNEL_OPTIONS = [
  { value: 'release', label: 'Release' },
  { value: 'beta', label: 'Beta' },
  { value: 'alpha', label: 'Alpha' },
];

export function ProjectFileWell({
  projectId,
  action,
  disabled = false,
  className,
}: ProjectFileWellProps) {
  const [versionNumber, setVersionNumber] = useState('');
  const [versionName, setVersionName] = useState('');
  const [gameVersions, setGameVersions] = useState('');
  const [loaders, setLoaders] = useState<string[]>([]);
  const [versionType, setVersionType] = useState<'release' | 'beta' | 'alpha'>('release');
  const [changelog, setChangelog] = useState('');
  const [primaryChecked, setPrimaryChecked] = useState(false);

  const classes = className
    ? `${styles['project-file-well']} ${className}`
    : styles['project-file-well'];

  const ready =
    versionNumber.trim() !== '' && splitCsv(gameVersions).length > 0 && loaders.length > 0;

  // Injects the version payload at `commit`; `begin` passes through untouched (04 §1.4).
  const wrappedAction = (input: Record<string, unknown>): Promise<ActionResult<unknown>> => {
    if (input['phase'] !== 'commit') return action(input);
    return action({
      ...input,
      version: {
        version_number: versionNumber,
        ...(versionName.trim() !== '' ? { name: versionName } : {}),
        ...(changelog.trim() !== '' ? { changelog_md: changelog } : {}),
        game_versions: splitCsv(gameVersions),
        loaders,
        version_type: versionType,
      },
      primary: primaryChecked,
    });
  };

  return (
    <div className={classes}>
      <div className={styles['project-file-well-fields']}>
        <Field
          label="Version number"
          name="version_number"
          required
          helper="Like 1.0.0 — letters, numbers and . - + _"
          disabled={disabled}
          inputProps={{ value: versionNumber, onChange: inputChange(setVersionNumber) }}
        />
        <Field
          label="Name"
          name="version_name"
          maxLength={80}
          disabled={disabled}
          inputProps={{ value: versionName, onChange: inputChange(setVersionName) }}
        />
        <Field
          label="Game versions"
          name="version_game_versions"
          helper="Comma-separated, like 1.21, 1.21.1"
          disabled={disabled}
          inputProps={{ value: gameVersions, onChange: inputChange(setGameVersions) }}
        />
        <CheckGrid
          label="Loaders"
          name="version_loaders"
          options={LOADER_OPTIONS}
          value={loaders}
          onChange={setLoaders}
          helper="Tick every loader this file works on."
          disabled={disabled}
        />
        <Select
          label="Channel"
          name="version_type"
          options={CHANNEL_OPTIONS}
          value={versionType}
          onChange={(value) => {
            if (value === 'release' || value === 'beta' || value === 'alpha') {
              setVersionType(value);
            }
          }}
          disabled={disabled}
        />
        <Field
          label="Changelog"
          name="version_changelog"
          type="textarea"
          disabled={disabled}
          inputProps={{ value: changelog, onChange: inputChange(setChangelog) }}
        />
        <div className={styles['project-file-well-primary']}>
          <span>Primary file</span>
          <Toggle
            name="version_is_primary"
            checked={primaryChecked}
            onChange={setPrimaryChecked}
            role="switch"
            accent="indigo"
            label="Primary file"
            disabled={disabled}
          />
        </div>
      </div>
      {ready ? null : (
        <p className={styles['project-file-well-gate']}>Fill the version fields first.</p>
      )}
      <UploadWell
        kind="project-file"
        action={wrappedAction}
        targetIds={{ project_id: projectId, version_number: versionNumber }}
        disabled={disabled || !ready}
        disabledTitle={disabled ? ADMIN_ONLY_TITLE : 'Fill the version fields first.'}
      />
    </div>
  );
}
