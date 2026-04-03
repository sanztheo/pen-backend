/**
 * Send product update email v1.6.0 to all active users
 *
 * Usage:
 *   # Dry run (preview recipients, no emails sent):
 *   infisical run --path=/Backend/PROD -- npx tsx scripts/send-product-update.ts --dry-run
 *
 *   # Send to yourself first:
 *   infisical run --path=/Backend/PROD -- npx tsx scripts/send-product-update.ts --test redacted@example.com
 *
 *   # Send to all active users:
 *   infisical run --path=/Backend/PROD -- npx tsx scripts/send-product-update.ts --send
 *
 * Env vars required:
 *   RESEND_API_KEY — Resend API key (from Infisical /Backend/PROD)
 *   DATABASE_URL   — prod database (from Infisical) OR DB_PROD from .env.prod
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ──────────────────────────────────────────────────────
const EMAIL_SUBJECT = "Pennote UPDATE : Penly v1.6 fait peau neuve";
const EMAIL_FROM = "Pennote <update@pennote.fr>";
const BATCH_SIZE = 20;
const DELAY_BETWEEN_BATCHES_MS = 5_000; // Resend limit: 20 emails per 5 seconds
const HTML_PATH = resolve(__dirname, "../../docs/templates/product-update-v1.6.0.html");

// ── Helpers ─────────────────────────────────────────────────────
function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function loadEnvProd(): void {
  try {
    const envPath = resolve(__dirname, "../../.env.prod");
    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const match = line.match(/^([^=]+)=(.+)$/);
      if (match) {
        const [, key, value] = match;
        if (key === "DB_PROD") {
          // Always use DB_PROD for prod users — overrides infisical DATABASE_URL
          process.env.DATABASE_URL = value.trim();
        }
      }
    }
  } catch {
    // .env.prod not found, rely on infisical
  }
}

// ── Fetch active users from prod DB ─────────────────────────────
interface UserRow {
  email: string;
  first_name: string;
}

async function fetchActiveUsers(): Promise<UserRow[]> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL or DB_PROD not set");

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();

  try {
    const result = await client.query<UserRow>(
      `SELECT email, first_name FROM users WHERE is_active = true ORDER BY created_at ASC`,
    );
    return result.rows;
  } finally {
    await client.end();
  }
}

// ── Send emails via Resend ──────────────────────────────────────
async function sendEmails(users: UserRow[], html: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY not set");

  const { Resend } = await import("resend");
  const resend = new Resend(apiKey);

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const batch = users.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map((user) =>
        resend.emails.send({
          from: EMAIL_FROM,
          to: user.email,
          subject: EMAIL_SUBJECT,
          html,
        }),
      ),
    );

    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      const user = batch[j];
      if (result.status === "fulfilled" && !result.value.error) {
        sent++;
        console.log(`  [${sent}] ${user.email}`);
      } else {
        failed++;
        const err = result.status === "rejected" ? result.reason : result.value.error;
        console.error(`  [FAIL] ${user.email}:`, err);
      }
    }

    if (i + BATCH_SIZE < users.length) {
      await delay(DELAY_BETWEEN_BATCHES_MS);
    }
  }

  console.log(`\nDone: ${sent} sent, ${failed} failed out of ${users.length} users.`);
}

// ── Main ────────────────────────────────────────────────────────
async function main(): Promise<void> {
  loadEnvProd();

  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");
  const testIdx = args.indexOf("--test");
  const testEmail = testIdx !== -1 ? args[testIdx + 1] : undefined;
  const isSend = args.includes("--send");

  if (!isDryRun && !testEmail && !isSend) {
    console.log("Usage:");
    console.log("  --dry-run              List recipients without sending");
    console.log("  --test <email>         Send to a single email for testing");
    console.log("  --send                 Send to ALL active users");
    process.exit(0);
  }

  // Load HTML template
  const html = readFileSync(HTML_PATH, "utf-8");
  console.log(`[update] Template loaded (${(html.length / 1024).toFixed(1)} KB)`);
  console.log(`[update] Subject: ${EMAIL_SUBJECT}`);
  console.log(`[update] From: ${EMAIL_FROM}\n`);

  if (testEmail) {
    console.log(`[update] TEST MODE — sending to: ${testEmail}\n`);
    await sendEmails([{ email: testEmail, first_name: "Test" }], html);
    return;
  }

  // Fetch users
  const users = await fetchActiveUsers();
  console.log(`[update] Found ${users.length} active users\n`);

  if (isDryRun) {
    console.log("Recipients:");
    users.forEach((u, i) => console.log(`  ${i + 1}. ${u.first_name} <${u.email}>`));
    console.log(`\nDry run complete. Use --send to actually send.`);
    return;
  }

  if (isSend) {
    console.log(`[update] Sending to ${users.length} users in batches of ${BATCH_SIZE}...\n`);
    await sendEmails(users, html);
  }
}

main().catch((err) => {
  console.error("[update] Fatal:", err);
  process.exit(1);
});
