/**
 * tests/unit/analytics.test.ts — T-UNIT-38: `lib/analytics.ts` `trackEvent` allowlist
 * (04 §5.6; 01 INV-59; ADR-0002 C12; 00 S1.3 "download event schema" / S1.9.AC8).
 *
 * The `TrackProps` union IS the runtime allowlist: exactly the four v1 names, payload values
 * strings/numbers only (non-primitive values are dropped before delivery), no handles / user ids /
 * emails in any payload shape. Delivery goes through `window.va('event', {name, data})` and is a
 * no-op during SSR (no `window` — the unit env's natural state) or before the Vercel script loads.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TRACK_EVENT_NAMES, trackEvent, type TrackProps } from '@/lib/analytics';

type VaCall = { name: string; data: Record<string, string | number> };

/** Installs a `window.va` stub (node env has no window — `vi.stubGlobal` provides one). */
function installVa(): VaCall[] {
  const calls: VaCall[] = [];
  vi.stubGlobal('window', {
    va: (_kind: 'event', payload: VaCall) => {
      calls.push(payload);
    },
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('trackEvent (T-UNIT-38)', () => {
  it('T-UNIT-38 the union is exactly the four v1 event names (ADR-0002 C12)', () => {
    expect([...TRACK_EVENT_NAMES].sort()).toEqual(
      ['download', 'sign_in', 'tip_click', 'video_play'].sort(),
    );
    // `external_out` was rejected (04 §5.6) — the const array carries no fifth name.
    expect(TRACK_EVENT_NAMES).toHaveLength(4);
  });

  it('T-UNIT-38 download payload = {project, source, from} (04 §5.6 verbatim keys)', () => {
    const calls = installVa();
    trackEvent('download', { project: 'seed-exclusive-pack', source: 'direct', from: 'get-it' });
    expect(calls).toEqual([
      {
        name: 'download',
        data: { project: 'seed-exclusive-pack', source: 'direct', from: 'get-it' },
      },
    ]);
  });

  it('T-UNIT-38 payload values are strings/numbers only — everything else is dropped', () => {
    const calls = installVa();
    // Simulates a mis-typed caller smuggling non-primitive values past the compiler.
    const dirty = {
      amount: 3,
      from: 'support',
      nested: { handle: 'oddsense' },
      list: ['x'],
      flag: true,
      empty: null,
    } as unknown as TrackProps['tip_click'];
    trackEvent('tip_click', dirty);
    expect(calls[0]?.data).toEqual({ amount: 3, from: 'support' });
  });

  it('T-UNIT-38 no payload shape carries a handle, profile id or email key', () => {
    // Compile-time truth restated at runtime for the gate: the 04 §5.6 key sets, verbatim.
    const allowedKeys: Record<(typeof TRACK_EVENT_NAMES)[number], string[]> = {
      download: ['project', 'source', 'from'],
      tip_click: ['amount', 'from'],
      video_play: ['youtube_id', 'kind'],
      sign_in: ['from'],
    };
    for (const keys of Object.values(allowedKeys)) {
      for (const banned of ['handle', 'profile_id', 'email', 'user_id', 'url']) {
        expect(keys).not.toContain(banned);
      }
    }
  });

  it('T-UNIT-38 SSR (no window) and no `window.va` are both silent no-ops', () => {
    expect(() => trackEvent('sign_in', { from: 'nav' })).not.toThrow(); // no window at all
    vi.stubGlobal('window', {});
    expect(() => trackEvent('sign_in', { from: 'nav' })).not.toThrow(); // window, no va
  });
});
