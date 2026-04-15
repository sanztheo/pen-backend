/**
 * Course Analyzer — Extracts structured concept map from course content.
 * Step [1] of the quiz pipeline: Analyze → Plan → Generate → Validate.
 *
 * Uses Gemini via OpenAI-compatible client to analyze full course text
 * and return a structured ConceptMap with weighted concepts and relations.
 */

import { z } from "zod";
import { AIService } from "../../ai/base.js";
import { logger } from "../../../utils/logger.js";

// ---------------------------------------------------------------------------
// Zod Schema & Types
// ---------------------------------------------------------------------------

const ImportanceSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

export const ConceptSchema = z.object({
  name: z.string().min(1),
  importance: ImportanceSchema,
  section: z.string().min(1),
  relatedConcepts: z.array(z.string()),
  description: z.string().min(1),
});

export const ConceptMapSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  totalConcepts: z.number().int().positive(),
  concepts: z.array(ConceptSchema).min(1),
});

export type Concept = z.infer<typeof ConceptSchema>;
export type ConceptMap = z.infer<typeof ConceptMapSchema>;

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

function buildCourseAnalysisPrompt(courseText: string, courseTitle: string): string {
  return `<system>
<role>Expert educational content analyst specialized in concept mapping and knowledge structure extraction</role>
<task>Analyze the provided course content and extract a structured concept map with weighted concepts, relationships, and a thematic summary</task>
</system>

<instructions>
<course_title>${courseTitle}</course_title>

<extraction_rules>
  <rule>Extract between 15 and 50 concepts depending on course length and depth</rule>
  <rule>Assign importance from 1 (minor detail) to 5 (central/foundational concept)</rule>
  <rule>Concepts that appear repeatedly or underpin other concepts get importance 4-5</rule>
  <rule>Concepts mentioned once as supporting details get importance 1-2</rule>
  <rule>Identify the section or topic area where each concept primarily appears</rule>
  <rule>Map relationships between concepts via the relatedConcepts field</rule>
  <rule>relatedConcepts must reference exact names of other concepts in the list</rule>
  <rule>Write a 2-3 sentence thematic summary of the entire course</rule>
  <rule>totalConcepts must equal the length of the concepts array</rule>
  <rule>Preserve the original language of the course content for concept names and descriptions</rule>
</extraction_rules>

<output_format>
  Return ONLY valid JSON matching this structure:
  {
    "title": "string — course title",
    "summary": "string — 2-3 sentence thematic summary",
    "totalConcepts": "number — count of concepts",
    "concepts": [
      {
        "name": "string — concept name",
        "importance": "1|2|3|4|5",
        "section": "string — section where it appears",
        "relatedConcepts": ["string — names of related concepts"],
        "description": "string — one-sentence description"
      }
    ]
  }
</output_format>
</instructions>

<rules>
<rule>Return ONLY valid JSON, no markdown fences or explanations</rule>
<rule>Every concept must have at least one relatedConcept (unless truly isolated)</rule>
<rule>Importance distribution should follow a pyramid: few 5s, more 3s, many 1-2s</rule>
</rules>

<content>
${courseText}
</content>`;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max characters of course text to send to the LLM to stay within context limits */
const MAX_COURSE_TEXT_LENGTH = 400_000;

/** LLM response max tokens — concept maps with 15-50 concepts can exceed 6000 tokens */
const MAX_RESPONSE_TOKENS = 8192;

/** Request timeout in milliseconds */
const REQUEST_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Dependency injection for testability
// ---------------------------------------------------------------------------

/** Minimal interface for the OpenAI-compatible chat client used by this module */
export interface ChatClient {
  chat: {
    completions: {
      create: (
        params: {
          model: string;
          messages: Array<{ role: string; content: string }>;
          temperature: number;
          max_tokens: number;
          response_format: { type: string };
        },
        options?: { signal?: AbortSignal },
      ) => Promise<{
        choices: Array<{ message: { content: string | null } }>;
      }>;
    };
  };
}

export interface AnalyzeCourseOptions {
  /** Override the LLM client (for testing) */
  client?: ChatClient;
  /** Override the model ID (for testing) */
  model?: string;
}

// ---------------------------------------------------------------------------
// Main Function
// ---------------------------------------------------------------------------

/**
 * Analyze a full course and return a structured concept map.
 *
 * @param courseText - Plain text of the entire course (up to ~200K tokens)
 * @param courseTitle - Title of the course
 * @param options - Optional overrides for client/model (used in tests)
 * @returns Parsed and validated ConceptMap
 */
export async function analyzeCourse(
  courseText: string,
  courseTitle: string,
  options?: AnalyzeCourseOptions,
): Promise<ConceptMap> {
  const startTime = Date.now();
  logger.log(`[CourseAnalyzer] Starting analysis for "${courseTitle}"`);

  if (!courseText.trim()) {
    throw new Error(`[CourseAnalyzer] Empty course text received for "${courseTitle}"`);
  }

  // Truncate if needed to respect context window
  const truncatedText =
    courseText.length > MAX_COURSE_TEXT_LENGTH
      ? courseText.slice(0, MAX_COURSE_TEXT_LENGTH)
      : courseText;

  if (courseText.length > MAX_COURSE_TEXT_LENGTH) {
    logger.warn(
      `[CourseAnalyzer] Course text truncated from ${courseText.length} to ${MAX_COURSE_TEXT_LENGTH} chars`,
    );
  }

  const model = options?.model ?? AIService.getQuizGenerationModel();
  const client = options?.client ?? (AIService.getOpenAICompatibleClient(model) as ChatClient);

  const prompt = buildCourseAnalysisPrompt(truncatedText, courseTitle);

  logger.log(`[CourseAnalyzer] Sending to ${model} (${truncatedText.length} chars)`);

  const response = await client.chat.completions.create(
    {
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: MAX_RESPONSE_TOKENS,
      response_format: { type: "json_object" },
    },
    { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
  );

  const rawContent = response.choices[0]?.message?.content;
  if (!rawContent) {
    throw new Error("[CourseAnalyzer] LLM returned empty response");
  }

  // Extract JSON object in case the model prefixes with text like "Here is..."
  const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(
      `[CourseAnalyzer] LLM response contains no JSON object (got: "${rawContent.slice(0, 80)}...")`,
    );
  }

  // Parse and validate with Zod
  const parsed: unknown = JSON.parse(jsonMatch[0]);
  const result = ConceptMapSchema.safeParse(parsed);

  if (!result.success) {
    logger.error("[CourseAnalyzer] Schema validation failed:", result.error.issues);
    throw new Error(
      `[CourseAnalyzer] Invalid concept map structure: ${result.error.issues.map((i) => i.message).join(", ")}`,
    );
  }

  const conceptMap = result.data;

  // Reconcile totalConcepts with actual array length
  if (conceptMap.totalConcepts !== conceptMap.concepts.length) {
    logger.warn(
      `[CourseAnalyzer] totalConcepts mismatch: declared ${conceptMap.totalConcepts}, actual ${conceptMap.concepts.length}. Correcting.`,
    );
    conceptMap.totalConcepts = conceptMap.concepts.length;
  }

  const elapsed = Date.now() - startTime;
  logger.log(
    `[CourseAnalyzer] Analysis complete in ${elapsed}ms — ${conceptMap.concepts.length} concepts extracted`,
  );

  return conceptMap;
}
