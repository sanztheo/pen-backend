import type { Request, Response } from "express";
import { BetaService } from "../../services/BetaService.js";
import { logger } from "../../utils/logger.js";
import { sanitizeObjectKeys, stripHtmlTags } from "../../utils/sanitize.js";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** RFC 5321: max 254 chars for a valid email address */
const MAX_EMAIL_LENGTH = 254;
const PHONE_REGEX = /^\+?[\d\s\-().]{0,30}$/;
const MAX_PHONE_LENGTH = 32;
const MAX_METADATA_SIZE_BYTES = 4096;

// ─── Turnstile verification ─────────────────────────────────
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET_KEY;

interface TurnstileResponse {
  success: boolean;
  "error-codes"?: string[];
}

async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
  if (!TURNSTILE_SECRET) {
    logger.warn("[TURNSTILE] TURNSTILE_SECRET_KEY not set — skipping verification");
    return true;
  }

  try {
    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        secret: TURNSTILE_SECRET,
        response: token,
        remoteip: ip,
      }),
      signal: AbortSignal.timeout(5_000),
    });

    const data = (await res.json()) as TurnstileResponse;

    if (!data.success) {
      logger.warn("[TURNSTILE] Verification failed:", data["error-codes"]);
    }

    return data.success;
  } catch (err: unknown) {
    logger.error("[TURNSTILE] Verification request failed:", err);
    return false;
  }
}

export class WaitlistController {
  static async addToWaitlist(req: Request, res: Response): Promise<void> {
    try {
      const body: unknown = req.body;
      const raw =
        typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};

      const email = typeof raw.email === "string" ? raw.email : undefined;
      const name = typeof raw.name === "string" ? raw.name : undefined;
      const phone = typeof raw.phone === "string" ? raw.phone : undefined;
      const metadata =
        typeof raw.metadata === "object" && raw.metadata !== null && !Array.isArray(raw.metadata)
          ? (raw.metadata as Record<string, unknown>)
          : undefined;

      const turnstileToken =
        typeof raw.turnstileToken === "string" ? raw.turnstileToken : undefined;

      // Turnstile CAPTCHA verification (before any processing)
      if (!turnstileToken) {
        res.status(400).json({
          success: false,
          error: "CAPTCHA verification required",
          code: "MISSING_CAPTCHA",
        });
        return;
      }

      const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
      const isCaptchaValid = await verifyTurnstile(turnstileToken, ip);
      if (!isCaptchaValid) {
        res.status(403).json({
          success: false,
          error: "CAPTCHA verification failed",
          code: "INVALID_CAPTCHA",
        });
        return;
      }

      const trimmedEmail = email?.trim().toLowerCase();
      const trimmedName = name !== undefined ? stripHtmlTags(name.trim()) : undefined;

      // Validation
      if (!trimmedEmail || !trimmedName) {
        res.status(400).json({
          success: false,
          error: "email and name are required",
          code: "MISSING_FIELDS",
        });
        return;
      }

      if (trimmedEmail.length > MAX_EMAIL_LENGTH || !EMAIL_REGEX.test(trimmedEmail)) {
        res.status(400).json({
          success: false,
          error: "Invalid email format",
          code: "INVALID_EMAIL",
        });
        return;
      }

      if (trimmedName.length < 2 || trimmedName.length > 200) {
        res.status(400).json({
          success: false,
          error: "Name must be between 2 and 200 characters",
          code: "INVALID_NAME_LENGTH",
        });
        return;
      }

      // Validate phone before building final payload
      const trimmedPhone = phone?.trim();
      if (trimmedPhone !== undefined && trimmedPhone !== "") {
        if (trimmedPhone.length > MAX_PHONE_LENGTH || !PHONE_REGEX.test(trimmedPhone)) {
          res.status(400).json({
            success: false,
            error: `Invalid phone format (max ${MAX_PHONE_LENGTH} chars, digits/spaces/dashes only)`,
            code: "INVALID_PHONE",
          });
          return;
        }
      }

      // Sanitize metadata (prevent prototype pollution) then merge phone
      const safeMetadata = metadata !== undefined ? sanitizeObjectKeys(metadata) : {};
      const waitlistMetadata: Record<string, unknown> = {
        ...safeMetadata,
        ...(trimmedPhone ? { phone: trimmedPhone } : {}),
      };

      const finalPayloadSize = new TextEncoder().encode(JSON.stringify(waitlistMetadata)).length;
      if (finalPayloadSize > MAX_METADATA_SIZE_BYTES) {
        res.status(400).json({
          success: false,
          error: "Metadata too large (max 4KB)",
          code: "METADATA_TOO_LARGE",
        });
        return;
      }

      const userId = req.user?.id;

      // PEN-140: Authenticated users must use their own email (prevent third-party submissions)
      const userEmail =
        userId && typeof req.user?.email === "string" && req.user.email.trim() !== ""
          ? req.user.email.trim().toLowerCase()
          : undefined;

      if (userId && !userEmail) {
        res.status(400).json({
          success: false,
          error: "Authenticated user must have a valid email",
          code: "MISSING_USER_EMAIL",
        });
        return;
      }

      // userEmail is guaranteed defined when userId is truthy (guard clause above)
      const finalEmail = userEmail ?? trimmedEmail;

      const result = await BetaService.addToWaitlist(
        { email: finalEmail, name: trimmedName, metadata: waitlistMetadata },
        userId,
      );

      // Fire-and-forget: confirmation email for NEW signups only
      if (!result.rejected && !result.alreadyExists) {
        import("../../services/EmailService.js")
          .then(({ EmailService }) =>
            EmailService.sendWaitlistConfirmation({
              to: finalEmail,
              name: trimmedName,
              position: result.position,
            }),
          )
          .catch((err: unknown) => {
            logger.error("[BETA_WAITLIST] Email confirmation import failed:", err);
          });
      }

      if (result.rejected) {
        // BM-002: Indistinguishable response — prevents email enumeration
        // Active users silently get 201 without actually being added to waitlist
        res.status(201).json({ success: true });
        return;
      }

      // Indistinguishable response: prevent email enumeration (BM-002)
      // PEN-141: Position only exposed if the waitlist entry belongs to this user
      const response: { success: true; position?: number } = { success: true };
      if (userId && result.isOwned) {
        response.position = result.position;
      }

      res.status(201).json(response);
    } catch (error) {
      logger.error("[BETA_WAITLIST] Error adding to waitlist:", error);
      res.status(500).json({
        success: false,
        error: "Failed to add to waitlist",
      });
    }
  }
}
