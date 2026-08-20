/**
 * tests/fixtures/ui/handleField.ts — `HandleField` for `/dev/components` (03 §2.5, §3; T-E2E-48).
 * Structural reasons render instantly from `handleReason()` (no action call): resting, the unchanged
 * profile handle, too short, bad characters, contains `@`, reserved. `checking` → `available` / taken
 * need the `checkHandle` action (signed-in session) — type into the resting specimen to see them.
 */
import type { HandleFieldProps } from '@/components/accounts/HandleField';

export type HandleFieldFixture = { label: string; props: HandleFieldProps };

export const handleFieldFixtures: HandleFieldFixture[] = [
  { label: 'HandleField · resting', props: { name: 'handle' } },
  {
    label: 'HandleField · resting unchanged',
    props: { name: 'handle', defaultValue: 'pipe_enjoyer', currentHandle: 'pipe_enjoyer' },
  },
  { label: 'HandleField · invalid short', props: { name: 'handle', defaultValue: 'od' } },
  {
    label: 'HandleField · invalid long',
    props: { name: 'handle', defaultValue: 'this_handle_is_far_too_long' },
  },
  {
    label: 'HandleField · invalid chars',
    props: { name: 'handle', defaultValue: 'pipe enjoyer!' },
  },
  { label: 'HandleField · invalid at', props: { name: 'handle', defaultValue: 'me@mail' } },
  { label: 'HandleField · invalid reserved', props: { name: 'handle', defaultValue: 'admin' } },
];
