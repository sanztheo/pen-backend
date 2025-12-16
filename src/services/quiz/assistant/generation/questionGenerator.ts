// assistant/generation/questionGenerator.ts - Générateur de questions via Chat Completion

import OpenAI from "openai";
import { AIService } from "../../../ai/base.js";
import {
  getPersonalizationContextForUser,
  type PersonalizationContext,
} from "../../utils/personalizationUtils.js";
import { QUIZ_QUESTION_SCHEMA } from "../config/index.js";
import { buildSystemPrompt } from "./prompts/systemPrompt.js";
import { buildSingleQuestionPrompt } from "./prompts/questionPrompt.js";

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
  async generateSingleQuestion(request: any): Promise<any> {
    try {
      const generationModel = AIService.getQuizGenerationModel();
      console.log(
        `🚀 [STREAMING] Génération via Chat Completion + JSON strict (${generationModel})`,
      );
      console.log(
        `🧠 [STREAMING-DEBUG] ragContext dans request: ${request.ragContext ? `${request.ragContext.length} caractères` : "VIDE ou undefined"}`,
      );

      // Récupérer la personnalisation utilisateur si userId fourni
      let personalization: PersonalizationContext | undefined;
      if (request.userId) {
        try {
          personalization = await getPersonalizationContextForUser(
            request.userId,
          );
          if (personalization?.hasPersonalization) {
            console.log(
              `👤 [PERSONALIZATION] Contexte utilisateur chargé: ${personalization.classe || "N/A"}, ${personalization.domaine || "N/A"}`,
            );
          }
        } catch (error) {
          console.warn(
            "⚠️ [PERSONALIZATION] Impossible de charger la personnalisation:",
            error,
          );
        }
      }

      // Construire les messages pour chat completion avec personnalisation
      const systemPrompt = buildSystemPrompt(personalization);
      const userPrompt = buildSingleQuestionPrompt(request, personalization);

      console.log(`📤 [STREAMING] Envoi à ${generationModel} avec JSON strict`);

      // Configuration de base pour l'appel API
      const apiConfig: any = {
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
      if (generationModel.includes("gpt-5")) {
        apiConfig.reasoning_effort = "low";
        apiConfig.max_completion_tokens = 2000;
        // GPT-5 n'accepte que temperature=1 (défaut), on ne le spécifie pas
        console.log(
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
      const result = JSON.parse(responseContent);

      if (
        result &&
        result.questions &&
        Array.isArray(result.questions) &&
        result.questions.length > 0
      ) {
        console.log(
          "✅ [STREAMING] Question générée avec succès via chat completion",
        );
        return result;
      }

      console.error(
        "❌ [STREAMING] Réponse inattendue du chat completion:",
        result,
      );
      throw new Error("Aucune question valide générée");
    } catch (error) {
      console.error("❌ [STREAMING] Erreur génération question:", error);
      throw error;
    }
  }
}

// Export d'une instance par défaut
export const questionGenerator = new QuestionGenerator();
