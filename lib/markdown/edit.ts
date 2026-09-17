/**
 * lib/markdown/edit.ts — the Markdown toolbar's selection maths (ADR-0039 D4; 03 §2.10
 * `MarkdownEditor` "selection commands via `applyMarkdownCommand`"; 00 S1.5c.AC4; DESIGN.md v1.10
 * §11.3 #20 toolbar; 05 T-UNIT-52).
 *
 * Pure and client-safe — no DOM, no directive, no imports, no regex: plain string arithmetic over
 * `(value, selectionStart, selectionEnd)`, so the island calls it on the textarea's current
 * selection, sets the returned value and restores the returned selection. Selection bounds are
 * clamped to `[0, value.length]` (and swapped when reversed) before anything else. CRLF is not
 * special — lines split on `\n` only and a `\r` stays where it was; text outside the edit is
 * byte-identical; every result satisfies `0 <= selectionStart <= selectionEnd <= value.length`.
 *
 *   applyMarkdownCommand(value, start, end, command) → { value, selectionStart, selectionEnd }
 *     - inline wraps (bold `**`, italic `_`, strike `~~`, code `` ` ``): wrap the selection and keep
 *       the inner text selected; a caret gets both markers with the caret between them; when the
 *       selected text is already exactly wrapped, or the markers sit immediately outside the
 *       selection, they are removed instead (toggle off) and the inner text stays selected.
 *     - line prefixes (h1–h3 `#`s, bullet `- `, numbered `1. ` renumbered per line, quote `> `):
 *       every line the selection touches, first line start → last line end; headings replace an
 *       existing `#{1,6} ` of any level, numbered replaces an existing number; a line that already
 *       carries the prefix is not doubled; each command toggles off (strips) when EVERY touched line
 *       already carries exactly that prefix (headings: that level; numbered: any number). A
 *       selection then spans the rewritten lines; a caret keeps its place in the text (the empty
 *       value → the prefix alone with the caret after it).
 *     - link / image / youtube: templates with the part to fill in selected (see each helper).
 *   MARKDOWN_COMMANDS — toolbar order, labels, glyphs, groups and the two shortcuts; the editor
 *     renders from it. commandTitle(id) → 'Bold (Ctrl+B)' / 'Italic (Ctrl+I)' / the label.
 */

export type MarkdownCommand =
  | 'h1'
  | 'h2'
  | 'h3'
  | 'bold'
  | 'italic'
  | 'strike'
  | 'code'
  | 'bullet'
  | 'numbered'
  | 'quote'
  | 'link'
  | 'image'
  | 'youtube';

export type MarkdownEdit = { value: string; selectionStart: number; selectionEnd: number };

/** One toolbar button, as `MarkdownEditor` renders it (03 §2.10; DESIGN.md v1.10 §11.3 #20). */
export type MarkdownCommandSpec = {
  id: MarkdownCommand;
  /** Accessible name (`aria-label`). */
  label: string;
  /** Text glyphs in `--font-body` 700; icon glyphs from `Icon` (ADR-0040 D2 adds the six names). */
  glyph:
    | { kind: 'text'; text: string }
    | { kind: 'icon'; name: 'list' | 'list-ordered' | 'quote' | 'link' | 'image' | 'video' };
  /** Ctrl/Cmd+B → bold, Ctrl/Cmd+I → italic. */
  shortcut?: 'b' | 'i';
  /** H1 H2 H3 · B I S </> · bullet numbered quote · link image YouTube (2px `--line` separators). */
  group: 1 | 2 | 3 | 4;
};

/** Toolbar order + labels — the single source the MarkdownEditor renders from. */
export const MARKDOWN_COMMANDS: readonly MarkdownCommandSpec[] = [
  { id: 'h1', label: 'Heading 1', glyph: { kind: 'text', text: 'H1' }, group: 1 },
  { id: 'h2', label: 'Heading 2', glyph: { kind: 'text', text: 'H2' }, group: 1 },
  { id: 'h3', label: 'Heading 3', glyph: { kind: 'text', text: 'H3' }, group: 1 },
  { id: 'bold', label: 'Bold', glyph: { kind: 'text', text: 'B' }, shortcut: 'b', group: 2 },
  { id: 'italic', label: 'Italic', glyph: { kind: 'text', text: 'I' }, shortcut: 'i', group: 2 },
  { id: 'strike', label: 'Strikethrough', glyph: { kind: 'text', text: 'S' }, group: 2 },
  { id: 'code', label: 'Code', glyph: { kind: 'text', text: '</>' }, group: 2 },
  { id: 'bullet', label: 'Bullet list', glyph: { kind: 'icon', name: 'list' }, group: 3 },
  {
    id: 'numbered',
    label: 'Numbered list',
    glyph: { kind: 'icon', name: 'list-ordered' },
    group: 3,
  },
  { id: 'quote', label: 'Quote', glyph: { kind: 'icon', name: 'quote' }, group: 3 },
  { id: 'link', label: 'Link', glyph: { kind: 'icon', name: 'link' }, group: 4 },
  { id: 'image', label: 'Image', glyph: { kind: 'icon', name: 'image' }, group: 4 },
  { id: 'youtube', label: 'YouTube', glyph: { kind: 'icon', name: 'video' }, group: 4 },
];

/** 'Bold (Ctrl+B)' style title for a command (platform-neutral: always "Ctrl+"). */
export function commandTitle(command: MarkdownCommand): string {
  const spec = MARKDOWN_COMMANDS.find((entry) => entry.id === command);
  if (!spec) return command;
  return spec.shortcut ? `${spec.label} (Ctrl+${spec.shortcut.toUpperCase()})` : spec.label;
}

// ---- Markers, prefixes and templates -------------------------------------------------------

const INLINE_MARKERS: Readonly<Record<'bold' | 'italic' | 'strike' | 'code', string>> = {
  bold: '**',
  italic: '_',
  strike: '~~',
  code: '`',
};

const HEADING_LEVELS: Readonly<Record<'h1' | 'h2' | 'h3', number>> = { h1: 1, h2: 2, h3: 3 };
const MAX_HEADING_LEVEL = 6;
const BULLET_PREFIX = '- ';
const QUOTE_PREFIX = '> ';

const LINK_TEXT = 'link text';
const URL_PLACEHOLDER = 'url';
const ALT_PLACEHOLDER = 'alt';
const YOUTUBE_WATCH = 'https://www.youtube.com/watch?v=';
const VIDEO_ID = 'VIDEO_ID';

// ---- Entry point -----------------------------------------------------------------------------

export function applyMarkdownCommand(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  command: MarkdownCommand,
): MarkdownEdit {
  const a = clampIndex(selectionStart, value.length);
  const b = clampIndex(selectionEnd, value.length);
  const start = Math.min(a, b);
  const end = Math.max(a, b);
  switch (command) {
    case 'bold':
    case 'italic':
    case 'strike':
    case 'code':
      return applyInline(value, start, end, INLINE_MARKERS[command]);
    case 'h1':
    case 'h2':
    case 'h3':
      return applyLinePrefix(value, start, end, {
        kind: 'heading',
        level: HEADING_LEVELS[command],
      });
    case 'bullet':
      return applyLinePrefix(value, start, end, { kind: 'plain', prefix: BULLET_PREFIX });
    case 'quote':
      return applyLinePrefix(value, start, end, { kind: 'plain', prefix: QUOTE_PREFIX });
    case 'numbered':
      return applyLinePrefix(value, start, end, { kind: 'numbered' });
    case 'link':
      return applyLink(value, start, end);
    case 'image':
      return applyImage(value, start, end);
    case 'youtube':
      return applyYoutube(value, start, end);
  }
}

/** Integer in `[0, max]`; NaN / non-finite → 0. */
function clampIndex(index: number, max: number): number {
  if (!Number.isFinite(index)) return 0;
  const whole = Math.trunc(index);
  if (whole < 0) return 0;
  return whole > max ? max : whole;
}

// ---- Inline wraps ----------------------------------------------------------------------------

function applyInline(value: string, start: number, end: number, marker: string): MarkdownEdit {
  const m = marker.length;
  const inner = value.slice(start, end);

  // Toggle off (a): the selected text is itself exactly wrapped by the markers.
  if (inner.length >= 2 * m && inner.startsWith(marker) && inner.endsWith(marker)) {
    const stripped = inner.slice(m, inner.length - m);
    return {
      value: value.slice(0, start) + stripped + value.slice(end),
      selectionStart: start,
      selectionEnd: start + stripped.length,
    };
  }

  // Toggle off (b): the markers sit immediately outside the selection (or the caret).
  if (
    start >= m &&
    value.slice(start - m, start) === marker &&
    value.slice(end, end + m) === marker
  ) {
    return {
      value: value.slice(0, start - m) + inner + value.slice(end + m),
      selectionStart: start - m,
      selectionEnd: start - m + inner.length,
    };
  }

  // Wrap (a caret gets both markers with the caret between them).
  return {
    value: value.slice(0, start) + marker + inner + marker + value.slice(end),
    selectionStart: start + m,
    selectionEnd: end + m,
  };
}

// ---- Line prefixes ---------------------------------------------------------------------------

type PrefixRule =
  { kind: 'heading'; level: number } | { kind: 'plain'; prefix: string } | { kind: 'numbered' };

/** `#{1,6} ` at the start of the line → its level; anything else (no space, 7+ hashes) → 0. */
function headingLevel(line: string): number {
  let count = 0;
  while (count < line.length && line[count] === '#') count += 1;
  if (count === 0 || count > MAX_HEADING_LEVEL) return 0;
  return line[count] === ' ' ? count : 0;
}

/** `<digits>. ` at the start of the line → the prefix length; anything else → 0. */
function numberedPrefixLength(line: string): number {
  let digits = 0;
  while (digits < line.length) {
    const code = line.charCodeAt(digits);
    if (code < 48 || code > 57) break;
    digits += 1;
  }
  if (digits === 0) return 0;
  return line[digits] === '.' && line[digits + 1] === ' ' ? digits + 2 : 0;
}

/** Length of exactly the rule's prefix at the start of `line` (0 when the line does not carry it). */
function carriedPrefixLength(line: string, rule: PrefixRule): number {
  switch (rule.kind) {
    case 'heading':
      return headingLevel(line) === rule.level ? rule.level + 1 : 0;
    case 'plain':
      return line.startsWith(rule.prefix) ? rule.prefix.length : 0;
    case 'numbered':
      return numberedPrefixLength(line);
  }
}

/** Length of any prefix of the rule's family the apply step replaces (headings: any level). */
function replaceablePrefixLength(line: string, rule: PrefixRule): number {
  switch (rule.kind) {
    case 'heading': {
      const level = headingLevel(line);
      return level > 0 ? level + 1 : 0;
    }
    case 'plain':
      return line.startsWith(rule.prefix) ? rule.prefix.length : 0;
    case 'numbered':
      return numberedPrefixLength(line);
  }
}

function prefixFor(rule: PrefixRule, lineIndex: number): string {
  switch (rule.kind) {
    case 'heading':
      return `${'#'.repeat(rule.level)} `;
    case 'plain':
      return rule.prefix;
    case 'numbered':
      return `${lineIndex + 1}. `;
  }
}

function applyLinePrefix(
  value: string,
  start: number,
  end: number,
  rule: PrefixRule,
): MarkdownEdit {
  // The block: from the start of the first touched line to the end of the last. A selection that
  // ends right after a newline does not touch the following line (a caret there does).
  const blockStart = start === 0 ? 0 : value.lastIndexOf('\n', start - 1) + 1;
  const lastTouched = end > start && value[end - 1] === '\n' ? end - 1 : end;
  const newlineAfter = value.indexOf('\n', lastTouched);
  const blockEnd = newlineAfter === -1 ? value.length : newlineAfter;

  const lines = value.slice(blockStart, blockEnd).split('\n');
  const allCarry = lines.every((line) => carriedPrefixLength(line, rule) > 0);
  const block = lines
    .map((line, index) =>
      allCarry
        ? line.slice(carriedPrefixLength(line, rule))
        : prefixFor(rule, index) + line.slice(replaceablePrefixLength(line, rule)),
    )
    .join('\n');
  const nextValue = value.slice(0, blockStart) + block + value.slice(blockEnd);

  if (start === end) {
    // A caret keeps its place in the text: shifted by its (single) line's prefix change, never
    // before the line start — so the empty value ends up `<prefix>|`.
    const delta = block.length - (blockEnd - blockStart);
    const caret = Math.max(blockStart, Math.min(start + delta, blockStart + block.length));
    return { value: nextValue, selectionStart: caret, selectionEnd: caret };
  }
  return { value: nextValue, selectionStart: blockStart, selectionEnd: blockStart + block.length };
}

// ---- Link / image / YouTube --------------------------------------------------------------------

/** Exactly an `http(s)://` URL: no whitespace, parses, http or https. */
function isHttpUrl(text: string): boolean {
  const scheme = text.slice(0, 8).toLowerCase();
  if (!scheme.startsWith('http://') && !scheme.startsWith('https://')) return false;
  for (const char of text) {
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') return false;
  }
  try {
    const url = new URL(text);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.length > 0;
  } catch {
    return false;
  }
}

/** Replaces `[start, end)` with `inserted` and selects `inserted.slice(from, from + length)`. */
function replaceAndSelect(
  value: string,
  start: number,
  end: number,
  inserted: string,
  from: number,
  length: number,
): MarkdownEdit {
  return {
    value: value.slice(0, start) + inserted + value.slice(end),
    selectionStart: start + from,
    selectionEnd: start + from + length,
  };
}

/** selection → `[<selection>](url)` with `url` selected; caret → `[link text](url)` with `link text` selected. */
function applyLink(value: string, start: number, end: number): MarkdownEdit {
  if (start === end) {
    return replaceAndSelect(
      value,
      start,
      end,
      `[${LINK_TEXT}](${URL_PLACEHOLDER})`,
      1,
      LINK_TEXT.length,
    );
  }
  const text = value.slice(start, end);
  return replaceAndSelect(
    value,
    start,
    end,
    `[${text}](${URL_PLACEHOLDER})`,
    1 + text.length + 2,
    URL_PLACEHOLDER.length,
  );
}

/**
 * URL selection → `![alt](<url>)` with `alt` selected; other selection → `![<selection>](url)` with
 * `url` selected; caret → `![alt](url)` with `url` selected.
 */
function applyImage(value: string, start: number, end: number): MarkdownEdit {
  if (start === end) {
    return replaceAndSelect(
      value,
      start,
      end,
      `![${ALT_PLACEHOLDER}](${URL_PLACEHOLDER})`,
      2 + ALT_PLACEHOLDER.length + 2,
      URL_PLACEHOLDER.length,
    );
  }
  const text = value.slice(start, end);
  if (isHttpUrl(text)) {
    return replaceAndSelect(
      value,
      start,
      end,
      `![${ALT_PLACEHOLDER}](${text})`,
      2,
      ALT_PLACEHOLDER.length,
    );
  }
  return replaceAndSelect(
    value,
    start,
    end,
    `![${text}](${URL_PLACEHOLDER})`,
    2 + text.length + 2,
    URL_PLACEHOLDER.length,
  );
}

/**
 * URL selection → that URL on its own line (a newline is added before / after only where the
 * neighbouring character is not already a newline / the start / the end), caret after it; anything
 * else → `https://www.youtube.com/watch?v=VIDEO_ID` on its own line with `VIDEO_ID` selected (an
 * existing non-URL selection is replaced).
 */
function applyYoutube(value: string, start: number, end: number): MarkdownEdit {
  const text = value.slice(start, end);
  const keepsUrl = start < end && isHttpUrl(text);
  const body = keepsUrl ? text : YOUTUBE_WATCH + VIDEO_ID;
  const before = start > 0 && value[start - 1] !== '\n' ? '\n' : '';
  const after = end < value.length && value[end] !== '\n' ? '\n' : '';
  const inserted = before + body + after;
  if (keepsUrl) {
    return replaceAndSelect(value, start, end, inserted, before.length + body.length, 0);
  }
  return replaceAndSelect(
    value,
    start,
    end,
    inserted,
    before.length + YOUTUBE_WATCH.length,
    VIDEO_ID.length,
  );
}
