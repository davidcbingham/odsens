/**
 * Icon — inline SVG on a 24px grid, 2px stroke, square caps and joins, `currentColor`
 * (DESIGN.md §4; 03 §2.2 `Icon`). The four project-type glyphs (square, diamond, triangle,
 * circle) are filled solids. No `.module.css` (03 C-01 exemption). Decorative by default
 * (`aria-hidden="true"`); pass `title` for a labelled `role="img"`.
 */
export const ICON_NAMES = [
  'menu',
  'close',
  'arrow-left',
  'arrow-right',
  'chevron-down',
  'external',
  'lock',
  'search',
  'drag',
  'play',
  'download',
  'upload',
  'check',
  'x',
  'square',
  'diamond',
  'triangle',
  'circle',
] as const;

export type IconName = (typeof ICON_NAMES)[number];

export type IconProps = {
  name: IconName;
  size?: 16 | 20 | 24;
  title?: string;
  className?: string;
};

type Glyph = { paths: string[]; filled?: boolean };

const GLYPHS: Record<IconName, Glyph> = {
  menu: { paths: ['M3 6h18', 'M3 12h18', 'M3 18h18'] },
  close: { paths: ['M5 5l14 14', 'M19 5L5 19'] },
  'arrow-left': { paths: ['M20 12H4', 'M10 6l-6 6 6 6'] },
  'arrow-right': { paths: ['M4 12h16', 'M14 6l6 6-6 6'] },
  'chevron-down': { paths: ['M6 9l6 6 6-6'] },
  external: { paths: ['M14 4h6v6', 'M20 4L11 13', 'M18 14v6H4V6h6'] },
  lock: { paths: ['M5 11h14v10H5z', 'M8 11V7a4 4 0 0 1 8 0v4'] },
  search: { paths: ['M11 5a6 6 0 1 1 0 12 6 6 0 0 1 0-12z', 'M16 16l5 5'] },
  drag: {
    paths: ['M9 6h.01', 'M15 6h.01', 'M9 12h.01', 'M15 12h.01', 'M9 18h.01', 'M15 18h.01'],
  },
  play: { paths: ['M7 4l13 8-13 8z'] },
  download: { paths: ['M12 4v12', 'M6 10l6 6 6-6', 'M4 20h16'] },
  upload: { paths: ['M12 20V8', 'M6 14l6-6 6 6', 'M4 4h16'] },
  check: { paths: ['M4 12l5 5L20 7'] },
  x: { paths: ['M7 7l10 10', 'M17 7L7 17'] },
  square: { paths: ['M5 5h14v14H5z'], filled: true },
  diamond: { paths: ['M12 3l9 9-9 9-9-9z'], filled: true },
  triangle: { paths: ['M12 4l9 16H3z'], filled: true },
  circle: { paths: ['M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z'], filled: true },
};

export function Icon({ name, size = 24, title, className }: IconProps) {
  const glyph = GLYPHS[name];
  const labelled = typeof title === 'string' && title.length > 0;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={glyph.filled ? 'currentColor' : 'none'}
      stroke={glyph.filled ? 'none' : 'currentColor'}
      strokeWidth={2}
      strokeLinecap="square"
      strokeLinejoin="miter"
      focusable="false"
      data-icon={name}
      {...(labelled ? { role: 'img' } : { 'aria-hidden': 'true' })}
    >
      {labelled ? <title>{title}</title> : null}
      {glyph.paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
