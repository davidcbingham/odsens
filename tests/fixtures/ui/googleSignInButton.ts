/**
 * tests/fixtures/ui/googleSignInButton.ts — `GoogleSignInButton` for `/dev/components` (03 §2.2; T-E2E-48):
 * the chalk "Continue with Google" block (prompt / admin) and the outlined nav "Sign in" (03 N-04).
 * Clicking starts the real OAuth redirect against the local stack — pending = `aria-busy`.
 */
import type { GoogleSignInButtonProps } from '@/components/primitives/GoogleSignInButton';

export type GoogleSignInButtonFixture = { label: string; props: GoogleSignInButtonProps };

export const googleSignInButtonFixtures: GoogleSignInButtonFixture[] = [
  { label: 'GoogleSignInButton · prompt', props: { from: 'prompt' } },
  { label: 'GoogleSignInButton · admin', props: { from: 'admin', next: '/admin' } },
  { label: 'GoogleSignInButton · nav sign in', props: { from: 'nav', label: 'Sign in' } },
  {
    label: 'GoogleSignInButton · next hash',
    props: { from: 'prompt', next: '/projects/pixel-chameleon#comments' },
  },
];
