/**
 * emails/preview/SyncFailed.tsx — `pnpm email dev` preview for `SyncFailed` (03 §6 E-01/E-09), the
 * stale variant with a cause (both blocks visible). Sample data only. Default export as React
 * Email's preview app requires.
 */
import { SyncFailed } from '../templates/SyncFailed';

const SITE = 'http://localhost:3000';

export default function SyncFailedPreview() {
  return (
    <SyncFailed
      source="modrinth"
      error="429 rate limit on /v2/project/metal-pipe-mace"
      runAt="3 Sep 2026, 14:10"
      stale
      hoursSinceOk={26}
      adminUrl={`${SITE}/admin`}
      manageUrl={`${SITE}/admin/settings`}
    />
  );
}
