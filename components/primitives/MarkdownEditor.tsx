'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '@/components/primitives/Icon';
import { PixelLabel } from '@/components/primitives/PixelLabel';
import { Toggle } from '@/components/primitives/Toggle';
import { renderMarkdown, type MarkdownVariant } from '@/lib/markdown';
import {
  MARKDOWN_COMMANDS,
  applyMarkdownCommand,
  commandTitle,
  type MarkdownCommand,
} from '@/lib/markdown/edit';
import mdStyles from './Markdown.module.css';
import styles from './MarkdownEditor.module.css';

/**
 * MarkdownEditor — the admin Markdown field with a formatting toolbar and a Preview
 * (DESIGN.md v1.10 §11.3 #20 "Admin — Project editor v2"; 03 §2.10 `MarkdownEditor` row;
 * ADR-0039 D4/D5; ADR-0040 D1/D2/D5; 05 T-E2E-56/57). Client island (03 C-16a): a
 * `Field`-shaped control (same ids `field-<name>` / `-helper` / `-error`, label, well, helper,
 * error recipe as `components/primitives/Field.tsx`) around a CONTROLLED `<textarea>` that posts
 * under `name` with the parent `<form>` — the stored value is plain Markdown; nothing else is
 * ever written into it.
 *
 * Toolbar (`role="toolbar"`, APG roving tabindex: ←/→ Home/End) renders one ghost button per
 * `MARKDOWN_COMMANDS` entry, grouped by `group` (a 2px `--line` separator between groups — never
 * leading a wrapped row, see the CSS module); each runs the pure `applyMarkdownCommand()` on the
 * textarea's selection, sets the value and restores focus + the returned selection after commit.
 * Ctrl/Cmd+B / +I on the textarea (no Shift / Alt — browser chords pass through) run the commands
 * carrying that `shortcut`. React commits the new value by property assignment, which fires no
 * native event, so after each command the textarea dispatches a bubbling `input` — the way the
 * page's dirty tracker (`EditorSections`, ADR-0039 D3; ADR-0040 D9) learns of a toolbar edit.
 *
 * Preview (`Toggle` switch, right-aligned): the textarea takes the `hidden` attribute (still
 * posts), the toolbar buttons disable, and the pane renders `renderMarkdown()` inside the public
 * `Markdown` CSS module — same renderer, same sanitize schema, so admin preview = public page
 * (ADR-0039 D4; `lib/markdown.ts` is client-safe since ADR-0040 D1). Disabled (moderators):
 * textarea + toolbar disabled ("Admin only"), the Preview toggle stays usable (ADR-0040 D5).
 * The caller wraps the whole control in its `adminOnly()` span.
 */
export type MarkdownEditorProps = {
  label: string;
  name: string;
  defaultValue?: string;
  helper?: string;
  error?: string;
  maxLength?: number;
  disabled?: boolean;
  variant: MarkdownVariant;
};

const ROWS = 12;
const ADMIN_ONLY = 'Admin only';
const PREVIEW_WORD = 'Preview';
const PREVIEW_EYEBROW = 'PREVIEW';
const PREVIEW_EMPTY = 'Nothing to preview yet.';
const ICON_SIZE = 18;

type Selection = { start: number; end: number; seq: number };

type ToolbarEntry = { command: (typeof MARKDOWN_COMMANDS)[number]; index: number };

/** The toolbar's commands in order, split by `group`; `index` keeps the roving-focus slot. */
const TOOLBAR_GROUPS: ToolbarEntry[][] = MARKDOWN_COMMANDS.reduce<ToolbarEntry[][]>(
  (groups, command, index) => {
    const last = groups[groups.length - 1];
    if (last !== undefined && last[0]?.command.group === command.group) {
      last.push({ command, index });
    } else {
      groups.push([{ command, index }]);
    }
    return groups;
  },
  [],
);

/** The command bound to a Ctrl/Cmd shortcut key, from the single toolbar source. */
function shortcutCommand(key: string): MarkdownCommand | undefined {
  const lower = key.toLowerCase();
  return MARKDOWN_COMMANDS.find((command) => command.shortcut === lower)?.id;
}

export function MarkdownEditor({
  label,
  name,
  defaultValue = '',
  helper,
  error,
  maxLength,
  disabled = false,
  variant,
}: MarkdownEditorProps) {
  const id = `field-${name}`;
  const helperId = `${id}-helper`;
  const errorId = `${id}-error`;
  const invalid = typeof error === 'string' && error.length > 0;
  const describedBy = invalid ? errorId : helper ? helperId : undefined;

  const [value, setValue] = useState(defaultValue);
  const [preview, setPreview] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const [selection, setSelection] = useState<Selection | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Selection restore after each command: runs after the new value is committed to the DOM. The
  // committed value then announces itself as a native `input` (bubbles to the form and the
  // section's delegated dirty listeners — a script-set value fires none on its own). React's
  // value tracker already holds it, so its own `onChange` does not re-fire.
  useEffect(() => {
    if (selection === null) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(selection.start, selection.end);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }, [selection]);

  const toolbarLocked = disabled || preview;

  function run(command: MarkdownCommand): void {
    const textarea = textareaRef.current;
    if (!textarea || toolbarLocked) return;
    const edit = applyMarkdownCommand(
      value,
      textarea.selectionStart,
      textarea.selectionEnd,
      command,
    );
    setValue(edit.value);
    setSelection((previous) => ({
      start: edit.selectionStart,
      end: edit.selectionEnd,
      seq: (previous?.seq ?? 0) + 1,
    }));
  }

  // Plain Ctrl/Cmd+B / +I only: a Shift or Alt chord is the browser's (bookmarks bar, devtools).
  function onTextareaKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
    const command = shortcutCommand(event.key);
    if (command === undefined) return;
    event.preventDefault();
    run(command);
  }

  // APG toolbar: one tab stop; ←/→ move between buttons, Home/End jump to the ends.
  function onToolbarKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const count = MARKDOWN_COMMANDS.length;
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = (focusIndex + 1) % count;
        break;
      case 'ArrowLeft':
        next = (focusIndex - 1 + count) % count;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = count - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    setFocusIndex(next);
    buttonRefs.current[next]?.focus();
  }

  const showPreviewText = value.trim() !== '';

  return (
    <div className={styles['mde']}>
      <label className={styles['mde-label']} htmlFor={id}>
        {label}
      </label>
      <div className={styles['mde-well']}>
        <div className={styles['mde-strip']}>
          <div
            role="toolbar"
            aria-label="Formatting"
            className={styles['mde-toolbar']}
            onKeyDown={onToolbarKeyDown}
          >
            {TOOLBAR_GROUPS.map((group) => (
              <span key={group[0]?.command.group} className={styles['mde-group']}>
                {group.map(({ command, index }) => (
                  <button
                    key={command.id}
                    type="button"
                    ref={(node) => {
                      buttonRefs.current[index] = node;
                    }}
                    className={styles['mde-button']}
                    aria-label={command.label}
                    title={disabled ? ADMIN_ONLY : commandTitle(command.id)}
                    disabled={toolbarLocked}
                    tabIndex={index === focusIndex ? 0 : -1}
                    onFocus={() => setFocusIndex(index)}
                    onClick={() => run(command.id)}
                  >
                    {command.glyph.kind === 'icon' ? (
                      <Icon name={command.glyph.name} size={ICON_SIZE} />
                    ) : (
                      <span className={styles['mde-glyph']} aria-hidden="true">
                        {command.glyph.text}
                      </span>
                    )}
                  </button>
                ))}
              </span>
            ))}
          </div>
          <div className={styles['mde-preview-control']}>
            <span className={styles['mde-preview-word']}>{PREVIEW_WORD}</span>
            <Toggle
              name={`${name}_preview`}
              checked={preview}
              onChange={setPreview}
              role="switch"
              accent="indigo"
              label={PREVIEW_WORD}
            />
          </div>
        </div>
        <textarea
          ref={textareaRef}
          id={id}
          name={name}
          className={styles['mde-textarea']}
          rows={ROWS}
          value={value}
          maxLength={maxLength}
          disabled={disabled}
          hidden={preview}
          title={disabled ? ADMIN_ONLY : undefined}
          aria-invalid={invalid ? 'true' : undefined}
          aria-describedby={describedBy}
          onChange={(event) => setValue(event.currentTarget.value)}
          onKeyDown={onTextareaKeyDown}
        />
        {preview ? (
          <div data-testid="markdown-preview" aria-live="polite" className={styles['mde-preview']}>
            <PixelLabel size={11} tone="mute-dim">
              {PREVIEW_EYEBROW}
            </PixelLabel>
            {showPreviewText ? (
              <div className={mdStyles.markdown} data-variant={variant}>
                {renderMarkdown(value, variant)}
              </div>
            ) : (
              <p className={styles['mde-preview-empty']}>{PREVIEW_EMPTY}</p>
            )}
          </div>
        ) : null}
      </div>
      {invalid || helper ? (
        <div className={styles['mde-foot']}>
          {invalid ? (
            <p id={errorId} role="alert" className={styles['mde-error']}>
              {error}
            </p>
          ) : (
            <p id={helperId} className={styles['mde-helper']}>
              {helper}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
