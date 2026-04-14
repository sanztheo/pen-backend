/**
 * 🤖 Quiz Preprocessor Agent
 * PEN-33: Analyse les sources et détermine les paramètres optimaux du quiz
 *
 * SÉCURITÉ:
 * - Validation Zod des réponses IA (anti-malformed response)
 * - Fallback sur valeurs par défaut sécurisées
 * - Timeout sur appels OpenAI
 */

import { logger } from "../../../utils/logger.js";
import OpenAI from "openai";
import { z } from "zod";
import { AIService } from "../../ai/base.js";
import {
  buildPreprocessorPrompt,
  QUIZ_PREPROCESSOR_SYSTEM_PROMPT,
  PREPROCESSOR_MODEL,
  PREPROCESSOR_TEMPERATURE,
  PREPROCESSOR_MAX_TOKENS,
  PreprocessorPromptParams,
  PreprocessorAIOutput,
} from "./prompts.js";
import { quizLimitValidator } from "./limitValidator.js";
import type { QuizPreprocessorOutput, QuestionType } from "./types.js";

// ============================================================================
// SÉCURITÉ: Schéma Zod pour validation stricte de la réponse IA
// ============================================================================
const QuestionTypesSchema = z
  .object({
    multipleChoice: z.number().int().min(0).max(100),
    trueFalse: z.number().int().min(0).max(100),
    openEnded: z.number().int().min(0).max(100),
    matching: z.number().int().min(0).max(100),
  })
  .refine((data) => data.multipleChoice + data.trueFalse + data.openEnded + data.matching === 100, {
    message: "Question type percentages must sum to 100",
  });

const PreprocessorAIOutputSchema = z.object({
  recommendedQuestions: z.number().int().min(1).max(100),
  questionTypes: QuestionTypesSchema,
  difficulty: z.enum(["easy", "medium", "hard"]),
  suggestedDuration: z.number().int().min(0).max(180),
  contentCoverage: z.enum(["focused", "balanced", "comprehensive"]),
  reasoning: z.string().min(1).max(1000),
});

// Valeurs par défaut sécurisées en cas d'échec IA
const DEFAULT_AI_OUTPUT: PreprocessorAIOutput = {
  recommendedQuestions: 5,
  questionTypes: {
    multipleChoice: 60,
    trueFalse: 20,
    openEnded: 10,
    matching: 10,
  },
  difficulty: "medium",
  suggestedDuration: 10,
  contentCoverage: "balanced",
  reasoning: "Paramètres par défaut (fallback)",
};

/**
 * Agent IA qui analyse les sources et recommande les paramètres de quiz
 */
export class QuizPreprocessorAgent {
  private openai: OpenAI;

  constructor() {
    this.openai = AIService.getOpenAICompatibleClient(PREPROCESSOR_MODEL);
  }

  /**
   * Analyse les sources et retourne les paramètres optimaux du quiz
   */
  async analyzeAndRecommend(
    params: PreprocessorPromptParams,
    userId: string,
  ): Promise<QuizPreprocessorOutput> {
    // 1. Appeler l'IA avec le prompt
    const userPrompt = buildPreprocessorPrompt(params);

    const completion = await this.openai.chat.completions.create(
      {
        model: PREPROCESSOR_MODEL,
        temperature: PREPROCESSOR_TEMPERATURE,
        max_tokens: PREPROCESSOR_MAX_TOKENS,
        messages: [
          { role: "system", content: QUIZ_PREPROCESSOR_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      },
      {
        timeout: 10000, // 10s timeout
      },
    );

    const rawContent = completion.choices[0]?.message?.content;
    if (!rawContent) {
      throw new Error("Empty response from OpenAI");
    }

    // 2. Parser la réponse JSON
    const aiOutput = this.parseAIResponse(rawContent);

    // 3. Convertir PreprocessorAIOutput → QuizPreprocessorOutput
    const internalOutput = this.convertToInternalFormat(aiOutput);

    // 4. Valider et corriger selon limites utilisateur
    const validationResult = await quizLimitValidator.validateAndCorrect(internalOutput, userId);

    // 5. Retourner les paramètres validés
    return validationResult.correctedOutput;
  }

  /**
   * Parse la réponse JSON de l'IA avec validation Zod
   * SÉCURITÉ: Utilise safeParse pour éviter les crashes et retourne un fallback sécurisé
   */
  private parseAIResponse(content: string): PreprocessorAIOutput {
    // Gérer les cas où l'IA ajoute du markdown
    let jsonContent = content.trim();

    // Retirer les code blocks markdown si présents
    if (jsonContent.startsWith("```json")) {
      jsonContent = jsonContent.replace(/^```json\s*/, "").replace(/\s*```$/, "");
    } else if (jsonContent.startsWith("```")) {
      jsonContent = jsonContent.replace(/^```\s*/, "").replace(/\s*```$/, "");
    }

    // Parser le JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonContent);
    } catch (error) {
      logger.error("[PREPROCESSOR] JSON parse failed, using fallback:", error);
      return DEFAULT_AI_OUTPUT;
    }

    // SÉCURITÉ: Validation stricte avec Zod (safeParse ne throw pas)
    const validationResult = PreprocessorAIOutputSchema.safeParse(parsed);

    if (!validationResult.success) {
      logger.warn("[PREPROCESSOR] Zod validation failed:", {
        errors: validationResult.error.errors.map((e) => ({
          path: e.path.join("."),
          message: e.message,
        })),
        rawContent: content.slice(0, 200), // Log partiel pour debug
      });
      return DEFAULT_AI_OUTPUT;
    }

    return validationResult.data;
  }

  /**
   * Convertit PreprocessorAIOutput (format IA) vers QuizPreprocessorOutput (format interne)
   */
  private convertToInternalFormat(aiOutput: PreprocessorAIOutput): QuizPreprocessorOutput {
    // Convertir les pourcentages en types concrets
    const questionTypes = this.percentagesToQuestionTypes(
      aiOutput.questionTypes,
      aiOutput.recommendedQuestions,
    );

    return {
      recommendedQuestionCount: aiOutput.recommendedQuestions,
      questionTypes,
      difficulty: aiOutput.difficulty,
      suggestedTimeLimit: aiOutput.suggestedDuration > 0 ? aiOutput.suggestedDuration : null,
      reasoning: aiOutput.reasoning,
    };
  }

  /**
   * Convertit les pourcentages en liste de types de questions
   * Ex: { multipleChoice: 40, trueFalse: 30, ... } + total=10
   *     → ["MULTIPLE_CHOICE", "MULTIPLE_CHOICE", "MULTIPLE_CHOICE", "MULTIPLE_CHOICE", "TRUE_FALSE", ...]
   */
  private percentagesToQuestionTypes(
    percentages: {
      multipleChoice: number;
      trueFalse: number;
      openEnded: number;
      matching: number;
    },
    totalQuestions: number,
  ): QuestionType[] {
    const types: QuestionType[] = [];

    // Calculer le nombre de questions par type
    const counts = {
      MULTIPLE_CHOICE: Math.round((percentages.multipleChoice / 100) * totalQuestions),
      TRUE_FALSE: Math.round((percentages.trueFalse / 100) * totalQuestions),
      OPEN_QUESTION: Math.round((percentages.openEnded / 100) * totalQuestions),
      MATCHING: Math.round((percentages.matching / 100) * totalQuestions),
    };

    // Vérifier que la somme ne dépasse pas totalQuestions
    const sum = Object.values(counts).reduce((a, b) => a + b, 0);

    // Ajuster si la somme est différente (arrondi)
    if (sum !== totalQuestions) {
      const diff = totalQuestions - sum;
      // Ajouter/retirer la différence au type le plus représenté
      const maxType = Object.entries(counts).reduce((a, b) =>
        b[1] > a[1] ? b : a,
      )[0] as QuestionType;
      counts[maxType] = Math.max(0, counts[maxType] + diff);
    }

    // Construire le tableau de types
    for (const [type, count] of Object.entries(counts) as [QuestionType, number][]) {
      for (let i = 0; i < count; i++) {
        types.push(type);
      }
    }

    // Si le tableau est vide (edge case), utiliser MULTIPLE_CHOICE par défaut
    if (types.length === 0) {
      for (let i = 0; i < totalQuestions; i++) {
        types.push("MULTIPLE_CHOICE");
      }
    }

    return types;
  }
}

// Export singleton instance
export const quizPreprocessorAgent = new QuizPreprocessorAgent();
