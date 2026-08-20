'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { isDev } from '@/lib/env/public';
import styles from './Toast.module.css';

/**
 * Toast — DESIGN.md §11.1 Toast; 03 §2.1 `Toast` (+ `ToastProvider`, `useToast`), G-04.
 * One toast at a time (a new one replaces the current); auto-dismiss after `--toast-ms` (4000);
 * hover or focus-within pauses the timer (ADR-0002 #53). The live region is always mounted so
 * announcements fire. Success confirmations of ≤3 words only — errors are never toasts (C-30).
 */
export type ToastState = 'entering' | 'visible' | 'leaving';

export type ToastProps = {
  message: string;
  state: ToastState;
};

/** The presentational slab (exported for `/dev/components`). */
export function Toast({ message, state }: ToastProps) {
  return (
    <div className={styles.toast} data-state={state}>
      {message}
    </div>
  );
}

export type ToastContextValue = {
  toast: (message: string) => void;
};

const ToastContext = createContext<ToastContextValue>({
  toast: () => {
    // No provider mounted: toasts are dropped silently (route-group layouts mount ToastProvider).
  },
});

/** Matches `--toast-ms` in styles/tokens.css. */
const TOAST_MS = 4000;
/** Matches `--dur-fast`. */
const LEAVE_MS = 150;
const MAX_WORDS = 3;

function assertToastMessage(message: string): void {
  if (!isDev) return;
  const words = message.trim().split(/\s+/).filter(Boolean).length;
  if (words > MAX_WORDS) {
    throw new Error(`Toast messages are ≤${MAX_WORDS} words: "${message}" has ${words}.`);
  }
}

type Entry = { id: number; message: string; state: ToastState };

export type ToastProviderProps = { children: ReactNode };

export function ToastProvider({ children }: ToastProviderProps) {
  const [entry, setEntry] = useState<Entry | null>(null);
  const [paused, setPaused] = useState(false);
  const timing = useRef<{ id: number; remaining: number; startedAt: number }>({
    id: 0,
    remaining: TOAST_MS,
    startedAt: 0,
  });
  const nextId = useRef(0);

  const toast = useCallback((message: string) => {
    assertToastMessage(message);
    nextId.current += 1;
    timing.current = { id: nextId.current, remaining: TOAST_MS, startedAt: 0 };
    setEntry({ id: nextId.current, message, state: 'entering' });
  }, []);

  // entering → visible on the next frame so the CSS transition runs.
  useEffect(() => {
    if (!entry || entry.state !== 'entering') return;
    const id = entry.id;
    const frame = requestAnimationFrame(() => {
      setEntry((current) =>
        current && current.id === id && current.state === 'entering'
          ? { ...current, state: 'visible' }
          : current,
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [entry]);

  // visible → leaving after the remaining time, unless paused (hover / focus-within).
  useEffect(() => {
    if (!entry || entry.state !== 'visible' || paused) return;
    const id = entry.id;
    if (timing.current.id !== id) return;
    timing.current.startedAt = Date.now();
    const timer = setTimeout(() => {
      setEntry((current) =>
        current && current.id === id && current.state === 'visible'
          ? { ...current, state: 'leaving' }
          : current,
      );
    }, timing.current.remaining);
    return () => {
      clearTimeout(timer);
      if (timing.current.id === id) {
        const elapsed = Date.now() - timing.current.startedAt;
        timing.current.remaining = Math.max(0, timing.current.remaining - elapsed);
      }
    };
  }, [entry, paused]);

  // leaving → unmount after the exit transition.
  useEffect(() => {
    if (!entry || entry.state !== 'leaving') return;
    const id = entry.id;
    const timer = setTimeout(() => {
      setEntry((current) => (current && current.id === id ? null : current));
    }, LEAVE_MS);
    return () => clearTimeout(timer);
  }, [entry]);

  const value = useMemo<ToastContextValue>(() => ({ toast }), [toast]);
  const pause = useCallback(() => setPaused(true), []);
  const resume = useCallback(() => setPaused(false), []);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className={styles['toast-region']}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        onMouseEnter={pause}
        onMouseLeave={resume}
        onFocus={pause}
        onBlur={resume}
      >
        {entry ? <Toast message={entry.message} state={entry.state} /> : null}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}
