/**
 * AdminExportController Tests
 * Covers: initiateUserExport, getExportStatus, downloadExport
 */

import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import type { Request, Response } from "express";

// ─── Mock Redis to prevent real connections ─────────────────────
jest.mock("../../lib/redis.js", () => ({
  redis: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue("OK"),
    del: jest.fn().mockResolvedValue(1),
    keys: jest.fn().mockResolvedValue([]),
    scan: jest.fn().mockResolvedValue(["0", []]),
    pipeline: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
    on: jest.fn(),
    quit: jest.fn(),
  },
}));

// ─── Suppress logger output in tests ────────────────────────────
jest.mock("../../utils/logger.js", () => ({
  logger: {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

// ─── Mock dependencies ──────────────────────────────────────────
const mockUserFindUnique = jest.fn();
const mockActivityLogCreate = jest.fn();
jest.mock("../../lib/prisma.js", () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => mockUserFindUnique(...args) },
    activityLog: { create: (...args: unknown[]) => mockActivityLogCreate(...args) },
  },
}));

const mockQueueAdd = jest.fn();
jest.mock("../../lib/queues.js", () => ({
  adminExportQueue: { add: (...args: unknown[]) => mockQueueAdd(...args) },
}));

const mockMarkJobPending = jest.fn();
const mockGetJobResult = jest.fn();
jest.mock("../../lib/jobResults.js", () => ({
  markJobPending: (...args: unknown[]) => mockMarkJobPending(...args),
  getJobResult: (...args: unknown[]) => mockGetJobResult(...args),
}));

const mockGetExportCSV = jest.fn();
jest.mock("../../workers/export.worker.js", () => ({
  getExportCSV: (...args: unknown[]) => mockGetExportCSV(...args),
}));

import { AdminExportController } from "../adminExportController.js";

// ─── Test Helpers ───────────────────────────────────────────────
interface MockResponse {
  status: jest.Mock;
  json: jest.Mock;
  send: jest.Mock;
  setHeader: jest.Mock;
}

const createMockResponse = (): MockResponse => {
  const res: MockResponse = {
    status: jest.fn(),
    json: jest.fn(),
    send: jest.fn(),
    setHeader: jest.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
};

const createMockRequest = (
  params: Record<string, string> = {},
  query: Record<string, string> = {},
  userId = "admin-1",
): Partial<Request> => ({
  params,
  query,
  user: { id: userId, email: `${userId}@test.com` } as Request["user"],
});

beforeEach(() => {
  jest.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════
// initiateUserExport
// ═══════════════════════════════════════════════════════════════
describe("AdminExportController.initiateUserExport", () => {
  it("creates export job and returns 202", async () => {
    mockUserFindUnique.mockResolvedValue({ email: "admin@test.com" });
    mockQueueAdd.mockResolvedValue({ id: "job-123" });
    mockMarkJobPending.mockResolvedValue(undefined);
    mockActivityLogCreate.mockResolvedValue({});

    const req = createMockRequest();
    const res = createMockResponse();

    await AdminExportController.initiateUserExport(req as Request, res as unknown as Response);

    expect(mockUserFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "admin-1" } }),
    );
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "admin-user-export",
      expect.objectContaining({
        type: "admin-user-export",
        userId: "admin-1",
        adminEmail: "admin@test.com",
      }),
    );
    expect(mockMarkJobPending).toHaveBeenCalledWith("job-123", "admin-1");
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ jobId: "job-123" }),
      }),
    );
  });

  it("passes search and isActive filters", async () => {
    mockUserFindUnique.mockResolvedValue({ email: "admin@test.com" });
    mockQueueAdd.mockResolvedValue({ id: "job-456" });
    mockMarkJobPending.mockResolvedValue(undefined);
    mockActivityLogCreate.mockResolvedValue({});

    const req = createMockRequest({}, { search: "john", isActive: "true" });
    const res = createMockResponse();

    await AdminExportController.initiateUserExport(req as Request, res as unknown as Response);

    expect(mockQueueAdd).toHaveBeenCalledWith(
      "admin-user-export",
      expect.objectContaining({
        filters: { search: "john", isActive: true },
      }),
    );
    expect(res.status).toHaveBeenCalledWith(202);
  });

  it("returns 404 when admin user not found", async () => {
    mockUserFindUnique.mockResolvedValue(null);

    const req = createMockRequest();
    const res = createMockResponse();

    await AdminExportController.initiateUserExport(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: "Admin non trouvé" }),
    );
  });

  it("rejects search term exceeding 100 characters", async () => {
    mockUserFindUnique.mockResolvedValue({ email: "admin@test.com" });

    const req = createMockRequest({}, { search: "x".repeat(101) });
    const res = createMockResponse();

    await AdminExportController.initiateUserExport(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  it("returns 500 when job has no id", async () => {
    mockUserFindUnique.mockResolvedValue({ email: "admin@test.com" });
    mockQueueAdd.mockResolvedValue({ id: undefined });

    const req = createMockRequest();
    const res = createMockResponse();

    await AdminExportController.initiateUserExport(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  it("returns 500 on unexpected error", async () => {
    mockUserFindUnique.mockRejectedValue(new Error("DB down"));

    const req = createMockRequest();
    const res = createMockResponse();

    await AdminExportController.initiateUserExport(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });
});

// ═══════════════════════════════════════════════════════════════
// getExportStatus
// ═══════════════════════════════════════════════════════════════
describe("AdminExportController.getExportStatus", () => {
  it("returns job status on success", async () => {
    const jobResult = {
      status: "completed",
      result: { rowCount: 42 },
      error: null,
      createdAt: new Date("2026-03-20"),
      completedAt: new Date("2026-03-20"),
    };
    mockGetJobResult.mockResolvedValue(jobResult);

    const req = createMockRequest({ jobId: "job-123" });
    const res = createMockResponse();

    await AdminExportController.getExportStatus(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          jobId: "job-123",
          status: "completed",
          rowCount: 42,
        }),
      }),
    );
  });

  it("returns 404 when job not found", async () => {
    mockGetJobResult.mockResolvedValue(null);

    const req = createMockRequest({ jobId: "nonexistent" });
    const res = createMockResponse();

    await AdminExportController.getExportStatus(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  it("rejects missing jobId param", async () => {
    const req = createMockRequest({});
    const res = createMockResponse();

    await AdminExportController.getExportStatus(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: "jobId requis" }),
    );
  });

  it("rejects overly long jobId", async () => {
    const req = createMockRequest({ jobId: "x".repeat(256) });
    const res = createMockResponse();

    await AdminExportController.getExportStatus(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 500 on service error", async () => {
    mockGetJobResult.mockRejectedValue(new Error("Redis down"));

    const req = createMockRequest({ jobId: "job-123" });
    const res = createMockResponse();

    await AdminExportController.getExportStatus(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });
});

// ═══════════════════════════════════════════════════════════════
// downloadExport
// ═══════════════════════════════════════════════════════════════
describe("AdminExportController.downloadExport", () => {
  it("streams CSV on completed job", async () => {
    mockGetJobResult.mockResolvedValue({
      status: "completed",
      result: { rowCount: 10 },
    });
    const csvContent = "id,email\n1,test@test.com";
    mockGetExportCSV.mockResolvedValue(csvContent);

    const req = createMockRequest({ jobId: "job-123" });
    const res = createMockResponse();

    await AdminExportController.downloadExport(req as Request, res as unknown as Response);

    expect(mockGetExportCSV).toHaveBeenCalledWith("admin-1", "job-123");
    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/csv; charset=utf-8");
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Disposition",
      expect.stringContaining("pennote-users-export-"),
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Length",
      Buffer.byteLength(csvContent, "utf8"),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith(csvContent);
  });

  it("returns 404 when job not found", async () => {
    mockGetJobResult.mockResolvedValue(null);

    const req = createMockRequest({ jobId: "nonexistent" });
    const res = createMockResponse();

    await AdminExportController.downloadExport(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns 400 when job not completed", async () => {
    mockGetJobResult.mockResolvedValue({ status: "pending", result: null });

    const req = createMockRequest({ jobId: "job-123" });
    const res = createMockResponse();

    await AdminExportController.downloadExport(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining("non prêt"),
      }),
    );
  });

  it("returns 410 when CSV expired", async () => {
    mockGetJobResult.mockResolvedValue({ status: "completed", result: { rowCount: 5 } });
    mockGetExportCSV.mockResolvedValue(null);

    const req = createMockRequest({ jobId: "job-123" });
    const res = createMockResponse();

    await AdminExportController.downloadExport(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(410);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining("expiré"),
      }),
    );
  });

  it("rejects missing jobId param", async () => {
    const req = createMockRequest({});
    const res = createMockResponse();

    await AdminExportController.downloadExport(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: "jobId requis" }));
  });

  it("returns 500 on unexpected error", async () => {
    mockGetJobResult.mockRejectedValue(new Error("Redis down"));

    const req = createMockRequest({ jobId: "job-123" });
    const res = createMockResponse();

    await AdminExportController.downloadExport(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });
});
