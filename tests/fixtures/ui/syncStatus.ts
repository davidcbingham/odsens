/**
 * tests/fixtures/ui/syncStatus.ts — `SyncStatus` states for `/dev/components` (03 §2.10
 * `SyncStatus`; ADR-0002 #56; T-E2E-48). Timestamps are computed relative to module load so the
 * relative-time column stays honest ("30 min ago") whenever the page renders — no DB, no
 * network. "Sync now" pending/error are interaction-only states (the `Toggle`/`InlineConfirm`
 * precedent): clicking calls the real `triggerSync`, which answers signed-out with its inline
 * error. The moderator fixture is `canTrigger: false` (§2.10: rendered disabled,
 * `title="Admin only"`, never hidden). `skins` shows a non-triggerable row (no button at all).
 */
import type { SyncStatusProps, SyncStatusSource } from '@/components/admin/SyncStatus';

export type SyncStatusFixture = { label: string; props: SyncStatusProps };

const MINUTE = 60_000;
const loaded = Date.now();

function ago(minutes: number): string {
  return new Date(loaded - minutes * MINUTE).toISOString();
}

function okRun(items: number): SyncStatusSource['lastRun'] {
  return { startedAt: ago(35), finishedAt: ago(30), ok: true, items, error: null };
}

/** The two S1.2 sources (03 Slice cell: "S1.2 (Modrinth/CF)"), both healthy. */
const healthy: SyncStatusSource[] = [
  { source: 'modrinth', lastRun: okRun(18), stale: false, triggerable: true },
  { source: 'curseforge', lastRun: okRun(1), stale: false, triggerable: true },
];

/** One of each pill: failed · stale (old ok run) · stale (never ran) · live non-triggerable. */
const board: SyncStatusSource[] = [
  {
    source: 'modrinth',
    lastRun: {
      startedAt: ago(50),
      finishedAt: ago(49),
      ok: false,
      items: 0,
      error: 'Modrinth said 502. Three times.',
    },
    stale: false,
    triggerable: true,
  },
  {
    source: 'curseforge',
    lastRun: {
      startedAt: ago(60 * 7),
      finishedAt: ago(60 * 7 - 2),
      ok: true,
      items: 3,
      error: null,
    },
    stale: true,
    triggerable: true,
  },
  { source: 'youtube', lastRun: null, stale: true, triggerable: true },
  { source: 'skins', lastRun: okRun(2), stale: false, triggerable: false },
];

export const syncStatusFixtures: SyncStatusFixture[] = [
  { label: 'SyncStatus · live', props: { sources: healthy, canTrigger: true } },
  { label: 'SyncStatus · moderator', props: { sources: healthy, canTrigger: false } },
  { label: 'SyncStatus · states', props: { sources: board, canTrigger: true } },
];
