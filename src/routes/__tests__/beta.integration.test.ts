/**
 * Beta Public Routes — Integration Tests (supertest)
 * Tests the full HTTP layer: route → middleware → controller → (mocked) service
 *
 * Approach: We build a minimal Express app that wires the real controllers
 * with test middleware, then mock BetaService at the module level.
 */

import { afterAll, describe, expect, it, jest, beforeEach } from "@jest/globals";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import request from "supertest";
import { BetaService } from "../../services/BetaService.js";
import { redis } from "../../lib/redis.js";

// ─── Mock BetaService ───────────────────────────────────────────
const mockGetStatus = jest.fn();
const mockRecordHeartbeat = jest.fn();
const mockAddToWaitlist = jest.fn();
const mockReactivateUser = jest.fn();

(BetaService as Record<string, unknown>).getStatus = mockGetStatus;
(BetaService as Record<string, unknown>).recordHeartbeat = mockRecordHeartbeat;
(BetaService as Record<string, unknown>).addToWaitlist = mockAddToWaitlist;
(BetaService as Record<string, unknown>).reactivateUser = mockReactivateUser;

// ─── Suppress logger ────────────────────────────────────────────
jest.unstable_mockModule("../../utils/logger.js", () => ({
  logger: {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

// ─── Import real controllers ────────────────────────────────────
import {
  StatusController,
  HeartbeatController,
  WaitlistController,
  ReactivateController,
} from "../../controllers/beta/index.js";

// ─── Test middleware ─────────────────────────────────────────────
function testOptionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const userHeader = req.headers["x-test-user"] as string | undefined;
  if (userHeader) {
    try {
      req.user = JSON.parse(userHeader) as Request["user"];
    } catch {
      /* ignore */
    }
  }
  next();
}

function testAuthenticateToken(req: Request, res: Response, next: NextFunction): void {
  const userHeader = req.headers["x-test-user"] as string | undefined;
  if (userHeader) {
    try {
      req.user = JSON.parse(userHeader) as Request["user"];
      next();
      return;
    } catch {
      /* fall through */
    }
  }
  res.status(401).json({ success: false, error: "Token d'accès requis", code: "MISSING_TOKEN" });
}

function passthrough(_req: Request, _res: Response, next: NextFunction): void {
  next();
}

// ─── Build test app ─────────────────────────────────────────────
function createTestApp() {
  const app = express();
  app.use(express.json());

  app.get("/api/beta/status", testOptionalAuth, StatusController.getStatus);
  app.post(
    "/api/beta/heartbeat",
    testAuthenticateToken,
    passthrough,
    HeartbeatController.recordHeartbeat,
  );
  app.post("/api/beta/waitlist", passthrough, testOptionalAuth, WaitlistController.addToWaitlist);
  app.post("/api/beta/reactivate", testAuthenticateToken, ReactivateController.reactivate);

  return app;
}

// ─── Test data ──────────────────────────────────────────────────
const TEST_USER = { id: "user_int_1", email: "int1@test.com" };
const TEST_USER_2 = { id: "user_int_2", email: "int2@test.com" };

let app: express.Application;

beforeEach(() => {
  jest.clearAllMocks();
  app = createTestApp();
});

afterAll(async () => {
  await redis.disconnect();
});

// ═══════════════════════════════════════════════════════════════
// GET /api/beta/status
// ═══════════════════════════════════════════════════════════════
describe("GET /api/beta/status", () => {
  it("should return 200 with public status (no auth)", async () => {
    mockGetStatus.mockResolvedValue({ spotsRemaining: 10, totalSpots: 50 });

    const res = await request(app).get("/api/beta/status");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.spotsRemaining).toBe(10);
    expect(mockGetStatus).toHaveBeenCalledWith(undefined);
  });

  it("should return user-specific status with auth", async () => {
    mockGetStatus.mockResolvedValue({
      spotsRemaining: 10,
      totalSpots: 50,
      userStatus: "active",
    });

    const res = await request(app)
      .get("/api/beta/status")
      .set("x-test-user", JSON.stringify(TEST_USER));

    expect(res.status).toBe(200);
    expect(res.body.data.userStatus).toBe("active");
    expect(mockGetStatus).toHaveBeenCalledWith("user_int_1");
  });

  it("should return 500 when service throws", async () => {
    mockGetStatus.mockRejectedValue(new Error("DB unavailable"));

    const res = await request(app).get("/api/beta/status");

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });

  it("should return correct Content-Type header", async () => {
    mockGetStatus.mockResolvedValue({ spotsRemaining: 5, totalSpots: 50 });

    const res = await request(app).get("/api/beta/status");

    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });
});

// ═══════════════════════════════════════════════════════════════
// POST /api/beta/heartbeat
// ═══════════════════════════════════════════════════════════════
describe("POST /api/beta/heartbeat", () => {
  it("should return 401 without auth", async () => {
    const res = await request(app).post("/api/beta/heartbeat");

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("MISSING_TOKEN");
    expect(mockRecordHeartbeat).not.toHaveBeenCalled();
  });

  it("should return 200 with valid auth", async () => {
    mockRecordHeartbeat.mockResolvedValue(undefined);

    const res = await request(app)
      .post("/api/beta/heartbeat")
      .set("x-test-user", JSON.stringify(TEST_USER));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockRecordHeartbeat).toHaveBeenCalledWith("user_int_1");
  });

  it("should return 500 when service throws", async () => {
    mockRecordHeartbeat.mockRejectedValue(new Error("Redis timeout"));

    const res = await request(app)
      .post("/api/beta/heartbeat")
      .set("x-test-user", JSON.stringify(TEST_USER));

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// POST /api/beta/waitlist
// ═══════════════════════════════════════════════════════════════
describe("POST /api/beta/waitlist", () => {
  it("should return 201 with valid email and name (no auth)", async () => {
    mockAddToWaitlist.mockResolvedValue({ position: 5, isOwned: false });

    const res = await request(app)
      .post("/api/beta/waitlist")
      .send({ email: "test@example.com", name: "Test User" });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.position).toBeUndefined();
  });

  it("should return 400 when email is missing", async () => {
    const res = await request(app).post("/api/beta/waitlist").send({ name: "Test User" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("MISSING_FIELDS");
  });

  it("should return 400 when name is missing", async () => {
    const res = await request(app).post("/api/beta/waitlist").send({ email: "test@example.com" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("MISSING_FIELDS");
  });

  it("should return 400 for invalid email format", async () => {
    const res = await request(app)
      .post("/api/beta/waitlist")
      .send({ email: "not-an-email", name: "Test" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_EMAIL");
  });

  it("should return 400 for name too short", async () => {
    const res = await request(app)
      .post("/api/beta/waitlist")
      .send({ email: "test@example.com", name: "A" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_NAME_LENGTH");
  });

  it("should return 400 for invalid phone format", async () => {
    const res = await request(app)
      .post("/api/beta/waitlist")
      .send({ email: "test@example.com", name: "Test User", phone: "!!!invalid!!!" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_PHONE");
  });

  it("should expose position only for authenticated owner", async () => {
    mockAddToWaitlist.mockResolvedValue({ position: 3, isOwned: true });

    const res = await request(app)
      .post("/api/beta/waitlist")
      .set("x-test-user", JSON.stringify(TEST_USER))
      .send({ email: TEST_USER.email, name: "Test User" });

    expect(res.status).toBe(201);
    expect(res.body.position).toBe(3);
  });

  it("should NOT expose position for unauthenticated user (anti-enumeration)", async () => {
    mockAddToWaitlist.mockResolvedValue({ position: 3, isOwned: false });

    const res = await request(app)
      .post("/api/beta/waitlist")
      .send({ email: "test@example.com", name: "Test User" });

    expect(res.status).toBe(201);
    expect(res.body.position).toBeUndefined();
  });

  it("should return indistinguishable 201 for rejected duplicates (BM-002)", async () => {
    mockAddToWaitlist.mockResolvedValue({ rejected: true });

    const res = await request(app)
      .post("/api/beta/waitlist")
      .send({ email: "duplicate@example.com", name: "Dupe User" });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.position).toBeUndefined();
  });

  it("should return 400 for authenticated user without email", async () => {
    const noEmailUser = { id: "user_no_email" };

    const res = await request(app)
      .post("/api/beta/waitlist")
      .set("x-test-user", JSON.stringify(noEmailUser))
      .send({ email: "whatever@example.com", name: "Test User" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("MISSING_USER_EMAIL");
  });

  it("should sanitize HTML in name field", async () => {
    mockAddToWaitlist.mockResolvedValue({ position: 1, isOwned: false });

    const res = await request(app)
      .post("/api/beta/waitlist")
      .send({ email: "test@example.com", name: "<script>alert(1)</script>Clean Name" });

    expect(res.status).toBe(201);
    if (mockAddToWaitlist.mock.calls.length > 0) {
      const calledName = (mockAddToWaitlist.mock.calls[0] as unknown[])[0] as Record<
        string,
        unknown
      >;
      expect(calledName.name).not.toContain("<script>");
    }
  });

  it("should return 500 when service throws", async () => {
    mockAddToWaitlist.mockRejectedValue(new Error("DB write failed"));

    const res = await request(app)
      .post("/api/beta/waitlist")
      .send({ email: "test@example.com", name: "Test User" });

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// POST /api/beta/reactivate
// ═══════════════════════════════════════════════════════════════
describe("POST /api/beta/reactivate", () => {
  it("should return 401 without auth", async () => {
    const res = await request(app).post("/api/beta/reactivate");

    expect(res.status).toBe(401);
    expect(mockReactivateUser).not.toHaveBeenCalled();
  });

  it("should return 200 on successful reactivation", async () => {
    mockReactivateUser.mockResolvedValue({ success: true });

    const res = await request(app)
      .post("/api/beta/reactivate")
      .set("x-test-user", JSON.stringify(TEST_USER));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockReactivateUser).toHaveBeenCalledWith("user_int_1");
  });

  it("should return 403 when no spots available", async () => {
    mockReactivateUser.mockResolvedValue({
      success: false,
      error: "No spots",
      code: "NO_SPOTS_AVAILABLE",
    });

    const res = await request(app)
      .post("/api/beta/reactivate")
      .set("x-test-user", JSON.stringify(TEST_USER));

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NO_SPOTS_AVAILABLE");
  });

  it("should return 400 for invalid status", async () => {
    mockReactivateUser.mockResolvedValue({
      success: false,
      error: "Bad status",
      code: "INVALID_STATUS",
    });

    const res = await request(app)
      .post("/api/beta/reactivate")
      .set("x-test-user", JSON.stringify(TEST_USER));

    expect(res.status).toBe(400);
  });

  it("should return 500 when service throws", async () => {
    mockReactivateUser.mockRejectedValue(new Error("Deadlock"));

    const res = await request(app)
      .post("/api/beta/reactivate")
      .set("x-test-user", JSON.stringify(TEST_USER));

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});
