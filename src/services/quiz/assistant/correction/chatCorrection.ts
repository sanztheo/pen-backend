// assistant/correction/chatCorrection.ts - Correction via Chat Completion avec JSON strict

import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import { AIService } from "../../../ai/base.js";
import { isReasoningModel } from "../../../../config/models.js";
import { logger } from "../../../../utils/logger.js";
import {
  QUIZ_CORRECTION_STANDARD_SCHEMA,
  QUIZ_CORRECTION_COMPLETE_SCHEMA,
} from "../config/index.js";
import {
  buildCorrectionSystemPrompt,
  buildCompleteCorrectionSystemPrompt,
  buildStandardCorrectionPrompt,
  buildCompleteCorrectionPrompt,
} from "./prompts/index.js";
import { logCorrectionDebug, logCorrectionResult } from "../utils/index.js";
import type { QuizAnswer, CorrectQuizOptions } from "../types/index.js";

/** Individual question correction result */
interface QuestionCorrection {
  questionId: string;
  isCorrect: boolean;
  score: number;
  feedback: string;
  correctAnswer?: string;
  explanation?: string;
}

/** Result of quiz correction */
interface CorrectionResult {
  corrections: QuestionCorrection[];
  totalScore?: number;
  overallFeedback?: string;
  recommendations?: string[];
}

/** Extended API config for GPT-5 models */
interface ExtendedChatConfig extends ChatCompletionCreateParamsNonStreaming {
  reasoning_effort?: "low" | "medium" | "high";
  max_completion_tokens?: number;
}

/**
 * Classe pour la correction de quiz via Chat Completion avec JSON strict
 */
export class ChatCorrection {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  /**
   * Corrige un quiz standard avec Chat Completion + JSON strict
   */
  async correctStandardQuizChatCompletion(
    quizId: string,
    answers: QuizAnswer[],
    options?: CorrectQuizOptions,
  ): Promise<CorrectionResult> {
    try {
      const correctionModel = AIService.getQuizCorrectionModel();
      logger.log(
        `🚀 [CORRECTION] Correction standard via Chat Completion + JSON strict (${correctionModel})`,
      );

      // Debug des données reçues
      logCorrectionDebug(quizId, answers, options?.questions || []);

      // Construire les messages pour correction
      const systemPrompt = buildCorrectionSystemPrompt();
      const userPrompt = buildStandardCorrectionPrompt(quizId, answers, options);

      // Debug du prompt utilisateur (tronqué)
      logger.log(
        "🐛 [DEBUG] [CORRECTION] Prompt utilisateur (500 premiers caractères):",
        userPrompt.substring(0, 500) + "...",
      );

      logger.log(`📤 [CORRECTION] Envoi à ${correctionModel} avec JSON strict`);

      // Configuration de base pour l'appel API
      const apiConfig: ExtendedChatConfig = {
        model: correctionModel,
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: userPrompt,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "quiz_correction_standard",
            strict: true,
            schema: QUIZ_CORRECTION_STANDARD_SCHEMA,
          },
        },
      };

      // Configuration spécifique reasoning models (GPT-5, o1, o3, …)
      if (isReasoningModel(correctionModel)) {
        apiConfig.reasoning_effort = "low";
        apiConfig.max_completion_tokens = 4000;
        logger.log(
          "🧠 [CORRECTION] Reasoning model détecté : reasoning_effort=low, max_completion_tokens=4000, temperature=1 (défaut)",
        );
      } else {
        apiConfig.temperature = 0.3;
        apiConfig.max_tokens = 4000;
      }

      // Appel chat completion avec JSON strict
      const completion = await this.openai.chat.completions.create(
        apiConfig as ChatCompletionCreateParamsNonStreaming,
      );

      const responseContent = completion.choices[0]?.message?.content;
      if (!responseContent) {
        throw new Error("Aucune réponse du modèle pour la correction");
      }

      // Parser la réponse JSON
      const result = JSON.parse(responseContent);

      // Debug du résultat de correction
      logCorrectionResult(result);

      if (result && result.corrections && Array.isArray(result.corrections)) {
        logger.log("✅ [CORRECTION] Correction standard générée avec succès via chat completion");
        return result;
      }

      logger.error("❌ [CORRECTION] Réponse inattendue du chat completion:", result);
      throw new Error("Aucune correction valide générée");
    } catch (error) {
      logger.error("❌ [CORRECTION] Erreur correction standard:", error);
      throw error;
    }
  }

  /**
   * Corrige un quiz complet avec Chat Completion + JSON strict
   */
  async correctCompleteQuizChatCompletion(
    quizId: string,
    answers: QuizAnswer[],
    options?: CorrectQuizOptions,
  ): Promise<CorrectionResult> {
    try {
      const correctionModel = AIService.getQuizCorrectionModel();
      logger.log(
        `🚀 [CORRECTION] Correction complète via Chat Completion + JSON strict (${correctionModel})`,
      );

      // Construire les messages pour correction complète
      const systemPrompt = buildCompleteCorrectionSystemPrompt();
      const userPrompt = buildCompleteCorrectionPrompt(quizId, answers, options);

      logger.log(`📤 [CORRECTION] Envoi à ${correctionModel} avec JSON strict (schéma complet)`);

      // Configuration de base pour l'appel API
      const apiConfig: ExtendedChatConfig = {
        model: correctionModel,
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: userPrompt,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "quiz_correction_complete",
            strict: true,
            schema: QUIZ_CORRECTION_COMPLETE_SCHEMA,
          },
        },
      };

      // Configuration spécifique reasoning models (GPT-5, o1, o3, …)
      if (isReasoningModel(correctionModel)) {
        apiConfig.reasoning_effort = "low";
        apiConfig.max_completion_tokens = 6000;
        logger.log(
          "🧠 [CORRECTION] Reasoning model détecté : reasoning_effort=low, max_completion_tokens=6000, temperature=1 (défaut)",
        );
      } else {
        apiConfig.temperature = 0.3;
        apiConfig.max_tokens = 6000;
      }

      // Appel chat completion avec JSON strict
      const completion = await this.openai.chat.completions.create(
        apiConfig as ChatCompletionCreateParamsNonStreaming,
      );

      const responseContent = completion.choices[0]?.message?.content;
      if (!responseContent) {
        throw new Error("Aucune réponse du modèle pour la correction complète");
      }

      // Parser la réponse JSON
      const result = JSON.parse(responseContent);

      if (result && result.corrections && Array.isArray(result.corrections)) {
        logger.log("✅ [CORRECTION] Correction complète générée avec succès via chat completion");
        return result;
      }

      logger.error("❌ [CORRECTION] Réponse inattendue du chat completion:", result);
      throw new Error("Aucune correction complète valide générée");
    } catch (error) {
      logger.error("❌ [CORRECTION] Erreur correction complète:", error);
      throw error;
    }
  }

  /**
   * Méthode de correction générique (compatibilité)
   * Route vers la bonne méthode selon le type
   */
  async correctQuiz(
    quizId: string,
    answers: Array<{ question_id: string; user_answer: string }>,
    options: CorrectQuizOptions = {},
  ): Promise<CorrectionResult> {
    const formattedAnswers = answers.map((a) => ({
      questionId: a.question_id,
      answer: a.user_answer,
    }));

    // Utiliser les nouvelles méthodes Chat Completion
    switch (options.type) {
      case "with_graphics":
        return this.correctCompleteQuizChatCompletion(quizId, formattedAnswers, {
          graphicsData: options.graphicsData || [],
          documentsData: [],
          correctionType: "graphics",
          questions: options.questions,
        });
      case "with_documents":
        return this.correctCompleteQuizChatCompletion(quizId, formattedAnswers, {
          graphicsData: [],
          documentsData: options.documentsData || [],
          correctionType: "documents",
          questions: options.questions,
        });
      case "complete":
        return this.correctCompleteQuizChatCompletion(quizId, formattedAnswers, {
          graphicsData: options.graphicsData || [],
          documentsData: options.documentsData || [],
          correctionType: "complete",
          questions: options.questions,
        });
      default:
        return this.correctStandardQuizChatCompletion(quizId, formattedAnswers, {
          questions: options.questions,
        });
    }
  }
}

// Export d'une instance par défaut
export const chatCorrection = new ChatCorrection();
