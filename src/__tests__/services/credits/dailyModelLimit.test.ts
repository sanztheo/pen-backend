import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRedis = vi.hoisted(() => ({
  get: vi.fn(),
  // redis.eval for Lua script
  eval: vi.fn(),
}));

vi.mock("../../../lib/redis.js", () => ({ redis: mockRedis }));
vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { DailyModelLimitService } from "../../../services/credits/dailyModelLimit.js";

describe("DailyModelLimitService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("checkAndIncrement (atomic Lua)", () => {
    it("allows and increments when under limit", async () => {
      // Lua returns [1, remaining]
      mockRedis.eval.mockResolvedValue([1, 45]);
      const result = await DailyModelLimitService.checkAndIncrement("user1", 5);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(45);
      expect(mockRedis.eval).toHaveBeenCalledTimes(1);
    });

    it("blocks when limit would be exceeded", async () => {
      // Lua returns [0, remaining_before_attempt]
      mockRedis.eval.mockResolvedValue([0, 2]);
      const result = await DailyModelLimitService.checkAndIncrement("user1", 5);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(2);
    });

    it("fails open on Redis error", async () => {
      mockRedis.eval.mockRejectedValue(new Error("Redis down"));
      const result = await DailyModelLimitService.checkAndIncrement("user1", 5);
      expect(result.allowed).toBe(true); // fail open
      expect(result.dailyLimit).toBe(100);
    });
  });

  describe("checkDailyLimit (read-only)", () => {
    it("allows when under limit", async () => {
      mockRedis.get.mockResolvedValue("50");
      const result = await DailyModelLimitService.checkDailyLimit("user1", 5);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(50);
    });

    it("blocks when would exceed", async () => {
      mockRedis.get.mockResolvedValue("98");
      const result = await DailyModelLimitService.checkDailyLimit("user1", 5);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(2);
    });

    it("handles null (no previous usage)", async () => {
      mockRedis.get.mockResolvedValue(null);
      const result = await DailyModelLimitService.checkDailyLimit("user1", 3);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(100);
    });
  });
});
