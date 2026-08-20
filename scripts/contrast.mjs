#!/usr/bin/env node
/**
 * scripts/contrast.mjs — DESIGN.md §1 contrast + tokens-only CSS guard.
 * Spec: 01 INV-61 · 03 C-08/C-09 · 05 T-UNIT-15 (contrast + `--check`), T-UNIT-34 (`--tokens`).
 * Zero dependencies, node ESM, import-safe (the exports below) and a CLI:
 *
 *   node scripts/contrast.mjs                  → --check + --pairs (default; `pnpm contrast`)
 *   node scripts/contrast.mjs --check <dir…>   → tokens-only CSS guard over styles/, components/, app/
 *                                                (always all three) plus any extra dirs given (`pnpm lint`)
 *   node scripts/contrast.mjs --pairs          → DESIGN.md §1 "Safe" pairs + component text/UI pairs,
 *                                                computed from styles/tokens.css (text ≥ 4.5, UI ≥ 3)
 *   node scripts/contrast.mjs --tokens         → styles/tokens.css names + values == DESIGN.md §1 "Dark
 *                                                (default)" table ∪ 03-components.md §9 derived table
 *
 * Exit code 1 on any offender / failing pair / mismatch; 0 otherwise. Offenders print as `file:line: text`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Repo root (this file lives in scripts/). */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Paths the CLI reads by default (relative to ROOT). */
export const DEFAULTS = Object.freeze({
  tokensCss: 'styles/tokens.css',
  designMd: 'DESIGN.md',
  componentsMd: 'docs/build/03-components.md',
  /** `--check` always scans these three, whatever dirs are passed (INV-61 grep scope). */
  checkDirs: ['styles', 'components', 'app'],
});

/* ------------------------------------------------------------------------------------------------
 * WCAG 2.x contrast
 * ---------------------------------------------------------------------------------------------- */

/**
 * `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` → `[r, g, b]` (0–255; alpha ignored).
 * @param {string} hex
 * @returns {[number, number, number]}
 */
export function hexToRgb(hex) {
  const raw = String(hex).trim().replace(/^#/, '');
  let digits = raw;
  if (raw.length === 3 || raw.length === 4) {
    digits = raw
      .slice(0, 3)
      .split('')
      .map((c) => c + c)
      .join('');
  } else if (raw.length === 8) {
    digits = raw.slice(0, 6);
  }
  if (!/^[0-9a-fA-F]{6}$/.test(digits)) {
    throw new Error(`contrast: not a hex colour: "${hex}"`);
  }
  return [
    parseInt(digits.slice(0, 2), 16),
    parseInt(digits.slice(2, 4), 16),
    parseInt(digits.slice(4, 6), 16),
  ];
}

/**
 * sRGB relative luminance (WCAG 2.x).
 * @param {string} hex
 * @returns {number}
 */
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * WCAG 2.x contrast ratio between two hex colours (order-independent), e.g. 16.5.
 * @param {string} hexA
 * @param {string} hexB
 * @returns {number}
 */
export function contrast(hexA, hexB) {
  const la = luminance(hexA);
  const lb = luminance(hexB);
  const [light, dark] = la >= lb ? [la, lb] : [lb, la];
  return (light + 0.05) / (dark + 0.05);
}

/* ------------------------------------------------------------------------------------------------
 * tokens.css parsing
 * ---------------------------------------------------------------------------------------------- */

/**
 * `--name: value;` pairs from a CSS text (values whitespace-collapsed; comments stripped).
 * @param {string} cssText
 * @returns {Map<string, string>}
 */
export function parseTokensCss(cssText) {
  const noComments = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  /** @type {Map<string, string>} */
  const out = new Map();
  for (const m of noComments.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    out.set(`--${m[1]}`, m[2].replace(/\s+/g, ' ').trim());
  }
  return out;
}

/** @param {string} value */
function isColourValue(value) {
  return /^(#|rgba?\(|repeating-linear-gradient\()/i.test(value.trim());
}

/**
 * Comparable form of a colour value: lower-case; numbers canonicalised (`.92` → `0.92`, `.10` → `0.1`
 * — prettier rewrites tokens.css that way); then all whitespace removed. Hex compares case-insensitively.
 * @param {string} value
 * @returns {string}
 */
export function normaliseValue(value) {
  const lower = String(value).trim().toLowerCase();
  if (lower.startsWith('#')) return lower;
  return lower
    .replace(/(?<![\w.#-])(\d*\.\d+|\d+)/g, (n) => String(Number.parseFloat(n)))
    .replace(/\s+/g, '');
}

/* ------------------------------------------------------------------------------------------------
 * --check: tokens-only CSS guard
 * ---------------------------------------------------------------------------------------------- */

/** @typedef {{ file: string; line: number; text: string; rule: string }} Offender */

/**
 * @param {string} dir absolute
 * @param {string[]} out
 */
function walkCss(dir, out) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walkCss(full, out);
    else if (entry.endsWith('.css')) out.push(full);
  }
  return out;
}

/** @param {string} text @param {number} index */
function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

/** @param {string} value */
function splitTopLevelCommas(value) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of value) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  return parts;
}

const LENGTH_RE = /^-?(\d*\.\d+|\d+)(px|em|rem|%|vw|vh|ch)?$/;
const RADIUS_ALLOWED = new Set(['0', '3px', 'var(--radius-input)', 'var(--radius-chip)']);
const RADIUS_PROP = /^border(-[a-z]+)*-radius$/;
const HAIRLINE_PROP =
  /^(border(-(top|right|bottom|left|inline|block)(-(start|end))?)?(-width)?|outline(-width)?)$/;

/** Line-level rules (raw lines, comments included — same scope as the INV-61 grep). */
const LINE_RULES = [
  { rule: 'raw hex colour (only styles/tokens.css may hold one)', re: /#[0-9a-fA-F]{3,8}\b/ },
  { rule: 'rgb()/rgba() colour (only styles/tokens.css)', re: /\brgba?\(/ },
  { rule: 'hsl()/hsla() colour (only styles/tokens.css)', re: /\bhsla?\(/ },
  { rule: '!important', re: /!important/ },
  { rule: 'gradient (only var(--hatch) in styles/tokens.css)', re: /linear-gradient/ },
  { rule: 'blur() filter (no blur anywhere)', re: /\bblur\(/ },
  { rule: 'drop-shadow() filter (shadows are Npx Npx 0 var(--…))', re: /drop-shadow\(/ },
];

/**
 * Offenders in one CSS text.
 * @param {string} text
 * @param {string} file display path
 * @returns {Offender[]}
 */
export function checkCssText(text, file) {
  /** @type {Offender[]} */
  const offenders = [];
  const lines = text.split('\n');
  lines.forEach((raw, i) => {
    for (const { rule, re } of LINE_RULES) {
      if (re.test(raw)) offenders.push({ file, line: i + 1, text: raw.trim(), rule });
    }
  });

  // Declaration-level rules (values may span lines: box-shadow lists, etc.).
  for (const m of text.matchAll(/([a-z-]+)\s*:\s*([^;{}]*)/g)) {
    const prop = m[1];
    const value = m[2].replace(/\s+/g, ' ').trim();
    const line = lineOf(text, m.index ?? 0);
    const snippet = `${prop}: ${value}`;

    if (prop === 'box-shadow' && value !== 'none') {
      for (const shadow of splitTopLevelCommas(value)) {
        const lengths = shadow
          .trim()
          .split(/\s+/)
          .filter((t) => t !== 'inset' && LENGTH_RE.test(t));
        const blur = lengths[2];
        if (blur !== undefined && Number.parseFloat(blur) !== 0) {
          offenders.push({
            file,
            line,
            text: snippet,
            rule: 'box-shadow with a blur radius (shadows are Npx Npx 0 var(--…))',
          });
        }
      }
    }

    if (RADIUS_PROP.test(prop)) {
      const bad =
        value.includes('/') || value.split(/\s+/).some((token) => !RADIUS_ALLOWED.has(token));
      if (bad) {
        offenders.push({
          file,
          line,
          text: snippet,
          rule: 'border-radius other than 0 / 3px / var(--radius-input) / var(--radius-chip)',
        });
      }
    }

    if (HAIRLINE_PROP.test(prop) && /(^|\s)1px(\s|$)/.test(value)) {
      offenders.push({
        file,
        line,
        text: snippet,
        rule: '1px hairline (borders are 2px; outline 3px)',
      });
    }
  }
  return offenders;
}

/**
 * Scan `**\/*.css` under the given dirs (relative to ROOT; styles/, components/, app/ are always
 * included) — every file except styles/tokens.css must be tokens-only.
 * @param {string[]} [dirs]
 * @returns {{ files: string[]; offenders: Offender[] }}
 */
export function checkCss(dirs = []) {
  const wanted = [...new Set([...DEFAULTS.checkDirs, ...dirs.map((d) => d.replace(/\/+$/, ''))])];
  /** @type {string[]} */
  const cssFiles = [];
  for (const dir of wanted) {
    const abs = path.resolve(ROOT, dir);
    if (!existsSync(abs)) continue;
    if (statSync(abs).isDirectory()) walkCss(abs, cssFiles);
    else if (abs.endsWith('.css')) cssFiles.push(abs);
  }
  const tokensAbs = path.resolve(ROOT, DEFAULTS.tokensCss);
  /** @type {Offender[]} */
  const offenders = [];
  const files = [];
  for (const abs of [...new Set(cssFiles)].sort()) {
    if (abs === tokensAbs) continue;
    const rel = path.relative(ROOT, abs).split(path.sep).join('/');
    files.push(rel);
    offenders.push(...checkCssText(readFileSync(abs, 'utf8'), rel));
  }
  return { files, offenders };
}

/* ------------------------------------------------------------------------------------------------
 * --pairs: DESIGN.md §1 "Safe" pairs + component pairs
 * ---------------------------------------------------------------------------------------------- */

/** Text pairs (≥ 4.5): DESIGN.md §1 Contrast rules "Safe" + the component pairs 03 §2 relies on. */
export const TEXT_PAIRS = [
  ['chalk', 'ink'],
  ['mute', 'ink'],
  ['mute-dim', 'ink'],
  ['gold', 'ink'],
  ['indigo-lift', 'ink'],
  ['white', 'indigo'],
  ['ink', 'gold'],
  ['ink', 'emerald'],
  ['gold-ink', 'gold'],
  ['gold-bright', 'gold-wash'],
  ['emerald-soft', 'emerald-wash'],
  ['mod-badge-text', 'indigo-wash'],
  ['chalk', 'plugin-wash'],
  ['chalk', 'slab'],
  ['mute', 'slab'],
  ['mute-dim', 'slab'],
  ['white', 'alert'],
  ['chalk', 'slab-raised'],
  ['chalk', 'slab-sunk'],
  ['danger', 'danger-wash'],
  ['danger', 'ink'],
];

/** UI pairs (≥ 3): borders, underlines, swatches. */
export const UI_PAIRS = [
  ['indigo-lift', 'slab'],
  ['gold', 'slab'],
  ['emerald', 'ink'],
];

/**
 * Printed only, never gated:
 * - disabled controls are exempt from the contrast minimum (WCAG 1.4.3 inactive);
 * - ['line-strong', 'slab'] (secondary-button border on slab): WCAG 1.4.11 does not require boundary
 *   contrast on a text-labelled control; DESIGN.md §5 keeps --line-strong.
 */
export const EXEMPT_PAIRS = [
  ['disabled-text', 'disabled-fill'],
  ['line-strong', 'slab'],
];

export const TEXT_MIN = 4.5;
export const UI_MIN = 3;

/** @typedef {{ fg: string; bg: string; kind: 'text'|'ui'|'exempt'; ratio: number|null; min: number|null; ok: boolean; note?: string }} PairRow */

/**
 * @param {string} [tokensCssPath] relative to ROOT or absolute
 * @returns {{ rows: PairRow[]; failures: PairRow[] }}
 */
export function checkPairs(tokensCssPath = DEFAULTS.tokensCss) {
  const tokens = parseTokensCss(readFileSync(path.resolve(ROOT, tokensCssPath), 'utf8'));
  /** @type {PairRow[]} */
  const rows = [];
  /** @param {string} name */
  const hexOf = (name) => {
    const v = tokens.get(`--${name}`);
    return v && v.startsWith('#') ? v : null;
  };
  /**
   * @param {string[][]} pairs
   * @param {'text'|'ui'|'exempt'} kind
   * @param {number|null} min
   */
  const add = (pairs, kind, min) => {
    for (const [fg, bg] of pairs) {
      const a = hexOf(fg);
      const b = hexOf(bg);
      if (!a || !b) {
        rows.push({
          fg,
          bg,
          kind,
          ratio: null,
          min,
          ok: false,
          note: `missing token ${!a ? `--${fg}` : `--${bg}`}`,
        });
        continue;
      }
      const ratio = contrast(a, b);
      rows.push({ fg, bg, kind, ratio, min, ok: min === null ? true : ratio >= min });
    }
  };
  add(TEXT_PAIRS, 'text', TEXT_MIN);
  add(UI_PAIRS, 'ui', UI_MIN);
  add(EXEMPT_PAIRS, 'exempt', null);
  return { rows, failures: rows.filter((r) => !r.ok) };
}

/* ------------------------------------------------------------------------------------------------
 * --tokens: parity between DESIGN.md §1 Dark ∪ 03 §9 and styles/tokens.css
 * ---------------------------------------------------------------------------------------------- */

/**
 * Markdown table rows `| \`--name\` | \`value\` | …` (multi-name rows split on ` / `) inside a section.
 * @param {string} md
 * @param {RegExp} startRe heading that opens the section
 * @param {RegExp} endRe heading that closes it
 * @param {string} source label for messages
 * @returns {Map<string, { value: string; source: string }>}
 */
function parseTokenTable(md, startRe, endRe, source) {
  /** @type {Map<string, { value: string; source: string }>} */
  const out = new Map();
  const start = md.search(startRe);
  if (start === -1) throw new Error(`contrast --tokens: section ${startRe} not found in ${source}`);
  const headingEnd = md.indexOf('\n', start);
  const bodyStart = headingEnd === -1 ? md.length : headingEnd + 1;
  const endRel = md.slice(bodyStart).search(endRe);
  const section = endRel === -1 ? md.slice(start) : md.slice(start, bodyStart + endRel);
  for (const line of section.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    const nameCell = cells[1] ?? '';
    const valueCell = cells[2] ?? '';
    // Name cell = one or more backticked `--name`s separated by ` / ` — descriptive rows ("Non-colour: …") skip.
    if (!/^`--[\w-]+`(\s*\/\s*`--[\w-]+`)*$/.test(nameCell)) continue;
    const names = [...nameCell.matchAll(/`(--[\w-]+)`/g)].map((m) => m[1]);
    const values = [...valueCell.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim());
    if (values.length === 0 || values.length !== names.length) continue;
    names.forEach((name, i) => out.set(name, { value: values[i], source }));
  }
  return out;
}

/** @typedef {{ name: string; kind: 'missing'|'extra'|'value'|'spec-conflict'; expected?: string; actual?: string; source?: string; message: string }} TokenMismatch */

/**
 * @param {string} [tokensCssPath]
 * @param {string} [designMdPath]
 * @param {string} [componentsMdPath]
 * @returns {{ expected: Map<string, { value: string; source: string }>; actual: Map<string, string>; mismatches: TokenMismatch[] }}
 */
export function checkTokens(
  tokensCssPath = DEFAULTS.tokensCss,
  designMdPath = DEFAULTS.designMd,
  componentsMdPath = DEFAULTS.componentsMd,
) {
  const design = readFileSync(path.resolve(ROOT, designMdPath), 'utf8');
  const components = readFileSync(path.resolve(ROOT, componentsMdPath), 'utf8');
  const css = readFileSync(path.resolve(ROOT, tokensCssPath), 'utf8');

  const dark = parseTokenTable(design, /^### Dark \(default\)/m, /^##/m, 'DESIGN.md §1 Dark');
  const derived = parseTokenTable(components, /^## 9\./m, /^## /m, '03 §9 derived');

  /** @type {TokenMismatch[]} */
  const mismatches = [];
  /** @type {Map<string, { value: string; source: string }>} */
  const expected = new Map(dark);
  for (const [name, entry] of derived) {
    const prior = expected.get(name);
    if (prior && normaliseValue(prior.value) !== normaliseValue(entry.value)) {
      mismatches.push({
        name,
        kind: 'spec-conflict',
        expected: prior.value,
        actual: entry.value,
        message: `${name}: ${prior.source} says ${prior.value} but ${entry.source} says ${entry.value}`,
      });
    }
    if (!prior) expected.set(name, entry);
  }

  /** @type {Map<string, string>} */
  const actual = new Map();
  for (const [name, value] of parseTokensCss(css)) {
    if (isColourValue(value)) actual.set(name, value);
  }

  for (const [name, entry] of expected) {
    const got = actual.get(name);
    if (got === undefined) {
      mismatches.push({
        name,
        kind: 'missing',
        expected: entry.value,
        source: entry.source,
        message: `${name} (${entry.source} ${entry.value}) is missing from styles/tokens.css`,
      });
    } else if (normaliseValue(got) !== normaliseValue(entry.value)) {
      mismatches.push({
        name,
        kind: 'value',
        expected: entry.value,
        actual: got,
        source: entry.source,
        message: `${name} is ${got} in styles/tokens.css but ${entry.value} in ${entry.source}`,
      });
    }
  }
  for (const [name, value] of actual) {
    if (!expected.has(name)) {
      mismatches.push({
        name,
        kind: 'extra',
        actual: value,
        message: `${name} (${value}) is in styles/tokens.css but in neither DESIGN.md §1 Dark nor 03 §9`,
      });
    }
  }
  mismatches.sort((a, b) => a.name.localeCompare(b.name));
  return { expected, actual, mismatches };
}

/* ------------------------------------------------------------------------------------------------
 * CLI
 * ---------------------------------------------------------------------------------------------- */

/** @param {string[]} argv */
export function parseArgs(argv) {
  const opts = { check: false, pairs: false, tokens: false, dirs: /** @type {string[]} */ ([]) };
  let mode = /** @type {'check'|null} */ (null);
  for (const arg of argv) {
    if (arg === '--check') {
      opts.check = true;
      mode = 'check';
    } else if (arg === '--pairs') {
      opts.pairs = true;
      mode = null;
    } else if (arg === '--tokens') {
      opts.tokens = true;
      mode = null;
    } else if (arg.startsWith('--')) {
      throw new Error(`contrast: unknown flag ${arg} (use --check <dir…>, --pairs, --tokens)`);
    } else if (mode === 'check') {
      opts.dirs.push(arg);
    } else {
      throw new Error(`contrast: unexpected argument ${arg}`);
    }
  }
  if (!opts.check && !opts.pairs && !opts.tokens) {
    opts.check = true;
    opts.pairs = true;
  }
  return opts;
}

/** @param {number|null} n */
const fmt = (n) => (n === null ? '   —' : n.toFixed(2).padStart(6));

export function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
  let failed = false;

  if (opts.check) {
    const { files, offenders } = checkCss(opts.dirs);
    if (offenders.length === 0) {
      console.log(`contrast --check: ${files.length} css file(s) tokens-only — OK`);
    } else {
      failed = true;
      console.error(
        `contrast --check: ${offenders.length} offender(s) in ${files.length} css file(s):`,
      );
      for (const o of offenders) console.error(`  ${o.file}:${o.line}: ${o.text}    [${o.rule}]`);
    }
  }

  if (opts.pairs) {
    const { rows, failures } = checkPairs();
    console.log('contrast --pairs (from styles/tokens.css):');
    console.log('  fg              on  bg               kind    ratio   min   result');
    for (const r of rows) {
      const result = r.kind === 'exempt' ? 'exempt' : r.ok ? 'pass' : 'FAIL';
      const note = r.note ? `  (${r.note})` : '';
      console.log(
        `  ${r.fg.padEnd(15)} on  ${r.bg.padEnd(15)}  ${r.kind.padEnd(6)} ${fmt(r.ratio)}  ${
          r.min === null ? ' —  ' : String(r.min).padEnd(4)
        }  ${result}${note}`,
      );
    }
    if (failures.length > 0) {
      failed = true;
      console.error(`contrast --pairs: ${failures.length} failing pair(s).`);
    } else {
      console.log('contrast --pairs: all pairs pass.');
    }
  }

  if (opts.tokens) {
    const { expected, actual, mismatches } = checkTokens();
    if (mismatches.length === 0) {
      console.log(
        `contrast --tokens: ${actual.size} colour tokens in styles/tokens.css == ${expected.size} in DESIGN.md §1 Dark ∪ 03 §9 — OK`,
      );
    } else {
      failed = true;
      console.error(`contrast --tokens: ${mismatches.length} mismatch(es):`);
      for (const m of mismatches) console.error(`  ${m.kind.padEnd(13)} ${m.message}`);
    }
  }

  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
