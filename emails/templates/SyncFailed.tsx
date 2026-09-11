/**
 * emails/templates/SyncFailed.tsx — `SyncFailed` (03 §2.11; §6 E-05..E-08; DESIGN.md §12.1 "The
 * allay": sync failure → "The allay came back empty-handed. It'll keep trying."; prototype pass-3
 * "Email sync failed"). Serves both `sync.failed` and `sync.stale` (`stale` prop); subjects
 * "Sync failed: <source>" / "Sync stale: <source>" are the deliverer's (04 N5). Badge FAILED / STALE
 * (alert) · h1 "<Source> sync" · the allay lead · for stale "<Source> counts haven't updated in <n>
 * hours." (or "…since <runAt>." when the hours are unknown, or "No good run yet." when there is no
 * good run to count from — ADR-0030 D19 / 04 N5 as built) · "Cause: <error>" in a danger box when
 * present · "The site keeps showing the last good numbers. Nothing is on fire." · "Last run <runAt>."
 * / "Last good run <runAt>." (omitted when `runAt` is empty) · one indigo button "See sync status"
 * → `adminUrl`. Footer switch word: "sync mail". `runAt` is shown as given — pass it already
 * formatted (01 INV-93: dates are formatted in `lib/format/*`, never here); an empty string means
 * "no such run".
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
  siteUrlFrom,
  sourceLabel,
  strongStyle,
} from '../components/shared';

export type SyncFailedProps = {
  /** `sync_runs.source` — `modrinth` · `curseforge` · `youtube` · `mentions`. */
  source: string;
  /** The run's error (≤ 300 chars per J-F); empty or null when unknown (stale). */
  error: string | null;
  /** The run time (failed) or the last good run (stale), already formatted; `''` = no such run. */
  runAt: string;
  stale: boolean;
  /** `/admin` (the sync status tiles). */
  adminUrl: string;
  manageUrl: string;
  /** Payload `hours_since_ok` for a stale event (ADR-0030 D3). */
  hoursSinceOk?: number;
  /** Absolute site origin for images (E-07); defaults to the origin of `manageUrl`. */
  siteUrl?: string;
};

const LEAD = "The allay came back empty-handed. It'll keep trying.";
const CALM = 'The site keeps showing the last good numbers. Nothing is on fire.';
const SIGNOFF = "— the allay. It'll keep trying. This usually fixes itself.";
/** ADR-0030 D19: the one word for a source that has never had an ok run. */
const NO_GOOD_RUN = 'No good run yet.';

export function SyncFailed({
  source,
  error,
  runAt,
  stale,
  adminUrl,
  manageUrl,
  hoursSinceOk,
  siteUrl,
}: SyncFailedProps) {
  const name = sourceLabel(source);
  const cause = error?.trim() ?? '';
  const when = runAt.trim();
  const staleLine =
    typeof hoursSinceOk === 'number'
      ? `${name} counts haven't updated in ${Math.max(0, Math.round(hoursSinceOk))} hours.`
      : when
        ? `${name} counts haven't updated since ${when}.`
        : NO_GOOD_RUN;
  const runLine = when === '' ? null : stale ? `Last good run ${when}.` : `Last run ${when}.`;
  return (
    <EmailLayout
      preview={LEAD}
      footer={{ why: 'The allay emails you because sync mail is on.', manageUrl, signoff: SIGNOFF }}
      siteUrl={siteUrlFrom(manageUrl, siteUrl)}
    >
      <EmailBadge tone="alert">{stale ? 'STALE' : 'FAILED'}</EmailBadge>
      <h1 style={h1Style}>{`${name} sync`}</h1>
      <Lead>{LEAD}</Lead>
      {stale ? <Lead>{staleLine}</Lead> : null}
      {cause ? (
        <Excerpt tone="danger">
          <strong style={strongStyle}>Cause:</strong> {cause}
        </Excerpt>
      ) : null}
      <Lead>{CALM}</Lead>
      {runLine ? <Meta>{runLine}</Meta> : null}
      <Actions button={<EmailButton href={adminUrl}>See sync status</EmailButton>} />
    </EmailLayout>
  );
}
