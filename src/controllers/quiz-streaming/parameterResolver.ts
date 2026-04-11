import { prisma } from "../../lib/prisma.js";
import { logger } from "../../utils/logger.js";
import {
  getUserPersonalization,
  mapToSchoolLevelEnum,
} from "../../services/quiz/utils/personalizationUtils.js";
import { quizPreprocessorAgent } from "../../services/quiz/preprocessor/QuizPreprocessorAgent.js";
import { PaddleBillingService } from "../../services/billing/paddleBilling.js";
import { analyzeSourceContent } from "./sourceAnalyzer.js";
import { mapSchoolLevelToStudyLevel } from "./utils.js";
import type { SSESender } from "./types.js";
import type { PreprocessorPromptParams } from "../../services/quiz/preprocessor/prompts.js";

export interface ResolvedParameters {
  schoolLevel: string;
  questionCount: number;
  difficulty?: string;
  preprocessorTypeDistribution: string[] | null;
  useIntelligentGeneration: boolean;
}

/**
 * Resolves personalization — fetches user profile from DB if usePersonalization is true.
 * Falls back to bodySchoolLevel or COLLEGE when no personalization data exists.
 */
export async function resolvePersonalization(
  userId: string,
  bodySchoolLevel: string | undefined,
  usePersonalization: boolean,
): Promise<string> {
  if (usePersonalization || !bodySchoolLevel) {
    const personalizationData = await getUserPersonalization(userId);
    if (personalizationData) {
      const rawSchoolLevel = personalizationData.classe || bodySchoolLevel || "COLLEGE";
      return mapToSchoolLevelEnum(rawSchoolLevel);
    }
    return mapToSchoolLevelEnum(bodySchoolLevel || "COLLEGE");
  }
  return mapToSchoolLevelEnum(bodySchoolLevel || "COLLEGE");
}

/**
 * Calls the preprocessor agent if letAIChoose is true and pages are available.
 * Returns updated questionCount, difficulty, and typeDistribution when the preprocessor
 * has enough content to analyze (>= 50 words). Falls back to original values on error.
 */
export async function callPreprocessorIfNeeded(params: {
  letAIChoose: boolean;
  pageProjectIds: string[];
  userId: string;
  schoolLevel: string;
  questionCount: number;
  difficulty?: string;
  sendSSE: SSESender;
}): Promise<{
  questionCount: number;
  difficulty?: string;
  typeDistribution: string[] | null;
}> {
  const { letAIChoose, pageProjectIds, userId, schoolLevel, questionCount, difficulty, sendSSE } =
    params;

  if (!letAIChoose || pageProjectIds.length === 0) {
    return { questionCount, difficulty, typeDistribution: null };
  }

  try {
    sendSSE("status", { message: "ai-analyzing" });

    const sourceAnalysis = await analyzeSourceContent(userId, pageProjectIds);

    if (sourceAnalysis.wordCount < 50) {
      logger.warn(
        `[PARAM-RESOLVER] Content too short for preprocessor (${sourceAnalysis.wordCount} words), skipping`,
      );
      return { questionCount, difficulty, typeDistribution: null };
    }

    // Fetch user's questionsPerQuizLimit from DB
    const userLimits = await prisma.userLimits.findUnique({
      where: { userId },
      select: { questionsPerQuizLimit: true },
    });
    const subscriptionLimit = userLimits?.questionsPerQuizLimit ?? 50;

    const preprocessorParams: PreprocessorPromptParams = {
      schoolLevel,
      studyLevel: mapSchoolLevelToStudyLevel(schoolLevel),
      quizType: "ENTRAINEMENT",
      sourceSummary: sourceAnalysis.summary,
      sourceTopics: sourceAnalysis.topics,
      wordCount: sourceAnalysis.wordCount,
      hasFormulas: sourceAnalysis.hasFormulas,
      hasDefinitions: sourceAnalysis.hasDefinitions,
      subscriptionLimit,
    };

    const recommendations = await quizPreprocessorAgent.analyzeAndRecommend(
      preprocessorParams,
      userId,
    );

    sendSSE("status", { message: "ai-recommendations" });

    return {
      questionCount: recommendations.recommendedQuestionCount,
      difficulty: recommendations.difficulty,
      typeDistribution: recommendations.questionTypes,
    };
  } catch (error) {
    logger.error("[PARAM-RESOLVER] Preprocessor failed, using original values:", error);
    sendSSE("status", { message: "ai-fallback" });
    return { questionCount, difficulty, typeDistribution: null };
  }
}

/**
 * Checks if a premium user should get auto-intelligent mode.
 * Premium users with 2+ pages automatically get intelligent generation
 * even if they didn't explicitly request it.
 */
export async function checkPremiumIntelligent(
  userId: string,
  requestUseIntelligent: boolean,
  pageCount: number,
): Promise<boolean> {
  try {
    if (!requestUseIntelligent && pageCount >= 2) {
      const subscription = await PaddleBillingService.getUserSubscription(userId);
      if (subscription.isPremium) {
        return true;
      }
    }
    return requestUseIntelligent;
  } catch (error) {
    logger.warn("[PARAM-RESOLVER] Failed to check premium status:", error);
    return requestUseIntelligent;
  }
}
