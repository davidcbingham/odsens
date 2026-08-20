/**
 * lib/analytics.ts — `trackEvent(name, props)` (04 §5.6; 01 INV-59; ADR-0002 C12).
 *
 * Plain module (no directive) so it bundles into the client leaves that call it (`TrackedLink`,
 * `VideoFacade`, `GoogleSignInButton`). The union below IS the runtime allowlist: exactly four event
 * names, payload keys per 04 §5.6 — never handles, user ids or emails (05 T-UNIT-38).
 *
 * Delivery: Vercel Web Analytics exposes `window.va('event', { name, data })` once its script has
 * loaded; before that (or with the script blocked) the call is a no-op. No queueing, no fetch.
 */

export type TrackProps = {
  download: {
    project: string;
    source: 'modrinth' | 'curseforge' | 'direct';
    from: 'get-it' | 'hero' | 'versions' | 'skin';
  };
  tip_click: {
    amount?: 1 | 3 | 5 | 'other';
    from: 'support' | 'tip-panel' | 'floating';
  };
  video_play: {
    youtube_id: string;
    kind: 'video' | 'short' | 'mention';
  };
  sign_in: {
    from: 'nav' | 'prompt' | 'admin';
  };
};

export type TrackEventName = keyof TrackProps;

export const TRACK_EVENT_NAMES = ['download', 'tip_click', 'video_play', 'sign_in'] as const;

type VercelAnalytics = (
  kind: 'event',
  payload: { name: string; data: Record<string, string | number> },
) => void;

type WindowWithVa = Window & { va?: VercelAnalytics };

/** Fire one allow-listed analytics event from a client leaf. Safe to call during SSR (no-op). */
export function trackEvent<N extends TrackEventName>(name: N, props: TrackProps[N]): void {
  if (typeof window === 'undefined') return;
  const va = (window as WindowWithVa).va;
  if (typeof va !== 'function') return;
  const data: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(props)) {
    if (typeof value === 'string' || typeof value === 'number') data[key] = value;
  }
  va('event', { name, data });
}
