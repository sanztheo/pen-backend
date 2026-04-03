/**
 * Mem0 Client Tests
 * Covers: search, add, error handling, disabled state
 */

import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { searchMemories, addMemories, logMem0Status } from "../mem0/mem0Client.js";

// ─── Mock fetch ─────────────────────────────────────────────────
const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
global.fetch = mockFetch;

// ─── Mock logger ────────────────────────────────────────────────
jest.mock("../../utils/logger.js", () => ({
  logger: {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe("mem0Client", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe("when MEMO env var is not set", () => {
    const originalMemo = process.env.MEMO;

    beforeEach(() => {
      delete process.env.MEMO;
    });

    afterEach(() => {
      if (originalMemo) process.env.MEMO = originalMemo;
    });

    // Need to use dynamic import to re-evaluate isEnabled()
    // Since the module reads env at call time via getApiKey(), these tests work directly

    it("searchMemories returns empty array", async () => {
      const result = await searchMemories("user1", "test query");
      expect(result).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("addMemories returns null", async () => {
      const result = await addMemories("user1", [{ role: "user", content: "hello" }]);
      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("logMem0Status does not throw", () => {
      expect(() => logMem0Status()).not.toThrow();
    });
  });

  describe("when MEMO env var is set", () => {
    beforeEach(() => {
      process.env.MEMO = "test-api-key";
    });

    afterEach(() => {
      delete process.env.MEMO;
    });

    describe("searchMemories", () => {
      it("returns memories on success", async () => {
        const mockMemories = [
          {
            id: "m1",
            memory: "User studies math",
            user_id: "user1",
            created_at: "",
            updated_at: "",
          },
          {
            id: "m2",
            memory: "User prefers dark mode",
            user_id: "user1",
            created_at: "",
            updated_at: "",
          },
        ];

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => mockMemories,
        } as Response);

        const result = await searchMemories("user1", "what does user like?");

        expect(result).toEqual(mockMemories);
        expect(mockFetch).toHaveBeenCalledWith(
          "https://api.mem0.ai/v2/memories/search/",
          expect.objectContaining({
            method: "POST",
            headers: expect.objectContaining({
              Authorization: "Token test-api-key",
            }),
          }),
        );

        const body = JSON.parse((mockFetch.mock.calls[0]?.[1] as RequestInit)?.body as string);
        expect(body.query).toBe("what does user like?");
        expect(body.filters.user_id).toBe("pennote:user1");
        expect(body.top_k).toBe(5);
      });

      it("returns empty array on HTTP error", async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
        } as Response);

        const result = await searchMemories("user1", "query");
        expect(result).toEqual([]);
      });

      it("returns empty array on network error", async () => {
        mockFetch.mockRejectedValueOnce(new Error("Network timeout"));

        const result = await searchMemories("user1", "query");
        expect(result).toEqual([]);
      });
    });

    describe("addMemories", () => {
      it("stores memories on success", async () => {
        const mockResponse = [{ id: "m1", event: "ADD", data: { memory: "User likes math" } }];

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => mockResponse,
        } as Response);

        const result = await addMemories("user1", [
          { role: "user", content: "I love math" },
          { role: "assistant", content: "Great!" },
        ]);

        expect(result).toEqual(mockResponse);
        expect(mockFetch).toHaveBeenCalledWith(
          "https://api.mem0.ai/v1/memories/",
          expect.objectContaining({
            method: "POST",
          }),
        );

        const body = JSON.parse((mockFetch.mock.calls[0]?.[1] as RequestInit)?.body as string);
        expect(body.messages).toHaveLength(2);
        expect(body.user_id).toBe("pennote:user1");
        expect(body.infer).toBe(true);
      });

      it("returns null on HTTP error", async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 400,
          statusText: "Bad Request",
        } as Response);

        const result = await addMemories("user1", [{ role: "user", content: "test" }]);
        expect(result).toBeNull();
      });

      it("returns null on network error", async () => {
        mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

        const result = await addMemories("user1", [{ role: "user", content: "test" }]);
        expect(result).toBeNull();
      });
    });
  });
});
