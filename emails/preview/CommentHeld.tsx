/**
 * emails/preview/CommentHeld.tsx — `pnpm email dev` preview for `CommentHeld` (03 §6 E-01/E-09),
 * the first-time variant with the gold APPROVE button. Sample data only (E-08). Default export as
 * React Email's preview app requires.
 */
import { CommentHeld } from '../templates/CommentHeld';

const SITE = 'http://localhost:3000';

export default function CommentHeldPreview() {
  return (
    <CommentHeld
      project={{ title: 'Heavy Spear', url: `${SITE}/projects/heavy-spear` }}
      comment={{
        handle: 'netherrose',
        excerpt: 'does this work with the shield rework mod?',
        url: `${SITE}/projects/heavy-spear#comments`,
      }}
      approveUrl={`${SITE}/admin/comments`}
      manageUrl={`${SITE}/admin/settings`}
      firstTime
    />
  );
}
