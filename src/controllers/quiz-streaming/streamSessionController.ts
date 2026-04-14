import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { CLIENT_URL } from "../../utils/config.js";
import { prisma } from "../../lib/prisma.js";
import { logger } from "../../utils/logger.js";
import { setupSSEHeaders } from "../../utils/sse.js";
import { OpenAIAssistantService } from "../../services/quiz/assistant/index.js";
import { SessionManager } from "./sessionManager.js";
import { createSSESenderWithDisconnect } from "./sseFactory.js";
import { validateGenerateParams } from "./validators.js";
import {
  resolvePersonalization,
  callPreprocessorIfNeeded,
  checkPremiumIntelligent,
} from "./parameterResolver.js";
import {
  generateOrUseTitle,
  createQuizInDb,
  prepareIntelligentContextIfNeeded,
} from "./quizSetup.js";
import { buildTypeDistribution, buildSpecialtyDistribution, getSpecialtyLabel } from "./utils.js";
import { executeQuizPipeline } from "./quizPipeline.js";
// Legacy generators kept in codebase but no longer called from this controller:
// import { generateQuestionsStandard } from "./standardGenerator.js";
// import { generateQuestionsIntelligent } from "./intelligentGenerator.js";

// ============================================================================
// 1. Create streaming session
// ============================================================================

export async function createStreamingSession(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: "Utilisateur non authentifié" });
      return;
    }

    const validation = validateGenerateParams(req.body);
    if (!validation.valid) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const sessionId = SessionManager.create(userId, req.body);

    logger.log(`[STREAM-SESSION] Session created: ${sessionId} for user: ${userId}`);
    logger.log(
      `[STREAM-SESSION] ragContext: ${req.body.ragContext ? `${req.body.ragContext.length} chars` : "none"}, ` +
        `pages: ${req.body.pageProjectIds?.length ?? 0}`,
    );

    res.status(200).json({ success: true, sessionId });
  } catch (error) {
    logger.error("[STREAM-SESSION] Error creating session:", error);
    res.status(500).json({
      error: "Erreur lors de la création de la session",
    });
  }
}

// ============================================================================
// 2. Stream quiz generation (SSE orchestrator)
// ============================================================================

export async function streamQuizGeneration(req: Request, res: Response): Promise<void> {
  const sessionId = req.params.sessionId;

  // --- 1. Setup SSE headers + CORS ---
  const allowedOrigins = CLIENT_URL.split(",");
  const requestOrigin = req.headers.origin || "";
  const corsOrigin = allowedOrigins.includes(requestOrigin) ? requestOrigin : allowedOrigins[0];
  setupSSEHeaders(res, {
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Headers": "Cache-Control",
  });

  const abortController = new AbortController();
  const { send: sendSSE, markDisconnected, isDisconnected } = createSSESenderWithDisconnect(res);

  req.on("close", () => {
    if (!abortController.signal.aborted) {
      markDisconnected();
      abortController.abort();
      logger.log(
        `[STREAM-SESSION] Client disconnected, aborting generation (session: ${sessionId})`,
      );
    }
  });

  sendSSE("connected", { message: "Connexion SSE établie" });

  // --- 2. Validate JWT token from query params ---
  const token = req.query.token as string;
  if (!token) {
    sendSSE("error", { message: "Token manquant" });
    res.end();
    return;
  }

  // Verify session exists BEFORE JWT validation
  const session = SessionManager.get(sessionId);
  if (!session) {
    sendSSE("error", { message: "Session non trouvée ou expirée" });
    res.end();
    return;
  }

  // JWT validation + ownership check
  try {
    const { AuthService } = await import("../../services/auth.js");
    const user = await AuthService.verifyToken(token);
    if (!user || user.id !== session.userId) {
      sendSSE("error", {
        message: "Authentification requise - Token invalide ou non autorisé",
      });
      res.end();
      return;
    }
    logger.log(`[STREAM-SESSION] JWT validated for user ${user.id}, session: ${sessionId}`);
  } catch (error) {
    logger.error("[STREAM-SESSION] JWT validation failed:", error);
    sendSSE("error", { message: "Token invalide ou expiré" });
    res.end();
    return;
  }

  // --- 3. Anti-replay: delete session immediately ---
  SessionManager.delete(sessionId);
  logger.log(`[STREAM-SESSION] Session ${sessionId} deleted (anti-replay)`);

  try {
    // --- Session parameter recovery ---
    const {
      subject: sessionSubject,
      schoolLevel: bodySchoolLevel,
      questionTypes: bodyQuestionTypes = ["MULTIPLE_CHOICE"],
      questionCount: bodyQuestionCount = 10,
      collegeGrade,
      lyceeSpecialties,
      higherEdLevel,
      higherEdField,
      preset,
      title,
      description,
      coursesOnly,
      ragContext,
      pageProjectIds,
      specificSubject,
      sequentialConfig,
      generationNote,
      targetGrade,
      timeLimit,
      difficulty: bodyDifficulty,
      useIntelligentGeneration: requestUseIntelligent = false,
      usePersonalization = false,
      letAIChoose = false,
    } = session.request;

    const userId = session.userId;
    const questionTypes = bodyQuestionTypes;
    const pageCount = pageProjectIds?.length ?? 0;

    logger.log(
      `[STREAM-SESSION] Session ${sessionId} recovered — ` +
        `ragContext: ${ragContext ? `${ragContext.length} chars` : "none"}, ` +
        `pages: ${pageCount}, personalization: ${usePersonalization}, letAIChoose: ${letAIChoose}`,
    );

    // --- 4. Resolve parameters ---
    const schoolLevel = await resolvePersonalization(userId, bodySchoolLevel, usePersonalization);

    const preprocessorResult = await callPreprocessorIfNeeded({
      letAIChoose,
      pageProjectIds: pageProjectIds || [],
      userId,
      schoolLevel,
      questionCount: bodyQuestionCount,
      difficulty: bodyDifficulty,
      sendSSE,
    });

    const questionCount = preprocessorResult.questionCount;
    const difficulty = preprocessorResult.difficulty;
    const preprocessorTypeDistribution = preprocessorResult.typeDistribution;

    const useIntelligentGeneration = await checkPremiumIntelligent(
      userId,
      requestUseIntelligent,
      pageCount,
    );

    // --- 5. Log generation summary ---
    logger.log(`\n${"═".repeat(60)}`);
    logger.log(
      `QUIZ GENERATION - MODE: ${useIntelligentGeneration ? "INTELLIGENT (Premium)" : "STANDARD"}`,
    );
    logger.log(`${"═".repeat(60)}`);
    logger.log(`   User: ${userId}`);
    logger.log(
      `   School Level: ${schoolLevel}${higherEdLevel ? ` (${higherEdLevel})` : ""}${higherEdField ? ` - ${higherEdField}` : ""}`,
    );
    logger.log(`   Questions: ${questionCount}`);
    logger.log(`   Pages: ${pageCount}`);
    logger.log(`   Intelligence: ${useIntelligentGeneration ? "ON" : "OFF"}`);
    if (!useIntelligentGeneration && pageCount >= 2) {
      logger.log(`   Reason: Non-premium user (intelligent requires Premium + 2 pages)`);
    } else if (!useIntelligentGeneration && pageCount < 2) {
      logger.log(`   Reason: Less than 2 pages selected`);
    }
    logger.log(`${"═".repeat(60)}\n`);

    // --- 6. Quiz setup ---
    const quizTitle = await generateOrUseTitle({
      userId,
      title,
      schoolLevel,
      pageProjectIds,
      subject: sessionSubject || specificSubject,
      specificSubject,
      questionCount,
      difficulty,
    });

    const quiz = await createQuizInDb({
      userId,
      title: quizTitle,
      schoolLevel,
      preset,
      collegeGrade,
      higherEdField,
      subject: sessionSubject,
    });

    sendSSE("quiz-created", {
      quizId: quiz.id,
      message: `Quiz créé avec succès. Génération de ${questionCount} questions...`,
    });

    logger.log(`[STREAM-SESSION] Quiz ${quiz.id} created, generating questions...`);

    const { intelligentContext, questionDistribution } = await prepareIntelligentContextIfNeeded({
      useIntelligentGeneration,
      pageProjectIds: pageProjectIds || [],
      questionCount,
      ragContext,
      sendSSE,
    });

    // --- 7. Build distributions ---
    const typeDistribution = buildTypeDistribution(
      questionTypes,
      questionCount,
      preprocessorTypeDistribution,
    );
    const specialtyDistribution = buildSpecialtyDistribution(lyceeSpecialties, questionCount);

    if (specialtyDistribution.length > 0) {
      const specialtySummary = specialtyDistribution.reduce<Record<string, number>>(
        (acc, specialty) => {
          const label = getSpecialtyLabel(specialty) || specialty;
          acc[label] = (acc[label] || 0) + 1;
          return acc;
        },
        {},
      );
      logger.log("[STREAM-SESSION] Specialty distribution:", specialtySummary);
    }

    // --- 8. Generate questions ---
    const assistantService = new OpenAIAssistantService();
    const effectiveRagContext = intelligentContext
      ? intelligentContext.enrichedRagContext
      : ragContext;

    const baseRequest: Record<string, unknown> = {
      userId,
      subject: sessionSubject,
      schoolLevel,
      questionCount: 1,
      collegeGrade,
      lyceeSpecialties: lyceeSpecialties || [],
      allLyceeSpecialties: lyceeSpecialties || [],
      higherEdField,
      preset,
      specificSubject,
      sequentialConfig,
      targetGrade,
      pageProjectIds: pageProjectIds || [],
      title,
      description,
      coursesOnly,
      ragContext: effectiveRagContext,
      timeLimit,
      difficulty,
    };

    // Pipeline v5: ALWAYS use blueprint-guided batch generation
    // Replaces both standardGenerator and intelligentGenerator
    logger.log(
      `[STREAM-SESSION] Using pipeline v5 (${pageCount} pages, subject: ${specificSubject || sessionSubject || "none"})`,
    );

    const generatedQuestions = await executeQuizPipeline({
      userId,
      pageIds: pageProjectIds || [],
      questionCount,
      questionTypes,
      difficulty,
      generationNote,
      schoolLevel,
      specificSubject: specificSubject || sessionSubject,
      coursesOnly,
      quizId: quiz.id,
      sendSSE,
      prisma,
      isDisconnected,
    });

    // --- 9. Finalize quiz ---
    const finalQuiz = await prisma.quiz.update({
      where: { id: quiz.id },
      data: {
        status: "ready",
        questions: generatedQuestions as unknown as Prisma.InputJsonValue,
      },
    });

    // --- 10. Send completion SSE + log summary ---
    sendSSE("quiz-completed", {
      quizId: quiz.id,
      totalQuestionsGenerated: generatedQuestions.length,
      totalQuestionsRequested: questionCount,
      message: "Quiz généré avec succès via Chat Completion !",
      quiz: finalQuiz,
    });

    logger.log(`\n${"═".repeat(60)}`);
    logger.log(`QUIZ GENERATION COMPLETE`);
    logger.log(`${"═".repeat(60)}`);
    logger.log(`   Quiz ID: ${quiz.id}`);
    logger.log(`   Questions generated: ${generatedQuestions.length}/${questionCount}`);
    logger.log(`   Intelligence: ${useIntelligentGeneration ? "USED" : "NOT USED"}`);
    if (useIntelligentGeneration && intelligentContext) {
      logger.log(`   Clusters: ${intelligentContext.clusters.length}`);
      logger.log(`   Cluster names: ${intelligentContext.clusters.map((c) => c.name).join(", ")}`);
    }
    logger.log(`${"═".repeat(60)}\n`);
  } catch (error) {
    // --- 11. Error handling ---
    logger.error("[STREAM-SESSION] Generation error:", error);
    sendSSE("error", {
      message: "Erreur lors de la génération du quiz",
    });
  }

  // Close SSE connection
  sendSSE("end", { message: "Génération terminée" });
  res.end();
}
