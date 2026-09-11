import { Icon } from '@/components/primitives/Icon';
import styles from './CheckGrid.module.css';

/**
 * CheckGrid — a fixed-list multi-choice as a grid of square checkboxes (ADR-0035 D4; DESIGN.md
 * §11.1 Square toggle look, §5 Admin field label/helper/error recipe; 03 §2.2 `CheckGrid`).
 * Shared (no directive): a `<fieldset>` whose `<legend>` is the field label, one visually-hidden
 * native checkbox per option with the same `name`, so a server `<form action>` reads
 * `formData.getAll(name)`; with `value` + `onChange` the boxes are controlled (the client-owned
 * `UploadWell` version form). First use: Loaders on the admin project forms (typed comma lists were
 * error-prone for a fixed set — Oliver, 2026-09-11). Disabled renders every box at 45 % opacity
 * (03 §2.10 moderators see admin controls disabled, never hidden). Invalid: `--danger-field`
 * border on the boxes + the plain-words error line, `aria-invalid` on each input.
 */
export type CheckGridOption = { value: string; label: string };

export type CheckGridProps = {
  label: string;
  name: string;
  options: readonly CheckGridOption[];
  /** Checked values (uncontrolled — the form owns the state). */
  defaultValue?: readonly string[];
  /** Controlled: the checked values; pair with `onChange`. */
  value?: readonly string[];
  onChange?: (values: string[]) => void;
  helper?: string;
  error?: string;
  disabled?: boolean;
};

export function CheckGrid({
  label,
  name,
  options,
  defaultValue = [],
  value,
  onChange,
  helper,
  error,
  disabled = false,
}: CheckGridProps) {
  const controlled = value !== undefined && onChange !== undefined;
  const id = `checkgrid-${name}`;
  const helperId = helper ? `${id}-helper` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, helperId].filter(Boolean).join(' ') || undefined;
  const checked = new Set(controlled ? value : defaultValue);
  const toggle = (option: string, on: boolean) => {
    if (!controlled) return;
    const next = new Set(value);
    if (on) next.add(option);
    else next.delete(option);
    onChange(options.map((o) => o.value).filter((v) => next.has(v)));
  };
  return (
    <fieldset
      className={styles['check-grid']}
      disabled={disabled}
      aria-describedby={describedBy}
      {...(error ? { 'data-invalid': '' } : {})}
    >
      <legend className={styles['check-grid-legend']}>{label}</legend>
      <div className={styles['check-grid-boxes']}>
        {options.map((option) => (
          <label key={option.value} className={styles['check-grid-item']}>
            <input
              type="checkbox"
              name={name}
              value={option.value}
              {...(controlled
                ? {
                    checked: checked.has(option.value),
                    onChange: (event) => toggle(option.value, event.currentTarget.checked),
                  }
                : { defaultChecked: checked.has(option.value) })}
              className={`visually-hidden ${styles['check-grid-input']}`}
              aria-invalid={error ? true : undefined}
            />
            <span className={styles['check-grid-square']} aria-hidden="true">
              <Icon name="check" size={16} className={styles['check-grid-check']} />
            </span>
            <span className={styles['check-grid-word']}>{option.label}</span>
          </label>
        ))}
      </div>
      {error ? (
        <p id={errorId} className={styles['check-grid-error']}>
          {error}
        </p>
      ) : null}
      {helper ? (
        <p id={helperId} className={styles['check-grid-helper']}>
          {helper}
        </p>
      ) : null}
    </fieldset>
  );
}
