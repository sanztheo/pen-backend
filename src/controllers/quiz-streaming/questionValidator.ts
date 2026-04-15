/**
 * Question Validator — Post-generation RAGAS-style grounding check.
 * Step [4] of the quiz pipeline: Analyze → Plan → Extract → Generate → [Validate].
 *
 * For each generated question, verifies that the correct answer is directly
 * supportable from the course text (paraphrase or direct quote).
 * Invalid questions are tagged in metadata.groundingValid=false and logged.
 *
 * Falls back to all-valid on any failure to avoid blocking question delivery.
 */

import { AIService } from "../../services/ai/base.js";
import { logger } from "../../utils/logger.js";
import type { Question } from "../../services/quiz/types.js";

const VALIDATION_TIMEOUT_MS = 45_000;
const MAX_COURSE_CHARS = 10_000;

interface QuestionValidationResult {
  index: number;
  valid: boolean;
  reason?: string;
}

interface ValidatorLLMResponse {
  results?: QuestionValidationResult[];
}

/**
 * Validate that each question's correct answer is grounded in the course text.
 * Tags questions with groundingValid in metadata.
 *
 * @returns Questions with metadata.groundingValid set (true/false)
 */
export async function validateQuestionGrounding(
  questions: Question[],
  courseText: string,
): Promise<Question[]> {
  if (!courseText.trim() || questions.length === 0) return questions;

  const questionsJson = JSON.stringify(
    questions.map((q, i) => {
      const correctOption = Array.isArray(q.options) ? q.options.find((o) => o.isCorrect) : null;
      return {
        index: i,
        question: q.question,
        correctAnswer: correctOption?.text ?? q.expectedAnswer ?? "",
      };
    }),
  );

  const truncatedText = courseText.slice(0, MAX_COURSE_CHARS);

  const prompt = `<task>
For each question, determine if the correct answer is DIRECTLY SUPPORTED by the course content.
"Directly supported" means the answer can be derived as a paraphrase or direct quote from the text.

Fail condition: The correct answer relies on knowledge ABSENT from the course content,
even if the knowledge is generally true or the author is mentioned in the text.
</task>

<questions_to_validate>
${questionsJson}
</questions_to_validate>

<course_content>
${truncatedText}
</course_content>

<output_format>
Return ONLY valid JSON:
{
  "results": [
    { "index": 0, "valid": true },
    { "index": 1, "valid": false, "reason": "The answer mentions X which is not stated in the course" }
  ]
}
All question indexes must be present in results.
</output_format>`;

  try {
    const model = AIService.getQuizGenerationModel();
    const client = AIService.getOpenAICompatibleClient(model);

    const response = await client.chat.completions.create(
      {
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        max_tokens: 1_500,
        response_format: { type: "json_object" },
      },
      { signal: AbortSignal.timeout(VALIDATION_TIMEOUT_MS) },
    );

    const raw = response.choices[0]?.message?.content;
    if (!raw) return tagAllValid(questions);

    const parsed = JSON.parse(raw) as ValidatorLLMResponse;
    if (!Array.isArray(parsed.results)) return tagAllValid(questions);

    const validityMap = new Map<number, boolean>();
    const reasonMap = new Map<number, string>();
    for (const r of parsed.results) {
      validityMap.set(r.index, r.valid);
      if (r.reason) reasonMap.set(r.index, r.reason);
    }

    const invalid = parsed.results.filter((r) => !r.valid);
    if (invalid.length > 0) {
      logger.warn(
        `[QuestionValidator] ${invalid.length}/${questions.length} questions failed grounding:\n` +
          invalid
            .map(
              (r) =>
                `  Q${r.index} "${questions[r.index]?.question?.slice(0, 60)}…": ${r.reason ?? "no reason"}`,
            )
            .join("\n"),
      );
    } else {
      logger.log(`[QuestionValidator] All ${questions.length} questions passed grounding check ✓`);
    }

    return questions.map((q, i) => ({
      ...q,
      metadata: {
        ...(q.metadata ?? {}),
        groundingValid: validityMap.get(i) ?? true,
        groundingReason: reasonMap.get(i),
      },
    }));
  } catch (err) {
    logger.warn(
      `[QuestionValidator] Validation failed — treating all as valid: ${err instanceof Error ? err.message : String(err)}`,
    );
    return tagAllValid(questions);
  }
}

function tagAllValid(questions: Question[]): Question[] {
  return questions.map((q) => ({
    ...q,
    metadata: { ...(q.metadata ?? {}), groundingValid: true },
  }));
}
