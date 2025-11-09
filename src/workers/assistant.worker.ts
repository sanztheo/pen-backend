/**
 * 🧠 ASSISTANT WORKER
 *
 * Worker pour traiter les jobs assistant AI en arrière-plan.
 * Modes: ask (1 crédit), search (2 crédits), create (1-2 crédits).
 *
 * Jobs traités:
 * - assistant-ask: Mode automatique
 * - assistant-search: Mode recherche avec RAG
 * - assistant-create: Mode création rapide/profonde
 */

import { Worker, Job } from "bullmq";
import { redis } from "../lib/redis.js";
import { markJobCompleted, markJobFailed } from "../lib/jobResults.js";

// Types de jobs assistant
export interface AssistantJobData {
  type: "assistant-ask" | "assistant-search" | "assistant-create";
  userId: string;
  workspaceId: string;
  query: string;
  mode: "ask" | "search" | "create";
  reflection?: "rapide" | "profond";
  selectedSources?: any;
  useWeb?: boolean;
  options?: any;
}

export interface AssistantResult {
  success: boolean;
  content?: string;
  sources?: any[];
  error?: string;
  tokensUsed?: number;
}

// 🔧 Processeur de jobs assistant
const processAssistantJob = async (
  job: Job<AssistantJobData>,
): Promise<AssistantResult> => {
  const {
    type,
    userId,
    workspaceId,
    query,
    mode,
    reflection,
    selectedSources,
    useWeb,
    options,
  } = job.data;

  console.log(
    `🧠 [ASSISTANT-WORKER] Traitement job ${type} pour user ${userId} (mode: ${mode})`,
  );

  try {
    switch (type) {
      case "assistant-ask": {
        // Mode automatique
        const { assistantAsk } = await import("../controllers/assistant.js");

        // Simuler un objet request/response pour réutiliser la logique existante
        const mockReq: any = {
          body: {
            query,
            mode,
            reflection,
            selectedSources,
            useWeb,
            ...options,
          },
          user: { id: userId },
        };

        // Capturer la réponse
        let result: any = null;
        const mockRes: any = {
          json: (data: any) => {
            result = data;
          },
          status: (code: number) => mockRes,
        };

        await assistantAsk(mockReq, mockRes);

        if (result && result.success) {
          return {
            success: true,
            content: result.content,
            sources: result.sources,
            tokensUsed: result.tokensUsed,
          };
        } else {
          throw new Error(result?.error || "Erreur assistant");
        }
      }

      case "assistant-search": {
        // Mode recherche (RAG intensif)
        const { assistantSearch } = await import("../controllers/assistant.js");

        const mockReq: any = {
          body: {
            query,
            mode,
            reflection,
            selectedSources,
            useWeb,
            ...options,
          },
          user: { id: userId },
        };

        let result: any = null;
        const mockRes: any = {
          json: (data: any) => {
            result = data;
          },
          status: (code: number) => mockRes,
        };

        await assistantSearch(mockReq, mockRes);

        if (result && result.success) {
          return {
            success: true,
            content: result.content,
            sources: result.sources,
            tokensUsed: result.tokensUsed,
          };
        } else {
          throw new Error(result?.error || "Erreur assistant search");
        }
      }

      case "assistant-create": {
        // Mode création
        const { assistantCreate } = await import("../controllers/assistant.js");

        const mockReq: any = {
          body: {
            query,
            mode,
            reflection,
            selectedSources,
            useWeb,
            ...options,
          },
          user: { id: userId },
        };

        let result: any = null;
        const mockRes: any = {
          json: (data: any) => {
            result = data;
          },
          status: (code: number) => mockRes,
        };

        await assistantCreate(mockReq, mockRes);

        if (result && result.success) {
          return {
            success: true,
            content: result.content,
            sources: result.sources,
            tokensUsed: result.tokensUsed,
          };
        } else {
          throw new Error(result?.error || "Erreur assistant create");
        }
      }

      default:
        throw new Error(`Type de job inconnu: ${type}`);
    }
  } catch (error: any) {
    console.error(`❌ [ASSISTANT-WORKER] Erreur job ${type}:`, error);

    return {
      success: false,
      error: error.message || "Erreur inconnue",
    };
  }
};

// 🚀 Créer et démarrer le worker
export const assistantWorker = new Worker<AssistantJobData, AssistantResult>(
  "ai-assistant",
  processAssistantJob,
  {
    connection: redis,
    concurrency: 3, // Max 3 jobs assistant en parallèle (plus gourmands)
    limiter: {
      max: 50, // Max 50 jobs par fenêtre
      duration: 60000, // Fenêtre de 1 minute
    },
  },
);

// 📊 Event listeners pour logging et stockage des résultats
assistantWorker.on("completed", async (job, result) => {
  console.log(
    `✅ [ASSISTANT-WORKER] Job ${job.id} complété (${job.data.type})`,
  );

  // Stocker le résultat dans Redis pour récupération via API
  if (job.id) {
    await markJobCompleted(job.id, result);
  }
});

assistantWorker.on("failed", async (job, error) => {
  console.error(
    `❌ [ASSISTANT-WORKER] Job ${job?.id} échoué (${job?.data.type}):`,
    error.message,
  );

  // Stocker l'erreur dans Redis
  if (job?.id) {
    await markJobFailed(job.id, error.message);
  }
});

assistantWorker.on("error", (error) => {
  console.error("❌ [ASSISTANT-WORKER] Erreur worker:", error);
});

console.log("🚀 [ASSISTANT-WORKER] Worker Assistant démarré (concurrency: 3)");
