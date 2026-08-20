/**
 * tests/fixtures/ui/toast.ts — the presentational `Toast` in its three `data-state`s
 * (03 §3: entering | visible | leaving; DESIGN.md §11.1 Toast). Messages ≤ 3 words.
 */
import type { ToastProps } from '@/components/layout/Toast';

export type ToastFixture = { label: string; props: ToastProps };

export const toastFixtures: ToastFixture[] = [
  { label: 'Toast · entering', props: { message: 'Saved.', state: 'entering' } },
  { label: 'Toast · visible', props: { message: 'Comment posted.', state: 'visible' } },
  { label: 'Toast · leaving', props: { message: 'Copied.', state: 'leaving' } },
];
