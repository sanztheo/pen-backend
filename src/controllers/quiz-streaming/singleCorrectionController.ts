import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { redis } from "../../lib/redis.js";
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
import type { QuizWithExtras } from "./types.js";

const correctSingleSchema = z.object({
  questionId: z.string().min(1),
  answer: z.union([
    z.string().max(10000),
    z.array(z.string()),
    z.boolean(),
    z.array(z.object({ leftId: z.string(), rightId: z.string() })),
  ]),
  timeSpent: z.number().int().min(0).max(86400).optional(),
});

/**
 * Corrects a single question during quiz-taking (pipeline correction).
 *
 * Called for each question as the user answers, enabling real-time feedback
 * without waiting for the full quiz to be submitted.
 */
export async function correctSingleQuestion(req: Request, res: Response): Promise<void> {
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
    const parsed = correctSingleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Données invalides" });
      return;
    }
    const { questionId, answer, timeSpent } = parsed.data;

    logger.info(
      `[PIPELINE-CORRECTION] Correction single question ${questionId} for quiz ${quizId}`,
    );

    // Fetch quiz and validate ownership (select only needed columns)
    const quiz = await prisma.quiz.findFirst({
      where: { id: quizId, userId },
      select: {
        id: true,
        questions: true,
        schoolLevel: true,
        hasDocuments: true,
        preset: true,
        sourceDocuments: true,
      },
    });

    if (!quiz) {
      res.status(404).json({ error: "Quiz non trouvé" });
      return;
    }

    // Extract questions from quiz JSON
    const questions = (Array.isArray(quiz.questions)
      ? quiz.questions
      : []) as unknown as Question[];

    // Find the specific question
    const question = questions.find((q) => q.id === questionId);
    if (!question) {
      res.status(404).json({ error: "Question non trouvée dans ce quiz" });
      return;
    }

    // Check for duplicate correction via Redis — SADD is the atomic gate (1=new, 0=duplicate)
    const correctedKey = `quiz:${quizId}:corrected`;
    try {
      const added = await redis.sadd(correctedKey, questionId);
      await redis.expire(correctedKey, 14400); // 4h TTL
      if (added === 0) {
        res.status(409).json({ error: "Question déjà corrigée" });
        return;
      }
    } catch (redisErr) {
      logger.warn("[PIPELINE-CORRECTION] Redis duplicate check failed (non-blocking):", redisErr);
    }

    // Build UserAnswer
    const userAnswer: UserAnswer = {
      questionId,
      answer,
      timeSpent: timeSpent || 0,
    };

    // Persist user_answers BEFORE LLM call — fire-and-forget so answer is never lost on timeout
    prisma.$executeRaw`
        UPDATE quizzes
        SET user_answers = COALESCE(user_answers, '[]'::jsonb) || ${JSON.stringify([userAnswer])}::jsonb,
            updated_at = NOW()
        WHERE id = ${quizId}::uuid AND "user_id" = ${userId}
      `.catch((dbErr) =>
      logger.warn("[PIPELINE-CORRECTION] DB user_answers persist failed (non-blocking):", dbErr),
    );

    // Build QuizCorrectionRequest
    const quizExtras = quiz as unknown as QuizWithExtras;
    const correctionRequest: QuizCorrectionRequest = {
      quizId,
      userId,
      userAnswers: [userAnswer],
      submittedAt: new Date(),
      preset: (quizExtras.preset as QuizPreset) || QuizPreset.NONE,
      specificSubject: quizExtras.specificSubject as ExamSubject | undefined,
      schoolLevel: (quiz.schoolLevel as SchoolLevel) || SchoolLevel.COLLEGE,
      hasDocuments: quiz.hasDocuments || false,
      sourceDocuments: (quizExtras.sourceDocuments as DocumentChunk[]) || [],
      coursesOnly: false,
      workspaceContent: [],
    };

    // Correct the single question
    const correction = await CorrectionGenerator.correctSingle(
      question,
      userAnswer,
      correctionRequest,
    );

    // Persist correction: Redis (fast read) + DB (durability) — non-blocking on failure
    const correctionJson = JSON.stringify(correction);
    const pipelineKey = `quiz:${quizId}:pipeline:${questionId}`;

    try {
      // sadd/expire already done at the gate — only persist the correction result here
      await redis.set(pipelineKey, correctionJson, "EX", 14400); // 4h TTL
    } catch (redisErr) {
      logger.warn("[PIPELINE-CORRECTION] Redis persist failed (non-blocking):", redisErr);
    }

    // Save pipeline_corrections to DB for crash recovery (non-blocking — don't fail the response)
    // user_answers was already written before the LLM call above
    prisma.$executeRaw`
        UPDATE quizzes
        SET pipeline_corrections = COALESCE(pipeline_corrections, '{}'::jsonb) || ${JSON.stringify({ [questionId]: correction })}::jsonb,
            updated_at = NOW()
        WHERE id = ${quizId}::uuid AND "user_id" = ${userId}
      `.catch((dbErr) =>
      logger.warn(
        "[PIPELINE-CORRECTION] DB pipeline_corrections persist failed (non-blocking):",
        dbErr,
      ),
    );

    logger.info(
      `[PIPELINE-CORRECTION] Question ${questionId} corrected & persisted: score ${correction.score}/${correction.maxScore}`,
    );

    res.json({ correction });
  } catch (error) {
    logger.error("[PIPELINE-CORRECTION] Erreur correction single question:", error);
    res.status(500).json({ error: "Erreur lors de la correction de la question" });
  }
}
