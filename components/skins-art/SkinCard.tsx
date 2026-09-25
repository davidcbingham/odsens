import Image from 'next/image';
import { ExclusiveBadge } from '@/components/primitives/ExclusiveBadge';
import { SkinViewer3D } from '@/components/skins-art/SkinViewer3D';
import type { SkinModel } from '@/lib/skins';
import styles from './SkinCard.module.css';

/**
 * SkinCard — DESIGN.md §6 #5 Skins ("the 4-up grid shows rendered busts in 3:4 slots with the
 * 64×64 source PNG pinned small in the corner for reference … selected card takes the indigo-lift
 * outline; exclusive badge available here too"), §4 (`image-rendering: pixelated`), §5 "Exclusive
 * badge"; pass-3 Skins artboard (slab card, 3:4 sunk slot with a 2px bottom rule, name under it);
 * 03 §2.7 `SkinCard` row, C-13 (`aria-current`), C-14 (`data-exclusive`), C-29; 00 S1.7.AC3 /
 * AC10; S1.7 D14 / D15 (ADR-0048). Shared component (no directive — 03 C-16 "not on the list"):
 * rendered inside the `SkinsStage` island (the `ProjectCard`-in-`ProjectGrid` precedent) and on
 * `/dev/components`.
 *
 * Slab, 2px `--line-soft` outline (`--gold` when `data-exclusive`, `--indigo-lift` when selected —
 * the selection wins), hover / focus-within: `--slab-raised`, `--indigo-lift` outline, `6px 6px 0
 * --indigo-deep`, translate −3/−3 (the `ProjectCard` idiom). Whole card is ONE `<a href="?skin=
 * <slug>">` — the parent island turns the click into `history.replaceState` (02 RP-02: the URL is
 * the state); without JS the link is a plain reload of the default selection. `aria-current="true"`
 * on the selected card's link (03 C-13); the CSS keys on it through `:has()`, so the global gold
 * focus ring on the link and the card's own outline stay two separate rings.
 *
 * The 3:4 slot (`--slab-sunk`, 2px `--line-soft` bottom rule): the cached bust through `next/image`
 * (`fill`, `object-fit: cover`, pixelated — DESIGN.md §4 Minecraft imagery; alt "<name> skin, 3D
 * render"), or — `bustUrl === null`, the render job has not landed (00 S1.7.AC3 "client-render
 * fallback") — `<SkinViewer3D variant="bust">`: one live WebGL frame, no controls, its own Skeleton
 * while the chunk loads (ADR-0048 D14 / D15). The 64×64 source PNG sits bottom-right at 1× (64px native,
 * `image-rendering: pixelated`, 2px `--line`, `alt=""` — a decorative duplicate of the render,
 * 03 row). The name is Bungee 17px, two line boxes always (a wrap cannot move the grid).
 *
 * `ExclusiveBadge` pins to the card's top-left corner over the outline by 1px (DESIGN.md §5),
 * OUTSIDE the `<a>` so the card stays one link; never rendered unless `exclusive`.
 */
export type SkinCardProps = {
  skin: {
    slug: string;
    name: string;
    /** Public URL of the cached bust render; `null` → the live bust fallback (ADR-0048 D14 / D15). */
    bustUrl: string | null;
    /** Public URL of the 64×64 texture: the corner reference, and the live fallback's source. */
    textureUrl: string;
    exclusive: boolean;
    model: SkinModel;
  };
  /** The skin in the big viewer → `aria-current="true"` + the `--indigo-lift` outline. */
  selected: boolean;
  /** `?skin=<slug>` — the island rewrites it with `history.replaceState`. */
  href: string;
  className?: string;
};

/** 4-up at ≥900px inside `--measure-page`, 2-up 600–899, 1-up below (SkinsStage.module.css). */
const BUST_SIZES = '(max-width: 599px) 100vw, (max-width: 899px) 50vw, 300px';

export function SkinCard({ skin, selected, href, className }: SkinCardProps) {
  const { name, bustUrl, textureUrl, exclusive, model } = skin;
  const rootClass = className ? `${styles['skin-card']} ${className}` : styles['skin-card'];

  return (
    <article className={rootClass} {...(exclusive ? { 'data-exclusive': '' } : {})}>
      {exclusive ? <ExclusiveBadge className={styles['skin-card-badge']} /> : null}
      <a
        href={href}
        className={styles['skin-card-link']}
        aria-current={selected ? 'true' : undefined}
      >
        <div className={styles['skin-card-slot']}>
          {bustUrl !== null ? (
            <Image
              src={bustUrl}
              alt={`${name} skin, 3D render`}
              fill
              sizes={BUST_SIZES}
              className={styles['skin-card-bust']}
            />
          ) : (
            <SkinViewer3D
              variant="bust"
              textureUrl={textureUrl}
              model={model}
              name={name}
              bustFallbackUrl={null}
              className={styles['skin-card-live']}
            />
          )}
          <Image
            src={textureUrl}
            alt=""
            width={64}
            height={64}
            unoptimized
            className={styles['skin-card-source']}
          />
        </div>
        <div className={styles['skin-card-body']}>
          <h3 className={styles['skin-card-name']}>{name}</h3>
        </div>
      </a>
    </article>
  );
}
