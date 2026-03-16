// Email CTA URLs — hardcoded to production. Never use CLIENT_URL (CORS list, not a single URL).
export const APP_BASE_URL = "https://app.pennote.fr" as const;
export const WEBSITE_BASE_URL = "https://www.pennote.fr" as const;

export const EMAIL_FROM_DEFAULT = "Pennote <noreply@pennote.fr>";

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
