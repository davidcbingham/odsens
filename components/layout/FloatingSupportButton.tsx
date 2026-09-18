'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { TrackedLink } from '@/components/primitives/TrackedLink';
import styles from './FloatingSupportButton.module.css';

/**
 * FloatingSupportButton — DESIGN.md §5 "Floating support button" (gold fill, `♥ SUPPORT` Bungee
 * 13px, `4px 4px 0 --gold-deep`, bottom-right 24px inset; hides on scroll-down, returns on
 * scroll-up; phones: a 52px gold square, heart only), §11.4; 03 §2.1 row; 02 RP-15; 01 INV-58 (ours —
 * the Ko-fi floating-button script is never loaded). Client island (03 C-16a).
 *
 * Mounted once by `app/(public)/layout.tsx`, so `/welcome`, `/banned` and `/admin/*` (other
 * layouts) never see it; `/support` opts out here by pathname. The link is a `TrackedLink`
 * (`tip_click {from:'floating'}`, no `amount` — 04 §5.6).
 *
 * Scroll: ONE passive listener, coalesced to one read per animation frame; state only changes
 * when the direction flips past a small threshold, so steady scrolling re-renders nothing. The
 * wrapper carries `data-state="visible|hidden"` and — at ≤599px — the `data-compact` flag (03
 * C-14); the CSS does the rest: `hidden` slides it below the viewport, `:focus-within` forces it
 * back (focus is never off-screen), reduced motion swaps the slide for opacity.
 */
export type FloatingSupportButtonProps = {
  href?: string;
};

const DIRECTION_THRESHOLD_PX = 8;
const COMPACT_QUERY = '(max-width: 599px)';

function subscribeCompact(onChange: () => void): () => void {
  const query = window.matchMedia(COMPACT_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

const readCompact = () => window.matchMedia(COMPACT_QUERY).matches;
const readCompactOnServer = () => false;

export function FloatingSupportButton({ href = '/support' }: FloatingSupportButtonProps) {
  const pathname = usePathname();
  const [hidden, setHidden] = useState(false);
  const compact = useSyncExternalStore(subscribeCompact, readCompact, readCompactOnServer);
  const optedOut = pathname === '/support';

  useEffect(() => {
    if (optedOut) return;
    let lastY = window.scrollY;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const y = window.scrollY;
      const delta = y - lastY;
      if (Math.abs(delta) < DIRECTION_THRESHOLD_PX) return;
      lastY = y;
      setHidden(delta > 0 && y > 0);
    };
    const onScroll = () => {
      if (frame === 0) frame = window.requestAnimationFrame(measure);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [optedOut]);

  if (optedOut) return null;

  return (
    <div
      className={styles['floating-support']}
      data-state={hidden ? 'hidden' : 'visible'}
      {...(compact ? { 'data-compact': '' } : {})}
    >
      <TrackedLink
        event="tip_click"
        props={{ from: 'floating' }}
        href={href}
        className={styles['floating-support-link']}
        aria-label="Support OddSense on Ko-fi"
      >
        <span className={styles['floating-support-heart']} aria-hidden="true">
          ♥
        </span>
        <span className={styles['floating-support-word']}>SUPPORT</span>
      </TrackedLink>
    </div>
  );
}
