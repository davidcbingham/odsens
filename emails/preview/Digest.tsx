/**
 * emails/preview/Digest.tsx — `pnpm email dev` preview for `Digest` (ADR-0030 D7; 03 §6 E-01/E-09)
 * with six items — the smallest pile that triggers a digest (04 N2). Sample data only. Default
 * export as React Email's preview app requires.
 */
import { Digest } from '../templates/Digest';

const SITE = 'http://localhost:3000';

export default function DigestPreview() {
  return (
    <Digest
      count={6}
      items={[
        { kind: 'comment.new', title: 'Metal Pipe Mace', excerpt: 'this mace is unreasonably fun' },
        { kind: 'comment.new', title: 'Metal Pipe Mace', excerpt: 'the sound gets me every time' },
        {
          kind: 'comment.held',
          title: 'Heavy Spear',
          excerpt: 'does this work with the shield rework mod?',
        },
        { kind: 'comment.reported', title: 'Heavy Spear', excerpt: 'free diamonds at my site' },
        {
          kind: 'sync.failed',
          title: 'Modrinth',
          excerpt: '429 rate limit on /v2/project/metal-pipe-mace',
        },
        { kind: 'comment.new', title: 'Copper Golem Pack', excerpt: 'the little guy waves. 10/10' },
      ]}
      url={`${SITE}/admin/comments`}
      manageUrl={`${SITE}/admin/settings`}
    />
  );
}
