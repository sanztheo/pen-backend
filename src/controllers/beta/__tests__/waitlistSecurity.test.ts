/**
 * Waitlist Security Tests
 * Covers: Stored XSS prevention, Prototype Pollution prevention
 */

import {
  afterAll,
  describe,
  expect,
  it,
  jest,
  beforeEach,
} from "@jest/globals";
import type { Request, Response } from "express";
import { WaitlistController } from "../waitlistController.js";
import { BetaService } from "../../../services/BetaService.js";
import { redis } from "../../../lib/redis.js";
import { stripHtmlTags, sanitizeObjectKeys } from "../../../utils/sanitize.js";

// ─── Mock BetaService ───────────────────────────────────────────
const mockAddToWaitlist = jest.fn();
(BetaService as any).addToWaitlist = mockAddToWaitlist;

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

// ─── Test Helpers ───────────────────────────────────────────────
interface MockResponse {
  status: jest.Mock;
  json: jest.Mock;
}

const createMockResponse = (): MockResponse => {
  const res: MockResponse = {
    status: jest.fn(),
    json: jest.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
};

const createMockRequest = (
  body: Record<string, unknown> = {},
  userId?: string,
  userEmail?: string,
): Partial<Request> => ({
  body,
  user: userId
    ? ({
        id: userId,
        email: userEmail ?? `${userId}@test.com`,
      } as Request["user"])
    : undefined,
});

const SUCCESS_RESULT = {
  position: 1,
  alreadyExists: false,
  rejected: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAddToWaitlist.mockResolvedValue(SUCCESS_RESULT);
});

afterAll(async () => {
  await redis.disconnect();
});

// ═══════════════════════════════════════════════════════════════
// Unit Tests: stripHtmlTags
// ═══════════════════════════════════════════════════════════════
describe("stripHtmlTags — Unit", () => {
  it("should strip <script> tags", () => {
    expect(stripHtmlTags('<script>alert("xss")</script>')).toBe('alert("xss")');
  });

  it("should strip <img onerror=...> tags", () => {
    expect(stripHtmlTags('<img onerror="alert(1)" src="x">')).toBe("");
  });

  it("should strip nested tags", () => {
    expect(stripHtmlTags("<b><script>alert(1)</script></b>")).toBe("alert(1)");
  });

  it("should strip self-closing tags", () => {
    expect(stripHtmlTags("hello<br/>world")).toBe("helloworld");
  });

  it("should strip <iframe> tags", () => {
    expect(stripHtmlTags('<iframe src="evil.com"></iframe>')).toBe("");
  });

  it("should preserve normal text with accents and special chars", () => {
    expect(stripHtmlTags("Jean-François O'Brien")).toBe(
      "Jean-François O'Brien",
    );
  });

  it("should preserve text with no HTML", () => {
    expect(stripHtmlTags("Hello World")).toBe("Hello World");
  });

  it("should handle empty string", () => {
    expect(stripHtmlTags("")).toBe("");
  });

  it("should strip multiple tags in sequence", () => {
    expect(stripHtmlTags("<b>bold</b> and <i>italic</i>")).toBe(
      "bold and italic",
    );
  });

  it("should strip unclosed tags (missing closing bracket)", () => {
    expect(stripHtmlTags("<script")).toBe("");
    expect(stripHtmlTags("hello<img src=x onerror=alert(1)")).toBe("hello");
  });
});

// ═══════════════════════════════════════════════════════════════
// Unit Tests: sanitizeObjectKeys
// ═══════════════════════════════════════════════════════════════
describe("sanitizeObjectKeys — Unit", () => {
  it("should remove __proto__ key", () => {
    const result = sanitizeObjectKeys(
      Object.assign(Object.create(null), {
        __proto__: { isAdmin: true },
        safe: "value",
      }),
    );
    expect(result).toEqual({ safe: "value" });
    expect(Object.hasOwn(result, "__proto__")).toBe(false);
  });

  it("should remove constructor key", () => {
    const input = Object.assign(Object.create(null), {
      constructor: { polluted: true },
      name: "test",
    });
    const result = sanitizeObjectKeys(input);
    expect(result).toEqual({ name: "test" });
    expect(Object.hasOwn(result, "constructor")).toBe(false);
  });

  it("should remove prototype key", () => {
    const input = Object.assign(Object.create(null), {
      prototype: { hack: true },
      data: "ok",
    });
    const result = sanitizeObjectKeys(input);
    expect(result).toEqual({ data: "ok" });
    expect(Object.hasOwn(result, "prototype")).toBe(false);
  });

  it("should remove nested __proto__ recursively", () => {
    const input = {
      level1: {
        __proto__: { isAdmin: true },
        safe: "nested",
      },
    };
    // Use Object.create(null) to bypass JS prototype handling
    const nested = Object.assign(Object.create(null), {
      __proto__: { isAdmin: true },
      safe: "nested",
    });
    const obj = { level1: nested };
    const result = sanitizeObjectKeys(obj);
    expect(result).toEqual({ level1: { safe: "nested" } });
  });

  it("should preserve all normal keys", () => {
    const input = {
      source: "website",
      campaign: "launch",
      referral: "friend",
    };
    const result = sanitizeObjectKeys(input);
    expect(result).toEqual(input);
  });

  it("should preserve arrays without recursing into them", () => {
    const input = { tags: ["a", "b"], name: "test" };
    const result = sanitizeObjectKeys(input);
    expect(result).toEqual({ tags: ["a", "b"], name: "test" });
  });

  it("should handle empty object", () => {
    expect(sanitizeObjectKeys({})).toEqual({});
  });

  it("should handle null values without crashing", () => {
    const input = { note: null, safe: "value" };
    const result = sanitizeObjectKeys(input as Record<string, unknown>);
    expect(result).toEqual({ note: null, safe: "value" });
  });

  it("should remove __defineGetter__ key", () => {
    const input = Object.assign(Object.create(null), {
      __defineGetter__: "evil",
      safe: "value",
    });
    const result = sanitizeObjectKeys(input);
    expect(Object.hasOwn(result, "__defineGetter__")).toBe(false);
    expect(result).toEqual({ safe: "value" });
  });

  it("should remove __defineSetter__ key", () => {
    const input = Object.assign(Object.create(null), {
      __defineSetter__: "evil",
      safe: "value",
    });
    const result = sanitizeObjectKeys(input);
    expect(Object.hasOwn(result, "__defineSetter__")).toBe(false);
    expect(result).toEqual({ safe: "value" });
  });

  it("should handle deeply nested dangerous keys", () => {
    const deep = Object.assign(Object.create(null), {
      __proto__: { x: 1 },
      ok: "deep",
    });
    const mid = { inner: deep, constructor: "bad" };
    const midSafe = Object.assign(Object.create(null), mid);
    const result = sanitizeObjectKeys({ outer: midSafe });
    expect(result).toEqual({ outer: { inner: { ok: "deep" } } });
  });
});

// ═══════════════════════════════════════════════════════════════
// Integration: XSS prevention via controller
// ═══════════════════════════════════════════════════════════════
describe("WaitlistController — XSS Prevention", () => {
  it("should strip <script> tags from name before storage", async () => {
    const req = createMockRequest({
      email: "xss@test.com",
      name: '<script>alert("xss")</script>John',
    });
    const res = createMockResponse();

    await WaitlistController.addToWaitlist(
      req as Request,
      res as unknown as Response,
    );

    expect(res.status).toHaveBeenCalledWith(201);
    const storedName = mockAddToWaitlist.mock.calls[0]?.[0]?.name;
    expect(storedName).toBe('alert("xss")John');
    expect(storedName).not.toContain("<script>");
  });

  it("should strip <img onerror=...> from name", async () => {
    const req = createMockRequest({
      email: "xss2@test.com",
      name: 'Test<img onerror="alert(1)" src="x">User',
    });
    const res = createMockResponse();

    await WaitlistController.addToWaitlist(
      req as Request,
      res as unknown as Response,
    );

    expect(res.status).toHaveBeenCalledWith(201);
    const storedName = mockAddToWaitlist.mock.calls[0]?.[0]?.name;
    expect(storedName).toBe("TestUser");
  });

  it("should strip nested HTML tags from name", async () => {
    const req = createMockRequest({
      email: "xss3@test.com",
      name: "<b><script>document.cookie</script></b>Safe",
    });
    const res = createMockResponse();

    await WaitlistController.addToWaitlist(
      req as Request,
      res as unknown as Response,
    );

    expect(res.status).toHaveBeenCalledWith(201);
    const storedName = mockAddToWaitlist.mock.calls[0]?.[0]?.name;
    expect(storedName).toBe("document.cookieSafe");
    expect(storedName).not.toContain("<");
  });

  it("should preserve accented characters and valid special chars", async () => {
    const req = createMockRequest({
      email: "valid@test.com",
      name: "Jean-François O'Brien",
    });
    const res = createMockResponse();

    await WaitlistController.addToWaitlist(
      req as Request,
      res as unknown as Response,
    );

    expect(res.status).toHaveBeenCalledWith(201);
    const storedName = mockAddToWaitlist.mock.calls[0]?.[0]?.name;
    expect(storedName).toBe("Jean-François O'Brien");
  });

  it("should reject name that becomes too short after stripping", async () => {
    // "<b>A</b>" → "A" (1 char) → below 2 char minimum
    const req = createMockRequest({
      email: "short@test.com",
      name: "<b>A</b>",
    });
    const res = createMockResponse();

    await WaitlistController.addToWaitlist(
      req as Request,
      res as unknown as Response,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "INVALID_NAME_LENGTH" }),
    );
    expect(mockAddToWaitlist).not.toHaveBeenCalled();
  });

  it("should reject name that is only HTML tags", async () => {
    // "<script></script>" → "" (empty) → missing name
    const req = createMockRequest({
      email: "empty@test.com",
      name: "<script></script>",
    });
    const res = createMockResponse();

    await WaitlistController.addToWaitlist(
      req as Request,
      res as unknown as Response,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockAddToWaitlist).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
// Integration: Prototype Pollution prevention via controller
// ═══════════════════════════════════════════════════════════════
describe("WaitlistController — Prototype Pollution Prevention", () => {
  it("should strip __proto__ from metadata", async () => {
    const maliciousMetadata = Object.assign(Object.create(null), {
      __proto__: { isAdmin: true },
      source: "website",
    });
    const req = createMockRequest({
      email: "proto@test.com",
      name: "Proto Test",
      metadata: maliciousMetadata,
    });
    const res = createMockResponse();

    await WaitlistController.addToWaitlist(
      req as Request,
      res as unknown as Response,
    );

    expect(res.status).toHaveBeenCalledWith(201);
    const storedMetadata = mockAddToWaitlist.mock.calls[0]?.[0]?.metadata;
    expect(Object.hasOwn(storedMetadata, "__proto__")).toBe(false);
    expect(storedMetadata).toHaveProperty("source", "website");
  });

  it("should strip constructor from metadata", async () => {
    const maliciousMetadata = Object.assign(Object.create(null), {
      constructor: { polluted: true },
      campaign: "beta",
    });
    const req = createMockRequest({
      email: "ctor@test.com",
      name: "Constructor Test",
      metadata: maliciousMetadata,
    });
    const res = createMockResponse();

    await WaitlistController.addToWaitlist(
      req as Request,
      res as unknown as Response,
    );

    expect(res.status).toHaveBeenCalledWith(201);
    const storedMetadata = mockAddToWaitlist.mock.calls[0]?.[0]?.metadata;
    expect(Object.hasOwn(storedMetadata, "constructor")).toBe(false);
    expect(storedMetadata).toHaveProperty("campaign", "beta");
  });

  it("should strip prototype from metadata", async () => {
    const maliciousMetadata = Object.assign(Object.create(null), {
      prototype: { hack: true },
      referral: "friend",
    });
    const req = createMockRequest({
      email: "prototype@test.com",
      name: "Prototype Test",
      metadata: maliciousMetadata,
    });
    const res = createMockResponse();

    await WaitlistController.addToWaitlist(
      req as Request,
      res as unknown as Response,
    );

    expect(res.status).toHaveBeenCalledWith(201);
    const storedMetadata = mockAddToWaitlist.mock.calls[0]?.[0]?.metadata;
    expect(Object.hasOwn(storedMetadata, "prototype")).toBe(false);
    expect(storedMetadata).toHaveProperty("referral", "friend");
  });

  it("should strip nested dangerous keys recursively", async () => {
    const nested = Object.assign(Object.create(null), {
      __proto__: { isAdmin: true },
      safe: "nested-value",
    });
    const req = createMockRequest({
      email: "nested@test.com",
      name: "Nested Test",
      metadata: { level1: nested },
    });
    const res = createMockResponse();

    await WaitlistController.addToWaitlist(
      req as Request,
      res as unknown as Response,
    );

    expect(res.status).toHaveBeenCalledWith(201);
    const storedMetadata = mockAddToWaitlist.mock.calls[0]?.[0]?.metadata;
    const level1 = storedMetadata?.level1 as Record<string, unknown>;
    expect(Object.hasOwn(level1, "__proto__")).toBe(false);
    expect(level1).toHaveProperty("safe", "nested-value");
  });

  it("should preserve normal metadata keys", async () => {
    const req = createMockRequest({
      email: "normal@test.com",
      name: "Normal Test",
      metadata: { source: "website", campaign: "launch", referral: "friend" },
    });
    const res = createMockResponse();

    await WaitlistController.addToWaitlist(
      req as Request,
      res as unknown as Response,
    );

    expect(res.status).toHaveBeenCalledWith(201);
    const storedMetadata = mockAddToWaitlist.mock.calls[0]?.[0]?.metadata;
    expect(storedMetadata).toEqual({
      source: "website",
      campaign: "launch",
      referral: "friend",
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// Integration: Combined XSS + Prototype Pollution
// ═══════════════════════════════════════════════════════════════
describe("WaitlistController — Combined XSS + Prototype Pollution", () => {
  it("should sanitize both XSS in name and prototype pollution in metadata", async () => {
    const maliciousMetadata = Object.assign(Object.create(null), {
      __proto__: { isAdmin: true },
      constructor: { polluted: true },
      source: "legitimate",
    });
    const req = createMockRequest({
      email: "combined@test.com",
      name: '<script>alert("xss")</script>Legitimate Name',
      metadata: maliciousMetadata,
    });
    const res = createMockResponse();

    await WaitlistController.addToWaitlist(
      req as Request,
      res as unknown as Response,
    );

    expect(res.status).toHaveBeenCalledWith(201);

    const calledArgs = mockAddToWaitlist.mock.calls[0]?.[0];
    // XSS stripped from name
    expect(calledArgs?.name).toBe('alert("xss")Legitimate Name');
    expect(calledArgs?.name).not.toContain("<script>");

    // Prototype pollution stripped from metadata
    const storedMetadata = calledArgs?.metadata as Record<string, unknown>;
    expect(Object.hasOwn(storedMetadata, "__proto__")).toBe(false);
    expect(Object.hasOwn(storedMetadata, "constructor")).toBe(false);
    expect(storedMetadata).toHaveProperty("source", "legitimate");
  });
});
