import { Icon } from '@/components/primitives/Icon';
import { PixelLabel } from '@/components/primitives/PixelLabel';
import { PlatformMark } from '@/components/primitives/PlatformMark';
import { SourceSwatch } from '@/components/primitives/SourceSwatch';
import { TrackedLink } from '@/components/primitives/TrackedLink';
import { COMBINED_COUNT_LINE } from '@/lib/format/downloads';
import { formatCount } from '@/lib/format/number';
import { sourceWord } from '@/lib/format/project';
import { formatFileSize } from '@/lib/format/size';
import styles from './GetItPanel.module.css';

/**
 * GetItPanel — DESIGN.md §6 #3 rail ("sticky "GET IT" panel: big primary download + file meta +
 * Modrinth/CurseForge rows with their own counts + a line explaining the combined count"; phone:
 * a section, not a sticky bar); 03 §2.3 `GetItPanel` row. Server Component (03 C-16).
 *
 * The big download is the PRIMARY look for every `kind` — gold is reserved for the
 * `FeaturedHero` DOWNLOAD and support/tip actions (DESIGN.md §5; 03). Because every download
 * link must be a `TrackedLink event="download"` `{ project: slug, source, from: 'get-it' }`
 * (03 §2.2 emitters; ADR-0002 A10 — `download` is S1.2's one wired event) and `TrackedLink`
 * renders a plain `<a>` with no `data-variant`, the primary-button look lives in this module's
 * CSS (tokens only) rather than on a `Button` — flagged for the wiring pass against the 05
 * `data-variant="primary"` e2e locator. External platform rows open in a new tab
 * (`rel="noopener noreferrer"` + sr "(opens in new tab)" via `TrackedLink`). Sticky rail =
 * `data-sticky` flag (03 C-14), applied ≥900px with `top` under the nav (`--nav-h`).
 * Combined-count line: `COMBINED_COUNT_LINE` verbatim (03; 05 T-UNIT-11).
 */
export type GetItPanelProps = {
  primary: {
    kind: 'direct' | 'modrinth' | 'curseforge';
    href: string;
    /** e.g. `DOWNLOAD` / `DOWNLOAD 1.21.4`. */
    label: string;
    fileMeta?: {
      filename: string;
      sizeBytes: number;
      sha512?: string;
      gameVersions: string[];
      loaders: string[];
    };
  };
  rows: { platform: 'modrinth' | 'curseforge'; href: string; downloads: number }[];
  combined: { total: number; direct: number };
  slug: string;
  className?: string;
};

export function GetItPanel({ primary, rows, combined, slug, className }: GetItPanelProps) {
  const classes = className ? `${styles['get-it-panel']} ${className}` : styles['get-it-panel'];
  // Deterministic per-slug id (Server Component, no useId): unique per page and per fixture.
  const labelId = `get-it-${slug}`;
  const meta = primary.fileMeta;

  return (
    <aside className={classes} aria-labelledby={labelId} data-sticky="">
      <div id={labelId} className={styles['get-it-eyebrow']}>
        <PixelLabel size={10} tone="mute-dim">
          GET IT
        </PixelLabel>
      </div>
      <TrackedLink
        event="download"
        props={{ project: slug, source: primary.kind, from: 'get-it' }}
        href={primary.href}
        className={styles['get-it-download']}
      >
        {primary.label}
      </TrackedLink>
      {meta ? (
        <p className={styles['get-it-meta']}>
          {[meta.loaders.join(', '), formatFileSize(meta.sizeBytes), meta.filename]
            .filter((part) => part !== '')
            .join(' · ')}
        </p>
      ) : null}
      {rows.length > 0 || combined.direct > 0 ? (
        <ul className={styles['get-it-rows']}>
          {rows.map((row) => (
            <li key={row.platform}>
              <TrackedLink
                event="download"
                props={{ project: slug, source: row.platform, from: 'get-it' }}
                href={row.href}
                target="_blank"
                className={styles['get-it-row']}
              >
                <PlatformMark platform={row.platform} size={24} />
                <span className={styles['get-it-row-word']}>{sourceWord(row.platform)}</span>
                <PixelLabel
                  size={11}
                  informational
                  tone="emerald"
                  className={styles['get-it-row-count']}
                >
                  {`${formatCount(row.downloads)} ↓`}
                </PixelLabel>
                <Icon name="external" size={16} className={styles['get-it-row-glyph']} />
              </TrackedLink>
            </li>
          ))}
          {combined.direct > 0 ? (
            <li className={styles['get-it-direct']}>
              <SourceSwatch source="direct" />
              <PixelLabel
                size={11}
                informational
                tone="emerald"
                className={styles['get-it-row-count']}
              >
                {`${formatCount(combined.direct)} ↓`}
              </PixelLabel>
            </li>
          ) : null}
        </ul>
      ) : null}
      <p className={styles['get-it-combined']}>{COMBINED_COUNT_LINE}</p>
    </aside>
  );
}
