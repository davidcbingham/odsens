/**
 * tests/unit/settings-matrixDiff.test.ts — T-UNIT-41: `lib/settings/matrixDiff.ts` (03
 * `NotificationMatrix` → `updateSettings` payload; 04 §1.3 `matrix`; 00 S1.5 "one row toggles both
 * kinds"). Diff of two matrices → only the changed `(kind, channel, enabled)` triples; never emits
 * COMING LATER kinds; stable (`matrixDefaults`) order; `expandSyncRow` writes both sync kinds.
 */
import { describe, expect, it } from 'vitest';
import { matrixDefaults } from '@/lib/notify/matrix';
import { expandSyncRow, matrixDiff } from '@/lib/settings/matrixDiff';

function withCell(kind: string, channel: string, enabled: boolean) {
  return matrixDefaults.map((e) =>
    e.kind === kind && e.channel === channel ? { ...e, enabled } : e,
  );
}

describe('matrixDiff (T-UNIT-41)', () => {
  it('T-UNIT-41 identical matrices → empty diff', () => {
    expect(matrixDiff(matrixDefaults, matrixDefaults)).toEqual([]);
    expect(matrixDiff(matrixDefaults, [...matrixDefaults].reverse())).toEqual([]);
    expect(matrixDiff([], [])).toEqual([]);
  });

  it('T-UNIT-41 one flipped cell → exactly that triple', () => {
    expect(matrixDiff(matrixDefaults, withCell('comment.new', 'email', false))).toEqual([
      { kind: 'comment.new', channel: 'email', enabled: false },
    ]);
    expect(matrixDiff(matrixDefaults, withCell('sync.failed', 'discord', true))).toEqual([
      { kind: 'sync.failed', channel: 'discord', enabled: true },
    ]);
  });

  it('T-UNIT-41 several changes come back in matrixDefaults order whatever order the state holds', () => {
    const after = [
      ...withCell('sync.stale', 'discord', true).filter((e) => e.kind !== 'comment.new'),
      { kind: 'comment.new', channel: 'discord', enabled: false },
      { kind: 'comment.new', channel: 'email', enabled: false },
    ].reverse();
    expect(matrixDiff(matrixDefaults, after)).toEqual([
      { kind: 'comment.new', channel: 'email', enabled: false },
      { kind: 'comment.new', channel: 'discord', enabled: false },
      { kind: 'sync.stale', channel: 'discord', enabled: true },
    ]);
  });

  it('T-UNIT-41 never emits a COMING LATER kind, even when it changed in the after list', () => {
    const after = withCell('tip.new', 'email', true).map((e) =>
      e.kind === 'order.new' ? { ...e, enabled: false } : e,
    );
    expect(matrixDiff(matrixDefaults, after)).toEqual([]);
    const mixed = after.map((e) =>
      e.kind === 'comment.held' && e.channel === 'discord' ? { ...e, enabled: false } : e,
    );
    expect(matrixDiff(matrixDefaults, mixed)).toEqual([
      { kind: 'comment.held', channel: 'discord', enabled: false },
    ]);
  });

  it('T-UNIT-41 unknown kinds and Phase-2 channels are dropped, not passed through', () => {
    const after = [
      ...matrixDefaults,
      { kind: 'comment.reply', channel: 'email', enabled: true },
      { kind: 'comment.new', channel: 'inapp', enabled: true },
      { kind: 'workroom.post', channel: 'discord', enabled: true },
    ];
    expect(matrixDiff(matrixDefaults, after)).toEqual([]);
  });

  it('T-UNIT-41 an after cell with no before twin is written; a before cell missing from after is not', () => {
    expect(matrixDiff([], [{ kind: 'comment.new', channel: 'email', enabled: true }])).toEqual([
      { kind: 'comment.new', channel: 'email', enabled: true },
    ]);
    expect(matrixDiff(matrixDefaults, [])).toEqual([]);
  });

  it('T-UNIT-41 flipping a cell back to its before value cancels out', () => {
    const flipped = withCell('comment.reported', 'email', false);
    const restored = flipped.map((e) =>
      e.kind === 'comment.reported' && e.channel === 'email' ? { ...e, enabled: true } : e,
    );
    expect(matrixDiff(matrixDefaults, restored)).toEqual([]);
  });

  it('T-UNIT-41 duplicates in the after list resolve to the last occurrence', () => {
    const after = [
      ...matrixDefaults,
      { kind: 'comment.new', channel: 'email', enabled: false },
      { kind: 'comment.new', channel: 'email', enabled: true },
    ];
    expect(matrixDiff(matrixDefaults, after)).toEqual([]);
  });

  it('T-UNIT-41 the result carries only kind / channel / enabled (no stray keys reach the action)', () => {
    const after = withCell('comment.new', 'discord', false).map((e) => ({ ...e, updated_at: 'x' }));
    const diff = matrixDiff(matrixDefaults, after);
    expect(diff).toHaveLength(1);
    expect(Object.keys(diff[0] ?? {}).sort()).toEqual(['channel', 'enabled', 'kind']);
  });

  it('T-UNIT-41 does not mutate its inputs', () => {
    const before = matrixDefaults.map((e) => ({ ...e }));
    const after = withCell('sync.failed', 'email', false);
    const beforeSnapshot = JSON.stringify(before);
    const afterSnapshot = JSON.stringify(after);
    matrixDiff(before, after);
    expect(JSON.stringify(before)).toBe(beforeSnapshot);
    expect(JSON.stringify(after)).toBe(afterSnapshot);
  });
});

describe('expandSyncRow (T-UNIT-41 — the one-row-toggles-both rule)', () => {
  it('T-UNIT-41 ON for a channel → sync.failed then sync.stale, both ON', () => {
    expect(expandSyncRow(true, 'discord')).toEqual([
      { kind: 'sync.failed', channel: 'discord', enabled: true },
      { kind: 'sync.stale', channel: 'discord', enabled: true },
    ]);
  });

  it('T-UNIT-41 OFF for a channel → both OFF; the other channel is untouched', () => {
    const rows = expandSyncRow(false, 'email');
    expect(rows).toEqual([
      { kind: 'sync.failed', channel: 'email', enabled: false },
      { kind: 'sync.stale', channel: 'email', enabled: false },
    ]);
    expect(rows.every((r) => r.channel === 'email')).toBe(true);
  });

  it('T-UNIT-41 the expansion diffs cleanly against the defaults (sync × discord ON → two writes)', () => {
    const after = [
      ...matrixDefaults.filter((e) => !(e.kind.startsWith('sync.') && e.channel === 'discord')),
      ...expandSyncRow(true, 'discord'),
    ];
    expect(matrixDiff(matrixDefaults, after)).toEqual([
      { kind: 'sync.failed', channel: 'discord', enabled: true },
      { kind: 'sync.stale', channel: 'discord', enabled: true },
    ]);
  });
});
