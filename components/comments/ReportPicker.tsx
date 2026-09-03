'use client';

import { useId, useRef, useState, useTransition, type FormEvent, type KeyboardEvent } from 'react';
import { Button } from '@/components/primitives/Button';
import { Field } from '@/components/primitives/Field';
import { reportComment } from '@/lib/actions/comments';
import type { ReportCommentInput } from '@/lib/actions/comments.schema';
import { commentErrorLine } from '@/lib/validation/comment';
import styles from './ReportPicker.module.css';

/**
 * ReportPicker — DESIGN.md §11.2 Report ("inline reason picker — Spam / Rude / Something else as
 * 3px-radius chips, one selected in `--indigo-lift`, then SEND REPORT. Confirmation is one line:
 * 'Reported. OddSense will look at it.'"); 03 §2.4 `ReportPicker`; 00 S1.4.AC9. Client island
 * (03 C-16a): the selected reason + `reportComment` (`lib/actions/comments.ts`) inside
 * `startTransition` (03 C-17). States (03 §3): `data-state="picking"` (chips as
 * `<button role="radio" aria-checked>` in a `role="radiogroup" aria-label="Reason"`; SEND REPORT
 * `Button primary sm`, disabled until a reason is checked) · `sending` · `done` (the one line,
 * `role="status"`) · `error` (one plain line inline — `validation` keeps the action's own words,
 * every other code maps through `commentErrorLine`; never a toast, 03 C-30). "Something else"
 * reveals an optional note `Field` (`maxLength=300`, 04 §1.2 `note ≤ 300`).
 *
 * Keyboard: arrow keys move AND check (native radio semantics), Space/Enter check, the checked
 * chip (or the first) is the one tab stop. A repeat report by the same viewer returns ok with the
 * same line (T-E2E-27 — the action is idempotent). `onCancel` (additive, 03 C-03) closes the
 * picker from its Cancel ghost; `onDone` fires once the report is accepted.
 */
export const REPORTED_LINE = 'Reported. OddSense will look at it.';
export const REPORT_QUESTION = "What's wrong with it?";

/** The action's reason union, read off its input type (a type-only import — erased at build). */
type ReportReason = ReportCommentInput['reason'];

/**
 * Chips in DESIGN.md §11.2 order (Spam / Rude / Something else). `Record<ReportReason, …>` keeps the
 * table exhaustive against the schema's enum, and the runtime tuple is derived here rather than
 * imported: `lib/actions/comments.schema.ts` is a zod module, so a value import would ship zod
 * into the `/projects/[slug]` island bundle (ADR-0008 D3 / ADR-0028 D5 — the `ModActionRow`
 * precedent keeps its tables local too).
 */
const REASON_LABELS: Record<ReportReason, string> = {
  spam: 'Spam',
  rude: 'Rude',
  other: 'Something else',
};
const REPORT_REASONS = Object.keys(REASON_LABELS) as ReportReason[];

const NOTE_MAX = 300;

export type ReportPickerProps = {
  commentId: string;
  onDone: () => void;
  /** Additive (03 C-03): the Cancel ghost. */
  onCancel?: () => void;
  className?: string;
};

type State = 'picking' | 'sending' | 'done' | 'error';

export function ReportPicker({ commentId, onDone, onCancel, className }: ReportPickerProps) {
  const [state, setState] = useState<State>('picking');
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const questionId = useId();
  const chipRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function check(next: ReportReason): void {
    setReason(next);
    if (state === 'error') {
      setState('picking');
      setError(null);
    }
  }

  function onChipKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    const last = REPORT_REASONS.length - 1;
    let target: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown')
      target = index === last ? 0 : index + 1;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
      target = index === 0 ? last : index - 1;
    const next = target === null ? undefined : REPORT_REASONS[target];
    if (target === null || next === undefined) return;
    event.preventDefault();
    check(next);
    chipRefs.current[target]?.focus();
  }

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (reason === null || state === 'sending') return;
    startTransition(async () => {
      setState('sending');
      setError(null);
      const trimmed = note.trim();
      const result = await reportComment({
        comment_id: commentId,
        reason,
        ...(reason === 'other' && trimmed !== '' ? { note: trimmed } : {}),
      });
      if (result.ok) {
        setState('done');
        onDone();
      } else {
        setState('error');
        setError(
          result.error.code === 'validation'
            ? result.error.message
            : commentErrorLine(result.error.code),
        );
      }
    });
  }

  const classes = className ? `${styles['report-picker']} ${className}` : styles['report-picker'];

  if (state === 'done') {
    return (
      <div className={classes} data-state="done">
        <p role="status" className={styles['report-picker-done']}>
          {REPORTED_LINE}
        </p>
      </div>
    );
  }

  // Roving tab stop: the checked chip, else the first (native radio-group behaviour).
  const tabStop: ReportReason = reason ?? 'spam';

  return (
    <form className={classes} data-state={state} onSubmit={onSubmit}>
      <p id={questionId} className={styles['report-picker-question']}>
        {REPORT_QUESTION}
      </p>
      <div
        role="radiogroup"
        aria-label="Reason"
        aria-describedby={questionId}
        className={styles['report-picker-chips']}
      >
        {REPORT_REASONS.map((value, index) => (
          <button
            key={value}
            ref={(el) => {
              chipRefs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={reason === value}
            tabIndex={tabStop === value ? 0 : -1}
            className={styles['report-picker-chip']}
            onClick={() => check(value)}
            onKeyDown={(event) => onChipKeyDown(event, index)}
          >
            {REASON_LABELS[value]}
          </button>
        ))}
      </div>
      {reason === 'other' ? (
        <Field
          label="Note (optional)"
          name={`note-${commentId}`}
          type="textarea"
          maxLength={NOTE_MAX}
          counter
          inputProps={{
            rows: 2,
            value: note,
            onChange: (event) => setNote(event.currentTarget.value),
          }}
        />
      ) : null}
      {error ? (
        <p role="alert" className={styles['report-picker-error']}>
          {error}
        </p>
      ) : null}
      <div className={styles['report-picker-actions']}>
        <Button
          variant="primary"
          size="sm"
          type="submit"
          disabled={reason === null}
          pending={state === 'sending'}
        >
          Send report
        </Button>
        {onCancel ? (
          <Button variant="ghost" arrow={false} onClick={onCancel} disabled={state === 'sending'}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
