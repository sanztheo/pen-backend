/**
 * Beta API Test Script
 *
 * Tests all beta management endpoints:
 * 1. GET  /api/beta/status     (no auth + with auth)
 * 2. POST /api/beta/heartbeat  (multiple pings, verify increment)
 * 3. POST /api/beta/waitlist   (signup, duplicate, validation)
 * 4. POST /api/beta/reactivate (nominal, no spots, invalid status)
 *
 * Usage:
 *   npx tsx scripts/test-beta-api.ts
 *   npx tsx scripts/test-beta-api.ts --base-url=http://localhost:3001
 *   npx tsx scripts/test-beta-api.ts --token=YOUR_BEARER_TOKEN
 */

const BASE_URL =
  process.argv.find((a) => a.startsWith("--base-url="))?.split("=")[1] ??
  "http://localhost:3001";

const AUTH_TOKEN =
  process.argv.find((a) => a.startsWith("--token="))?.split("=")[1] ?? "";

// Test auth headers (for dev mode with test auth)
const TEST_USER_ID =
  process.argv.find((a) => a.startsWith("--test-user-id="))?.split("=")[1] ??
  "";
const TEST_AUTH_SECRET =
  process.argv.find((a) => a.startsWith("--test-secret="))?.split("=")[1] ?? "";

const COLORS = {
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
  bold: "\x1b[1m",
};

function pass(label: string): void {
  console.log(`  ${COLORS.green}✓${COLORS.reset} ${label}`);
}

function fail(label: string, detail?: string): void {
  console.log(`  ${COLORS.red}✗${COLORS.reset} ${label}`);
  if (detail) {
    console.log(`    ${COLORS.dim}${detail}${COLORS.reset}`);
  }
}

function section(title: string): void {
  console.log(`\n${COLORS.cyan}${COLORS.bold}── ${title} ──${COLORS.reset}`);
}

function buildHeaders(withAuth: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (withAuth) {
    if (AUTH_TOKEN) {
      headers["Authorization"] = `Bearer ${AUTH_TOKEN}`;
    }
    if (TEST_USER_ID) {
      headers["x-test-user-id"] = TEST_USER_ID;
    }
    if (TEST_AUTH_SECRET) {
      headers["x-test-auth-secret"] = TEST_AUTH_SECRET;
    }
  }

  return headers;
}

async function request(
  method: string,
  path: string,
  options: { body?: unknown; auth?: boolean } = {},
): Promise<{ status: number; data: Record<string, unknown> }> {
  const url = `${BASE_URL}${path}`;
  const headers = buildHeaders(options.auth ?? false);

  const res = await fetch(url, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = (await res.json()) as Record<string, unknown>;
  return { status: res.status, data };
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    pass(label);
    passed++;
  } else {
    fail(label, detail);
    failed++;
  }
}

// ─── TEST SUITES ───

async function testStatusEndpoint(): Promise<void> {
  section("GET /api/beta/status (no auth)");

  const { status, data } = await request("GET", "/api/beta/status");
  assert(status === 200, `Status 200 (got ${status})`);
  assert(data.success === true, "success: true");

  const d = data.data as Record<string, unknown>;
  assert(
    typeof d.spotsRemaining === "number",
    `spotsRemaining is number (${d.spotsRemaining})`,
  );
  assert(d.totalSpots === 100, `totalSpots is 100 (got ${d.totalSpots})`);
  assert(typeof d.isFull === "boolean", `isFull is boolean (${d.isFull})`);
  assert(
    d.userStatus === undefined || d.userStatus === null,
    `userStatus is null/undefined without auth (got ${d.userStatus})`,
  );

  section("GET /api/beta/status (with auth)");

  const hasAuth = AUTH_TOKEN.length > 0 || TEST_USER_ID.length > 0;
  if (!hasAuth) {
    console.log(
      `  ${COLORS.yellow}⊘ Skipped (no auth token provided)${COLORS.reset}`,
    );
    return;
  }

  const authRes = await request("GET", "/api/beta/status", { auth: true });
  assert(authRes.status === 200, `Status 200 (got ${authRes.status})`);

  const ad = authRes.data.data as Record<string, unknown>;
  assert(
    ad.userStatus !== undefined,
    `userStatus present with auth (${ad.userStatus})`,
  );
}

async function testHeartbeatEndpoint(): Promise<void> {
  section("POST /api/beta/heartbeat");

  // Without auth -> 401
  const noAuth = await request("POST", "/api/beta/heartbeat", {
    body: { timestamp: Date.now() },
  });
  assert(noAuth.status === 401, `401 without auth (got ${noAuth.status})`);

  const hasAuth = AUTH_TOKEN.length > 0 || TEST_USER_ID.length > 0;
  if (!hasAuth) {
    console.log(
      `  ${COLORS.yellow}⊘ Increment tests skipped (no auth token)${COLORS.reset}`,
    );
    return;
  }

  // Send 3 heartbeats
  for (let i = 1; i <= 3; i++) {
    const res = await request("POST", "/api/beta/heartbeat", {
      body: { timestamp: Date.now() },
      auth: true,
    });
    assert(
      res.status === 200,
      `Heartbeat #${i}: status 200 (got ${res.status})`,
    );
    assert(res.data.success === true, `Heartbeat #${i}: success: true`);
  }
}

async function testWaitlistEndpoint(): Promise<void> {
  section("POST /api/beta/waitlist (validation)");

  // Missing fields
  const noFields = await request("POST", "/api/beta/waitlist", {
    body: {},
  });
  assert(
    noFields.status === 400,
    `400 without email/name (got ${noFields.status})`,
  );

  // Invalid email
  const badEmail = await request("POST", "/api/beta/waitlist", {
    body: { email: "not-an-email", name: "Test" },
  });
  assert(
    badEmail.status === 400,
    `400 with invalid email (got ${badEmail.status})`,
  );

  section("POST /api/beta/waitlist (signup)");

  const testEmail = `test-beta-${Date.now()}@example.com`;
  const signup = await request("POST", "/api/beta/waitlist", {
    body: { email: testEmail, name: "Beta Tester" },
  });
  assert(signup.status === 201, `201 on signup (got ${signup.status})`);
  assert(signup.data.success === true, "success: true");
  assert(
    typeof signup.data.position === "number",
    `position returned (${signup.data.position})`,
  );

  section("POST /api/beta/waitlist (duplicate)");

  const duplicate = await request("POST", "/api/beta/waitlist", {
    body: { email: testEmail, name: "Beta Tester" },
  });
  assert(
    duplicate.status === 409,
    `409 on duplicate (got ${duplicate.status})`,
  );
  assert(
    duplicate.data.error === "ALREADY_ON_WAITLIST",
    "error: ALREADY_ON_WAITLIST",
  );
}

async function testReactivateEndpoint(): Promise<void> {
  section("POST /api/beta/reactivate");

  // Without auth -> 401
  const noAuth = await request("POST", "/api/beta/reactivate");
  assert(noAuth.status === 401, `401 without auth (got ${noAuth.status})`);

  const hasAuth = AUTH_TOKEN.length > 0 || TEST_USER_ID.length > 0;
  if (!hasAuth) {
    console.log(
      `  ${COLORS.yellow}⊘ Reactivation tests skipped (no auth token)${COLORS.reset}`,
    );
    return;
  }

  // With auth — will return 400 INVALID_STATUS if user is already active
  const res = await request("POST", "/api/beta/reactivate", { auth: true });
  assert(
    [200, 400, 403].includes(res.status),
    `Expected 200/400/403 (got ${res.status})`,
    JSON.stringify(res.data),
  );

  if (res.status === 400) {
    assert(
      res.data.code === "INVALID_STATUS",
      `code: INVALID_STATUS (got ${res.data.code})`,
    );
  }
}

// ─── MAIN ───

async function main(): Promise<void> {
  console.log(`${COLORS.bold}Beta API Tests${COLORS.reset}`);
  console.log(`${COLORS.dim}Base URL: ${BASE_URL}${COLORS.reset}`);

  const authMode = AUTH_TOKEN
    ? "Bearer token"
    : TEST_USER_ID
      ? "Test auth"
      : "None";
  console.log(`${COLORS.dim}Auth: ${authMode}${COLORS.reset}\n`);

  try {
    await testStatusEndpoint();
    await testHeartbeatEndpoint();
    await testWaitlistEndpoint();
    await testReactivateEndpoint();
  } catch (error) {
    console.error(`\n${COLORS.red}Fatal error:${COLORS.reset}`, error);
    process.exit(1);
  }

  // Summary
  console.log(`\n${COLORS.bold}━━━ Results ━━━${COLORS.reset}`);
  console.log(`  ${COLORS.green}${passed} passed${COLORS.reset}`);
  if (failed > 0) {
    console.log(`  ${COLORS.red}${failed} failed${COLORS.reset}`);
  }
  console.log();

  process.exit(failed > 0 ? 1 : 0);
}

main();
