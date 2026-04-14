/**
 * Benchmark script — runs quiz pipeline v5 multiple times, saves all outputs.
 *
 * Measures:
 *   - End-to-end latency (analyze/plan/generate stages)
 *   - Question diversity (semantic similarity matrix)
 *   - Failure rate (titleGenerator, clusters, batch)
 *   - Concept coverage vs blueprint
 *
 * Usage:
 *   infisical run --env=dev --path=/Backend -- \
 *     npx tsx scripts/dev/benchmarkQuizPipeline.ts <pageId> [runs] [questionCount]
 *
 * Outputs:
 *   scripts/dev/benchmark-results/benchmark-<timestamp>.json
 */

if (process.env.NODE_ENV === "production") {
  throw new Error("[BENCHMARK] Forbidden in production");
}

import { PrismaClient } from "@prisma/client";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { executeQuizPipeline } from "../../src/controllers/quiz-streaming/quizPipeline.js";
import { cosineSimilarity } from "../../src/utils/clustering.js";

type AnyRec = Record<string, unknown>;

let ragSystem: { embeddingService: { generateEmbedding: (s: string) => Promise<number[]> } };
try {
  ragSystem = (await import("../../src/services/rag/index.js")).ragSystem;
} catch {
  ragSystem = (await import("../../src/services/rag")).ragSystem;
}

const prisma = new PrismaClient();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface SSEEvent {
  event: string;
  data: AnyRec;
  timestamp: number;
}

interface RunResult {
  runIdx: number;
  success: boolean;
  error?: string;
  totalMs: number;
  analyzeMs: number;
  planMs: number;
  generateMs: number;
  timeToFirstQuestionMs: number;
  questionCount: number;
  questionsRequested: number;
  questions: Array<{
    id?: string;
    type: string;
    difficulty?: string;
    question: string;
    targetConcept?: string;
    bloomLevel?: string;
  }>;
  similarity: {
    mean: number;
    max: number;
    pairsAbove080: number;
    pairsAbove085: number;
  } | null;
  events: SSEEvent[];
}

async function measureSimilarity(questions: Array<{ question: string }>): Promise<{
  mean: number;
  max: number;
  pairsAbove080: number;
  pairsAbove085: number;
} | null> {
  if (questions.length < 2) return null;

  const embeddings = await Promise.all(
    questions.map((q) => ragSystem.embeddingService.generateEmbedding(q.question)),
  );

  const sims: number[] = [];
  let max = 0;
  let pairsAbove080 = 0;
  let pairsAbove085 = 0;

  for (let i = 0; i < embeddings.length; i++) {
    for (let j = i + 1; j < embeddings.length; j++) {
      const s = cosineSimilarity(embeddings[i], embeddings[j]);
      sims.push(s);
      if (s > max) max = s;
      if (s >= 0.8) pairsAbove080++;
      if (s >= 0.85) pairsAbove085++;
    }
  }

  const mean = sims.reduce((a, b) => a + b, 0) / sims.length;
  return { mean, max, pairsAbove080, pairsAbove085 };
}

async function runOnce(
  runIdx: number,
  pageId: string,
  questionCount: number,
  userId: string,
): Promise<RunResult> {
  const t0 = Date.now();
  const events: SSEEvent[] = [];

  const sendSSE = (event: string, data: AnyRec) => {
    events.push({ event, data, timestamp: Date.now() - t0 });
  };

  const quiz = await prisma.quiz.create({
    data: {
      title: `[BENCH] Run ${runIdx}`,
      userId,
      schoolLevel: "ETUDES_SUPERIEURES",
      status: "generating",
      questions: [],
    },
  });

  try {
    const questions = await executeQuizPipeline({
      pageIds: [pageId],
      questionCount,
      questionTypes: ["MULTIPLE_CHOICE", "TRUE_FALSE", "OPEN_QUESTION"],
      difficulty: "moyen",
      schoolLevel: "ETUDES_SUPERIEURES",
      coursesOnly: true,
      quizId: quiz.id,
      sendSSE,
      prisma: prisma,
      isDisconnected: () => false,
    });

    const totalMs = Date.now() - t0;
    const analyzeMs = events.find((e) => e.event === "planning")?.timestamp || 0;
    const planMs = (events.find((e) => e.event === "generating")?.timestamp || 0) - analyzeMs;
    const firstQ = events.find((e) => e.event === "question-generated")?.timestamp || 0;
    const lastQ =
      events.filter((e) => e.event === "question-generated").slice(-1)[0]?.timestamp || 0;
    const generateMs = lastQ - (analyzeMs + planMs);

    const similarity = await measureSimilarity(questions as unknown as { question: string }[]);

    await prisma.quiz.delete({ where: { id: quiz.id } }).catch(() => {});

    return {
      runIdx,
      success: true,
      totalMs,
      analyzeMs,
      planMs,
      generateMs,
      timeToFirstQuestionMs: firstQ,
      questionCount: questions.length,
      questionsRequested: questionCount,
      questions: (questions as AnyRec[]).map((q) => ({
        id: q.id as string | undefined,
        type: q.type as string,
        difficulty: q.difficulty as string | undefined,
        question: q.question as string,
        targetConcept: (q.metadata as AnyRec)?.targetConcept as string | undefined,
        bloomLevel: (q.metadata as AnyRec)?.bloomLevel as string | undefined,
      })),
      similarity,
      events,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await prisma.quiz.delete({ where: { id: quiz.id } }).catch(() => {});
    return {
      runIdx,
      success: false,
      error: msg,
      totalMs: Date.now() - t0,
      analyzeMs: 0,
      planMs: 0,
      generateMs: 0,
      timeToFirstQuestionMs: 0,
      questionCount: 0,
      questionsRequested: questionCount,
      questions: [],
      similarity: null,
      events,
    };
  }
}

async function main(): Promise<void> {
  const pageId = process.argv[2];
  const runs = parseInt(process.argv[3] || "3", 10);
  const questionCount = parseInt(process.argv[4] || "5", 10);

  if (!pageId) {
    console.error(
      "Usage: npx tsx scripts/dev/benchmarkQuizPipeline.ts <pageId> [runs=3] [questionCount=5]",
    );
    process.exit(1);
  }

  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { id: true, title: true, createdBy: true },
  });
  if (!page) {
    console.error(`Page ${pageId} not found`);
    process.exit(1);
  }

  console.log("═══════════════════════════════════════════════════");
  console.log("  BENCHMARK: Quiz Pipeline v5");
  console.log("═══════════════════════════════════════════════════");
  console.log(`  Page: ${page.title}`);
  console.log(`  Runs: ${runs}`);
  console.log(`  Questions per run: ${questionCount}`);
  console.log("");

  const results: RunResult[] = [];
  for (let i = 1; i <= runs; i++) {
    console.log(`─── Run ${i}/${runs} ───────────────────────────────`);
    const result = await runOnce(i, pageId, questionCount, page.createdBy);
    results.push(result);

    if (result.success) {
      console.log(`  ✅ ${result.totalMs}ms | ${result.questionCount}/${questionCount} questions`);
      console.log(
        `     Analyze: ${result.analyzeMs}ms | Plan: ${result.planMs}ms | Generate: ${result.generateMs}ms`,
      );
      if (result.similarity) {
        console.log(
          `     Similarity: mean=${result.similarity.mean.toFixed(3)} max=${result.similarity.max.toFixed(3)} (pairs≥0.80: ${result.similarity.pairsAbove080})`,
        );
      }
      const titles = new Set(result.questions.map((q) => q.targetConcept).filter(Boolean));
      console.log(`     Concepts covered: ${titles.size}/${result.questions.length}`);
    } else {
      console.log(`  ❌ FAILED: ${result.error}`);
    }
    console.log("");
  }

  // Aggregate
  const successful = results.filter((r) => r.success);
  const summary = {
    pageTitle: page.title,
    runs,
    questionCount,
    successRate: `${successful.length}/${runs}`,
    avgTotalMs: Math.round(
      successful.reduce((a, r) => a + r.totalMs, 0) / (successful.length || 1),
    ),
    avgAnalyzeMs: Math.round(
      successful.reduce((a, r) => a + r.analyzeMs, 0) / (successful.length || 1),
    ),
    avgPlanMs: Math.round(successful.reduce((a, r) => a + r.planMs, 0) / (successful.length || 1)),
    avgGenerateMs: Math.round(
      successful.reduce((a, r) => a + r.generateMs, 0) / (successful.length || 1),
    ),
    avgTimeToFirstQMs: Math.round(
      successful.reduce((a, r) => a + r.timeToFirstQuestionMs, 0) / (successful.length || 1),
    ),
    avgSimMean:
      successful.filter((r) => r.similarity).reduce((a, r) => a + (r.similarity?.mean || 0), 0) /
      (successful.filter((r) => r.similarity).length || 1),
    avgSimMax:
      successful.filter((r) => r.similarity).reduce((a, r) => a + (r.similarity?.max || 0), 0) /
      (successful.filter((r) => r.similarity).length || 1),
    totalPairsAbove080: successful.reduce((a, r) => a + (r.similarity?.pairsAbove080 || 0), 0),
  };

  console.log("═══════════════════════════════════════════════════");
  console.log("  SUMMARY");
  console.log("═══════════════════════════════════════════════════");
  console.log(`  Success rate:        ${summary.successRate}`);
  console.log(`  Avg total time:      ${summary.avgTotalMs}ms`);
  console.log(`  Avg analyze:         ${summary.avgAnalyzeMs}ms`);
  console.log(`  Avg plan:            ${summary.avgPlanMs}ms`);
  console.log(`  Avg generate:        ${summary.avgGenerateMs}ms`);
  console.log(`  Avg TTFQ:            ${summary.avgTimeToFirstQMs}ms`);
  console.log(`  Avg sim mean:        ${summary.avgSimMean.toFixed(3)}`);
  console.log(`  Avg sim max:         ${summary.avgSimMax.toFixed(3)}`);
  console.log(`  Total pairs ≥0.80:   ${summary.totalPairsAbove080}`);
  console.log("");

  // Save everything
  const outDir = join(__dirname, "benchmark-results");
  mkdirSync(outDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outFile = join(outDir, `benchmark-${timestamp}.json`);

  writeFileSync(
    outFile,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        summary,
        runs: results,
      },
      null,
      2,
    ),
  );

  console.log(`📄 Full results saved to: ${outFile}`);

  await prisma.$disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("[BENCHMARK] Fatal:", err);
  process.exit(1);
});
