import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { CLIENT_URL } from "../../utils/config.js";
import { prisma } from "../../lib/prisma.js";
import { logger } from "../../utils/logger.js";
import { setupSSEHeaders } from "../../utils/sse.js";
import {
  Question,
  UserAnswer,
  QuizCorrectionRequest,
  QuizPreset,
  ExamSubject,
  SchoolLevel,
  DocumentChunk,
} from "../../services/quiz/types.js";
import {
  CorrectionEnricherService,
  type EnrichmentConfig,
} from "../../services/quiz/intelligence/index.js";
import { validateCorrectionParams } from "./validators.js";
import { createSSESender } from "./sseFactory.js";
import type {
  CorrectionResultItem,
  QuizWithExtras,
  UserAnswerInput,
  SSEEventData,
} from "./types.js";

/**
 * Submit and correct a quiz via SSE streaming.
 *
 * Receives user answers, runs the correction generator (closed + open questions),
 * enriches corrections with source references, persists results in a transaction,
 * invalidates the history cache, and streams every step to the client.
 */
export async function submitAndCorrectStream(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: "Utilisateur non authentifié" });
      return;
    }

    const { quizId, answers, sourceDocuments } = req.body;

    const validation = validateCorrectionParams(req.body as Record<string, unknown>);
    if (!validation.valid) {
      res.status(400).json({ error: validation.error });
      return;
    }

    // Récupérer le quiz et valider ownership
    const quiz = await prisma.quiz.findFirst({
      where: {
        id: quizId,
        userId,
      },
    });

    if (!quiz) {
      res.status(404).json({ error: "Quiz non trouvé" });
      return;
    }

    // Configuration SSE — restrict CORS to allowed origins
    const allowedOrigins = CLIENT_URL.split(",");
    const requestOrigin = req.headers.origin || "";
    const corsOrigin = allowedOrigins.includes(requestOrigin) ? requestOrigin : allowedOrigins[0];
    setupSSEHeaders(res, {
      "Access-Control-Allow-Origin": corsOrigin,
      "Access-Control-Allow-Headers": "Cache-Control",
    });

    // Fonction pour envoyer des événements SSE
    const sendSSE = createSSESender(res);

    try {
      // Signaler le début de la correction
      sendSSE("correction-started", {
        quizId,
        message: "Correction en cours...",
      });

      logger.log(`🚀 [CORRECTION-STREAMING] Début correction quiz ${quizId}`);

      // Récupérer les questions du quiz
      const questions = (Array.isArray(quiz.questions)
        ? quiz.questions
        : []) as unknown as Question[];

      // Convertir les answers du frontend en UserAnswer[]
      const userAnswers: UserAnswer[] = answers.map((ans: UserAnswerInput) => ({
        questionId: ans.questionId,
        answer: ans.answer,
        timeSpent: ans.timeSpent || 0,
      }));

      // Tracker toutes les corrections pour la sauvegarde
      const allCorrections: CorrectionResultItem[] = [];

      // Construire la requête de correction
      const quizExtras = quiz as unknown as QuizWithExtras;
      const correctionRequest: QuizCorrectionRequest = {
        quizId,
        userId,
        userAnswers,
        submittedAt: new Date(),
        preset: (quizExtras.preset as QuizPreset) || QuizPreset.NONE,
        specificSubject: quizExtras.specificSubject as ExamSubject | undefined,
        schoolLevel: (quiz.schoolLevel as SchoolLevel) || SchoolLevel.COLLEGE,
        // Utiliser les sourceDocuments du quiz (pour la cohérence) ou ceux du body en fallback
        hasDocuments:
          quiz.hasDocuments || (Array.isArray(sourceDocuments) && sourceDocuments.length > 0),
        sourceDocuments: (quizExtras.sourceDocuments as DocumentChunk[]) || sourceDocuments || [],
        coursesOnly: false,
        workspaceContent: [],
      };

      // Utiliser le générateur de correction streaming
      const correctionGenerator =
        await import("../../services/quiz/generators/correctionGenerator.js");
      const generator = correctionGenerator.CorrectionGenerator.correctQuizStreaming(
        questions,
        userAnswers,
        correctionRequest,
      );

      // Itérer sur les événements du générateur
      for await (const event of generator) {
        if (event.type === "closed-questions") {
          const correctionCount = Array.isArray(event.correction) ? event.correction.length : 0;
          logger.log(`✅ [CORRECTION-STREAMING] ${correctionCount} questions fermées corrigées`);
          // Accumuler les corrections
          if (event.correction && Array.isArray(event.correction)) {
            allCorrections.push(...(event.correction as CorrectionResultItem[]));
          }
          sendSSE("closed-questions-corrected", {
            corrections: event.correction,
            count: correctionCount,
          });
        } else if (event.type === "open-question") {
          logger.log(
            `✅ [CORRECTION-STREAMING] Question ouverte ${event.questionNumber}/${event.totalOpenQuestions} corrigée`,
          );
          // Accumuler la correction
          if (event.correction) {
            if (Array.isArray(event.correction)) {
              allCorrections.push(...(event.correction as CorrectionResultItem[]));
            } else {
              allCorrections.push(event.correction as CorrectionResultItem);
            }
          }
          sendSSE("open-question-corrected", {
            questionNumber: event.questionNumber,
            totalOpenQuestions: event.totalOpenQuestions,
            correction: event.correction,
          });
        } else if (event.type === "completion") {
          logger.log(`🎉 [CORRECTION-STREAMING] Correction terminée`);

          // ⚡ Émettre l'analyse IA IMMÉDIATEMENT — déjà calculée dans finalResult.
          // Ne pas attendre l'enrichissement RAG ni le save DB pour libérer l'UX.
          if (event.finalResult) {
            sendSSE("ai-analysis", {
              summary: event.finalResult.aiCorrection?.globalFeedback || "",
              strengths: event.finalResult.aiCorrection?.strengths || [],
              weaknesses: event.finalResult.aiCorrection?.weaknesses || [],
              recommendations: event.finalResult.aiCorrection?.recommendations || [],
              personalizedTips: event.finalResult.metadata?.personalizedTips || [],
            });
          }

          // 📚 PEN-22: Enrichir les corrections avec références aux sources
          let enrichedCorrections: CorrectionResultItem[] = allCorrections;
          try {
            logger.log(`📚 [ENRICHER] Enrichissement de ${allCorrections.length} corrections...`);

            // Configuration pour l'enrichissement
            const enrichConfig: EnrichmentConfig = {
              userId,
              workspaceId: undefined, // Chercher dans toutes les sources de l'utilisateur
              maxReferencesPerQuestion: 2,
              minRelevanceThreshold: 0.35,
              enableConceptSuggestions: true,
            };

            const enrichResult = await CorrectionEnricherService.enrichCorrections(
              questions,
              allCorrections as unknown as Parameters<
                typeof CorrectionEnricherService.enrichCorrections
              >[1],
              enrichConfig,
            );
            enrichedCorrections = enrichResult as unknown as CorrectionResultItem[];

            // Envoyer les corrections enrichies au frontend
            const enrichedCount = enrichedCorrections.filter(
              (c: CorrectionResultItem) => c.isEnriched,
            ).length;
            if (enrichedCount > 0) {
              sendSSE("corrections-enriched", {
                enrichedCount,
                totalCorrections: enrichedCorrections.length,
                corrections: enrichedCorrections,
              });
              logger.log(
                `✅ [ENRICHER] ${enrichedCount}/${enrichedCorrections.length} corrections enrichies`,
              );
            }
          } catch (enrichError) {
            logger.warn(`⚠️ [ENRICHER] Erreur enrichissement (non bloquant):`, enrichError);
            // Continuer avec les corrections non enrichies
          }

          // Sauvegarder le résultat en base de données
          if (event.finalResult) {
            // Utiliser une transaction pour garantir la cohérence
            await prisma.$transaction(async (tx) => {
              // Marquer le quiz comme terminé
              await tx.quiz.update({
                where: { id: quizId },
                data: {
                  isCompleted: true,
                  completedAt: new Date(),
                  updatedAt: new Date(),
                },
              });

              // Créer le résultat du quiz
              await tx.quizResult.create({
                data: {
                  quizId,
                  totalScore: event.finalResult!.totalScore || 0,
                  maxScore: event.finalResult!.maxScore || 1,
                  percentage: event.finalResult!.percentage || 0,
                  adaptedGrade: event.finalResult!.adaptedGrade || 0,
                  gradeScale: event.finalResult!.gradeScale || "/20",
                  detailedScoring: enrichedCorrections as unknown as Prisma.InputJsonValue, // PEN-22: Utiliser les corrections enrichies
                  aiCorrection: event.finalResult!.aiCorrection as unknown as Prisma.InputJsonValue,
                  recommendations: (event.finalResult!.aiCorrection?.recommendations ??
                    []) as unknown as Prisma.InputJsonValue,
                },
              });
            });

            logger.log(`✅ [CORRECTION-STREAMING] Quiz et résultats sauvegardés en DB`);

            // 🗑️ Invalider le cache de l'historique après complétion du quiz
            const { invalidateQuizHistoryCache } = await import("../../lib/redis.js");
            invalidateQuizHistoryCache(userId).catch((err) =>
              logger.warn("⚠️ [CORRECTION-STREAMING] Échec invalidation cache:", err),
            );
          }

          sendSSE("correction-completed", {
            quizId,
            result: event.finalResult,
          });
        }
      }
    } catch (error) {
      logger.error("❌ [CORRECTION-STREAMING] Erreur génération:", error);

      sendSSE("error", {
        message: "Erreur lors de la correction du quiz",
      });
    }

    // Fermer la connexion SSE
    sendSSE("end", { message: "Correction terminée" });
    res.end();
  } catch (error) {
    logger.error("❌ [CORRECTION-STREAMING] Erreur contrôleur:", error);

    if (!res.headersSent) {
      res.status(500).json({
        error: "Erreur lors de l'initialisation du streaming de correction",
      });
    }
  }
}
