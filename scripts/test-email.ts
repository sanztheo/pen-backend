/**
 * Manual email test script — sends all 5 email templates
 *
 * Usage:
 *   infisical run --env=dev --path=/Backend -- npx tsx scripts/test-email.ts
 *
 * Override recipient:
 *   RESEND_TEST_EMAIL=your@email.com infisical run --env=dev --path=/Backend -- npx tsx scripts/test-email.ts
 */

import { EmailService } from "../src/services/EmailService.js";

const testEmail = process.env.RESEND_TEST_EMAIL ?? "delivered@resend.dev";

async function main(): Promise<void> {
  console.log(`[test-email] Sending 5 test emails to: ${testEmail}\n`);

  console.log("1/5 — Waitlist confirmation...");
  await EmailService.sendWaitlistConfirmation({
    to: testEmail,
    name: "Test User",
    position: 42,
  });
  console.log("    Done.\n");

  console.log("2/5 — Spot available...");
  await EmailService.sendSpotAvailable({
    to: testEmail,
    name: "Test User",
  });
  console.log("    Done.\n");

  console.log("3/5 — Beta access granted...");
  await EmailService.sendBetaAccessGranted({
    to: testEmail,
    name: "Test User",
  });
  console.log("    Done.\n");

  console.log("4/5 — Beta welcome (with credentials)...");
  await EmailService.sendBetaWelcome({
    to: testEmail,
    name: "Test User",
    email: testEmail,
    temporaryPassword: "Pennote-a1b2c3d4!",
  });
  console.log("    Done.\n");

  console.log("5/5 — Beta access revoked...");
  await EmailService.sendBetaAccessRevoked({
    to: testEmail,
    name: "Test User",
    reactivationDeadlineDays: 14,
  });
  console.log("    Done.\n");

  console.log("[test-email] All 5 emails sent. Check your inbox (or Resend dashboard).");
}

main().catch((err) => {
  console.error("[test-email] Fatal:", err);
  process.exit(1);
});
