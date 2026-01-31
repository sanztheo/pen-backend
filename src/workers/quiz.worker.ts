/**
 * 📝 QUIZ WORKER
 *
 * Worker pour traiter les jobs de génération de quiz en arrière-plan.
 * Permet d'éviter de bloquer le serveur principal pendant les générations de quiz longues.
 *
 * Jobs traités:
 * - generate-quiz: Génération de quiz complet
 * - generate-quiz-stream: Génération avec streaming (utilise progress)
 * - correct-quiz: Correction automatique de quiz
 */

import { Worker, Job } from "bullmq";
import { redis } from "../lib/redis.js";
import { markJobCompleted, markJobFailed } from "../lib/jobResults.js";
import {
  QuizGenerationRequest,
  QuizCorrectionRequest,
} from "../services/quiz/types.js";

// Types de jobs Quiz
export interface QuizJobData {
  type: "generate-quiz" | "generate-quiz-stream" | "correct-quiz";
  userId: string;

  // Pour generate-quiz
  request?: QuizGenerationRequest;
  sequenceOptions?: {
    sequenceId: string;
    sequenceOrder: number;
  };

  // Pour correct-quiz
  correctionRequest?: QuizCorrectionRequest;
}

export interface QuizJobResult {
  success: boolean;
  quizId?: string;
  error?: string;
  questions?: unknown[];
  correction?: unknown;
}

// 🔧 Processeur de jobs Quiz
const processQuizJob = async (
  job: Job<QuizJobData>,
): Promise<QuizJobResult> => {
  const { type, userId, request, sequenceOptions, correctionRequest } =
    job.data;

  console.log(`📝 [QUIZ-WORKER] Traitement job ${type} pour user ${userId}`);

  try {
    switch (type) {
      case "generate-quiz": {
        // Import dynamique pour éviter de charger tout au démarrage
        const { QuizService } = await import("../services/quiz/quizService.js");

        if (!request) {
          throw new Error("QuizGenerationRequest manquant");
        }

        console.log(
          `📝 [QUIZ-WORKER] Génération quiz: ${request.title || "Sans titre"}`,
        );

        // Générer le quiz
        const quizId = await QuizService.generateQuiz(request, sequenceOptions);

        console.log(`✅ [QUIZ-WORKER] Quiz généré avec ID: ${quizId}`);

        return {
          success: true,
          quizId,
        };
      }

      case "generate-quiz-stream": {
        // Pour le streaming, on utilise les job.updateProgress() de BullMQ
        const { QuizService } = await import("../services/quiz/quizService.js");

        if (!request) {
          throw new Error("QuizGenerationRequest manquant");
        }

        console.log(`📝 [QUIZ-WORKER] Génération quiz avec streaming`);

        // Note: Le streaming complet nécessiterait une modification du QuizService
        // Pour l'instant, on fait une génération standard
        const quizId = await QuizService.generateQuiz(request, sequenceOptions);

        return {
          success: true,
          quizId,
        };
      }

      case "correct-quiz": {
        // Import des services nécessaires
        const { CorrectionGenerator } =
          await import("../services/quiz/generators/correctionGenerator.js");
        const { prisma } = await import("../lib/prisma.js");

        if (!correctionRequest) {
          throw new Error("QuizCorrectionRequest manquant");
        }

        console.log(
          `📝 [QUIZ-WORKER] Correction quiz ${correctionRequest.quizId}`,
        );

        // Récupérer le quiz depuis la DB pour obtenir les questions
        const quiz = await prisma.quiz.findUnique({
          where: { id: correctionRequest.quizId },
        });

        if (!quiz) {
          throw new Error(`Quiz ${correctionRequest.quizId} introuvable`);
        }

        // Extraire les questions du quiz
        const questions = quiz.questions as any; // Type Prisma Json

        // Générer la correction
        const correction = await CorrectionGenerator.correctQuiz(
          questions,
          correctionRequest.userAnswers,
          correctionRequest,
        );

        return {
          success: true,
          correction,
        };
      }

      default:
        throw new Error(`Type de job inconnu: ${type}`);
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ [QUIZ-WORKER] Erreur job ${type}:`, error);

    return {
      success: false,
      error: errorMessage || "Erreur inconnue",
    };
  }
};

// 🚀 Créer et démarrer le worker
export const quizWorker = new Worker<QuizJobData, QuizJobResult>(
  "ai-quiz",
  processQuizJob,
  {
    connection: redis as unknown as import("bullmq").ConnectionOptions,
    concurrency: 3, // Traiter max 3 quiz en parallèle (génération longue)
    limiter: {
      max: 50, // Max 50 quiz par fenêtre
      duration: 60000, // Fenêtre de 1 minute
    },
  },
);

// 📊 Event listeners pour logging et stockage des résultats
quizWorker.on("completed", async (job, result) => {
  console.log(`✅ [QUIZ-WORKER] Job ${job.id} complété (${job.data.type})`);
  console.log(`   Quiz ID: ${result.quizId || "N/A"}`);

  // 🛡️ Stocker le résultat dans Redis avec userId pour ownership
  if (job.id && job.data.userId) {
    await markJobCompleted(job.id, job.data.userId, result);
  }
});

quizWorker.on("failed", async (job, error) => {
  console.error(
    `❌ [QUIZ-WORKER] Job ${job?.id} échoué (${job?.data.type}):`,
    error.message,
  );

  // 🛡️ Stocker l'erreur dans Redis avec userId pour ownership
  if (job?.id && job?.data.userId) {
    await markJobFailed(job.id, job.data.userId, error.message);
  }
});

quizWorker.on("error", (error) => {
  console.error("❌ [QUIZ-WORKER] Erreur worker:", error);
});

quizWorker.on("progress", (job, progress) => {
  console.log(`📊 [QUIZ-WORKER] Job ${job.id} progression: ${progress}%`);
});

console.log("🚀 [QUIZ-WORKER] Worker Quiz démarré (concurrency: 3)");
