/**
 * emails/components/EmailBadge.tsx — `EmailBadge` (03 §2.11 "event kind tag"; E-05): Arial 11px
 * bold uppercase on a wash fill, radius 0, 2px border in the fill colour (a solid edge in every
 * client). Tones: indigo-wash `--indigo-wash` / `--mod-badge-text` · gold-wash `--gold-wash` /
 * `--gold-bright` · alert `--alert` / `--white`. Text only.
 */
import { COLOR, FONT_BODY } from './shared';

export type EmailBadgeProps = {
  children: string;
  tone: 'indigo-wash' | 'gold-wash' | 'alert';
};

const TONES: Record<EmailBadgeProps['tone'], { fill: string; text: string }> = {
  'indigo-wash': { fill: COLOR.indigoWash, text: COLOR.modBadgeText },
  'gold-wash': { fill: COLOR.goldWash, text: COLOR.goldBright },
  alert: { fill: COLOR.alert, text: COLOR.white },
};

export function EmailBadge({ children, tone }: EmailBadgeProps) {
  const { fill, text } = TONES[tone];
  return (
    <span
      data-email-badge={tone}
      style={{
        display: 'inline-block',
        backgroundColor: fill,
        color: text,
        border: `2px solid ${fill}`,
        padding: '3px 8px',
        fontFamily: FONT_BODY,
        fontSize: 11,
        lineHeight: '1.2',
        fontWeight: 'bold',
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
      }}
    >
      {children}
    </span>
  );
}
