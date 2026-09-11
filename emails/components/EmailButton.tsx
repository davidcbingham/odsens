/**
 * emails/components/EmailButton.tsx — `EmailButton` (03 §2.11; DESIGN.md §12.1 "One bulletproof
 * button per mail — indigo, or gold only for held-comment APPROVE"; E-05). Table-based: a `<td>`
 * carrying the fill as `bgcolor` + `background-color` + a 2px border in the same colour, around a
 * padded `<a>` in the display stack. Radius 0, no shadow, no image (E-03). The anchor carries
 * `data-email-button="<tone>"` so 05 T-UNIT-3 can count exactly one per template.
 * Tones: indigo `--indigo` / `--white` (default) · gold `--gold` / `--gold-ink` (`CommentHeld` only).
 */
import { COLOR, FONT_DISPLAY, bgAttr } from './shared';

export type EmailButtonProps = {
  href: string;
  children: string;
  tone?: 'indigo' | 'gold';
};

export function EmailButton({ href, children, tone = 'indigo' }: EmailButtonProps) {
  const fill = tone === 'gold' ? COLOR.gold : COLOR.indigo;
  const text = tone === 'gold' ? COLOR.goldInk : COLOR.white;
  return (
    <table role="presentation" cellPadding={0} cellSpacing={0} border={0}>
      <tbody>
        <tr>
          <td {...bgAttr(fill)} style={{ backgroundColor: fill, border: `2px solid ${fill}` }}>
            <a
              href={href}
              data-email-button={tone}
              style={{
                display: 'inline-block',
                padding: '12px 22px',
                fontFamily: FONT_DISPLAY,
                fontSize: 14,
                lineHeight: '1',
                color: text,
                textDecoration: 'none',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              {children}
            </a>
          </td>
        </tr>
      </tbody>
    </table>
  );
}
