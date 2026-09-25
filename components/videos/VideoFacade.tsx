'use client';

import Image from 'next/image';
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { PixelLabel } from '@/components/primitives/PixelLabel';
import { trackEvent } from '@/lib/analytics';
import { formatDuration, spokenDuration } from '@/lib/format/duration';
import { youtubeEmbedUrl } from '@/lib/videos';
import styles from './VideoFacade.module.css';

/**
 * VideoFacade — DESIGN.md §11.1 Video facade, §11.5 Shorts, §12.7 #58 sizes; 03 §2.6 `VideoFacade`
 * row; 01 INV-57; 00 S1.6.AC2 / AC3. Client island (03 C-16a): the ONLY place a YouTube iframe may
 * appear, and only after a click — until then the box is a thumbnail (`next/image`, so the browser
 * asks our own `/_next/image`, never a Google host — 01 INV-54), a `--scrim-35` scrim, the indigo
 * play block, the duration chip and the `CLICK TO LOAD YOUTUBE` chip.
 *
 * States (03 §3, one `data-state` on the root): `idle` → click → `loading` (the iframe is mounted
 * over the thumbnail) → `playing` (its `onLoad`; the thumbnail is gone). The iframe is the
 * privacy-enhanced embed from `youtubeEmbedUrl()` and fills the facade's own fixed aspect box, so
 * nothing moves (AC10). The click fires `video_play {youtube_id, kind}` through `trackEvent`
 * (01 INV-59; `kind` = `short` / `mention`, else `video`) and then `onPlay`, a notification for
 * the parent (S1.8 `MentionCard` outlines itself while its facade plays).
 *
 * One iframe at a time (05 T-E2E-6): the hero, every `VideoCard` and every Shorts tile are
 * separate client roots with no shared parent, so the "who is playing" fact lives in a
 * module-level external store read with `useSyncExternalStore` — the `ViewerProvider` precedent,
 * never a React context. It is keyed by INSTANCE (`useId`), not by video: the same video can sit
 * in the hero, an Up next thumb and a Home card at once. A facade that is not the active one
 * renders `idle`; one that unmounts while active (the hero is keyed by id, so an Up next pick
 * remounts it) clears the store.
 *
 * Focus (ADR-0042 D2 precedent, `KofiCard`): the clicked button unmounts when the iframe mounts,
 * so focus moves to the iframe — after a user click only, never on first render, and never when
 * another facade's click sends this one back to `idle`.
 *
 * Sizes follow DESIGN.md §12.7 ("this section wins" — ADR-0043 D7): play block 88px `hero`, 44px
 * `upnext`, 56px `short` + `card` + `mention` (ADR-0045); same square, triangle and `5px 5px 0`
 * shadow.
 * The `CLICK TO LOAD YOUTUBE` chip hides when the facade is too narrow to hold it on one row beside
 * the duration chip (under 312px of rendered width — 03 O-19; the arithmetic is in the stylesheet)
 * with a container query — no script, no resize listener. Aspect 16:9, `short` 9:16.
 *
 * `variant="upnext"` is presentational (ADR-0043 D5): no `<button>`, no event, no iframe — the
 * `UpNextList` row `<a>` that wraps it is the one interactive element (a button inside a link is
 * invalid and fails axe `nested-interactive`); the row prints the duration as sr text itself.
 *
 * Degraded rows (04 §3.3, no `YOUTUBE_API_KEY`): `durationSeconds === null` → no chip at all.
 */
export type VideoFacadeProps = {
  youtubeId: string;
  title: string;
  thumbnailUrl: string;
  durationSeconds: number | null;
  variant: 'hero' | 'upnext' | 'short' | 'mention' | 'card';
  /** Called after the click started playback (never on `upnext`, which does not play). */
  onPlay?: () => void;
  className?: string;
};

type FacadeState = 'idle' | 'loading' | 'playing';

/* ---- the one-at-a-time store (module-level; keyed by facade instance) ---- */
let activeKey: string | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getActiveKey(): string | null {
  return activeKey;
}

/** The server (and the first client pass) never has a playing facade. */
function getServerActiveKey(): string | null {
  return null;
}

function setActiveKey(next: string | null): void {
  if (activeKey === next) return;
  activeKey = next;
  for (const listener of listeners) listener();
}

/** `next/image` `sizes` per variant — the rendered widths of 03 §2.6 / the `/videos` + Home grids. */
const SIZES: Record<VideoFacadeProps['variant'], string> = {
  hero: '(max-width: 899px) 100vw, 760px',
  mention: '(max-width: 599px) 100vw, (max-width: 899px) 50vw, 400px',
  card: '(max-width: 599px) 100vw, (max-width: 899px) 50vw, 400px',
  upnext: '132px',
  short: '104px',
};

const IFRAME_ALLOW = 'autoplay; encrypted-media; picture-in-picture; fullscreen';

export function VideoFacade({
  youtubeId,
  title,
  thumbnailUrl,
  durationSeconds,
  variant,
  onPlay,
  className,
}: VideoFacadeProps) {
  const key = useId();
  const active = useSyncExternalStore(subscribe, getActiveKey, getServerActiveKey) === key;
  const [loaded, setLoaded] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const clicked = useRef(false);

  const presentational = variant === 'upnext';
  const state: FacadeState = !active || presentational ? 'idle' : loaded ? 'playing' : 'loading';

  // Move focus to the player with the swap — after a user click only, never on first render.
  useEffect(() => {
    if (!active || !clicked.current) return;
    clicked.current = false;
    frameRef.current?.focus();
  }, [active]);

  // Unmounting while active (hero re-keyed by an Up next pick, route change) frees the slot.
  useEffect(
    () => () => {
      if (getActiveKey() === key) setActiveKey(null);
    },
    [key],
  );

  function handlePlay() {
    clicked.current = true;
    setLoaded(false);
    trackEvent('video_play', {
      youtube_id: youtubeId,
      kind: variant === 'short' ? 'short' : variant === 'mention' ? 'mention' : 'video',
    });
    setActiveKey(key);
    onPlay?.();
  }

  const chip = formatDuration(durationSeconds);
  const spoken = spokenDuration(durationSeconds);
  const classes = className ? `${styles['video-facade']} ${className}` : styles['video-facade'];

  const overlay = (
    <>
      <span className={styles['video-facade-play']} aria-hidden="true">
        <span className={styles['video-facade-triangle']} />
      </span>
      <span className={styles['video-facade-chips']} aria-hidden="true">
        <span className={styles['video-facade-hint']}>
          <PixelLabel size={11} tone="chalk">
            CLICK TO LOAD YOUTUBE
          </PixelLabel>
        </span>
        {chip === '' ? null : (
          <span className={styles['video-facade-duration']}>
            <PixelLabel size={11} informational tone={variant === 'short' ? 'gold-ink' : undefined}>
              {chip}
            </PixelLabel>
          </span>
        )}
      </span>
    </>
  );

  return (
    <div className={classes} data-variant={variant} data-state={state}>
      {state === 'playing' ? null : (
        <span className={styles['video-facade-media']}>
          {/* alt="": the button's name / the adjacent title already carry the video's name (03 C-29). */}
          {/* The hero thumbnail is the page's LCP element — eager, high priority; every other
              variant stays lazy. No preload link: a direct `?v=` load would preload the wrong one. */}
          <Image
            src={thumbnailUrl}
            alt=""
            fill
            sizes={SIZES[variant]}
            loading={variant === 'hero' ? 'eager' : undefined}
            fetchPriority={variant === 'hero' ? 'high' : undefined}
          />
          <span className={styles['video-facade-scrim']} />
        </span>
      )}
      {presentational ? (
        <span className={styles['video-facade-cover']}>{overlay}</span>
      ) : state === 'idle' ? (
        <button
          type="button"
          className={styles['video-facade-button']}
          aria-label={spoken === '' ? `Play ${title}` : `Play ${title}, ${spoken}`}
          onClick={handlePlay}
        >
          {overlay}
        </button>
      ) : (
        <iframe
          ref={frameRef}
          className={styles['video-facade-frame']}
          src={youtubeEmbedUrl(youtubeId)}
          title={title}
          allow={IFRAME_ALLOW}
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={() => setLoaded(true)}
        />
      )}
    </div>
  );
}
