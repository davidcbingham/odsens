'use client';

import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { Icon } from '@/components/primitives/Icon';
import styles from './ReorderableList.module.css';

/**
 * ReorderableList — pointer + keyboard drag reorder (03 §2.10 `ReorderableList`; DESIGN.md §12.2
 * "⠿ drag-reorder"; first use S1.2 `/admin/projects` featured order — ADR-0002 A11). Client
 * island (03 C-16a). `<ol aria-label>` of `--slab` rows; ⠿ handle = `Icon name="drag"` inside a
 * 44px `<button aria-label="Move <title>">`. Lifted row: `data-state="grabbed"` (`--indigo-lift`
 * outline, `4px 4px 0 --ink-deep`) + a 2px `--indigo-lift` drop-target line at its slot.
 *
 * Keyboard (order also editable without drag): ↑/↓ on a handle move the row one step and commit
 * immediately; Space grabs, ↑/↓ move while grabbed, Space drops (one commit), Esc cancels and
 * restores. Every move announces "Moved <title> to position N of M" in an `aria-live="polite"`
 * region. Pointer drag reorders live and commits once on drop.
 *
 * `onReorder(ids)` fires ONCE per completed reorder — the parent calls `curateProject` once with
 * the batch shape `{ reorder: [{ project_id, featured_order }] }` (one call, one revalidate —
 * ADR-0002 A11). No data fetching here (01 INV-09); rows arrive as `node` props.
 *
 * `title` per item feeds the handle label + announcements (03 a11y: "Move <title>"; falls back
 * to the id). `disabled` renders every handle disabled + `title="Admin only"` for moderators —
 * never hidden (03 §2.10 admin-only controls rule, 02 §1.3).
 */
export type ReorderableItem = {
  id: string;
  node: ReactNode;
  /** Plain-text name for the handle label + live announcements ("Move <title>"). */
  title?: string;
};

export type ReorderableListProps = {
  items: ReorderableItem[];
  /** Called once per completed reorder with every id in the new order. */
  onReorder: (ids: string[]) => void;
  /** Names the list (e.g. "Featured projects"). */
  label: string;
  /** Moderator view: handles render disabled + `title="Admin only"` (03 §2.10), never hidden. */
  disabled?: boolean;
};

const ADMIN_ONLY_TITLE = 'Admin only';

function moveId(order: string[], id: string, delta: -1 | 1): string[] {
  const from = order.indexOf(id);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= order.length) return order;
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

export function ReorderableList({
  items,
  onReorder,
  label,
  disabled = false,
}: ReorderableListProps) {
  const [order, setOrder] = useState<string[]>(() => items.map((item) => item.id));
  const [grabbed, setGrabbed] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const beforeGrab = useRef<string[] | null>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const dragging = useRef(false);
  // Latest in-handler order, for pointer handlers that can fire again before a re-render.
  // Never touched during render (react-hooks/refs): synced from fresh state at every grab
  // start and written through `applyOrder` for every in-handler reorder.
  const orderRef = useRef<string[]>([]);

  // Reset local order when the parent hands down a different item set (id signature change) —
  // state adjustment during render (the React "storing information from previous renders"
  // pattern; no refs touched). Any in-flight drag refs go stale harmlessly: every handler
  // guards on `grabbed !== id`, and the next grab re-syncs them.
  const signature = items.map((item) => item.id).join(' ');
  const [prevSignature, setPrevSignature] = useState(signature);
  if (prevSignature !== signature) {
    setPrevSignature(signature);
    setOrder(items.map((item) => item.id));
    setGrabbed(null);
  }

  /** Every in-handler reorder goes through here so `orderRef` tracks the freshest order. */
  function applyOrder(next: string[]): void {
    orderRef.current = next;
    setOrder(next);
  }

  const byId = new Map(items.map((item) => [item.id, item]));
  const titleOf = (id: string): string => byId.get(id)?.title ?? id;

  function announceMove(id: string, next: string[]): void {
    setAnnouncement(`Moved ${titleOf(id)} to position ${next.indexOf(id) + 1} of ${next.length}`);
  }

  function commit(next: string[]): void {
    const before = beforeGrab.current;
    beforeGrab.current = null;
    if (before && before.join(' ') === next.join(' ')) return;
    onReorder(next);
  }

  function step(id: string, delta: -1 | 1): void {
    const next = moveId(order, id, delta);
    if (next === order) return;
    applyOrder(next);
    announceMove(id, next);
    if (grabbed !== id) {
      // Arrow move without a grab commits immediately (03: order also editable without drag).
      beforeGrab.current = order;
      commit(next);
    }
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, id: string): void {
    if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      if (grabbed === id) {
        const current = orderRef.current;
        setGrabbed(null);
        setAnnouncement(
          `Dropped ${titleOf(id)} at position ${current.indexOf(id) + 1} of ${current.length}`,
        );
        commit(current);
      } else {
        beforeGrab.current = order;
        orderRef.current = order;
        setGrabbed(id);
        setAnnouncement(`Grabbed ${titleOf(id)}. Arrow keys move, Space drops, Escape cancels.`);
      }
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      step(id, event.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (event.key === 'Escape' && grabbed === id) {
      event.preventDefault();
      dragging.current = false;
      const before = beforeGrab.current;
      beforeGrab.current = null;
      if (before) applyOrder(before);
      setGrabbed(null);
      setAnnouncement('Reorder cancelled.');
    }
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>, id: string): void {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = true;
    beforeGrab.current = order;
    orderRef.current = order;
    setGrabbed(id);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLButtonElement>, id: string): void {
    if (!dragging.current || grabbed !== id) return;
    const y = event.clientY;
    const current = orderRef.current;
    // Insertion index over the other rows' midpoints, in current visual order.
    const rest = current.filter((rowId) => rowId !== id);
    let to = rest.length;
    for (const [i, rowId] of rest.entries()) {
      const rect = rowRefs.current.get(rowId)?.getBoundingClientRect();
      if (rect && y < rect.top + rect.height / 2) {
        to = i;
        break;
      }
    }
    const next = [...rest];
    next.splice(to, 0, id);
    if (next.join(' ') !== current.join(' ')) {
      applyOrder(next);
      announceMove(id, next);
    }
  }

  function handlePointerUp(id: string): void {
    if (!dragging.current || grabbed !== id) return;
    dragging.current = false;
    setGrabbed(null);
    commit(orderRef.current);
  }

  function handlePointerCancel(id: string): void {
    if (!dragging.current || grabbed !== id) return;
    dragging.current = false;
    const before = beforeGrab.current;
    beforeGrab.current = null;
    if (before) applyOrder(before);
    setGrabbed(null);
    setAnnouncement('Reorder cancelled.');
  }

  return (
    <div className={styles['reorderable-list']}>
      <ol className={styles['reorderable-list-rows']} aria-label={label}>
        {order.map((id) => {
          const item = byId.get(id);
          if (!item) return null;
          return (
            <li
              key={id}
              ref={(node) => {
                if (node) rowRefs.current.set(id, node);
                else rowRefs.current.delete(id);
              }}
              className={styles['reorderable-list-row']}
              {...(grabbed === id ? { 'data-state': 'grabbed' } : {})}
            >
              <button
                type="button"
                className={styles['reorderable-list-handle']}
                aria-label={`Move ${titleOf(id)}`}
                disabled={disabled}
                aria-disabled={disabled ? 'true' : undefined}
                title={disabled ? ADMIN_ONLY_TITLE : undefined}
                onKeyDown={(event) => handleKeyDown(event, id)}
                onPointerDown={(event) => handlePointerDown(event, id)}
                onPointerMove={(event) => handlePointerMove(event, id)}
                onPointerUp={() => handlePointerUp(id)}
                onPointerCancel={() => handlePointerCancel(id)}
              >
                <Icon name="drag" size={20} />
              </button>
              <div className={styles['reorderable-list-node']}>{item.node}</div>
            </li>
          );
        })}
      </ol>
      <span className="visually-hidden" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}
