/**
 * Quiz Pipeline Orchestrator — 4-stage SSE pipeline for quiz generation.
 * Analyze → Plan → Generate (batch-of-5) → Done
 *
 * Replaces the per-question loop (standardGenerator) with a blueprint-guided
 * batch approach that produces higher quality, more diverse questions.
 */

import { Prisma } from "@prisma/client";
import { logger } from "../../utils/logger.js";
import { analyzeCourse } from "../../services/quiz/intelligence/courseAnalyzer.js";
import { planQuiz } from "../../services/quiz/intelligence/quizPlanner.js";
import type { QuizPlanConfig } from "../../services/quiz/intelligence/quizPlanner.js";
import { generateBatch } from "./batchQuestionGenerator.js";
import { extractPageText } from "./extractPageText.js";
import type { Question } from "../../services/quiz/types.js";
import type { SSESender } from "./types.js";

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

/** How many questions to generate per LLM call */
const BATCH_SIZE = 5;

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
  logger.log(
    `[QuizPipeline] Starting 4-stage pipeline for quiz ${quizId} (${questionCount} questions)`,
  );

  // =========================================================================
  // Stage 1 — Analyze
  // =========================================================================
  sendSSE("analyzing", { message: "Analyzing course content..." });

  const pages = await prisma.page.findMany({
    where: { id: { in: pageIds } },
    select: { id: true, title: true, blockNoteContent: true },
  });

  if (pages.length === 0) {
    throw new Error("[QuizPipeline] No pages found for provided pageIds");
  }

  const { courseText, courseTitle } = extractPageText(pages);
  const conceptMap = await analyzeCourse(courseText, courseTitle);

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
  // Stage 3 — Generate (batch-of-5)
  // =========================================================================
  sendSSE("generating", { message: "Generating questions..." });

  const generatedQuestions: Question[] = [];
  const batches = splitIntoBatches(blueprint.questions, BATCH_SIZE);

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    if (isDisconnected?.()) {
      logger.log(`[QuizPipeline] Client disconnected at batch ${batchIdx + 1}/${batches.length}`);
      break;
    }

    const batch = batches[batchIdx];

    try {
      const batchQuestions = await generateBatch({
        courseText,
        plannedQuestions: batch,
        previousQuestions: generatedQuestions,
        schoolLevel,
        difficulty,
        specificSubject,
        coursesOnly,
      });

      // Emit SSE for each question in the batch
      for (let qi = 0; qi < batchQuestions.length; qi++) {
        const question = batchQuestions[qi];
        const globalIndex = generatedQuestions.length + qi + 1;
        const isFirstQuestion = generatedQuestions.length === 0 && qi === 0;

        sendSSE("question-generated", {
          questionNumber: globalIndex,
          totalQuestions: questionCount,
          question,
          canStartAnswering: isFirstQuestion,
          message: `Question ${globalIndex}/${questionCount} generated`,
        });
      }

      generatedQuestions.push(...batchQuestions);

      // Save to DB after each batch (partial progress)
      await prisma.quiz.update({
        where: { id: quizId },
        data: {
          questions: generatedQuestions as unknown as Prisma.InputJsonValue,
        },
      });

      logger.log(
        `[QuizPipeline] Batch ${batchIdx + 1}/${batches.length} saved (${generatedQuestions.length}/${questionCount} total)`,
      );
    } catch (error) {
      logger.error(
        `[QuizPipeline] Batch ${batchIdx + 1} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      sendSSE("question-error", {
        error: `Batch ${batchIdx + 1} failed`,
        message: `Error generating questions batch ${batchIdx + 1}`,
      });

      // Save whatever we have so far, then re-throw
      if (generatedQuestions.length > 0) {
        await prisma.quiz.update({
          where: { id: quizId },
          data: {
            questions: generatedQuestions as unknown as Prisma.InputJsonValue,
          },
        });
      }
      throw error;
    }
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

function splitIntoBatches<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}
