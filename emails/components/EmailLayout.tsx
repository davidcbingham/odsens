/**
 * emails/components/EmailLayout.tsx — `EmailLayout` (03 §2.11; §6 E-02..E-07; DESIGN.md §12.1
 * "Email template"): `<Html lang="en">`, a `<Head>` with the dark colour-scheme metas (E-04 Gmail
 * dark-mode guard), `<Preview>` text, and a table layout — ink body → ink wrapper → 600px slab card
 * with 2px `--line-soft` borders, each with an explicit `bgcolor` + `background-color`. Header = the
 * `ODSENS` wordmark PNG (E-07 / ADR-0030 D15: the 2× file, absolute
 * `${siteUrl}/brand/email/wordmark@2x.png` at 84×20 attributes for retina, `alt="odsens"`); the
 * allay 28px render is omitted until the asset lands (Q44 — the layout must not break without it).
 * Footer (13px `--mute`): "The allay emails you because <switch> is on." + "Manage in Settings."
 * (absolute link to `/admin/settings`) + one dry sign-off. No web fonts, shadows, radius, hatch,
 * motion, JavaScript or remote CSS (E-03). Rendered only by `lib/notify/deliver/email.ts` (E-01).
 */
import type { CSSProperties, ReactNode } from 'react';
import { Body, Head, Html, Img, Link, Preview } from '@react-email/components';
import { COLOR, EMAIL_WIDTH, FONT_BODY, WORDMARK, bgAttr } from './shared';

export type EmailLayoutProps = {
  /** Inbox preview text (E-05). */
  preview: string;
  children: ReactNode;
  footer: {
    /** "The allay emails you because <switch> is on." */
    why: string;
    /** Absolute URL to `/admin/settings` (04 N5). */
    manageUrl: string;
    /** One dry sign-off line (DESIGN.md §12.1). */
    signoff: string;
  };
  /** Absolute site origin for images (E-07 — `NEXT_PUBLIC_SITE_URL`). */
  siteUrl: string;
};

const bodyStyle: CSSProperties = {
  margin: 0,
  padding: 0,
  backgroundColor: COLOR.ink,
  fontFamily: FONT_BODY,
  color: COLOR.chalk,
};

const cardStyle: CSSProperties = {
  width: '100%',
  maxWidth: EMAIL_WIDTH,
  backgroundColor: COLOR.slab,
  border: `2px solid ${COLOR.lineSoft}`,
};

const headerCell: CSSProperties = {
  padding: '24px 28px',
  borderBottom: `2px solid ${COLOR.lineSoft}`,
};

const bodyCell: CSSProperties = {
  padding: 28,
  fontFamily: FONT_BODY,
  fontSize: 16,
  lineHeight: '1.6',
  color: COLOR.chalk,
};

const footerCell: CSSProperties = {
  padding: '20px 28px',
  borderTop: `2px solid ${COLOR.lineSoft}`,
  fontFamily: FONT_BODY,
  fontSize: 13,
  lineHeight: '1.6',
  color: COLOR.mute,
};

const footerLink: CSSProperties = {
  fontFamily: FONT_BODY,
  fontSize: 13,
  color: COLOR.indigoLift,
  textDecorationLine: 'underline',
};

export function EmailLayout({ preview, children, footer, siteUrl }: EmailLayoutProps) {
  return (
    <Html lang="en" dir="ltr">
      <Head>
        <meta name="color-scheme" content="dark" />
        <meta name="supported-color-schemes" content="dark" />
      </Head>
      <Preview>{preview}</Preview>
      <Body {...bgAttr(COLOR.ink)} style={bodyStyle}>
        <table
          role="presentation"
          width="100%"
          cellPadding={0}
          cellSpacing={0}
          border={0}
          bgcolor={COLOR.ink}
          style={{ backgroundColor: COLOR.ink }}
        >
          <tbody>
            <tr>
              <td align="center" style={{ padding: '32px 16px' }}>
                <table
                  role="presentation"
                  width={EMAIL_WIDTH}
                  cellPadding={0}
                  cellSpacing={0}
                  border={0}
                  bgcolor={COLOR.slab}
                  style={cardStyle}
                >
                  <tbody>
                    <tr>
                      <td style={headerCell}>
                        <Img
                          src={`${siteUrl}${WORDMARK.path}`}
                          alt="odsens"
                          width={WORDMARK.width}
                          height={WORDMARK.height}
                        />
                      </td>
                    </tr>
                    <tr>
                      <td style={bodyCell}>{children}</td>
                    </tr>
                    <tr>
                      <td style={footerCell}>
                        {footer.why}{' '}
                        <Link href={footer.manageUrl} style={footerLink}>
                          Manage in Settings.
                        </Link>
                        <br />
                        {footer.signoff}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </Body>
    </Html>
  );
}
