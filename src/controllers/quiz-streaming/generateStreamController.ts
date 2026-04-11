import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { CLIENT_URL } from "../../utils/config.js";
import { prisma } from "../../lib/prisma.js";
import { prismaEmbeddings } from "../../lib/prismaEmbeddings.js";
import { logger } from "../../utils/logger.js";
import { setupSSEHeaders } from "../../utils/sse.js";
import { OpenAIAssistantService } from "../../services/quiz/assistant/index.js";
import { QuizLimitsService } from "../../services/credits/quizLimitsService.js";
import { generateQuizTitle } from "../../services/quiz/utils/titleGenerator.js";
import { SUBSCRIPTION_LIMITS } from "../../services/quiz/preprocessor/constants.js";
import { normalizePlan } from "../../utils/plans.js";
import { validateGenerateParams } from "./validators.js";
import { createSSESenderWithDisconnect } from "./sseFactory.js";
import { generateQuestionsStandard } from "./standardGenerator.js";
import { buildTypeDistribution } from "./utils.js";

/**
 * Legacy direct-stream endpoint for quiz generation.
 * Does NOT use sessions, JWT query params, or preprocessor.
 * Generates questions one-by-one and streams them via SSE.
 */
export async function generateQuizStream(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: "Utilisateur non authentifié" });
      return;
    }

    const {
      subject,
      schoolLevel,
      preset,
      specificSubject,
      sequentialConfig,
      lyceeSpecialties,
      higherEdField,
      targetGrade,
      pageProjectIds,
      questionTypes,
      questionCount,
      title,
      description,
      coursesOnly,
      ragContext,
    } = req.body;

    // Debug: Verify RAG context reception
    logger.log(
      `🧠 [STREAMING-DEBUG] ragContext reçu: ${ragContext ? `${ragContext.length} caractères` : "VIDE ou undefined"}`,
    );
    logger.log(
      `🧠 [STREAMING-DEBUG] coursesOnly: ${coursesOnly}, pageProjectIds: ${pageProjectIds?.length || 0}`,
    );

    // Validate required parameters
    const validation = validateGenerateParams(req.body);
    if (!validation.valid) {
      res.status(400).json({ error: validation.error });
      return;
    }

    // Page selection limit check (Free: 2, Premium: 30)
    const pagesCount = pageProjectIds?.length || 0;
    if (pagesCount > 0) {
      const subscription = await prisma.userSubscription.findUnique({
        where: { userId },
        select: { plan: true },
      });

      const plan = normalizePlan(subscription?.plan);
      const maxPagesSelection = SUBSCRIPTION_LIMITS[plan].maxPagesSelection;

      if (pagesCount > maxPagesSelection) {
        logger.log(
          `❌ [STREAMING] Limite de pages dépassée: ${pagesCount} > ${maxPagesSelection} (plan: ${plan})`,
        );
        res.status(403).json({
          error: "Limite de sélection de pages dépassée",
          message:
            plan === "free_user"
              ? `Vous ne pouvez sélectionner que ${maxPagesSelection} pages. Passez à Premium pour sélectionner jusqu'à 30 pages.`
              : `Vous ne pouvez pas sélectionner plus de ${maxPagesSelection} pages.`,
          limitType: "pagesSelection",
          currentCount: pagesCount,
          maxAllowed: maxPagesSelection,
        });
        return;
      }

      logger.log(
        `✅ [STREAMING] Limite de pages OK: ${pagesCount}/${maxPagesSelection} (plan: ${plan})`,
      );
    }

    // Advanced quiz limit check (>30 questions AND >10 pages)
    if (questionCount > 30 && pagesCount > 10) {
      logger.log(
        `🎯 [STREAMING] Quiz avancé détecté: ${questionCount} questions, ${pagesCount} pages`,
      );

      const advancedQuizCheck = await QuizLimitsService.canCreateAdvancedQuiz(
        userId,
        questionCount,
        pagesCount,
      );

      if (!advancedQuizCheck.success || advancedQuizCheck.limitReached) {
        logger.log(`❌ [STREAMING] Limite quiz avancés atteinte:`, advancedQuizCheck.message);
        res.status(429).json({
          error: "Limite de quiz avancés atteinte",
          message: advancedQuizCheck.message,
          limitType: "advancedQuiz",
        });
        return;
      }

      logger.log(`✅ [STREAMING] Quiz avancé autorisé, limite OK`);
    }

    logger.log(`🚀 [STREAMING] Début génération streaming pour ${questionCount} questions`);

    // RAG chunk verification for selected pages (automatic embedding system)
    if (pageProjectIds && pageProjectIds.length > 0 && coursesOnly) {
      logger.log(
        `🔍 [STREAMING-RAG] Vérification chunks pour ${pageProjectIds.length} page(s) sélectionnée(s)`,
      );

      try {
        // Count available chunks for selected pages
        const chunksCount = await prismaEmbeddings.rAGChunk.count({
          where: {
            source: {
              sourceType: "WORKSPACE_PAGE",
              userId: userId,
              status: "COMPLETED",
              OR: pageProjectIds.map((pageId: string) => ({
                metadata: {
                  path: ["pageId"],
                  equals: pageId,
                },
              })),
            },
          },
        });

        logger.log(
          `📊 [STREAMING-RAG] Chunks disponibles: ${chunksCount} pour pages sélectionnées`,
        );

        if (chunksCount === 0) {
          logger.warn(
            `⚠️ [STREAMING-RAG] Aucun chunk trouvé pour les pages sélectionnées. Vérification des sources...`,
          );

          // RAG source diagnostics
          const ragSources = await prismaEmbeddings.rAGSource.findMany({
            where: {
              sourceType: "WORKSPACE_PAGE",
              userId: userId,
              OR: pageProjectIds.map((pageId: string) => ({
                metadata: {
                  path: ["pageId"],
                  equals: pageId,
                },
              })),
            },
            select: {
              id: true,
              title: true,
              status: true,
              totalChunks: true,
              errorMessage: true,
              metadata: true,
            },
            take: 30,
          });

          logger.log(`📋 [STREAMING-RAG] Sources RAG trouvées: ${ragSources.length}`);
          ragSources.forEach((source) => {
            logger.log(
              `   - "${source.title}": status=${source.status}, chunks=${source.totalChunks}, error="${source.errorMessage}"`,
            );
          });
        }
      } catch (error) {
        logger.error(`❌ [STREAMING-RAG] Erreur vérification chunks:`, error);
      }
    }

    // SSE configuration — restrict CORS to allowed origins
    const allowedOrigins = CLIENT_URL.split(",");
    const requestOrigin = req.headers.origin || "";
    const corsOrigin = allowedOrigins.includes(requestOrigin) ? requestOrigin : allowedOrigins[0];
    setupSSEHeaders(res, {
      "Access-Control-Allow-Origin": corsOrigin,
      "Access-Control-Allow-Headers": "Cache-Control",
    });

    // AbortController to cancel AI operations if client disconnects
    const abortController = new AbortController();
    const { send: sendSSE, markDisconnected, isDisconnected } = createSSESenderWithDisconnect(res);

    req.on("close", () => {
      if (!abortController.signal.aborted) {
        markDisconnected();
        abortController.abort();
        logger.log(
          `🚫 [STREAMING] Client déconnecté, annulation de la génération (userId: ${userId})`,
        );
      }
    });

    try {
      // Generate an intelligent title if none provided
      let quizTitle = title;
      if (!quizTitle) {
        // Retrieve page names if available
        let pageNames: string[] = [];
        if (pageProjectIds && pageProjectIds.length > 0) {
          const pages = await prisma.page.findMany({
            where: {
              id: { in: pageProjectIds },
              workspace: { members: { some: { userId } } },
              isArchived: false,
            },
            select: { title: true },
            take: 30,
          });
          pageNames = pages.map((p) => p.title).filter(Boolean);
        }

        quizTitle = await generateQuizTitle({
          schoolLevel,
          pageNames,
          subject: subject || specificSubject,
          questionCount,
        });
        logger.log(`[TITLE-GEN] Titre généré: "${quizTitle}"`);
      }

      // 1. Create quiz in DB with "generating" state
      const quiz = await prisma.quiz.create({
        data: {
          userId,
          title: quizTitle,
          schoolLevel,
          questions: [],
          isCompleted: false,
          preset: preset || "NONE",
          selectedSpecialties: lyceeSpecialties || [],
          higherEdField,
          subject: subject || undefined,
          status: "generating",
        },
      });

      // Send quiz ID
      sendSSE("quiz-created", {
        quizId: quiz.id,
        message: "Quiz créé, génération des questions...",
      });

      // 2. Generate questions using shared generator
      const assistantService = new OpenAIAssistantService();
      const typeDistribution = buildTypeDistribution(questionTypes, questionCount);

      const generatedQuestions = await generateQuestionsStandard({
        questionCount,
        typeDistribution,
        specialtyDistribution: [], // Legacy endpoint doesn't use specialty distribution
        baseRequest: {
          userId,
          subject,
          schoolLevel,
          preset,
          specificSubject,
          sequentialConfig,
          lyceeSpecialties: lyceeSpecialties || [],
          higherEdField,
          targetGrade,
          pageProjectIds: pageProjectIds || [],
          questionTypes,
          title,
          description,
          coursesOnly,
          ragContext,
        },
        quizId: quiz.id,
        sendSSE,
        assistantService,
        prisma,
        isDisconnected,
      });

      // 3. Finalize quiz (even if client disconnected, persist generated questions)
      const quizStatus = generatedQuestions.length > 0 ? "ready" : "failed";
      const finalQuiz = await prisma.quiz.update({
        where: { id: quiz.id },
        data: {
          status: quizStatus,
          questions: generatedQuestions as unknown as Prisma.InputJsonValue,
        },
      });

      if (isDisconnected()) {
        logger.log(
          `🚫 [STREAMING] Quiz ${quiz.id} finalisé après déconnexion client — ${generatedQuestions.length} questions sauvegardées (status: ${quizStatus})`,
        );
      }

      // Deduct advanced quiz if applicable (>30 questions AND >10 pages)
      if (questionCount > 30 && pagesCount > 10) {
        logger.log(`🎯 [STREAMING] Déduction quiz avancé pour utilisateur ${userId}`);
        const deductResult = await QuizLimitsService.deductAdvancedQuiz(userId);
        if (deductResult.success) {
          logger.log(
            `✅ [STREAMING] Quiz avancé déduit, restants: ${deductResult.remainingQuizzes}`,
          );
        } else {
          logger.warn(`⚠️ [STREAMING] Échec déduction quiz avancé:`, deductResult.message);
        }
      }

      // Send completion event
      sendSSE("quiz-completed", {
        quizId: quiz.id,
        totalQuestionsGenerated: generatedQuestions.length,
        totalQuestionsRequested: questionCount,
        message: "Quiz généré avec succès !",
        quiz: finalQuiz,
      });

      logger.log(
        `🎉 [STREAMING] Quiz ${quiz.id} complété avec ${generatedQuestions.length} questions`,
      );
    } catch (error) {
      logger.error("❌ [STREAMING] Erreur génération:", error);

      sendSSE("error", {
        message: "Erreur lors de la génération du quiz",
      });
    }

    // Close SSE connection
    sendSSE("end", { message: "Génération terminée" });
    res.end();
  } catch (error) {
    logger.error("❌ [STREAMING] Erreur contrôleur:", error);

    if (!res.headersSent) {
      res.status(500).json({
        error: "Erreur lors de l'initialisation du streaming",
      });
    }
  }
}
