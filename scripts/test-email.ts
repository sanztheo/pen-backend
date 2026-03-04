/**
 * Manual email test script
 *
 * Usage:
 *   infisical run --path=/Backend/DEV -- npx tsx scripts/test-email.ts
 *
 * Sends both email templates to RESEND_TEST_EMAIL (or defaults to onboarding@resend.dev).
 */

import { EmailService } from "../src/services/EmailService.js";

const testEmail = process.env.RESEND_TEST_EMAIL ?? "delivered@resend.dev";

async function main(): Promise<void> {
  console.log(`[test-email] Sending test emails to: ${testEmail}\n`);

  console.log("1/2 — Waitlist confirmation...");
  await EmailService.sendWaitlistConfirmation({
    to: testEmail,
    name: "Test User",
    position: 42,
  });
  console.log("    Done.\n");

  console.log("2/2 — Spot available...");
  await EmailService.sendSpotAvailable({
    to: testEmail,
    name: "Test User",
  });
  console.log("    Done.\n");

  console.log("[test-email] All emails sent. Check your inbox (or Resend dashboard).");
}

main().catch((err) => {
  console.error("[test-email] Fatal:", err);
  process.exit(1);
});
