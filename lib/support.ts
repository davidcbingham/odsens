/**
 * lib/support.ts — the two Ko-fi URLs `/support` uses (04 §5.7; 01 INV-58; ADR-0002 C19, #50).
 *
 * Plain module (no directive): bundled into the `KofiCard` / `KofiPanelSlot` client leaves.
 * The page name is `site_settings.kofi_page` (`[A-Za-z0-9_-]{1,40}` — `lib/actions/settings.schema.ts`),
 * encoded anyway so nothing typed in Settings can leave the path segment. There is no amount in
 * either URL: Ko-fi's panel takes no preset-amount parameter (checked against the live panel —
 * 04 §5.7, ADR-0042 D1), so the amount is chosen in Ko-fi and nowhere else.
 */

const KOFI_ORIGIN = 'https://ko-fi.com';

/** The "on Ko-fi ↗" ghost link: the page itself, opened in a new tab. */
export function kofiPageUrl(page: string): string {
  return `${KOFI_ORIGIN}/${encodeURIComponent(page)}`;
}

/** The `KofiPanelSlot` iframe `src` (01 INV-58) — Ko-fi's embeddable tip panel, feed hidden. */
export function kofiEmbedUrl(page: string): string {
  return `${kofiPageUrl(page)}/?hidefeed=true&widget=true&embed=true`;
}

/** `site_settings.kofi_page` → a usable page name, or `null` when tips are not open yet. */
export function normalizeKofiPage(value: string | null | undefined): string | null {
  const page = (value ?? '').trim();
  return page === '' ? null : page;
}
