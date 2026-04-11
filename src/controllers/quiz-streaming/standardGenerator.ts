import { Prisma } from "@prisma/client";
import { logger } from "../../utils/logger.js";
import type { Question, LyceeSpecialty } from "../../services/quiz/types.js";
import { QuestionScorerService } from "../../services/quiz/intelligence/index.js";
import { getSpecialtyLabel } from "./utils.js";
import type { SSESender } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StandardGeneratorParams {
  questionCount: number;
  typeDistribution: string[];
  specialtyDistribution: LyceeSpecialty[];
  baseRequest: Record<string, unknown>;
  quizId: string;
  sendSSE: SSESender;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assistantService: { generateSingleQuestion: (req: Record<string, unknown>) => Promise<any> };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: { quiz: { update: (args: any) => Promise<any> } };
  scorerOptions?: { minScore: number; duplicateThreshold: number };
  isDisconnected?: () => boolean;
}

const DEFAULT_SCORER_OPTIONS = { minScore: 0.4, duplicateThreshold: 0.8 };

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

export async function generateQuestionsStandard(
  params: StandardGeneratorParams,
): Promise<Question[]> {
  const {
    questionCount,
    typeDistribution,
    specialtyDistribution,
    baseRequest,
    quizId,
    sendSSE,
    assistantService,
    prisma,
    scorerOptions = DEFAULT_SCORER_OPTIONS,
    isDisconnected,
  } = params;

  const generatedQuestions: Question[] = [];

  for (let i = 0; i < questionCount; i++) {
    if (isDisconnected?.()) {
      logger.info(
        `[StandardGenerator] Client disconnected, stopping at question ${i + 1}/${questionCount}`,
      );
      break;
    }

    try {
      // 1. Send SSE "question-generating"
      sendSSE("question-generating", {
        questionNumber: i + 1,
        totalQuestions: questionCount,
        message: `Generating question ${i + 1}/${questionCount} (${typeDistribution[i]})`,
      });

      // 2. Build single-question request
      const singleQuestionRequest: Record<string, unknown> = {
        ...baseRequest,
        questionTypes: [typeDistribution[i]],
        existingQuestions: generatedQuestions,
      };

      // 3. Add specialty fields if available
      const specialty = specialtyDistribution[i];
      if (specialty) {
        singleQuestionRequest.lyceeSpecialty = specialty;
        singleQuestionRequest.specialtyLabel = getSpecialtyLabel(specialty);
      }

      // 4. Generate the question (timed)
      const genStart = Date.now();
      const result = await assistantService.generateSingleQuestion(singleQuestionRequest);
      const newQuestion: Question | undefined = result?.questions?.[0];
      const genDuration = Date.now() - genStart;

      if (!newQuestion) {
        logger.info(`[StandardGenerator] Question ${i + 1} returned null (${genDuration}ms)`);
        continue;
      }

      // 5a. Score & deduplicate
      const { acceptable, score, duplicate } = QuestionScorerService.isAcceptable(
        newQuestion,
        generatedQuestions,
        scorerOptions,
      );

      // 5b. Skip duplicates
      if (!acceptable && duplicate.isDuplicate) {
        logger.info(
          `[StandardGenerator] Question ${i + 1} skipped — duplicate (similarity: ${duplicate.similarity})`,
        );
        sendSSE("question-skipped", {
          questionNumber: i + 1,
          totalQuestions: questionCount,
          message: `Question ${i + 1} skipped (duplicate)`,
        });
        continue;
      }

      // 5c. Set specialty label on subject if missing
      if (!newQuestion.subject && specialty) {
        (newQuestion as unknown as Record<string, unknown>).subject = getSpecialtyLabel(specialty);
      }

      // 5d. Set metadata with quality score + specialty info
      (newQuestion as unknown as Record<string, unknown>).metadata = {
        ...((newQuestion.metadata as Record<string, unknown>) ?? {}),
        qualityScore: score.overall,
        ...(specialty ? { specialty, specialtyLabel: getSpecialtyLabel(specialty) } : {}),
      };

      // 5e. Push to generated list
      generatedQuestions.push(newQuestion);

      // 5f. Save to DB (timed)
      const dbStart = Date.now();
      await prisma.quiz.update({
        where: { id: quizId },
        data: {
          questions: generatedQuestions as unknown as Prisma.InputJsonValue,
        },
      });
      const dbDuration = Date.now() - dbStart;

      logger.info(
        `[StandardGenerator] Question ${i + 1} saved (gen: ${genDuration}ms, db: ${dbDuration}ms)`,
      );

      // 5g. Send "question-generated" SSE
      sendSSE("question-generated", {
        questionNumber: i + 1,
        totalQuestions: questionCount,
        question: newQuestion,
        canStartAnswering: generatedQuestions.length === 1,
        message: `Question ${i + 1}/${questionCount} generated`,
      });
    } catch (error) {
      // 6. On error: log, send SSE, continue
      logger.info(
        `[StandardGenerator] Error generating question ${i + 1}: ${error instanceof Error ? error.message : String(error)}`,
      );
      sendSSE("question-error", {
        questionNumber: i + 1,
        totalQuestions: questionCount,
        error: `Failed to generate question ${i + 1}`,
      });
    }
  }

  return generatedQuestions;
}
