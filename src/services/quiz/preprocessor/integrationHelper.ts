/**
 * PEN-35: Helper pour intégrer le preprocessor dans le flux de génération de quiz
 *
 * SÉCURITÉ:
 * - Sanitization du contenu avant envoi à l'IA (anti prompt-injection)
 * - Validation des limites utilisateur côté serveur
 * - Isolation des données par workspace/userId
 */

import { quizPreprocessorAgent } from "./QuizPreprocessorAgent.js";
import type { PreprocessorPromptParams, QuizType } from "./prompts.js";
import type { QuizPreprocessorOutput, QuestionType } from "./types.js";
import { prisma } from "../../../lib/prisma.js";

// ============================================================================
// SÉCURITÉ: Constantes de limitation
// ============================================================================
const MAX_SUMMARY_LENGTH = 5000; // Max caractères pour le summary
const MAX_TOPIC_LENGTH = 100; // Max caractères par topic
const MAX_TOPICS_COUNT = 15; // Max nombre de topics

/**
 * SÉCURITÉ: Sanitize le contenu avant envoi dans un prompt XML
 * Prévient les attaques par injection de prompt
 */
function sanitizeForPrompt(
  content: string,
  maxLength: number = MAX_SUMMARY_LENGTH,
): string {
  if (!content || typeof content !== "string") return "";

  return (
    content
      // Échapper les caractères XML dangereux
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      // Échapper les accolades (template literals)
      .replace(/\{/g, "&#123;")
      .replace(/\}/g, "&#125;")
      // Supprimer les caractères de contrôle
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
      // Limiter la longueur
      .slice(0, maxLength)
      .trim()
  );
}

/**
 * SÉCURITÉ: Sanitize un topic (plus court, plus strict)
 */
function sanitizeTopic(topic: string): string {
  if (!topic || typeof topic !== "string") return "";

  return topic
    .replace(/[<>{}[\]]/g, "")
    .replace(/[\x00-\x1F\x7F]/g, "")
    .slice(0, MAX_TOPIC_LENGTH)
    .trim();
}

export interface PreprocessorIntegrationParams {
  userId: string;
  schoolLevel: string;
  higherEdLevel?: string;
  higherEdField?: string;
  quizType?: QuizType;
  pageProjectIds?: string[];
  workspaceIds?: string[];
}

export interface PreprocessorIntegrationResult {
  questionCount: number;
  questionTypes: QuestionType[];
  difficulty: "easy" | "medium" | "hard";
  timeLimit?: number;
  reasoning: string;
  correctedByLimits: boolean;
}

/**
 * Intègre le preprocessor dans le flux de génération
 * Retourne les paramètres optimaux déterminés par l'IA
 */
export async function runPreprocessorForGeneration(
  params: PreprocessorIntegrationParams,
): Promise<PreprocessorIntegrationResult> {
  console.log("[PREPROCESSOR-INTEGRATION] Démarrage analyse:", {
    userId: params.userId,
    schoolLevel: params.schoolLevel,
  });

  // 1. Analyser le contenu des sources
  const sourceAnalysis = await analyzeSourceContent(
    params.userId,
    params.pageProjectIds || [],
    params.workspaceIds || [],
  );

  if (!sourceAnalysis.textContent || sourceAnalysis.wordCount < 50) {
    throw new Error(
      "Contenu insuffisant dans les sources sélectionnées pour l'analyse automatique",
    );
  }

  // 2. Récupérer les limites utilisateur
  const userLimits = await prisma.userLimits.findUnique({
    where: { userId: params.userId },
    select: {
      questionsPerQuizLimit: true,
    },
  });

  const subscriptionLimit = userLimits?.questionsPerQuizLimit || 10;

  // 3. Construire les paramètres du preprocessor avec SANITIZATION
  const preprocessorParams: PreprocessorPromptParams = {
    schoolLevel: sanitizeForPrompt(params.schoolLevel, 100),
    studyLevel: mapSchoolLevelToStudyLevel(params.schoolLevel),
    quizType: params.quizType || "ENTRAINEMENT",
    // SÉCURITÉ: Sanitize le contenu utilisateur avant envoi à l'IA
    sourceSummary: sanitizeForPrompt(
      sourceAnalysis.summary,
      MAX_SUMMARY_LENGTH,
    ),
    sourceTopics: sourceAnalysis.topics
      .slice(0, MAX_TOPICS_COUNT)
      .map(sanitizeTopic)
      .filter(Boolean),
    wordCount: Math.min(sourceAnalysis.wordCount, 100000), // Cap à 100k mots
    hasFormulas: sourceAnalysis.hasFormulas,
    hasDefinitions: sourceAnalysis.hasDefinitions,
    subscriptionLimit,
    userLanguage: "French",
  };

  // 4. Appeler l'agent preprocessor
  const recommendations = await quizPreprocessorAgent.analyzeAndRecommend(
    preprocessorParams,
    params.userId,
  );

  console.log("[PREPROCESSOR-INTEGRATION] Recommandations obtenues:", {
    questionCount: recommendations.recommendedQuestionCount,
    difficulty: recommendations.difficulty,
    typesCount: recommendations.questionTypes.length,
    corrected: recommendations.correctedByLimits,
  });

  // 5. Retourner les paramètres au format attendu par le générateur
  return {
    questionCount: recommendations.recommendedQuestionCount,
    questionTypes: recommendations.questionTypes,
    difficulty: recommendations.difficulty,
    timeLimit: recommendations.suggestedTimeLimit || undefined,
    reasoning: recommendations.reasoning,
    correctedByLimits: recommendations.correctedByLimits || false,
  };
}

/**
 * Analyse le contenu des sources (pages/projets/workspaces)
 */
async function analyzeSourceContent(
  userId: string,
  pageProjectIds: string[],
  workspaceIds: string[],
): Promise<{
  textContent: string;
  wordCount: number;
  summary: string;
  topics: string[];
  hasFormulas: boolean;
  hasDefinitions: boolean;
}> {
  let allText = "";
  const topics: Set<string> = new Set();
  let hasFormulas = false;
  let hasDefinitions = false;

  // Analyser les pages/projets
  if (pageProjectIds.length > 0) {
    const pages = await prisma.page.findMany({
      where: {
        id: { in: pageProjectIds },
        workspace: {
          members: { some: { userId } },
        },
        isArchived: false,
      },
      select: {
        title: true,
        blockNoteContent: true,
      },
    });

    for (const page of pages) {
      allText += `${page.title}\n`;
      topics.add(page.title);

      const extracted = extractBlockNoteContent(page.blockNoteContent);
      allText += extracted.text;
      if (extracted.hasFormulas) hasFormulas = true;
      if (extracted.hasDefinitions) hasDefinitions = true;
    }
  }

  // Analyser les workspaces
  if (workspaceIds.length > 0) {
    const workspaces = await prisma.workspace.findMany({
      where: {
        id: { in: workspaceIds },
        members: { some: { userId } },
      },
      select: {
        name: true,
        pages: {
          where: { isArchived: false },
          select: { title: true, blockNoteContent: true },
          take: 5, // Limiter à 5 pages par workspace
        },
      },
    });

    for (const workspace of workspaces) {
      topics.add(workspace.name);
      for (const page of workspace.pages) {
        allText += `${page.title}\n`;
        topics.add(page.title);

        const extracted = extractBlockNoteContent(page.blockNoteContent);
        allText += extracted.text;
        if (extracted.hasFormulas) hasFormulas = true;
        if (extracted.hasDefinitions) hasDefinitions = true;
      }
    }
  }

  const wordCount = allText.split(/\s+/).filter(Boolean).length;
  const topicsList = Array.from(topics).slice(0, 10); // Max 10 topics

  // Générer un summary (premiers 200 mots)
  const words = allText.split(/\s+/).filter(Boolean);
  const summary = words.slice(0, 200).join(" ");

  return {
    textContent: allText,
    wordCount,
    summary,
    topics: topicsList,
    hasFormulas,
    hasDefinitions,
  };
}

/**
 * Interface for BlockNote inline content item
 */
interface BlockNoteInlineItem {
  text?: string;
  type?: string;
}

/**
 * Interface for BlockNote block structure
 */
interface BlockNoteBlock {
  type?: string;
  content?: BlockNoteInlineItem[];
}

/**
 * Extrait le contenu d'un BlockNote
 */
function extractBlockNoteContent(blockNoteContent: unknown): {
  text: string;
  hasFormulas: boolean;
  hasDefinitions: boolean;
} {
  let text = "";
  let hasFormulas = false;
  let hasDefinitions = false;

  try {
    const content: unknown =
      typeof blockNoteContent === "string"
        ? JSON.parse(blockNoteContent)
        : blockNoteContent;

    if (content && Array.isArray(content)) {
      for (const block of content as BlockNoteBlock[]) {
        // Texte de paragraphes
        if (block?.type === "paragraph" && block?.content) {
          const blockText = Array.isArray(block.content)
            ? block.content
                .map((item: BlockNoteInlineItem) => item?.text || "")
                .join("")
            : "";
          text += blockText + "\n";
        }

        // Formules LaTeX
        if (block?.type === "latex" || block?.type === "latexBlock") {
          hasFormulas = true;
        }

        // Définitions (headings suggèrent du contenu structuré)
        if (block?.type === "heading") {
          hasDefinitions = true;
        }
      }
    }
  } catch (error) {
    console.warn("[PREPROCESSOR] Erreur parsing BlockNote:", error);
  }

  return { text, hasFormulas, hasDefinitions };
}

/**
 * Mapper les niveaux scolaires Prisma vers les catégories d'étude
 */
function mapSchoolLevelToStudyLevel(schoolLevel: string): string {
  if (schoolLevel === "COLLEGE") return "College";
  if (schoolLevel.startsWith("LYCEE_")) return "Lycée";
  if (schoolLevel === "ETUDES_SUPERIEURES") return "Université";
  return "College"; // Default
}
