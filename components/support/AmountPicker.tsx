'use client';

import { useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/primitives/Button';
import { Field } from '@/components/primitives/Field';
import { KofiPanelSlot } from '@/components/support/KofiPanelSlot';
import { trackEvent } from '@/lib/analytics';
import { kofiPageUrl } from '@/lib/support';
import styles from './AmountPicker.module.css';

/**
 * AmountPicker — DESIGN.md §6 #7 Support, §11.4 wrapper, §12.7 C19; 03 §2.9 `AmountPicker` row;
 * 02 §2.7; 04 §5.6 / §5.7. Client island (03 C-16a).
 *
 * Gold hatched slab: $1 / $3 / $5 / Other as `role="radio"` chips in a `role="radiogroup"`
 * (roving tabindex — arrow keys move and check, Space checks; $3 preselected, 00 O-8), a number
 * `Field` when Other is checked, one CONTINUE ON KO-FI `Button variant="gold-ink"` and the
 * "on Ko-fi ↗" ghost link — the only thing that leaves the site. CONTINUE fires
 * `tip_click {amount, from:'support'}` (`amount` = the preset, or the literal `'other'` — the typed
 * value is never sent, ADR-0002 A16) and mounts the Ko-fi iframe IN PLACE: this island owns the
 * `loaded` flag and renders `KofiPanelSlot` under the slab, because `/support` is a Server
 * Component and cannot hand a client leaf an `onContinue` function (ADR-0041 D2 — `onContinue`
 * stays as an optional observer). The amount is not passed to Ko-fi in v1 (04 §5.7).
 *
 * `kofiPage === null` (Settings → Ko-fi page name empty): chips + button disabled, the line
 * "Tips open soon.", no ghost link, no slot (04 §5.7; 00 S1.5b.AC1).
 */
export type AmountPickerProps = {
  amounts?: number[];
  preselected?: number;
  kofiPage: string | null;
  onContinue?: (amount: number | null) => void;
};

type Choice = number | 'other';

const DEFAULT_AMOUNTS = [1, 3, 5];
const TRACKED_PRESETS: readonly number[] = [1, 3, 5];

export function AmountPicker({
  amounts = DEFAULT_AMOUNTS,
  preselected = 3,
  kofiPage,
  onContinue,
}: AmountPickerProps) {
  const choices: Choice[] = [...amounts, 'other'];
  const [choice, setChoice] = useState<Choice>(
    amounts.includes(preselected) ? preselected : (amounts[0] ?? 'other'),
  );
  const [other, setOther] = useState('');
  const [loaded, setLoaded] = useState(false);
  const chipRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const disabled = kofiPage === null;

  function moveTo(index: number) {
    const next = (index + choices.length) % choices.length;
    const target = choices[next];
    if (target === undefined) return;
    setChoice(target);
    chipRefs.current[next]?.focus();
  }

  function onChipKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      moveTo(index + 1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveTo(index - 1);
    }
  }

  function amountValue(): number | null {
    if (choice !== 'other') return choice;
    const typed = Number(other);
    return Number.isFinite(typed) && typed >= 1 ? typed : null;
  }

  function handleContinue() {
    if (disabled) return;
    if (choice === 'other') trackEvent('tip_click', { amount: 'other', from: 'support' });
    else if (TRACKED_PRESETS.includes(choice))
      trackEvent('tip_click', { amount: choice as 1 | 3 | 5, from: 'support' });
    else trackEvent('tip_click', { from: 'support' });
    setLoaded(true);
    onContinue?.(amountValue());
  }

  return (
    <div className={styles['amount-picker']}>
      <div className={styles['amount-picker-slab']} {...(disabled ? { 'data-disabled': '' } : {})}>
        <h2 className={styles['amount-picker-title']}>BUY ME A BLOCK</h2>
        <p className={styles['amount-picker-line']}>
          Tips go through Ko-fi. Pick an amount, then finish there.
        </p>
        <div role="radiogroup" aria-label="Amount" className={styles['amount-picker-chips']}>
          {choices.map((value, index) => {
            const checked = value === choice;
            return (
              <button
                key={value}
                ref={(node) => {
                  chipRefs.current[index] = node;
                }}
                type="button"
                role="radio"
                aria-checked={checked}
                tabIndex={checked ? 0 : -1}
                disabled={disabled}
                className={styles['amount-picker-chip']}
                {...(value === 'other' ? { 'data-other': '' } : {})}
                onClick={() => setChoice(value)}
                onKeyDown={(event) => onChipKeyDown(event, index)}
              >
                {value === 'other' ? 'Other' : `$${value}`}
              </button>
            );
          })}
        </div>
        {choice === 'other' && !disabled ? (
          <div className={styles['amount-picker-other']}>
            <Field
              label="Amount in dollars"
              name="support-other-amount"
              type="number"
              inputProps={{
                min: 1,
                step: 1,
                inputMode: 'numeric',
                value: other,
                onChange: (event) => setOther(event.target.value),
              }}
            />
          </div>
        ) : null}
        <div className={styles['amount-picker-actions']}>
          <Button variant="gold-ink" disabled={disabled} onClick={handleContinue}>
            CONTINUE ON KO-FI
          </Button>
          {disabled ? (
            <p className={styles['amount-picker-soon']}>Tips open soon.</p>
          ) : (
            <>
              <p className={styles['amount-picker-note']}>Loads below. No account needed.</p>
              <a
                className={styles['amount-picker-out']}
                href={kofiPageUrl(kofiPage)}
                target="_blank"
                rel="noopener noreferrer"
              >
                on Ko-fi ↗<span className="visually-hidden">(opens in new tab)</span>
              </a>
            </>
          )}
        </div>
      </div>
      {disabled ? null : (
        <KofiPanelSlot kofiPage={kofiPage} amount={amountValue()} loaded={loaded} />
      )}
    </div>
  );
}
