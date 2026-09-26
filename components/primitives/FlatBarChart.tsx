import type { ReactElement } from 'react';
import { SourceSwatch } from '@/components/primitives/SourceSwatch';
import { sectionTitleId } from '@/components/primitives/SectionTitle';
import { formatDay } from '@/lib/format/date';
import { formatCount } from '@/lib/format/number';
import { DOWNLOAD_SOURCES, type DownloadSource } from '@/lib/format/project';
import {
  AXIS_END,
  AXIS_START,
  COMPACT_NOTE,
  bucketDays,
  stackedMax,
  type DailyDownloads,
} from '@/lib/stats';
import styles from './FlatBarChart.module.css';

/**
 * FlatBarChart — DESIGN.md §11.1 Flat bar chart ("stacked columns on a `--slab-sunk` well with 2px
 * `--line-soft`, 2–4px gaps, no axes/gradients/rounded caps"; Y labels + `30 DAYS AGO / TODAY` in
 * Silkscreen 11px; "Phone shows 15 bars (two days each) and says so"); 03 §2.2 `FlatBarChart`
 * (inline SVG, no lib — 01 INV-78 / ADR-R5 — no client JS); 00 §S1.9 AC2 / AC3 / AC10. Server
 * Component, not on the C-16a island list. First use: `/admin/stats` (02 §1.3, S1.9; T-E2E-40).
 *
 * As built (ADR-0049 D12): ONE root `<div data-variant>` renders BOTH variants — the full chart (30
 * columns, `<figure data-full>`) and the compact chart (15 columns of two-day sums, `<figure
 * data-compact>`) — and CSS toggles them at `--bp-phone` (≤ 599px shows compact); `compact` forces
 * one (`true` → compact only, `false` → full only — the gallery fixtures and any caller that knows
 * its width). The hidden variant is `display: none`, so it leaves the a11y tree. Each figure = a
 * pixel-label Y column beside a `--slab-sunk` well holding one `<svg role="img"
 * aria-labelledby aria-describedby preserveAspectRatio="none" viewBox="0 0 <bars*10> 100">` whose
 * first child a `<title>` (the `title` prop; the compact one adds the note — the inline-SVG label
 * 05 T-E2E-48's guard requires of every `svg[role=img]`; `aria-labelledby` still names it) and whose
 * columns are `<g data-day>` groups of up to three `<rect data-source>` (bottom → top: modrinth ·
 * curseforge · direct; radius 0, no stroke, no gradient; a zero value draws no rect), heights scaled
 * to the variant's stacked max; the two end labels under it; the legend (`SourceSwatch` ×3 — a
 * swatch AND the word, 03 C-26); a `<figcaption>` that says "15 bars, two days each" (compact,
 * visible) or "Daily" (full, visually hidden) so each variant's description means something. The
 * axis labels are HTML `<span>`s — never `<text>` — so Silkscreen 11px holds at every width while
 * the SVG stretches; they are `aria-hidden`, the table below carries the numbers.
 *
 * Text alternative (00 AC10; 03 §2.2 a11y): ONE `<table data-testid="flat-bar-chart-table">` inside
 * a `visually-hidden` wrapper `<div>` after the variants (a table ignores the recipe's 1px width —
 * ADR-0049 D28 e) — caption = `title`, columns Day · Modrinth ·
 * CurseForge · Direct · Total, one row per daily entry (dates through `formatDay`, UTC — ADR-0049 D25).
 * The accessible name is the PARENT's visible heading via `titleId` (the component renders no
 * heading); without one the SVGs are labelled by the hidden table's caption, which carries `title`
 * — every generated id derives from that base so several charts can share a page. Bar geometry:
 * 9-unit bars at a 10-unit pitch ⇒ a 1-unit gap (≈ 2px at 390, ≈ 3–4px at 1280 — the §11.1 range).
 * No hover state, no tooltip, nothing interactive.
 */
export type FlatBarChartProps = {
  /** The 30 daily entries (`chartDays` output); fewer/more are rendered as given. */
  days: DailyDownloads[];
  /** The hidden table's `<caption>`; also the default accessible name when no `titleId`. */
  title: string;
  /** `undefined` → both variants + the CSS toggle; `true` / `false` force one (ADR-0049 D12). */
  compact?: boolean;
  /** The parent's visible heading id → `svg[aria-labelledby]`. */
  titleId?: string;
  className?: string;
};

type Variant = 'full' | 'compact';

/** viewBox units per column: a 9-unit bar + a 1-unit gap. */
const PITCH = 10;
const BAR_WIDTH = 9;
const BAR_INSET = (PITCH - BAR_WIDTH) / 2;
/** viewBox height — every column is scaled to 100 = the variant's stacked max. */
const PLOT_HEIGHT = 100;

/** Stack order, bottom → top (the biggest series sits on the floor). */
const STACK: readonly DownloadSource[] = DOWNLOAD_SOURCES;

/** SVG attribute number: at most three decimals, no `-0`, no exponent. */
function unit(n: number): string {
  const rounded = Math.round(n * 1000) / 1000;
  return String(rounded === 0 ? 0 : rounded);
}

type ColumnProps = { day: DailyDownloads; index: number; max: number };

/** One `<g data-day>` column: up to three stacked rects, zero values draw nothing. */
function Column({ day, index, max }: ColumnProps) {
  const x = unit(index * PITCH + BAR_INSET);
  const rects: ReactElement[] = [];
  let floor = PLOT_HEIGHT; // the y where the next rect's bottom sits
  for (const source of STACK) {
    const value = day[source];
    if (max <= 0 || value <= 0) continue;
    const height = (value / max) * PLOT_HEIGHT;
    floor -= height;
    rects.push(
      <rect
        key={source}
        data-source={source}
        x={x}
        y={unit(floor)}
        width={BAR_WIDTH}
        height={unit(height)}
      />,
    );
  }
  return <g data-day={day.date}>{rects}</g>;
}

type FigureProps = {
  variant: Variant;
  days: readonly DailyDownloads[];
  labelledBy: string;
  captionId: string;
  /** The `<title>` inside the SVG — the `title` prop, with the variant's note for the compact one. */
  svgTitle: string;
};

function Figure({ variant, days, labelledBy, captionId, svgTitle }: FigureProps) {
  const bars = bucketDays(days, variant === 'compact');
  const max = stackedMax(bars);
  const variantAttr = variant === 'compact' ? { 'data-compact': '' } : { 'data-full': '' };
  // Y labels: 0 · half · max through `formatCount`; when the max is 0 only `0` (ADR-0049 D12).
  const yLabels = max > 0 ? [formatCount(max), formatCount(max / 2), '0'] : ['0'];
  return (
    <figure className={styles['flat-bar-chart-figure']} {...variantAttr}>
      <div className={styles['flat-bar-chart-y']} aria-hidden="true">
        {yLabels.map((label, i) => (
          <span key={`${i}-${label}`} className={styles['flat-bar-chart-pixel']}>
            {label}
          </span>
        ))}
      </div>
      <div className={styles['flat-bar-chart-well']}>
        <svg
          className={styles['flat-bar-chart-svg']}
          role="img"
          aria-labelledby={labelledBy}
          aria-describedby={captionId}
          preserveAspectRatio="none"
          viewBox={`0 0 ${Math.max(1, bars.length) * PITCH} ${PLOT_HEIGHT}`}
        >
          {/* The inline-SVG label every `svg[role=img]` on the site carries (05 T-E2E-48's guard);
              `aria-labelledby` above still wins the accessible name — this is its fallback. */}
          <title>{svgTitle}</title>
          {bars.map((day, index) => (
            <Column key={day.date} day={day} index={index} max={max} />
          ))}
        </svg>
      </div>
      <div className={styles['flat-bar-chart-x']} aria-hidden="true">
        <span className={styles['flat-bar-chart-pixel']}>{AXIS_START}</span>
        <span className={styles['flat-bar-chart-pixel']}>{AXIS_END}</span>
      </div>
      <div className={styles['flat-bar-chart-legend']}>
        {DOWNLOAD_SOURCES.map((source) => (
          <SourceSwatch key={source} source={source} />
        ))}
      </div>
      <figcaption
        id={captionId}
        className={variant === 'compact' ? styles['flat-bar-chart-note'] : 'visually-hidden'}
      >
        {variant === 'compact' ? COMPACT_NOTE : 'Daily'}
      </figcaption>
    </figure>
  );
}

export function FlatBarChart({
  days,
  title,
  compact,
  titleId,
  className,
}: FlatBarChartProps): ReactElement {
  const variant = compact === undefined ? 'both' : compact ? 'compact' : 'full';
  const base = titleId ?? sectionTitleId(title);
  const tableCaptionId = `${base}-table-caption`;
  const labelledBy = titleId ?? tableCaptionId;
  const classes = className ? `${styles['flat-bar-chart']} ${className}` : styles['flat-bar-chart'];
  return (
    <div className={classes} data-variant={variant}>
      {variant !== 'compact' ? (
        <Figure
          variant="full"
          days={days}
          labelledBy={labelledBy}
          captionId={`${base}-full-note`}
          svgTitle={title}
        />
      ) : null}
      {variant !== 'full' ? (
        <Figure
          variant="compact"
          days={days}
          labelledBy={labelledBy}
          captionId={`${base}-compact-note`}
          svgTitle={`${title} — ${COMPACT_NOTE}`}
        />
      ) : null}
      {/* The wrapper carries the recipe: a bare `<table>` ignores its 1px width (min-content wins) and
          its box widened the document by 3px at 390 in the gallery (ADR-0049 D28 e). */}
      <div className="visually-hidden">
        <table data-testid="flat-bar-chart-table">
          <caption id={tableCaptionId}>{title}</caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Modrinth</th>
              <th scope="col">CurseForge</th>
              <th scope="col">Direct</th>
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day.date}>
                <th scope="row">{formatDay(day.date)}</th>
                <td>{day.modrinth}</td>
                <td>{day.curseforge}</td>
                <td>{day.direct}</td>
                <td>{day.modrinth + day.curseforge + day.direct}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
