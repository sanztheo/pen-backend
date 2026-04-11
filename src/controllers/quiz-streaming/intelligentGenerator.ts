import { logger } from "../../utils/logger.js";
import type { Question, LyceeSpecialty } from "../../services/quiz/types.js";
import { QuestionScorerService } from "../../services/quiz/intelligence/index.js";
import type { ClusterQuestionDistribution } from "../../services/quiz/intelligence/index.js";
import { getSpecialtyLabel } from "./utils.js";
import type { SSESender } from "./types.js";

// ============================================================================
// Types
// ============================================================================

export interface IntelligentGeneratorParams {
  questionCount: number;
  questionDistribution: ClusterQuestionDistribution[];
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

// ============================================================================
// Main function
// ============================================================================

/**
 * Generates questions organised by thematic clusters.
 *
 * Each cluster supplies its own RAG context and theme hint so that
 * the LLM produces questions that are thematically coherent within
 * each cluster.
 */
export async function generateQuestionsIntelligent(
  params: IntelligentGeneratorParams,
): Promise<Question[]> {
  const {
    questionDistribution,
    typeDistribution,
    specialtyDistribution,
    baseRequest,
    quizId,
    sendSSE,
    assistantService,
    prisma,
    scorerOptions,
    isDisconnected,
  } = params;

  const generatedQuestions: Question[] = [];
  let globalQuestionIndex = 0;
  let typeDistributionIndex = 0;

  for (let clusterIdx = 0; clusterIdx < questionDistribution.length; clusterIdx++) {
    if (isDisconnected?.()) {
      logger.info(
        `[INTELLIGENT-GEN] Client disconnected, stopping at cluster ${clusterIdx + 1}/${questionDistribution.length}`,
      );
      break;
    }

    const clusterDist = questionDistribution[clusterIdx];

    // --- cluster-start SSE ---
    sendSSE("cluster-start", {
      clusterName: clusterDist.clusterName,
      clusterIndex: clusterIdx,
      totalClusters: questionDistribution.length,
      questionCount: clusterDist.questionCount,
      keywords: clusterDist.keywords,
    });

    let clusterQuestionsGenerated = 0;

    for (let q = 0; q < clusterDist.questionCount; q++) {
      if (isDisconnected?.()) {
        logger.info(
          `[INTELLIGENT-GEN] Client disconnected during cluster ${clusterDist.clusterName}, stopping at question ${q + 1}/${clusterDist.questionCount}`,
        );
        break;
      }

      globalQuestionIndex++;

      const specificQuestionType =
        typeDistribution[typeDistributionIndex % typeDistribution.length];
      typeDistributionIndex++;

      // --- question-generating SSE ---
      sendSSE("question-generating", {
        questionNumber: globalQuestionIndex,
        totalQuestions: params.questionCount,
        message: `Generation question ${globalQuestionIndex}/${params.questionCount} (${clusterDist.clusterName})`,
      });

      try {
        const singleQuestionRequest: Record<string, unknown> = {
          ...baseRequest,
          questionTypes: [specificQuestionType],
          questionCount: 1,
          existingQuestions: generatedQuestions,
          themeHint: `Theme: ${clusterDist.clusterName}. Mots-cles: ${clusterDist.keywords.join(", ")}`,
          ragContext: clusterDist.content,
        };

        // Apply specialty if available for this global index
        const specialtyIdx = globalQuestionIndex - 1;
        if (specialtyDistribution.length > 0 && specialtyIdx < specialtyDistribution.length) {
          const specialty = specialtyDistribution[specialtyIdx];
          singleQuestionRequest.lyceeSpecialty = specialty;
          singleQuestionRequest.specialtyLabel = getSpecialtyLabel(specialty);
        }

        const result = await assistantService.generateSingleQuestion(singleQuestionRequest);
        const newQuestion: Question | undefined = result.questions?.[0];

        if (!newQuestion) {
          logger.warn(
            `[INTELLIGENT-GEN] No question returned for cluster ${clusterDist.clusterName} index ${globalQuestionIndex}`,
          );
          continue;
        }

        // --- Quality scoring ---
        const qualityCheck = QuestionScorerService.isAcceptable(
          newQuestion,
          generatedQuestions,
          scorerOptions,
        );

        if (!qualityCheck.acceptable && !qualityCheck.duplicate.isDuplicate) {
          // Accept anyway with warning — low quality but not a duplicate
          logger.warn(
            `[INTELLIGENT-GEN] Question ${globalQuestionIndex} below quality threshold (${qualityCheck.score.overall}) but accepted (not duplicate)`,
          );
        }

        // Attach cluster metadata
        newQuestion.metadata = {
          ...newQuestion.metadata,
          cluster: clusterDist.clusterName,
          clusterId: clusterDist.clusterId,
          qualityScore: qualityCheck.score.overall,
        };

        if (qualityCheck.duplicate.isDuplicate) {
          logger.warn(
            `[INTELLIGENT-GEN] Duplicate question skipped for cluster ${clusterDist.clusterName}`,
          );
          continue;
        }

        // Push to generated list
        generatedQuestions.push(newQuestion);
        clusterQuestionsGenerated++;

        // Persist to DB
        await prisma.quiz.update({
          where: { id: quizId },
          data: {
            questions: generatedQuestions as unknown as Record<string, unknown>[],
          },
        });

        // --- question-generated SSE ---
        sendSSE("question-generated", {
          questionNumber: globalQuestionIndex,
          totalQuestions: params.questionCount,
          question: newQuestion,
        });
      } catch (error) {
        logger.error(
          `[INTELLIGENT-GEN] Error generating question ${globalQuestionIndex} in cluster ${clusterDist.clusterName}:`,
          error,
        );
        sendSSE("question-error", {
          questionNumber: globalQuestionIndex,
          totalQuestions: params.questionCount,
          error: `Error generating question ${globalQuestionIndex}`,
        });
      }
    }

    // --- cluster-complete SSE ---
    sendSSE("cluster-complete", {
      clusterName: clusterDist.clusterName,
      clusterIndex: clusterIdx,
      questionsGenerated: clusterQuestionsGenerated,
    });
  }

  return generatedQuestions;
}
