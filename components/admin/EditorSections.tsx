'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Dialog } from '@/components/primitives/Dialog';
import { formIsDirty, snapshotEntries, type FormSnapshot } from '@/lib/forms/dirty';
import styles from './EditorSections.module.css';

/**
 * EditorSections — the project editor's section sidebar + unsaved-changes guard (DESIGN.md v1.10
 * §11.3 #20 "Admin — Project editor v2"; 03 §2.10 `EditorSections` row; ADR-0039 D2/D3;
 * ADR-0040 D3/D6; 05 T-E2E-55/57). Client island (03 C-16a): the page renders ONE section's
 * server-rendered forms as `children` and lists the sections the row has; nothing here fetches
 * or posts (01 INV-09 — the forms stay `<form action>` server functions, 03 C-17).
 *
 * Layout: `<nav aria-label="Sections">` of `next/link` items (`aria-current="page"` on the
 * active one) beside the content. ≥900px the nav is the §6 #9 admin sidebar recipe (220px
 * `--slab-sunk` column, 4px `--gold` inset bar on the active item — `AdminShell.Nav`'s
 * `.admin-nav-link` mirrored); below 900px a horizontally scrollable chip row above the content
 * (§5 filter-bar chips, active chip `--gold-wash` / `--gold-bright`) that never clips focus rings.
 *
 * Dirty tracking (ADR-0039 D3): on mount every `<form>` inside the content root is snapshotted
 * (`snapshotEntries(new FormData(form).entries())`, keyed by the form element); delegated
 * `input` + `change` listeners on the content root recompute that target's form and set
 * `dirty` when any form differs from its snapshot (`formIsDirty`). Targets with no form (the
 * upload wells, the comments `Toggle`) and `input[type=file]` are ignored — uploads never count
 * as unsaved; a `Toggle` `role="switch"` inside a form (the Markdown editor's Preview) is a view
 * control, so its entry is left out of the snapshots. A `focusin` inside a form snapshots it
 * BEFORE its first edit when it is untracked (it appeared after mount — the gallery names form a
 * first upload creates through `router.refresh()`), and re-bases a tracked form only while the
 * island is clean AND the form's FIELD SET changed since its snapshot (rows an upload added are
 * not an edit) — never on a value change alone, so a script-committed edit whose announcement
 * follows a focus move (the Markdown toolbar) is still caught (ADR-0040 D10). A `submit` on a tracked form marks
 * the island clean at once and re-bases that form on the values being saved (the PRG round trip
 * re-renders the section; `key={section}` on the page remounts the island on a section change —
 * ADR-0040 D6). `dirty` lives in state (the dot, `data-dirty`) AND a ref (the window / document
 * listeners read the ref). Edits that React commits by property assignment announce themselves
 * as native events (the Markdown editor's toolbar → `input`, `Select` → `change`; ADR-0040 D9).
 *
 * Guards: while dirty a `beforeunload` listener cancels the unload (`preventDefault` +
 * `returnValue = ''`), and a document-level CAPTURE `click` listener intercepts every plain left
 * click on a same-document link (same origin, no `target`, no `download`, a different URL beyond
 * the hash) — the section links here, the admin shell's nav and in-page links alike, since Next
 * soft navigation never fires `beforeunload` (ADR-0040 D3) — and opens the `Dialog`: Stay / Esc
 * closes it with the edits intact; Leave anyway clears the ref (so `beforeunload` stays quiet)
 * and `router.push(href)`. Voice pinned by ADR-0039 D5 (DESIGN.md §7).
 */
export type EditorSectionsProps = {
  sections: { id: string; label: string; href: string }[];
  active: string;
  /** The active section's server-rendered forms. */
  children: ReactNode;
};

const DIALOG_TITLE = 'Unsaved changes';
const DIALOG_BODY = "You changed something here and didn't save.";
const STAY_LABEL = 'Stay';
const LEAVE_LABEL = 'Leave anyway';

/**
 * A form's current snapshot. Entries posted by a `Toggle` `role="switch"` inside the form are
 * dropped — such a toggle is a view control (the Markdown editor's Preview), never an edit.
 */
function snapshotForm(form: HTMLFormElement): FormSnapshot {
  const viewControls = new Set<string>();
  form.querySelectorAll<HTMLInputElement>('input[role="switch"]').forEach((input) => {
    if (input.name !== '') viewControls.add(input.name);
  });
  const entries: [string, unknown][] = [];
  new FormData(form).forEach((value, name) => {
    if (!viewControls.has(name)) entries.push([name, value]);
  });
  return snapshotEntries(entries);
}

/** The link a click would follow in THIS window, or null when the click is not ours to guard. */
function guardedHref(event: MouseEvent): string | null {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const anchor = target.closest('a[href]');
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  if (anchor.target !== '' && anchor.target !== '_self') return null;
  if (anchor.hasAttribute('download')) return null;
  if (anchor.origin !== window.location.origin) return null;
  const strip = (url: string): string => url.split('#')[0] ?? url;
  if (strip(anchor.href) === strip(window.location.href)) return null;
  return anchor.getAttribute('href') ?? anchor.href;
}

export function EditorSections({ sections, active, children }: EditorSectionsProps) {
  const router = useRouter();
  const contentRef = useRef<HTMLDivElement>(null);
  const snapshotsRef = useRef<Map<HTMLFormElement, FormSnapshot>>(new Map());
  const dirtyRef = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  const setDirtyState = useCallback((next: boolean) => {
    dirtyRef.current = next;
    setDirty(next);
  }, []);

  // Snapshots + delegated listeners on the content root (mount only — a `router.refresh()` from
  // an upload well must not re-base the forms while edits are pending; a clean form is re-based
  // on `focusin`, before its first edit).
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    const snapshots = snapshotsRef.current;
    snapshots.clear();
    root.querySelectorAll('form').forEach((form) => snapshots.set(form, snapshotForm(form)));

    const recompute = () => {
      const next = [...snapshots].some(
        ([form, initial]) => form.isConnected && formIsDirty(initial, snapshotForm(form)),
      );
      setDirtyState(next);
    };
    const sameFields = (a: FormSnapshot, b: FormSnapshot): boolean => {
      const keys = Object.keys(a);
      return keys.length === Object.keys(b).length && keys.every((key) => key in b);
    };
    const onFocus = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const form = target.closest('form');
      if (!form) return;
      const initial = snapshots.get(form);
      // A form that appeared after mount is tracked from here, before its first edit.
      if (initial === undefined) {
        snapshots.set(form, snapshotForm(form));
        return;
      }
      if (dirtyRef.current) return;
      // A clean, tracked form whose field set changed gained or lost rows through an upload
      // well's `router.refresh()` — not an edit: re-base it. A value change alone never does.
      const now = snapshotForm(form);
      if (!sameFields(initial, now)) snapshots.set(form, now);
    };
    const onEdit = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target instanceof HTMLInputElement && target.type === 'file') return;
      const form = target.closest('form');
      if (!form) return;
      // A form edited without ever taking focus (script-driven) starts clean from that edit.
      if (!snapshots.has(form)) snapshots.set(form, snapshotForm(form));
      recompute();
    };
    const onSubmit = (event: Event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || !snapshots.has(form)) return;
      snapshots.set(form, snapshotForm(form));
      setDirtyState(false);
    };
    root.addEventListener('focusin', onFocus);
    root.addEventListener('input', onEdit);
    root.addEventListener('change', onEdit);
    root.addEventListener('submit', onSubmit);
    return () => {
      root.removeEventListener('focusin', onFocus);
      root.removeEventListener('input', onEdit);
      root.removeEventListener('change', onEdit);
      root.removeEventListener('submit', onSubmit);
    };
  }, [setDirtyState]);

  // The browser's own prompt on close / reload while dirty (S1.5c.AC3).
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // The leave guard: capture-phase so `next/link` never sees the click (ADR-0040 D3).
  useEffect(() => {
    if (!dirty) return;
    const onClick = (event: MouseEvent) => {
      if (!dirtyRef.current) return;
      const href = guardedHref(event);
      if (href === null) return;
      event.preventDefault();
      event.stopPropagation();
      setPendingHref(href);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [dirty]);

  const stay = useCallback(() => setPendingHref(null), []);
  const leave = useCallback(() => {
    const href = pendingHref;
    setPendingHref(null);
    if (href === null) return;
    setDirtyState(false);
    router.push(href);
  }, [pendingHref, router, setDirtyState]);

  return (
    <div className={styles.root} data-dirty={dirty ? 'true' : undefined}>
      <nav aria-label="Sections" className={styles.nav}>
        <ul className={styles.list}>
          {sections.map((section) => {
            const isActive = section.id === active;
            return (
              <li key={section.id}>
                <Link
                  href={section.href}
                  className={styles.link}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <span>{section.label}</span>
                  {isActive && dirty ? (
                    <>
                      <span className={styles.dot} aria-hidden="true" />
                      <span className="visually-hidden">Unsaved changes</span>
                    </>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div ref={contentRef} className={styles.content}>
        {children}
      </div>
      <Dialog
        open={pendingHref !== null}
        title={DIALOG_TITLE}
        body={DIALOG_BODY}
        confirmLabel={LEAVE_LABEL}
        cancelLabel={STAY_LABEL}
        onConfirm={leave}
        onCancel={stay}
      />
    </div>
  );
}
