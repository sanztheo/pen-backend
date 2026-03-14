import OpenAI from "openai";
import { z } from "zod";
import { logger } from "../../utils/logger.js";
import type {
  ChatCompletionChunk,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionCreateParamsNonStreaming,
} from "openai/resources/chat/completions";
import type { CompletionUsage } from "openai/resources/completions";
import { AIService, AIGenerationOptions, AIGenerationResult } from "./base.js";
import { CodeDetectionService } from "./codeDetection.js";
import { AIQuotaManager } from "./quotaManager.js";
import {
  isFixedTempModel,
  isNanoModel,
  isReasoningModel,
  getModelProvider,
} from "../../config/models.js";

/**
 * Extended delta type to support reasoning_content from Grok/xAI and other reasoning models
 */
interface ExtendedChatCompletionDelta {
  content?: string | null;
  reasoning_content?: string | null;
  role?: "developer" | "system" | "user" | "assistant" | "tool";
  refusal?: string | null;
}

/**
 * Payload for streaming chat completions (supports both standard and reasoning models)
 */
interface ChatCompletionStreamPayload extends Omit<
  ChatCompletionCreateParamsStreaming,
  "max_tokens"
> {
  max_tokens?: number;
  max_completion_tokens?: number;
  reasoning_effort?: "low" | "medium" | "high";
}

/**
 * Payload for non-streaming chat completions (supports both standard and reasoning models)
 */
interface ChatCompletionPayload extends Omit<ChatCompletionCreateParamsNonStreaming, "max_tokens"> {
  max_tokens?: number;
  max_completion_tokens?: number;
  reasoning_effort?: "low" | "medium" | "high";
}

/**
 * Response structure from OpenAI API (non-streaming)
 */
interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string | null;
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

const ChatCompletionResponseSchema: z.ZodType<ChatCompletionResponse> = z
  .object({
    id: z.string(),
    object: z.string(),
    created: z.number(),
    model: z.string(),
    choices: z.array(
      z.object({
        index: z.number(),
        message: z.object({
          role: z.string(),
          content: z.string().nullable(),
        }),
        finish_reason: z.string().nullable(),
      }),
    ),
    usage: z
      .object({
        prompt_tokens: z.number(),
        completion_tokens: z.number(),
        total_tokens: z.number(),
      })
      .optional(),
  })
  .passthrough();

function parseChatCompletionResponse(raw: unknown): ChatCompletionResponse {
  const parsed = ChatCompletionResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("Réponse OpenAI invalide (chat/completions)");
  }
  return parsed.data;
}

function isAsyncIterable<T>(value: unknown): value is AsyncIterable<T> {
  if (typeof value !== "object" || value === null) return false;
  return Symbol.asyncIterator in value;
}

/**
 * Service pour la génération de contenu avec IA
 */
export class ContentGenerationService {
  /**
   * Générer du contenu avec l'IA - SUPPORT STREAMING
   */
  static async generateContent(options: AIGenerationOptions): Promise<AIGenerationResult> {
    if (!AIService.isConfigured()) {
      throw new Error("Service IA non configuré - OPENAI_API_KEY manquante");
    }

    const startTime = Date.now();

    // 🚫 Vérifier si la requête a déjà été annulée
    if (options.signal?.aborted) {
      throw new Error("Requête annulée");
    }

    logger.log("🤖 [OpenAI] Génération de contenu...", {
      prompt: options.prompt.substring(0, 100) + "...",
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      hasSignal: !!options.signal,
      streaming: !!options.onStream,
    });

    try {
      const model = options.model || AIService.getDefaultModel()!;

      // 🛡️ VÉRIFICATION QUOTAS AVANT APPEL OPENAI
      const estimatedPromptTokens = Math.ceil(options.prompt.length / 4); // approximation 1 token ≈ 4 chars
      const estimatedCompletionTokens = options.maxTokens || 1000;

      const quotaCheck = await AIQuotaManager.checkQuota(
        model,
        estimatedPromptTokens,
        estimatedCompletionTokens,
      );

      if (!quotaCheck.allowed) {
        logger.error("🚨 [QUOTA] Limite OpenAI atteinte:", quotaCheck.reason);
        throw new Error(`Quota OpenAI dépassé: ${quotaCheck.reason}`);
      }

      logger.log("✅ [QUOTA] Requête autorisée -", {
        usage: `${quotaCheck.usage?.requests}/${quotaCheck.limits?.maxRequests} requêtes`,
        tokens: `${quotaCheck.usage?.tokens}/${quotaCheck.limits?.maxTokens} tokens`,
        cost: `$${quotaCheck.usage?.cost.toFixed(4)}/$${quotaCheck.limits?.maxCost}`,
      });
      const isNano = typeof model === "string" && isNanoModel(model);
      const MIN_COMPLETION_TOKENS = isNano ? 5000 : 2000;
      // Cap dur côté provider ~32768 tokens de complétion → garder une marge de sécurité
      const PROVIDER_HARD_CAP = 32768;
      const MAX_COMPLETION_TOKENS = isNano ? Math.min(32000, PROVIDER_HARD_CAP) : 6000;
      const targetTokens = Math.min(
        Math.max(options.maxTokens || 0, MIN_COMPLETION_TOKENS),
        MAX_COMPLETION_TOKENS,
      );

      let client: OpenAI;
      const isGrok = typeof model === "string" && getModelProvider(model) === "xai";

      if (isGrok) {
        logger.log("🧠 [PROVIDER] Utilisation de xAI (Grok)");
        client = AIService.getGrok();
      } else {
        client = AIService.getOpenAI();
      }

      const messages = [
        ...(options.context ? [{ role: "system" as const, content: options.context }] : []),
        { role: "user" as const, content: options.prompt },
      ];

      // 🚀 STREAMING MODE
      if (options.onStream) {
        // 🚫 Créer une requête avec signal d'annulation pour OpenAI
        const controller = new AbortController();
        const combinedSignal = options.signal;

        // Si le signal externe est annulé, annuler notre controller
        if (combinedSignal) {
          combinedSignal.addEventListener("abort", () => {
            controller.abort();
          });
        }

        const isFixedTempStream = typeof model === "string" && isFixedTempModel(model);
        const payloadStream: ChatCompletionStreamPayload = {
          model,
          messages,
          stream: true,
        };

        if (isFixedTempStream) {
          // Ne jamais dépasser la limite provider
          payloadStream.max_completion_tokens = Math.min(
            Math.max(targetTokens, 5000),
            PROVIDER_HARD_CAP,
          );
          if (isReasoningModel(model)) {
            payloadStream.reasoning_effort = "low";
          }
        } else {
          payloadStream.max_tokens = targetTokens;
          payloadStream.temperature = options.temperature ?? 0.7;
        }

        const created = await client.chat.completions.create(payloadStream, {
          signal: controller.signal, // 🚫 Passer le signal à OpenAI
        });
        if (!isAsyncIterable<ChatCompletionChunk>(created)) {
          throw new Error("OpenAI streaming response attendu");
        }
        const stream: AsyncIterable<ChatCompletionChunk> = created;

        let fullContent = "";
        let accumulatedReasoning = ""; // 🆕 Accumulateur de raisonnement
        const usage: CompletionUsage | undefined = undefined;
        let finishReason = "unknown";

        try {
          for await (const chunk of stream) {
            // 🚫 Vérifier annulation pendant le streaming
            if (options.signal?.aborted || controller.signal.aborted) {
              logger.log("🚫 [STREAMING] Annulation détectée, arrêt du streaming");
              throw new Error("Requête annulée");
            }

            const delta = chunk.choices[0]?.delta as ExtendedChatCompletionDelta | undefined;
            const content = delta?.content || "";
            const reasoning = delta?.reasoning_content || ""; // 🧠 Capture Grok/OpenAI reasoning

            if (reasoning) {
              accumulatedReasoning += reasoning;
              // Stream thinking to frontend
              if (options.onThinking) {
                options.onThinking(reasoning);
              }
            }

            if (content) {
              fullContent += content;

              // 🚀 Optimisation streaming : envoyer des chunks plus petits si nécessaire
              if (content.length > 60) {
                // Diviser les gros chunks en plus petits morceaux pour un affichage plus fluide
                const words = content.split(/(\s+)/);
                let buffer = "";
                for (const word of words) {
                  buffer += word;
                  if (buffer.length >= 30 || /[\n.,;!?]/.test(word)) {
                    options.onStream(buffer);
                    buffer = "";
                  }
                }
                if (buffer) {
                  options.onStream(buffer);
                }
              } else {
                options.onStream(content); // Envoyer le chunk au client tel quel
              }
            }

            if (chunk.choices[0]?.finish_reason) {
              finishReason = chunk.choices[0].finish_reason;
            }

            // Note: L'usage n'est pas disponible dans les chunks de streaming
          }
        } catch (error) {
          // 🚫 Gérer spécifiquement les erreurs d'annulation d'OpenAI
          if (
            error instanceof Error &&
            (error.name === "AbortError" ||
              error.message.includes("aborted") ||
              error.message.includes("annulée"))
          ) {
            logger.log("🚫 [STREAMING] Requête OpenAI annulée avec succès");
            throw new Error("Requête annulée");
          }
          throw error;
        }

        const responseTime = Date.now() - startTime;
        logger.log(`✅ [OpenAI/Grok] Streaming terminé en ${responseTime}ms`, {
          contentLength: fullContent.length,
          reasoningLength: accumulatedReasoning.length,
          finishReason,
        });

        // 🧠 Log complet du thinking si existant (DEMANDE UTILISATEUR)
        if (accumulatedReasoning.length > 0) {
          logger.log(
            "\n🧠 [COMPLETE THINKING]:\n" + accumulatedReasoning + "\n-------------------\n",
          );
        }

        // Optionnel: si coupé par longueur et que l'appelant a demandé plus de tokens, tenter une continuation simple
        if (finishReason === "length" && (options.maxTokens || 0) > 0) {
          try {
            const followupMessages = [
              ...(options.context ? [{ role: "system" as const, content: options.context }] : []),
              {
                role: "user" as const,
                content: "Continue la réponse précédente.",
              },
            ];
            const payloadFollow: ChatCompletionStreamPayload = {
              model,
              messages: followupMessages,
              stream: true,
            };
            const maxFollowTokens = isNano
              ? Math.min(PROVIDER_HARD_CAP, options.maxTokens || 30000)
              : Math.min(6000, options.maxTokens || 2000);
            if (isFixedTempStream) {
              payloadFollow.max_completion_tokens = maxFollowTokens;
              if (isReasoningModel(model)) {
                payloadFollow.reasoning_effort = "low";
              }
            } else {
              payloadFollow.max_tokens = maxFollowTokens;
              payloadFollow.temperature = options.temperature ?? 0.7;
            }
            const created2 = await client.chat.completions.create(payloadFollow);
            if (!isAsyncIterable<ChatCompletionChunk>(created2)) {
              throw new Error("OpenAI streaming response attendu");
            }
            const stream2: AsyncIterable<ChatCompletionChunk> = created2;
            for await (const chunk of stream2) {
              const content = chunk.choices[0]?.delta?.content || "";
              if (content) {
                fullContent += content;
                options.onStream(content);
              }
            }
          } catch (e) {
            logger.warn("⚠️ Continuation stream échouée:", e);
          }
        }

        // 🛡️ ENREGISTRER L'USAGE POUR LE QUOTA (streaming n'expose pas usage → estimer)
        try {
          const estimatedPromptTokens = Math.ceil(options.prompt.length / 4);
          const estimatedCompletionTokens = Math.ceil(fullContent.length / 4);
          await AIQuotaManager.recordUsage(model, estimatedPromptTokens, estimatedCompletionTokens);
        } catch (err) {
          logger.warn("⚠️ Erreur enregistrement quota (stream):", err);
        }

        return {
          content: fullContent,
          usage,
          model,
          finishReason,
        };
      }

      // 🚫 MODE CLASSIQUE (non-streaming) avec annulation améliorée
      const controller = new AbortController();
      const combinedSignal = options.signal;

      // Si le signal externe est annulé, annuler notre controller
      if (combinedSignal) {
        combinedSignal.addEventListener("abort", () => {
          logger.log("🚫 [CLASSIC] Signal externe annulé, annulation de la requête OpenAI");
          controller.abort();
        });
      }

      const isFixedTemp = typeof model === "string" && isFixedTempModel(model);
      const payload: ChatCompletionPayload = { model, messages };
      if (isFixedTemp) {
        payload.max_completion_tokens = targetTokens;
        if (isReasoningModel(model)) {
          payload.reasoning_effort = "low";
        }
      } else {
        payload.max_tokens = targetTokens;
        payload.temperature = options.temperature ?? 0.7;
      }

      const fetchPromise = fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal, // 🚫 Utiliser notre controller
      });

      let response;

      try {
        response = await fetchPromise;
      } catch (error) {
        // 🚫 Gérer spécifiquement les erreurs d'annulation de fetch
        if (
          error instanceof Error &&
          (error.name === "AbortError" ||
            error.message.includes("aborted") ||
            controller.signal.aborted)
        ) {
          logger.log("🚫 [CLASSIC] Requête fetch annulée avec succès");
          throw new Error("Requête annulée");
        }
        throw error;
      }

      if (options.signal?.aborted || controller.signal.aborted) {
        logger.log("🚫 [CLASSIC] Annulation détectée après réponse");
        throw new Error("Requête annulée");
      }

      if (!response.ok) {
        const errorText = await response.text();
        logger.error("❌ [OpenAI] Réponse non OK:", {
          status: response.status,
          body: errorText,
        });
        throw new Error(`Erreur OpenAI (${response.status}): ${errorText}`);
      }

      const raw: unknown = await response.json();
      const data = parseChatCompletionResponse(raw);
      const content = data.choices?.[0]?.message?.content || "";

      const responseTime = Date.now() - startTime;
      const finishReason = data.choices?.[0]?.finish_reason || "unknown";
      logger.log(`✅ [OpenAI] Génération terminée en ${responseTime}ms`, {
        tokens: data.usage?.total_tokens,
        finishReason,
      });

      // 🛡️ ENREGISTRER L'USAGE POUR LE QUOTA
      if (data.usage?.prompt_tokens && data.usage?.completion_tokens) {
        await AIQuotaManager.recordUsage(
          data.model,
          data.usage.prompt_tokens,
          data.usage.completion_tokens,
        ).catch((err) => logger.warn("⚠️ Erreur enregistrement quota:", err));
      }

      let finalContent = content;
      const finalUsage = data.usage;

      // 🔄 RETRY AUTOMATIQUE si tronqué (finishReason === 'length')
      if (finishReason === "length" && (options.maxTokens || 0) > 0) {
        logger.log("⚠️ [RETRY] Réponse tronquée détectée, continuation automatique...");
        try {
          const continuationMessages = [
            ...(options.context ? [{ role: "system" as const, content: options.context }] : []),
            { role: "user" as const, content: options.prompt },
            { role: "assistant" as const, content: finalContent },
            {
              role: "user" as const,
              content: "Continue et termine ta réponse complète.",
            },
          ];

          const maxContinuationTokens = isNano
            ? Math.min(PROVIDER_HARD_CAP, options.maxTokens || 30000)
            : Math.min(6000, options.maxTokens || 2000);

          const continuationPayload: ChatCompletionPayload = {
            model,
            messages: continuationMessages,
          };
          if (isFixedTemp) {
            continuationPayload.max_completion_tokens = maxContinuationTokens;
          } else {
            continuationPayload.max_tokens = maxContinuationTokens;
            continuationPayload.temperature = options.temperature ?? 0.7;
          }

          const continuationResponse = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(continuationPayload),
            signal: controller.signal,
          });

          if (continuationResponse.ok) {
            const continuationRaw: unknown = await continuationResponse.json();
            const continuationData = parseChatCompletionResponse(continuationRaw);
            const continuationContent = continuationData.choices?.[0]?.message?.content || "";
            finalContent += continuationContent;

            logger.log("✅ [RETRY] Continuation réussie", {
              additionalTokens: continuationData.usage?.total_tokens,
              newFinishReason: continuationData.choices?.[0]?.finish_reason,
            });

            // Mettre à jour l'usage total
            if (finalUsage && continuationData.usage) {
              finalUsage.prompt_tokens += continuationData.usage.prompt_tokens || 0;
              finalUsage.completion_tokens += continuationData.usage.completion_tokens || 0;
              finalUsage.total_tokens += continuationData.usage.total_tokens || 0;
            }

            // Enregistrer l'usage de la continuation
            if (
              continuationData.usage?.prompt_tokens &&
              continuationData.usage?.completion_tokens
            ) {
              await AIQuotaManager.recordUsage(
                continuationData.model,
                continuationData.usage.prompt_tokens,
                continuationData.usage.completion_tokens,
              ).catch((err) => logger.warn("⚠️ Erreur enregistrement quota continuation:", err));
            }
          }
        } catch (retryError) {
          logger.warn(
            "⚠️ [RETRY] Continuation échouée, utilisation de la réponse partielle:",
            retryError,
          );
        }
      }

      return {
        content: finalContent,
        usage: finalUsage
          ? {
              promptTokens: finalUsage.prompt_tokens,
              completionTokens: finalUsage.completion_tokens,
              totalTokens: finalUsage.total_tokens,
            }
          : undefined,
        model: data.model,
        finishReason,
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;

      // 🚫 Gérer spécifiquement les erreurs d'annulation
      if (
        error instanceof Error &&
        (error.name === "AbortError" || error.message.includes("annulée"))
      ) {
        logger.log(`🚫 [OpenAI] Requête annulée après ${responseTime}ms`);
        throw new Error("Requête annulée");
      }

      logger.error(`❌ [OpenAI] Erreur après ${responseTime}ms:`, error);
      throw error;
    }
  }

  /**
   * Générer un bloc de contenu spécifique
   */
  static async generateBlock(
    type: string,
    prompt: string,
    context?: string,
  ): Promise<AIGenerationResult> {
    const systemPrompts = {
      text: `Assistant d'écriture concis. Utilisez '\n' pour les sauts de ligne. Répondez en 2 à 3 phrases maximum. Répondez directement sans introduction.`,
      heading2: `Génère un titre de section. Réponds uniquement avec le titre, sans guillemets ni formatage.`,
      heading3: `Génère un sous-titre. Réponds uniquement avec le sous-titre : sans guillemets et sans formatage.`,
      list: `Génère une liste à puces courte de 3 à 5 éléments maximum.
FORMATAGE : Utilise « \n » entre chaque élément.
Réponds directement sous forme de liste à puces.`,
      quote: `Génère une citation courte et inspirante. Donne uniquement la citation en réponse.`,
      code: `Génère uniquement du code concis et fonctionnel, sans explication.

Format de sortie obligatoire :
- Fournis la réponse sous la forme exclusive d'un bloc de code Markdown.
- Après les trois backticks, écris le nom du langage, puis le code minimal.

Exemple :
\`\`\`python
print("Bonjour, monde!")
\`\`\`
`,
    };

    const systemPrompt = systemPrompts[type as keyof typeof systemPrompts] || systemPrompts.text;
    const fullContext = context ? `${systemPrompt}\n\nContexte: ${context}` : systemPrompt;

    // Tokens équilibrés pour nano : contenu de qualité sans excès
    const nanoTokens = {
      text: 800, // Paragraphe complet
      heading2: 100, // Titre descriptif
      heading3: 100, // Sous-titre descriptif
      list: 600, // Liste complète
      quote: 200, // Citation développée
      code: 1500, // Code fonctionnel
    };

    const result = await this.generateContent({
      prompt,
      context: fullContext,
      maxTokens: nanoTokens[type as keyof typeof nanoTokens] || nanoTokens.text,
      temperature: type === "code" ? 0.3 : 0.7,
    });

    // Parser le code markdown si c'est du code
    if (type === "code" && result.content) {
      logger.log(`📥 Contenu brut de l'IA:`, result.content);

      const parsed = CodeDetectionService.parseMarkdownCode(result.content);

      logger.log(`🔄 Résultat du parsing:`, {
        originalContent: result.content.substring(0, 200),
        parsedCode: parsed.code.substring(0, 200),
        detectedLanguage: parsed.language,
        isMarkdown: parsed.isMarkdown,
      });

      result.content = parsed.code; // Code sans backticks
      result.detectedLanguage = parsed.language; // Langage détecté/extrait
    }

    return result;
  }

  /**
   * Améliorer/réecrire un contenu existant
   */
  static async improveContent(content: string, instructions?: string): Promise<AIGenerationResult> {
    const prompt = instructions
      ? `Améliore selon: "${instructions}"\n\nTexte:\n${content}`
      : `Améliore ce texte:\n\n${content}`;

    return this.generateContent({
      prompt,
      context:
        'Améliore le texte tout en gardant une longueur similaire. Utilise "\\n" pour chaque retour à la ligne. Réponds uniquement avec le texte amélioré.',
      maxTokens: Math.min(content.length * 1.5 + 100, 1000), // Plus généreux pour de meilleurs résultats
      temperature: 0.6,
    });
  }

  /**
   * Continuer un texte existant
   */
  static async continueContent(
    content: string,
    length: "court" | "moyen" | "long" = "moyen",
  ): Promise<AIGenerationResult> {
    const lengthTokens = {
      court: 200, // Paragraphe court
      moyen: 500, // Paragraphe moyen
      long: 800, // Paragraphe long
    };

    return this.generateContent({
      prompt: `Continue ce texte:\n\n${content}`,
      context:
        "Continue de façon naturelle. FORMATAGE : utilise \\n pour les retours à la ligne. Réponds directement avec la suite.",
      maxTokens: lengthTokens[length],
      temperature: 0.7,
    });
  }

  /**
   * Résumer du contenu
   */
  static async summarizeContent(
    content: string,
    style: "bullet" | "paragraph" = "paragraph",
  ): Promise<AIGenerationResult> {
    const stylePrompt =
      style === "bullet"
        ? 'Résumé en 3 puces max. FORMATAGE: \\n entre puces. EXEMPLE: "• Point 1\\n• Point 2\\n• Point 3"'
        : "Résumé en 1-2 phrases. FORMATAGE: \\n pour séparer.";

    return this.generateContent({
      prompt: `${stylePrompt}\n\nTexte:\n${content}`,
      context: "Résumé concis et précis. Réponds directement.",
      maxTokens: 300, // Résumé de qualité
      temperature: 0.5,
    });
  }

  /**
   * Générer des idées/suggestions
   */
  static async generateIdeas(topic: string, count: number = 5): Promise<AIGenerationResult> {
    const limitedCount = Math.min(count, 5); // Max 5 idées pour limiter les tokens
    return this.generateContent({
      prompt: `${limitedCount} idées sur: "${topic}". Liste à puces.`,
      context: "Idées courtes et créatives. FORMATAGE: \\n entre puces. Réponds directement.",
      maxTokens: 600, // ~120 tokens par idée (5 idées max)
      temperature: 0.8,
    });
  }

  /**
   * Traduire du contenu
   */
  static async translateContent(
    content: string,
    targetLanguage: string,
  ): Promise<AIGenerationResult> {
    return this.generateContent({
      prompt: `Traduis en ${targetLanguage}:\n\n${content}`,
      context: `Traduction précise. FORMATAGE: \\n pour retours à la ligne. Réponds directement avec la traduction.`,
      maxTokens: Math.min(Math.max(content.length * 1.5, 200), 1500), // Plus généreux pour traductions
      temperature: 0.3,
    });
  }

  /**
   * Corriger l'orthographe et la grammaire
   */
  static async correctText(content: string): Promise<AIGenerationResult> {
    return this.generateContent({
      prompt: `Corrige ce texte:\n\n${content}`,
      context:
        "Correction orthographe/grammaire. FORMATAGE: \\n pour retours à la ligne. Réponds directement avec le texte corrigé.",
      maxTokens: Math.min(Math.max(content.length * 1.2, 150), 800), // Plus généreux pour corrections
      temperature: 0.3,
    });
  }
}
