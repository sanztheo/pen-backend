import { logger } from "../utils/logger.js";
import {
  EMAIL_FROM_DEFAULT,
  WEBSITE_BASE_URL,
  isValidEmail,
  type WaitlistConfirmationInput,
  type SpotAvailableInput,
  type BetaAccessGrantedInput,
  type BetaAccessRevokedInput,
} from "./EmailService.types.js";

// ─── Retry configuration ────────────────────────────────────
const RETRY_DELAY_MS = 1_000;
const RETRYABLE_STATUS_CODES = new Set([429, 503]);

// ─── Lazy-initialized Resend client (Promise singleton) ─────
let initPromise: Promise<import("resend").Resend | null> | null = null;

async function doInit(): Promise<import("resend").Resend | null> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    logger.warn("[EmailService] RESEND_API_KEY not set — emails disabled");
    return null;
  }

  const { Resend } = await import("resend");
  return new Resend(apiKey);
}

function getResendClient(): Promise<import("resend").Resend | null> {
  if (!initPromise) initPromise = doInit();
  return initPromise;
}

// ─── Utilities ──────────────────────────────────────────────

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  const maskedLocal =
    local.length <= 2
      ? "*".repeat(local.length)
      : `${local[0]}${"*".repeat(local.length - 2)}${local[local.length - 1]}`;
  return `${maskedLocal}@${domain}`;
}

function sanitizeResendError(error: unknown): { message: string; name: string } {
  if (error !== null && typeof error === "object") {
    const obj = error as Record<string, unknown>;
    const message = "message" in obj && typeof obj.message === "string" ? obj.message : "unknown";
    const name = "name" in obj && typeof obj.name === "string" ? obj.name : "unknown";
    return { message, name };
  }
  return { message: String(error), name: "unknown" };
}

function isRetryableError(error: unknown): boolean {
  if (error !== null && typeof error === "object") {
    const obj = error as Record<string, unknown>;
    if ("statusCode" in obj && typeof obj.statusCode === "number") {
      return RETRYABLE_STATUS_CODES.has(obj.statusCode);
    }
  }
  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Core send helper (shared logic + retry) ────────────────

interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  label: string;
}

async function sendEmail(params: SendEmailParams): Promise<void> {
  if (!isValidEmail(params.to)) {
    logger.warn(`[EmailService] Invalid recipient email for ${params.label}, skipping`);
    return;
  }

  const client = await getResendClient();
  if (!client) return;

  const from = process.env.RESEND_FROM_EMAIL || EMAIL_FROM_DEFAULT;
  const masked = maskEmail(params.to);

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { error } = await client.emails.send({
        from,
        to: params.to,
        subject: params.subject,
        html: params.html,
      });

      if (error) {
        if (attempt === 1 && isRetryableError(error)) {
          logger.warn(
            `[EmailService] Retryable error on ${params.label}, retrying in ${RETRY_DELAY_MS}ms`,
          );
          await delay(RETRY_DELAY_MS);
          continue;
        }
        logger.error(
          `[EmailService] Resend API error (${params.label}):`,
          sanitizeResendError(error),
        );
        return;
      }

      logger.log(`[EmailService] ${params.label} sent to ${masked}`);
      return;
    } catch (err: unknown) {
      if (attempt === 1 && isRetryableError(err)) {
        logger.warn(
          `[EmailService] Retryable exception on ${params.label}, retrying in ${RETRY_DELAY_MS}ms`,
        );
        await delay(RETRY_DELAY_MS);
        continue;
      }
      logger.error(`[EmailService] Failed to send ${params.label}:`, err);
      return;
    }
  }
}

// ─── Public API ──────────────────────────────────────────────

export class EmailService {
  static async sendWaitlistConfirmation(input: WaitlistConfirmationInput): Promise<void> {
    return sendEmail({
      to: input.to,
      subject: "Pennote — Inscription waitlist confirmée",
      html: buildWaitlistConfirmationHtml(input.name, input.position),
      label: "waitlist confirmation",
    });
  }

  static async sendSpotAvailable(input: SpotAvailableInput): Promise<void> {
    return sendEmail({
      to: input.to,
      subject: "Pennote — Une place s'est libérée !",
      html: buildSpotAvailableHtml(input.name),
      label: "spot available",
    });
  }

  static async sendBetaAccessGranted(input: BetaAccessGrantedInput): Promise<void> {
    return sendEmail({
      to: input.to,
      subject: "Pennote — Bienvenue dans la beta !",
      html: buildBetaAccessGrantedHtml(input.name),
      label: "beta access granted",
    });
  }

  static async sendBetaAccessRevoked(input: BetaAccessRevokedInput): Promise<void> {
    return sendEmail({
      to: input.to,
      subject: "Pennote — Votre accès beta a été désactivé",
      html: buildBetaAccessRevokedHtml(input.name, input.reactivationDeadlineDays),
      label: "beta access revoked",
    });
  }
}

// ─── Test Seams ─────────────────────────────────────────────
/** @internal — for unit tests only */
export function _resetForTest(): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("_resetForTest is only available in test environment");
  }
  initPromise = null;
}

/** @internal — for unit tests only */
export function _escapeHtmlForTest(str: string): string {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("_escapeHtmlForTest is only available in test environment");
  }
  return escapeHtml(str);
}

// ─── Email Templates (private) ──────────────────────────────
// Templates are below the public API for readability.
// They are long HTML strings — line count is inherently high.

function buildWaitlistConfirmationHtml(name: string, position: number): string {
  const safeName = escapeHtml(name);
  const safePosition = escapeHtml(String(position));
  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:40px 20px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
      <tr><td style="background-color:#18181b;padding:32px 40px;text-align:center;">
        <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">Pennote</h1>
      </td></tr>
      <tr><td style="padding:40px;">
        <h2 style="margin:0 0 16px;color:#18181b;font-size:20px;">Bienvenue sur la waitlist, ${safeName} !</h2>
        <p style="margin:0 0 16px;color:#3f3f46;font-size:16px;line-height:1.6;">
          Votre inscription a bien été enregistrée. Vous êtes en <strong style="color:#18181b;">position #${safePosition}</strong> sur la liste d'attente.
        </p>
        <p style="margin:0 0 16px;color:#3f3f46;font-size:16px;line-height:1.6;">
          Nous vous enverrons un email dès qu'une place se libère. En attendant, restez connecté !
        </p>
        <div style="margin:24px 0;padding:16px;background-color:#f4f4f5;border-radius:8px;text-align:center;">
          <p style="margin:0;color:#71717a;font-size:14px;">Votre position actuelle</p>
          <p style="margin:8px 0 0;color:#18181b;font-size:32px;font-weight:700;">#${safePosition}</p>
        </div>
        <p style="margin:0;color:#a1a1aa;font-size:14px;line-height:1.5;">
          Vous recevez cet email car vous vous êtes inscrit sur la waitlist Pennote.
        </p>
      </td></tr>
      <tr><td style="padding:24px 40px;background-color:#fafafa;text-align:center;">
        <p style="margin:0;color:#a1a1aa;font-size:12px;">&copy; ${new Date().getFullYear()} Pennote. Tous droits réservés.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function buildSpotAvailableHtml(name: string): string {
  const safeName = escapeHtml(name);
  const ctaUrl = `${WEBSITE_BASE_URL}/fr/join`;
  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:40px 20px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
      <tr><td style="background-color:#18181b;padding:32px 40px;text-align:center;">
        <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">Pennote</h1>
      </td></tr>
      <tr><td style="padding:40px;">
        <h2 style="margin:0 0 16px;color:#18181b;font-size:20px;">Bonne nouvelle, ${safeName} !</h2>
        <p style="margin:0 0 16px;color:#3f3f46;font-size:16px;line-height:1.6;">
          Une place s'est libérée et votre compte a été activé. Vous pouvez dès maintenant accéder à Pennote !
        </p>
        <div style="margin:24px 0;text-align:center;">
          <a href="${ctaUrl}" style="display:inline-block;padding:14px 32px;background-color:#18181b;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;border-radius:8px;">
            Réactiver mon compte
          </a>
        </div>
        <div style="margin:24px 0;padding:16px;background-color:#fef2f2;border:1px solid #fecaca;border-radius:8px;">
          <p style="margin:0;color:#991b1b;font-size:14px;line-height:1.5;">
            <strong>&#9200; Important :</strong> Vous avez <strong>14 jours</strong> pour vous reconnecter. Passé ce délai, votre place sera libérée pour un autre utilisateur.
          </p>
        </div>
        <p style="margin:0;color:#a1a1aa;font-size:14px;line-height:1.5;">
          Vous recevez cet email car vous étiez inscrit sur la waitlist Pennote.
        </p>
      </td></tr>
      <tr><td style="padding:24px 40px;background-color:#fafafa;text-align:center;">
        <p style="margin:0;color:#a1a1aa;font-size:12px;">&copy; ${new Date().getFullYear()} Pennote. Tous droits réservés.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function buildBetaAccessGrantedHtml(name: string): string {
  const safeName = escapeHtml(name);
  const ctaUrl = `${WEBSITE_BASE_URL}/fr/dashboard`;
  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:40px 20px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
      <tr><td style="background-color:#18181b;padding:32px 40px;text-align:center;">
        <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">Pennote</h1>
      </td></tr>
      <tr><td style="padding:40px;">
        <h2 style="margin:0 0 16px;color:#18181b;font-size:20px;">Bienvenue dans la beta, ${safeName} !</h2>
        <p style="margin:0 0 16px;color:#3f3f46;font-size:16px;line-height:1.6;">
          Votre compte beta est maintenant actif. Vous pouvez accéder à toutes les fonctionnalités de Pennote dès maintenant.
        </p>
        <div style="margin:24px 0;padding:16px;background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;text-align:center;">
          <p style="margin:0;color:#166534;font-size:16px;font-weight:600;">Votre compte beta est maintenant actif !</p>
        </div>
        <div style="margin:24px 0;text-align:center;">
          <a href="${ctaUrl}" style="display:inline-block;padding:14px 32px;background-color:#18181b;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;border-radius:8px;">
            Accéder à Pennote
          </a>
        </div>
        <p style="margin:0;color:#a1a1aa;font-size:14px;line-height:1.5;">
          Vous recevez cet email car un administrateur a activé votre accès beta Pennote.
        </p>
      </td></tr>
      <tr><td style="padding:24px 40px;background-color:#fafafa;text-align:center;">
        <p style="margin:0;color:#a1a1aa;font-size:12px;">&copy; ${new Date().getFullYear()} Pennote. Tous droits réservés.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function buildBetaAccessRevokedHtml(name: string, deadlineDays: number): string {
  const safeName = escapeHtml(name);
  const safeDeadline = escapeHtml(String(deadlineDays));
  const ctaUrl = `${WEBSITE_BASE_URL}/fr/join`;
  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:40px 20px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
      <tr><td style="background-color:#18181b;padding:32px 40px;text-align:center;">
        <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">Pennote</h1>
      </td></tr>
      <tr><td style="padding:40px;">
        <h2 style="margin:0 0 16px;color:#18181b;font-size:20px;">${safeName}, votre accès beta a été désactivé</h2>
        <p style="margin:0 0 16px;color:#3f3f46;font-size:16px;line-height:1.6;">
          Un administrateur a désactivé votre accès beta Pennote. Vous pouvez réactiver votre compte en vous reconnectant.
        </p>
        <div style="margin:24px 0;padding:16px;background-color:#fef2f2;border:1px solid #fecaca;border-radius:8px;">
          <p style="margin:0;color:#991b1b;font-size:14px;line-height:1.5;">
            <strong>&#9200; Important :</strong> Vous avez <strong>${safeDeadline} jours</strong> pour vous reconnecter. Passé ce délai, votre place sera libérée pour un autre utilisateur.
          </p>
        </div>
        <div style="margin:24px 0;text-align:center;">
          <a href="${ctaUrl}" style="display:inline-block;padding:14px 32px;background-color:#18181b;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;border-radius:8px;">
            Réactiver mon compte
          </a>
        </div>
        <p style="margin:0;color:#a1a1aa;font-size:14px;line-height:1.5;">
          Vous recevez cet email car votre accès beta Pennote a été modifié.
        </p>
      </td></tr>
      <tr><td style="padding:24px 40px;background-color:#fafafa;text-align:center;">
        <p style="margin:0;color:#a1a1aa;font-size:12px;">&copy; ${new Date().getFullYear()} Pennote. Tous droits réservés.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}
