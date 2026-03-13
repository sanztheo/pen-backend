export const EMAIL_FROM_DEFAULT = "Pennote <onboarding@resend.dev>";
// CTA link in emails — env var allows staging/dev override, defaults to production
export const WEBSITE_BASE_URL =
  process.env.WEBSITE_BASE_URL || process.env.CLIENT_URL || "https://pennote.fr";

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
