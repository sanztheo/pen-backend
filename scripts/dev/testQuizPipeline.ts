/**
 * Test script — calls the new quiz pipeline directly (no HTTP, no auth)
 * Generates 5 questions on a real course, logs every SSE event, measures similarity.
 *
 * Usage: infisical run --env=dev --path=/Backend -- npx tsx scripts/dev/testQuizPipeline.ts <pageId> [questionCount]
 */

if (process.env.NODE_ENV === "production") {
  throw new Error("[TEST-PIPELINE] Forbidden in production");
}

import { PrismaClient } from "@prisma/client";
import { executeQuizPipeline } from "../../src/controllers/quiz-streaming/quizPipeline.js";
import { cosineSimilarity } from "../../src/utils/clustering.js";
import { logger } from "../../src/utils/logger.js";

let ragSystem: any;
try {
  ragSystem = (await import("../../src/services/rag/index.js")).ragSystem;
} catch {
  ragSystem = (await import("../../src/services/rag")).ragSystem;
}

const prisma = new PrismaClient();

interface SSEEvent {
  event: string;
  data: Record<string, unknown>;
  timestamp: number;
}

async function main(): Promise<void> {
  const pageId = process.argv[2];
  const questionCount = parseInt(process.argv[3] || "5", 10);

  if (!pageId) {
    console.error("Usage: npx tsx scripts/dev/testQuizPipeline.ts <pageId> [questionCount=5]");
    process.exit(1);
  }

  // Verify page exists
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { id: true, title: true, workspaceId: true, createdBy: true },
  });

  if (!page) {
    console.error(`Page ${pageId} not found`);
    process.exit(1);
  }

  console.log("═══════════════════════════════════════════════════");
  console.log("  TEST: Quiz Pipeline v5 (Analyze → Plan → Generate)");
  console.log("═══════════════════════════════════════════════════");
  console.log(`  Page: ${page.title}`);
  console.log(`  Questions: ${questionCount}`);
  console.log("");

  // Create a temporary quiz in DB
  const quiz = await prisma.quiz.create({
    data: {
      title: `[TEST] Pipeline v5 — ${page.title}`,
      userId: page.createdBy,
      schoolLevel: "ETUDES_SUPERIEURES",
      status: "generating",
      questions: [],
    },
  });

  // Collect SSE events
  const events: SSEEvent[] = [];
  const t0 = Date.now();

  const mockSendSSE = (event: string, data: Record<string, unknown>) => {
    const elapsed = Date.now() - t0;
    events.push({ event, data, timestamp: elapsed });

    // Pretty print
    const icon =
      event === "analyzing"
        ? "🔍"
        : event === "planning"
          ? "📋"
          : event === "generating"
            ? "⚡"
            : event === "question-generated"
              ? "✅"
              : event === "question-error"
                ? "❌"
                : "📡";

    if (event === "question-generated") {
      const q = data.question as any;
      console.log(
        `  ${icon} [${elapsed}ms] Q${data.questionNumber}: ${q?.question?.slice(0, 80)}...`,
      );
      console.log(
        `     Type: ${q?.type} | Difficulty: ${q?.difficulty} | Topic: ${q?.metadata?.targetConcept || "?"}`,
      );
    } else {
      console.log(
        `  ${icon} [${elapsed}ms] ${event}: ${data.message || JSON.stringify(data).slice(0, 100)}`,
      );
    }
  };

  // Build type distribution (all MCQ for simplicity)
  const types = ["MULTIPLE_CHOICE", "TRUE_FALSE", "OPEN_QUESTION"];
  const typeDistribution: string[] = [];
  for (let i = 0; i < questionCount; i++) {
    typeDistribution.push(types[i % types.length]);
  }

  try {
    console.log("─── Pipeline Start ──────────────────────────────");

    const questions = await executeQuizPipeline({
      pageIds: [pageId],
      questionCount,
      questionTypes: ["MULTIPLE_CHOICE", "TRUE_FALSE", "OPEN_QUESTION"],
      difficulty: "moyen",
      schoolLevel: "ETUDES_SUPERIEURES",
      coursesOnly: true,
      quizId: quiz.id,
      sendSSE: mockSendSSE as any,
      prisma: prisma as any,
      isDisconnected: () => false,
    });

    const totalTime = Date.now() - t0;

    console.log("");
    console.log("─── Results ─────────────────────────────────────");
    console.log(`  Total questions: ${questions.length}`);
    console.log(`  Total time: ${totalTime}ms (${(totalTime / 1000).toFixed(1)}s)`);

    // Phase timing
    const analyzeEnd = events.find((e) => e.event === "planning")?.timestamp || 0;
    const planEnd = events.find((e) => e.event === "generating")?.timestamp || 0;
    const firstQ = events.find((e) => e.event === "question-generated")?.timestamp || 0;

    console.log(`  Analyze phase: ${analyzeEnd}ms`);
    console.log(`  Plan phase: ${planEnd - analyzeEnd}ms`);
    console.log(`  Time to first question: ${firstQ}ms`);

    // Similarity analysis
    if (questions.length >= 2) {
      console.log("");
      console.log("─── Similarity Analysis ─────────────────────────");

      const questionTexts = questions.map((q: any) => q.question);
      const embeddings = await Promise.all(
        questionTexts.map((q: string) => ragSystem.embeddingService.generateEmbedding(q)),
      );

      const sims: number[] = [];
      let above085 = 0,
        above080 = 0,
        above070 = 0,
        max = 0;

      for (let i = 0; i < embeddings.length; i++) {
        for (let j = i + 1; j < embeddings.length; j++) {
          const s = cosineSimilarity(embeddings[i], embeddings[j]);
          sims.push(s);
          if (s > max) max = s;
          if (s >= 0.85) above085++;
          if (s >= 0.8) above080++;
          if (s >= 0.7) above070++;
        }
      }

      const mean = sims.reduce((a, b) => a + b, 0) / sims.length;

      console.log(`  Semantic mean: ${mean.toFixed(3)}`);
      console.log(`  Semantic max: ${max.toFixed(3)}`);
      console.log(`  Pairs > 0.85: ${above085}`);
      console.log(`  Pairs > 0.80: ${above080}`);
      console.log(`  Pairs > 0.70: ${above070}`);
      console.log(`  Target: pairsAbove080 = 0, mean < 0.40`);
    }

    // Print all questions
    console.log("");
    console.log("─── All Questions ───────────────────────────────");
    questions.forEach((q: any, i: number) => {
      console.log(`  Q${i + 1} [${q.type}/${q.difficulty}]: ${q.question}`);
      if (q.options) {
        q.options.forEach((o: any) => {
          console.log(`    ${o.isCorrect ? "✓" : "○"} ${o.text}`);
        });
      }
    });

    console.log("");
    console.log("═══════════════════════════════════════════════════");
  } catch (err) {
    console.error("\n❌ Pipeline failed:", err);

    // Print collected events for debugging
    console.log("\n─── SSE Events Before Failure ──────────────────");
    events.forEach((e) =>
      console.log(`  [${e.timestamp}ms] ${e.event}: ${JSON.stringify(e.data).slice(0, 120)}`),
    );
  }

  // Cleanup test quiz
  await prisma.quiz.delete({ where: { id: quiz.id } }).catch(() => {});
  await prisma.$disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("[TEST-PIPELINE] Fatal:", err);
  process.exit(1);
});
