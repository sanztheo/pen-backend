import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { CLIENT_URL } from "../utils/config.js";
import { QuizService } from "../services/quiz/quizService.js";
import { logger } from "../utils/logger.js";
import { setupSSEHeaders } from "../utils/sse.js";
import { SchoolLevel, QuestionType, LyceeSpecialty, CollegeGrade } from "../services/quiz/types.js";
import { OpenAIAssistantService } from "../services/quiz/assistant/index.js";
import { prisma } from "../lib/prisma.js";
import { prismaEmbeddings } from "../lib/prismaEmbeddings.js";
import { v4 as uuidv4 } from "uuid";
import {
  Question,
  UserAnswer,
  QuizCorrectionRequest,
  QuizPreset,
  ExamSubject,
  DocumentChunk,
} from "../services/quiz/types.js";
import { QuizLimitsService } from "../services/credits/quizLimitsService.js";
import { PaddleBillingService } from "../services/billing/paddleBilling.js";
import {
  prepareIntelligentContext,
  getQuestionContext,
  createClustersDetectedEvent,
  QuestionScorerService,
  ContextCacheService,
  CorrectionEnricherService,
  type IntelligentContextResult,
  type ClusterQuestionDistribution,
  type EnrichmentConfig,
} from "../services/quiz/intelligence/index.js";
import {
  getUserPersonalization,
  mapToSchoolLevelEnum,
} from "../services/quiz/utils/personalizationUtils.js";
import { quizPreprocessorAgent } from "../services/quiz/preprocessor/QuizPreprocessorAgent.js";
import type { PreprocessorPromptParams } from "../services/quiz/preprocessor/prompts.js";
import { generateQuizTitle } from "../services/quiz/utils/titleGenerator.js";
import { SUBSCRIPTION_LIMITS } from "../services/quiz/preprocessor/constants.js";
import { normalizePlan } from "../utils/plans.js";

// ═══════════════════════════════════════════════════════════════════════════
// Types pour le streaming de quiz
// ═══════════════════════════════════════════════════════════════════════════

/** Données envoyées via Server-Sent Events */
interface SSEEventData {
  message?: string;
  quizId?: string;
  questionNumber?: number;
  totalQuestions?: number;
  question?: Question;
  quiz?: Record<string, unknown>;
  canStartAnswering?: boolean;
  error?: string;
  details?: string;
  [key: string]: unknown;
}

/** Requête de session de streaming */
interface StreamingSessionRequest {
  schoolLevel?: string;
  questionTypes?: string[];
  questionCount?: number;
  collegeGrade?: string;
  lyceeSpecialties?: LyceeSpecialty[];
  higherEdLevel?: string;
  higherEdField?: string;
  preset?: string;
  title?: string;
  description?: string;
  coursesOnly?: boolean;
  ragContext?: string;
  pageProjectIds?: string[];
  specificSubject?: string;
  sequentialConfig?: Record<string, unknown>;
  targetGrade?: number;
  timeLimit?: number;
  difficulty?: string;
  useIntelligentGeneration?: boolean;
  usePersonalization?: boolean;
  letAIChoose?: boolean;
}

/** Session de streaming stockée */
interface StreamingSession {
  userId: string;
  request: StreamingSessionRequest;
  createdAt: Date;
}

/** Résultat de correction d'une question (compatible avec QuestionResult et EnrichedQuestionResult) */
interface CorrectionResultItem {
  questionId: string;
  userAnswer?: string | boolean | string[] | Record<string, string>;
  correctAnswer?: string | boolean | string[] | Record<string, string>;
  score: number;
  maxScore: number;
  isCorrect: boolean;
  explanation?: string;
  feedback?: string;
  suggestion?: string;
  difficulty?: string;
  isEnriched?: boolean;
  sourceReferences?: Array<{
    pageId: string;
    pageTitle: string;
    relevantContent: string;
    relevanceScore: number;
  }>;
  conceptSuggestions?: string[];
  [key: string]: unknown;
}

/** Réponse utilisateur pour correction */
interface UserAnswerInput {
  questionId: string;
  answer: string | boolean | string[] | Record<string, string>;
  timeSpent?: number;
}

/** Bloc de contenu BlockNote */
interface BlockNoteBlock {
  type: string;
  content?: Array<{ text?: string }>;
  [key: string]: unknown;
}

/** Extension du type Quiz Prisma avec champs optionnels */
interface QuizWithExtras {
  preset?: string;
  specificSubject?: string;
  sourceDocuments?: unknown[];
}

// Stockage temporaire des sessions de streaming
const streamingSessions = new Map<string, StreamingSession>();

const LYCEE_SPECIALTY_LABELS: Record<LyceeSpecialty, string> = {
  [LyceeSpecialty.MATHEMATIQUES]: "Mathématiques",
  [LyceeSpecialty.PHYSIQUE_CHIMIE]: "Physique-Chimie",
  [LyceeSpecialty.SVT]: "Sciences de la Vie et de la Terre",
  [LyceeSpecialty.HISTOIRE_GEO]: "Histoire-Géographie",
  [LyceeSpecialty.SES]: "Sciences Économiques et Sociales",
  [LyceeSpecialty.LANGUES_LITTERATURE]: "Langues, littératures et cultures étrangères",
  [LyceeSpecialty.LLCER_ANGLAIS]: "LLCER Anglais",
  [LyceeSpecialty.LLCER_ESPAGNOL]: "LLCER Espagnol",
  [LyceeSpecialty.LLCER_ALLEMAND]: "LLCER Allemand",
  [LyceeSpecialty.LLCER_ITALIEN]: "LLCER Italien",
  [LyceeSpecialty.ARTS_PLASTIQUES]: "Arts Plastiques",
  [LyceeSpecialty.MUSIQUE]: "Musique",
  [LyceeSpecialty.THEATRE]: "Théâtre",
  [LyceeSpecialty.CINEMA_AUDIOVISUEL]: "Cinéma-Audiovisuel",
  [LyceeSpecialty.DANSE]: "Danse",
  [LyceeSpecialty.HISTOIRE_DES_ARTS]: "Histoire des Arts",
  [LyceeSpecialty.NSI]: "Numérique et Sciences Informatiques",
  [LyceeSpecialty.SI]: "Sciences de l'Ingénieur",
  [LyceeSpecialty.SCIENCES_INGENIEUR]: "Sciences de l'Ingénieur",
  [LyceeSpecialty.BIOLOGIE_ECOLOGIE]: "Biologie-Écologie",
  [LyceeSpecialty.SPORT]: "Éducation Physique et Sportive",
};

const getSpecialtyLabel = (specialty: LyceeSpecialty | undefined): string | undefined => {
  if (!specialty) {
    return undefined;
  }

  return LYCEE_SPECIALTY_LABELS[specialty] || specialty.replace(/_/g, " ");
};

const buildSpecialtyDistribution = (
  specialties: LyceeSpecialty[] | undefined,
  totalQuestions: number,
): LyceeSpecialty[] => {
  if (!specialties || specialties.length === 0 || totalQuestions <= 0) {
    return [];
  }

  const uniqueSpecialties = Array.from(new Set(specialties));
  if (uniqueSpecialties.length === 0) {
    return [];
  }

  const baseCount = Math.floor(totalQuestions / uniqueSpecialties.length);
  const remainder = totalQuestions % uniqueSpecialties.length;
  const counts = uniqueSpecialties.map((_, index) => baseCount + (index < remainder ? 1 : 0));

  const distribution: LyceeSpecialty[] = [];
  let pointer = 0;

  while (distribution.length < totalQuestions) {
    const index = pointer % uniqueSpecialties.length;
    if (counts[index] > 0) {
      distribution.push(uniqueSpecialties[index]);
      counts[index] -= 1;
    }
    pointer += 1;
  }

  return distribution;
};

// Nettoyer les sessions expirées (plus de 1 heure)
setInterval(
  () => {
    const now = new Date();
    for (const [sessionId, session] of streamingSessions.entries()) {
      if (now.getTime() - session.createdAt.getTime() > 60 * 60 * 1000) {
        streamingSessions.delete(sessionId);
      }
    }
  },
  5 * 60 * 1000,
); // Nettoyer toutes les 5 minutes

/**
 * Contrôleur pour le streaming de génération de quiz
 */
export class QuizStreamingController {
  /**
   * POST /api/quiz/generate-stream - Génère un quiz avec streaming des questions
   */
  static async generateQuizStream(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: "Utilisateur non authentifié" });
        return;
      }

      const {
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
        ragContext, // 🆕 Récupérer le contexte RAG
      } = req.body;

      // 🧠 Debug: Vérifier la réception du contexte RAG
      logger.log(
        `🧠 [STREAMING-DEBUG] ragContext reçu: ${ragContext ? `${ragContext.length} caractères` : "VIDE ou undefined"}`,
      );
      logger.log(
        `🧠 [STREAMING-DEBUG] coursesOnly: ${coursesOnly}, pageProjectIds: ${pageProjectIds?.length || 0}`,
      );

      // Validation des paramètres requis
      if (!schoolLevel || !questionTypes || !questionCount) {
        res.status(400).json({
          error: "Paramètres manquants: schoolLevel, questionTypes et questionCount sont requis",
        });
        return;
      }

      // Validation des enums
      if (!Object.values(SchoolLevel).includes(schoolLevel)) {
        res.status(400).json({ error: "Niveau scolaire invalide" });
        return;
      }

      if (
        !Array.isArray(questionTypes) ||
        !questionTypes.every((type) => Object.values(QuestionType).includes(type))
      ) {
        res.status(400).json({ error: "Types de questions invalides" });
        return;
      }

      if (questionCount < 1 || questionCount > 100) {
        res.status(400).json({ error: "Le nombre de questions doit être entre 1 et 100" });
        return;
      }

      // 🔐 Vérification de la limite de sélection de pages (Free: 2, Premium: 30)
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

      // 🔐 Vérification des limites de quiz avancés (>30 questions ET >10 pages)
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

      // 🧠 Vérification des chunks RAG si pages sélectionnées (système d'embedding automatique)
      if (pageProjectIds && pageProjectIds.length > 0 && coursesOnly) {
        logger.log(
          `🔍 [STREAMING-RAG] Vérification chunks pour ${pageProjectIds.length} page(s) sélectionnée(s)`,
        );

        try {
          // Compter les chunks disponibles pour les pages sélectionnées
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

            // Diagnostic des sources RAG
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

      // Configuration SSE
      setupSSEHeaders(res, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Cache-Control",
      });

      // AbortController pour annuler les opérations AI si le client se déconnecte
      const abortController = new AbortController();
      let clientDisconnected = false;

      req.on("close", () => {
        if (!abortController.signal.aborted) {
          clientDisconnected = true;
          abortController.abort();
          logger.log(
            `🚫 [STREAMING] Client déconnecté, annulation de la génération (userId: ${userId})`,
          );
        }
      });

      // Fonction pour envoyer des événements SSE (no-op si client déconnecté)
      const sendSSE = (event: string, data: SSEEventData): void => {
        if (clientDisconnected) return;
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      try {
        // 🎯 Générer un titre intelligent si non fourni
        let quizTitle = title;
        if (!quizTitle) {
          // Récupérer les noms des pages si disponibles
          let pageNames: string[] = [];
          if (pageProjectIds && pageProjectIds.length > 0) {
            const pages = await prisma.page.findMany({
              where: { id: { in: pageProjectIds } },
              select: { title: true },
            });
            pageNames = pages.map((p) => p.title).filter(Boolean);
          }

          quizTitle = await generateQuizTitle({
            schoolLevel,
            pageNames,
            subject: specificSubject,
            questionCount,
          });
          logger.log(`[TITLE-GEN] Titre généré: "${quizTitle}"`);
        }

        // 1. Créer le quiz en base avec état "generating"
        const quiz = await prisma.quiz.create({
          data: {
            userId,
            title: quizTitle,
            schoolLevel,
            questions: [], // Sera rempli progressivement
            isCompleted: false,
            preset: preset || "NONE",
            selectedSpecialties: lyceeSpecialties || [],
            higherEdField,
            status: "generating", // Nouvel état
          },
        });

        // Envoyer l'ID du quiz
        sendSSE("quiz-created", {
          quizId: quiz.id,
          message: "Quiz créé, génération des questions...",
        });

        // 2. Générer les questions une par une
        const assistantService = new OpenAIAssistantService();
        const generatedQuestions = [];

        // Construction de la requête de base
        const baseRequest = {
          userId,
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
          ragContext, // 🆕 Transmettre le contexte RAG à l'assistant
        };

        for (let i = 0; i < questionCount; i++) {
          // Arrêter la génération si le client s'est déconnecté
          if (clientDisconnected) {
            logger.log(
              `🚫 [STREAMING] Arrêt génération — client déconnecté après ${generatedQuestions.length}/${questionCount} questions`,
            );
            break;
          }

          try {
            logger.log(`📝 [STREAMING] Génération question ${i + 1}/${questionCount}`);

            // Envoyer le statut de génération
            sendSSE("question-generating", {
              questionNumber: i + 1,
              totalQuestions: questionCount,
              message: `Génération de la question ${i + 1}...`,
            });

            // Générer une seule question
            const singleQuestionRequest = {
              ...baseRequest,
              questionCount: 1, // Une seule question
              existingQuestions: generatedQuestions, // 🔧 Toujours passer les questions existantes
            };

            logger.log(
              `🧠 [STREAMING-DEBUG] Génération question ${i + 1} avec ${generatedQuestions.length} questions existantes`,
            );

            const questionResult =
              await assistantService.generateSingleQuestion(singleQuestionRequest);

            if (questionResult && questionResult.questions && questionResult.questions.length > 0) {
              const newQuestion = questionResult.questions[0];
              generatedQuestions.push(newQuestion);

              // Sauvegarder la question immédiatement en base
              await prisma.quiz.update({
                where: { id: quiz.id },
                data: {
                  questions: generatedQuestions as unknown as Prisma.InputJsonValue,
                },
              });

              // Envoyer la question générée au frontend
              sendSSE("question-generated", {
                questionNumber: i + 1,
                totalQuestions: questionCount,
                question: newQuestion,
                canStartAnswering: i === 0, // Permet de commencer après la première question
                message: `Question ${i + 1} générée avec succès`,
              });

              logger.log(`✅ [STREAMING] Question ${i + 1} générée et envoyée`);
            } else {
              throw new Error(`Échec génération question ${i + 1}`);
            }
          } catch (questionError) {
            logger.error(`❌ [STREAMING] Erreur question ${i + 1}:`, questionError);

            sendSSE("question-error", {
              questionNumber: i + 1,
              totalQuestions: questionCount,
              error: `Erreur lors de la génération de la question ${i + 1}`,
              canContinue: generatedQuestions.length > 0,
            });

            // Si on a déjà des questions, on peut continuer
            if (generatedQuestions.length === 0) {
              throw questionError;
            }
          }
        }

        // 3. Finaliser le quiz (même si le client s'est déconnecté, persister les questions générées)
        const quizStatus = generatedQuestions.length > 0 ? "ready" : "failed";
        const finalQuiz = await prisma.quiz.update({
          where: { id: quiz.id },
          data: {
            status: quizStatus,
            questions: generatedQuestions as unknown as Prisma.InputJsonValue,
          },
        });

        if (clientDisconnected) {
          logger.log(
            `🚫 [STREAMING] Quiz ${quiz.id} finalisé après déconnexion client — ${generatedQuestions.length} questions sauvegardées (status: ${quizStatus})`,
          );
        }

        // 🔐 Déduire un quiz avancé si applicable (>30 questions ET >10 pages)
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

        // Envoyer l'événement de fin
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
          details: error instanceof Error ? error.message : "Erreur inconnue",
        });
      }

      // Fermer la connexion SSE
      sendSSE("end", { message: "Génération terminée" });
      res.end();
    } catch (error) {
      logger.error("❌ [STREAMING] Erreur contrôleur:", error);

      if (!res.headersSent) {
        res.status(500).json({
          error: "Erreur lors de l'initialisation du streaming",
          details: error instanceof Error ? error.message : "Erreur inconnue",
        });
      }
    }
  }

  /**
   * GET /api/quiz/stream-status/:id - Vérifie le statut d'un quiz en cours de génération
   */
  static async getStreamStatus(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const quizId = req.params.id;

      if (!userId) {
        res.status(401).json({ error: "Utilisateur non authentifié" });
        return;
      }

      if (!quizId) {
        res.status(400).json({ error: "ID du quiz requis" });
        return;
      }

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

      res.status(200).json({
        success: true,
        data: {
          id: quiz.id,
          status: quiz.status || "ready",
          questionsGenerated: Array.isArray(quiz.questions) ? quiz.questions.length : 0,
          isCompleted: quiz.status === "ready",
        },
      });
    } catch (error) {
      logger.error("Erreur vérification statut streaming:", error);
      res.status(500).json({
        error: "Erreur lors de la vérification du statut",
        details: error instanceof Error ? error.message : "Erreur inconnue",
      });
    }
  }

  /**
   * POST /api/quiz/streaming-session - Crée une session de streaming
   */
  static async createStreamingSession(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: "Utilisateur non authentifié" });
        return;
      }

      const sessionId = uuidv4();

      // 🧠 Debug: Vérifier les données reçues dans la session
      logger.log(`🧠 [SESSION-DEBUG] Données reçues pour session ${sessionId}:`);
      logger.log(
        `  - ragContext: ${req.body.ragContext ? `${req.body.ragContext.length} chars` : "undefined/null"}`,
      );
      logger.log(`  - coursesOnly: ${req.body.coursesOnly}`);
      logger.log(`  - pageProjectIds: ${req.body.pageProjectIds?.length || 0}`);
      logger.log(`  - Body keys: ${Object.keys(req.body).join(", ")}`);

      // Stocker la session temporairement
      streamingSessions.set(sessionId, {
        userId,
        request: req.body,
        createdAt: new Date(),
      });

      logger.log(`📝 [STREAMING] Session créée: ${sessionId} pour user: ${userId}`);

      res.status(200).json({
        success: true,
        sessionId,
      });
    } catch (error) {
      logger.error("❌ [STREAMING] Erreur création session:", error);
      res.status(500).json({
        error: "Erreur lors de la création de la session",
        details: error instanceof Error ? error.message : "Erreur inconnue",
      });
    }
  }

  /**
   * GET /api/quiz/stream/:sessionId - Stream SSE pour la génération de quiz
   */
  static async streamQuizGeneration(req: Request, res: Response): Promise<void> {
    const sessionId = req.params.sessionId;

    // Configuration SSE AVANT toute vérification pour éviter les erreurs JSON
    const allowedOrigins = CLIENT_URL.split(",");
    const requestOrigin = req.headers.origin || "";
    const corsOrigin = allowedOrigins.includes(requestOrigin) ? requestOrigin : allowedOrigins[0];
    setupSSEHeaders(res, {
      "Access-Control-Allow-Origin": corsOrigin,
      "Access-Control-Allow-Headers": "Cache-Control",
    });

    // Fonction pour envoyer des événements SSE
    const sendSSE = (event: string, data: SSEEventData): void => {
      const eventData = `event: ${event}\n`;
      const dataData = `data: ${JSON.stringify(data)}\n\n`;
      logger.log(`📤 [STREAMING] Envoi SSE - Event: ${event}`);
      logger.log(`📤 [STREAMING] Envoi SSE - Data: ${JSON.stringify(data)}`);
      logger.log(`📤 [STREAMING] Format SSE complet:\n${eventData}${dataData}`);
      res.write(eventData);
      res.write(dataData);
      // Forcer l'envoi immédiat des données (pour le streaming en temps réel)
      if (typeof res.flush === "function") {
        res.flush();
      }
    };

    // Envoyer immédiatement un événement de connexion
    sendSSE("connected", { message: "Connexion SSE établie" });

    // 🛡️ SÉCURITÉ CRITIQUE: Vérifier l'authentification via JWT
    const token = req.query.token as string;
    if (!token) {
      sendSSE("error", { message: "Token manquant" });
      res.end();
      return;
    }

    // Vérifier que la session existe AVANT validation JWT
    const session = streamingSessions.get(sessionId);
    if (!session) {
      sendSSE("error", { message: "Session non trouvée ou expirée" });
      res.end();
      return;
    }

    // 🛡️ VALIDATION JWT OBLIGATOIRE: Vérifier le token et l'ownership de la session
    try {
      const { AuthService } = await import("../services/auth.js");
      const user = await AuthService.verifyToken(token);
      if (!user || user.id !== session.userId) {
        sendSSE("error", {
          message: "Authentification requise - Token invalide ou non autorisé",
        });
        res.end();
        return;
      }
      logger.log(`🔗 [STREAMING] ✅ JWT validé pour user ${user.id}, session: ${sessionId}`);
    } catch (error) {
      logger.error("❌ [STREAMING] Échec validation JWT:", error);
      sendSSE("error", { message: "Token invalide ou expiré" });
      res.end();
      return;
    }

    // 🛡️ ANTI-REPLAY: Invalider immédiatement la session pour empêcher les connexions multiples
    streamingSessions.delete(sessionId);
    logger.log(`🛡️ [STREAMING] Session ${sessionId} invalidée pour prévenir les attaques replay`);

    try {
      // Récupérer les paramètres de la session
      const {
        schoolLevel: bodySchoolLevel,
        questionTypes: bodyQuestionTypes = ["MULTIPLE_CHOICE"],
        questionCount: bodyQuestionCount = 10,
        collegeGrade,
        lyceeSpecialties,
        higherEdLevel, // 🆕 Niveau études sup (L1, M1, etc.)
        higherEdField,
        preset,
        title,
        description,
        coursesOnly,
        ragContext, // 🆕 Récupérer le contexte RAG
        pageProjectIds, // 🆕 Récupérer les IDs des pages
        specificSubject,
        sequentialConfig,
        targetGrade,
        timeLimit,
        difficulty: bodyDifficulty,
        useIntelligentGeneration: requestUseIntelligent = false, // 🧠 PEN-18: Mode intelligent
        usePersonalization = false, // 🎯 PEN-32: Récupérer personnalisation depuis DB
        letAIChoose = false, // 🎯 PEN-35: Laisser l'IA choisir les paramètres
      } = session.request;

      // 🧠 Debug: Vérifier les données récupérées de la session
      logger.log(`🧠 [SESSION-RECOVERY-DEBUG] Session ${sessionId} récupérée:`);
      logger.log(`  - ragContext: ${ragContext ? `${ragContext.length} chars` : "undefined/null"}`);
      logger.log(`  - coursesOnly: ${coursesOnly}`);
      logger.log(`  - pageProjectIds: ${pageProjectIds?.length || 0}`);
      logger.log(`  - usePersonalization: ${usePersonalization}`);
      logger.log(`  - letAIChoose: ${letAIChoose}`);

      const userId = session.userId;

      // ════════════════════════════════════════════════════════════════
      // 🎯 PEN-32 + PEN-35: Personnalisation et mode Auto IA
      // ════════════════════════════════════════════════════════════════
      let schoolLevel = bodySchoolLevel;
      let questionCount = bodyQuestionCount;
      const questionTypes = bodyQuestionTypes;
      let difficulty = bodyDifficulty;
      let preprocessorTypeDistribution: string[] | null = null; // 🎯 Distribution calculée par le preprocessor

      // 🎯 PEN-32: Récupérer la personnalisation depuis la DB si demandé
      if (usePersonalization || !bodySchoolLevel) {
        logger.log("[STREAMING-PREPROCESSOR] 📥 Récupération personnalisation depuis DB...");
        const personalizationData = await getUserPersonalization(userId);

        if (personalizationData) {
          // Garder la valeur brute pour le logging
          const rawSchoolLevel = personalizationData.classe || bodySchoolLevel || "COLLEGE";

          logger.log("[STREAMING-PREPROCESSOR] 👤 Personnalisation récupérée:", {
            classe: personalizationData.classe,
            etude: personalizationData.etude,
            filiere: personalizationData.filiere,
            rawSchoolLevel,
          });

          // 🔧 FIX: Mapper vers l'enum SchoolLevel de Prisma
          schoolLevel = mapToSchoolLevelEnum(rawSchoolLevel);
          logger.log(`[STREAMING-PREPROCESSOR] 🔄 Mapping: "${rawSchoolLevel}" → ${schoolLevel}`);
        } else {
          logger.log("[STREAMING-PREPROCESSOR] ⚠️ Aucune personnalisation trouvée");
          // 🔧 FIX: Mapper vers l'enum SchoolLevel de Prisma
          schoolLevel = mapToSchoolLevelEnum(bodySchoolLevel || "COLLEGE");
        }
      }

      // 🎯 PEN-35: Appeler le preprocessor UNIQUEMENT si letAIChoose est true
      // Le preprocessor détermine les paramètres optimaux (questionCount, questionTypes, difficulty)
      // IMPORTANT: Respecter le choix explicite de l'utilisateur - si letAIChoose est false,
      // ne PAS appeler le preprocessor même pour les utilisateurs premium avec 2+ pages
      const shouldCallPreprocessor = letAIChoose === true;

      // 🔍 Debug: Log explicite de la décision preprocessor
      logger.log(
        `[STREAMING-PREPROCESSOR] 🎯 Décision preprocessor: letAIChoose=${letAIChoose}, shouldCall=${shouldCallPreprocessor}`,
      );

      if (shouldCallPreprocessor && pageProjectIds && pageProjectIds.length > 0) {
        logger.log("[STREAMING-PREPROCESSOR] 🤖 Mode Auto IA activé - Analyse des sources...");

        sendSSE("ai-analyzing", {
          message: "L'IA analyse vos sources pour optimiser le quiz...",
        });

        try {
          // Analyser le contenu des sources
          const sourceAnalysis = await QuizStreamingController.analyzeSourceContentForPreprocessor(
            userId,
            pageProjectIds,
          );

          if (sourceAnalysis.wordCount >= 50) {
            // Récupérer les limites utilisateur
            const userLimits = await prisma.userLimits.findUnique({
              where: { userId },
              select: { questionsPerQuizLimit: true },
            });
            const subscriptionLimit = userLimits?.questionsPerQuizLimit || 10;

            // Préparer les paramètres pour le preprocessor
            const effectiveSchoolLevel = schoolLevel || "COLLEGE";
            const preprocessorParams: PreprocessorPromptParams = {
              schoolLevel: effectiveSchoolLevel,
              studyLevel: QuizStreamingController.mapSchoolLevelToStudyLevel(effectiveSchoolLevel),
              quizType: "ENTRAINEMENT",
              sourceSummary: sourceAnalysis.summary,
              sourceTopics: sourceAnalysis.topics,
              wordCount: sourceAnalysis.wordCount,
              hasFormulas: sourceAnalysis.hasFormulas,
              hasDefinitions: sourceAnalysis.hasDefinitions,
              subscriptionLimit,
              userLanguage: "French",
            };

            logger.log("[STREAMING-PREPROCESSOR] 🧠 Paramètres envoyés à l'IA:", {
              schoolLevel: preprocessorParams.schoolLevel,
              studyLevel: preprocessorParams.studyLevel,
              wordCount: preprocessorParams.wordCount,
              hasFormulas: preprocessorParams.hasFormulas,
              subscriptionLimit: preprocessorParams.subscriptionLimit,
            });

            // Appeler le preprocessor
            const recommendations = await quizPreprocessorAgent.analyzeAndRecommend(
              preprocessorParams,
              userId,
            );

            // Appliquer les recommandations
            questionCount = recommendations.recommendedQuestionCount;
            // 🎯 FIX: Le preprocessor retourne questionTypes comme distribution complète
            // On la stocke séparément pour éviter qu'elle soit recalculée
            preprocessorTypeDistribution = recommendations.questionTypes;
            difficulty = recommendations.difficulty;

            // Compter les types de questions pour le log
            const questionTypeCounts = recommendations.questionTypes.reduce(
              (acc, type) => {
                acc[type] = (acc[type] || 0) + 1;
                return acc;
              },
              {} as Record<string, number>,
            );

            logger.log("[STREAMING-PREPROCESSOR] ✅ Décision de l'IA:", {
              recommendedQuestionCount: recommendations.recommendedQuestionCount,
              difficulty: recommendations.difficulty,
              questionTypes: questionTypeCounts,
              reasoning: recommendations.reasoning,
            });

            sendSSE("ai-recommendations", {
              message: "Paramètres optimisés par l'IA",
              questionCount: recommendations.recommendedQuestionCount,
              questionTypes: questionTypeCounts,
              difficulty: recommendations.difficulty,
              reasoning: recommendations.reasoning,
            });
          } else {
            logger.log(
              "[STREAMING-PREPROCESSOR] ⚠️ Contenu insuffisant, utilisation des paramètres par défaut",
            );
          }
        } catch (preprocessError) {
          logger.error("[STREAMING-PREPROCESSOR] ❌ Erreur preprocessor:", preprocessError);
          // En cas d'erreur, continuer avec les paramètres par défaut
          sendSSE("ai-fallback", {
            message: "Analyse IA non disponible, utilisation des paramètres manuels",
          });
        }
      }

      // 🧠 PEN-24: Mode intelligent automatique pour les utilisateurs premium
      // Les utilisateurs premium bénéficient automatiquement du clustering thématique
      // quand ils sélectionnent 2+ pages, sans avoir besoin d'activer manuellement
      let useIntelligentGeneration = requestUseIntelligent;
      const pageCount = pageProjectIds?.length ?? 0;

      if (!useIntelligentGeneration && pageCount >= 2) {
        try {
          const subscription = await PaddleBillingService.getUserSubscription(userId);
          if (subscription.isPremium) {
            useIntelligentGeneration = true;
            logger.log(
              `🧠 [PAID-INTELLIGENT] Mode intelligent activé automatiquement pour l'utilisateur ${subscription.plan} ${userId}`,
            );
          }
        } catch (error) {
          // En cas d'erreur de vérification, on continue sans le mode intelligent
          logger.warn(
            `⚠️ [PREMIUM-CHECK] Impossible de vérifier le statut premium pour ${userId}:`,
            error,
          );
        }
      }

      // ════════════════════════════════════════════════════════════════
      // 🎯 QUIZ GENERATION MODE SUMMARY
      // ════════════════════════════════════════════════════════════════
      logger.log(`\n${"═".repeat(60)}`);
      logger.log(
        `🎯 QUIZ GENERATION - MODE: ${useIntelligentGeneration ? "🧠 INTELLIGENT (Premium)" : "📝 STANDARD"}`,
      );
      logger.log(`${"═".repeat(60)}`);
      logger.log(`   👤 User: ${userId}`);
      logger.log(
        `   📚 School Level: ${schoolLevel}${higherEdLevel ? ` (${higherEdLevel})` : ""}${higherEdField ? ` - ${higherEdField}` : ""}`,
      );
      logger.log(`   ❓ Questions: ${questionCount}`);
      logger.log(`   📄 Pages sélectionnées: ${pageCount}`);
      logger.log(`   🧠 Intelligence: ${useIntelligentGeneration ? "✅ ACTIVÉ" : "❌ DÉSACTIVÉ"}`);
      if (!useIntelligentGeneration && pageCount >= 2) {
        logger.log(
          `   ℹ️  Raison: Utilisateur non-premium (Intelligence requiert Premium + 2 pages)`,
        );
      } else if (!useIntelligentGeneration && pageCount < 2) {
        logger.log(`   ℹ️  Raison: Moins de 2 pages sélectionnées`);
      }
      logger.log(`${"═".repeat(60)}\n`);

      logger.log(`🚀 [STREAMING] Début génération streaming pour ${questionCount} questions`);

      // 🎯 Générer un titre intelligent si non fourni
      let quizTitle = title;
      if (!quizTitle) {
        // Récupérer les noms des pages si disponibles
        let pageNames: string[] = [];
        if (pageProjectIds && pageProjectIds.length > 0) {
          const pages = await prisma.page.findMany({
            where: { id: { in: pageProjectIds } },
            select: { title: true },
          });
          pageNames = pages.map((p) => p.title).filter(Boolean);
        }

        quizTitle = await generateQuizTitle({
          schoolLevel: schoolLevel || SchoolLevel.COLLEGE,
          pageNames,
          subject: specificSubject,
          questionCount,
          difficulty,
        });
        logger.log(`[TITLE-GEN] Titre généré: "${quizTitle}"`);
      }

      // 1. Créer le quiz en base avec état "generating"
      const quizSchoolLevel = (schoolLevel as SchoolLevel) || SchoolLevel.COLLEGE;
      const quiz = await prisma.quiz.create({
        data: {
          userId,
          title: quizTitle,
          schoolLevel: quizSchoolLevel,
          questions: [], // Sera rempli progressivement
          isCompleted: false,
          status: "generating",
          preset: (preset as QuizPreset) || QuizPreset.NONE,
          collegeGrade: (collegeGrade as CollegeGrade) || null,
          higherEdField,
          createdAt: new Date(),
          updatedAt: new Date(),
          // templateId est optionnel pour les quiz streaming
        },
      });

      // Envoyer l'événement de création de quiz
      sendSSE("quiz-created", {
        quizId: quiz.id,
        message: `Quiz créé avec succès. Génération de ${questionCount} questions...`,
      });

      logger.log(`✅ [STREAMING] Quiz ${quiz.id} créé, génération des questions...`);

      // 🧠 PEN-18 + PEN-20: Mode intelligent avec cache du contexte
      let intelligentContext: IntelligentContextResult | null = null;
      let questionDistribution: ClusterQuestionDistribution[] = [];
      let contextFromCache = false;

      const validPageProjectIds = pageProjectIds || [];
      if (useIntelligentGeneration && validPageProjectIds.length >= 2) {
        logger.log(
          `🧠 [INTELLIGENT] Mode intelligent activé pour ${validPageProjectIds.length} pages`,
        );

        sendSSE("intelligent-preparing", {
          message: "Analyse thématique des pages en cours...",
          pageCount: validPageProjectIds.length,
        });

        // 🚀 PEN-20: Utiliser le cache pour le contexte
        const intelligentConfig = {
          enabled: true,
          maxTokens: 8000,
          balanceContentTypes: true,
          generateClusterNames: true,
        };

        const cacheResult = await ContextCacheService.getOrPrepareContext(
          validPageProjectIds,
          questionCount,
          intelligentConfig,
          async () =>
            prepareIntelligentContext(validPageProjectIds, questionCount, intelligentConfig),
          ragContext, // 🔑 Inclure le ragContext dans le cache
        );

        intelligentContext = cacheResult.context;
        contextFromCache = cacheResult.fromCache;

        if (intelligentContext) {
          questionDistribution = intelligentContext.questionDistribution;

          // Envoyer l'événement clusters-detected au frontend
          sendSSE("clusters-detected", createClustersDetectedEvent(intelligentContext));

          logger.log(
            `✅ [INTELLIGENT] ${intelligentContext.clusters.length} clusters détectés, contexte ${contextFromCache ? "depuis CACHE ⚡" : "fraîchement préparé"}`,
          );

          // Informer le frontend si le contexte vient du cache
          if (contextFromCache) {
            sendSSE("context-cached", {
              message: "Contexte récupéré depuis le cache",
              cached: true,
            });
          }
        } else {
          logger.log(`⚠️ [INTELLIGENT] Fallback au mode normal (pas assez de contenu)`);
        }
      }

      // 2. Calculer la répartition équitable des types AVANT la génération
      let typeDistribution: string[] = [];

      // 🎯 FIX: Si le preprocessor a fourni une distribution, l'utiliser directement
      if (preprocessorTypeDistribution && preprocessorTypeDistribution.length > 0) {
        typeDistribution = [...preprocessorTypeDistribution];
        logger.log(
          `📊 [STREAMING] Distribution fournie par preprocessor (${typeDistribution.length} questions):`,
        );
      } else if (questionTypes.length === 1) {
        // Un seul type : toutes les questions de ce type
        for (let i = 0; i < questionCount; i++) {
          typeDistribution.push(questionTypes[0]);
        }
      } else {
        // Plusieurs types : répartition équitable
        const basePerType = Math.floor(questionCount / questionTypes.length);
        const remainder = questionCount % questionTypes.length;

        questionTypes.forEach((type: string, typeIndex: number) => {
          const countForThisType = basePerType + (typeIndex < remainder ? 1 : 0);
          for (let i = 0; i < countForThisType; i++) {
            typeDistribution.push(type);
          }
        });
      }

      // Mélanger la distribution pour éviter un ordre prévisible
      for (let i = typeDistribution.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [typeDistribution[i], typeDistribution[j]] = [typeDistribution[j], typeDistribution[i]];
      }

      // Compter les types uniques pour le log
      const uniqueTypes = [...new Set(typeDistribution)];
      logger.log(
        `📊 [STREAMING] Répartition finale pour ${questionCount} questions:`,
        uniqueTypes.map((type: string) => ({
          type,
          count: typeDistribution.filter((t) => t === type).length,
        })),
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

        logger.log(
          "📚 [STREAMING] Répartition spécialités:",
          Object.entries(specialtySummary).map(([label, count]) => ({
            specialty: label,
            count,
          })),
        );
      }

      // 🆕 Générer les questions avec Chat Completion + JSON strict (gpt-4o-mini)
      const generatedQuestions: Question[] = [];
      const assistantService = new OpenAIAssistantService();

      logger.log(
        `🚀 [STREAMING] Utilisation du mode Chat Completion + JSON strict (gpt-4o-mini) pour ${questionCount} questions`,
      );

      // 🧠 PEN-18: Utiliser le contexte intelligent si disponible
      const effectiveRagContext = intelligentContext
        ? intelligentContext.enrichedRagContext
        : ragContext;

      const baseRequest: Record<string, unknown> = {
        userId,
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
        ragContext: effectiveRagContext, // 🧠 Contexte enrichi si mode intelligent
        timeLimit,
        difficulty,
      };

      // 🧠 PEN-21: Génération thématique par cluster OU mode normal
      if (intelligentContext && questionDistribution.length > 0) {
        // ========================================
        // MODE INTELLIGENT: Génération cluster par cluster
        // ========================================
        logger.log(
          `🧠 [INTELLIGENT-PEN21] Mode thématique activé: ${questionDistribution.length} clusters`,
        );

        let globalQuestionIndex = 0;
        let typeDistributionIndex = 0;

        for (let clusterIndex = 0; clusterIndex < questionDistribution.length; clusterIndex++) {
          const clusterDist = questionDistribution[clusterIndex];

          // 📤 Événement SSE: Début du cluster
          sendSSE("cluster-start", {
            clusterName: clusterDist.clusterName,
            clusterIndex: clusterIndex + 1,
            totalClusters: questionDistribution.length,
            questionCount: clusterDist.questionCount,
            keywords: clusterDist.keywords.slice(0, 5),
          });

          logger.log(
            `📁 [INTELLIGENT-PEN21] Cluster ${clusterIndex + 1}/${questionDistribution.length}: "${clusterDist.clusterName}" (${clusterDist.questionCount} questions)`,
          );

          let clusterQuestionsGenerated = 0;

          for (let j = 0; j < clusterDist.questionCount; j++) {
            globalQuestionIndex++;
            const specificQuestionType =
              typeDistribution[typeDistributionIndex % typeDistribution.length];
            typeDistributionIndex++;

            try {
              // Envoyer l'événement de début de génération
              sendSSE("question-generating", {
                questionNumber: globalQuestionIndex,
                totalQuestions: questionCount,
                message: `Génération de la question ${globalQuestionIndex} (${specificQuestionType}) - Thème: ${clusterDist.clusterName}...`,
                theme: clusterDist.clusterName,
                clusterIndex: clusterIndex + 1,
                questionInCluster: j + 1,
                totalInCluster: clusterDist.questionCount,
              });

              // Construire la requête avec contexte du cluster
              const singleQuestionRequest: Record<string, unknown> = {
                ...baseRequest,
                questionTypes: [specificQuestionType],
                questionCount: 1,
                existingQuestions: generatedQuestions.length > 0 ? generatedQuestions : undefined,
                themeHint: `Thème: ${clusterDist.clusterName}. Mots-clés: ${clusterDist.keywords.join(", ")}`,
                ragContext: clusterDist.content, // Contexte spécifique au cluster
              };

              // Spécialité si applicable
              const specialtyForQuestion = specialtyDistribution[globalQuestionIndex - 1];
              const specialtyLabel = specialtyForQuestion
                ? getSpecialtyLabel(specialtyForQuestion) || specialtyForQuestion
                : undefined;

              if (specialtyForQuestion && specialtyLabel) {
                singleQuestionRequest.lyceeSpecialties = [specialtyForQuestion];
                singleQuestionRequest.focusSpecialty = specialtyForQuestion;
                singleQuestionRequest.focusSpecialtyLabel = specialtyLabel;
                singleQuestionRequest.specificSubject = specialtyLabel;
              }

              logger.log(
                `🎯 [INTELLIGENT-PEN21] Q${globalQuestionIndex}: Type=${specificQuestionType}, Cluster="${clusterDist.clusterName}"`,
              );

              // Génération de la question
              const questionResult =
                await assistantService.generateSingleQuestion(singleQuestionRequest);

              if (
                questionResult &&
                questionResult.questions &&
                questionResult.questions.length > 0
              ) {
                const newQuestion = questionResult.questions[0];

                // 🎯 PEN-19: Scoring et déduplication
                const { acceptable, score, duplicate } = QuestionScorerService.isAcceptable(
                  newQuestion,
                  generatedQuestions,
                  { minScore: 0.4, duplicateThreshold: 0.8 },
                );

                if (!acceptable) {
                  if (duplicate.isDuplicate) {
                    logger.log(
                      `⚠️ [PEN-19] Q${globalQuestionIndex} doublon détecté (sim=${duplicate.similarity}), skip`,
                    );
                    sendSSE("question-skipped", {
                      questionNumber: globalQuestionIndex,
                      reason: "duplicate",
                      similarity: duplicate.similarity,
                    });
                  } else {
                    logger.log(
                      `⚠️ [PEN-19] Q${globalQuestionIndex} score faible (${score.overall}), acceptée quand même`,
                    );
                    // On accepte quand même les questions avec score faible
                    // pour ne pas bloquer la génération
                  }
                }

                // Ajouter les métadonnées du cluster + score
                newQuestion.metadata = {
                  ...(newQuestion.metadata || {}),
                  cluster: clusterDist.clusterName,
                  clusterId: clusterDist.clusterId,
                  qualityScore: score.overall,
                  ...(specialtyForQuestion && {
                    lyceeSpecialty: specialtyForQuestion,
                    lyceeSpecialtyLabel: specialtyLabel,
                  }),
                };

                if (specialtyLabel && !newQuestion.subject) {
                  newQuestion.subject = specialtyLabel;
                }

                // Skip si doublon, sinon ajouter
                if (!duplicate.isDuplicate) {
                  generatedQuestions.push(newQuestion);
                  clusterQuestionsGenerated++;

                  // Sauvegarder immédiatement
                  await prisma.quiz.update({
                    where: { id: quiz.id },
                    data: {
                      questions: generatedQuestions as unknown as Prisma.InputJsonValue,
                    },
                  });

                  // Envoyer la question
                  sendSSE("question-generated", {
                    questionNumber: globalQuestionIndex,
                    totalQuestions: questionCount,
                    question: newQuestion,
                    canStartAnswering: globalQuestionIndex === 1,
                    message: `Question ${globalQuestionIndex} générée (${clusterDist.clusterName})`,
                    theme: clusterDist.clusterName,
                    qualityScore: score.overall,
                  });

                  logger.log(
                    `✅ [INTELLIGENT-PEN21] Q${globalQuestionIndex} générée (score=${score.overall}) pour cluster "${clusterDist.clusterName}"`,
                  );
                }
              } else {
                throw new Error(`Échec génération question ${globalQuestionIndex}`);
              }
            } catch (questionError) {
              logger.error(`❌ [INTELLIGENT-PEN21] Erreur Q${globalQuestionIndex}:`, questionError);

              sendSSE("question-error", {
                questionNumber: globalQuestionIndex,
                totalQuestions: questionCount,
                error: questionError instanceof Error ? questionError.message : "Erreur inconnue",
                message: `Erreur question ${globalQuestionIndex} (${clusterDist.clusterName})`,
              });
            }
          }

          // 📤 Événement SSE: Fin du cluster
          sendSSE("cluster-complete", {
            clusterName: clusterDist.clusterName,
            clusterIndex: clusterIndex + 1,
            totalClusters: questionDistribution.length,
            questionsGenerated: clusterQuestionsGenerated,
            questionsExpected: clusterDist.questionCount,
          });

          logger.log(
            `✅ [INTELLIGENT-PEN21] Cluster "${clusterDist.clusterName}" terminé: ${clusterQuestionsGenerated}/${clusterDist.questionCount} questions`,
          );
        }
      } else {
        // ========================================
        // MODE NORMAL: Génération question par question
        // ========================================
        for (let i = 0; i < questionCount; i++) {
          try {
            const specificQuestionType = typeDistribution[i];

            sendSSE("question-generating", {
              questionNumber: i + 1,
              totalQuestions: questionCount,
              message: `Génération de la question ${i + 1} (${specificQuestionType})...`,
            });

            const singleQuestionRequest: Record<string, unknown> = {
              ...baseRequest,
              questionTypes: [specificQuestionType],
              questionCount: 1,
              existingQuestions: generatedQuestions.length > 0 ? generatedQuestions : undefined,
            };

            const specialtyForQuestion = specialtyDistribution[i];
            const specialtyLabel = specialtyForQuestion
              ? getSpecialtyLabel(specialtyForQuestion) || specialtyForQuestion
              : undefined;

            if (specialtyForQuestion && specialtyLabel) {
              logger.log(
                `🎓 [STREAMING] Spécialité ciblée pour question ${i + 1}: ${specialtyLabel}`,
              );
              singleQuestionRequest.lyceeSpecialties = [specialtyForQuestion];
              singleQuestionRequest.focusSpecialty = specialtyForQuestion;
              singleQuestionRequest.focusSpecialtyLabel = specialtyLabel;
              singleQuestionRequest.specificSubject = specialtyLabel;
            }

            logger.log(`🎯 [STREAMING] Question ${i + 1}: Type assigné = ${specificQuestionType}`);

            const tGenStart = Date.now();
            const questionResult =
              await assistantService.generateSingleQuestion(singleQuestionRequest);
            const tGenEnd = Date.now();
            logger.info(`⏱️ [PIPELINE] Q${i + 1} generateSingleQuestion=${tGenEnd - tGenStart}ms`);

            if (questionResult && questionResult.questions && questionResult.questions.length > 0) {
              const newQuestion = questionResult.questions[0];

              // 🎯 PEN-19: Scoring et déduplication
              const tScoreStart = Date.now();
              const { score, duplicate } = QuestionScorerService.isAcceptable(
                newQuestion,
                generatedQuestions,
                { minScore: 0.4, duplicateThreshold: 0.8 },
              );

              if (duplicate.isDuplicate) {
                logger.log(
                  `⚠️ [PEN-19] Q${i + 1} doublon détecté (sim=${duplicate.similarity}), skip`,
                );
                sendSSE("question-skipped", {
                  questionNumber: i + 1,
                  reason: "duplicate",
                  similarity: duplicate.similarity,
                });
                continue; // Passer à la prochaine itération
              }

              if (specialtyLabel && !newQuestion.subject) {
                newQuestion.subject = specialtyLabel;
              }

              // Ajouter métadonnées + score
              newQuestion.metadata = {
                ...(newQuestion.metadata || {}),
                qualityScore: score.overall,
                ...(specialtyForQuestion && {
                  lyceeSpecialty: specialtyForQuestion,
                  lyceeSpecialtyLabel: specialtyLabel,
                }),
              };

              generatedQuestions.push(newQuestion);

              const tDbStart = Date.now();
              await prisma.quiz.update({
                where: { id: quiz.id },
                data: {
                  questions: generatedQuestions as unknown as Prisma.InputJsonValue,
                },
              });
              const tDbEnd = Date.now();
              logger.info(
                `⏱️ [PIPELINE] Q${i + 1} scoring=${tDbStart - tScoreStart}ms | dbUpdate=${tDbEnd - tDbStart}ms | total pipeline=${tDbEnd - tGenStart}ms`,
              );

              sendSSE("question-generated", {
                questionNumber: i + 1,
                totalQuestions: questionCount,
                question: newQuestion,
                canStartAnswering: i === 0,
                message: `Question ${i + 1} générée avec succès`,
                qualityScore: score.overall,
              });

              logger.log(
                `✅ [STREAMING] Question ${i + 1} générée (score=${score.overall}) et envoyée`,
              );
            } else {
              throw new Error(`Échec génération question ${i + 1}`);
            }
          } catch (questionError) {
            logger.error(`❌ [STREAMING] Erreur question ${i + 1}:`, questionError);

            sendSSE("question-error", {
              questionNumber: i + 1,
              totalQuestions: questionCount,
              error: questionError instanceof Error ? questionError.message : "Erreur inconnue",
              message: `Erreur lors de la génération de la question ${i + 1}`,
            });
          }
        }
      }

      // 3. Quiz complété - mettre à jour le statut
      const finalQuiz = await prisma.quiz.update({
        where: { id: quiz.id },
        data: {
          status: "ready",
          questions: generatedQuestions as unknown as Prisma.InputJsonValue,
        },
      });

      // Envoyer l'événement de fin
      sendSSE("quiz-completed", {
        quizId: quiz.id,
        totalQuestionsGenerated: generatedQuestions.length,
        totalQuestionsRequested: questionCount,
        message: "Quiz généré avec succès via Chat Completion !",
        quiz: finalQuiz,
      });

      // ════════════════════════════════════════════════════════════════
      // 🎉 QUIZ GENERATION COMPLETE
      // ════════════════════════════════════════════════════════════════
      logger.log(`\n${"═".repeat(60)}`);
      logger.log(`🎉 QUIZ GENERATION COMPLETE`);
      logger.log(`${"═".repeat(60)}`);
      logger.log(`   🆔 Quiz ID: ${quiz.id}`);
      logger.log(`   ✅ Questions générées: ${generatedQuestions.length}/${questionCount}`);
      logger.log(
        `   🧠 Mode Intelligence: ${useIntelligentGeneration ? "✅ UTILISÉ" : "❌ NON UTILISÉ"}`,
      );
      if (useIntelligentGeneration && intelligentContext) {
        logger.log(`   📊 Clusters thématiques: ${intelligentContext.clusters.length}`);
        logger.log(`   📝 Clusters: ${intelligentContext.clusters.map((c) => c.name).join(", ")}`);
      }
      logger.log(`${"═".repeat(60)}\n`);
    } catch (error) {
      logger.error("❌ [STREAMING] Erreur génération:", error);

      sendSSE("error", {
        message: "Erreur lors de la génération du quiz",
        details: error instanceof Error ? error.message : "Erreur inconnue",
      });

      // Session déjà nettoyée en début de connexion (anti-replay)
    }

    // Fermer la connexion SSE
    sendSSE("end", { message: "Génération terminée" });
    res.end();
  }

  /**
   * POST /api/quiz/submit-and-correct-stream - Soumet et corrige un quiz avec streaming
   */
  static async submitAndCorrectStream(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: "Utilisateur non authentifié" });
        return;
      }

      const { quizId, answers, sourceDocuments } = req.body;

      if (!quizId || !Array.isArray(answers)) {
        res.status(400).json({
          error: "Paramètres manquants: quizId et answers requis",
        });
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

      // Configuration SSE
      setupSSEHeaders(res, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Cache-Control",
      });

      // Fonction pour envoyer des événements SSE
      const sendSSE = (event: string, data: SSEEventData): void => {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        if (typeof res.flush === "function") {
          res.flush();
        }
      };

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
          await import("../services/quiz/generators/correctionGenerator.js");
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
                    aiCorrection: event.finalResult!
                      .aiCorrection as unknown as Prisma.InputJsonValue,
                    recommendations: (event.finalResult!.aiCorrection?.recommendations ??
                      []) as unknown as Prisma.InputJsonValue,
                  },
                });
              });

              logger.log(`✅ [CORRECTION-STREAMING] Quiz et résultats sauvegardés en DB`);

              // 🗑️ Invalider le cache de l'historique après complétion du quiz
              const { invalidateQuizHistoryCache } = await import("../lib/redis.js");
              invalidateQuizHistoryCache(userId).catch((err) =>
                logger.warn("⚠️ [CORRECTION-STREAMING] Échec invalidation cache:", err),
              );

              // Envoyer l'analyse détaillée IA
              sendSSE("ai-analysis", {
                summary: event.finalResult.aiCorrection?.globalFeedback || "",
                strengths: event.finalResult.aiCorrection?.strengths || [],
                weaknesses: event.finalResult.aiCorrection?.weaknesses || [],
                recommendations: event.finalResult.aiCorrection?.recommendations || [],
                personalizedTips: event.finalResult.metadata?.personalizedTips || [],
              });
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
          details: error instanceof Error ? error.message : "Erreur inconnue",
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
          details: error instanceof Error ? error.message : "Erreur inconnue",
        });
      }
    }
  }

  /**
   * 🎯 PEN-35: Analyse le contenu des sources pour le preprocessor
   */
  private static async analyzeSourceContentForPreprocessor(
    userId: string,
    pageProjectIds: string[],
  ): Promise<{
    textContent: string;
    wordCount: number;
    summary: string;
    topics: string[];
    hasFormulas: boolean;
    hasDefinitions: boolean;
  }> {
    let allText = "";
    const topics: Set<string> = new Set();
    let hasFormulas = false;
    let hasDefinitions = false;

    if (pageProjectIds.length > 0) {
      const pages = await prisma.page.findMany({
        where: {
          id: { in: pageProjectIds },
          workspace: {
            members: { some: { userId } },
          },
          isArchived: false,
        },
        select: {
          title: true,
          blockNoteContent: true,
        },
      });

      for (const page of pages) {
        allText += `${page.title}\n`;
        topics.add(page.title);

        try {
          const content =
            typeof page.blockNoteContent === "string"
              ? JSON.parse(page.blockNoteContent)
              : page.blockNoteContent;

          if (content && Array.isArray(content)) {
            for (const block of content) {
              if (block?.type === "paragraph" && block?.content) {
                const text = Array.isArray(block.content)
                  ? block.content.map((item: Record<string, unknown>) => item?.text || "").join("")
                  : "";
                allText += text + "\n";
              }
              if (block?.type === "latex" || block?.type === "latexBlock") {
                hasFormulas = true;
              }
              if (block?.type === "heading") {
                hasDefinitions = true;
              }
            }
          }
        } catch (error) {
          logger.warn("[STREAMING-PREPROCESSOR] Erreur parsing BlockNote:", error);
        }
      }
    }

    const wordCount = allText.split(/\s+/).filter(Boolean).length;
    const topicsList = Array.from(topics).slice(0, 10);
    const words = allText.split(/\s+/).filter(Boolean);
    const summary = words.slice(0, 200).join(" ");

    return {
      textContent: allText,
      wordCount,
      summary,
      topics: topicsList,
      hasFormulas,
      hasDefinitions,
    };
  }

  /**
   * 🎯 PEN-35: Mapper les niveaux scolaires vers les catégories d'étude
   */
  private static mapSchoolLevelToStudyLevel(schoolLevel: string): string {
    if (schoolLevel === "COLLEGE") return "College";
    if (schoolLevel.startsWith("LYCEE_")) return "Lycée";
    if (schoolLevel === "ETUDES_SUPERIEURES") return "Université";
    return "College";
  }
}
