/**
 * Beta Admin Routes — Integration Tests (supertest)
 * Tests: metrics, users list, kick, promote, bulk actions
 *
 * Approach: Minimal Express app with real AdminController + mocked
 * BetaAdminService and auth/admin middleware.
 */

import { afterAll, describe, expect, it, jest, beforeEach } from "@jest/globals";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import request from "supertest";
import { BetaAdminService } from "../../services/admin/betaAdminService.js";
import { redis } from "../../lib/redis.js";

// ─── Mock BetaAdminService ──────────────────────────────────────
const mockGetBetaMetrics = jest.fn();
const mockGetBetaUsers = jest.fn();
const mockKickUser = jest.fn();
const mockPromoteUser = jest.fn();
const mockBulkAction = jest.fn();

(BetaAdminService as Record<string, unknown>).getBetaMetrics = mockGetBetaMetrics;
(BetaAdminService as Record<string, unknown>).getBetaUsers = mockGetBetaUsers;
(BetaAdminService as Record<string, unknown>).kickUser = mockKickUser;
(BetaAdminService as Record<string, unknown>).promoteUser = mockPromoteUser;
(BetaAdminService as Record<string, unknown>).bulkAction = mockBulkAction;

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

// ─── Import real controller ─────────────────────────────────────
import { AdminController } from "../../controllers/adminController.js";

// ─── Test middleware ─────────────────────────────────────────────
function testAuthAndAdmin(req: Request, res: Response, next: NextFunction): void {
  const userHeader = req.headers["x-test-user"] as string | undefined;
  const isAdmin = req.headers["x-test-admin"] === "true";

  if (!userHeader) {
    res.status(401).json({ success: false, error: "Token d'accès requis" });
    return;
  }

  try {
    req.user = JSON.parse(userHeader) as Request["user"];
  } catch {
    res.status(401).json({ success: false, error: "Invalid user" });
    return;
  }

  if (!isAdmin) {
    res.status(403).json({ success: false, error: "Accès administrateur requis" });
    return;
  }

  next();
}

// ─── Build test app ─────────────────────────────────────────────
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(testAuthAndAdmin);

  app.get("/api/admin/beta/metrics", AdminController.getBetaMetrics);
  app.get("/api/admin/beta/users", AdminController.getBetaUsers);
  app.post("/api/admin/beta/users/:userId/kick", AdminController.kickBetaUser);
  app.post("/api/admin/beta/users/:userId/promote", AdminController.promoteBetaUser);
  app.post("/api/admin/beta/bulk", AdminController.bulkBetaAction);

  return app;
}

// ─── Test data ──────────────────────────────────────────────────
const ADMIN_USER = { id: "admin_1", email: "admin@test.com" };
const TARGET_USER = "target_user_1";

function adminHeaders() {
  return {
    "x-test-user": JSON.stringify(ADMIN_USER),
    "x-test-admin": "true",
  };
}

function nonAdminHeaders() {
  return {
    "x-test-user": JSON.stringify({ id: "regular_1", email: "user@test.com" }),
    "x-test-admin": "false",
  };
}

let app: express.Application;

beforeEach(() => {
  jest.clearAllMocks();
  app = createTestApp();
});

afterAll(async () => {
  await redis.disconnect();
});

// ═══════════════════════════════════════════════════════════════
// Auth & Admin Guard
// ═══════════════════════════════════════════════════════════════
describe("Admin auth guard", () => {
  it("should return 401 without auth", async () => {
    const res = await request(app).get("/api/admin/beta/metrics");
    expect(res.status).toBe(401);
  });

  it("should return 403 for non-admin user", async () => {
    const res = await request(app).get("/api/admin/beta/metrics").set(nonAdminHeaders());
    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════
// GET /api/admin/beta/metrics
// ═══════════════════════════════════════════════════════════════
describe("GET /api/admin/beta/metrics", () => {
  const metricsData = {
    cards: {
      spotsUsed: 30,
      totalSpots: 50,
      waitlistCount: 15,
      activeThisWeek: 25,
      inactive7d: 3,
      expired: 2,
    },
    trend: [{ date: "2026-02-28", active: 30, waitlist: 15, newActivations: 2 }],
  };

  it("should return metrics with default period (30)", async () => {
    mockGetBetaMetrics.mockResolvedValue(metricsData);

    const res = await request(app).get("/api/admin/beta/metrics").set(adminHeaders());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.cards.spotsUsed).toBe(30);
    expect(mockGetBetaMetrics).toHaveBeenCalledWith(30);
  });

  it("should accept period=7 query param", async () => {
    mockGetBetaMetrics.mockResolvedValue(metricsData);

    const res = await request(app).get("/api/admin/beta/metrics?period=7").set(adminHeaders());

    expect(res.status).toBe(200);
    expect(mockGetBetaMetrics).toHaveBeenCalledWith(7);
  });

  it("should default to 30 for invalid period", async () => {
    mockGetBetaMetrics.mockResolvedValue(metricsData);

    const res = await request(app).get("/api/admin/beta/metrics?period=99").set(adminHeaders());

    expect(res.status).toBe(200);
    expect(mockGetBetaMetrics).toHaveBeenCalledWith(30);
  });

  it("should return 500 when service throws", async () => {
    mockGetBetaMetrics.mockRejectedValue(new Error("Cache failure"));

    const res = await request(app).get("/api/admin/beta/metrics").set(adminHeaders());

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// GET /api/admin/beta/users
// ═══════════════════════════════════════════════════════════════
describe("GET /api/admin/beta/users", () => {
  const usersData = {
    users: [{ id: "u1", email: "u1@test.com", betaStatus: "active" }],
    total: 1,
    page: 1,
    limit: 20,
    totalPages: 1,
  };

  it("should return paginated users with default params", async () => {
    mockGetBetaUsers.mockResolvedValue(usersData);

    const res = await request(app).get("/api/admin/beta/users").set(adminHeaders());

    expect(res.status).toBe(200);
    expect(res.body.data.users).toHaveLength(1);
    expect(mockGetBetaUsers).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, limit: 20, sortOrder: "desc" }),
    );
  });

  it("should forward search, betaStatus, and sort params", async () => {
    mockGetBetaUsers.mockResolvedValue(usersData);

    const res = await request(app)
      .get(
        "/api/admin/beta/users?search=john&betaStatus=active&sortBy=email&sortOrder=asc&page=2&limit=10",
      )
      .set(adminHeaders());

    expect(res.status).toBe(200);
    expect(mockGetBetaUsers).toHaveBeenCalledWith(
      expect.objectContaining({
        search: "john",
        betaStatus: "active",
        sortBy: "email",
        sortOrder: "asc",
        page: 2,
        limit: 10,
      }),
    );
  });

  it("should return 400 for search term too long", async () => {
    const longSearch = "a".repeat(101);

    const res = await request(app)
      .get(`/api/admin/beta/users?search=${longSearch}`)
      .set(adminHeaders());

    expect(res.status).toBe(400);
    expect(mockGetBetaUsers).not.toHaveBeenCalled();
  });

  it("should handle NaN page/limit gracefully", async () => {
    mockGetBetaUsers.mockResolvedValue(usersData);

    const res = await request(app)
      .get("/api/admin/beta/users?page=abc&limit=xyz")
      .set(adminHeaders());

    expect(res.status).toBe(200);
    expect(mockGetBetaUsers).toHaveBeenCalledWith(expect.objectContaining({ page: 1, limit: 20 }));
  });
});

// ═══════════════════════════════════════════════════════════════
// POST /api/admin/beta/users/:userId/kick
// ═══════════════════════════════════════════════════════════════
describe("POST /api/admin/beta/users/:userId/kick", () => {
  it("should kick a user successfully", async () => {
    mockKickUser.mockResolvedValue({ success: true });

    const res = await request(app)
      .post(`/api/admin/beta/users/${TARGET_USER}/kick`)
      .set(adminHeaders())
      .send({ reason: "Inactive for too long" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockKickUser).toHaveBeenCalledWith(TARGET_USER, ADMIN_USER.id, "Inactive for too long");
  });

  it("should prevent self-kick", async () => {
    const res = await request(app)
      .post(`/api/admin/beta/users/${ADMIN_USER.id}/kick`)
      .set(adminHeaders());

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("vous-même");
    expect(mockKickUser).not.toHaveBeenCalled();
  });

  it("should return 400 when service reports failure", async () => {
    mockKickUser.mockResolvedValue({ success: false, error: "User not active" });

    const res = await request(app)
      .post(`/api/admin/beta/users/${TARGET_USER}/kick`)
      .set(adminHeaders());

    expect(res.status).toBe(400);
  });

  it("should truncate reason to 500 chars", async () => {
    mockKickUser.mockResolvedValue({ success: true });
    const longReason = "x".repeat(600);

    await request(app)
      .post(`/api/admin/beta/users/${TARGET_USER}/kick`)
      .set(adminHeaders())
      .send({ reason: longReason });

    const calledReason = (mockKickUser.mock.calls[0] as unknown[])[2] as string;
    expect(calledReason.length).toBe(500);
  });

  it("should return 500 when service throws", async () => {
    mockKickUser.mockRejectedValue(new Error("DB error"));

    const res = await request(app)
      .post(`/api/admin/beta/users/${TARGET_USER}/kick`)
      .set(adminHeaders());

    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════
// POST /api/admin/beta/users/:userId/promote
// ═══════════════════════════════════════════════════════════════
describe("POST /api/admin/beta/users/:userId/promote", () => {
  it("should promote a user successfully", async () => {
    mockPromoteUser.mockResolvedValue({ success: true });

    const res = await request(app)
      .post(`/api/admin/beta/users/${TARGET_USER}/promote`)
      .set(adminHeaders());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockPromoteUser).toHaveBeenCalledWith(TARGET_USER, ADMIN_USER.id);
  });

  it("should return 400 when no spots available", async () => {
    mockPromoteUser.mockResolvedValue({
      success: false,
      error: "Plus de places beta disponibles",
    });

    const res = await request(app)
      .post(`/api/admin/beta/users/${TARGET_USER}/promote`)
      .set(adminHeaders());

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("places");
  });

  it("should return 500 when service throws", async () => {
    mockPromoteUser.mockRejectedValue(new Error("Serialization failure"));

    const res = await request(app)
      .post(`/api/admin/beta/users/${TARGET_USER}/promote`)
      .set(adminHeaders());

    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════
// POST /api/admin/beta/bulk
// ═══════════════════════════════════════════════════════════════
describe("POST /api/admin/beta/bulk", () => {
  it("should execute bulk kick successfully", async () => {
    const bulkResult = {
      total: 3,
      succeeded: 2,
      failed: 1,
      errors: [{ userId: "u3", error: "Not active" }],
    };
    mockBulkAction.mockResolvedValue(bulkResult);

    const res = await request(app)
      .post("/api/admin/beta/bulk")
      .set(adminHeaders())
      .send({ userIds: ["u1", "u2", "u3"], action: "kick", reason: "Cleanup" });

    expect(res.status).toBe(200);
    expect(res.body.data.succeeded).toBe(2);
    expect(res.body.data.failed).toBe(1);
    expect(mockBulkAction).toHaveBeenCalledWith(
      ["u1", "u2", "u3"],
      "kick",
      ADMIN_USER.id,
      "Cleanup",
    );
  });

  it("should execute bulk promote successfully", async () => {
    mockBulkAction.mockResolvedValue({ total: 2, succeeded: 2, failed: 0, errors: [] });

    const res = await request(app)
      .post("/api/admin/beta/bulk")
      .set(adminHeaders())
      .send({ userIds: ["u1", "u2"], action: "promote" });

    expect(res.status).toBe(200);
    expect(res.body.data.succeeded).toBe(2);
  });

  it("should return 400 for empty userIds", async () => {
    const res = await request(app)
      .post("/api/admin/beta/bulk")
      .set(adminHeaders())
      .send({ userIds: [], action: "kick" });

    expect(res.status).toBe(400);
    expect(mockBulkAction).not.toHaveBeenCalled();
  });

  it("should return 400 for invalid action", async () => {
    const res = await request(app)
      .post("/api/admin/beta/bulk")
      .set(adminHeaders())
      .send({ userIds: ["u1"], action: "delete" });

    expect(res.status).toBe(400);
  });

  it("should return 400 when userIds exceeds 50", async () => {
    const tooManyIds = Array.from({ length: 51 }, (_, i) => `user_${i}`);

    const res = await request(app)
      .post("/api/admin/beta/bulk")
      .set(adminHeaders())
      .send({ userIds: tooManyIds, action: "kick" });

    expect(res.status).toBe(400);
    expect(mockBulkAction).not.toHaveBeenCalled();
  });

  it("should return 400 when body is missing", async () => {
    const res = await request(app).post("/api/admin/beta/bulk").set(adminHeaders());

    expect(res.status).toBe(400);
  });

  it("should return 500 when service throws", async () => {
    mockBulkAction.mockRejectedValue(new Error("Bulk operation failed"));

    const res = await request(app)
      .post("/api/admin/beta/bulk")
      .set(adminHeaders())
      .send({ userIds: ["u1"], action: "kick" });

    expect(res.status).toBe(500);
  });
});
