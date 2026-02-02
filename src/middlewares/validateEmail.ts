import { Request, Response, NextFunction } from "express";
import { isDisposableEmailDomain } from "disposable-email-domains-js";

/**
 * Middleware to block disposable/temporary email addresses
 * Prevents trial abuse via throwaway email accounts
 */
export const validateEmail = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  // Get email from request body or user object
  const email = req.body?.email || req.user?.email;

  if (!email) {
    return next(); // No email to validate, let other middlewares handle auth
  }

  const domain = email.split("@")[1]?.toLowerCase();

  if (!domain) {
    return res.status(400).json({
      error: "EMAIL_INVALID",
      message: "Adresse email invalide",
    });
  }

  // Check if disposable email
  try {
    const isDisposable = isDisposableEmailDomain(domain);

    if (isDisposable) {
      console.warn(`[EMAIL] Blocked disposable email: ${email}`);
      return res.status(400).json({
        error: "DISPOSABLE_EMAIL",
        message:
          "Les adresses email temporaires ne sont pas autorisees. Veuillez utiliser une adresse email permanente.",
      });
    }
  } catch (error) {
    // If validation fails, allow the request to continue
    console.error("[EMAIL] Validation error:", error);
  }

  next();
};

/**
 * Normalize email address to prevent alias abuse
 * - Removes dots from Gmail addresses
 * - Removes +alias from Gmail addresses
 */
export const normalizeEmail = (email: string): string => {
  const [local, domain] = email.toLowerCase().split("@");

  if (!local || !domain) return email.toLowerCase();

  // Gmail and Google-hosted domains ignore dots and +aliases
  if (domain === "gmail.com" || domain === "googlemail.com") {
    const normalizedLocal = local
      .split("+")[0] // Remove +alias
      .replace(/\./g, ""); // Remove dots
    return `${normalizedLocal}@gmail.com`;
  }

  return email.toLowerCase();
};
