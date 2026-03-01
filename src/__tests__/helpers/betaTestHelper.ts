/**
 * Beta Test Helper — shared factories, mocks, and test app builder
 * Used by integration tests (supertest) and unit tests alike.
 */

import { jest } from "@jest/globals";
import type { Request, Response, NextFunction } from "express";

// ─── Mock User Factory ───────────────────────────────────────────

export interface MockUser {
  id: string;
  email: string;
  user_metadata?: Record<string, unknown>;
}

let nextUserId = 1;

export function createMockUser(overrides: Partial<MockUser> = {}): MockUser {
  const id = overrides.id ?? `user_test_${nextUserId++}`;
  return {
    id,
    email: overrides.email ?? `${id}@test.pennote.app`,
    ...overrides,
  };
}

export function resetUserIdCounter(): void {
  nextUserId = 1;
}

// ─── Admin user factory ─────────────────────────────────────────

export const ADMIN_USER: MockUser = {
  id: "admin_test_1",
  email: "admin@test.pennote.app",
};

export const REGULAR_USER: MockUser = {
  id: "user_test_regular",
  email: "regular@test.pennote.app",
};

// ─── Mock Request / Response ─────────────────────────────────────

interface MockResponse {
  status: jest.Mock;
  json: jest.Mock;
}

export function createMockResponse(): MockResponse {
  const res: MockResponse = {
    status: jest.fn(),
    json: jest.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}

export function createMockRequest(
  body: Record<string, unknown> = {},
  user?: MockUser,
  params: Record<string, string> = {},
  query: Record<string, string> = {},
): Partial<Request> {
  return {
    body,
    user: user as Request["user"],
    params,
    query,
  };
}

// ─── Mock middleware factories (for integration tests) ───────────

/**
 * Creates an auth middleware that injects the given user into req.user.
 * Pass undefined to simulate unauthenticated request (middleware still calls next).
 */
export function createMockAuthMiddleware(user?: MockUser) {
  return (_req: Request, _res: Response, next: NextFunction): void => {
    if (user) {
      _req.user = user as Request["user"];
    }
    next();
  };
}

/**
 * Auth middleware that rejects with 401 if no user is injected.
 * Use `req.headers["x-test-user"]` to inject user JSON.
 */
export function testAuthenticateToken(req: Request, res: Response, next: NextFunction): void {
  const userHeader = req.headers["x-test-user"] as string | undefined;
  if (userHeader) {
    try {
      req.user = JSON.parse(userHeader) as Request["user"];
    } catch {
      res.status(401).json({ success: false, error: "Invalid test user header" });
      return;
    }
    next();
    return;
  }
  res.status(401).json({ success: false, error: "Token d'accès requis", code: "MISSING_TOKEN" });
}

/**
 * Optional auth: injects user from header if present, otherwise continues.
 */
export function testOptionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const userHeader = req.headers["x-test-user"] as string | undefined;
  if (userHeader) {
    try {
      req.user = JSON.parse(userHeader) as Request["user"];
    } catch {
      // Ignore parse errors in optional auth
    }
  }
  next();
}

/**
 * Passthrough rate limiter for tests.
 */
export function testPassthroughRateLimit(_req: Request, _res: Response, next: NextFunction): void {
  next();
}

/**
 * Mock requireAdmin that checks x-test-admin header.
 */
export function testRequireAdmin(req: Request, res: Response, next: NextFunction): void {
  const isAdmin = req.headers["x-test-admin"] === "true";
  if (!isAdmin) {
    res.status(403).json({ success: false, error: "Accès administrateur requis" });
    return;
  }
  next();
}

// ─── Logger mock factory ─────────────────────────────────────────

export function createMockLogger() {
  return {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  };
}

// ─── BetaService mock factory ────────────────────────────────────

export function createBetaServiceMock() {
  return {
    getStatus: jest.fn(),
    getProgress: jest.fn(),
    recordHeartbeat: jest.fn(),
    addToWaitlist: jest.fn(),
    reactivateUser: jest.fn(),
  };
}

// ─── BetaAdminService mock factory ──────────────────────────────

export function createBetaAdminServiceMock() {
  return {
    getBetaMetrics: jest.fn(),
    getBetaUsers: jest.fn(),
    kickUser: jest.fn(),
    promoteUser: jest.fn(),
    bulkAction: jest.fn(),
    invalidateMetricsCache: jest.fn(),
  };
}
