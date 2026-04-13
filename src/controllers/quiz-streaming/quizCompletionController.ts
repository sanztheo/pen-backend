import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { logger } from "../../utils/logger.js";
import {
  Question,
  UserAnswer,
  QuizCorrectionRequest,
  QuizPreset,
  ExamSubject,
  SchoolLevel,
  DocumentChunk,
} from "../../services/quiz/types.js";
import { CorrectionGenerator } from "../../services/quiz/generators/correctionGenerator.js";
import {
  CorrectionEnricherService,
  type EnrichmentConfig,
} from "../../services/quiz/intelligence/index.js";
import { invalidateQuizHistoryCache, redis } from "../../lib/redis.js";
import type { CorrectionResultItem, QuizWithExtras } from "./types.js";

const completeQuizSchema = z.object({
  answers: z
    .array(
      z.object({
        questionId: z.string().min(1),
        answer: z.union([
          z.string().max(10000),
          z.array(z.string()),
          z.boolean(),
          z.array(z.object({ leftId: z.string(), rightId: z.string() })),
        ]),
        timeSpent: z.number().int().min(0).optional(),
      }),
    )
    .min(1)
    .max(100),
});

/**
 * Finalizes a quiz after all individual corrections have been collected.
 *
 * Receives the accumulated corrections and answers, runs AI analysis,
 * enriches corrections with source references, persists results
 * in a transaction, and invalidates the history cache.
 */
export async function completeQuiz(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: "Utilisateur non authentifié" });
      return;
    }

    const { id: quizId } = req.params;
    if (!quizId) {
      res.status(400).json({ error: "quizId est requis" });
      return;
    }

    // Validate request body with Zod
    const parsed = completeQuizSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Données invalides" });
      return;
    }
    const { answers } = parsed.data;

    logger.info(
      `[QUIZ-COMPLETE] Finalizing quiz ${quizId} with ${answers.length} answers (server-side re-correction)`,
    );

    // Fetch quiz, validate ownership and not already completed (select only needed columns)
    const quiz = await prisma.quiz.findFirst({
      where: { id: quizId, userId, isCompleted: false },
      select: {
        id: true,
        questions: true,
        schoolLevel: true,
        hasDocuments: true,
        preset: true,
        sourceDocuments: true,
        pipelineCorrections: true,
      },
    });

    if (!quiz) {
      res.status(404).json({ error: "Quiz non trouvé ou déjà complété" });
      return;
    }

    // Extract questions from quiz JSON
    const questions = (Array.isArray(quiz.questions)
      ? quiz.questions
      : []) as unknown as Question[];

    // Build UserAnswer array
    const userAnswers: UserAnswer[] = answers.map((ans) => ({
      questionId: ans.questionId,
      answer: ans.answer,
      timeSpent: ans.timeSpent || 0,
    }));

    // Build QuizCorrectionRequest
    const quizExtras = quiz as unknown as QuizWithExtras;
    const correctionRequest: QuizCorrectionRequest = {
      quizId,
      userId,
      userAnswers,
      submittedAt: new Date(),
      preset: (quizExtras.preset as QuizPreset) || QuizPreset.NONE,
      specificSubject: quizExtras.specificSubject as ExamSubject | undefined,
      schoolLevel: (quiz.schoolLevel as SchoolLevel) || SchoolLevel.COLLEGE,
      hasDocuments: quiz.hasDocuments || false,
      sourceDocuments: (quizExtras.sourceDocuments as DocumentChunk[]) || [],
      coursesOnly: false,
      workspaceContent: [],
    };

    // Load cached corrections from pipeline (Redis first, DB fallback)
    type CorrectionResult = Awaited<ReturnType<typeof CorrectionGenerator.correctSingle>>;
    const cachedCorrections = new Map<string, CorrectionResult>();

    // Try Redis batch read
    try {
      const redisKeys = questions.map((q) => `quiz:${quizId}:pipeline:${q.id}`);
      const redisValues = await redis.mget(...redisKeys);
      for (let i = 0; i < questions.length; i++) {
        const raw = redisValues[i];
        if (raw) {
          cachedCorrections.set(questions[i].id, JSON.parse(raw));
        }
      }
    } catch (redisErr) {
      logger.warn("[QUIZ-COMPLETE] Redis batch read failed (will use DB fallback):", redisErr);
    }

    // DB fallback for any missing corrections
    if (cachedCorrections.size < questions.length && quiz.pipelineCorrections) {
      const dbCorrections = quiz.pipelineCorrections as Record<string, unknown>;
      for (const question of questions) {
        if (!cachedCorrections.has(question.id) && dbCorrections[question.id]) {
          cachedCorrections.set(question.id, dbCorrections[question.id] as CorrectionResult);
        }
      }
    }

    const cacheHits = cachedCorrections.size;
    const cacheMisses = questions.length - cacheHits;
    logger.info(
      `[QUIZ-COMPLETE] Pipeline cache: ${cacheHits} hits, ${cacheMisses} misses for quiz ${quizId}`,
    );

    // Only re-correct questions that have no cached correction
    const serverCorrections = await Promise.all(
      questions.map(async (question) => {
        const cached = cachedCorrections.get(question.id);
        if (cached) return cached;

        // Fallback: re-correct (closed questions are instant, open questions hit LLM)
        const userAnswer = userAnswers.find((a) => a.questionId === question.id);
        return CorrectionGenerator.correctSingle(question, userAnswer, correctionRequest);
      }),
    );
    logger.info(
      `[QUIZ-COMPLETE] Corrections ready: ${serverCorrections.length} total (${cacheHits} cached, ${cacheMisses} re-corrected)`,
    );

    // Finalize corrections: sort, recalculate scores, generate AI analysis
    const { sortedCorrections, scores, analysis } = await CorrectionGenerator.finalizeCorrections(
      questions,
      serverCorrections,
      correctionRequest,
    );

    // Enrich corrections with source references
    let enrichedCorrections: CorrectionResultItem[] =
      sortedCorrections as unknown as CorrectionResultItem[];
    try {
      logger.info(`[QUIZ-COMPLETE] Enriching ${sortedCorrections.length} corrections...`);

      const enrichConfig: EnrichmentConfig = {
        userId,
        workspaceId: undefined,
        maxReferencesPerQuestion: 2,
        minRelevanceThreshold: 0.35,
        enableConceptSuggestions: true,
      };

      const enrichResult = await CorrectionEnricherService.enrichCorrections(
        questions,
        sortedCorrections as unknown as Parameters<
          typeof CorrectionEnricherService.enrichCorrections
        >[1],
        enrichConfig,
      );
      enrichedCorrections = enrichResult as unknown as CorrectionResultItem[];

      const enrichedCount = enrichedCorrections.filter(
        (c: CorrectionResultItem) => c.isEnriched,
      ).length;
      if (enrichedCount > 0) {
        logger.info(
          `[QUIZ-COMPLETE] ${enrichedCount}/${enrichedCorrections.length} corrections enriched`,
        );
      }
    } catch (enrichError) {
      logger.warn("[QUIZ-COMPLETE] Enrichment failed (non-blocking):", enrichError);
      // Continue with non-enriched corrections
    }

    // Persist in atomic transaction
    const quizResult = await prisma.$transaction(async (tx) => {
      // Mark quiz as completed
      await tx.quiz.update({
        where: { id: quizId },
        data: {
          isCompleted: true,
          completedAt: new Date(),
          updatedAt: new Date(),
        },
      });

      // Create quiz result
      const result = await tx.quizResult.create({
        data: {
          quizId,
          totalScore: scores.totalScore,
          maxScore: scores.maxScore,
          percentage: scores.percentage,
          adaptedGrade: scores.adaptedGrade,
          gradeScale: "/20",
          detailedScoring: enrichedCorrections as unknown as Prisma.InputJsonValue,
          aiCorrection: {
            globalFeedback: analysis.summary,
            strengths: analysis.strengths,
            weaknesses: analysis.weaknesses,
            recommendations: analysis.recommendations,
          } as unknown as Prisma.InputJsonValue,
          recommendations: analysis.recommendations as unknown as Prisma.InputJsonValue,
        },
      });

      return result;
    });

    logger.info(`[QUIZ-COMPLETE] Quiz ${quizId} completed and saved to DB`);

    // Invalidate quiz history cache
    invalidateQuizHistoryCache(userId).catch((err) =>
      logger.warn("[QUIZ-COMPLETE] Cache invalidation failed:", err),
    );

    res.json({
      quizId,
      result: {
        id: quizResult.id,
        totalScore: scores.totalScore,
        maxScore: scores.maxScore,
        percentage: scores.percentage,
        adaptedGrade: scores.adaptedGrade,
      },
      analysis: {
        summary: analysis.summary,
        strengths: analysis.strengths,
        weaknesses: analysis.weaknesses,
        recommendations: analysis.recommendations,
        personalizedTips: analysis.personalizedTips,
      },
    });
  } catch (error) {
    logger.error("[QUIZ-COMPLETE] Erreur finalisation quiz:", error);
    res.status(500).json({ error: "Erreur lors de la finalisation du quiz" });
  }
}
