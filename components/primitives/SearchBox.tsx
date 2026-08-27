'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Icon } from '@/components/primitives/Icon';
import styles from './SearchBox.module.css';

/**
 * SearchBox — 03 §2.2 `SearchBox` row; 02 RP-02/RP-12; DESIGN.md §5 Nav "search (projects page)",
 * §6.2. Client island (03 C-16a: `components/primitives/SearchBox.tsx`). Never fetches (01 INV-09):
 * it only writes `?q=` to the URL; the `/projects` grid filters client-side over the ISR list.
 *
 * `placement="nav"` renders itself only on `/projects` (`usePathname` — RP-12/N-04) and only ≥900px;
 * `placement="page"` is a child of `ProjectGrid` (ADR-0002 A7) and shows under 900px. Debounced
 * 250ms write of `q` via `router.replace({scroll:false})`; Enter writes immediately (O-20,
 * ADR-0002 #59). Without JS the `<form method="get" action="/projects">` still submits `?q=`
 * (the page ignores `searchParams` server-side; the client reads the URL after hydration).
 * Must sit inside a `<Suspense>` boundary on ISR pages (02 RP-02).
 */
export type SearchBoxProps = {
  placement: 'nav' | 'page';
};

/** O-20 / ADR-0002 #59 binding value: 250ms debounce; Enter immediate. */
const DEBOUNCE_MS = 250;

/** 02 §2.2 `q`: free text, client substring match — the URL param this box owns. */
const PARAM = 'q';

export function SearchBox({ placement }: SearchBoxProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const inputId = useId();
  const urlQ = searchParams.get(PARAM) ?? '';
  const [value, setValue] = useState(urlQ);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastWritten = useRef(urlQ);

  // The URL is the state (RP-02): follow external q changes (Clear, back/forward) we didn't write.
  useEffect(() => {
    if (urlQ !== lastWritten.current) {
      lastWritten.current = urlQ;
      setValue(urlQ);
    }
  }, [urlQ]);

  useEffect(() => {
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);

  if (placement === 'nav' && pathname !== '/projects') return null;

  const write = (next: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next.trim() === '') params.delete(PARAM);
    else params.set(PARAM, next);
    lastWritten.current = next.trim() === '' ? '' : next;
    const qs = params.toString();
    router.replace(qs === '' ? '/projects' : `/projects?${qs}`, { scroll: false });
  };

  const onChange = (next: string) => {
    setValue(next);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => write(next), DEBOUNCE_MS);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); // Enter writes immediately (ADR-0002 #59)
    if (timer.current !== null) clearTimeout(timer.current);
    write(value);
  };

  return (
    <form
      method="get"
      action="/projects"
      role="search"
      className={styles['search-box']}
      data-placement={placement}
      onSubmit={onSubmit}
    >
      <label htmlFor={inputId} className="visually-hidden">
        Search projects
      </label>
      <Icon name="search" size={16} className={styles['search-box-icon']} />
      <input
        id={inputId}
        className={styles['search-box-input']}
        type="search"
        name={PARAM}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search projects"
        autoComplete="off"
      />
    </form>
  );
}
