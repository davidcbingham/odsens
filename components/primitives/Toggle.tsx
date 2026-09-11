'use client';

import { Icon } from '@/components/primitives/Icon';
import styles from './Toggle.module.css';

/**
 * Toggle — the square toggle, not a switch (DESIGN.md §11.1 Square toggle; 03 §2.2 `Toggle`;
 * first use S1.2 `/admin/projects` feature/hide switches — 02 §1.3). Client island (03 C-16a):
 * controlled `checked` + `onChange`. A 22px square (`--size-toggle`): off = `--slab-sunk` fill
 * with `--line-strong` border; on = filled (`--emerald` for notification switches,
 * `--indigo-lift` for mode & selection — the `accent` prop) with a 2px `✔`. The word ON / OFF
 * (Silkscreen 11px) always sits next to it — state never rides on colour (03 C-26).
 *
 * Markup: `<label>` wrapping a visually-hidden native `<input type="checkbox|radio">` (Space
 * toggles; radios arrow-key natively) + the square + the word. `aria-checked` is mirrored on the
 * input; the naming text is `aria-label={label}` so the stateful ON/OFF word (aria-hidden) never
 * leaks into the accessible name. Without `onChange` the input renders read-only (fixtures,
 * display-only rows). Disabled: 45% opacity ("COMING LATER" rows; §2.10 admin-only controls
 * render disabled for moderators, never hidden).
 */
export type ToggleProps = {
  name: string;
  checked: boolean;
  onChange?: (value: boolean) => void;
  role: 'switch' | 'radio';
  accent: 'emerald' | 'indigo';
  /** Names the thing being toggled (screen-reader text; callers show their own visible text). */
  label: string;
  value?: string;
  disabled?: boolean;
  /** Additive (03 C-03): id of the line that explains the consequence — `aria-describedby` on the input. */
  describedBy?: string;
};

const ON_WORD = 'ON';
const OFF_WORD = 'OFF';

export function Toggle({
  name,
  checked,
  onChange,
  role,
  accent,
  label,
  value,
  disabled = false,
  describedBy,
}: ToggleProps) {
  return (
    <label className={styles.toggle} data-variant={accent}>
      <input
        type={role === 'radio' ? 'radio' : 'checkbox'}
        role={role === 'switch' ? 'switch' : undefined}
        className={`visually-hidden ${styles['toggle-input']}`}
        name={name}
        value={value}
        checked={checked}
        aria-checked={checked}
        aria-label={label}
        aria-describedby={describedBy}
        disabled={disabled}
        {...(onChange
          ? { onChange: (event) => onChange(event.currentTarget.checked) }
          : { readOnly: true })}
      />
      <span className={styles['toggle-square']} aria-hidden="true">
        {checked ? <Icon name="check" size={16} className={styles['toggle-check']} /> : null}
      </span>
      <span className={styles['toggle-word']} aria-hidden="true">
        {checked ? ON_WORD : OFF_WORD}
      </span>
    </label>
  );
}
