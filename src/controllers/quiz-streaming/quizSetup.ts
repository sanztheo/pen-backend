import { prisma } from "../../lib/prisma.js";
import { logger } from "../../utils/logger.js";
import { generateQuizTitle } from "../../services/quiz/utils/titleGenerator.js";
import { SchoolLevel, QuizPreset, CollegeGrade } from "../../services/quiz/types.js";
import {
  prepareIntelligentContext as prepareContext,
  createClustersDetectedEvent,
  ContextCacheService,
  type IntelligentContextResult,
  type ClusterQuestionDistribution,
} from "../../services/quiz/intelligence/index.js";
import type { SSESender } from "./types.js";

// ============================================================================
// 1. Title generation
// ============================================================================

export async function generateOrUseTitle(params: {
  userId: string;
  title?: string;
  schoolLevel: string;
  pageProjectIds?: string[];
  subject?: string;
  specificSubject?: string;
  questionCount: number;
  difficulty?: string;
}): Promise<string> {
  if (params.title) {
    return params.title;
  }

  let pageNames: string[] = [];
  if (params.pageProjectIds && params.pageProjectIds.length > 0) {
    const pages = await prisma.page.findMany({
      where: {
        id: { in: params.pageProjectIds },
        workspace: { members: { some: { userId: params.userId } } },
        isArchived: false,
      },
      select: { title: true },
      take: 30,
    });
    pageNames = pages.map((p) => p.title).filter(Boolean);
  }

  const generatedTitle = await generateQuizTitle({
    schoolLevel: params.schoolLevel || SchoolLevel.COLLEGE,
    pageNames,
    subject: params.subject || params.specificSubject,
    questionCount: params.questionCount,
    difficulty: params.difficulty,
  });

  logger.log(`[TITLE-GEN] Titre généré: "${generatedTitle}"`);
  return generatedTitle;
}

// ============================================================================
// 2. Quiz DB creation
// ============================================================================

export async function createQuizInDb(params: {
  userId: string;
  title: string;
  schoolLevel: string;
  preset?: string;
  collegeGrade?: string;
  higherEdField?: string;
  subject?: string;
}): Promise<{ id: string }> {
  const quiz = await prisma.quiz.create({
    data: {
      userId: params.userId,
      title: params.title,
      schoolLevel: (params.schoolLevel as SchoolLevel) || SchoolLevel.COLLEGE,
      questions: [],
      isCompleted: false,
      status: "generating",
      preset: (params.preset as QuizPreset) || QuizPreset.NONE,
      collegeGrade: (params.collegeGrade as CollegeGrade) || null,
      higherEdField: params.higherEdField,
      subject: params.subject || undefined,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  return quiz;
}

// ============================================================================
// 3. Intelligent context preparation
// ============================================================================

export async function prepareIntelligentContextIfNeeded(params: {
  useIntelligentGeneration: boolean;
  pageProjectIds: string[];
  questionCount: number;
  ragContext?: string;
  sendSSE: SSESender;
}): Promise<{
  intelligentContext: IntelligentContextResult | null;
  questionDistribution: ClusterQuestionDistribution[];
}> {
  if (!params.useIntelligentGeneration || params.pageProjectIds.length < 2) {
    return { intelligentContext: null, questionDistribution: [] };
  }

  logger.log(`[INTELLIGENT] Mode intelligent activé pour ${params.pageProjectIds.length} pages`);

  params.sendSSE("intelligent-preparing", {
    message: "Analyse thématique des pages en cours...",
    pageCount: params.pageProjectIds.length,
  });

  const intelligentConfig = {
    enabled: true,
    maxTokens: 8000,
    balanceContentTypes: true,
    generateClusterNames: true,
  };

  const cacheResult = await ContextCacheService.getOrPrepareContext(
    params.pageProjectIds,
    params.questionCount,
    intelligentConfig,
    async () => prepareContext(params.pageProjectIds, params.questionCount, intelligentConfig),
    params.ragContext,
  );

  const intelligentContext = cacheResult.context;
  const questionDistribution: ClusterQuestionDistribution[] = [];

  if (intelligentContext) {
    questionDistribution.push(...intelligentContext.questionDistribution);

    params.sendSSE("clusters-detected", createClustersDetectedEvent(intelligentContext));

    logger.log(
      `[INTELLIGENT] ${intelligentContext.clusters.length} clusters détectés, contexte ${cacheResult.fromCache ? "depuis CACHE" : "fraîchement préparé"}`,
    );

    if (cacheResult.fromCache) {
      params.sendSSE("context-cached", {
        message: "Contexte récupéré depuis le cache",
        cached: true,
      });
    }
  } else {
    logger.log(`[INTELLIGENT] Fallback au mode normal (pas assez de contenu)`);
  }

  return { intelligentContext, questionDistribution };
}
