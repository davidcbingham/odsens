'use client';

import type { ReactNode } from 'react';
import { trackEvent, type TrackEventName, type TrackProps } from '@/lib/analytics';

/**
 * TrackedLink — 03 §2.2 `TrackedLink`; 04 §5.6 (payload contract, ADR-0002 C12); 01 INV-59.
 * Client island (03 C-16a); no `.module.css` (03 C-01 exemption — no styles of its own).
 * Renders a plain `<a>`; fires `trackEvent(event, props)` on click — the ONLY network a client
 * island may start (01 INV-09) — and nothing else (no preventDefault, the navigation proceeds).
 * Payload values come typed from `lib/analytics.ts` `TrackProps` (04 §5.6 owns the shapes;
 * never a handle, id of a person, email or URL). S1.2 wires only `download`
 * (`{ project, source, from }`); `tip_click` / `video_play` / `sign_in` land in their own
 * slices (ADR-0002 A10). `target="_blank"` adds `rel="noopener noreferrer"` + sr
 * "(opens in new tab)".
 */
export type TrackedLinkProps<N extends TrackEventName = TrackEventName> = {
  event: N;
  props: TrackProps[N];
  href: string;
  children: ReactNode;
  className?: string;
  download?: boolean;
  target?: '_blank';
};

export function TrackedLink<N extends TrackEventName>({
  event,
  props,
  href,
  children,
  className,
  download,
  target,
}: TrackedLinkProps<N>) {
  const newTab = target === '_blank';
  return (
    <a
      href={href}
      className={className}
      download={download}
      target={target}
      rel={newTab ? 'noopener noreferrer' : undefined}
      onClick={() => trackEvent(event, props)}
    >
      {children}
      {newTab ? <span className="visually-hidden">(opens in new tab)</span> : null}
    </a>
  );
}
