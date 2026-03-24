import { logger } from "../utils/logger.js";
import {
  EMAIL_FROM_DEFAULT,
  APP_BASE_URL,
  WEBSITE_BASE_URL,
  isValidEmail,
  type WaitlistConfirmationInput,
  type SpotAvailableInput,
  type BetaAccessGrantedInput,
  type BetaAccessRevokedInput,
  type BetaWelcomeInput,
  type WaitlistPositionUpdateInput,
  type FeedbackReportInput,
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

  static async sendBetaWelcome(input: BetaWelcomeInput): Promise<void> {
    return sendEmail({
      to: input.to,
      subject: "Pennote — Votre compte beta est prêt",
      html: buildBetaWelcomeHtml(input.name, input.email, input.temporaryPassword),
      label: "beta welcome",
    });
  }

  static async sendWaitlistPositionUpdate(input: WaitlistPositionUpdateInput): Promise<void> {
    return sendEmail({
      to: input.to,
      subject: `Pennote — Vous êtes maintenant #${input.newPosition} sur la waitlist`,
      html: buildWaitlistPositionUpdateHtml(input.name, input.newPosition),
      label: "waitlist position update",
    });
  }

  static async sendFeedbackReport(input: FeedbackReportInput): Promise<void> {
    const adminEmail =
      process.env.FEEDBACK_EMAIL || process.env.RESEND_FROM_EMAIL || EMAIL_FROM_DEFAULT;
    return sendEmail({
      to: adminEmail,
      subject: `[Pennote Beta] ${input.type} — "${truncateSubject(input.message)}"`,
      html: buildFeedbackReportHtml(input),
      label: "feedback report",
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
// Pennote Design System 2026:
//   Brand: #0075DE  Foreground: #191817  Secondary: #676663  Muted: #74736F
//   Surface: #F8F8F7  Border: #F0F0F0  Card: #FFFFFF
//   Success: #059669  Warning: #D97706  Danger: #DC2626
//   Font: Geist (sans), Instrument Serif (headings)
//   CTA: pill-shaped (border-radius: 9999px)

const EMAIL_FONT = "'Geist','Segoe UI',-apple-system,BlinkMacSystemFont,Roboto,sans-serif";

function emailShell(content: string): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background-color:#F8F8F7;font-family:${EMAIL_FONT};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F8F8F7;padding:40px 20px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
      <tr><td style="background-color:#0075DE;padding:32px 40px;text-align:center;">
        <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:400;font-family:'Instrument Serif',Georgia,serif;letter-spacing:0.01em;">Pennote</h1>
      </td></tr>
      <tr><td style="padding:40px;">
        ${content}
      </td></tr>
      <tr><td style="padding:24px 40px;background-color:#F8F8F7;border-top:1px solid #F0F0F0;text-align:center;">
        <p style="margin:0;color:#74736F;font-size:12px;">&copy; ${new Date().getFullYear()} Pennote. Tous droits r\u00e9serv\u00e9s.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function heading(text: string): string {
  return `<h2 style="margin:0 0 16px;color:#191817;font-size:22px;font-weight:600;font-family:'Instrument Serif',Georgia,serif;">${text}</h2>`;
}

function bodyText(text: string): string {
  return `<p style="margin:0 0 16px;color:#676663;font-size:16px;line-height:1.6;">${text}</p>`;
}

function ctaButton(href: string, label: string): string {
  return `<div style="margin:24px 0;text-align:center;">
  <a href="${href}" style="display:inline-block;padding:14px 32px;background-color:#0075DE;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;border-radius:9999px;">
    ${label}
  </a>
</div>`;
}

function alertBox(text: string, variant: "danger" | "warning" | "success"): string {
  const styles = {
    danger: { bg: "#fef2f2", border: "#fecaca", color: "#DC2626" },
    warning: { bg: "#fffbeb", border: "#fde68a", color: "#D97706" },
    success: { bg: "#f0fdf4", border: "#bbf7d0", color: "#059669" },
  };
  const s = styles[variant];
  return `<div style="margin:24px 0;padding:16px;background-color:${s.bg};border:1px solid ${s.border};border-radius:8px;">
  <p style="margin:0;color:${s.color};font-size:14px;line-height:1.5;">${text}</p>
</div>`;
}

function disclaimer(text: string): string {
  return `<p style="margin:0;color:#74736F;font-size:14px;line-height:1.5;">${text}</p>`;
}

function buildWaitlistConfirmationHtml(name: string, position: number): string {
  const safeName = escapeHtml(name);
  const safePosition = escapeHtml(String(position));
  return emailShell(`
    ${heading(`Bienvenue sur la waitlist, ${safeName}\u00a0!`)}
    ${bodyText(`Votre inscription a bien \u00e9t\u00e9 enregistr\u00e9e. Vous \u00eates en <strong style="color:#191817;">position #${safePosition}</strong> sur la liste d\u2019attente.`)}
    ${bodyText(`Nous vous enverrons un email d\u00e8s qu\u2019une place se lib\u00e8re. En attendant, restez connect\u00e9\u00a0!`)}
    <div style="margin:24px 0;padding:16px;background-color:#F8F8F7;border:1px solid #F0F0F0;border-radius:8px;text-align:center;">
      <p style="margin:0;color:#74736F;font-size:14px;">Votre position actuelle</p>
      <p style="margin:8px 0 0;color:#0075DE;font-size:32px;font-weight:700;">#${safePosition}</p>
    </div>
    ${disclaimer("Vous recevez cet email car vous vous \u00eates inscrit sur la waitlist Pennote.")}
  `);
}

function buildSpotAvailableHtml(name: string): string {
  const safeName = escapeHtml(name);
  const ctaUrl = `${WEBSITE_BASE_URL}/fr/join`;
  return emailShell(`
    ${heading(`Bonne nouvelle, ${safeName}\u00a0!`)}
    ${bodyText(`Une place s\u2019est lib\u00e9r\u00e9e sur Pennote\u00a0! Vous pouvez d\u00e8s maintenant cr\u00e9er votre compte et commencer \u00e0 utiliser l\u2019application.`)}
    ${ctaButton(ctaUrl, "Cr\u00e9er mon compte")}
    ${alertBox("<strong>&#9200; Important :</strong> Vous avez <strong>14 jours</strong> pour cr\u00e9er votre compte. Pass\u00e9 ce d\u00e9lai, votre place sera lib\u00e9r\u00e9e pour un autre utilisateur.", "warning")}
    ${disclaimer("Vous recevez cet email car vous \u00e9tiez inscrit sur la waitlist Pennote.")}
  `);
}

function buildWaitlistPositionUpdateHtml(name: string, position: number): string {
  const safeName = escapeHtml(name);
  const safePosition = escapeHtml(String(position));
  return emailShell(`
    ${heading(`${safeName}, vous avancez\u00a0!`)}
    ${bodyText(`Bonne nouvelle\u00a0: vous \u00eates pass\u00e9 en <strong style="color:#191817;">position #${safePosition}</strong> sur la liste d\u2019attente. Plus que quelques places avant votre tour\u00a0!`)}
    <div style="margin:24px 0;padding:16px;background-color:#F8F8F7;border:1px solid #F0F0F0;border-radius:8px;text-align:center;">
      <p style="margin:0;color:#74736F;font-size:14px;">Votre nouvelle position</p>
      <p style="margin:8px 0 0;color:#0075DE;font-size:32px;font-weight:700;">#${safePosition}</p>
    </div>
    ${bodyText(`Nous vous pr\u00e9viendrons d\u00e8s qu\u2019une place se lib\u00e8re pour vous.`)}
    ${disclaimer("Vous recevez cet email car vous \u00eates inscrit sur la waitlist Pennote.")}
  `);
}

function buildBetaAccessGrantedHtml(name: string): string {
  const safeName = escapeHtml(name);
  const ctaUrl = `${APP_BASE_URL}/`;
  return emailShell(`
    ${heading(`Bienvenue dans la beta, ${safeName}\u00a0!`)}
    ${bodyText(`Votre compte beta est maintenant actif. Vous pouvez acc\u00e9der \u00e0 toutes les fonctionnalit\u00e9s de Pennote d\u00e8s maintenant.`)}
    ${alertBox('<strong style="color:#059669;">Votre compte beta est maintenant actif\u00a0!</strong>', "success")}
    ${ctaButton(ctaUrl, "Acc\u00e9der \u00e0 Pennote")}
    ${disclaimer("Vous recevez cet email car un administrateur a activ\u00e9 votre acc\u00e8s beta Pennote.")}
  `);
}

function buildBetaWelcomeHtml(name: string, email: string, temporaryPassword: string): string {
  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(email);
  const safePassword = escapeHtml(temporaryPassword);
  const ctaUrl = `${APP_BASE_URL}/login`;
  return emailShell(`
    ${heading(`Bienvenue dans la beta, ${safeName}\u00a0!`)}
    ${bodyText(`Votre compte Pennote est pr\u00eat. Connectez-vous avec les identifiants ci-dessous pour commencer.`)}
    <div style="margin:24px 0;padding:20px;background-color:#F8F8F7;border:1px solid #F0F0F0;border-radius:8px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding:0 0 12px;color:#74736F;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Vos identifiants</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#676663;font-size:15px;line-height:1.5;">
            <strong style="color:#191817;">Email :</strong> ${safeEmail}
          </td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#676663;font-size:15px;line-height:1.5;">
            <strong style="color:#191817;">Mot de passe :</strong>
            <code style="background-color:#FFFFFF;padding:2px 8px;border-radius:4px;font-family:'SF Mono',Monaco,Consolas,monospace;font-size:14px;color:#191817;border:1px solid #F0F0F0;">${safePassword}</code>
          </td>
        </tr>
      </table>
    </div>
    ${ctaButton(ctaUrl, "Se connecter")}
    ${alertBox("<strong>&#128274; S\u00e9curit\u00e9 :</strong> Pensez \u00e0 modifier votre mot de passe dans <strong>Param\u00e8tres</strong> apr\u00e8s votre premi\u00e8re connexion.", "warning")}
    ${disclaimer("Vous recevez cet email car un compte beta Pennote a \u00e9t\u00e9 cr\u00e9\u00e9 pour vous.")}
  `);
}

function buildBetaAccessRevokedHtml(name: string, deadlineDays: number): string {
  const safeName = escapeHtml(name);
  const safeDeadline = escapeHtml(String(deadlineDays));
  const ctaUrl = `${WEBSITE_BASE_URL}/fr/join`;
  return emailShell(`
    ${heading(`${safeName}, votre acc\u00e8s beta a \u00e9t\u00e9 d\u00e9sactiv\u00e9`)}
    ${bodyText(`Un administrateur a d\u00e9sactiv\u00e9 votre acc\u00e8s beta Pennote. Vous pouvez r\u00e9activer votre compte en vous reconnectant.`)}
    ${alertBox("<strong>&#9200; Important :</strong> Vous avez <strong>" + safeDeadline + " jours</strong> pour vous reconnecter. Pass\u00e9 ce d\u00e9lai, votre place sera lib\u00e9r\u00e9e pour un autre utilisateur.", "danger")}
    ${ctaButton(ctaUrl, "R\u00e9activer mon compte")}
    ${disclaimer("Vous recevez cet email car votre acc\u00e8s beta Pennote a \u00e9t\u00e9 modifi\u00e9.")}
  `);
}

function truncateSubject(msg: string): string {
  const cleaned = msg.replace(/\n/g, " ").trim();
  return cleaned.length > 60 ? `${cleaned.slice(0, 57)}...` : cleaned;
}

function buildFeedbackReportHtml(input: FeedbackReportInput): string {
  const safeMessage = escapeHtml(input.message);
  const typeLabel = { bug: "Bug", suggestion: "Suggestion", other: "Autre" }[input.type];
  const typeColor = { bug: "#991b1b", suggestion: "#1e40af", other: "#71717a" }[input.type];
  const typeBg = { bug: "#fef2f2", suggestion: "#eff6ff", other: "#f4f4f5" }[input.type];

  const errorLogsHtml = input.errorLogs?.length
    ? `<tr><td style="padding:24px 40px 0;">
        <h3 style="margin:0 0 12px;color:#18181b;font-size:14px;font-weight:600;">Error Logs (auto-collected)</h3>
        <div style="background-color:#18181b;border-radius:8px;padding:16px;overflow-x:auto;">
          <pre style="margin:0;color:#a1a1aa;font-size:12px;line-height:1.6;font-family:'SF Mono',Monaco,Consolas,monospace;white-space:pre-wrap;">${input.errorLogs
            .map((log) => {
              const time = new Date(log.timestamp).toLocaleTimeString("fr-FR");
              const urlPart = log.url ? ` — ${escapeHtml(log.url)}` : "";
              return `[${time}] ${escapeHtml(log.type)}${urlPart}\n  ${escapeHtml(log.message)}${log.stack ? `\n  ${escapeHtml(log.stack)}` : ""}`;
            })
            .join("\n\n")}</pre>
        </div>
      </td></tr>`
    : "";

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:40px 20px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
      <tr><td style="background-color:#18181b;padding:32px 40px;text-align:center;">
        <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">Pennote — Beta Feedback</h1>
      </td></tr>
      <tr><td style="padding:40px;">
        <div style="display:inline-block;padding:4px 12px;background-color:${typeBg};color:${typeColor};font-size:13px;font-weight:600;border-radius:9999px;margin-bottom:16px;">
          ${typeLabel}
        </div>
        <div style="margin:16px 0;padding:16px;background-color:#f4f4f5;border-radius:8px;border-left:4px solid ${typeColor};">
          <p style="margin:0;color:#3f3f46;font-size:15px;line-height:1.6;white-space:pre-wrap;">${safeMessage}</p>
        </div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;">
          <tr>
            <td style="padding:6px 0;color:#71717a;font-size:13px;"><strong>User ID:</strong> ${escapeHtml(input.userId)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#71717a;font-size:13px;"><strong>Email:</strong> ${escapeHtml(input.userEmail)}</td>
          </tr>
          ${input.whatsappName ? `<tr><td style="padding:6px 0;color:#71717a;font-size:13px;"><strong>WhatsApp:</strong> ${escapeHtml(input.whatsappName)}</td></tr>` : ""}
          ${input.currentUrl ? `<tr><td style="padding:6px 0;color:#71717a;font-size:13px;"><strong>URL:</strong> ${escapeHtml(input.currentUrl)}</td></tr>` : ""}
          ${input.userAgent ? `<tr><td style="padding:6px 0;color:#71717a;font-size:13px;"><strong>User-Agent:</strong> ${escapeHtml(input.userAgent)}</td></tr>` : ""}
          <tr>
            <td style="padding:6px 0;color:#71717a;font-size:13px;"><strong>Date:</strong> ${new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}</td>
          </tr>
        </table>
      </td></tr>
      ${errorLogsHtml}
      <tr><td style="padding:24px 40px;background-color:#fafafa;text-align:center;">
        <p style="margin:0;color:#a1a1aa;font-size:12px;">&copy; ${new Date().getFullYear()} Pennote. Feedback beta automatique.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}
