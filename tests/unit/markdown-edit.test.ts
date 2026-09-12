/**
 * tests/unit/markdown-edit.test.ts — `lib/markdown/edit.ts` `applyMarkdownCommand` /
 * `MARKDOWN_COMMANDS` / `commandTitle` (05 T-UNIT-52; ADR-0039 D4; 03 §2.10 `MarkdownEditor`;
 * 00 S1.5c.AC4; DESIGN.md v1.10 §11.3 #20 toolbar).
 *
 * Pure — no DOM, no network. This is the whole selection-maths core; the e2e toolbar test only samples it
 * through the toolbar, so every command is covered here for {empty value, caret in a word, caret at
 * the end, single-line selection, multi-line selection}, every toggle-off case, the templates, the
 * own-line rule, the bounds invariants and the toolbar table.
 */
import { describe, expect, it } from 'vitest';
import {
  MARKDOWN_COMMANDS,
  applyMarkdownCommand,
  commandTitle,
  type MarkdownCommand,
  type MarkdownEdit,
} from '@/lib/markdown/edit';

const apply = applyMarkdownCommand;

/** The text the returned selection covers. */
const selected = (edit: MarkdownEdit): string =>
  edit.value.slice(edit.selectionStart, edit.selectionEnd);

/** The caret position of a collapsed selection (fails when the selection is not collapsed). */
const caret = (edit: MarkdownEdit): number => {
  expect(edit.selectionEnd).toBe(edit.selectionStart);
  return edit.selectionStart;
};

const ALL_COMMANDS: readonly MarkdownCommand[] = [
  'h1',
  'h2',
  'h3',
  'bold',
  'italic',
  'strike',
  'code',
  'bullet',
  'numbered',
  'quote',
  'link',
  'image',
  'youtube',
];

const YOUTUBE_TEMPLATE = 'https://www.youtube.com/watch?v=VIDEO_ID';

// ---- Inline wraps ------------------------------------------------------------------------------

const INLINE = [
  ['bold', '**'],
  ['italic', '_'],
  ['strike', '~~'],
  ['code', '`'],
] as const;

describe.each(INLINE)('T-UNIT-52 inline wrap %s', (command, m) => {
  it(`T-UNIT-52 ${command}: empty value → the two markers with the caret between them`, () => {
    expect(apply('', 0, 0, command)).toEqual({
      value: m + m,
      selectionStart: m.length,
      selectionEnd: m.length,
    });
  });

  it(`T-UNIT-52 ${command}: caret in the middle of a word → markers at the caret, caret between them`, () => {
    const edit = apply('hello world', 3, 3, command);
    expect(edit.value).toBe(`hel${m}${m}lo world`);
    expect(caret(edit)).toBe(3 + m.length);
  });

  it(`T-UNIT-52 ${command}: caret at the end → markers appended, caret between them`, () => {
    const edit = apply('hello', 5, 5, command);
    expect(edit.value).toBe(`hello${m}${m}`);
    expect(caret(edit)).toBe(5 + m.length);
  });

  it(`T-UNIT-52 ${command}: single-line selection → wrapped, the inner text stays selected`, () => {
    const edit = apply('say hello now', 4, 9, command);
    expect(edit.value).toBe(`say ${m}hello${m} now`);
    expect(selected(edit)).toBe('hello');
    expect(edit.selectionStart).toBe(4 + m.length);
  });

  it(`T-UNIT-52 ${command}: multi-line selection → wrapped as one span across the newline`, () => {
    const edit = apply('one\ntwo\nthree', 0, 7, command);
    expect(edit.value).toBe(`${m}one\ntwo${m}\nthree`);
    expect(selected(edit)).toBe('one\ntwo');
  });

  it(`T-UNIT-52 ${command}: toggle off when the selected text is exactly wrapped`, () => {
    const value = `say ${m}hello${m} now`;
    const edit = apply(value, 4, 4 + m.length * 2 + 5, command);
    expect(edit.value).toBe('say hello now');
    expect(selected(edit)).toBe('hello');
    expect(edit.selectionStart).toBe(4);
  });

  it(`T-UNIT-52 ${command}: toggle off when the markers sit immediately outside the selection`, () => {
    const value = `say ${m}hello${m} now`;
    const edit = apply(value, 4 + m.length, 4 + m.length + 5, command);
    expect(edit.value).toBe('say hello now');
    expect(selected(edit)).toBe('hello');
    expect(edit.selectionStart).toBe(4);
  });

  it(`T-UNIT-52 ${command}: toggle off at a caret between two empty markers (button twice = no-op)`, () => {
    const once = apply('ab', 1, 1, command);
    const twice = apply(once.value, once.selectionStart, once.selectionEnd, command);
    expect(twice).toEqual({ value: 'ab', selectionStart: 1, selectionEnd: 1 });
  });

  it(`T-UNIT-52 ${command}: applying twice to a selection restores the original`, () => {
    const once = apply('say hello now', 4, 9, command);
    const twice = apply(once.value, once.selectionStart, once.selectionEnd, command);
    expect(twice).toEqual({ value: 'say hello now', selectionStart: 4, selectionEnd: 9 });
  });

  it(`T-UNIT-52 ${command}: wrapped whole-value selection toggles back to the bare value`, () => {
    const edit = apply(`${m}all${m}`, 0, 3 + m.length * 2, command);
    expect(edit).toEqual({ value: 'all', selectionStart: 0, selectionEnd: 3 });
  });

  it(`T-UNIT-52 ${command}: a marker only on one side is not a toggle`, () => {
    const edit = apply(`${m}hello`, m.length, m.length + 5, command);
    expect(edit.value).toBe(`${m}${m}hello${m}`);
    expect(selected(edit)).toBe('hello');
  });

  it(`T-UNIT-52 ${command}: CRLF and the surrounding text are byte-identical`, () => {
    const edit = apply('a\r\nbc\r\nd', 3, 5, command);
    expect(edit.value).toBe(`a\r\n${m}bc${m}\r\nd`);
    expect(selected(edit)).toBe('bc');
  });
});

describe('T-UNIT-52 inline wraps do not cross-toggle', () => {
  it('T-UNIT-52 bold on an italic-wrapped selection stacks (`**_a_**`)', () => {
    const edit = apply('_a_', 0, 3, 'bold');
    expect(edit.value).toBe('**_a_**');
    expect(selected(edit)).toBe('_a_');
  });

  it('T-UNIT-52 italic on a bold-wrapped selection stacks (`_**a**_`)', () => {
    const edit = apply('**a**', 0, 5, 'italic');
    expect(edit.value).toBe('_**a**_');
    expect(selected(edit)).toBe('**a**');
  });

  it('T-UNIT-52 a single `_` selection is not "wrapped" — italic wraps it', () => {
    const edit = apply('_', 0, 1, 'italic');
    expect(edit).toEqual({ value: '___', selectionStart: 1, selectionEnd: 2 });
  });

  it('T-UNIT-52 a bare `**` selection is not "wrapped" — bold wraps it', () => {
    expect(apply('**', 0, 2, 'bold')).toEqual({
      value: '******',
      selectionStart: 2,
      selectionEnd: 4,
    });
  });

  it('T-UNIT-52 bold on `a` inside `***a***` removes the outer `**` and leaves `*a*`', () => {
    const edit = apply('***a***', 3, 4, 'bold');
    expect(edit).toEqual({ value: '*a*', selectionStart: 1, selectionEnd: 2 });
  });

  it('T-UNIT-52 code on text containing a backtick still wraps (no escaping)', () => {
    const edit = apply('a`b', 0, 3, 'code');
    expect(edit.value).toBe('`a`b`');
    expect(selected(edit)).toBe('a`b');
  });
});

// ---- Line prefixes -----------------------------------------------------------------------------

const PREFIX = [
  ['h1', '# '],
  ['h2', '## '],
  ['h3', '### '],
  ['bullet', '- '],
  ['numbered', '1. '],
  ['quote', '> '],
] as const;

describe.each(PREFIX)('T-UNIT-52 line prefix %s', (command, p) => {
  /** The prefix line `index` gets — numbered counts 1. 2. 3., the rest is constant. */
  const pre = (index: number): string => (command === 'numbered' ? `${index + 1}. ` : p);

  it(`T-UNIT-52 ${command}: empty value + caret → the prefix alone with the caret after it`, () => {
    expect(apply('', 0, 0, command)).toEqual({
      value: p,
      selectionStart: p.length,
      selectionEnd: p.length,
    });
  });

  it(`T-UNIT-52 ${command}: caret in the middle of a word → the line gets the prefix, the caret keeps its place`, () => {
    const edit = apply('hello', 2, 2, command);
    expect(edit.value).toBe(`${p}hello`);
    expect(caret(edit)).toBe(2 + p.length);
  });

  it(`T-UNIT-52 ${command}: caret at the end → the caret stays at the end of the text`, () => {
    const edit = apply('hello', 5, 5, command);
    expect(edit.value).toBe(`${p}hello`);
    expect(caret(edit)).toBe(5 + p.length);
  });

  it(`T-UNIT-52 ${command}: a caret on the second line touches only that line`, () => {
    const edit = apply('one\ntwo\nthree', 5, 5, command);
    expect(edit.value).toBe(`one\n${p}two\nthree`);
    expect(caret(edit)).toBe(5 + p.length);
  });

  it(`T-UNIT-52 ${command}: a caret right after a newline is on the new line`, () => {
    const edit = apply('one\n', 4, 4, command);
    expect(edit.value).toBe(`one\n${p}`);
    expect(caret(edit)).toBe(4 + p.length);
  });

  it(`T-UNIT-52 ${command}: single-line selection → prefixed, the selection spans the rewritten line`, () => {
    const edit = apply('say hello', 4, 9, command);
    expect(edit.value).toBe(`${p}say hello`);
    expect(selected(edit)).toBe(`${p}say hello`);
  });

  it(`T-UNIT-52 ${command}: partial single-line selection inside a longer value → the whole line`, () => {
    const edit = apply('one\nsay hello\nthree', 6, 8, command);
    expect(edit.value).toBe(`one\n${p}say hello\nthree`);
    expect(selected(edit)).toBe(`${p}say hello`);
  });

  it(`T-UNIT-52 ${command}: multi-line selection → every touched line, first line start → last line end`, () => {
    // 'one'=0..3, '\n'=3, 'two'=4..7, '\n'=7, 'three'=8..13, '\n'=13, 'four'=14..18; [2,9) touches three lines.
    const edit = apply('one\ntwo\nthree\nfour', 2, 9, command);
    const block = `${pre(0)}one\n${pre(1)}two\n${pre(2)}three`;
    expect(edit.value).toBe(`${block}\nfour`);
    expect(selected(edit)).toBe(block);
    expect(edit.selectionStart).toBe(0);
  });

  it(`T-UNIT-52 ${command}: a selection that ends right after a newline does not touch the next line`, () => {
    const edit = apply('one\ntwo', 0, 4, command);
    expect(edit.value).toBe(`${p}one\ntwo`);
    expect(selected(edit)).toBe(`${p}one`);
  });

  it(`T-UNIT-52 ${command}: blank lines inside the selection get the prefix too`, () => {
    const edit = apply('a\n\nb', 0, 4, command);
    expect(edit.value).toBe(`${pre(0)}a\n${pre(1)}\n${pre(2)}b`);
  });

  it(`T-UNIT-52 ${command}: toggle off when every touched line already carries exactly that prefix`, () => {
    const value = `${pre(0)}a\n${pre(1)}b\n${pre(2)}c`;
    const edit = apply(value, 0, value.length, command);
    expect(edit).toEqual({ value: 'a\nb\nc', selectionStart: 0, selectionEnd: 5 });
  });

  it(`T-UNIT-52 ${command}: toggle off with a caret strips the line and keeps the caret in the text`, () => {
    const edit = apply(`${p}hello`, p.length + 5, p.length + 5, command);
    expect(edit.value).toBe('hello');
    expect(caret(edit)).toBe(5);
  });

  it(`T-UNIT-52 ${command}: a caret inside the prefix lands at the line start after toggling off`, () => {
    const edit = apply(`${p}hello`, 1, 1, command);
    expect(edit.value).toBe('hello');
    expect(caret(edit)).toBe(0);
  });

  it(`T-UNIT-52 ${command}: applying twice to a selection restores the value`, () => {
    const once = apply('one\ntwo', 0, 7, command);
    const twice = apply(once.value, once.selectionStart, once.selectionEnd, command);
    expect(twice).toEqual({ value: 'one\ntwo', selectionStart: 0, selectionEnd: 7 });
  });

  it(`T-UNIT-52 ${command}: mixed block — lines missing the prefix gain it, lines carrying it are not doubled`, () => {
    const value = `${pre(0)}a\nb`;
    const edit = apply(value, 0, value.length, command);
    expect(edit.value).toBe(`${pre(0)}a\n${pre(1)}b`);
    expect(selected(edit)).toBe(edit.value);
  });

  it(`T-UNIT-52 ${command}: only the touched lines change — a carrying line outside the selection stays`, () => {
    const value = `${pre(0)}a\nb\n${pre(0)}c`;
    const edit = apply(value, 3 + p.length, 3 + p.length, command);
    expect(edit.value).toBe(`${pre(0)}a\n${pre(0)}b\n${pre(0)}c`);
  });

  it(`T-UNIT-52 ${command}: CRLF — the \\r stays at the end of the line content`, () => {
    const edit = apply('one\r\ntwo', 0, 8, command);
    expect(edit.value).toBe(`${pre(0)}one\r\n${pre(1)}two`);
    expect(selected(edit)).toBe(edit.value);
  });

  it(`T-UNIT-52 ${command}: the text before and after the block is byte-identical`, () => {
    const edit = apply('keep\nme\nx\nand\nme', 8, 8, command);
    expect(edit.value.startsWith('keep\nme\n')).toBe(true);
    expect(edit.value.endsWith('\nand\nme')).toBe(true);
    expect(edit.value).toBe(`keep\nme\n${p}x\nand\nme`);
  });
});

describe('T-UNIT-52 headings replace an existing heading level', () => {
  it('T-UNIT-52 h2 on a `# ` line → `## ` (caret shifts with the extra hash)', () => {
    const edit = apply('# hello', 7, 7, 'h2');
    expect(edit.value).toBe('## hello');
    expect(caret(edit)).toBe(8);
  });

  it('T-UNIT-52 h3 on a `## ` selection → `### `', () => {
    const edit = apply('## hello', 0, 8, 'h3');
    expect(edit).toEqual({ value: '### hello', selectionStart: 0, selectionEnd: 9 });
  });

  it('T-UNIT-52 h1 on a `### ` line → `# ` (levels go down too)', () => {
    const edit = apply('### hello', 0, 9, 'h1');
    expect(edit).toEqual({ value: '# hello', selectionStart: 0, selectionEnd: 7 });
  });

  it('T-UNIT-52 h2 on a `###### ` (level 6) line → `## `', () => {
    expect(apply('###### six', 0, 10, 'h2').value).toBe('## six');
  });

  it('T-UNIT-52 h3 on a mixed block [`## a`, `b`] → both `### `', () => {
    const edit = apply('## a\nb', 0, 6, 'h3');
    expect(edit.value).toBe('### a\n### b');
    expect(selected(edit)).toBe('### a\n### b');
  });

  it('T-UNIT-52 h2 on [`## a`, `### b`] applies (not every line is exactly h2) → both `## `', () => {
    expect(apply('## a\n### b', 0, 10, 'h2').value).toBe('## a\n## b');
  });

  it('T-UNIT-52 h2 on [`## a`, `## b`] toggles off (every line is exactly h2)', () => {
    expect(apply('## a\n## b', 0, 9, 'h2')).toEqual({
      value: 'a\nb',
      selectionStart: 0,
      selectionEnd: 3,
    });
  });

  it('T-UNIT-52 h1 on a `# ` line toggles off; h1 on a `## ` line replaces (that exact level only)', () => {
    expect(apply('# a', 0, 3, 'h1').value).toBe('a');
    expect(apply('## a', 0, 4, 'h1').value).toBe('# a');
  });

  it('T-UNIT-52 seven hashes are not a heading → prefixed, not replaced', () => {
    expect(apply('####### seven', 0, 13, 'h1').value).toBe('# ####### seven');
  });

  it('T-UNIT-52 `#hashtag` (no space) is not a heading → prefixed', () => {
    expect(apply('#hashtag', 0, 8, 'h1').value).toBe('# #hashtag');
  });

  it('T-UNIT-52 a bare `#` line is not a heading → prefixed', () => {
    expect(apply('#', 0, 1, 'h1').value).toBe('# #');
  });

  it('T-UNIT-52 a heading line with empty text (`## `) still counts as that level', () => {
    expect(apply('## ', 0, 3, 'h2').value).toBe('');
    expect(apply('## ', 0, 3, 'h3').value).toBe('### ');
  });

  it('T-UNIT-52 headings only replace headings — a `- ` bullet line is prefixed', () => {
    expect(apply('- item', 0, 6, 'h1').value).toBe('# - item');
  });
});

describe('T-UNIT-52 numbered list renumbering', () => {
  it('T-UNIT-52 three lines → `1. ` `2. ` `3. `', () => {
    const edit = apply('a\nb\nc', 0, 5, 'numbered');
    expect(edit).toEqual({ value: '1. a\n2. b\n3. c', selectionStart: 0, selectionEnd: 14 });
  });

  it('T-UNIT-52 numbering restarts at 1 for the touched block only', () => {
    const edit = apply('1. x\n2. y\na\nb', 10, 13, 'numbered');
    expect(edit.value).toBe('1. x\n2. y\n1. a\n2. b');
    expect(selected(edit)).toBe('1. a\n2. b');
  });

  it('T-UNIT-52 a block already numbered `1. 2. 3.` toggles off', () => {
    expect(apply('1. a\n2. b\n3. c', 0, 14, 'numbered')).toEqual({
      value: 'a\nb\nc',
      selectionStart: 0,
      selectionEnd: 5,
    });
  });

  it('T-UNIT-52 any number counts as the prefix — `1. 1.` and `10.` toggle off', () => {
    expect(apply('1. a\n1. b', 0, 9, 'numbered').value).toBe('a\nb');
    expect(apply('10. ten', 7, 7, 'numbered')).toEqual({
      value: 'ten',
      selectionStart: 3,
      selectionEnd: 3,
    });
  });

  it('T-UNIT-52 a mixed block [`3. a`, `b`] is renumbered `1. a`, `2. b`', () => {
    expect(apply('3. a\nb', 0, 6, 'numbered').value).toBe('1. a\n2. b');
  });

  it('T-UNIT-52 `1.a` (no space) and `1 a` (no dot) are not numbered prefixes', () => {
    expect(apply('1.a', 0, 3, 'numbered').value).toBe('1. 1.a');
    expect(apply('1 a', 0, 3, 'numbered').value).toBe('1. 1 a');
  });

  it('T-UNIT-52 bullet and numbered stack rather than swap (toggle one off first)', () => {
    expect(apply('1. a', 0, 4, 'bullet').value).toBe('- 1. a');
    expect(apply('- a', 0, 3, 'numbered').value).toBe('1. - a');
  });
});

describe('T-UNIT-52 quote and bullet stack over other prefixes', () => {
  it('T-UNIT-52 quote on lines that already have `- ` → `> - ` (a quoted list)', () => {
    const edit = apply('- a\n- b', 0, 7, 'quote');
    expect(edit.value).toBe('> - a\n> - b');
    expect(selected(edit)).toBe('> - a\n> - b');
  });

  it('T-UNIT-52 bullet on quoted lines → `- > `', () => {
    expect(apply('> a', 0, 3, 'bullet').value).toBe('- > a');
  });

  it('T-UNIT-52 quote on a heading line keeps the heading (`> # a`)', () => {
    expect(apply('# a', 0, 3, 'quote').value).toBe('> # a');
  });

  it('T-UNIT-52 `>` without a space and `-item` are not carried prefixes', () => {
    expect(apply('>a', 0, 2, 'quote').value).toBe('> >a');
    expect(apply('-item', 0, 5, 'bullet').value).toBe('- -item');
  });
});

// ---- link / image / youtube --------------------------------------------------------------------

describe('T-UNIT-52 link', () => {
  it('T-UNIT-52 selection → `[<selection>](url)` with `url` selected', () => {
    const edit = apply('see docs here', 4, 8, 'link');
    expect(edit.value).toBe('see [docs](url) here');
    expect(selected(edit)).toBe('url');
    expect(edit.selectionStart).toBe(11);
  });

  it('T-UNIT-52 empty value → `[link text](url)` with `link text` selected', () => {
    const edit = apply('', 0, 0, 'link');
    expect(edit.value).toBe('[link text](url)');
    expect(selected(edit)).toBe('link text');
    expect(edit.selectionStart).toBe(1);
  });

  it('T-UNIT-52 caret in the middle of a word → the template at the caret', () => {
    const edit = apply('ab', 1, 1, 'link');
    expect(edit.value).toBe('a[link text](url)b');
    expect(selected(edit)).toBe('link text');
  });

  it('T-UNIT-52 caret at the end → the template appended', () => {
    const edit = apply('ab', 2, 2, 'link');
    expect(edit.value).toBe('ab[link text](url)');
    expect(selected(edit)).toBe('link text');
  });

  it('T-UNIT-52 a URL selection follows the same rule (`[<url>](url)`, `url` selected)', () => {
    const edit = apply('https://x.test/', 0, 15, 'link');
    expect(edit.value).toBe('[https://x.test/](url)');
    expect(selected(edit)).toBe('url');
  });

  it('T-UNIT-52 multi-line selection → wrapped as one link text', () => {
    const edit = apply('a\nb', 0, 3, 'link');
    expect(edit.value).toBe('[a\nb](url)');
    expect(selected(edit)).toBe('url');
  });
});

describe('T-UNIT-52 image', () => {
  it('T-UNIT-52 https URL selection → `![alt](<url>)` with `alt` selected', () => {
    const url = 'https://cdn.modrinth.com/data/AA/images/shot.png';
    const edit = apply(url, 0, url.length, 'image');
    expect(edit.value).toBe(`![alt](${url})`);
    expect(selected(edit)).toBe('alt');
    expect(edit.selectionStart).toBe(2);
  });

  it('T-UNIT-52 http URL selection counts too, inside surrounding text', () => {
    const edit = apply('see http://x.test/a.png now', 4, 23, 'image');
    expect(edit.value).toBe('see ![alt](http://x.test/a.png) now');
    expect(selected(edit)).toBe('alt');
  });

  it('T-UNIT-52 the scheme check is case-insensitive', () => {
    const edit = apply('HTTPS://X.TEST/A.PNG', 0, 20, 'image');
    expect(edit.value).toBe('![alt](HTTPS://X.TEST/A.PNG)');
    expect(selected(edit)).toBe('alt');
  });

  it('T-UNIT-52 non-URL selection → `![<selection>](url)` with `url` selected', () => {
    const edit = apply('see shot now', 4, 8, 'image');
    expect(edit.value).toBe('see ![shot](url) now');
    expect(selected(edit)).toBe('url');
    expect(edit.selectionStart).toBe(12);
  });

  it('T-UNIT-52 a selection with whitespace is not a URL', () => {
    expect(apply('https://x.test/a b', 0, 18, 'image').value).toBe('![https://x.test/a b](url)');
    expect(apply('https://x.test/a\nb', 0, 18, 'image').value).toBe('![https://x.test/a\nb](url)');
    expect(apply('https://x.test/a ', 0, 17, 'image').value).toBe('![https://x.test/a ](url)');
  });

  it('T-UNIT-52 other schemes and bare hosts are not URLs', () => {
    expect(apply('ftp://x.test/a', 0, 14, 'image').value).toBe('![ftp://x.test/a](url)');
    expect(apply('javascript:alert(1)', 0, 19, 'image').value).toBe('![javascript:alert(1)](url)');
    expect(apply('x.test/a.png', 0, 12, 'image').value).toBe('![x.test/a.png](url)');
    expect(apply('https://', 0, 8, 'image').value).toBe('![https://](url)');
    expect(apply('http', 0, 4, 'image').value).toBe('![http](url)');
  });

  it('T-UNIT-52 empty value → `![alt](url)` with `url` selected', () => {
    const edit = apply('', 0, 0, 'image');
    expect(edit.value).toBe('![alt](url)');
    expect(selected(edit)).toBe('url');
    expect(edit.selectionStart).toBe(7);
  });

  it('T-UNIT-52 caret in the middle of a word / at the end → the template at the caret', () => {
    const mid = apply('ab', 1, 1, 'image');
    expect(mid.value).toBe('a![alt](url)b');
    expect(selected(mid)).toBe('url');
    const end = apply('ab', 2, 2, 'image');
    expect(end.value).toBe('ab![alt](url)');
    expect(selected(end)).toBe('url');
  });

  it('T-UNIT-52 multi-line non-URL selection → the whole selection becomes the alt text', () => {
    expect(apply('a\nb', 0, 3, 'image').value).toBe('![a\nb](url)');
  });
});

describe('T-UNIT-52 youtube', () => {
  const url = 'https://youtu.be/dQw4w9WgXcQ';

  it('T-UNIT-52 URL selection at the start of the value → kept, a newline added after only', () => {
    const edit = apply(`${url} rest`, 0, url.length, 'youtube');
    expect(edit.value).toBe(`${url}\n rest`);
    expect(caret(edit)).toBe(url.length);
  });

  it('T-UNIT-52 URL selection at the end of the value → a newline added before only', () => {
    const edit = apply(`intro ${url}`, 6, 6 + url.length, 'youtube');
    expect(edit.value).toBe(`intro \n${url}`);
    expect(caret(edit)).toBe(7 + url.length);
  });

  it('T-UNIT-52 URL selection in the middle of a line → newlines on both sides', () => {
    const edit = apply(`a ${url} b`, 2, 2 + url.length, 'youtube');
    expect(edit.value).toBe(`a \n${url}\n b`);
    expect(caret(edit)).toBe(3 + url.length);
  });

  it('T-UNIT-52 URL selection already on its own line → value unchanged, caret after the URL', () => {
    const value = `a\n${url}\nb`;
    const edit = apply(value, 2, 2 + url.length, 'youtube');
    expect(edit).toEqual({ value, selectionStart: 2 + url.length, selectionEnd: 2 + url.length });
  });

  it('T-UNIT-52 URL selection as the whole value → unchanged, caret at the end', () => {
    expect(apply(url, 0, url.length, 'youtube')).toEqual({
      value: url,
      selectionStart: url.length,
      selectionEnd: url.length,
    });
  });

  it('T-UNIT-52 only the missing side gets a newline', () => {
    expect(apply(`a\n${url} b`, 2, 2 + url.length, 'youtube').value).toBe(`a\n${url}\n b`);
    expect(apply(`a ${url}\nb`, 2, 2 + url.length, 'youtube').value).toBe(`a \n${url}\nb`);
  });

  it('T-UNIT-52 any http(s) URL is kept, not just YouTube hosts', () => {
    expect(apply('https://x.test/v', 0, 16, 'youtube').value).toBe('https://x.test/v');
    expect(apply('http://x.test/v', 0, 15, 'youtube').value).toBe('http://x.test/v');
  });

  it('T-UNIT-52 empty value → the template with `VIDEO_ID` selected, no newlines', () => {
    const edit = apply('', 0, 0, 'youtube');
    expect(edit.value).toBe(YOUTUBE_TEMPLATE);
    expect(selected(edit)).toBe('VIDEO_ID');
    expect(edit.selectionStart).toBe(32);
    expect(edit.selectionEnd).toBe(40);
  });

  it('T-UNIT-52 caret at the end of a line → a newline before, the template, `VIDEO_ID` selected', () => {
    const edit = apply('intro', 5, 5, 'youtube');
    expect(edit.value).toBe(`intro\n${YOUTUBE_TEMPLATE}`);
    expect(selected(edit)).toBe('VIDEO_ID');
  });

  it('T-UNIT-52 caret in the middle of a word → newlines on both sides', () => {
    const edit = apply('ab', 1, 1, 'youtube');
    expect(edit.value).toBe(`a\n${YOUTUBE_TEMPLATE}\nb`);
    expect(selected(edit)).toBe('VIDEO_ID');
  });

  it('T-UNIT-52 caret right after a newline → no newline before; right before one → none after', () => {
    expect(apply('a\n', 2, 2, 'youtube').value).toBe(`a\n${YOUTUBE_TEMPLATE}`);
    expect(apply('a\nb', 1, 1, 'youtube').value).toBe(`a\n${YOUTUBE_TEMPLATE}\nb`);
    // Between two newlines: both neighbours are already newlines, so none is added.
    expect(apply('a\n\nb', 2, 2, 'youtube').value).toBe(`a\n${YOUTUBE_TEMPLATE}\nb`);
  });

  it('T-UNIT-52 a non-URL selection is replaced by the template', () => {
    const edit = apply('watch this', 6, 10, 'youtube');
    expect(edit.value).toBe(`watch \n${YOUTUBE_TEMPLATE}`);
    expect(selected(edit)).toBe('VIDEO_ID');
  });

  it('T-UNIT-52 a multi-line non-URL selection is replaced as a whole', () => {
    const edit = apply('x\na\nb\ny', 2, 5, 'youtube');
    expect(edit.value).toBe(`x\n${YOUTUBE_TEMPLATE}\ny`);
    expect(selected(edit)).toBe('VIDEO_ID');
  });

  it('T-UNIT-52 a URL with surrounding whitespace selected is not a URL → replaced', () => {
    const edit = apply(` ${url} `, 0, url.length + 2, 'youtube');
    expect(edit.value).toBe(YOUTUBE_TEMPLATE);
    expect(selected(edit)).toBe('VIDEO_ID');
  });
});

// ---- Bounds + untouched-text invariants over a table ------------------------------------------

describe('T-UNIT-52 bounds invariants (0 <= selectionStart <= selectionEnd <= value.length)', () => {
  const VALUES = [
    '',
    'a',
    'hello world',
    'one\ntwo\nthree',
    '**b** _i_ ~~s~~ `c`',
    '# h\n- a\n1. n\n> q',
    'https://x.test/p.png',
    'a\r\nb\r\n',
    '\n\n',
    '****',
  ] as const;
  const RANGES: readonly (readonly [number, number])[] = [
    [0, 0],
    [0, 1],
    [1, 1],
    [1, 3],
    [2, 5],
    [0, 99],
    [-5, 3],
    [7, 2],
    [Number.NaN, 4],
    [4, Number.NaN],
    [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
    [1.7, 2.2],
  ];

  const cases = ALL_COMMANDS.flatMap((command) =>
    VALUES.flatMap((value) => RANGES.map((range) => [command, value, range[0], range[1]] as const)),
  );

  it.each(cases)(
    'T-UNIT-52 %s on %j [%s, %s] keeps the selection in bounds and the outer text intact',
    (command, value, rawStart, rawEnd) => {
      const edit = apply(value, rawStart, rawEnd, command);
      expect(typeof edit.value).toBe('string');
      expect(Number.isInteger(edit.selectionStart)).toBe(true);
      expect(Number.isInteger(edit.selectionEnd)).toBe(true);
      expect(edit.selectionStart).toBeGreaterThanOrEqual(0);
      expect(edit.selectionEnd).toBeGreaterThanOrEqual(edit.selectionStart);
      expect(edit.selectionEnd).toBeLessThanOrEqual(edit.value.length);

      // The text outside the touched lines is byte-identical (every command edits within them).
      const clamp = (n: number): number =>
        Number.isFinite(n) ? Math.min(value.length, Math.max(0, Math.trunc(n))) : 0;
      const start = Math.min(clamp(rawStart), clamp(rawEnd));
      const end = Math.max(clamp(rawStart), clamp(rawEnd));
      const lineStart = start === 0 ? 0 : value.lastIndexOf('\n', start - 1) + 1;
      const nextNewline = value.indexOf('\n', end);
      const lineEnd = nextNewline === -1 ? value.length : nextNewline;
      expect(edit.value.startsWith(value.slice(0, lineStart))).toBe(true);
      expect(edit.value.endsWith(value.slice(lineEnd))).toBe(true);
    },
  );

  it('T-UNIT-52 a reversed selection is treated as its normalised range', () => {
    expect(apply('say hello now', 9, 4, 'bold')).toEqual(apply('say hello now', 4, 9, 'bold'));
    expect(apply('one\ntwo', 7, 0, 'bullet')).toEqual(apply('one\ntwo', 0, 7, 'bullet'));
  });

  it('T-UNIT-52 out-of-range bounds are clamped to the value', () => {
    expect(apply('abc', -2, 99, 'bold')).toEqual(apply('abc', 0, 3, 'bold'));
    expect(apply('abc', 50, 60, 'link')).toEqual(apply('abc', 3, 3, 'link'));
  });

  it('T-UNIT-52 every command on an empty value yields a non-empty template', () => {
    for (const command of ALL_COMMANDS) {
      const edit = apply('', 0, 0, command);
      expect(edit.value.length).toBeGreaterThan(0);
      expect(edit.selectionEnd).toBeLessThanOrEqual(edit.value.length);
    }
  });
});

// ---- MARKDOWN_COMMANDS + commandTitle ------------------------------------------------------------

describe('T-UNIT-52 MARKDOWN_COMMANDS (toolbar order, labels, glyphs, groups, shortcuts)', () => {
  it('T-UNIT-52 lists the thirteen commands in toolbar order', () => {
    expect(MARKDOWN_COMMANDS.map((c) => c.id)).toEqual(ALL_COMMANDS);
  });

  it('T-UNIT-52 labels are the accessible names verbatim', () => {
    expect(MARKDOWN_COMMANDS.map((c) => c.label)).toEqual([
      'Heading 1',
      'Heading 2',
      'Heading 3',
      'Bold',
      'Italic',
      'Strikethrough',
      'Code',
      'Bullet list',
      'Numbered list',
      'Quote',
      'Link',
      'Image',
      'YouTube',
    ]);
  });

  it('T-UNIT-52 glyphs: text H1 H2 H3 B I S </>, icons list list-ordered quote link image video', () => {
    expect(MARKDOWN_COMMANDS.map((c) => c.glyph)).toEqual([
      { kind: 'text', text: 'H1' },
      { kind: 'text', text: 'H2' },
      { kind: 'text', text: 'H3' },
      { kind: 'text', text: 'B' },
      { kind: 'text', text: 'I' },
      { kind: 'text', text: 'S' },
      { kind: 'text', text: '</>' },
      { kind: 'icon', name: 'list' },
      { kind: 'icon', name: 'list-ordered' },
      { kind: 'icon', name: 'quote' },
      { kind: 'icon', name: 'link' },
      { kind: 'icon', name: 'image' },
      { kind: 'icon', name: 'video' },
    ]);
  });

  it('T-UNIT-52 groups: 3 · 4 · 3 · 3 in order (H1 H2 H3 · B I S </> · lists quote · link image YouTube)', () => {
    expect(MARKDOWN_COMMANDS.map((c) => c.group)).toEqual([1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 4, 4, 4]);
  });

  it('T-UNIT-52 shortcuts: only bold (b) and italic (i)', () => {
    const shortcuts = MARKDOWN_COMMANDS.filter((c) => c.shortcut !== undefined);
    expect(shortcuts.map((c) => [c.id, c.shortcut])).toEqual([
      ['bold', 'b'],
      ['italic', 'i'],
    ]);
  });

  it('T-UNIT-52 ids are unique', () => {
    expect(new Set(MARKDOWN_COMMANDS.map((c) => c.id)).size).toBe(MARKDOWN_COMMANDS.length);
  });

  it('T-UNIT-52 commandTitle: the label, or "Bold (Ctrl+B)" / "Italic (Ctrl+I)" for the shortcut commands', () => {
    expect(commandTitle('bold')).toBe('Bold (Ctrl+B)');
    expect(commandTitle('italic')).toBe('Italic (Ctrl+I)');
    for (const spec of MARKDOWN_COMMANDS) {
      if (spec.shortcut === undefined) expect(commandTitle(spec.id)).toBe(spec.label);
    }
    expect(commandTitle('h1')).toBe('Heading 1');
    expect(commandTitle('youtube')).toBe('YouTube');
  });

  it('T-UNIT-52 shortcut parity: Ctrl/Cmd+B and +I resolve to the same edit as the Bold / Italic buttons', () => {
    const byShortcut = (key: 'b' | 'i'): MarkdownCommand | undefined =>
      MARKDOWN_COMMANDS.find((c) => c.shortcut === key)?.id;
    expect(byShortcut('b')).toBe('bold');
    expect(byShortcut('i')).toBe('italic');
    expect(apply('say hello now', 4, 9, byShortcut('b') ?? 'h1')).toEqual(
      apply('say hello now', 4, 9, 'bold'),
    );
    expect(apply('say hello now', 4, 9, byShortcut('i') ?? 'h1')).toEqual(
      apply('say hello now', 4, 9, 'italic'),
    );
  });
});
