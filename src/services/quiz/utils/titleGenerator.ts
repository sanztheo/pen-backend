/**
 * Quiz Title Generator using gpt-4.1-nano
 * Generates intelligent, descriptive titles based on quiz content
 */

import OpenAI from "openai";
import SecureLogger from "../../../middlewares/secureLogging.js";

const openai = new OpenAI();

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
<output_format>Return ONLY the title text, no quotes, no explanation</output_format>
<constraints>
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
<rule>Keep it under 50 characters</rule>
</rules>

<examples>
<example>
<input>schoolLevel: LYCEE_TERMINALE, pages: ["La Seconde Guerre mondiale"], subject: Histoire</input>
<output>La Seconde Guerre mondiale</output>
</example>
<example>
<input>schoolLevel: COLLEGE, pages: ["Équations du premier degré", "Fonctions affines"], subject: Mathématiques</input>
<output>Équations et fonctions affines</output>
</example>
<example>
<input>schoolLevel: SUPERIEUR, pages: ["Introduction au Machine Learning"], subject: Informatique</input>
<output>Fondamentaux du Machine Learning</output>
</example>
<example>
<input>schoolLevel: LYCEE_PREMIERE, pages: [], subject: Physique-Chimie</input>
<output>Physique-Chimie niveau Première</output>
</example>
</examples>`;

/**
 * Generate an intelligent quiz title using gpt-4.1-nano
 */
export async function generateQuizTitle(
  params: TitleGeneratorParams,
): Promise<string> {
  const {
    schoolLevel,
    pageNames = [],
    subject,
    questionCount,
    difficulty,
  } = params;

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

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4.1-nano",
      messages: [
        { role: "system", content: TITLE_GENERATION_PROMPT },
        { role: "user", content: userMessage },
      ],
      max_tokens: 60,
      temperature: 0.7,
    });

    const generatedTitle = response.choices[0]?.message?.content?.trim();

    if (
      generatedTitle &&
      generatedTitle.length > 0 &&
      generatedTitle.length <= 100
    ) {
      SecureLogger.log(
        `[TITLE-GEN] Generated: "${generatedTitle}" from ${userMessage}`,
      );
      return generatedTitle;
    }

    // Fallback if generation fails
    return getFallbackTitle(params);
  } catch (error) {
    SecureLogger.error("[TITLE-GEN] Error generating title:", error);
    return getFallbackTitle(params);
  }
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
