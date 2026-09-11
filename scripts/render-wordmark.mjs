#!/usr/bin/env node
/**
 * scripts/render-wordmark.mjs — human-run, once (never in tests or CI). Renders the `ODSENS` wordmark
 * for the email header (03 §6 E-07 "wordmark ships as PNG, 2× for retina"; DESIGN.md §12.1 Email
 * template — "display type falls back to Impact / Arial Black" in mail, so the real Bungee glyphs
 * ship as an image) from the self-hosted font `public/fonts/bungee-400.woff2` (01 INV-63; the family
 * `app/layout.tsx` registers as `--font-display`) at `--text-wordmark` (20px) in `--chalk` (#eef1f6),
 * transparent background, via headless Chromium (Playwright, already a dev dependency).
 *   node scripts/render-wordmark.mjs
 * Writes public/brand/email/wordmark.png (1×, 20px tall) and wordmark@2x.png (2×). The PNGs are
 * committed; re-run only when the font or the token changes. Zero extra deps.
 */
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = process.cwd();
const FONT = path.join(ROOT, 'public', 'fonts', 'bungee-400.woff2');
const OUT_DIR = path.join(ROOT, 'public', 'brand', 'email');
const SIZE_PX = 20; // styles/tokens.css --text-wordmark
const CHALK = '#eef1f6'; // styles/tokens.css --chalk

const fontData = readFileSync(FONT).toString('base64');
const html = `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  @font-face { font-family: 'Bungee'; src: url(data:font/woff2;base64,${fontData}) format('woff2'); font-weight: 400; font-style: normal; }
  html, body { margin: 0; padding: 0; background: transparent; }
  #mark { display: inline-block; font-family: 'Bungee'; font-size: ${SIZE_PX}px; line-height: 1; height: ${SIZE_PX}px; color: ${CHALK}; white-space: nowrap; -webkit-font-smoothing: antialiased; }
</style></head>
<body><span id="mark">ODSENS</span></body></html>`;

const browser = await chromium.launch();
try {
  for (const [file, scale] of [
    ['wordmark.png', 1],
    ['wordmark@2x.png', 2],
  ]) {
    const page = await browser.newPage({
      deviceScaleFactor: scale,
      viewport: { width: 400, height: 100 },
    });
    await page.setContent(html);
    await page.evaluate(() => document.fonts.ready);
    const mark = page.locator('#mark');
    const box = await mark.boundingBox();
    const out = path.join(OUT_DIR, file);
    await mark.screenshot({ path: out, omitBackground: true, type: 'png' });
    await page.close();
    const bytes = statSync(out).size;
    console.log(
      `render-wordmark: ${path.relative(ROOT, out)} ${Math.round(box.width * scale)}×${Math.round(box.height * scale)} px, ${bytes} bytes (css ${Math.round(box.width)}×${Math.round(box.height)})`,
    );
    if (bytes > 20 * 1024) console.warn(`render-wordmark: ${file} is over 20 KB`);
  }
} finally {
  await browser.close();
}
