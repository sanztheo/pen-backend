// CTA link in emails — env var allows staging/dev override, defaults to production.
// Hardcoded fallback is intentional: transactional emails MUST always contain a valid URL,
// even if env vars are misconfigured. Production is the safe default.
export const WEBSITE_BASE_URL: string =
  process.env.WEBSITE_BASE_URL || process.env.CLIENT_URL || "https://pennote.fr";

export const EMAIL_FROM_DEFAULT = "Pennote <onboarding@resend.dev>";

/** RFC 5321 max email length */
export const MAX_EMAIL_LENGTH = 254;

/** Basic email format + length guard (defense-in-depth, not a full RFC validator) */
const EMAIL_FORMAT_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return email.length <= MAX_EMAIL_LENGTH && EMAIL_FORMAT_RE.test(email);
}

export interface WaitlistConfirmationInput {
  to: string;
  name: string;
  position: number;
}

export interface SpotAvailableInput {
  to: string;
  name: string;
}

export interface BetaAccessGrantedInput {
  to: string;
  name: string;
}

export interface BetaAccessRevokedInput {
  to: string;
  name: string;
  reactivationDeadlineDays: number;
}

export interface BetaWelcomeInput {
  to: string;
  name: string;
  email: string;
  temporaryPassword: string;
}

export interface WaitlistPositionUpdateInput {
  to: string;
  name: string;
  newPosition: number;
}

export interface FeedbackErrorLog {
  timestamp: string;
  type: "ERROR" | "FETCH_ERROR" | "UNHANDLED" | "PROMISE_REJECTION";
  message: string;
  url?: string;
  stack?: string;
}

export interface FeedbackReportInput {
  userId: string;
  userEmail: string;
  type: "bug" | "suggestion" | "other";
  message: string;
  currentUrl?: string;
  userAgent?: string;
  errorLogs?: FeedbackErrorLog[];
}
