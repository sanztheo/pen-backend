/**
 * Fact Extractor — Anchors each planned question to a verbatim source quote.
 * Step [2.5] of the quiz pipeline: Analyze → Plan → [Extract] → Generate → Validate.
 *
 * For each planned question, finds the most relevant 1-2 sentences in the course text
 * that directly support a factual answer. These extracts are injected into the batch
 * prompt as <source_extract> anchors, implementing Answer-First generation:
 * the correct answer is grounded in text BEFORE the question is written.
 *
 * Falls back to empty map on any failure — generation proceeds without anchoring.
 */

import { AIService } from "../../services/ai/base.js";
import { logger } from "../../utils/logger.js";
import type { PlannedQuestion } from "../../services/quiz/intelligence/quizPlanner.js";

const EXTRACTION_TIMEOUT_MS = 45_000;
// Limit course text sent to extractor to keep the call fast
const MAX_COURSE_CHARS = 14_000;

/** Map of plannedQuestion.index → verbatim source quote */
export type SourceExtracts = Map<number, string>;

/**
 * Extract verbatim source passages for each planned question.
 *
 * Each passage is the factual basis the LLM MUST use when generating the
 * correct answer — this prevents hallucination by construction.
 */
export async function extractSourceFacts(
  courseText: string,
  plannedQuestions: PlannedQuestion[],
): Promise<SourceExtracts> {
  if (!courseText.trim() || plannedQuestions.length === 0) {
    return new Map();
  }

  const specsJson = JSON.stringify(
    plannedQuestions.map((pq) => ({
      index: pq.index,
      concept: pq.targetConcept,
      angle: pq.angle,
    })),
  );

  const truncatedText = courseText.slice(0, MAX_COURSE_CHARS);

  const prompt = `<task>
For each question spec below, locate and extract the single most relevant sentence or short passage
(1-2 sentences maximum) from the course content that DIRECTLY states or implies the factual answer
related to the concept and angle described.

Rules:
- The extracted text MUST be verbatim or near-verbatim from the course content
- Do NOT paraphrase, summarize, or add information not in the text
- If no relevant passage exists, return an empty string for that index
- Prefer the most specific and informative sentence over a vague general one
</task>

<question_specs>
${specsJson}
</question_specs>

<course_content>
${truncatedText}
</course_content>

<output_format>
Return ONLY valid JSON: { "extracts": { "1": "...", "2": "...", ... } }
Keys are question index numbers as strings. Values are verbatim passages from the course.
</output_format>`;

  try {
    const model = AIService.getQuizGenerationModel();
    const client = AIService.getOpenAICompatibleClient(model);

    const response = await client.chat.completions.create(
      {
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        max_tokens: 2_500,
        response_format: { type: "json_object" },
      },
      { signal: AbortSignal.timeout(EXTRACTION_TIMEOUT_MS) },
    );

    const raw = response.choices[0]?.message?.content;
    if (!raw) return new Map();

    const parsed = JSON.parse(raw) as { extracts?: Record<string, string> };
    if (!parsed.extracts || typeof parsed.extracts !== "object") return new Map();

    const result: SourceExtracts = new Map();
    for (const [k, v] of Object.entries(parsed.extracts)) {
      const idx = parseInt(k, 10);
      if (!isNaN(idx) && typeof v === "string" && v.trim()) {
        result.set(idx, v.trim());
      }
    }

    logger.log(
      `[FactExtractor] Anchored ${result.size}/${plannedQuestions.length} questions to source extracts`,
    );
    return result;
  } catch (err) {
    logger.warn(
      `[FactExtractor] Extraction failed — proceeding without anchoring: ${err instanceof Error ? err.message : String(err)}`,
    );
    return new Map();
  }
}
