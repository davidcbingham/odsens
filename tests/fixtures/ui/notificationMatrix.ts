/**
 * tests/fixtures/ui/notificationMatrix.ts — `NotificationMatrix` states for `/dev/components`
 * (03 §2.10 `NotificationMatrix`; DESIGN.md §12.1; ADR-0030 D5; T-E2E-48). No DB, no network:
 * the matrix is `matrixDefaults` (the seeded truth) or a hand-rolled variant. `children` (the
 * server-rendered Moderators section) is the preview page's own placeholder. Dirty / saving /
 * inline-error are interaction-only states (the `Toggle` / `InlineConfirm` precedent): flipping a
 * toggle arms SAVE; SAVE and Test call the real actions, which answer signed-out with their inline
 * error. The webhook string is a masked TAIL only (`…<last 4>`), never a URL (04 §1.3).
 */
import type { NotificationMatrixProps } from '@/components/admin/NotificationMatrix';
import { COMING_LATER_KINDS } from '@/lib/notify/constants';
import { matrixDefaults, type MatrixEntry } from '@/lib/notify/matrix';

export type NotificationMatrixFixture = {
  label: string;
  props: Omit<NotificationMatrixProps, 'children'>;
};

const comingLater = [...COMING_LATER_KINDS];

/** The default matrix with one cell flipped and the sync pair diverged (reads OFF — the AND rule). */
const edited: MatrixEntry[] = matrixDefaults.map((entry) => {
  if (entry.kind === 'comment.new' && entry.channel === 'email')
    return { ...entry, enabled: false };
  if (entry.kind === 'sync.stale' && entry.channel === 'email') return { ...entry, enabled: false };
  return { ...entry };
});

export const notificationMatrixFixtures: NotificationMatrixFixture[] = [
  {
    label: 'NotificationMatrix · defaults, nothing set',
    props: {
      matrix: [...matrixDefaults],
      comingLater,
      webhookMasked: null,
      adminEmails: [],
      moderationMode: 'auto',
      commentsClosedDefault: false,
      kofiPage: null,
      kofiWebhookLive: false,
    },
  },
  {
    label: 'NotificationMatrix · webhook set, two emails, hold first-time',
    props: {
      matrix: [...matrixDefaults],
      comingLater,
      webhookMasked: '…ghij',
      adminEmails: ['admin@localhost.test', 'dad@localhost.test'],
      moderationMode: 'hold_first_time',
      commentsClosedDefault: true,
      kofiPage: 'oddsense',
      kofiWebhookLive: false,
    },
  },
  {
    label: 'NotificationMatrix · comment.new email off, sync pair split (reads OFF)',
    props: {
      matrix: edited,
      comingLater,
      webhookMasked: null,
      adminEmails: ['admin@localhost.test'],
      moderationMode: 'auto',
      commentsClosedDefault: false,
      kofiPage: 'oddsense',
      kofiWebhookLive: false,
    },
  },
];
