import { logger } from "../utils/logger.js";
import { maskEmail } from "../utils/maskEmail.js";
import {
  EMAIL_FROM_DEFAULT,
  WEBSITE_BASE_URL,
  type WaitlistConfirmationInput,
  type SpotAvailableInput,
} from "./EmailService.types.js";

// ─── Lazy-initialized Resend client ──────────────────────────
let resendInstance: import("resend").Resend | null = null;
let initAttempted = false;

async function getResendClient(): Promise<import("resend").Resend | null> {
  if (initAttempted) return resendInstance;
  initAttempted = true;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    logger.warn("[EmailService] RESEND_API_KEY not set — emails disabled");
    return null;
  }

  const { Resend } = await import("resend");
  resendInstance = new Resend(apiKey);
  return resendInstance;
}

// ─── HTML Utilities ──────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─── Email Templates ─────────────────────────────────────────

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
        <p style="margin:0;color:#a1a1aa;font-size:12px;">© ${new Date().getFullYear()} Pennote. Tous droits réservés.</p>
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
            <strong>⏰ Important :</strong> Vous avez <strong>14 jours</strong> pour vous reconnecter. Passé ce délai, votre place sera libérée pour un autre utilisateur.
          </p>
        </div>
        <p style="margin:0;color:#a1a1aa;font-size:14px;line-height:1.5;">
          Vous recevez cet email car vous étiez inscrit sur la waitlist Pennote.
        </p>
      </td></tr>
      <tr><td style="padding:24px 40px;background-color:#fafafa;text-align:center;">
        <p style="margin:0;color:#a1a1aa;font-size:12px;">© ${new Date().getFullYear()} Pennote. Tous droits réservés.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ─── Public API ──────────────────────────────────────────────

export class EmailService {
  static async sendWaitlistConfirmation(input: WaitlistConfirmationInput): Promise<void> {
    try {
      const client = await getResendClient();
      if (!client) return;

      const from = process.env.RESEND_FROM_EMAIL || EMAIL_FROM_DEFAULT;
      const html = buildWaitlistConfirmationHtml(input.name, input.position);

      const { error } = await client.emails.send({
        from,
        to: input.to,
        subject: "Pennote — Inscription waitlist confirmée",
        html,
      });

      if (error) {
        logger.error("[EmailService] Resend API error (waitlist confirmation):", error);
        return;
      }

      logger.log(`[EmailService] Waitlist confirmation sent to ${maskEmail(input.to)}`);
    } catch (err: unknown) {
      logger.error("[EmailService] Failed to send waitlist confirmation:", err);
    }
  }

  static async sendSpotAvailable(input: SpotAvailableInput): Promise<void> {
    try {
      const client = await getResendClient();
      if (!client) return;

      const from = process.env.RESEND_FROM_EMAIL || EMAIL_FROM_DEFAULT;
      const html = buildSpotAvailableHtml(input.name);

      const { error } = await client.emails.send({
        from,
        to: input.to,
        subject: "Pennote — Une place s'est libérée !",
        html,
      });

      if (error) {
        logger.error("[EmailService] Resend API error (spot available):", error);
        return;
      }

      logger.log(`[EmailService] Spot available notification sent to ${maskEmail(input.to)}`);
    } catch (err: unknown) {
      logger.error("[EmailService] Failed to send spot available notification:", err);
    }
  }
}

// ─── Test Seam ───────────────────────────────────────────────
/** @internal — for unit tests only */
export function _resetForTest(): void {
  resendInstance = null;
  initAttempted = false;
}

export { escapeHtml as _escapeHtmlForTest };
