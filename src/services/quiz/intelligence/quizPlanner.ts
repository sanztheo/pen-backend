/**
 * Quiz Planner — Creates a structured question blueprint from a concept map.
 * Step [2] of the quiz pipeline: Analyze → Plan → Generate → Validate.
 *
 * Takes the lightweight concept map (~2K tokens) produced by courseAnalyzer
 * and returns a QuizBlueprint specifying exactly what each question should
 * test, at what difficulty and Bloom level.
 */

import { z } from "zod";
import { AIService } from "../../ai/base.js";
import { logger } from "../../../utils/logger.js";
import type { ConceptMap, ChatClient } from "./courseAnalyzer.js";

// ---------------------------------------------------------------------------
// Zod Schemas & Types
// ---------------------------------------------------------------------------

export const QuizPlanConfigSchema = z.object({
  questionCount: z.number().int().positive(),
  questionTypes: z.array(z.string().min(1)).min(1),
  difficulty: z.string().optional(),
  schoolLevel: z.string().optional(),
});

export type QuizPlanConfig = z.infer<typeof QuizPlanConfigSchema>;

const PlannedQuestionSchema = z.object({
  index: z.number().int().positive(),
  targetConcept: z.string().min(1),
  questionType: z.string().min(1),
  difficulty: z.enum(["facile", "moyen", "difficile"]),
  bloomLevel: z.enum(["recall", "comprehension", "application", "analysis"]),
  angle: z.string().min(1),
});

export type PlannedQuestion = z.infer<typeof PlannedQuestionSchema>;

const DistributionSchema = z.object({
  byDifficulty: z.record(z.string(), z.number()),
  byType: z.record(z.string(), z.number()),
  byBloom: z.record(z.string(), z.number()),
});

export const QuizBlueprintSchema = z.object({
  totalQuestions: z.number().int().positive(),
  distribution: DistributionSchema,
  questions: z.array(PlannedQuestionSchema).min(1),
});

export type QuizBlueprint = z.infer<typeof QuizBlueprintSchema>;

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

/** Bloom levels used to bias each planning run toward a different emphasis */
const BLOOM_EMPHASIS = ["recall", "comprehension", "application", "analysis"] as const;

function buildPlannerPrompt(conceptMap: ConceptMap, config: QuizPlanConfig): string {
  const conceptList = conceptMap.concepts
    .map((c) => `- ${c.name} (importance: ${c.importance}, section: ${c.section})`)
    .join("\n");

  const difficultyInstruction = config.difficulty
    ? `<global_difficulty>Target overall difficulty: "${config.difficulty}". Adjust the distribution accordingly — shift more questions toward this level while keeping some variety.</global_difficulty>`
    : `<global_difficulty>Use default distribution: ~20% facile, ~50% moyen, ~30% difficile.</global_difficulty>`;

  const schoolLevelInstruction = config.schoolLevel
    ? `<school_level>Target school level: "${config.schoolLevel}". Adapt Bloom levels and question complexity accordingly.</school_level>`
    : "";

  // Inject randomness so two calls on the same concept map produce
  // substantially different blueprints. This is essential for the
  // "regenerate quiz on the same course" use-case.
  const attemptId = Math.floor(Math.random() * 1_000_000);
  const emphasis = BLOOM_EMPHASIS[Math.floor(Math.random() * BLOOM_EMPHASIS.length)];
  const variationInstruction = `<exploration_bias>
This is quiz generation attempt #${attemptId}. Explore DIFFERENT angles than a standard quiz on this topic.
This run should favor "${emphasis}" questions slightly more than the other Bloom levels.
When multiple angles exist for the same concept, pick a LESS OBVIOUS one this time.
Do NOT default to the most common interpretation — surprise the student with unexpected framings.
</exploration_bias>`;

  return `<system>
<role>Expert quiz architect specialized in educational assessment design</role>
<task>Plan exactly ${config.questionCount} quiz questions based on the provided concept map. Return a structured blueprint — do NOT write the actual questions.</task>
</system>

<instructions>
<concept_map>
<title>${conceptMap.title}</title>
<summary>${conceptMap.summary}</summary>
<concepts>
${conceptList}
</concepts>
</concept_map>

<quiz_config>
<question_count>${config.questionCount}</question_count>
<allowed_types>${config.questionTypes.join(", ")}</allowed_types>
${difficultyInstruction}
${schoolLevelInstruction}
${variationInstruction}
</quiz_config>

<planning_rules>
  <rule>Distribute questions proportionally to concept importance: importance 5 → 2-3 questions, importance 1 → 0-1 questions</rule>
  <rule>ONLY use question types from the allowed_types list — never introduce types not listed</rule>
  <rule>Vary difficulty levels: mix facile, moyen, difficile across the quiz</rule>
  <rule>Vary Bloom taxonomy levels: mix recall, comprehension, application, analysis</rule>
  <rule>Each question MUST have a unique angle — even when two questions target the same concept, they must test DIFFERENT aspects</rule>
  <rule>Every concept in the map should be covered by at least one question (if question_count allows)</rule>
  <rule>If question_count exceeds concept count, assign 2-3 questions per high-importance concept with DIFFERENT angles and Bloom levels</rule>
  <rule>The angle field should be a single sentence describing WHAT SPECIFICALLY the question will test</rule>
  <rule>targetConcept must exactly match one of the concept names from the concept map</rule>
</planning_rules>

<output_format>
Return ONLY valid JSON matching this structure:
{
  "totalQuestions": number,
  "distribution": {
    "byDifficulty": { "facile": number, "moyen": number, "difficile": number },
    "byType": { "TYPE_NAME": number },
    "byBloom": { "recall": number, "comprehension": number, "application": number, "analysis": number }
  },
  "questions": [
    {
      "index": 1,
      "targetConcept": "exact concept name from map",
      "questionType": "one of allowed types",
      "difficulty": "facile|moyen|difficile",
      "bloomLevel": "recall|comprehension|application|analysis",
      "angle": "single sentence describing what this question tests"
    }
  ]
}
</output_format>
</instructions>

<rules>
<rule>Return ONLY valid JSON, no markdown fences or explanations</rule>
<rule>totalQuestions must equal exactly ${config.questionCount}</rule>
<rule>The questions array must have exactly ${config.questionCount} items</rule>
<rule>index values must be sequential from 1 to ${config.questionCount}</rule>
</rules>`;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** LLM response max tokens — each planned question is ~150 tokens + boilerplate.
 *  Sized to comfortably fit 50 questions without truncation. */
const MAX_RESPONSE_TOKENS = 10_000;

/** Request timeout in milliseconds — planner can take 15-25s for 20+ questions
 *  because the blueprint output is long and temperature is high for variance. */
const REQUEST_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Dependency injection for testability
// ---------------------------------------------------------------------------

export interface PlanQuizOptions {
  /** Override the LLM client (for testing) */
  client?: ChatClient;
  /** Override the model ID (for testing) */
  model?: string;
}

// ---------------------------------------------------------------------------
// Main Function
// ---------------------------------------------------------------------------

/**
 * Plan a quiz by creating a structured blueprint of N questions.
 *
 * @param conceptMap - Concept map from courseAnalyzer (step 1)
 * @param config - Quiz configuration (count, types, difficulty, level)
 * @param options - Optional overrides for client/model (used in tests)
 * @returns Parsed and validated QuizBlueprint
 */
export async function planQuiz(
  conceptMap: ConceptMap,
  config: QuizPlanConfig,
  options?: PlanQuizOptions,
): Promise<QuizBlueprint> {
  const startTime = Date.now();
  logger.log(`[QuizPlanner] Planning ${config.questionCount} questions for "${conceptMap.title}"`);

  if (conceptMap.concepts.length === 0) {
    throw new Error("[QuizPlanner] Concept map has no concepts — cannot plan quiz");
  }

  const validatedConfig = QuizPlanConfigSchema.safeParse(config);
  if (!validatedConfig.success) {
    throw new Error(
      `[QuizPlanner] Invalid config: ${validatedConfig.error.issues.map((i) => i.message).join(", ")}`,
    );
  }

  const model = options?.model ?? AIService.getQuizGenerationModel();
  const client = options?.client ?? (AIService.getOpenAICompatibleClient(model) as ChatClient);

  const prompt = buildPlannerPrompt(conceptMap, config);

  logger.log(
    `[QuizPlanner] Sending to ${model} (${conceptMap.concepts.length} concepts, ${config.questionCount} questions)`,
  );

  const response = await client.chat.completions.create(
    {
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.85,
      max_tokens: MAX_RESPONSE_TOKENS,
      response_format: { type: "json_object" },
    },
    { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
  );

  const rawContent = response.choices[0]?.message?.content;
  if (!rawContent) {
    throw new Error("[QuizPlanner] LLM returned empty response");
  }

  // Parse and validate with Zod
  const parsed: unknown = JSON.parse(rawContent);
  const result = QuizBlueprintSchema.safeParse(parsed);

  if (!result.success) {
    logger.error("[QuizPlanner] Schema validation failed:", result.error.issues);
    throw new Error(
      `[QuizPlanner] Invalid blueprint structure: ${result.error.issues.map((i) => i.message).join(", ")}`,
    );
  }

  const blueprint = result.data;

  // Post-validation: reconcile totalQuestions
  if (blueprint.totalQuestions !== blueprint.questions.length) {
    logger.warn(
      `[QuizPlanner] totalQuestions mismatch: declared ${blueprint.totalQuestions}, actual ${blueprint.questions.length}. Correcting.`,
    );
    blueprint.totalQuestions = blueprint.questions.length;
  }

  // Post-validation: verify all targetConcepts exist in the map
  const conceptNames = new Set(conceptMap.concepts.map((c) => c.name));
  for (const q of blueprint.questions) {
    if (!conceptNames.has(q.targetConcept)) {
      logger.warn(
        `[QuizPlanner] Question ${q.index} targets unknown concept "${q.targetConcept}" — not in concept map`,
      );
    }
  }

  const elapsed = Date.now() - startTime;
  logger.log(
    `[QuizPlanner] Blueprint complete in ${elapsed}ms — ${blueprint.questions.length} questions planned`,
  );

  return blueprint;
}
