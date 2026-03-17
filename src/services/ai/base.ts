import OpenAI from "openai";
import { logger } from "../../utils/logger.js";
import { MODELS } from "../../config/models.js";
import { getModelProvider } from "../../config/models.js";

const DEFAULT_MODEL = MODELS.CONTENT_DEFAULT;

// 🔥 LAZY INITIALIZATION: N'initialise les clients que quand nécessaire
let openai: OpenAI | null = null;
let grok: OpenAI | null = null;
let moonshot: OpenAI | null = null;
let gemini: OpenAI | null = null;

function getOpenAIInstance(): OpenAI {
  if (!openai) {
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openai;
}

function getGrokInstance(): OpenAI {
  if (!grok) {
    if (!process.env.GROK_API_KEY) {
      logger.warn("⚠️ GROK_API_KEY manquante, fallback sur OpenAI");
      return getOpenAIInstance();
    }
    grok = new OpenAI({
      apiKey: process.env.GROK_API_KEY,
      baseURL: "https://api.x.ai/v1", // 🧠 xAI Base URL
    });
  }
  return grok;
}

/** Google Gemini — OpenAI-compatible endpoint */
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";

function getGeminiInstance(): OpenAI {
  if (!gemini) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      logger.warn("[AI] GEMINI_API_KEY missing, falling back to OpenAI");
      return getOpenAIInstance();
    }
    gemini = new OpenAI({
      apiKey,
      baseURL: GEMINI_BASE_URL,
    });
  }
  return gemini;
}

/** Moonshot/Kimi — API OpenAI-compatible. Global: api.moonshot.ai, Chine: api.moonshot.cn */
const MOONSHOT_BASE_URL_DEFAULT = "https://api.moonshot.ai/v1";

function getMoonshotInstance(): OpenAI {
  if (!moonshot) {
    const apiKey = process.env.MOONSHOT_API_KEY || process.env.KIMI_API_KEY;
    if (!apiKey) {
      logger.warn("⚠️ MOONSHOT_API_KEY manquante, fallback sur OpenAI");
      return getOpenAIInstance();
    }
    const baseURL = process.env.MOONSHOT_BASE_URL || MOONSHOT_BASE_URL_DEFAULT;
    moonshot = new OpenAI({
      apiKey: apiKey.trim(),
      baseURL,
    });
  }
  return moonshot;
}

// Interface pour les résultats de streaming d'autocomplétion
export interface AutocompleteStreamResult {
  suggestions: string[];
  context: {
    beforeCursor: string;
    afterCursor: string;
    detectedIntent: string;
  };
  isComplete: boolean;
  currentSuggestionIndex?: number;
}

export interface AIGenerationOptions {
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  model?: string;
  context?: string;
  signal?: AbortSignal;
  userId?: string;
  source?: string;
  // 🚀 Nouveau : Support du streaming
  onStream?: (chunk: string) => void;
  // 🧠 Nouveau : Support du reasoning/thinking (Grok, o1, etc.)
  onThinking?: (chunk: string) => void;
}

export interface AIGenerationResult {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  finishReason: string;
  detectedLanguage?: string;
}

/**
 * Classe principale pour les services IA
 */
export class AIService {
  /**
   * Vérifier si l'IA est configurée correctement
   */
  static isConfigured(): boolean {
    return !!process.env.OPENAI_API_KEY;
  }

  /**
   * Tester la connexion OpenAI
   */
  static async testConnection(): Promise<boolean> {
    try {
      if (!this.isConfigured()) {
        logger.error("❌ OPENAI_API_KEY ou OPENAI_DASHBOARD_MODEL/OPENAI_MODEL non configurés");
        return false;
      }

      const client = getOpenAIInstance();
      const response = await client.chat.completions.create({
        model: DEFAULT_MODEL!,
        messages: [{ role: "user", content: 'Test de connexion - réponds juste "OK"' }],
        max_tokens: 10,
      });

      const isSuccess =
        response.choices[0]?.message?.content?.toLowerCase().includes("ok") || false;
      logger.log(isSuccess ? "✅ Connexion OpenAI réussie" : "⚠️ Réponse inattendue de OpenAI");
      return isSuccess;
    } catch (error) {
      logger.error("❌ Erreur connexion OpenAI:", error);
      return false;
    }
  }

  /**
   * Obtenir l'instance OpenAI configurée
   */
  static getOpenAI(): OpenAI {
    return getOpenAIInstance();
  }

  /**
   * Obtenir l'instance Grok (xAI) configurée
   */
  static getGrok(): OpenAI {
    return getGrokInstance();
  }

  /**
   * Obtenir l'instance Moonshot (Kimi) configurée — API OpenAI-compatible
   */
  static getMoonshot(): OpenAI {
    return getMoonshotInstance();
  }

  /**
   * Retourne un client OpenAI-compatible pour le modèle donné (openai, moonshot, xai).
   * À utiliser pour tout appel chat.completions.create avec un modelId du MODELS / registry.
   */
  static getOpenAICompatibleClient(modelId: string): OpenAI {
    const provider = getModelProvider(modelId);
    if (provider === "google") return getGeminiInstance();
    if (provider === "moonshot") return getMoonshotInstance();
    if (provider === "xai") return getGrokInstance();
    return getOpenAIInstance();
  }

  /**
   * Obtenir le modèle par défaut
   */
  static getDefaultModel(): string | undefined {
    return DEFAULT_MODEL;
  }

  /**
   * Obtenir le modèle pour la génération de quiz
   * 🆕 GPT-5-mini : reasoning model avec restrictions
   * - ❌ temperature non supporté (valeur fixe = 1)
   * - ❌ max_tokens → utiliser max_completion_tokens
   * - ✅ reasoning_effort supporté (low, medium, high)
   */
  static getQuizGenerationModel(): string {
    return MODELS.QUIZ_GENERATION;
  }

  /**
   * Obtenir le modèle pour la correction de quiz
   * 🆕 GPT-5-mini : reasoning model avec restrictions
   */
  static getQuizCorrectionModel(): string {
    return MODELS.QUIZ_CORRECTION;
  }

  /**
   * Obtenir le modele pour les batch explanations (Gemini flash-lite)
   */
  static getQuizExplanationModel(): string {
    return MODELS.QUIZ_EXPLANATION;
  }

  // ==========================================
  // MÉTHODES DÉLÉGUÉES AUX SERVICES SPÉCIALISÉS
  // ==========================================

  /**
   * Générer du contenu avec l'IA
   */
  static async generateContent(options: AIGenerationOptions): Promise<AIGenerationResult> {
    const { ContentGenerationService } = await import("./contentGeneration.js");
    return ContentGenerationService.generateContent(options);
  }

  /**
   * Générer un bloc spécifique
   */
  static async generateBlock(
    type: string,
    prompt: string,
    context?: string,
  ): Promise<AIGenerationResult> {
    const { ContentGenerationService } = await import("./contentGeneration.js");
    return ContentGenerationService.generateBlock(type, prompt, context);
  }

  /**
   * Améliorer du contenu existant
   */
  static async improveContent(
    content: string,
    instructions?: string,
    source?: string,
  ): Promise<AIGenerationResult> {
    const { ContentGenerationService } = await import("./contentGeneration.js");
    return ContentGenerationService.improveContent(content, instructions, source);
  }

  /**
   * Continuer un texte existant
   */
  static async continueContent(
    content: string,
    length: "court" | "moyen" | "long" = "moyen",
    source?: string,
  ): Promise<AIGenerationResult> {
    const { ContentGenerationService } = await import("./contentGeneration.js");
    return ContentGenerationService.continueContent(content, length, source);
  }

  /**
   * Résumer du contenu
   */
  static async summarizeContent(
    content: string,
    style: "bullet" | "paragraph" = "paragraph",
  ): Promise<AIGenerationResult> {
    const { ContentGenerationService } = await import("./contentGeneration.js");
    return ContentGenerationService.summarizeContent(content, style);
  }

  /**
   * Générer des idées/suggestions
   */
  static async generateIdeas(topic: string, count: number = 5): Promise<AIGenerationResult> {
    const { ContentGenerationService } = await import("./contentGeneration.js");
    return ContentGenerationService.generateIdeas(topic, count);
  }

  /**
   * Traduire du contenu
   */
  static async translateContent(
    content: string,
    targetLanguage: string,
  ): Promise<AIGenerationResult> {
    const { ContentGenerationService } = await import("./contentGeneration.js");
    return ContentGenerationService.translateContent(content, targetLanguage);
  }

  /**
   * Corriger l'orthographe et la grammaire
   */
  static async correctText(content: string): Promise<AIGenerationResult> {
    const { ContentGenerationService } = await import("./contentGeneration.js");
    return ContentGenerationService.correctText(content);
  }

  /**
   * Autocomplétion intelligente
   * @deprecated AutocompleteService a été supprimé
   */
  static async autocomplete(
    _content: string,
    _cursorPosition: number,
    _blockType?: string,
    _maxSuggestions: number = 3,
    _signal?: AbortSignal,
  ): Promise<{
    suggestions: string[];
    context: {
      beforeCursor: string;
      afterCursor: string;
      detectedIntent: string;
    };
  }> {
    logger.warn("[DEPRECATED] AutocompleteService a été supprimé");
    return {
      suggestions: [],
      context: {
        beforeCursor: "",
        afterCursor: "",
        detectedIntent: "unknown",
      },
    };
  }

  /**
   * Autocomplétion avec streaming
   * @deprecated AutocompleteService a été supprimé
   */
  static async autocompleteStream(
    _content: string,
    _cursorPosition: number,
    _blockType?: string,
    _maxSuggestions: number = 3,
    _onStreamChunk?: (result: AutocompleteStreamResult) => void,
    _signal?: AbortSignal,
  ): Promise<AutocompleteStreamResult> {
    logger.warn("[DEPRECATED] AutocompleteService a été supprimé");
    return {
      suggestions: [],
      context: {
        beforeCursor: "",
        afterCursor: "",
        detectedIntent: "unknown",
      },
      isComplete: true,
    };
  }
}
