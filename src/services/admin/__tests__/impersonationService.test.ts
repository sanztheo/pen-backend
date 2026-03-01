/**
 * ImpersonationService Tests
 * Covers: startImpersonation, endImpersonation, verifyImpersonationToken
 */

import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { ImpersonationService } from "../impersonationService.js";
import { prisma } from "../../../lib/prisma.js";
import { redis } from "../../../lib/redis.js";

// Set required env var
process.env.IMPERSONATION_JWT_SECRET = "test-secret-for-jwt-impersonation-tests";

// ─── Prisma Mocks ───────────────────────────────────────────────
const mockUserFindUnique = jest.fn();
const mockActivityLogCreate = jest.fn();

(prisma.user as unknown as Record<string, jest.Mock>).findUnique = mockUserFindUnique;
(prisma.activityLog as unknown as Record<string, jest.Mock>).create = mockActivityLogCreate;

// ─── Redis Mocks ────────────────────────────────────────────────
const mockRedisExists = jest.fn();
const mockRedisSetex = jest.fn();
const mockRedisGet = jest.fn();
const mockRedisDel = jest.fn();

(redis as unknown as Record<string, jest.Mock>).exists = mockRedisExists;
(redis as unknown as Record<string, jest.Mock>).setex = mockRedisSetex;
(redis as unknown as Record<string, jest.Mock>).get = mockRedisGet;
(redis as unknown as Record<string, jest.Mock>).del = mockRedisDel;

// ─── Suppress logger output in tests ────────────────────────────
jest.unstable_mockModule("../../../utils/logger.js", () => ({
  logger: {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockRedisExists.mockResolvedValue(0);
  mockRedisSetex.mockResolvedValue("OK");
  mockRedisDel.mockResolvedValue(1);
  mockActivityLogCreate.mockResolvedValue({});
});

// ═══════════════════════════════════════════════════════════════
// startImpersonation
// ═══════════════════════════════════════════════════════════════
describe("ImpersonationService.startImpersonation", () => {
  const adminUser = { id: "admin-1", email: "admin@test.com", isAdmin: true };
  const targetUser = {
    id: "user-1",
    email: "user@test.com",
    firstName: "John",
    lastName: "Doe",
    isAdmin: false,
  };

  it("should succeed and return token + targetUser", async () => {
    mockUserFindUnique
      .mockResolvedValueOnce(adminUser) // admin lookup
      .mockResolvedValueOnce(targetUser); // target lookup

    const result = await ImpersonationService.startImpersonation("admin-1", "user-1");

    expect(result.success).toBe(true);
    expect(result.token).toBeDefined();
    expect(typeof result.token).toBe("string");
    expect(result.targetUser).toEqual({
      id: "user-1",
      email: "user@test.com",
      firstName: "John",
      lastName: "Doe",
    });
    expect(result.expiresAt).toBeDefined();
    expect(mockRedisSetex).toHaveBeenCalled();
    expect(mockActivityLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "ADMIN_IMPERSONATION_START",
          entityType: "user",
          entityId: "user-1",
        }),
      }),
    );
  });

  it("should block self-impersonation", async () => {
    const result = await ImpersonationService.startImpersonation("admin-1", "admin-1");

    expect(result.success).toBe(false);
    expect(result.error).toContain("soi-même");
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });

  it("should reject when admin is not actually an admin", async () => {
    mockUserFindUnique
      .mockResolvedValueOnce({ id: "user-2", email: "user2@test.com", isAdmin: false })
      .mockResolvedValueOnce(targetUser);

    const result = await ImpersonationService.startImpersonation("user-2", "user-1");

    expect(result.success).toBe(false);
    expect(result.error).toContain("admin requis");
  });

  it("should reject when target user not found", async () => {
    mockUserFindUnique.mockResolvedValueOnce(adminUser).mockResolvedValueOnce(null);

    const result = await ImpersonationService.startImpersonation("admin-1", "nonexistent");

    expect(result.success).toBe(false);
    expect(result.error).toContain("non trouvé");
  });

  it("should reject impersonating another admin", async () => {
    mockUserFindUnique.mockResolvedValueOnce(adminUser).mockResolvedValueOnce({
      id: "admin-2",
      email: "admin2@test.com",
      firstName: "Jane",
      lastName: "Admin",
      isAdmin: true,
    });

    const result = await ImpersonationService.startImpersonation("admin-1", "admin-2");

    expect(result.success).toBe(false);
    expect(result.error).toContain("autre admin");
  });

  it("should reject when an active impersonation session already exists", async () => {
    mockRedisExists.mockResolvedValue(1); // session exists
    mockUserFindUnique.mockResolvedValueOnce(adminUser).mockResolvedValueOnce(targetUser);

    const result = await ImpersonationService.startImpersonation("admin-1", "user-1");

    expect(result.success).toBe(false);
    expect(result.error).toContain("déjà active");
  });

  it("should generate a valid JWT token with correct claims", async () => {
    mockUserFindUnique.mockResolvedValueOnce(adminUser).mockResolvedValueOnce(targetUser);

    const result = await ImpersonationService.startImpersonation("admin-1", "user-1");

    expect(result.success).toBe(true);
    // Verify the token is valid
    const payload = ImpersonationService.verifyImpersonationToken(result.token!);
    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe("user-1");
    expect(payload!.adminId).toBe("admin-1");
    expect(payload!.type).toBe("impersonation");
  });
});

// ═══════════════════════════════════════════════════════════════
// endImpersonation
// ═══════════════════════════════════════════════════════════════
describe("ImpersonationService.endImpersonation", () => {
  it("should end an active session", async () => {
    const session = {
      adminId: "admin-1",
      adminEmail: "admin@test.com",
      targetUserId: "user-1",
      targetEmail: "user@test.com",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 900000).toISOString(),
    };
    mockRedisGet.mockResolvedValue(JSON.stringify(session));

    const result = await ImpersonationService.endImpersonation("admin-1");

    expect(result.success).toBe(true);
    expect(mockRedisDel).toHaveBeenCalledWith("admin:impersonate:admin-1");
    expect(mockActivityLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "ADMIN_IMPERSONATION_END",
          entityType: "user",
          entityId: "user-1",
        }),
      }),
    );
  });

  it("should return error when no active session", async () => {
    mockRedisGet.mockResolvedValue(null);

    const result = await ImpersonationService.endImpersonation("admin-1");

    expect(result.success).toBe(false);
    expect(result.error).toContain("Aucune session");
    expect(mockRedisDel).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
// verifyImpersonationToken
// ═══════════════════════════════════════════════════════════════
describe("ImpersonationService.verifyImpersonationToken", () => {
  it("should return null for invalid token", () => {
    const result = ImpersonationService.verifyImpersonationToken("invalid-token");

    expect(result).toBeNull();
  });

  it("should return null for empty string", () => {
    const result = ImpersonationService.verifyImpersonationToken("");

    expect(result).toBeNull();
  });
});
