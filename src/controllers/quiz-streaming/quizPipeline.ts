/**
 * Quiz Pipeline Orchestrator — 4-stage SSE pipeline for quiz generation.
 * Analyze → Plan → Generate (parallel batches) → Done
 *
 * Replaces the per-question loop (standardGenerator) with a blueprint-guided
 * parallel-batch approach that produces higher quality, more diverse questions
 * with linear scaling on question count.
 *
 * Optimizations vs v1:
 *   - ConceptMap cached in Redis by content hash (skips Analyze on re-runs)
 *   - Batches run in parallel via Promise.allSettled (scales linearly)
 *   - Blueprint slicing guarantees topic distinction across parallel batches
 */

import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { logger } from "../../utils/logger.js";
import { redis } from "../../lib/redis.js";
import { analyzeCourse } from "../../services/quiz/intelligence/courseAnalyzer.js";
import type { ConceptMap } from "../../services/quiz/intelligence/courseAnalyzer.js";
import { planQuiz } from "../../services/quiz/intelligence/quizPlanner.js";
import type { QuizPlanConfig } from "../../services/quiz/intelligence/quizPlanner.js";
import { generateBatch } from "./batchQuestionGenerator.js";
import { extractPageText } from "./extractPageText.js";
import type { Question } from "../../services/quiz/types.js";
import type { SSESender } from "./types.js";
import type { PlannedQuestion } from "../../services/quiz/intelligence/quizPlanner.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QuizPipelineParams {
  pageIds: string[];
  questionCount: number;
  questionTypes: string[];
  difficulty?: string;
  schoolLevel: string;
  specificSubject?: string;
  coursesOnly?: boolean;
  quizId: string;
  sendSSE: SSESender;
  /* eslint-disable @typescript-eslint/no-explicit-any */
  prisma: {
    page: { findMany: (...args: any[]) => Promise<any[]> };
    quiz: { update: (...args: any[]) => Promise<any> };
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  isDisconnected?: () => boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** How many questions to generate per LLM call. 10 is a good balance between
 *  output token budget (~15K tokens/batch) and parallelism granularity. */
const BATCH_SIZE = 10;

/** TTL for cached concept maps in Redis (24h). Concept maps are content-addressed
 *  by hash(courseText), so regenerations on the same course are instant. */
const CONCEPT_MAP_TTL_SECONDS = 24 * 60 * 60;

// ---------------------------------------------------------------------------
// Main Pipeline
// ---------------------------------------------------------------------------

export async function executeQuizPipeline(params: QuizPipelineParams): Promise<Question[]> {
  const {
    pageIds,
    questionCount,
    questionTypes,
    difficulty,
    schoolLevel,
    specificSubject,
    coursesOnly = true,
    quizId,
    sendSSE,
    prisma,
    isDisconnected,
  } = params;

  const pipelineStart = Date.now();
  logger.log(`[QuizPipeline] Starting pipeline for quiz ${quizId} (${questionCount} questions)`);

  // =========================================================================
  // Stage 1 — Analyze (with Redis cache by content hash)
  // =========================================================================
  sendSSE("analyzing", { message: "Analyzing course content..." });

  let courseText = "";
  let courseTitle = specificSubject || "Quiz";

  if (pageIds.length > 0) {
    const pages = await prisma.page.findMany({
      where: { id: { in: pageIds } },
      select: { id: true, title: true, blockNoteContent: true },
    });

    if (pages.length > 0) {
      const extracted = extractPageText(pages);
      courseText = extracted.courseText;
      courseTitle = extracted.courseTitle || courseTitle;
    }
  }

  if (!courseText && !specificSubject) {
    throw new Error("[QuizPipeline] No course content and no subject provided");
  }

  // If no pages but subject provided, use subject as the course content
  if (!courseText && specificSubject) {
    courseText = `Subject: ${specificSubject}`;
    logger.log(
      `[QuizPipeline] No page content — using subject "${specificSubject}" for generation`,
    );
  }

  const conceptMap = await getOrAnalyzeCourse(courseText, courseTitle);

  logger.log(`[QuizPipeline] Stage 1 complete — ${conceptMap.concepts.length} concepts extracted`);

  // =========================================================================
  // Stage 2 — Plan
  // =========================================================================
  sendSSE("planning", {
    message: `Planning ${questionCount} questions...`,
    conceptCount: conceptMap.totalConcepts,
  });

  const planConfig: QuizPlanConfig = {
    questionCount,
    questionTypes,
    difficulty,
    schoolLevel,
  };

  const blueprint = await planQuiz(conceptMap, planConfig);

  logger.log(`[QuizPipeline] Stage 2 complete — ${blueprint.questions.length} questions planned`);

  // =========================================================================
  // Stage 3 — Generate (parallel batches)
  // =========================================================================
  sendSSE("generating", { message: "Generating questions..." });

  if (isDisconnected?.()) {
    logger.log(`[QuizPipeline] Client disconnected before generation`);
    return [];
  }

  const batches = splitIntoBatches(blueprint.questions, BATCH_SIZE);

  logger.log(
    `[QuizPipeline] Dispatching ${batches.length} batch(es) in parallel (${BATCH_SIZE} questions/batch)`,
  );

  // Dispatch all batches in parallel. Blueprint slicing already ensures topic
  // distinction across batches (different targetConcept / angle), so we don't
  // need to share previousQuestions between them.
  const batchPromises = batches.map((batch, batchIdx) =>
    runBatch({
      batch,
      batchIdx,
      totalBatches: batches.length,
      courseText,
      schoolLevel,
      difficulty,
      specificSubject,
      coursesOnly,
      sendSSE,
    }),
  );

  const results = await Promise.allSettled(batchPromises);

  // Collect successful questions in blueprint order
  const generatedQuestions: Question[] = [];
  const failedBatches: number[] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") {
      generatedQuestions.push(...result.value);
    } else {
      failedBatches.push(i + 1);
      logger.error(
        `[QuizPipeline] Batch ${i + 1} failed: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
      );
      sendSSE("question-error", {
        error: `Batch ${i + 1} failed`,
        message: `Error generating questions batch ${i + 1}`,
      });
    }
  }

  // Emit SSE for each question in blueprint order
  for (let qi = 0; qi < generatedQuestions.length; qi++) {
    const question = generatedQuestions[qi];
    const globalIndex = qi + 1;
    sendSSE("question-generated", {
      questionNumber: globalIndex,
      totalQuestions: questionCount,
      question,
      canStartAnswering: qi === 0,
      message: `Question ${globalIndex}/${questionCount} generated`,
    });
  }

  // Single DB write once all batches are done
  await prisma.quiz.update({
    where: { id: quizId },
    data: {
      questions: generatedQuestions as unknown as Prisma.InputJsonValue,
    },
  });

  logger.log(
    `[QuizPipeline] All batches complete — ${generatedQuestions.length}/${questionCount} questions ${failedBatches.length > 0 ? `(${failedBatches.length} batch failures: ${failedBatches.join(", ")})` : ""}`,
  );

  if (generatedQuestions.length === 0 && failedBatches.length > 0) {
    throw new Error(`[QuizPipeline] All ${batches.length} batches failed`);
  }

  // =========================================================================
  // Stage 4 — Done
  // =========================================================================
  const elapsed = Date.now() - pipelineStart;
  logger.log(
    `[QuizPipeline] Pipeline complete in ${elapsed}ms — ${generatedQuestions.length}/${questionCount} questions`,
  );

  return generatedQuestions;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns a concept map for the given course text, from Redis cache if
 * available, otherwise calls the LLM analyzer and caches the result.
 *
 * Concept maps are content-addressed: same course text → same cache key.
 * This makes "regenerate quiz on the same course" nearly instant.
 */
async function getOrAnalyzeCourse(courseText: string, courseTitle: string): Promise<ConceptMap> {
  const contentHash = createHash("sha256").update(courseText).digest("hex").slice(0, 16);
  const cacheKey = `quiz-pipeline:concept-map:${contentHash}`;

  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as ConceptMap;
      logger.log(
        `[QuizPipeline] ✅ ConceptMap cache HIT (${parsed.concepts.length} concepts, key ${contentHash})`,
      );
      return parsed;
    }
  } catch (err) {
    logger.warn(
      `[QuizPipeline] ConceptMap cache read failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  logger.log(`[QuizPipeline] ConceptMap cache MISS — running analyzer (key ${contentHash})`);
  const conceptMap = await analyzeCourse(courseText, courseTitle);

  try {
    await redis.setex(cacheKey, CONCEPT_MAP_TTL_SECONDS, JSON.stringify(conceptMap));
    logger.log(`[QuizPipeline] 💾 ConceptMap cached (TTL ${CONCEPT_MAP_TTL_SECONDS}s)`);
  } catch (err) {
    logger.warn(
      `[QuizPipeline] ConceptMap cache write failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return conceptMap;
}

interface RunBatchParams {
  batch: PlannedQuestion[];
  batchIdx: number;
  totalBatches: number;
  courseText: string;
  schoolLevel: string;
  difficulty?: string;
  specificSubject?: string;
  coursesOnly?: boolean;
  sendSSE: SSESender;
}

async function runBatch(params: RunBatchParams): Promise<Question[]> {
  const batchStart = Date.now();
  const questions = await generateBatch({
    courseText: params.courseText,
    plannedQuestions: params.batch,
    previousQuestions: [], // Parallel batches — dedup is ensured by blueprint slicing
    schoolLevel: params.schoolLevel,
    difficulty: params.difficulty,
    specificSubject: params.specificSubject,
    coursesOnly: params.coursesOnly,
  });
  logger.log(
    `[QuizPipeline] Batch ${params.batchIdx + 1}/${params.totalBatches} done in ${Date.now() - batchStart}ms (${questions.length}/${params.batch.length} questions)`,
  );
  return questions;
}

function splitIntoBatches<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}
