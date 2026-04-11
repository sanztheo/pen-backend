import { describe, it, expect, beforeEach, vi } from "vitest";
import { analyzeSourceContent } from "../sourceAnalyzer.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    page: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("../../../utils/logger.js", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// Import mocked modules after vi.mock declarations
import { prisma } from "../../../lib/prisma.js";
import { logger } from "../../../utils/logger.js";

const mockFindMany = prisma.page.findMany as ReturnType<typeof vi.fn>;
const mockLoggerWarn = logger.warn as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("analyzeSourceContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. Empty pageProjectIds
  // -------------------------------------------------------------------------
  it("returns empty result for empty pageProjectIds array", async () => {
    const result = await analyzeSourceContent("user-1", []);

    expect(mockFindMany).not.toHaveBeenCalled();
    expect(result).toEqual({
      textContent: "",
      wordCount: 0,
      summary: "",
      topics: [],
      hasFormulas: false,
      hasDefinitions: false,
    });
  });

  // -------------------------------------------------------------------------
  // 2. Extracts text from paragraph blocks
  // -------------------------------------------------------------------------
  it("extracts text from paragraph blocks", async () => {
    mockFindMany.mockResolvedValue([
      {
        title: "Page One",
        blockNoteContent: JSON.stringify([
          {
            type: "paragraph",
            content: [{ text: "Hello " }, { text: "world" }],
          },
        ]),
      },
    ]);

    const result = await analyzeSourceContent("user-1", ["page-1"]);

    expect(result.textContent).toContain("Page One");
    expect(result.textContent).toContain("Hello world");
  });

  // -------------------------------------------------------------------------
  // 3. Detects formulas from latex/latexBlock blocks
  // -------------------------------------------------------------------------
  it("detects formulas from latex blocks", async () => {
    mockFindMany.mockResolvedValue([
      {
        title: "Math Page",
        blockNoteContent: JSON.stringify([{ type: "latex" }]),
      },
    ]);

    const result = await analyzeSourceContent("user-1", ["page-1"]);
    expect(result.hasFormulas).toBe(true);
  });

  it("detects formulas from latexBlock blocks", async () => {
    mockFindMany.mockResolvedValue([
      {
        title: "Math Page",
        blockNoteContent: JSON.stringify([{ type: "latexBlock" }]),
      },
    ]);

    const result = await analyzeSourceContent("user-1", ["page-1"]);
    expect(result.hasFormulas).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 4. Detects definitions from heading blocks
  // -------------------------------------------------------------------------
  it("detects definitions from heading blocks", async () => {
    mockFindMany.mockResolvedValue([
      {
        title: "Definitions Page",
        blockNoteContent: JSON.stringify([{ type: "heading" }]),
      },
    ]);

    const result = await analyzeSourceContent("user-1", ["page-1"]);
    expect(result.hasDefinitions).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 5. Handles malformed blockNoteContent gracefully
  // -------------------------------------------------------------------------
  it("handles malformed blockNoteContent gracefully", async () => {
    mockFindMany.mockResolvedValue([
      {
        title: "Broken Page",
        blockNoteContent: "{ invalid json !!!",
      },
    ]);

    const result = await analyzeSourceContent("user-1", ["page-1"]);

    // Title is still collected even when content parsing fails
    expect(result.textContent).toContain("Broken Page");
    expect(result.topics).toContain("Broken Page");
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      "[SOURCE-ANALYZER] Erreur parsing BlockNote:",
      expect.any(Error),
    );
  });

  // -------------------------------------------------------------------------
  // 6. Collects topics from page titles (max 10)
  // -------------------------------------------------------------------------
  it("collects topics from page titles, max 10", async () => {
    const pages = Array.from({ length: 12 }, (_, i) => ({
      title: `Topic ${i + 1}`,
      blockNoteContent: "[]",
    }));
    mockFindMany.mockResolvedValue(pages);

    const result = await analyzeSourceContent(
      "user-1",
      pages.map((_, i) => `page-${i}`),
    );

    expect(result.topics).toHaveLength(10);
    expect(result.topics[0]).toBe("Topic 1");
    expect(result.topics[9]).toBe("Topic 10");
  });

  // -------------------------------------------------------------------------
  // 7. Computes correct wordCount
  // -------------------------------------------------------------------------
  it("computes correct wordCount", async () => {
    mockFindMany.mockResolvedValue([
      {
        title: "Title Here",
        blockNoteContent: JSON.stringify([
          {
            type: "paragraph",
            content: [{ text: "one two three" }],
          },
        ]),
      },
    ]);

    const result = await analyzeSourceContent("user-1", ["page-1"]);

    // "Title" + "Here" (from title) + "one" + "two" + "three" (from paragraph)
    expect(result.wordCount).toBe(5);
  });

  // -------------------------------------------------------------------------
  // 8. Summary is first 200 words
  // -------------------------------------------------------------------------
  it("summary contains at most the first 200 words", async () => {
    const longText = Array.from({ length: 300 }, (_, i) => `word${i}`).join(" ");
    mockFindMany.mockResolvedValue([
      {
        title: "Long",
        blockNoteContent: JSON.stringify([
          {
            type: "paragraph",
            content: [{ text: longText }],
          },
        ]),
      },
    ]);

    const result = await analyzeSourceContent("user-1", ["page-1"]);

    const summaryWords = result.summary.split(/\s+/).filter(Boolean);
    expect(summaryWords.length).toBe(200);
  });

  // -------------------------------------------------------------------------
  // Handles already-parsed blockNoteContent (object, not string)
  // -------------------------------------------------------------------------
  it("handles blockNoteContent that is already a parsed array", async () => {
    mockFindMany.mockResolvedValue([
      {
        title: "Parsed Page",
        blockNoteContent: [
          {
            type: "paragraph",
            content: [{ text: "Already parsed" }],
          },
        ],
      },
    ]);

    const result = await analyzeSourceContent("user-1", ["page-1"]);

    expect(result.textContent).toContain("Already parsed");
  });
});
