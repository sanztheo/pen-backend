/**
 * Quiz Title Generator
 * Generates intelligent, descriptive titles based on quiz content.
 * Utilise le client adapté au provider du modèle (Moonshot pour kimi-k2.5, etc.).
 */

import { SecureLogger } from "../../../middlewares/secureLogging.js";
import { MODELS, isFixedTempModel } from "../../../config/models.js";
import { AIService } from "../../ai/base.js";

interface TitleGeneratorParams {
  schoolLevel: string;
  pageNames?: string[];
  subject?: string;
  questionCount?: number;
  difficulty?: string;
}

const TITLE_GENERATION_PROMPT = `<system>
<role>Quiz title generator for educational platform</role>
<task>Generate a short, descriptive French title for a quiz</task>
</system>

<instructions>
<output_format>JSON object with a "title" field containing the title string</output_format>
<constraints>
  <min_length>5 characters</min_length>
  <max_length>50 characters</max_length>
  <language>French</language>
  <style>Concise, descriptive, engaging</style>
</constraints>
</instructions>

<rules>
<rule>Title must be in French</rule>
<rule>Do NOT include "Quiz" at the beginning - just the topic</rule>
<rule>Make it descriptive of the content, not generic</rule>
<rule>Use proper capitalization (first letter uppercase)</rule>
<rule>Title must be between 5 and 50 characters — NEVER a single word or letter</rule>
</rules>

<examples>
<example>
<input>schoolLevel: LYCEE_TERMINALE, pages: ["La Seconde Guerre mondiale"], subject: Histoire</input>
<output>{"title": "La Seconde Guerre mondiale"}</output>
</example>
<example>
<input>schoolLevel: COLLEGE, pages: ["Équations du premier degré", "Fonctions affines"], subject: Mathématiques</input>
<output>{"title": "Équations et fonctions affines"}</output>
</example>
<example>
<input>schoolLevel: SUPERIEUR, pages: ["Introduction au Machine Learning"], subject: Informatique</input>
<output>{"title": "Fondamentaux du Machine Learning"}</output>
</example>
</examples>`;

/**
 * Generate an intelligent quiz title using gpt-4.1-nano
 */
export async function generateQuizTitle(params: TitleGeneratorParams): Promise<string> {
  const { schoolLevel, pageNames = [], subject, questionCount, difficulty } = params;

  // Build context for the AI
  const contextParts: string[] = [];
  contextParts.push(`schoolLevel: ${schoolLevel}`);

  if (pageNames.length > 0) {
    contextParts.push(`pages: ${JSON.stringify(pageNames.slice(0, 5))}`);
  }

  if (subject) {
    contextParts.push(`subject: ${subject}`);
  }

  if (difficulty) {
    contextParts.push(`difficulty: ${difficulty}`);
  }

  if (questionCount) {
    contextParts.push(`questionCount: ${questionCount}`);
  }

  const userMessage = contextParts.join(", ");

  const modelId = MODELS.LIGHTWEIGHT;
  const client = AIService.getOpenAICompatibleClient(modelId);
  const MAX_RETRIES = 3;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model: modelId,
        messages: [
          { role: "system", content: TITLE_GENERATION_PROMPT },
          { role: "user", content: userMessage },
        ],
        max_tokens: 120,
        temperature: isFixedTempModel(modelId) ? 1 : 0.7,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "quiz_title",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["title"],
              properties: {
                title: {
                  type: "string",
                  description: "French quiz title, 5-50 characters, descriptive, no 'Quiz' prefix",
                },
              },
            },
          },
        },
      });

      const rawContent = response.choices[0]?.message?.content?.trim();
      if (!rawContent) {
        return getFallbackTitle(params);
      }

      // Some models prefix their response with text like "Here is the JSON..."
      // Extract the JSON object regardless of surrounding text
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        SecureLogger.log(`[TITLE-GEN] No JSON found in response, using fallback`);
        return getFallbackTitle(params);
      }
      const parsed = JSON.parse(jsonMatch[0]) as { title?: string };
      const generatedTitle = parsed.title?.trim();

      if (generatedTitle && generatedTitle.length >= 5 && generatedTitle.length <= 100) {
        SecureLogger.log(`[TITLE-GEN] Generated: "${generatedTitle}" from ${userMessage}`);
        return generatedTitle;
      }

      SecureLogger.log(`[TITLE-GEN] Rejected short title "${generatedTitle}", using fallback`);
      return getFallbackTitle(params);
    } catch (error: unknown) {
      const err = error as { status?: number; type?: string };

      // Retry on 429 (engine overloaded) with exponential backoff
      if (err?.status === 429 && attempt < MAX_RETRIES - 1) {
        const delay = 1000 * (attempt + 1);
        SecureLogger.log(
          `[TITLE-GEN] 429 overloaded, retry ${attempt + 1}/${MAX_RETRIES - 1} in ${delay}ms...`,
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      SecureLogger.error("[TITLE-GEN] Error generating title:", error);
      if (err?.status === 401 || err?.type === "invalid_authentication_error") {
        SecureLogger.log(
          "[TITLE-GEN] 💡 401 = clé API rejetée. Vérifiez MOONSHOT_API_KEY dans Infisical (clé valide sur platform.moonshot.ai). Si clé globale, utilisez MOONSHOT_BASE_URL=https://api.moonshot.ai/v1 (défaut).",
        );
      }
      return getFallbackTitle(params);
    }
  }

  return getFallbackTitle(params);
}

/**
 * Fallback title generation without AI
 */
function getFallbackTitle(params: TitleGeneratorParams): string {
  const { schoolLevel, pageNames = [], subject } = params;

  // If we have page names, use the first one
  if (pageNames.length > 0) {
    const firstPage = pageNames[0];
    if (firstPage.length <= 50) {
      return firstPage;
    }
    return firstPage.substring(0, 47) + "...";
  }

  // If we have a subject, use it
  if (subject) {
    return subject;
  }

  // Map school levels to readable French names
  const levelNames: Record<string, string> = {
    PRIMAIRE: "Primaire",
    COLLEGE: "Collège",
    LYCEE_SECONDE: "Seconde",
    LYCEE_PREMIERE: "Première",
    LYCEE_TERMINALE: "Terminale",
    SUPERIEUR: "Études supérieures",
    AUTRE: "Général",
  };

  return levelNames[schoolLevel] || "Quiz";
}
