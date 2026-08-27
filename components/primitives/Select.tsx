import { Icon } from '@/components/primitives/Icon';
import styles from './Select.module.css';

/**
 * Select — native `<select>` on the admin-field recipe (DESIGN.md §5 Filter bar "3px-radius
 * selects" · §5 Admin field; 03 §2.2 `Select`). Shared (no directive): client only when it
 * drives client filtering — inside `FilterBar` it is imported by a client parent. Rest:
 * `--slab-sunk`, 2px `--line-soft`, 3px radius, custom `▾` glyph (`aria-hidden`). Focus:
 * `--indigo-lift` border (the gold ring stays on the select — 03 C-25). `compact` = the filter
 * bar arrangement (label inline, `--mute`); default = stacked admin-field label (13px 700
 * `--chalk`).
 *
 * Controlled only when both `value` and `onChange` are given; otherwise `value` degrades to a
 * default so server-rendered forms stay uncontrolled. Ids derive from `name` (`select-<name>`)
 * — no `useId` so server parents can render it.
 */
export type SelectOption = { value: string; label: string; disabled?: boolean };

export type SelectProps = {
  label: string;
  name: string;
  options: SelectOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** Filter-bar arrangement (03: `compact` — inline label, tighter box). */
  compact?: boolean;
  disabled?: boolean;
};

export function Select({
  label,
  name,
  options,
  value,
  defaultValue,
  onChange,
  compact = false,
  disabled = false,
}: SelectProps) {
  const id = `select-${name}`;
  const controlled = onChange !== undefined && value !== undefined;

  return (
    <div className={styles.select} {...(compact ? { 'data-compact': '' } : {})}>
      <label className={styles['select-label']} htmlFor={id}>
        {label}
      </label>
      <span className={styles['select-well']}>
        <select
          id={id}
          name={name}
          className={styles['select-input']}
          disabled={disabled}
          {...(controlled
            ? { value, onChange: (event) => onChange(event.currentTarget.value) }
            : { defaultValue: defaultValue ?? value })}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
        <Icon name="chevron-down" size={16} className={styles['select-glyph']} />
      </span>
    </div>
  );
}
