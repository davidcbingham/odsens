/**
 * tests/unit/support.test.ts — T-UNIT-54: `lib/support.ts` (04 §5.7; 01 INV-58; ADR-0002 C19, #50).
 * The two Ko-fi URLs `/support` uses and the empty-page rule. The amount is never in the URL (v1).
 */
import { describe, expect, it } from 'vitest';
import { kofiEmbedUrl, kofiPageUrl, normalizeKofiPage } from '@/lib/support';

describe('T-UNIT-54 lib/support', () => {
  it('kofiPageUrl → https://ko-fi.com/<page>', () => {
    expect(kofiPageUrl('oddsense')).toBe('https://ko-fi.com/oddsense');
  });

  it('kofiEmbedUrl → the INV-58 iframe src, no amount parameter', () => {
    const url = kofiEmbedUrl('oddsense');
    expect(url).toBe('https://ko-fi.com/oddsense/?hidefeed=true&widget=true&embed=true');
    expect(new URL(url).searchParams.has('amount')).toBe(false);
  });

  it('a page name can never leave its path segment', () => {
    for (const hostile of ['../evil', 'a/b', 'x?y=1', 'x#y', 'a b']) {
      const url = new URL(kofiEmbedUrl(hostile));
      expect(url.origin).toBe('https://ko-fi.com');
      expect(url.pathname.split('/').filter(Boolean)).toHaveLength(1);
      expect([...url.searchParams.keys()]).toEqual(['hidefeed', 'widget', 'embed']);
      expect(url.hash).toBe('');
    }
  });

  it('normalizeKofiPage: null / empty / whitespace → null (tips not open); else trimmed', () => {
    expect(normalizeKofiPage(null)).toBeNull();
    expect(normalizeKofiPage(undefined)).toBeNull();
    expect(normalizeKofiPage('')).toBeNull();
    expect(normalizeKofiPage('   ')).toBeNull();
    expect(normalizeKofiPage(' oddsense ')).toBe('oddsense');
  });
});
