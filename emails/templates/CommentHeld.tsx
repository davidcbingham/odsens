/**
 * emails/templates/CommentHeld.tsx — `CommentHeld` (03 §2.11; §6 E-05..E-08; DESIGN.md §12.1 "The
 * allay": held → "The allay is holding it until you decide"; prototype pass-3 "Email held for
 * review"). Subject "Held for review: <title>" is the deliverer's (04 N5). Badge HELD FOR REVIEW
 * (gold-wash) · h1 = the project title · lead "First comment from <handle>, on <project>. The allay
 * is holding it until you decide:" when `firstTime`, else "The allay is holding it until you
 * decide:" · the excerpt (links stripped — E-05) with a `--gold-deep` border and the handle beneath
 * · the ONE gold button
 * "Approve" → `approveUrl` (E-05: gold only here) · a secondary text link "View" → the comment.
 * Footer switch word: "held-comment mail". Null handle → "a deleted account" (ADR-0030 D4).
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

export type CommentHeldProps = {
  project: { title: string; url: string };
  comment: { handle: string | null; excerpt: string; url: string };
  approveUrl: string;
  manageUrl: string;
  /** The event payload's `first_time` (04 §1.2) — switches the lead line. */
  firstTime?: boolean;
  /** Absolute site origin for images (E-07); defaults to the origin of `manageUrl`. */
  siteUrl?: string;
};

const HOLDING = 'The allay is holding it until you decide:';
const SIGNOFF =
  '— the allay, still holding the comment. It can hold it all day. Approve is one click.';

export function CommentHeld({
  project,
  comment,
  approveUrl,
  manageUrl,
  firstTime = false,
  siteUrl,
}: CommentHeldProps) {
  const who = handleLabel(comment.handle);
  const excerpt = stripLinks(comment.excerpt);
  const preview = firstTime
    ? `First comment from ${who}, on ${project.title}. The allay is holding it until you decide.`
    : 'The allay is holding it until you decide.';
  return (
    <EmailLayout
      preview={preview}
      footer={{
        why: 'The allay emails you because held-comment mail is on.',
        manageUrl,
        signoff: SIGNOFF,
      }}
      siteUrl={siteUrlFrom(manageUrl, siteUrl)}
    >
      <EmailBadge tone="gold-wash">HELD FOR REVIEW</EmailBadge>
      <h1 style={h1Style}>{project.title}</h1>
      <Lead>
        {firstTime ? (
          <>
            First comment from <strong style={strongStyle}>{who}</strong>, on{' '}
            <strong style={strongStyle}>{project.title}</strong>. {HOLDING}
          </>
        ) : (
          HOLDING
        )}
      </Lead>
      <Excerpt tone="gold" by={who}>
        {`"${excerpt}"`}
      </Excerpt>
      <Actions
        button={
          <EmailButton href={approveUrl} tone="gold">
            Approve
          </EmailButton>
        }
        link={{ href: comment.url, label: 'View' }}
      />
    </EmailLayout>
  );
}
