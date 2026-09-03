/**
 * tests/helpers/time.ts — `freezeAt(iso)`, `advance(ms)`, `unfreeze()` (05 §1.3, FLK-3). Fakes the
 * APP clock only (`Date` — `vi.useFakeTimers({ toFake: ['Date'] })` leaves timers/promises real so
 * Supabase calls still resolve); DB `now()` is never faked — tests that need DB time (the 15-minute
 * edit window, staleness) set `created_at` via the service client instead. Real from S1.4.
 *
 *   freezeAt('2026-09-03T12:00:00Z');   // Date.now() === that instant
 *   advance(14 * 60_000 + 59_000);      // 14:59 later
 *   unfreeze();                          // afterEach
 */
import { vi } from 'vitest';

export function freezeAt(iso: string): void {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
}

export function advance(ms: number): void {
  vi.setSystemTime(new Date(Date.now() + ms));
}

export function unfreeze(): void {
  vi.useRealTimers();
}
