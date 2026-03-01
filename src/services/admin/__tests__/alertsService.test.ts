/**
 * AlertsService Tests
 * Covers: getAlerts (pagination, filter), acknowledgeAlert (success, already acked, not found)
 */

import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { AlertsService } from "../alertsService.js";
import { prisma } from "../../../lib/prisma.js";

// ─── Prisma Mocks ───────────────────────────────────────────────
const mockAlertFindMany = jest.fn();
const mockAlertCount = jest.fn();
const mockAlertFindUnique = jest.fn();
const mockAlertUpdate = jest.fn();

(prisma.adminAlert as unknown as Record<string, jest.Mock>).findMany = mockAlertFindMany;
(prisma.adminAlert as unknown as Record<string, jest.Mock>).count = mockAlertCount;
(prisma.adminAlert as unknown as Record<string, jest.Mock>).findUnique = mockAlertFindUnique;
(prisma.adminAlert as unknown as Record<string, jest.Mock>).update = mockAlertUpdate;

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
});

// ═══════════════════════════════════════════════════════════════
// getAlerts
// ═══════════════════════════════════════════════════════════════
describe("AlertsService.getAlerts", () => {
  const mockAlerts = [
    {
      id: "alert-1",
      type: "CHURN_SPIKE",
      severity: "CRITICAL",
      message: "Churn spike detected",
      metadata: { recentChurn: 15 },
      acknowledged: false,
      acknowledgedBy: null,
      acknowledgedAt: null,
      createdAt: new Date("2026-02-27"),
    },
    {
      id: "alert-2",
      type: "REVENUE_DROP",
      severity: "WARNING",
      message: "Revenue dropped",
      metadata: { todaySubs: 2 },
      acknowledged: true,
      acknowledgedBy: "admin-1",
      acknowledgedAt: new Date("2026-02-27"),
      createdAt: new Date("2026-02-26"),
    },
  ];

  it("should return paginated alerts with defaults", async () => {
    mockAlertFindMany.mockResolvedValue(mockAlerts);
    mockAlertCount.mockResolvedValue(2);

    const result = await AlertsService.getAlerts({});

    expect(result.page).toBe(1);
    expect(result.limit).toBe(50);
    expect(result.total).toBe(2);
    expect(result.totalPages).toBe(1);
    expect(result.alerts).toHaveLength(2);
    expect(result.alerts[0].id).toBe("alert-1");
    expect(result.alerts[0].type).toBe("CHURN_SPIKE");
  });

  it("should cap limit at 100", async () => {
    mockAlertFindMany.mockResolvedValue([]);
    mockAlertCount.mockResolvedValue(0);

    await AlertsService.getAlerts({ limit: 500 });

    expect(mockAlertFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
  });

  it("should apply pagination offset correctly", async () => {
    mockAlertFindMany.mockResolvedValue([]);
    mockAlertCount.mockResolvedValue(100);

    await AlertsService.getAlerts({ page: 3, limit: 20 });

    expect(mockAlertFindMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 40, take: 20 }));
  });

  it("should filter by type", async () => {
    mockAlertFindMany.mockResolvedValue([]);
    mockAlertCount.mockResolvedValue(0);

    await AlertsService.getAlerts({ type: "CHURN_SPIKE" });

    expect(mockAlertFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ type: "CHURN_SPIKE" }),
      }),
    );
  });

  it("should filter by acknowledged status", async () => {
    mockAlertFindMany.mockResolvedValue([]);
    mockAlertCount.mockResolvedValue(0);

    await AlertsService.getAlerts({ acknowledged: false });

    expect(mockAlertFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ acknowledged: false }),
      }),
    );
  });

  it("should order by createdAt desc", async () => {
    mockAlertFindMany.mockResolvedValue([]);
    mockAlertCount.mockResolvedValue(0);

    await AlertsService.getAlerts({});

    expect(mockAlertFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: "desc" },
      }),
    );
  });

  it("should compute totalPages correctly", async () => {
    mockAlertFindMany.mockResolvedValue([]);
    mockAlertCount.mockResolvedValue(55);

    const result = await AlertsService.getAlerts({ limit: 20 });

    expect(result.totalPages).toBe(3); // ceil(55/20) = 3
  });
});

// ═══════════════════════════════════════════════════════════════
// acknowledgeAlert
// ═══════════════════════════════════════════════════════════════
describe("AlertsService.acknowledgeAlert", () => {
  it("should acknowledge an unacknowledged alert", async () => {
    mockAlertFindUnique.mockResolvedValue({
      id: "alert-1",
      acknowledged: false,
    });
    mockAlertUpdate.mockResolvedValue({});

    const result = await AlertsService.acknowledgeAlert("alert-1", "admin-1");

    expect(result.success).toBe(true);
    expect(mockAlertUpdate).toHaveBeenCalledWith({
      where: { id: "alert-1" },
      data: {
        acknowledged: true,
        acknowledgedBy: "admin-1",
        acknowledgedAt: expect.any(Date),
      },
    });
  });

  it("should return error for unknown alert id", async () => {
    mockAlertFindUnique.mockResolvedValue(null);

    const result = await AlertsService.acknowledgeAlert("nonexistent", "admin-1");

    expect(result.success).toBe(false);
    expect(result.error).toContain("non trouvée");
  });

  it("should return error when already acknowledged", async () => {
    mockAlertFindUnique.mockResolvedValue({
      id: "alert-1",
      acknowledged: true,
      acknowledgedBy: "admin-2",
    });

    const result = await AlertsService.acknowledgeAlert("alert-1", "admin-1");

    expect(result.success).toBe(false);
    expect(result.error).toContain("déjà acquittée");
  });

  it("should not call update when alert not found", async () => {
    mockAlertFindUnique.mockResolvedValue(null);

    await AlertsService.acknowledgeAlert("nonexistent", "admin-1");

    expect(mockAlertUpdate).not.toHaveBeenCalled();
  });

  it("should not call update when alert already acknowledged", async () => {
    mockAlertFindUnique.mockResolvedValue({
      id: "alert-1",
      acknowledged: true,
    });

    await AlertsService.acknowledgeAlert("alert-1", "admin-1");

    expect(mockAlertUpdate).not.toHaveBeenCalled();
  });
});
