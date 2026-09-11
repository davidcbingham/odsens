/**
 * emails/components/shared.tsx — the email-safe subset shared by every template (03 §6 E-02/E-03/E-04;
 * DESIGN.md §12.1 "Email template"; docs/notifications.md "Email styling").
 *
 * Mail clients cannot read `var(--…)`, so the DESIGN.md hex values are mirrored here as literals —
 * the ONE place under `emails/**` that spells a colour. Every value below is a `styles/tokens.css`
 * value, checked by 05 T-UNIT-43 (`tests/unit/tokens-emails.test.ts`). Fonts are the E-03 fallback
 * stacks (no web fonts in mail): display = Impact / Arial Black, body = Arial. Radius 0, 2px solid
 * borders, no shadows, no hatch, no motion (E-03 forbidden list).
 *
 * The small layout helpers (`Lead`, `Excerpt`, `Actions`, `Meta`) are template-internal building
 * blocks, not registry components (03 §2.11 lists `EmailLayout`, `EmailButton`, `EmailBadge`);
 * `stripLinks` is the E-05 "links stripped" rule every excerpt passes through.
 */
import type { CSSProperties, ReactNode } from 'react';

/** DESIGN.md §1 Dark + 03 §9 derived — `styles/tokens.css` values, lowercase as the tokens file writes them. */
export const COLOR = {
  ink: '#0d131b', // --ink — body ground
  slab: '#151e29', // --slab — the 600px card
  slabRaised: '#1e2938', // --slab-raised — comment bubbles → the excerpt box
  lineSoft: '#2c3a4b', // --line-soft — card + divider borders
  chalk: '#eef1f6', // --chalk — body text
  mute: '#9da9ba', // --mute — lead + footer text
  white: '#ffffff', // --white — h1, indigo button text, alert badge text
  indigo: '#4b45d6', // --indigo — primary button
  indigoLift: '#8b86f5', // --indigo-lift — links
  indigoWash: '#2a2680', // --indigo-wash — badge fill
  modBadgeText: '#cfccff', // --mod-badge-text — text on indigo-wash
  gold: '#ffc61f', // --gold — the CommentHeld APPROVE button
  goldBright: '#ffda6b', // --gold-bright — text on gold-wash
  goldDeep: '#c08400', // --gold-deep — held/reported excerpt border
  goldWash: '#4a3505', // --gold-wash — badge fill
  goldInk: '#2e2000', // --gold-ink — text on gold
  alert: '#cc3a2a', // --alert — FAILED / STALE badge fill
  dangerLine: '#4a2a2a', // --danger-line — sync cause border
  dangerWash: '#1a1416', // --danger-wash — sync cause fill
} as const;

/** E-03 font stacks — `--font-display` / `--font-body` fall back to these in mail (DESIGN.md §12.1). */
export const FONT_DISPLAY = 'Impact, "Arial Black", Arial, sans-serif';
export const FONT_BODY = 'Arial, Helvetica, sans-serif';

/** E-04: the card is 600px max. */
export const EMAIL_WIDTH = 600;

/**
 * E-07 / ADR-0030 D15: the 2× wordmark PNG (168×40, rendered by `scripts/render-wordmark.mjs` under
 * `public/brand/email/`) referenced at 84×20 `width`/`height` attributes so retina clients get a
 * crisp mark; the 1× file ships beside it for `pnpm email dev` and the docs.
 */
export const WORDMARK = { path: '/brand/email/wordmark@2x.png', width: 84, height: 20 } as const;

/**
 * The legacy `bgcolor` attribute (E-04 — Outlook and Gmail dark mode read it; React's DOM types do
 * not declare it on `<td>`/`<body>`, so it is spread in). Always paired with `background-color`.
 */
export function bgAttr(hex: string): { bgcolor: string } {
  return { bgcolor: hex };
}

/** Absolute-URL prefix for images (E-07): the origin of `manageUrl` unless the template is told otherwise. */
export function siteUrlFrom(manageUrl: string, siteUrl?: string): string {
  if (siteUrl) return siteUrl.replace(/\/+$/, '');
  try {
    return new URL(manageUrl).origin;
  } catch {
    return '';
  }
}

/** ADR-0030 D4: a scrubbed `{profile_id: null, handle: null}` reference renders as "a deleted account". */
export function handleLabel(handle: string | null | undefined): string {
  return handle && handle.length > 0 ? handle : 'a deleted account';
}

/** Sync source display names (04 §3 `sync_runs.source`). */
const SOURCE_LABELS: Record<string, string> = {
  modrinth: 'Modrinth',
  curseforge: 'CurseForge',
  youtube: 'YouTube',
  mentions: 'Mentions',
  notify: 'Notify',
};
export function sourceLabel(source: string): string {
  const known = SOURCE_LABELS[source];
  if (known) return known;
  return source.length > 0 ? source.charAt(0).toUpperCase() + source.slice(1) : source;
}

/**
 * 03 E-05 "one excerpt (… links stripped)": every link is removed before an excerpt reaches a mail
 * body, so a spam comment's URL never lands in an admin inbox where the client would auto-link it.
 * The pattern is the 04 §1.2 B3 link pattern verbatim (`lib/validation/comment.ts` `LINK_RE` —
 * mirrored here so `emails/**` stays self-contained for `pnpm email dev`); runs of spaces left
 * behind collapse to one and the ends are trimmed. Excerpts arrive pre-clipped (04 §1.2 excerpt(140)).
 */
const LINK_RE = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
export function stripLinks(text: string): string {
  return text
    .replace(LINK_RE, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

// ---- shared inline styles (E-02) ----

export const h1Style: CSSProperties = {
  margin: '12px 0 0',
  fontFamily: FONT_DISPLAY,
  fontSize: 22,
  lineHeight: '1.15',
  fontWeight: 'normal',
  color: COLOR.white,
  textTransform: 'uppercase',
  letterSpacing: '0.02em',
};

const leadStyle: CSSProperties = {
  margin: '16px 0 0',
  fontFamily: FONT_BODY,
  fontSize: 16,
  lineHeight: '1.6',
  color: COLOR.mute,
};

export const strongStyle: CSSProperties = { color: COLOR.chalk, fontWeight: 'bold' };

const metaStyle: CSSProperties = {
  margin: '12px 0 0',
  fontFamily: FONT_BODY,
  fontSize: 13,
  lineHeight: '1.6',
  color: COLOR.mute,
};

export const textLinkStyle: CSSProperties = {
  fontFamily: FONT_BODY,
  fontSize: 16,
  color: COLOR.indigoLift,
  textDecorationLine: 'underline',
};

/** The allay's lead line — mute body text with chalk-bold names. */
export function Lead({ children }: { children: ReactNode }) {
  return <p style={leadStyle}>{children}</p>;
}

/** A 13px secondary line (report meta, run times). */
export function Meta({ children }: { children: ReactNode }) {
  return <p style={metaStyle}>{children}</p>;
}

/**
 * The one excerpt per mail (E-05): a slab-raised box with a 2px border — `--line-soft` for a new
 * comment, `--gold-deep` for held/reported (the Discord colour rule, E-08), `--danger-line` on a
 * `--danger-wash` fill for a sync cause. Text is React-escaped; never raw HTML (INV-65).
 */
export function Excerpt({
  children,
  tone = 'plain',
  by,
}: {
  children: ReactNode;
  tone?: 'plain' | 'gold' | 'danger';
  by?: string;
}) {
  const border =
    tone === 'gold' ? COLOR.goldDeep : tone === 'danger' ? COLOR.dangerLine : COLOR.lineSoft;
  const fill = tone === 'danger' ? COLOR.dangerWash : COLOR.slabRaised;
  return (
    <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0}>
      <tbody>
        <tr>
          <td style={{ paddingTop: 16 }}>
            <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0}>
              <tbody>
                <tr>
                  <td
                    {...bgAttr(fill)}
                    style={{
                      backgroundColor: fill,
                      border: `2px solid ${border}`,
                      padding: '16px 18px',
                      fontFamily: FONT_BODY,
                      fontSize: 16,
                      lineHeight: '1.6',
                      color: COLOR.chalk,
                    }}
                  >
                    {children}
                  </td>
                </tr>
              </tbody>
            </table>
            {by ? <p style={{ ...metaStyle, margin: '8px 0 0' }}>— {by}</p> : null}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/** The action row: the one `EmailButton` (E-05) plus, optionally, a secondary text link beside it. */
export function Actions({
  button,
  link,
}: {
  button: ReactNode;
  link?: { href: string; label: string };
}) {
  return (
    <table role="presentation" cellPadding={0} cellSpacing={0} border={0}>
      <tbody>
        <tr>
          <td style={{ paddingTop: 24, verticalAlign: 'middle' }}>{button}</td>
          {link ? (
            <td style={{ paddingTop: 24, paddingLeft: 16, verticalAlign: 'middle' }}>
              <a href={link.href} style={textLinkStyle}>
                {link.label}
              </a>
            </td>
          ) : null}
        </tr>
      </tbody>
    </table>
  );
}
