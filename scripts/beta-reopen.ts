/**
 * Reopen beta accounts — send magic-link email + downgrade subscription to free.
 *
 * Targets users with `beta_joined_at IS NOT NULL` (31 at time of writing).
 * For each user:
 *   1. GET Clerk user (skip if 404)
 *   2. POST Clerk sign_in_token (30d one-use)
 *   3. Snapshot current subscription
 *   4. UPSERT UserSubscription.plan = 'free_user' (unless excluded)
 *   5. Send Resend email with magic link
 *
 * Usage:
 *   # 1. Preview recipients, no writes, no emails:
 *   infisical run --env=prod --path=/Backend -- npx tsx scripts/beta-reopen.ts --dry-run
 *
 *   # 2. Single test to one email (real token + email, NO subscription change):
 *   infisical run --env=prod --path=/Backend -- npx tsx scripts/beta-reopen.ts --test redacted@example.com
 *
 *   # 3. Full run — tokens, subscription downgrades, emails to the 31:
 *   infisical run --env=prod --path=/Backend -- npx tsx scripts/beta-reopen.ts --send
 *
 * Env vars required (from Infisical /Backend env=prod):
 *   RESEND_API_KEY, CLERK_SECRET_KEY, DATABASE_URL (or DB_PROD from .env.prod)
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ──────────────────────────────────────────────────────
const EMAIL_SUBJECT = "Pennote est ouvert — ton compte t'attend";
const EMAIL_FROM = "Pennote <update@pennote.fr>";
const APP_BASE_URL = "https://app.pennote.fr";
const BATCH_SIZE = 10;
const DELAY_BETWEEN_BATCHES_MS = 5_000;
const SIGN_IN_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const EXCLUDED_EMAILS = new Set(["sanztheopro@gmail.com", "redacted@example.com"]);

const HTML_PATH = resolve(__dirname, "../../docs/templates/beta-reopen.html");
const LOG_DIR = resolve(__dirname, "../../tasks");
const LOG_FILE = resolve(LOG_DIR, `beta-reopen-${new Date().toISOString().slice(0, 10)}.jsonl`);
const SNAPSHOT_FILE = resolve(
  LOG_DIR,
  `beta-reopen-snapshot-${new Date().toISOString().slice(0, 10)}.json`,
);

// ── Types ───────────────────────────────────────────────────────
interface UserRow {
  id: string;
  email: string;
  first_name: string;
  beta_status: string;
  current_plan: string | null;
  subscription_id: string | null;
}

interface StepResult {
  email: string;
  step: string;
  ok: boolean;
  detail?: string;
}

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
        if (key === "DB_PROD") process.env.DATABASE_URL = value.trim();
      }
    }
  } catch {
    // rely on infisical
  }
}

function logLine(entry: Record<string, unknown>): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
  mkdirSync(LOG_DIR, { recursive: true });
  writeFileSync(LOG_FILE, line + "\n", { flag: "a" });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── DB ──────────────────────────────────────────────────────────
async function fetchBetaUsers(): Promise<UserRow[]> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL or DB_PROD not set");
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  try {
    const { rows } = await client.query<UserRow>(
      `SELECT u.id, u.email, u.first_name, u.beta_status::text AS beta_status,
              us.plan::text AS current_plan, us.id AS subscription_id
       FROM users u
       LEFT JOIN user_subscriptions us ON us.user_id = u.id
       WHERE u.beta_joined_at IS NOT NULL
       ORDER BY u.beta_joined_at ASC`,
    );
    return rows;
  } finally {
    await client.end();
  }
}

async function snapshotSubscriptions(users: UserRow[]): Promise<void> {
  const snapshot = users.map((u) => ({
    user_id: u.id,
    email: u.email,
    subscription_id: u.subscription_id,
    previous_plan: u.current_plan,
  }));
  mkdirSync(LOG_DIR, { recursive: true });
  writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2));
  console.log(`[beta-reopen] Snapshot saved → ${SNAPSHOT_FILE}`);
}

async function downgradeToFree(userId: string): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL missing");
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  try {
    await client.query(
      `UPDATE user_subscriptions
       SET plan = 'free_user', updated_at = NOW()
       WHERE user_id = $1`,
      [userId],
    );
  } finally {
    await client.end();
  }
}

// ── Clerk ───────────────────────────────────────────────────────
async function clerkFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: T | null }> {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key) throw new Error("CLERK_SECRET_KEY missing");
  const res = await fetch(`https://api.clerk.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const status = res.status;
  let body: T | null = null;
  try {
    body = (await res.json()) as T;
  } catch {
    /* ignore */
  }
  return { status, body };
}

async function checkClerkUser(userId: string): Promise<boolean> {
  const { status } = await clerkFetch<unknown>(`/users/${userId}`, { method: "GET" });
  return status === 200;
}

interface SignInTokenResponse {
  token?: string;
  url?: string;
}

async function createSignInToken(userId: string): Promise<string | null> {
  const { status, body } = await clerkFetch<SignInTokenResponse>("/sign_in_tokens", {
    method: "POST",
    body: JSON.stringify({ user_id: userId, expires_in_seconds: SIGN_IN_TOKEN_TTL_SECONDS }),
  });
  if (status !== 200 || !body?.token) return null;
  return body.token;
}

// ── Resend ──────────────────────────────────────────────────────
async function sendEmail(
  to: string,
  html: string,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY missing" };
  const { Resend } = await import("resend");
  const resend = new Resend(apiKey);
  const result = await resend.emails.send({
    from: EMAIL_FROM,
    to,
    subject: EMAIL_SUBJECT,
    html,
  });
  if (result.error) return { ok: false, error: JSON.stringify(result.error) };
  return { ok: true, id: result.data?.id };
}

function renderHtml(template: string, firstName: string, email: string, magicLink: string): string {
  return template
    .replace(/\{\{FIRST_NAME\}\}/g, escapeHtml(firstName || "!"))
    .replace(/\{\{EMAIL\}\}/g, escapeHtml(email))
    .replace(/\{\{MAGIC_LINK\}\}/g, magicLink);
}

// ── Pipeline for one user ───────────────────────────────────────
async function processUser(
  user: UserRow,
  template: string,
  opts: { applyDowngrade: boolean; sendEmail: boolean },
): Promise<StepResult[]> {
  const steps: StepResult[] = [];

  // 1. Clerk user exists?
  const exists = await checkClerkUser(user.id);
  steps.push({ email: user.email, step: "clerk_check", ok: exists });
  if (!exists) {
    logLine({ email: user.email, action: "skip_no_clerk_user" });
    return steps;
  }

  // 2. Sign-in token
  const token = await createSignInToken(user.id);
  steps.push({ email: user.email, step: "sign_in_token", ok: !!token });
  if (!token) {
    logLine({ email: user.email, action: "skip_token_failed" });
    return steps;
  }
  const magicLink = `${APP_BASE_URL}/login?__clerk_ticket=${encodeURIComponent(token)}`;

  // 3. Downgrade subscription
  if (opts.applyDowngrade && !EXCLUDED_EMAILS.has(user.email.toLowerCase())) {
    try {
      await downgradeToFree(user.id);
      steps.push({ email: user.email, step: "downgrade", ok: true });
    } catch (err) {
      steps.push({
        email: user.email,
        step: "downgrade",
        ok: false,
        detail: (err as Error).message,
      });
    }
  } else {
    steps.push({
      email: user.email,
      step: "downgrade",
      ok: true,
      detail: "skipped",
    });
  }

  // 4. Email
  if (opts.sendEmail) {
    const html = renderHtml(template, user.first_name, user.email, magicLink);
    const res = await sendEmail(user.email, html);
    steps.push({
      email: user.email,
      step: "email",
      ok: res.ok,
      detail: res.id ?? res.error,
    });
    logLine({
      email: user.email,
      user_id: user.id,
      action: "sent",
      resend_id: res.id,
      error: res.error,
    });
  } else {
    steps.push({ email: user.email, step: "email", ok: true, detail: "skipped (dry-run)" });
  }

  return steps;
}

// ── Main ────────────────────────────────────────────────────────
async function main(): Promise<void> {
  loadEnvProd();

  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");
  const isSend = args.includes("--send");
  const testIdx = args.indexOf("--test");
  const testEmail = testIdx !== -1 ? args[testIdx + 1] : undefined;

  if (!isDryRun && !testEmail && !isSend) {
    console.log("Usage:");
    console.log("  --dry-run              List recipients, check Clerk, no emails, no writes");
    console.log("  --test <email>         Send real email to one beta user (no DB writes)");
    console.log("  --send                 Full run: tokens + downgrade + emails for all 31");
    process.exit(0);
  }

  const template = readFileSync(HTML_PATH, "utf-8");
  console.log(`[beta-reopen] Template: ${(template.length / 1024).toFixed(1)} KB`);
  console.log(`[beta-reopen] Subject: ${EMAIL_SUBJECT}`);
  console.log(`[beta-reopen] From: ${EMAIL_FROM}`);
  console.log(`[beta-reopen] Log: ${LOG_FILE}`);

  const users = await fetchBetaUsers();
  console.log(`\n[beta-reopen] Found ${users.length} beta users (beta_joined_at NOT NULL)\n`);

  // Test mode: single email, no DB writes
  if (testEmail) {
    const target = users.find((u) => u.email.toLowerCase() === testEmail.toLowerCase());
    if (!target) {
      console.error(`[beta-reopen] User ${testEmail} not found in beta set.`);
      process.exit(1);
    }
    console.log(`[beta-reopen] TEST MODE → ${testEmail}`);
    const steps = await processUser(target, template, { applyDowngrade: false, sendEmail: true });
    for (const s of steps) {
      console.log(`  ${s.ok ? "OK " : "FAIL"}  ${s.step}  ${s.detail ?? ""}`);
    }
    return;
  }

  // Dry-run: preview only (still checks Clerk but no tokens/emails/DB)
  if (isDryRun) {
    console.log("Recipients:");
    for (let i = 0; i < users.length; i++) {
      const u = users[i];
      const excluded = EXCLUDED_EMAILS.has(u.email.toLowerCase());
      const exists = await checkClerkUser(u.id);
      console.log(
        `  ${i + 1}. ${u.first_name.padEnd(15)} ${u.email.padEnd(35)} [${u.beta_status}] plan=${u.current_plan ?? "none"} clerk=${exists ? "OK" : "404"}${excluded ? " (EXCLUDED)" : ""}`,
      );
    }
    console.log(`\nDry run complete. ${users.length} users.`);
    return;
  }

  // Full send
  if (isSend) {
    await snapshotSubscriptions(users);
    console.log(`[beta-reopen] Sending to ${users.length} users in batches of ${BATCH_SIZE}...\n`);

    let sent = 0;
    let failed = 0;

    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      const batch = users.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map((u) => processUser(u, template, { applyDowngrade: true, sendEmail: true })),
      );
      for (let j = 0; j < results.length; j++) {
        const steps = results[j];
        const user = batch[j];
        const emailStep = steps.find((s) => s.step === "email");
        if (emailStep?.ok) {
          sent++;
          console.log(`  [${sent}] ${user.email}`);
        } else {
          failed++;
          console.error(
            `  [FAIL] ${user.email}: ${steps.map((s) => `${s.step}=${s.ok}`).join(", ")}`,
          );
        }
      }
      if (i + BATCH_SIZE < users.length) {
        await delay(DELAY_BETWEEN_BATCHES_MS);
      }
    }

    console.log(
      `\n[beta-reopen] Done: ${sent} sent, ${failed} failed out of ${users.length} users.`,
    );
    console.log(`[beta-reopen] Snapshot: ${SNAPSHOT_FILE}`);
    console.log(`[beta-reopen] Log: ${LOG_FILE}`);
  }
}

main().catch((err) => {
  console.error("[beta-reopen] Fatal:", err);
  process.exit(1);
});
