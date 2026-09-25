'use client';

import { useSearchParams } from 'next/navigation';
import { useState, type MouseEvent, type ReactNode } from 'react';
import { Toggle } from '@/components/primitives/Toggle';
import { TrackedLink } from '@/components/primitives/TrackedLink';
import { SkinCard } from '@/components/skins-art/SkinCard';
import { SkinViewer3D } from '@/components/skins-art/SkinViewer3D';
import { selectSkin, skinDownloadHref, type SkinStageItem } from '@/lib/skins';
import styles from './SkinsStage.module.css';

/**
 * SkinsStage — DESIGN.md §6 #5 Skins ("The big panel is a live spinnable viewer … Name +
 * description + DOWNLOAD PNG + Slim toggle sit under the viewer; selected card takes the
 * indigo-lift outline"); pass-3 Skins artboard (viewer slab with the details block, 4-up card
 * grid); 03 §2.7 (`SkinViewer3D`, `SkinCard`), §2.2 `TrackedLink` emitter "the /skins detail
 * panel DOWNLOAD PNG", C-13, C-17, C-19; 04 §5.6 `download {project:'skin:<slug>', source:'direct',
 * from:'skin'}`; 00 S1.7.AC2–AC4; S1.7 D13 / D16 / D22 / D22 (ADR-0048). Client island
 * (03 C-16a). The `VideoStage` precedent (ADR-0043 D4): `/skins` is ISR and may not read
 * `searchParams` (02 RP-02 / RP-03), so ONE island owns the `?skin=` selection. It never fetches:
 * the published list arrives as props (01 INV-09); the only network here is skinview3d's own
 * texture load inside `SkinViewer3D` (C-17 exception 2) and `trackEvent` on the download click.
 *
 * Two exports, one view:
 *   `SkinsStage`      reads `?skin=` with `useSearchParams` — the page wraps it in `<Suspense>`.
 *                     `selectSkin` checks the value against `skins`; absent / unknown → the first
 *                     skin (the reader's `sort_order` — SEED-7 puts `seed-skin-b` first).
 *   `SkinsStageView`  the same markup for a given `selectedSlug`, no URL read — the page's
 *                     `<Suspense>` FALLBACK with `null`, so the ISR HTML already holds the stage
 *                     and the resolved island renders identical markup for the default selection.
 *
 * Layout: the viewer well (`SkinViewer3D` stage — `--slab-sunk`, 2px `--line-soft`, 3:4 under
 * 900px / 4:3 above, the controls on a slab inside it) with the details slab: `<h2>` name in
 * Bungee, the server-rendered description (`descriptions[slug]`, a `Markdown` element passed as a
 * prop — C-19 server-rendered children; nothing when the skin has none), DOWNLOAD PNG (a
 * `TrackedLink` with the `download` attribute — the route answers 302 to the public texture with
 * `?download=<slug>.png`, ADR-0048 D22 — wearing the `GetItPanel` primary look) and the Slim toggle.
 * From 900px the slab sits beside the well (the `VideoStage` player + rail grid, 1.6fr / 1fr, so
 * the viewer and its controls stay in the first screen); below, it sits under the well as
 * DESIGN.md words it. Then the `<ul>` grid of `SkinCard`s, 4 / 2 / 1-up at 900 / 600.
 *
 * Selection: each card is ONE `<a href="?skin=<slug>">`; one delegated click handler on the list
 * turns a plain left click into `window.history.replaceState` — Next syncs it into
 * `useSearchParams` with no server round-trip and no scroll (02 RP-02; ADR-0043 D24) — and this
 * view re-renders: the viewer swaps its texture IN PLACE (`SkinViewer3D` loads the new URL into the
 * live instance — no `key`, no rebuild), the name / description / href swap, `aria-current` moves.
 * Focus stays on the clicked card (cards are keyed by slug); on first render nothing takes it.
 *
 * Slim: local state, defaulting to the SELECTED skin's own model and reset by a new selection
 * (kept as `{ slug, slim }` so no effect is needed); it switches the viewer's `model` prop only —
 * the download is always the stored PNG. `skins.length === 0` → renders nothing (the page shows
 * the §11.7 empty state instead).
 */
export type SkinsStageProps = {
  /** Published skins in stage order (`listPublishedSkins`). */
  skins: SkinStageItem[];
  /** `slug` → the server-rendered `Markdown` of `description_md`; absent when the skin has none. */
  descriptions: Record<string, ReactNode>;
  className?: string;
};

export type SkinsStageViewProps = SkinsStageProps & {
  /** `slug` of the skin in the big viewer; `null` / unknown → the first. */
  selectedSlug: string | null;
};

const DOWNLOAD_LABEL = 'DOWNLOAD PNG';
const SLIM_LABEL = 'Slim arms';

/** `?skin=<slug>` (02 §1.1 row `/skins`). */
function hrefFor(slug: string): string {
  return `?skin=${encodeURIComponent(slug)}`;
}

export function SkinsStage({ skins, descriptions, className }: SkinsStageProps) {
  const selectedSlug = useSearchParams().get('skin');
  return (
    <SkinsStageView
      skins={skins}
      descriptions={descriptions}
      selectedSlug={selectedSlug}
      className={className}
    />
  );
}

export function SkinsStageView({
  skins,
  descriptions,
  selectedSlug,
  className,
}: SkinsStageViewProps) {
  // The Slim override belongs to one selection: a new pick falls back to that skin's own model.
  const [slimOverride, setSlimOverride] = useState<{ slug: string; slim: boolean } | null>(null);

  const selected = selectSkin(skins, selectedSlug);
  if (selected === null) return null;

  const slim =
    slimOverride !== null && slimOverride.slug === selected.slug
      ? slimOverride.slim
      : selected.model === 'slim';
  const description = descriptions[selected.slug] ?? null;

  const select = (event: MouseEvent<HTMLUListElement>) => {
    // Modified clicks (new tab / window) keep the browser's own behaviour.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)
      return;
    const target = event.target instanceof Element ? event.target : null;
    const anchor = target?.closest('a');
    if (!(anchor instanceof HTMLAnchorElement) || !event.currentTarget.contains(anchor)) return;
    const href = anchor.getAttribute('href');
    if (href === null || !href.startsWith('?skin=')) return;
    event.preventDefault();
    window.history.replaceState(null, '', href);
  };

  const classes = className ? `${styles['skins-stage']} ${className}` : styles['skins-stage'];

  return (
    <div className={classes}>
      <div className={styles['skins-stage-top']}>
        <SkinViewer3D
          className={styles['skins-stage-viewer']}
          textureUrl={selected.textureUrl}
          model={slim ? 'slim' : 'classic'}
          name={selected.name}
          bustFallbackUrl={selected.bustUrl}
        />
        <div className={styles['skins-stage-panel']}>
          <h2 className={styles['skins-stage-name']}>{selected.name}</h2>
          {description === null ? null : (
            <div className={styles['skins-stage-desc']}>{description}</div>
          )}
          <TrackedLink
            event="download"
            props={{ project: `skin:${selected.slug}`, source: 'direct', from: 'skin' }}
            href={skinDownloadHref(selected.id)}
            download
            data-variant="primary"
            className={styles['skins-stage-download']}
          >
            {DOWNLOAD_LABEL}
          </TrackedLink>
          <div className={styles['skins-stage-slim']}>
            <span className={styles['skins-stage-slim-word']} aria-hidden="true">
              {SLIM_LABEL}
            </span>
            <Toggle
              name="slim"
              role="switch"
              accent="indigo"
              label={SLIM_LABEL}
              checked={slim}
              onChange={(value) => setSlimOverride({ slug: selected.slug, slim: value })}
            />
          </div>
        </div>
      </div>

      <ul className={styles['skins-stage-grid']} onClick={select}>
        {skins.map((skin) => (
          <li key={skin.slug} className={styles['skins-stage-item']}>
            <SkinCard
              skin={skin}
              selected={skin.slug === selected.slug}
              href={hrefFor(skin.slug)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
