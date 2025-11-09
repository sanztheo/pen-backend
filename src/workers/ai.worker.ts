/**
 * 🤖 AI GENERATION WORKER
 *
 * Worker pour traiter les jobs de génération de contenu AI en arrière-plan.
 * Permet d'éviter de bloquer le serveur principal pendant les appels OpenAI/Gemini.
 *
 * Jobs traités:
 * - generate-content: Génération de texte
 * - generate-block: Génération de blocs
 * - generate-plan: Génération de plans
 * - autocomplete: Autocomplétion
 * - translate: Traduction
 * - correct: Correction
 */

import { Worker, Job } from "bullmq";
import { redis } from "../lib/redis.js";
import { markJobCompleted, markJobFailed } from "../lib/jobResults.js";

// Types de jobs AI
export interface AIGenerationJobData {
  type:
    | "generate-content"
    | "generate-block"
    | "generate-plan"
    | "autocomplete"
    | "translate"
    | "correct";
  userId: string;
  prompt?: string;
  context?: string;
  language?: string;
  text?: string;
  blockType?: string;
  content?: string;
  cursorPosition?: number;
  options?: any;
}

export interface AIGenerationResult {
  success: boolean;
  content?: string;
  suggestions?: string[];
  error?: string;
  usage?: {
    totalTokens: number;
  };
}

// 🔧 Processeur de jobs AI
const processAIGenerationJob = async (
  job: Job<AIGenerationJobData>,
): Promise<AIGenerationResult> => {
  const {
    type,
    userId,
    prompt,
    context,
    language,
    text,
    content,
    cursorPosition,
    blockType,
    options,
  } = job.data;

  console.log(`🤖 [AI-WORKER] Traitement job ${type} pour user ${userId}`);

  try {
    switch (type) {
      case "generate-content": {
        // Import dynamique pour éviter de charger tout au démarrage
        const { AIService } = await import("../services/ai/index.js");
        const result = await AIService.generateContent({
          prompt: prompt || "",
          context,
          ...options,
        });

        return {
          success: true,
          content: result.content,
          usage: result.usage
            ? { totalTokens: result.usage.totalTokens }
            : undefined,
        };
      }

      case "generate-block": {
        const { AIService } = await import("../services/ai/index.js");
        const result = await AIService.generateBlock(
          blockType || "paragraph",
          prompt || "",
          context,
        );

        return {
          success: true,
          content: result.content,
          usage: result.usage
            ? { totalTokens: result.usage.totalTokens }
            : undefined,
        };
      }

      case "autocomplete": {
        const { AutocompleteService } = await import(
          "../services/ai/autocomplete.js"
        );
        const result = await AutocompleteService.autocomplete(
          content || text || "",
          cursorPosition || 0,
          blockType,
          3,
        );

        return {
          success: true,
          suggestions: result.suggestions,
        };
      }

      case "translate": {
        const { AIService } = await import("../services/ai/index.js");
        const result = await AIService.translateContent(
          text || content || "",
          language || "en",
        );

        return {
          success: true,
          content: result.content,
          usage: result.usage
            ? { totalTokens: result.usage.totalTokens }
            : undefined,
        };
      }

      case "correct": {
        const { AIService } = await import("../services/ai/index.js");
        const result = await AIService.correctText(text || content || "");

        return {
          success: true,
          content: result.content,
          usage: result.usage
            ? { totalTokens: result.usage.totalTokens }
            : undefined,
        };
      }

      default:
        throw new Error(`Type de job inconnu: ${type}`);
    }
  } catch (error: any) {
    console.error(`❌ [AI-WORKER] Erreur job ${type}:`, error);

    return {
      success: false,
      error: error.message || "Erreur inconnue",
    };
  }
};

// 🚀 Créer et démarrer le worker
export const aiGenerationWorker = new Worker<
  AIGenerationJobData,
  AIGenerationResult
>("ai-generation", processAIGenerationJob, {
  connection: redis,
  concurrency: 5, // Traiter max 5 jobs en parallèle
  limiter: {
    max: 100, // Max 100 jobs par fenêtre
    duration: 60000, // Fenêtre de 1 minute
  },
});

// 📊 Event listeners pour logging et stockage des résultats
aiGenerationWorker.on("completed", async (job, result) => {
  console.log(`✅ [AI-WORKER] Job ${job.id} complété (${job.data.type})`);

  // Stocker le résultat dans Redis pour récupération via API
  if (job.id) {
    await markJobCompleted(job.id, result);
  }
});

aiGenerationWorker.on("failed", async (job, error) => {
  console.error(
    `❌ [AI-WORKER] Job ${job?.id} échoué (${job?.data.type}):`,
    error.message,
  );

  // Stocker l'erreur dans Redis
  if (job?.id) {
    await markJobFailed(job.id, error.message);
  }
});

aiGenerationWorker.on("error", (error) => {
  console.error("❌ [AI-WORKER] Erreur worker:", error);
});

console.log("🚀 [AI-WORKER] Worker AI démarré (concurrency: 5)");
