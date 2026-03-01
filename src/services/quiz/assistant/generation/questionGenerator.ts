// assistant/generation/questionGenerator.ts - Générateur de questions via Chat Completion

import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import { AIService } from "../../../ai/base.js";
import { isReasoningModel } from "../../../../config/models.js";
import { logger } from "../../../../utils/logger.js";
import {
  getPersonalizationContextForUser,
  type PersonalizationContext,
} from "../../utils/personalizationUtils.js";
import type { Question } from "../../types.js";
import { QUIZ_QUESTION_SCHEMA } from "../config/index.js";
import { buildSystemPrompt } from "./prompts/systemPrompt.js";
import { buildSingleQuestionPrompt } from "./prompts/questionPrompt.js";

type ExistingQuestion = { question: string };

export interface SingleQuestionGenerationRequest {
  userId?: string;
  schoolLevel?: string;
  questionTypes?: string[];
  specificSubject?: string;
  existingQuestions?: unknown[];
  lyceeSpecialties?: string[];
  focusSpecialty?: string;
  focusSpecialtyLabel?: string;
  higherEdField?: string;
  higherEdLevel?: string;
  ragContext?: string;
  coursesOnly?: boolean;
  difficulty?: string;
}

export type SingleQuestionGenerationResult = Record<string, unknown> & {
  questions: Question[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSingleQuestionGenerationResult(value: unknown): value is SingleQuestionGenerationResult {
  return isRecord(value) && Array.isArray(value.questions);
}

/** Extended API config for GPT-5 models */
interface ExtendedChatConfig extends ChatCompletionCreateParamsNonStreaming {
  reasoning_effort?: "low" | "medium" | "high";
  max_completion_tokens?: number;
}

/**
 * Classe pour la génération de questions via Chat Completion avec JSON strict
 */
export class QuestionGenerator {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  /**
   * Génère une seule question pour le streaming avec chat completion + JSON strict
   */
  async generateSingleQuestion(
    request: SingleQuestionGenerationRequest,
  ): Promise<SingleQuestionGenerationResult> {
    try {
      if (!request.schoolLevel) {
        throw new Error("Paramètre manquant: schoolLevel");
      }
      if (!request.questionTypes || request.questionTypes.length === 0) {
        throw new Error("Paramètre manquant: questionTypes");
      }

      const generationModel = AIService.getQuizGenerationModel();
      logger.log(
        `🚀 [STREAMING] Génération via Chat Completion + JSON strict (${generationModel})`,
      );
      logger.log(
        `🧠 [STREAMING-DEBUG] ragContext dans request: ${request.ragContext ? `${request.ragContext.length} caractères` : "VIDE ou undefined"}`,
      );

      // Récupérer la personnalisation utilisateur si userId fourni
      let personalization: PersonalizationContext | undefined;
      if (request.userId && typeof request.userId === "string") {
        try {
          personalization = await getPersonalizationContextForUser(request.userId);
          if (personalization?.hasPersonalization) {
            logger.log(
              `👤 [PERSONALIZATION] Contexte utilisateur chargé: ${personalization.classe || "N/A"}, ${personalization.domaine || "N/A"}`,
            );
          }
        } catch (error) {
          logger.warn("⚠️ [PERSONALIZATION] Impossible de charger la personnalisation:", error);
        }
      }

      // Construire les messages pour chat completion avec personnalisation
      const systemPrompt = buildSystemPrompt(personalization);
      const normalizedExistingQuestions: ExistingQuestion[] = Array.isArray(
        request.existingQuestions,
      )
        ? request.existingQuestions.flatMap((q) =>
            isRecord(q) && typeof q.question === "string" ? [{ question: q.question }] : [],
          )
        : [];

      const userPrompt = buildSingleQuestionPrompt(
        {
          ...request,
          schoolLevel: request.schoolLevel,
          questionTypes: request.questionTypes,
          existingQuestions: normalizedExistingQuestions,
        },
        personalization,
      );

      logger.log(`📤 [STREAMING] Envoi à ${generationModel} avec JSON strict`);

      // Configuration de base pour l'appel API
      const apiConfig: ExtendedChatConfig = {
        model: generationModel,
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
            name: "quiz_question_generation",
            strict: true,
            schema: QUIZ_QUESTION_SCHEMA,
          },
        },
      };

      // Configuration spécifique GPT-5
      if (isReasoningModel(generationModel)) {
        apiConfig.reasoning_effort = "low";
        apiConfig.max_completion_tokens = 2000;
        // GPT-5 n'accepte que temperature=1 (défaut), on ne le spécifie pas
        logger.log(
          "🧠 [STREAMING] GPT-5-mini détecté : reasoning_effort=low, max_completion_tokens=2000, temperature=1 (défaut)",
        );
      } else {
        apiConfig.temperature = 0.7;
        apiConfig.max_tokens = 2000;
      }

      // Appel chat completion avec JSON strict
      const completion = await this.openai.chat.completions.create(apiConfig);

      const responseContent = completion.choices[0]?.message?.content;
      if (!responseContent) {
        throw new Error("Aucune réponse du modèle");
      }

      // Parser la réponse JSON
      const result: unknown = JSON.parse(responseContent);

      if (isSingleQuestionGenerationResult(result) && result.questions.length > 0) {
        logger.log("✅ [STREAMING] Question générée avec succès via chat completion");
        return result;
      }

      logger.error("❌ [STREAMING] Réponse inattendue du chat completion:", result);
      throw new Error("Aucune question valide générée");
    } catch (error) {
      logger.error("❌ [STREAMING] Erreur génération question:", error);
      throw error;
    }
  }
}

// Export d'une instance par défaut
export const questionGenerator = new QuestionGenerator();
