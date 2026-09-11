/**
 * emails/templates/CommentReported.tsx — `CommentReported` (03 §2.11; §6 E-05..E-08). Subject
 * "Reported comment on <title>" is the deliverer's (04 N5). Badge REPORTED (gold-wash) · h1 = the
 * project title · lead "Someone reported a comment on <project>." · meta "<n> report(s) · <reasons>"
 * · the excerpt (gold border, handle beneath, links stripped — E-05) · one indigo button "Review"
 * → `url` (the admin
 * comments queue) · secondary text link "View" → the comment on the site. Footer switch word:
 * "reported-comment mail". Reasons arrive as the picker words; underscores read as spaces.
 */
import { EmailBadge } from '../components/EmailBadge';
import { EmailButton } from '../components/EmailButton';
import { EmailLayout } from '../components/EmailLayout';
import {
  Actions,
  Excerpt,
  Lead,
  Meta,
  h1Style,
  handleLabel,
  siteUrlFrom,
  stripLinks,
  strongStyle,
} from '../components/shared';

export type CommentReportedProps = {
  project: { title: string; url: string };
  comment: { handle: string | null; excerpt: string; url: string };
  reportCount: number;
  reasons: string[];
  /** Admin review link (`/admin/comments`). */
  url: string;
  manageUrl: string;
  /** Absolute site origin for images (E-07); defaults to the origin of `manageUrl`. */
  siteUrl?: string;
};

const SIGNOFF = '— the allay. It just carries the report. The call is yours.';

export function CommentReported({
  project,
  comment,
  reportCount,
  reasons,
  url,
  manageUrl,
  siteUrl,
}: CommentReportedProps) {
  const who = handleLabel(comment.handle);
  const excerpt = stripLinks(comment.excerpt);
  const count = `${reportCount} ${reportCount === 1 ? 'report' : 'reports'}`;
  const why = reasons.map((r) => r.replace(/_/g, ' ')).join(', ');
  return (
    <EmailLayout
      preview={`Someone reported a comment on ${project.title}.`}
      footer={{
        why: 'The allay emails you because reported-comment mail is on.',
        manageUrl,
        signoff: SIGNOFF,
      }}
      siteUrl={siteUrlFrom(manageUrl, siteUrl)}
    >
      <EmailBadge tone="gold-wash">REPORTED</EmailBadge>
      <h1 style={h1Style}>{project.title}</h1>
      <Lead>
        Someone reported a comment on <strong style={strongStyle}>{project.title}</strong>.
      </Lead>
      <Meta>{why ? `${count} · ${why}` : count}</Meta>
      <Excerpt tone="gold" by={who}>
        {`"${excerpt}"`}
      </Excerpt>
      <Actions
        button={<EmailButton href={url}>Review</EmailButton>}
        link={{ href: comment.url, label: 'View' }}
      />
    </EmailLayout>
  );
}
