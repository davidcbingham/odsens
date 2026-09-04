/**
 * emails/templates/CommentNew.tsx — `CommentNew` (03 §2.11; §6 E-05..E-08; DESIGN.md §12.1 "The
 * allay": new comment → "The allay picked this up on…"; prototype pass-3 "Email new comment").
 * Subject "New comment on <title>" is built by the deliverer (04 N5, T-UNIT-26). Badge NEW COMMENT
 * (indigo-wash) · h1 = the project title · lead "The allay picked this up on <project>, from
 * <handle>:" · the excerpt (arrives pre-clipped, React-escaped, links stripped — E-05) · one indigo
 * button "View comment".
 * Props carry a handle, never an email or name (E-08); a null handle is "a deleted account"
 * (ADR-0030 D4). Footer switch word: "comment mail".
 */
import { EmailBadge } from '../components/EmailBadge';
import { EmailButton } from '../components/EmailButton';
import { EmailLayout } from '../components/EmailLayout';
import {
  Actions,
  Excerpt,
  Lead,
  h1Style,
  handleLabel,
  siteUrlFrom,
  stripLinks,
  strongStyle,
} from '../components/shared';

export type CommentNewProps = {
  project: { title: string; url: string };
  comment: { handle: string | null; excerpt: string; url: string };
  manageUrl: string;
  /** Absolute site origin for images (E-07); defaults to the origin of `manageUrl`. */
  siteUrl?: string;
};

const SIGNOFF = "— the allay. It picks things up and brings them to you. That's the whole job.";

export function CommentNew({ project, comment, manageUrl, siteUrl }: CommentNewProps) {
  const who = handleLabel(comment.handle);
  const excerpt = stripLinks(comment.excerpt);
  return (
    <EmailLayout
      preview={`The allay picked this up on ${project.title}, from ${who}.`}
      footer={{
        why: 'The allay emails you because comment mail is on.',
        manageUrl,
        signoff: SIGNOFF,
      }}
      siteUrl={siteUrlFrom(manageUrl, siteUrl)}
    >
      <EmailBadge tone="indigo-wash">NEW COMMENT</EmailBadge>
      <h1 style={h1Style}>{project.title}</h1>
      <Lead>
        The allay picked this up on <strong style={strongStyle}>{project.title}</strong>, from{' '}
        <strong style={strongStyle}>{who}</strong>:
      </Lead>
      <Excerpt>{`"${excerpt}"`}</Excerpt>
      <Actions button={<EmailButton href={comment.url}>View comment</EmailButton>} />
    </EmailLayout>
  );
}
