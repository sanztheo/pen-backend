/**
 * Kill switch for beta management system.
 * When false: all beta endpoints return 503, cron jobs are skipped.
 * Set to `true` when the beta system is fully ready.
 * Remove this file entirely once beta is permanently live.
 */
export const BETA_LIVE = false as const;
