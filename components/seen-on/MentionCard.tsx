'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { PixelLabel } from '@/components/primitives/PixelLabel';
import { PlatformMark } from '@/components/primitives/PlatformMark';
import { TypeBadge } from '@/components/primitives/TypeBadge';
import { VideoFacade } from '@/components/videos/VideoFacade';
import { relativeTime } from '@/lib/format/date';
import { formatCount } from '@/lib/format/number';
import {
  isPlayableInline,
  linkOutChipLabel,
  mentionThumbnail,
  type MentionCardData,
} from '@/lib/mentions';
import { youtubeWatchUrl } from '@/lib/videos';
import styles from './MentionCard.module.css';

/**
 * MentionCard — DESIGN.md §12.1 Mention card, §12.2 Seen on page footer strip; 03 §2.8
 * `MentionCard` row, 03 §3 (`idle | playing`), 03 V-04 chip wording; 00 S1.8.AC5 / AC11;
 * ADR-0002 #21 / #33; ADR-0045 D16 / D17. Client island (03 C-16a — 01 INV-08: the
 * facade swap outlines the card and brings the "on YouTube ↗" link). It never fetches (01
 * INV-09): the mention arrives as props; the type comes from the pure `lib/mentions.ts`, never
 * from the server-only data layer.
 *
 * Two cards, one shell (`<article>`, `--slab`, 2px `--line-soft` outline — no `overflow: hidden`,
 * the facade's and the thumb link's gold focus rings draw past the card's edge):
 *
 *   plays inline   a YouTube mention with a well-formed id (`isPlayableInline`) — `VideoFacade
 *                  variant="mention"` (16:9, 56px play block, `video_play {kind:'mention'}`). Its
 *                  `onPlay` flips the card to `data-state="playing"`: the outline turns
 *                  `--indigo-lift` and the ghost link "on YouTube ↗" appears at the end of the
 *                  creator row (external, new tab). The facade has no "stopped" callback, and the
 *                  one-at-a-time store silently returns it to `idle` when another facade is
 *                  clicked — so while playing the card watches its facade's own `data-state`
 *                  attribute (a `MutationObserver`) and goes back to `idle` with it: never two
 *                  outlined cards. `--indigo-lift` is the playing signal ONLY — a playable card
 *                  takes no hover outline. Focus is the facade's business (it moves to the
 *                  player); the card never moves it.
 *   links out      every other platform, and a YouTube mention without a usable id (worded
 *                  `WATCH ON YOUTUBE`). The thumb slot is the ONE `<a target="_blank">` of the
 *                  card's top: a 16:9 `--slab-sunk` well with a centred 26px `PlatformMark`, the
 *                  `↗` chip top-right and the 03 V-04 `PixelLabel` chip bottom-left
 *                  (`linkOutChipLabel`). A remote thumbnail is NEVER rendered — no `<img>`, no
 *                  `next/image` (ADR-0002 #33; 01 INV-54). Plain `<a>`, no analytics event (03
 *                  `TrackedLink` row). There is no card-wide anchor: the creator name and the
 *                  footer project title are links of their own, and a link inside a link is
 *                  invalid (axe `nested-interactive`).
 *
 * Body (both): the creator line — 26px `PlatformMark` (`role="img"`, the platform word), creator
 * name 14px 700 (its own external link when `creatorUrl` is an https URL; name + link are the
 * only creator data anywhere — AC11; the link's 44px target is a pseudo-element, 03 C-24, so the
 * two-line text block stays compact), view count Silkscreen `--emerald` 11px informational
 * (`formatCount`; omitted when the platform gave none — never "0 VIEWS"), date `--mute-dim`
 * (`relativeTime`, the `VideoCard` formatter; `suppressHydrationWarning` because the ISR HTML is
 * older than hydration) — then the mention's TITLE as one quiet `<h3>` (14px 400 `--mute`, 2-line
 * clamp): a link-out card has no thumbnail to say what it is. The creator row always holds the
 * 44px the ghost link needs, and while the link is there the date steps aside when a count is
 * shown (the two no longer fit one line beside it on a phone-width card) — so nothing moves when
 * it appears, at any width.
 *
 * `withProjectFooter` (`/seen-on` only): `--slab-foot` strip, 2px top `--line` — `TypeBadge` +
 * the project title link (13px 700 `--indigo-lift`, 44px target), or the `ODSENS` wordmark chip
 * (`PlatformMark platform="odsens"`) for a mention about OddSense generally.
 */
export type MentionCardProps = {
  mention: MentionCardData;
  /** `/seen-on` only: the `--slab-foot` strip naming the project (or the ODSENS chip). */
  withProjectFooter?: boolean;
  className?: string;
};

type CardState = 'idle' | 'playing';

/**
 * The creator link leaves the card only as an https URL. `mentions.url` carries a table CHECK
 * (`^https://`); `creator_url` is checked by `createMentionInput` alone, so the card looks again.
 */
function httpsOrNull(url: string | null): string | null {
  return url !== null && url.startsWith('https://') ? url : null;
}

/** `relativeTime` throws on a string that is no date — such a mention simply prints none. */
function readableDate(value: string | null): string | null {
  return value !== null && !Number.isNaN(Date.parse(value)) ? value : null;
}

export function MentionCard({ mention, withProjectFooter = false, className }: MentionCardProps) {
  const [state, setState] = useState<CardState>('idle');
  const thumbRef = useRef<HTMLDivElement>(null);

  // The i.ytimg literal from the data layer (a local image in the gallery fixtures); built from
  // the id when it came without one. `null` for every card that links out.
  const playable = isPlayableInline(mention) && mention.externalId !== null;
  const thumbnail = playable ? (mention.thumbnailUrl ?? mentionThumbnail(mention)) : null;
  const youtubeId = playable && thumbnail !== null ? mention.externalId : null;

  // Back to `idle` with the facade (another facade's click stops this one without telling us).
  useEffect(() => {
    if (state !== 'playing') return;
    const facade = thumbRef.current?.firstElementChild;
    if (!facade) return;
    const observer = new MutationObserver(() => {
      if (facade.getAttribute('data-state') === 'idle') setState('idle');
    });
    observer.observe(facade, { attributes: true, attributeFilter: ['data-state'] });
    return () => observer.disconnect();
  }, [state]);

  const creatorUrl = httpsOrNull(mention.creatorUrl);
  const publishedAt = readableDate(mention.publishedAt);
  // While playing, "on YouTube ↗" shares the creator row: on a phone-width card the count AND the
  // date no longer fit one line beside it, and a wrapped meta line grew the card by ~6px under the
  // visitor's finger (measured at 390). The date steps aside for as long as the link is there — the
  // pass-3 playing artboard drops the whole line; the count stays, and a card with no count keeps
  // its date (that pair always fits), so the row never loses its second line.
  const showDate = publishedAt !== null && !(state === 'playing' && mention.viewCount !== null);
  const hasMeta = mention.viewCount !== null || showDate;
  const classes = className ? `${styles['mention-card']} ${className}` : styles['mention-card'];

  return (
    <article
      className={classes}
      data-state={state}
      data-variant={youtubeId !== null ? 'inline' : 'link-out'}
    >
      {youtubeId !== null && thumbnail !== null ? (
        <div ref={thumbRef} className={styles['mention-card-thumb']}>
          <VideoFacade
            className={styles['mention-card-facade']}
            youtubeId={youtubeId}
            title={mention.title}
            thumbnailUrl={thumbnail}
            durationSeconds={null}
            variant="mention"
            onPlay={() => setState('playing')}
          />
        </div>
      ) : (
        <div className={styles['mention-card-thumb']}>
          <a
            className={styles['mention-card-out']}
            href={mention.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {/* The placeholder, not a thumbnail (ADR-0002 #33). Decorative here: the creator line
                below carries the same mark as `role="img"`. */}
            <span className={styles['mention-card-well']} aria-hidden="true">
              <PlatformMark platform={mention.platform} size={26} />
            </span>
            <span className={styles['mention-card-arrow']} aria-hidden="true">
              ↗
            </span>
            <span className={styles['mention-card-chip']}>
              <PixelLabel size={11} tone="chalk" className={styles['mention-card-chip-label']}>
                {linkOutChipLabel(mention.platform, mention.url)}
              </PixelLabel>
            </span>
            <span className="visually-hidden">{`: ${mention.title} (opens in new tab)`}</span>
          </a>
        </div>
      )}

      <div className={styles['mention-card-body']}>
        <div className={styles['mention-card-creator']}>
          <PlatformMark platform={mention.platform} size={26} />
          <div className={styles['mention-card-who']}>
            <p className={styles['mention-card-name']}>
              {creatorUrl !== null ? (
                <a
                  className={styles['mention-card-name-link']}
                  href={creatorUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span className={styles['mention-card-name-text']}>{mention.creatorName}</span>
                  <span className="visually-hidden"> (opens in new tab)</span>
                </a>
              ) : (
                <span className={styles['mention-card-name-text']}>{mention.creatorName}</span>
              )}
            </p>
            {hasMeta ? (
              <p className={styles['mention-card-meta']}>
                {mention.viewCount !== null ? (
                  <PixelLabel size={11} informational tone="emerald">
                    {`${formatCount(mention.viewCount)} ${mention.viewCount === 1 ? 'VIEW' : 'VIEWS'}`}
                  </PixelLabel>
                ) : null}
                {publishedAt !== null && showDate ? (
                  <time
                    className={styles['mention-card-date']}
                    dateTime={publishedAt}
                    suppressHydrationWarning
                  >
                    {relativeTime(publishedAt)}
                  </time>
                ) : null}
              </p>
            ) : null}
          </div>
          {state === 'playing' && youtubeId !== null ? (
            <a
              className={styles['mention-card-watch']}
              href={youtubeWatchUrl(youtubeId)}
              target="_blank"
              rel="noopener noreferrer"
            >
              on YouTube ↗<span className="visually-hidden"> (opens in new tab)</span>
            </a>
          ) : null}
        </div>
        <h3 className={styles['mention-card-title']}>{mention.title}</h3>
      </div>

      {withProjectFooter ? (
        <div className={styles['mention-card-foot']}>
          {mention.project !== null ? (
            <>
              <TypeBadge type={mention.project.type} />
              <Link
                className={styles['mention-card-project']}
                href={`/projects/${mention.project.slug}`}
              >
                {mention.project.title}
              </Link>
            </>
          ) : (
            <PlatformMark platform="odsens" size={26} />
          )}
        </div>
      ) : null}
    </article>
  );
}
