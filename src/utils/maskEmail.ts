/**
 * Masks an email address for GDPR-safe logging.
 * "john.doe@example.com" → "j******e@example.com"
 */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  const maskedLocal =
    local.length <= 2
      ? "*".repeat(local.length)
      : `${local[0]}${"*".repeat(local.length - 2)}${local[local.length - 1]}`;
  return `${maskedLocal}@${domain}`;
}
