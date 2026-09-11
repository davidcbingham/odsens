/**
 * emails/preview/CommentNew.tsx — `pnpm email dev` preview for `CommentNew` (03 §6 E-01/E-09).
 * Sample data only: handles + project titles, never an email or name (E-08). React Email's preview
 * app requires a default export here (the one place under `emails/` that has one).
 */
import { CommentNew } from '../templates/CommentNew';

const SITE = 'http://localhost:3000';

export default function CommentNewPreview() {
  return (
    <CommentNew
      project={{ title: 'Metal Pipe Mace', url: `${SITE}/projects/metal-pipe-mace` }}
      comment={{
        handle: 'creeperfan9',
        excerpt: 'this mace is unreasonably fun. the sound gets me every time',
        url: `${SITE}/projects/metal-pipe-mace#comments`,
      }}
      manageUrl={`${SITE}/admin/settings`}
    />
  );
}
