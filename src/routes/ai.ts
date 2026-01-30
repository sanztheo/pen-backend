import { Router } from "express";
import { authenticateToken } from "../middlewares/auth.js";
import { requireAICredits } from "../middlewares/requireAICredits.js";
import { z } from "zod";
// Utiliser fetch global (Node >= 18)
import { testAI } from "../controllers/ai/base.js";
import {
  generateContent,
  improveContent,
  continueContent,
} from "../controllers/ai/content.js";
import {
  generateBlock,
  generatePlan,
  generateFromPage,
  summarizeContent,
  generateIdeas,
  translateContent,
  correctText,
} from "../controllers/ai/specialized.js";
import { autocomplete } from "../controllers/ai/autocomplete.js";
import { aiConcurrencyLimit } from "../middlewares/aiConcurrencyLimit.js";
import { dailyTokenQuota } from "../middlewares/dailyTokenQuota.js";

// 🎯 Imports BullMQ pour jobs asynchrones
import { aiGenerationQueue } from "../lib/queues.js";
import { markJobPending } from "../lib/jobResults.js";

// 🤖 Import Vercel AI SDK pour BlockNote AI (v0.40+)
import { streamText, convertToModelMessages } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { toolDefinitionsToToolSet } from "@blocknote/xl-ai";

const router = Router();

// 🛡️ Schéma de validation pour le proxy OpenAI
// Assoupli pour accepter les champs OpenAI/compatibles générés par @ai-sdk/openai
const OpenAIProxySchema = z
  .object({
    model: z.string().optional(),
    messages: z
      .array(
        z.object({
          role: z.enum(["system", "user", "assistant"]),
          // Le SDK peut envoyer soit une string, soit un tableau de parties
          content: z.union([z.string(), z.array(z.any())]),
        }),
      )
      .min(1)
      .max(100), // Limite raisonnable de messages
    temperature: z.number().min(0).max(2).optional(),
    max_tokens: z.number().int().min(1).max(32000).optional(),
    max_completion_tokens: z.number().int().min(1).max(32000).optional(),
    top_p: z.number().min(0).max(1).optional(),
    frequency_penalty: z.number().min(-2).max(2).optional(),
    presence_penalty: z.number().min(-2).max(2).optional(),
    stream: z.boolean().optional(),
    user: z.string().max(255).optional(),
  })
  .passthrough(); // Autoriser les propriétés supplémentaires (tools, tool_choice, etc.)

// Test de configuration et connexion IA - 🚨 SÉCURITÉ: Authentifié en production
router.get("/test", authenticateToken, testAI);

// Routes protégées - nécessitent une authentification + vérification crédits IA
router.use(authenticateToken);
router.use(aiConcurrencyLimit);
router.use(dailyTokenQuota);

// 🤖 GÉNÉRATION DE CONTENU - Coût: 0.5 crédits
router.post(
  "/generate",
  requireAICredits({ cost: 0.5, action: "content_generation" }),
  generateContent,
);
router.post(
  "/generate-block",
  requireAICredits({ cost: 0.5, action: "content_generation" }),
  generateBlock,
);
router.post(
  "/generate-plan",
  requireAICredits({ cost: 0.5, action: "content_generation" }),
  generatePlan,
);
router.post(
  "/generate-from-page",
  requireAICredits({ cost: 0.5, action: "content_generation" }),
  generateFromPage,
);

// 📝 AMÉLIORATION ET CONTINUATION - Coût: 0.5 crédits
router.post(
  "/improve",
  requireAICredits({ cost: 0.5, action: "content_generation" }),
  improveContent,
);
router.post(
  "/continue",
  requireAICredits({ cost: 0.5, action: "content_generation" }),
  continueContent,
);
router.post(
  "/summarize",
  requireAICredits({ cost: 0.5, action: "content_generation" }),
  summarizeContent,
);
router.post(
  "/ideas",
  requireAICredits({ cost: 0.5, action: "content_generation" }),
  generateIdeas,
);

// 🔧 FONCTIONS SPÉCIALISÉES - Coût: 0.3 crédits
router.post(
  "/translate",
  requireAICredits({ cost: 0.3, action: "specialized_function" }),
  translateContent,
);
router.post(
  "/correct",
  requireAICredits({ cost: 0.3, action: "specialized_function" }),
  correctText,
);
router.post(
  "/autocomplete",
  requireAICredits({ cost: 0.3, action: "specialized_function" }),
  autocomplete,
);

// 🎯 VERSIONS ASYNCHRONES AVEC BULLMQ - Retournent un jobId immédiatement
// Les résultats sont récupérables via GET /api/jobs/:jobId

/**
 * POST /api/ai/async/generate - Version async de /generate
 * Retourne: { jobId: string, status: "pending" }
 */
router.post(
  "/async/generate",
  requireAICredits({ cost: 0.5, action: "content_generation" }),
  async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      const { prompt, context, ...options } = req.body;

      if (!prompt) {
        return res.status(400).json({ error: "Le prompt est requis" });
      }

      // Créer le job dans la queue
      const job = await aiGenerationQueue.add("generate-content", {
        type: "generate-content",
        userId,
        prompt,
        context,
        options,
      });

      // 🛡️ Marquer comme pending dans Redis avec userId pour ownership
      if (job.id) {
        await markJobPending(job.id, userId);
      }

      console.log(
        `🎯 [AI-ASYNC] Job créé: ${job.id} (generate-content) pour user ${userId}`,
      );

      return res.status(202).json({
        jobId: job.id,
        status: "pending",
        message:
          "Job créé avec succès. Utilisez GET /api/jobs/:jobId pour récupérer le résultat",
      });
    } catch (error: any) {
      console.error("[AI-ASYNC] Erreur création job:", error);
      return res.status(500).json({ error: "Erreur serveur" });
    }
  },
);

/**
 * POST /api/ai/async/translate - Version async de /translate
 */
router.post(
  "/async/translate",
  requireAICredits({ cost: 0.3, action: "specialized_function" }),
  async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      const { text, language } = req.body;

      if (!text || !language) {
        return res.status(400).json({ error: "text et language sont requis" });
      }

      const job = await aiGenerationQueue.add("translate", {
        type: "translate",
        userId,
        text,
        language,
      });

      // 🛡️ Marquer comme pending avec userId pour ownership
      if (job.id) {
        await markJobPending(job.id, userId);
      }

      console.log(
        `🎯 [AI-ASYNC] Job créé: ${job.id} (translate) pour user ${userId}`,
      );

      return res.status(202).json({
        jobId: job.id,
        status: "pending",
        message: "Job créé avec succès",
      });
    } catch (error: any) {
      console.error("[AI-ASYNC] Erreur création job:", error);
      return res.status(500).json({ error: "Erreur serveur" });
    }
  },
);

/**
 * POST /api/ai/async/correct - Version async de /correct
 */
router.post(
  "/async/correct",
  requireAICredits({ cost: 0.3, action: "specialized_function" }),
  async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      const { text } = req.body;

      if (!text) {
        return res.status(400).json({ error: "text est requis" });
      }

      const job = await aiGenerationQueue.add("correct", {
        type: "correct",
        userId,
        text,
      });

      // 🛡️ Marquer comme pending avec userId pour ownership
      if (job.id) {
        await markJobPending(job.id, userId);
      }

      console.log(
        `🎯 [AI-ASYNC] Job créé: ${job.id} (correct) pour user ${userId}`,
      );

      return res.status(202).json({
        jobId: job.id,
        status: "pending",
        message: "Job créé avec succès",
      });
    } catch (error: any) {
      console.error("[AI-ASYNC] Erreur création job:", error);
      return res.status(500).json({ error: "Erreur serveur" });
    }
  },
);

/**
 * POST /api/ai/async/autocomplete - Version async de /autocomplete
 */
router.post(
  "/async/autocomplete",
  requireAICredits({ cost: 0.3, action: "specialized_function" }),
  async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      const { content, cursorPosition, blockType } = req.body;

      if (!content || cursorPosition === undefined) {
        return res
          .status(400)
          .json({ error: "content et cursorPosition sont requis" });
      }

      const job = await aiGenerationQueue.add("autocomplete", {
        type: "autocomplete",
        userId,
        content,
        cursorPosition,
        blockType,
      });

      // 🛡️ Marquer comme pending avec userId pour ownership
      if (job.id) {
        await markJobPending(job.id, userId);
      }

      console.log(
        `🎯 [AI-ASYNC] Job créé: ${job.id} (autocomplete) pour user ${userId}`,
      );

      return res.status(202).json({
        jobId: job.id,
        status: "pending",
        message: "Job créé avec succès",
      });
    } catch (error: any) {
      console.error("[AI-ASYNC] Erreur création job:", error);
      return res.status(500).json({ error: "Erreur serveur" });
    }
  },
);

// 🔗 ROUTE CHAT POUR BLOCKNOTE AI - Coût: 1.0 crédit
// Utilise le SDK Vercel AI pour la conversion des messages et le streaming
// Conforme à la documentation BlockNote: https://www.blocknotejs.org/docs/features/ai/backend-integration
router.post(
  "/chat",
  requireAICredits({ cost: 1.0, action: "openai_proxy" }),
  async (req, res) => {
    try {
      const { messages, toolDefinitions, maxTokens, temperature } = req.body;

      console.log("🔄 [AI-CHAT] Messages UIMessage reçus:", {
        messagesCount: messages?.length,
        hasToolDefinitions: !!toolDefinitions,
        maxTokens: maxTokens || "non fourni",
        temperature: temperature || "non fourni",
        bodyKeys: Object.keys(req.body),
        userId: (req as any).user?.id,
      });

      // Validation basique
      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({
          error: "VALIDATION_ERROR",
          message: 'Le champ "messages" est requis et doit être un tableau',
        });
      }

      // Configuration du modèle OpenAI avec l'API key
      const modelName =
        process.env.OPENAI_DASHBOARD_MODEL ||
        process.env.OPENAI_MODEL ||
        "gpt-4o-mini";

      const openaiProvider = createOpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });

      console.log("🤖 [AI-CHAT] Configuration:", {
        model: modelName,
        hasTools: !!toolDefinitions,
        apiKeyConfigured: !!process.env.OPENAI_API_KEY,
      });

      // ✅ BlockNote v0.40+: Utiliser convertToModelMessages et toolDefinitionsToToolSet
      const convertedMessages = convertToModelMessages(messages);
      console.log("📋 [AI-CHAT] Messages convertis:", {
        originalCount: messages.length,
        convertedCount: convertedMessages.length,
        firstMessage: convertedMessages[0],
      });

      const result = streamText({
        model: openaiProvider(modelName),
        messages: convertedMessages, // Conversion officielle AI SDK
        tools: toolDefinitions
          ? toolDefinitionsToToolSet(toolDefinitions)
          : undefined,
        toolChoice: toolDefinitions ? "required" : undefined,
      });

      // 🔒 AUDIT: Journaliser la consommation
      const userId = (req as any).user?.id;
      const cost = (req as any).aiCredits?.cost ?? 1.0;
      console.log(
        `✅ [AUDIT] Chat endpoint utilisé: userId=${userId}, cost=${cost}`,
      );

      // ✅ BlockNote v0.40+: Convertir Response en stream Express
      const response = result.toUIMessageStreamResponse();
      console.log("🌊 [AI-CHAT] Stream response créé:", {
        hasBody: !!response.body,
        headers: Array.from(response.headers.entries()),
      });

      // Copier les headers de la Response vers Express
      response.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });

      // Streamer le body vers Express
      if (response.body) {
        const reader = response.body.getReader();

        async function pump() {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              res.end();
              break;
            }
            res.write(value);
          }
        }

        await pump();
      } else {
        res.end();
      }
    } catch (error: any) {
      console.error("❌ [AI-CHAT] Erreur:", error);
      res.status(500).json({
        error: "AI chat error",
      });
    }
  },
);

export { router as aiRouter };

// --- Proxy OpenAI compatible - Coût: 0.25 crédit ---
router.post(
  "/proxy/chat/completions",
  requireAICredits({ cost: 0.25, action: "openai_proxy" }),
  async (req, res) => {
    try {
      // 🛡️ Validation sécurisée des paramètres OpenAI
      const validationResult = OpenAIProxySchema.safeParse(req.body);
      if (!validationResult.success) {
        console.warn(`❌ [AI-PROXY] Validation échouée:`, {
          userId: (req as any).user?.id,
          errors: validationResult.error.issues,
          receivedData: Object.keys(req.body || {}),
        });

        return res.status(400).json({
          error: "VALIDATION_ERROR",
          message: "Paramètres de requête invalides pour le proxy OpenAI",
          details: validationResult.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
            expected: (issue as any).expected,
            received: (issue as any).received,
          })),
        });
      }

      const body = validationResult.data;
      const model =
        body.model ||
        process.env.OPENAI_DASHBOARD_MODEL ||
        process.env.OPENAI_MODEL;
      const isFixedTempModel =
        typeof model === "string" && /(o1|o3|nano)/i.test(model);

      const payload: any = { ...body };
      if (
        isFixedTempModel &&
        Object.prototype.hasOwnProperty.call(payload, "temperature") &&
        payload.temperature !== 1
      ) {
        payload.temperature = 1;
      }

      // Adapter les paramètres incompatibles pour les modèles o1/o3/nano
      if (isFixedTempModel) {
        if (payload.max_tokens && !payload.max_completion_tokens) {
          payload.max_completion_tokens = payload.max_tokens;
          delete payload.max_tokens;
        }
        // Optionnel: supprimer d'autres sampling params non supportés si présents
        // (laisse passer si non fournis)
      }

      const response = await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );

      const text = await response.text();

      // 🔒 AUDIT: Journaliser la consommation proxy
      const userId = (req as any).user?.id;
      const cost = (req as any).aiCredits?.cost ?? 0.25;
      console.log(
        `🔒 [AUDIT] Proxy OpenAI utilisé: userId=${userId}, cost=${cost}, status=${response.status}`,
      );

      res.status(response.status).send(text);
    } catch (error: any) {
      console.error("[AI Proxy] Error:", error);
      res.status(500).json({ error: "AI proxy error" });
    }
  },
);
