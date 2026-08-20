/**
 * tests/fixtures/ui/onboardingPanel.ts — `OnboardingPanel` for `/dev/components` (03 §2.5, §3).
 * No props (Q34: nothing prefilled). `idle` at rest; `submitting` / `error` need the
 * `completeOnboarding` action (signed-in session with a null handle).
 */
import type { OnboardingPanelProps } from '@/components/accounts/OnboardingPanel';

export type OnboardingPanelFixture = { label: string; props: OnboardingPanelProps };

export const onboardingPanelFixtures: OnboardingPanelFixture[] = [
  { label: 'OnboardingPanel · idle', props: {} },
];
