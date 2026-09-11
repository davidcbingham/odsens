/**
 * emails/preview/CommentReported.tsx — `pnpm email dev` preview for `CommentReported` (03 §6
 * E-01/E-09). Sample data only (E-08). Default export as React Email's preview app requires.
 */
import { CommentReported } from '../templates/CommentReported';

const SITE = 'http://localhost:3000';

export default function CommentReportedPreview() {
  return (
    <CommentReported
      project={{ title: 'Metal Pipe Mace', url: `${SITE}/projects/metal-pipe-mace` }}
      comment={{
        handle: 'blockhead_42',
        excerpt: 'free diamonds at my site, click the link in my bio',
        url: `${SITE}/projects/metal-pipe-mace#comments`,
      }}
      reportCount={2}
      reasons={['spam', 'off_topic']}
      url={`${SITE}/admin/comments`}
      manageUrl={`${SITE}/admin/settings`}
    />
  );
}
