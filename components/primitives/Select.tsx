'use client';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { Icon } from '@/components/primitives/Icon';
import styles from './Select.module.css';

/**
 * Select — the themed listbox (ADR-0035 D1; DESIGN.md §5 Filter bar "3px-radius selects" · §5
 * Admin field · §11.1 Profile menu for the open panel; 03 §2.2 `Select`). Client island (03 C-16a):
 * a trigger `<button aria-haspopup="listbox">` in the admin-field recipe (`--slab-sunk`, 2px
 * `--line-soft`, 3px radius, `▾` glyph) and, open, a `role="listbox"` panel in the profile-menu
 * recipe (`--slab`, 2px `--line-soft`, `4px 4px 0 --ink-deep`). Keyboard: Enter / Space / ArrowDown
 * / ArrowUp open; arrows, Home, End move; typing jumps to the first option starting with the
 * letters; Enter / Space pick; Esc closes and refocuses the trigger; Tab closes; click outside
 * closes. `aria-activedescendant` names the highlighted option, `aria-selected` the chosen one.
 * The trigger is the APG select-only combobox (`role="combobox"` on the button, named by the
 * label alone via `aria-labelledby`; its text is the current value) so `getByLabel(label)` keeps
 * resolving to the control and axe sees a complete combobox.
 * The previous native `<select>` was the device picker (Oliver, 2026-09-11).
 *
 * Forms: a hidden `<input name>` carries the value, so server `<form action>`s read
 * `formData.get(name)` exactly as before. Controlled only when both `value` and `onChange` are
 * given; otherwise `defaultValue ?? value ?? options[0]` seeds internal state (uncontrolled admin
 * forms). Ids derive from `name` (`select-<name>`) so `getByLabel(label)` resolves to the trigger.
 * `compact` = the filter-bar arrangement (label inline, `--mute`); default = stacked admin label.
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
  const labelId = `${id}-label`;
  const listId = `${id}-listbox`;
  const controlled = onChange !== undefined && value !== undefined;
  const [inner, setInner] = useState<string>(
    () => defaultValue ?? value ?? options[0]?.value ?? '',
  );
  const current = controlled ? value : inner;
  const currentIndex = Math.max(
    0,
    options.findIndex((option) => option.value === current),
  );
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(currentIndex);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typed = useRef<{ text: string; at: number }>({ text: '', at: 0 });
  const optionIdBase = useId();

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  const pick = useCallback(
    (index: number) => {
      const option = options[index];
      if (!option || option.disabled) return;
      if (!controlled) setInner(option.value);
      onChange?.(option.value);
      close(true);
    },
    [options, controlled, onChange, close],
  );

  const openAt = (index: number) => {
    setActive(index);
    setOpen(true);
  };

  // Click outside closes; the panel scrolls the active option into view.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) close(false);
    };
    document.addEventListener('pointerdown', onPointer);
    listRef.current?.focus();
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const step = (from: number, delta: 1 | -1): number => {
    let next = from;
    for (let i = 0; i < options.length; i += 1) {
      next = (next + delta + options.length) % options.length;
      if (!options[next]?.disabled) return next;
    }
    return from;
  };
  const edge = (delta: 1 | -1): number => (delta === 1 ? step(options.length - 1, 1) : step(0, -1));

  const typeAhead = (key: string): number | null => {
    const now = Date.now();
    const text = now - typed.current.at < 700 ? typed.current.text + key : key;
    typed.current = { text: text.toLowerCase(), at: now };
    const hit = options.findIndex(
      (option, i) =>
        !option.disabled &&
        i !== active &&
        option.label.toLowerCase().startsWith(typed.current.text),
    );
    if (hit !== -1) return hit;
    const same = options.findIndex(
      (option) => !option.disabled && option.label.toLowerCase().startsWith(typed.current.text),
    );
    return same === -1 ? null : same;
  };

  function onTriggerKey(event: ReactKeyboardEvent<HTMLButtonElement>): void {
    if (disabled) return;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
      case 'Enter':
      case ' ':
        event.preventDefault();
        openAt(currentIndex);
        return;
      default:
        if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
          const hit = typeAhead(event.key);
          if (hit !== null) pick(hit);
        }
    }
  }

  function onListKey(event: ReactKeyboardEvent<HTMLUListElement>): void {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActive((i) => step(i, 1));
        return;
      case 'ArrowUp':
        event.preventDefault();
        setActive((i) => step(i, -1));
        return;
      case 'Home':
        event.preventDefault();
        setActive(edge(-1));
        return;
      case 'End':
        event.preventDefault();
        setActive(edge(1));
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        pick(active);
        return;
      case 'Escape':
        event.preventDefault();
        close(true);
        return;
      case 'Tab':
        close(false);
        return;
      default:
        if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
          event.preventDefault();
          const hit = typeAhead(event.key);
          if (hit !== null) setActive(hit);
        }
    }
  }

  const selected = options[currentIndex];
  const optionId = (index: number) => `${optionIdBase}-${index}`;

  return (
    <div
      ref={rootRef}
      className={styles.select}
      data-state={open ? 'open' : 'closed'}
      {...(compact ? { 'data-compact': '' } : {})}
    >
      <span id={labelId} className={styles['select-label']}>
        {label}
      </span>
      <input type="hidden" name={name} value={current} />
      <span className={styles['select-well']}>
        <button
          ref={triggerRef}
          type="button"
          id={id}
          role="combobox"
          className={styles['select-input']}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          aria-labelledby={labelId}
          disabled={disabled}
          onClick={() => (open ? close(false) : openAt(currentIndex))}
          onKeyDown={onTriggerKey}
        >
          <span className={styles['select-value']}>{selected?.label ?? ''}</span>
        </button>
        <Icon name="chevron-down" size={16} className={styles['select-glyph']} />
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-labelledby={labelId}
          aria-activedescendant={open ? optionId(active) : undefined}
          tabIndex={-1}
          className={styles['select-panel']}
          hidden={!open}
          onKeyDown={onListKey}
        >
          {options.map((option, index) => (
            <li
              key={option.value}
              id={optionId(index)}
              role="option"
              data-index={index}
              aria-selected={index === currentIndex}
              aria-disabled={option.disabled ? true : undefined}
              data-active={index === active ? '' : undefined}
              className={styles['select-option']}
              onPointerMove={() => setActive(index)}
              onClick={() => pick(index)}
            >
              <span className={styles['select-option-label']}>{option.label}</span>
              {index === currentIndex ? (
                <Icon name="check" size={16} className={styles['select-option-check']} />
              ) : null}
            </li>
          ))}
        </ul>
      </span>
    </div>
  );
}
