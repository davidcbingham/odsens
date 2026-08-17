/**
 * lib/flags.ts — compile-time feature flags for Phase 2 surfaces in a v1 build (01 INV-74).
 * Flags flip only in the slice that ships the feature, together with the doc edit.
 */
export const FLAGS = {
  commissions: false, // S2.2 — nav "Commissions" item + footer "Custom orders" link
  workrooms: false, // S2.3
  leaderboard: false, // S2.1 — Leaderboard renders its empty state while false
  kofiWebhook: false, // S2.1
  suggestedMentions: false, // S2.4
  inAppNotifications: false, // S2.5
} as const;

export type Flags = typeof FLAGS;
