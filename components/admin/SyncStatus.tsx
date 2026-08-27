'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useId, useRef, type ReactNode } from 'react';
import { useToast } from '@/components/layout/Toast';
import { Button } from '@/components/primitives/Button';
import { PlatformMark } from '@/components/primitives/PlatformMark';
import { SourceSwatch } from '@/components/primitives/SourceSwatch';
import { StatusPill } from '@/components/primitives/StatusPill';
import { Table, type TableProps } from '@/components/primitives/Table';
import { triggerSync } from '@/lib/actions/admin';
import { relativeTime } from '@/lib/format/date';
import { formatCount } from '@/lib/format/number';
import styles from './SyncStatus.module.css';

/**
 * SyncStatus — the admin sync-runs board (03 §2.10 `SyncStatus`; DESIGN.md §12.7 #56, ADR-0002
 * #56 / O-16: composed only from `Table` + `StatusPill` + `Button secondary sm` +
 * `SourceSwatch`/`PlatformMark` — no bespoke design). Client island (03 C-16a) for the per-row
 * "Sync now" pending state via `useActionState` around `triggerSync` (`lib/actions/admin.ts`) —
 * the island's one permitted network op (01 INV-09); every row arrives as props from the admin
 * page, nothing is queried here (03 C-17).
 *
 * Row per source: swatch/mark + word · `StatusPill` (`failed` when the last run wasn't ok, else
 * `stale` per the page-computed flag — also when no run exists yet, a source that never ran is
 * stale by definition — else `live`) · last run relative time (`lib/format/date.ts`) · items ·
 * error text (`--danger`, plain) · `Button secondary size=sm` "Sync now", only for the 04 §1.7
 * enum sources (`notify` / `skins` have no job to trigger — 03 §2.10). Pending → `aria-busy` on
 * the button, label unchanged (ADR-0002 #46); ok → `Toast` "Sync started." + `router.refresh()`
 * (the `ProfilePanel` precedent — the finished run's row comes down with the refreshed page
 * data); errors stay inline beside the button, never a toast (03 C-30; `conflict` → "Already
 * running.", 04 §1.7). The action re-checks `admin` server-side regardless (01 INV-18).
 *
 * Moderators (ADR-0002 C7; 02 §1.3): `canTrigger=false` renders every button disabled +
 * `title="Admin only"`, never hidden and never a `forbidden` error. `Button` owns its own
 * attributes (03 C-03 pass-throughs: `className`/`onClick`/`ref`/`aria-describedby`), so the
 * title sits on the cell wrapper and the explanation uses `Button`'s documented
 * `aria-describedby` mechanism ("a helper line explaining a disabled button", 03 §2.2) pointing
 * at a visually-hidden "Admin only" note.
 *
 * Source → mark (engineering call; 03 lists `SourceSwatch`/`PlatformMark` without a per-source
 * pick): `modrinth` / `curseforge` → `SourceSwatch`; `youtube` → `PlatformMark` with word; the
 * odsens-internal jobs (`mentions`, `stats`, `notify`, `skins`) → the `direct` swatch
 * (`--indigo-lift` = direct/odsens, DESIGN.md §11.1) with the job's own word.
 */
export type SyncStatusSource = {
  /** 04 §11 `sync_runs.source`. */
  source: 'modrinth' | 'curseforge' | 'youtube' | 'mentions' | 'stats' | 'notify' | 'skins';
  /** Latest `sync_runs` row for the source; `finishedAt` is null while a run is open. */
  lastRun: {
    startedAt: string;
    finishedAt: string | null;
    ok: boolean;
    items: number;
    error: string | null;
  } | null;
  /** Page-computed: no ok run recently (04 §2.4 staleness window). */
  stale: boolean;
  /** `skins` (and `notify`) have no `triggerSync` — no button at all, not a disabled one. */
  triggerable: boolean;
};

export type SyncStatusProps = {
  sources: SyncStatusSource[];
  /** Viewer role === 'admin'; false → buttons render disabled (`title="Admin only"`) — 02 §1.3. */
  canTrigger: boolean;
  className?: string;
};

const ADMIN_ONLY_TITLE = 'Admin only';

/** 04 §1.7 `triggerSyncInput.source` — the only sources a "Sync now" button may target. */
const TRIGGERABLE_SOURCES = ['modrinth', 'curseforge', 'youtube', 'mentions', 'stats'] as const;
type TriggerableSource = (typeof TRIGGERABLE_SOURCES)[number];

function isTriggerable(source: SyncStatusSource['source']): source is TriggerableSource {
  return (TRIGGERABLE_SOURCES as readonly string[]).includes(source);
}

/** Words for the odsens-internal jobs rendered on the `direct` swatch. */
const INTERNAL_WORDS = {
  mentions: 'Mentions',
  stats: 'Stats',
  notify: 'Notify',
  skins: 'Skins',
} as const;

function sourceMark(source: SyncStatusSource['source']): ReactNode {
  switch (source) {
    case 'modrinth':
    case 'curseforge':
      return <SourceSwatch source={source} />;
    case 'youtube':
      return <PlatformMark platform="youtube" size={24} withWord />;
    default:
      return <SourceSwatch source="direct" word={INTERNAL_WORDS[source]} />;
  }
}

function runStatus(row: SyncStatusSource): 'live' | 'stale' | 'failed' {
  if (row.lastRun && !row.lastRun.ok) return 'failed';
  if (row.stale || row.lastRun === null) return 'stale';
  return 'live';
}

const COLUMNS: TableProps['columns'] = [
  { key: 'source', header: 'Source' },
  { key: 'status', header: 'Status' },
  { key: 'last-run', header: 'Last run' },
  { key: 'items', header: 'Items', align: 'end' },
  { key: 'error', header: 'Error' },
  { key: 'sync', header: 'Sync', align: 'end' },
];

export function SyncStatus({ sources, canTrigger, className }: SyncStatusProps) {
  const classes = className ? `${styles['sync-status']} ${className}` : styles['sync-status'];
  const rows: TableProps['rows'] = sources.map((row) => ({
    key: row.source,
    source: sourceMark(row.source),
    status: <StatusPill status={runStatus(row)} />,
    'last-run': row.lastRun ? (
      // Client-derived relative time: the same props can straddle a minute boundary between the
      // dynamic page's SSR and hydration — patch silently instead of warning.
      <span suppressHydrationWarning>
        {relativeTime(row.lastRun.finishedAt ?? row.lastRun.startedAt)}
      </span>
    ) : (
      'Never'
    ),
    items: row.lastRun ? formatCount(row.lastRun.items) : null,
    error: row.lastRun?.error ? (
      <span className={styles['sync-status-error']}>{row.lastRun.error}</span>
    ) : null,
    sync:
      row.triggerable && isTriggerable(row.source) ? (
        <SyncNow source={row.source} canTrigger={canTrigger} />
      ) : null,
  }));

  return (
    <div className={classes}>
      <Table caption="Sync status" columns={COLUMNS} rows={rows} rowKey="key" />
    </div>
  );
}

type SyncResult = Awaited<ReturnType<typeof triggerSync>> | null;

type SyncNowProps = { source: TriggerableSource; canTrigger: boolean };

/** One row's "Sync now" cell — its own `useActionState` so pending is per row (03 §2.10). */
function SyncNow({ source, canTrigger }: SyncNowProps) {
  const router = useRouter();
  const { toast } = useToast();
  const noteId = useId();
  const seen = useRef<SyncResult>(null);
  const [result, formAction, pending] = useActionState<SyncResult>(
    () => triggerSync({ source }),
    null,
  );

  // Toast + refresh once per returned result (the `ProfilePanel` seen-ref pattern): the action
  // awaits the whole job, so on ok the new `sync_runs` row is already there to re-render.
  useEffect(() => {
    if (result === null || result === seen.current) return;
    seen.current = result;
    if (result.ok) {
      toast('Sync started.');
      router.refresh();
    }
  }, [result, toast, router]);

  if (!canTrigger) {
    return (
      <span className={styles['sync-status-now']} title={ADMIN_ONLY_TITLE}>
        <Button variant="secondary" size="sm" disabled aria-describedby={noteId}>
          Sync now
        </Button>
        <span id={noteId} className="visually-hidden">
          {ADMIN_ONLY_TITLE}
        </span>
      </span>
    );
  }

  const error = result && !result.ok ? result.error.message : null;
  return (
    <form action={formAction} className={styles['sync-status-now']}>
      <Button variant="secondary" size="sm" type="submit" pending={pending}>
        Sync now
      </Button>
      {error ? (
        <span role="alert" className={styles['sync-status-error']}>
          {error}
        </span>
      ) : null}
    </form>
  );
}
