/**
 * AdminUserDetailController Tests
 * Covers: getUserConversations, getUserConversationDetail, getUserQuizzes,
 *         getUserQuizDetail, getUserPageContent, getUserAIUsage
 */

import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import type { Request, Response } from "express";

// ─── Mock redis (jest.mock hoists before imports) ───────────────
const mockCacheBlockNoteContent = jest.fn();
jest.mock("../../lib/redis", () => ({
  __esModule: true,
  cacheBlockNoteContent: (...args: unknown[]) => mockCacheBlockNoteContent(...args),
  redis: {
    disconnect: jest.fn(),
    connect: jest.fn(),
    on: jest.fn(),
    status: "ready",
  },
}));

// ─── Mock redisCache (prevents real Redis connection in CI) ─────
jest.mock("../../services/cache/redisCache", () => ({
  __esModule: true,
  redisCache: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    invalidatePattern: jest.fn(),
  },
}));

// ─── Suppress logger output in tests ────────────────────────────
jest.mock("../../utils/logger", () => ({
  __esModule: true,
  logger: {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

import { AdminUserDetailController } from "../adminUserDetailController.js";
import { prisma } from "../../lib/prisma.js";

// ─── Prisma Mocks ───────────────────────────────────────────────
const mockConversationFindMany = jest.fn();
const mockConversationCount = jest.fn();
const mockConversationFindFirst = jest.fn();
const mockQuizFindMany = jest.fn();
const mockQuizCount = jest.fn();
const mockQuizFindFirst = jest.fn();
const mockPageFindFirst = jest.fn();
const mockUsageGroupBy = jest.fn();
const mockQueryRaw = jest.fn();

(prisma.aIConversation as unknown as Record<string, jest.Mock>).findMany = mockConversationFindMany;
(prisma.aIConversation as unknown as Record<string, jest.Mock>).count = mockConversationCount;
(prisma.aIConversation as unknown as Record<string, jest.Mock>).findFirst =
  mockConversationFindFirst;
(prisma.quiz as unknown as Record<string, jest.Mock>).findMany = mockQuizFindMany;
(prisma.quiz as unknown as Record<string, jest.Mock>).count = mockQuizCount;
(prisma.quiz as unknown as Record<string, jest.Mock>).findFirst = mockQuizFindFirst;
(prisma.page as unknown as Record<string, jest.Mock>).findFirst = mockPageFindFirst;
(prisma.openaiUsageLog as unknown as Record<string, jest.Mock>).groupBy = mockUsageGroupBy;
(prisma as unknown as Record<string, jest.Mock>).$queryRaw = mockQueryRaw;

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
// getUserConversations
// ═══════════════════════════════════════════════════════════════
describe("AdminUserDetailController.getUserConversations", () => {
  const mockConversations = [
    {
      id: "conv-1",
      title: "Chat about math",
      status: "active",
      messageCount: 5,
      lastMessageAt: new Date("2026-03-15"),
      createdAt: new Date("2026-03-10"),
    },
    {
      id: "conv-2",
      title: "Chat about physics",
      status: "archived",
      messageCount: 12,
      lastMessageAt: new Date("2026-03-12"),
      createdAt: new Date("2026-03-08"),
    },
  ];

  it("should return paginated conversations with defaults", async () => {
    mockConversationFindMany.mockResolvedValue(mockConversations);
    mockConversationCount.mockResolvedValue(2);

    const req = createMockRequest({ userId: "user-1" });
    const res = createMockResponse();

    await AdminUserDetailController.getUserConversations(
      req as Request,
      res as unknown as Response,
    );

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.conversations).toHaveLength(2);
    expect(body.data.total).toBe(2);
    expect(body.data.page).toBe(1);
    expect(body.data.totalPages).toBe(1);
  });

  it("should respect page and limit query parameters", async () => {
    mockConversationFindMany.mockResolvedValue([]);
    mockConversationCount.mockResolvedValue(50);

    const req = createMockRequest({ userId: "user-1" }, { page: "3", limit: "10" });
    const res = createMockResponse();

    await AdminUserDetailController.getUserConversations(
      req as Request,
      res as unknown as Response,
    );

    expect(mockConversationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10 }),
    );
    const body = res.json.mock.calls[0][0];
    expect(body.data.page).toBe(3);
    expect(body.data.totalPages).toBe(5);
  });

  it("should cap limit at 100", async () => {
    mockConversationFindMany.mockResolvedValue([]);
    mockConversationCount.mockResolvedValue(0);

    const req = createMockRequest({ userId: "user-1" }, { limit: "500" });
    const res = createMockResponse();

    await AdminUserDetailController.getUserConversations(
      req as Request,
      res as unknown as Response,
    );

    expect(mockConversationFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
  });

  it("should default invalid page/limit to 1/20", async () => {
    mockConversationFindMany.mockResolvedValue([]);
    mockConversationCount.mockResolvedValue(0);

    const req = createMockRequest({ userId: "user-1" }, { page: "abc", limit: "-5" });
    const res = createMockResponse();

    await AdminUserDetailController.getUserConversations(
      req as Request,
      res as unknown as Response,
    );

    expect(mockConversationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 20 }),
    );
  });

  it("should reject missing userId", async () => {
    const req = createMockRequest({});
    const res = createMockResponse();

    await AdminUserDetailController.getUserConversations(
      req as Request,
      res as unknown as Response,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: "userId requis" }),
    );
  });

  it("should reject userId exceeding max length", async () => {
    const req = createMockRequest({ userId: "x".repeat(256) });
    const res = createMockResponse();

    await AdminUserDetailController.getUserConversations(
      req as Request,
      res as unknown as Response,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: "userId requis" }),
    );
  });

  it("should return 500 on Prisma error", async () => {
    mockConversationFindMany.mockRejectedValue(new Error("DB connection lost"));
    mockConversationCount.mockRejectedValue(new Error("DB connection lost"));

    const req = createMockRequest({ userId: "user-1" });
    const res = createMockResponse();

    await AdminUserDetailController.getUserConversations(
      req as Request,
      res as unknown as Response,
    );

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });
});

// ═══════════════════════════════════════════════════════════════
// getUserConversationDetail
// ═══════════════════════════════════════════════════════════════
describe("AdminUserDetailController.getUserConversationDetail", () => {
  const mockConversation = {
    id: "conv-1",
    title: "Chat about math",
    status: "active",
    messageCount: 2,
    messages: [
      {
        id: "msg-1",
        role: "user",
        content: "What is 2+2?",
        mode: "ask",
        createdAt: new Date("2026-03-10T10:00:00Z"),
        toolCalls: null,
        pageCreationData: null,
        pageId: null,
        pageTitle: null,
      },
      {
        id: "msg-2",
        role: "assistant",
        content: "2+2 = 4",
        mode: "ask",
        createdAt: new Date("2026-03-10T10:00:05Z"),
        toolCalls: null,
        pageCreationData: null,
        pageId: null,
        pageTitle: null,
      },
    ],
  };

  it("should return conversation with messages", async () => {
    mockConversationFindFirst.mockResolvedValue(mockConversation);

    const req = createMockRequest({ userId: "user-1", conversationId: "conv-1" });
    const res = createMockResponse();

    await AdminUserDetailController.getUserConversationDetail(
      req as Request,
      res as unknown as Response,
    );

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.conversation.messages).toHaveLength(2);
    expect(body.data.conversation.id).toBe("conv-1");
  });

  it("should query with both userId and conversationId", async () => {
    mockConversationFindFirst.mockResolvedValue(mockConversation);

    const req = createMockRequest({ userId: "user-1", conversationId: "conv-1" });
    const res = createMockResponse();

    await AdminUserDetailController.getUserConversationDetail(
      req as Request,
      res as unknown as Response,
    );

    expect(mockConversationFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "conv-1", userId: "user-1" },
      }),
    );
  });

  it("should return 404 when conversation not found", async () => {
    mockConversationFindFirst.mockResolvedValue(null);

    const req = createMockRequest({ userId: "user-1", conversationId: "nonexistent" });
    const res = createMockResponse();

    await AdminUserDetailController.getUserConversationDetail(
      req as Request,
      res as unknown as Response,
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  it("should reject missing conversationId", async () => {
    const req = createMockRequest({ userId: "user-1" });
    const res = createMockResponse();

    await AdminUserDetailController.getUserConversationDetail(
      req as Request,
      res as unknown as Response,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "conversationId requis" }),
    );
  });

  it("should reject missing userId", async () => {
    const req = createMockRequest({ conversationId: "conv-1" });
    const res = createMockResponse();

    await AdminUserDetailController.getUserConversationDetail(
      req as Request,
      res as unknown as Response,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: "userId requis" }));
  });

  it("should return 500 on Prisma error", async () => {
    mockConversationFindFirst.mockRejectedValue(new Error("DB error"));

    const req = createMockRequest({ userId: "user-1", conversationId: "conv-1" });
    const res = createMockResponse();

    await AdminUserDetailController.getUserConversationDetail(
      req as Request,
      res as unknown as Response,
    );

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ═══════════════════════════════════════════════════════════════
// getUserQuizzes
// ═══════════════════════════════════════════════════════════════
describe("AdminUserDetailController.getUserQuizzes", () => {
  const mockQuizzes = [
    {
      id: "quiz-1",
      title: "Math Quiz",
      isCompleted: true,
      schoolLevel: "college",
      timeSpent: 300,
      completedAt: new Date("2026-03-15"),
      createdAt: new Date("2026-03-15"),
      result: { percentage: 85, adaptedGrade: "17/20", gradeScale: "french" },
    },
    {
      id: "quiz-2",
      title: "Physics Quiz",
      isCompleted: false,
      schoolLevel: "lycee",
      timeSpent: null,
      completedAt: null,
      createdAt: new Date("2026-03-14"),
      result: null,
    },
  ];

  it("should return paginated quizzes with results", async () => {
    mockQuizFindMany.mockResolvedValue(mockQuizzes);
    mockQuizCount.mockResolvedValue(2);

    const req = createMockRequest({ userId: "user-1" });
    const res = createMockResponse();

    await AdminUserDetailController.getUserQuizzes(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.quizzes).toHaveLength(2);
    expect(body.data.quizzes[0].result.percentage).toBe(85);
    expect(body.data.quizzes[1].result).toBeNull();
  });

  it("should respect pagination parameters", async () => {
    mockQuizFindMany.mockResolvedValue([]);
    mockQuizCount.mockResolvedValue(100);

    const req = createMockRequest({ userId: "user-1" }, { page: "5", limit: "10" });
    const res = createMockResponse();

    await AdminUserDetailController.getUserQuizzes(req as Request, res as unknown as Response);

    expect(mockQuizFindMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 40, take: 10 }));
    const body = res.json.mock.calls[0][0];
    expect(body.data.page).toBe(5);
    expect(body.data.totalPages).toBe(10);
  });

  it("should reject missing userId", async () => {
    const req = createMockRequest({});
    const res = createMockResponse();

    await AdminUserDetailController.getUserQuizzes(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("should return 500 on Prisma error", async () => {
    mockQuizFindMany.mockRejectedValue(new Error("DB error"));
    mockQuizCount.mockRejectedValue(new Error("DB error"));

    const req = createMockRequest({ userId: "user-1" });
    const res = createMockResponse();

    await AdminUserDetailController.getUserQuizzes(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ═══════════════════════════════════════════════════════════════
// getUserQuizDetail
// ═══════════════════════════════════════════════════════════════
describe("AdminUserDetailController.getUserQuizDetail", () => {
  const mockQuiz = {
    id: "quiz-1",
    title: "Math Quiz",
    questions: [{ id: "q1", text: "What is 2+2?" }],
    userAnswers: [{ questionId: "q1", answer: "4" }],
    timeSpent: 300,
    schoolLevel: "college",
    isCompleted: true,
    startedAt: new Date("2026-03-15T10:00:00Z"),
    completedAt: new Date("2026-03-15T10:05:00Z"),
    createdAt: new Date("2026-03-15"),
    result: {
      id: "result-1",
      percentage: 100,
      adaptedGrade: "20/20",
      gradeScale: "french",
      totalScore: 1,
      maxScore: 1,
      detailedScoring: null,
      recommendations: null,
      strengths: ["arithmetic"],
      weaknesses: [],
      timeAnalysis: null,
      createdAt: new Date("2026-03-15T10:05:01Z"),
    },
  };

  it("should return quiz with full details and result", async () => {
    mockQuizFindFirst.mockResolvedValue(mockQuiz);

    const req = createMockRequest({ userId: "user-1", quizId: "quiz-1" });
    const res = createMockResponse();

    await AdminUserDetailController.getUserQuizDetail(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.id).toBe("quiz-1");
    expect(body.data.result.percentage).toBe(100);
    expect(body.data.questions).toHaveLength(1);
  });

  it("should normalize null result to null", async () => {
    mockQuizFindFirst.mockResolvedValue({ ...mockQuiz, result: null });

    const req = createMockRequest({ userId: "user-1", quizId: "quiz-1" });
    const res = createMockResponse();

    await AdminUserDetailController.getUserQuizDetail(req as Request, res as unknown as Response);

    const body = res.json.mock.calls[0][0];
    expect(body.data.result).toBeNull();
  });

  it("should return 404 when quiz not found", async () => {
    mockQuizFindFirst.mockResolvedValue(null);

    const req = createMockRequest({ userId: "user-1", quizId: "nonexistent" });
    const res = createMockResponse();

    await AdminUserDetailController.getUserQuizDetail(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  it("should query with both userId and quizId", async () => {
    mockQuizFindFirst.mockResolvedValue(mockQuiz);

    const req = createMockRequest({ userId: "user-1", quizId: "quiz-1" });
    const res = createMockResponse();

    await AdminUserDetailController.getUserQuizDetail(req as Request, res as unknown as Response);

    expect(mockQuizFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "quiz-1", userId: "user-1" },
      }),
    );
  });

  it("should reject missing quizId", async () => {
    const req = createMockRequest({ userId: "user-1" });
    const res = createMockResponse();

    await AdminUserDetailController.getUserQuizDetail(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: "quizId requis" }));
  });

  it("should reject missing userId", async () => {
    const req = createMockRequest({ quizId: "quiz-1" });
    const res = createMockResponse();

    await AdminUserDetailController.getUserQuizDetail(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("should return 500 on Prisma error", async () => {
    mockQuizFindFirst.mockRejectedValue(new Error("DB error"));

    const req = createMockRequest({ userId: "user-1", quizId: "quiz-1" });
    const res = createMockResponse();

    await AdminUserDetailController.getUserQuizDetail(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ═══════════════════════════════════════════════════════════════
// getUserPageContent
// ═══════════════════════════════════════════════════════════════
describe("AdminUserDetailController.getUserPageContent", () => {
  const mockPage = {
    id: "page-1",
    title: "My Notes",
    icon: "📝",
    iconColor: "#FF5733",
    createdAt: new Date("2026-03-10"),
    updatedAt: new Date("2026-03-15"),
    workspace: { name: "Main Workspace" },
  };

  it("should return page metadata with content", async () => {
    mockPageFindFirst.mockResolvedValue(mockPage);
    mockCacheBlockNoteContent.mockResolvedValue({
      blockNoteContent: [{ type: "paragraph", content: "Hello" }],
    });

    const req = createMockRequest({ userId: "user-1", pageId: "page-1" });
    const res = createMockResponse();

    await AdminUserDetailController.getUserPageContent(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.page.id).toBe("page-1");
    expect(body.data.page.title).toBe("My Notes");
    expect(body.data.page.workspaceName).toBe("Main Workspace");
    expect(body.data.page.content).toEqual([{ type: "paragraph", content: "Hello" }]);
  });

  it("should return null content when cache returns null", async () => {
    mockPageFindFirst.mockResolvedValue(mockPage);
    mockCacheBlockNoteContent.mockResolvedValue(null);

    const req = createMockRequest({ userId: "user-1", pageId: "page-1" });
    const res = createMockResponse();

    await AdminUserDetailController.getUserPageContent(req as Request, res as unknown as Response);

    const body = res.json.mock.calls[0][0];
    expect(body.data.page.content).toBeNull();
  });

  it("should return 404 when page not found", async () => {
    mockPageFindFirst.mockResolvedValue(null);

    const req = createMockRequest({ userId: "user-1", pageId: "nonexistent" });
    const res = createMockResponse();

    await AdminUserDetailController.getUserPageContent(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  it("should verify page belongs to user via createdBy filter", async () => {
    mockPageFindFirst.mockResolvedValue(mockPage);
    mockCacheBlockNoteContent.mockResolvedValue(null);

    const req = createMockRequest({ userId: "user-1", pageId: "page-1" });
    const res = createMockResponse();

    await AdminUserDetailController.getUserPageContent(req as Request, res as unknown as Response);

    expect(mockPageFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "page-1", createdBy: "user-1" },
      }),
    );
  });

  it("should reject missing pageId", async () => {
    const req = createMockRequest({ userId: "user-1" });
    const res = createMockResponse();

    await AdminUserDetailController.getUserPageContent(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: "pageId requis" }));
  });

  it("should reject missing userId", async () => {
    const req = createMockRequest({ pageId: "page-1" });
    const res = createMockResponse();

    await AdminUserDetailController.getUserPageContent(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("should return 500 on error", async () => {
    mockPageFindFirst.mockRejectedValue(new Error("DB error"));

    const req = createMockRequest({ userId: "user-1", pageId: "page-1" });
    const res = createMockResponse();

    await AdminUserDetailController.getUserPageContent(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ═══════════════════════════════════════════════════════════════
// getUserAIUsage
// ═══════════════════════════════════════════════════════════════
describe("AdminUserDetailController.getUserAIUsage", () => {
  const mockAggregateBySource = [
    {
      source: "chat",
      _sum: { promptTokens: 1000, completionTokens: 500, estimatedCost: 0.05 },
      _count: 10,
    },
    {
      source: "quiz",
      _sum: { promptTokens: 2000, completionTokens: 800, estimatedCost: 0.08 },
      _count: 5,
    },
  ];

  const mockDailyTrend = [
    {
      date: "2026-03-14",
      prompt_tokens: BigInt(1500),
      completion_tokens: BigInt(600),
      cost: 0.06,
    },
    {
      date: "2026-03-15",
      prompt_tokens: BigInt(1500),
      completion_tokens: BigInt(700),
      cost: 0.07,
    },
  ];

  it("should return aggregated AI usage with default period (30d)", async () => {
    mockUsageGroupBy.mockResolvedValue(mockAggregateBySource);
    mockQueryRaw.mockResolvedValue(mockDailyTrend);

    const req = createMockRequest({ userId: "user-1" });
    const res = createMockResponse();

    await AdminUserDetailController.getUserAIUsage(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.totalPromptTokens).toBe(3000);
    expect(body.data.totalCompletionTokens).toBe(1300);
    expect(body.data.totalCost).toBeCloseTo(0.13);
    expect(body.data.bySource).toHaveLength(2);
    expect(body.data.daily).toHaveLength(2);
  });

  it("should accept valid period parameter (7d)", async () => {
    mockUsageGroupBy.mockResolvedValue([]);
    mockQueryRaw.mockResolvedValue([]);

    const req = createMockRequest({ userId: "user-1" }, { period: "7d" });
    const res = createMockResponse();

    await AdminUserDetailController.getUserAIUsage(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("should accept valid period parameter (90d)", async () => {
    mockUsageGroupBy.mockResolvedValue([]);
    mockQueryRaw.mockResolvedValue([]);

    const req = createMockRequest({ userId: "user-1" }, { period: "90d" });
    const res = createMockResponse();

    await AdminUserDetailController.getUserAIUsage(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("should reject invalid period parameter", async () => {
    const req = createMockRequest({ userId: "user-1" }, { period: "999d" });
    const res = createMockResponse();

    await AdminUserDetailController.getUserAIUsage(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining("Période invalide"),
      }),
    );
  });

  it("should reject overly long period parameter", async () => {
    const req = createMockRequest({ userId: "user-1" }, { period: "a".repeat(20) });
    const res = createMockResponse();

    await AdminUserDetailController.getUserAIUsage(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("should handle null source in aggregation", async () => {
    mockUsageGroupBy.mockResolvedValue([
      {
        source: null,
        _sum: { promptTokens: 100, completionTokens: 50, estimatedCost: 0.01 },
        _count: 1,
      },
    ]);
    mockQueryRaw.mockResolvedValue([]);

    const req = createMockRequest({ userId: "user-1" });
    const res = createMockResponse();

    await AdminUserDetailController.getUserAIUsage(req as Request, res as unknown as Response);

    const body = res.json.mock.calls[0][0];
    expect(body.data.bySource[0].source).toBe("unknown");
  });

  it("should convert bigint daily values to numbers", async () => {
    mockUsageGroupBy.mockResolvedValue([]);
    mockQueryRaw.mockResolvedValue([
      {
        date: "2026-03-15",
        prompt_tokens: BigInt(5000),
        completion_tokens: BigInt(2000),
        cost: 0.15,
      },
    ]);

    const req = createMockRequest({ userId: "user-1" });
    const res = createMockResponse();

    await AdminUserDetailController.getUserAIUsage(req as Request, res as unknown as Response);

    const body = res.json.mock.calls[0][0];
    expect(body.data.daily[0].promptTokens).toBe(5000);
    expect(body.data.daily[0].completionTokens).toBe(2000);
    expect(typeof body.data.daily[0].promptTokens).toBe("number");
  });

  it("should reject missing userId", async () => {
    const req = createMockRequest({});
    const res = createMockResponse();

    await AdminUserDetailController.getUserAIUsage(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("should return 500 on Prisma error", async () => {
    mockUsageGroupBy.mockRejectedValue(new Error("DB error"));

    const req = createMockRequest({ userId: "user-1" });
    const res = createMockResponse();

    await AdminUserDetailController.getUserAIUsage(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("should handle empty results gracefully", async () => {
    mockUsageGroupBy.mockResolvedValue([]);
    mockQueryRaw.mockResolvedValue([]);

    const req = createMockRequest({ userId: "user-1" });
    const res = createMockResponse();

    await AdminUserDetailController.getUserAIUsage(req as Request, res as unknown as Response);

    const body = res.json.mock.calls[0][0];
    expect(body.data.totalPromptTokens).toBe(0);
    expect(body.data.totalCompletionTokens).toBe(0);
    expect(body.data.totalCost).toBe(0);
    expect(body.data.bySource).toHaveLength(0);
    expect(body.data.daily).toHaveLength(0);
  });
});
