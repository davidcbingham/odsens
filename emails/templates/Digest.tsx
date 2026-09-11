/**
 * emails/templates/Digest.tsx — `Digest` (ADR-0030 D7; 04 N2/N5 "N things from the allay"; 03 §6
 * E-05..E-08). Sent when > 5 rows are eligible for one address in a tick. Subject "<N> things from
 * the allay" is the deliverer's. Badge DIGEST (indigo-wash) · h1 "<count> things" · lead "The allay
 * picked up <count> things. Here they are:" · a list of `<kind label> — <title>` rows with the
 * excerpt beneath (≤ 25 items — the deliverer clips; a larger `count` adds "…and N more in admin.")
 * · one indigo button "Open admin" → `url`. Footer switch word: "digest mail". The kind label is
 * the 04 §3.7 N6 event word (`DIGEST_KIND_LABELS` = `lib/notify/deliver/content.ts` `EVENT_LABELS`,
 * parity asserted by T-UNIT-3) so the mail and the Discord digest read alike; excerpts pass through
 * `stripLinks` (E-05).
 */
import { EmailBadge } from '../components/EmailBadge';
import { EmailButton } from '../components/EmailButton';
import { EmailLayout } from '../components/EmailLayout';
import {
  Actions,
  COLOR,
  FONT_BODY,
  Lead,
  Meta,
  h1Style,
  siteUrlFrom,
  stripLinks,
  strongStyle,
} from '../components/shared';

export type DigestProps = {
  count: number;
  items: { kind: string; title: string; excerpt: string }[];
  /** `/admin/comments` or `/admin` (04 N2). */
  url: string;
  manageUrl: string;
  /** Absolute site origin for images (E-07); defaults to the origin of `manageUrl`. */
  siteUrl?: string;
};

/**
 * 04 §3.7 N6 event words — New comment · Held for review · Reported comment · Sync failed · Sync
 * stale — kept as a local table so `emails/**` has no `lib/` import; T-UNIT-3 asserts it equals
 * `EVENT_LABELS` in `lib/notify/deliver/content.ts`.
 */
export const DIGEST_KIND_LABELS: Readonly<Record<string, string>> = {
  'comment.new': 'New comment',
  'comment.held': 'Held for review',
  'comment.reported': 'Reported comment',
  'sync.failed': 'Sync failed',
  'sync.stale': 'Sync stale',
};

function kindLabel(kind: string): string {
  return DIGEST_KIND_LABELS[kind] ?? kind;
}

const SIGNOFF = "— the allay. It waited until there was a pile. Here's the pile.";

export function Digest({ count, items, url, manageUrl, siteUrl }: DigestProps) {
  const more = count - items.length;
  return (
    <EmailLayout
      preview={`The allay picked up ${count} things.`}
      footer={{
        why: 'The allay emails you because digest mail is on.',
        manageUrl,
        signoff: SIGNOFF,
      }}
      siteUrl={siteUrlFrom(manageUrl, siteUrl)}
    >
      <EmailBadge tone="indigo-wash">DIGEST</EmailBadge>
      <h1 style={h1Style}>{`${count} things`}</h1>
      <Lead>{`The allay picked up ${count} things. Here they are:`}</Lead>
      <table
        role="presentation"
        width="100%"
        cellPadding={0}
        cellSpacing={0}
        border={0}
        style={{ marginTop: 16 }}
      >
        <tbody>
          {items.map((item, index) => {
            const excerpt = stripLinks(item.excerpt);
            return (
              <tr key={`${item.kind}-${index}`}>
                <td
                  style={{
                    padding: '12px 0',
                    borderTop: `2px solid ${COLOR.lineSoft}`,
                    fontFamily: FONT_BODY,
                    fontSize: 16,
                    lineHeight: '1.6',
                    color: COLOR.mute,
                  }}
                >
                  <p style={{ margin: 0 }}>
                    <strong style={strongStyle}>{kindLabel(item.kind)}</strong>
                    {` — ${item.title}`}
                    {excerpt ? (
                      <>
                        <br />
                        <span style={{ fontSize: 13 }}>{`"${excerpt}"`}</span>
                      </>
                    ) : null}
                  </p>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {more > 0 ? <Meta>{`…and ${more} more in admin.`}</Meta> : null}
      <Actions button={<EmailButton href={url}>Open admin</EmailButton>} />
    </EmailLayout>
  );
}
