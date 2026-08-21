'use client';

import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import { checkHandle } from '@/lib/actions/accounts';
import { handleReason } from '@/lib/validation/handle';
import styles from './HandleField.module.css';

/**
 * HandleField — DESIGN.md §11.1 Handle field, §12.5 (no name detection); 03 §2.5 `HandleField`
 * (C-17 exception 1). `@` prefix inside the well, 16px value, 3px radius, 2px border carrying the
 * state: `resting` (`--line-soft`, helper = rules) · `checking` (`--indigo-lift` + three-square pixel
 * pulse; helper unchanged) · `available` (`--emerald` + ✔, "That one's free." in `--emerald-soft`) · `invalid`
 * (`--danger-field` + ✕, the plain reason). Structural reasons come instantly from
 * `handleReason()`; taken / reserved / invalid from the `checkHandle` action, debounced ≥ 400 ms.
 * Helper line is always present (`aria-live="polite"`), counter `n / 20` live.
 */
export type HandleFieldProps = {
  name: string;
  defaultValue?: string;
  /** Profile: the unchanged current handle counts as valid and is never checked. */
  currentHandle?: string;
  onValidity?: (v: { valid: boolean; value: string }) => void;
  className?: string;
};

type FieldState = 'resting' | 'checking' | 'available' | 'invalid';

const RULES = '3–20 characters. Letters, numbers, underscore.';
const FREE = "That one's free.";
const TAKEN = "That one's taken.";
const RESERVED = "That one's reserved.";
const BAD_CHARS = 'Letters, numbers and underscore only.';
const MAX = 20;
/** 03 §2.5 binding value. */
const DEBOUNCE_MS = 400;

function sameHandle(a: string, b: string | undefined): boolean {
  return typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
}

export function HandleField({
  name,
  defaultValue = '',
  currentHandle,
  onValidity,
  className,
}: HandleFieldProps) {
  const [value, setValue] = useState(defaultValue);
  const [state, setState] = useState<FieldState>(() => {
    const reason = defaultValue === '' ? null : handleReason(defaultValue);
    return reason ? 'invalid' : 'resting';
  });
  const [helper, setHelper] = useState<string>(() => {
    const reason = defaultValue === '' ? null : handleReason(defaultValue);
    return reason ?? RULES;
  });
  const inputId = useId();
  const helperId = useId();
  const counterId = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sequence = useRef(0);
  const onValidityRef = useRef(onValidity);
  useEffect(() => {
    onValidityRef.current = onValidity;
  });

  // Report the initial validity once (profile: unchanged = valid; onboarding: empty = invalid).
  const reported = useRef(false);
  useEffect(() => {
    if (reported.current) return;
    reported.current = true;
    const initial = defaultValue;
    const valid =
      initial !== '' &&
      (sameHandle(initial, currentHandle) ? true : handleReason(initial) === null);
    // An unchecked non-empty default without a structural reason is not "valid" until checked.
    onValidityRef.current?.({
      valid: sameHandle(initial, currentHandle) ? valid : false,
      value: initial,
    });
  }, [defaultValue, currentHandle]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function settle(next: FieldState, text: string, valid: boolean, current: string): void {
    setState(next);
    setHelper(text);
    onValidityRef.current?.({ valid, value: current });
  }

  function onChange(event: ChangeEvent<HTMLInputElement>): void {
    const next = event.target.value;
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    sequence.current += 1;
    const mine = sequence.current;

    if (next === '') {
      settle('resting', RULES, false, next);
      return;
    }
    if (sameHandle(next, currentHandle)) {
      settle('resting', RULES, true, next);
      return;
    }
    const reason = handleReason(next);
    if (reason) {
      settle('invalid', reason, false, next);
      return;
    }

    // DESIGN.md §11.1: the border and the pulse carry `checking`; the helper keeps the rules line.
    setState('checking');
    setHelper(RULES);
    onValidityRef.current?.({ valid: false, value: next });
    timer.current = setTimeout(() => {
      void checkHandle({ handle: next }).then((result) => {
        if (mine !== sequence.current) return; // a newer keystroke won
        if (!result.ok) {
          settle('invalid', result.error.message, false, next);
          return;
        }
        switch (result.data.status) {
          case 'available':
            settle('available', FREE, true, next);
            return;
          case 'taken':
            settle('invalid', TAKEN, false, next);
            return;
          case 'reserved':
            settle('invalid', RESERVED, false, next);
            return;
          default:
            settle('invalid', BAD_CHARS, false, next);
        }
      });
    }, DEBOUNCE_MS);
  }

  const classes = className ? `${styles['handle-field']} ${className}` : styles['handle-field'];
  const invalid = state === 'invalid';

  return (
    <div className={classes} data-state={state}>
      <label htmlFor={inputId} className={styles['handle-field-label']}>
        Handle
      </label>
      <div className={styles['handle-field-well']}>
        <span className={styles['handle-field-prefix']} aria-hidden="true">
          @
        </span>
        <input
          id={inputId}
          name={name}
          type="text"
          className={styles['handle-field-input']}
          value={value}
          onChange={onChange}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          aria-invalid={invalid ? 'true' : undefined}
          aria-describedby={`${helperId} ${counterId}`}
        />
        <span className={styles['handle-field-mark']} aria-hidden="true">
          {state === 'checking' ? (
            <span className={styles['handle-field-pulse']}>
              <span />
              <span />
              <span />
            </span>
          ) : null}
          {state === 'available' ? '✔' : null}
          {state === 'invalid' ? '✕' : null}
        </span>
      </div>
      <div className={styles['handle-field-foot']}>
        <p id={helperId} className={styles['handle-field-helper']} aria-live="polite">
          {helper}
        </p>
        <span id={counterId} className={styles['handle-field-counter']}>
          {value.length} / {MAX}
        </span>
      </div>
    </div>
  );
}
