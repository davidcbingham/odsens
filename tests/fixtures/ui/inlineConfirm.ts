/**
 * tests/fixtures/ui/inlineConfirm.ts — `InlineConfirm` copy for `/dev/components` (03 §2.2, §3).
 * `onConfirm` and the trigger render-prop are functions, so a Server Component cannot pass them:
 * the page shows `InlineConfirm` through the `ProfilePanel` specimen (Delete account, closed → open →
 * pending by clicking). These rows document the copy the S1.1 / S1.4 call sites use.
 */
import type { InlineConfirmProps } from '@/components/primitives/InlineConfirm';

export type InlineConfirmFixture = {
  label: string;
  props: Omit<InlineConfirmProps, 'onConfirm' | 'children'>;
};

export const inlineConfirmFixtures: InlineConfirmFixture[] = [
  {
    label: 'InlineConfirm · delete account',
    props: {
      question: 'Delete your account? Your handle, picture and comments go with it.',
      confirmLabel: 'Delete it',
      cancelLabel: 'Keep it',
      tone: 'danger',
    },
  },
  {
    label: 'InlineConfirm · delete comment',
    props: {
      question: 'Delete this comment?',
      confirmLabel: 'Delete it',
      cancelLabel: 'Keep it',
      tone: 'danger',
    },
  },
  {
    label: 'InlineConfirm · neutral',
    props: {
      question: 'Close this room?',
      confirmLabel: 'Close it',
      cancelLabel: 'Keep it open',
      tone: 'neutral',
    },
  },
];
