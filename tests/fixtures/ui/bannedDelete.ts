/**
 * tests/fixtures/ui/bannedDelete.ts — `BannedDelete` for `/dev/components` (03 §2.5, §3; ADR-0021).
 * The component takes no props (it always renders the `/banned` Delete account trigger); `open` and
 * `pending` are reached by interacting with the specimen — confirming as anon surfaces the inline
 * `error` state (`unauthenticated`), which is exactly the §3 error line. This file documents the one
 * call site's copy the way `inlineConfirm.ts` does.
 */
export type BannedDeleteFixture = { label: string };

export const bannedDeleteFixtures: BannedDeleteFixture[] = [
  { label: 'BannedDelete · closed (open / pending / error by interaction)' },
];
