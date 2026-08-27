import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import styles from './Field.module.css';

/**
 * Field — the admin input (DESIGN.md §5 Admin field; 03 §2.2 `Field`; first use S1.2
 * `/admin/projects` curate form — 02 §1.3). Shared (no directive): rendered by server admin
 * pages, becomes client only under a client parent. Label 13px 700 `--chalk` (O-21,
 * ADR-0002 #60); input on `--slab-sunk` with 2px `--line-soft` and 3px radius; helper 12px
 * `--mute-dim`. Focus: `--indigo-lift` border (+ the gold ring, moved to the well — 03 C-25).
 * Invalid: `--danger-field` border, helper replaced by the error in plain words (`role="alert"`,
 * `aria-invalid`, `aria-describedby` → the error id).
 *
 * `counter` shows `n / max` computed from `defaultValue` / `inputProps.value` at render — it is
 * live only when a client parent controls the value through `inputProps` (this file stays
 * hook-free so server pages can render it).
 *
 * Ids derive from `name` (`field-<name>`): stable without `useId` (a hook — not available to
 * server parents). One `name` per form, as native forms already require.
 */
export type FieldProps = {
  label: string;
  name: string;
  type?: 'text' | 'number' | 'url' | 'email' | 'textarea' | 'password';
  defaultValue?: string | number;
  helper?: string;
  error?: string;
  /** Rendered inside the well before the input (e.g. a fixed URL prefix). */
  prefix?: ReactNode;
  required?: boolean;
  maxLength?: number;
  counter?: boolean;
  disabled?: boolean;
  inputProps?: InputHTMLAttributes<HTMLInputElement> & TextareaHTMLAttributes<HTMLTextAreaElement>;
};

export function Field({
  label,
  name,
  type = 'text',
  defaultValue,
  helper,
  error,
  prefix,
  required,
  maxLength,
  counter = false,
  disabled,
  inputProps,
}: FieldProps) {
  const id = `field-${name}`;
  const helperId = `${id}-helper`;
  const errorId = `${id}-error`;
  const invalid = typeof error === 'string' && error.length > 0;
  const describedBy = invalid ? errorId : helper ? helperId : undefined;
  // `defaultValue` must not accompany a controlled `inputProps.value` (React would throw).
  const controlled = inputProps !== undefined && 'value' in inputProps;
  const count = String(inputProps?.value ?? defaultValue ?? '').length;
  const showCounter = counter && typeof maxLength === 'number';

  const shared = {
    id,
    name,
    required,
    maxLength,
    disabled,
    'aria-invalid': invalid ? ('true' as const) : undefined,
    'aria-describedby': describedBy,
    ...(controlled ? {} : { defaultValue }),
    ...inputProps,
    className: inputProps?.className
      ? `${styles['field-input']} ${inputProps.className}`
      : styles['field-input'],
  };

  return (
    <div className={styles.field}>
      <label className={styles['field-label']} htmlFor={id}>
        {label}
      </label>
      <div className={styles['field-well']}>
        {prefix ? <span className={styles['field-prefix']}>{prefix}</span> : null}
        {type === 'textarea' ? (
          <textarea rows={inputProps?.rows ?? 4} {...shared} />
        ) : (
          <input type={type} {...shared} />
        )}
      </div>
      {invalid || helper || showCounter ? (
        <div className={styles['field-foot']}>
          {invalid ? (
            <p id={errorId} role="alert" className={styles['field-error']}>
              {error}
            </p>
          ) : helper ? (
            <p id={helperId} className={styles['field-helper']}>
              {helper}
            </p>
          ) : null}
          {showCounter ? (
            <span className={styles['field-counter']}>{`${count} / ${maxLength}`}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
