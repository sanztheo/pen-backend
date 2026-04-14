/**
 * Batch Question Generator — Generates N questions in a single LLM call.
 * Step [3] of the quiz pipeline: Analyze → Plan → Generate → Validate.
 *
 * Takes a slice of the quiz blueprint and generates all questions at once,
 * guided by each PlannedQuestion's concept, type, difficulty, and angle.
 */

import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import { AIService } from "../../services/ai/base.js";
import { isReasoningModel, isFixedTempModel } from "../../config/models.js";
import { logger } from "../../utils/logger.js";
import { QUIZ_QUESTION_SCHEMA } from "../../services/quiz/assistant/config/index.js";
import { buildSystemPrompt } from "../../services/quiz/assistant/generation/prompts/systemPrompt.js";
import { buildBatchQuestionPrompt } from "../../services/quiz/assistant/generation/prompts/questionPrompt.js";
import type { Question } from "../../services/quiz/types.js";
import type { PlannedQuestion } from "../../services/quiz/intelligence/quizPlanner.js";

/** Extended API config for reasoning models */
interface ExtendedChatConfig extends ChatCompletionCreateParamsNonStreaming {
  reasoning_effort?: "low" | "medium" | "high";
  max_completion_tokens?: number;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BatchGenerationRequest {
  courseText: string;
  plannedQuestions: PlannedQuestion[];
  previousQuestions: Question[];
  schoolLevel: string;
  difficulty?: string;
  specificSubject?: string;
  coursesOnly?: boolean;
}

export interface BatchGenerationResult {
  questions: Question[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Base token budget per question, scaled by batch size */
const TOKENS_PER_QUESTION = 1500;

/** Absolute max tokens for any batch call */
const MAX_BATCH_TOKENS = 16_000;

/** LLM request timeout */
const GENERATION_TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------------------
// Main Function
// ---------------------------------------------------------------------------

/**
 * Generate a batch of questions in a single LLM call.
 * The system prompt tells the LLM to produce exactly N questions,
 * and the user prompt provides the blueprint specifications.
 *
 * @returns Array of generated questions (may be fewer than requested on partial failure)
 */
export async function generateBatch(request: BatchGenerationRequest): Promise<Question[]> {
  const batchSize = request.plannedQuestions.length;
  const startTime = Date.now();

  logger.log(`[BatchGenerator] Generating batch of ${batchSize} questions`);

  const systemPrompt = buildSystemPrompt(undefined, batchSize);
  const userPrompt = buildBatchQuestionPrompt({
    courseText: request.courseText,
    plannedQuestions: request.plannedQuestions,
    previousQuestions: request.previousQuestions,
    schoolLevel: request.schoolLevel,
    difficulty: request.difficulty,
    specificSubject: request.specificSubject,
    coursesOnly: request.coursesOnly,
  });

  const generationModel = AIService.getQuizGenerationModel();
  const client = AIService.getOpenAICompatibleClient(generationModel);

  const maxOutputTokens = Math.min(batchSize * TOKENS_PER_QUESTION, MAX_BATCH_TOKENS);

  // Build API config — same pattern as QuestionGenerator
  const apiConfig: ExtendedChatConfig = {
    model: generationModel,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
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

  if (isReasoningModel(generationModel)) {
    apiConfig.reasoning_effort = "low";
    apiConfig.max_completion_tokens = maxOutputTokens;
  } else if (isFixedTempModel(generationModel)) {
    apiConfig.temperature = 1;
    apiConfig.max_tokens = maxOutputTokens;
  } else {
    apiConfig.temperature = 0.7;
    apiConfig.max_tokens = maxOutputTokens;
  }

  logger.log(
    `[BatchGenerator] Calling ${generationModel} (maxTokens=${maxOutputTokens}, batchSize=${batchSize})`,
  );

  const completion = await client.chat.completions.create(apiConfig, {
    signal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
  });

  const responseContent = completion.choices[0]?.message?.content;
  if (!responseContent) {
    throw new Error("[BatchGenerator] LLM returned empty response");
  }

  const parsed: unknown = JSON.parse(responseContent);
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as Record<string, unknown>).questions)
  ) {
    throw new Error("[BatchGenerator] Invalid response structure — missing questions array");
  }

  const questions = (parsed as { questions: Question[] }).questions;
  const elapsed = Date.now() - startTime;

  logger.log(
    `[BatchGenerator] Batch complete in ${elapsed}ms — ${questions.length}/${batchSize} questions generated`,
  );

  return questions;
}
