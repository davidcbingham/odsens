'use client';

import { useCallback, useSyncExternalStore, type ReactNode } from 'react';
import styles from './ChangelogExpander.module.css';

/**
 * ChangelogExpander — DESIGN.md §12.5 ("per-version changelog behind a 'Changes ▾' ghost link in
 * the file cell; expands the markdown inline under the row on a sunk slab. Collapsed by default,
 * one open at a time"); 03 §2.3 `ChangelogExpander` row; 03 C-19 (client leaf inside the server
 * `VersionsTable`, children = server-rendered `Markdown variant="changelog"`); on the 03 §1.4
 * C-16a client-island list. No zod, no fetch (01 INV-09, ADR-0008).
 *
 * The expander is two coordinated DOM pieces that cannot share one mount point inside a `<table>`
 * (03 `VersionsTable`: the summary lives in the File cell; the markdown is an EXTRA `<tr>` with
 * `<td colspan=5>` directly under that row). So this one listed island file exports both halves —
 * same one-file/many-exports seam as `Toast` (+ `ToastProvider`, `useToast`):
 *   - `ChangelogExpander` `{ groupName, id, children }` (03 prop shape verbatim) = the extra
 *     `<tr id>` — `hidden` until open (not just visually), `role="region" aria-labelledby`,
 *     markdown children on `--slab-sunk`;
 *   - `ChangelogExpanderSummary` `{ groupName, id }` = the ghost "Changes ▾" summary
 *     `<button aria-expanded aria-controls="<id>">` `VersionsTable` places in the File cell.
 * Open state lives in a module-level external store keyed by `groupName`
 * (`'changelog-<projectId>'`) read with `useSyncExternalStore` (ViewerProvider precedent) —
 * opening one closes the other open one in the same group; when a group's last subscriber
 * unmounts its entry is dropped, so a revisited page is collapsed by default again.
 * No `data-state` (03 §3: `aria-expanded` on the summary; the expanded `<tr hidden>` toggled).
 */

type Listener = () => void;

const openByGroup = new Map<string, string | null>();
const listenersByGroup = new Map<string, Set<Listener>>();

function subscribeToGroup(groupName: string, listener: Listener): () => void {
  let set = listenersByGroup.get(groupName);
  if (!set) {
    set = new Set();
    listenersByGroup.set(groupName, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) {
      // Last subscriber gone → forget the group so the next visit starts collapsed (03: "Collapsed by default").
      listenersByGroup.delete(groupName);
      openByGroup.delete(groupName);
    }
  };
}

function setOpenId(groupName: string, id: string | null): void {
  openByGroup.set(groupName, id);
  listenersByGroup.get(groupName)?.forEach((listener) => listener());
}

/** SSR snapshot: nothing is open on the server (03: collapsed by default). */
const getServerOpenId = (): string | null => null;

function useOpenId(groupName: string): string | null {
  const subscribe = useCallback(
    (listener: Listener) => subscribeToGroup(groupName, listener),
    [groupName],
  );
  const getSnapshot = useCallback(() => openByGroup.get(groupName) ?? null, [groupName]);
  return useSyncExternalStore(subscribe, getSnapshot, getServerOpenId);
}

/** The summary button's DOM id — `aria-labelledby` target for the expanded row. */
function summaryId(id: string): string {
  return `${id}-summary`;
}

export type ChangelogExpanderSummaryProps = {
  /** `'changelog-<projectId>'` — one open at a time per group (03). */
  groupName: string;
  /** DOM id of the expanded `<tr>` this summary controls. */
  id: string;
  className?: string;
};

/** The "Changes ▾" ghost summary `VersionsTable` renders in the File cell (DESIGN.md §12.5). */
export function ChangelogExpanderSummary({
  groupName,
  id,
  className,
}: ChangelogExpanderSummaryProps) {
  const open = useOpenId(groupName) === id;
  const classes = className
    ? `${styles['changelog-expander-summary']} ${className}`
    : styles['changelog-expander-summary'];
  return (
    <button
      type="button"
      id={summaryId(id)}
      className={classes}
      aria-expanded={open}
      aria-controls={id}
      onClick={() => setOpenId(groupName, open ? null : id)}
    >
      Changes{' '}
      <span className={styles['changelog-expander-glyph']} aria-hidden="true">
        ▾
      </span>
    </button>
  );
}

export type ChangelogExpanderProps = {
  /** `'changelog-<projectId>'` (03 §2.3, verbatim). */
  groupName: string;
  /** DOM id of this expanded row (`aria-controls` target of its summary). */
  id: string;
  /** Server-rendered `Markdown variant="changelog"` (03 C-19). */
  children: ReactNode;
  className?: string;
};

/** The extra full-width `<tr>` under the version row — `hidden` until open (03 `VersionsTable`). */
export function ChangelogExpander({ groupName, id, children, className }: ChangelogExpanderProps) {
  const open = useOpenId(groupName) === id;
  const classes = className
    ? `${styles['changelog-expander']} ${className}`
    : styles['changelog-expander'];
  return (
    <tr id={id} hidden={!open} role="region" aria-labelledby={summaryId(id)} className={classes}>
      <td colSpan={5} className={styles['changelog-expander-cell']}>
        {children}
      </td>
    </tr>
  );
}
