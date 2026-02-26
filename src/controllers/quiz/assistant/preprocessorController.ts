import { Request, Response } from "express";
import { quizPreprocessorAgent } from "../../../services/quiz/preprocessor/QuizPreprocessorAgent.js";
import type { PreprocessorPromptParams } from "../../../services/quiz/preprocessor/prompts.js";
import { prisma } from "../../../lib/prisma.js";
import { getUserPersonalization } from "../../../services/quiz/utils/personalizationUtils.js";
import { logger } from "../../../utils/logger.js";

/**
 * Controller pour le preprocessor de quiz
 * PEN-35: Analyse les sources et recommande les paramètres optimaux
 */
export class PreprocessorController {
  /**
   * POST /api/quiz/preprocess - Analyse et recommande les paramètres de quiz
   *
   * Body:
   * {
   *   schoolLevel?: string (e.g., "COLLEGE", "LYCEE_TERMINALE")
   *   usePersonalization?: boolean (si true, utilise les settings utilisateur)
   *   higherEdLevel?: string
   *   higherEdField?: string
   *   quizType?: "ENTRAINEMENT" | "REVISION" | "EXAMEN"
   *   pageProjectIds: string[]
   *   workspaceIds?: string[]
   * }
   */
  static async preprocessQuiz(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: "Utilisateur non authentifié" });
        return;
      }

      const {
        schoolLevel: bodySchoolLevel,
        usePersonalization = false,
        higherEdLevel,
        higherEdField,
        quizType = "ENTRAINEMENT",
        pageProjectIds = [],
        workspaceIds = [],
      } = req.body;

      // 📊 LOG 1: Paramètres reçus du frontend
      logger.log("[PREPROCESSOR] 📥 Requête reçue:", {
        userId,
        usePersonalization,
        bodySchoolLevel,
        higherEdLevel,
        higherEdField,
        quizType,
        pageProjectIds: pageProjectIds.length,
        workspaceIds: workspaceIds.length,
      });

      // 🎯 Récupérer la personnalisation si demandé ou si pas de schoolLevel fourni
      let schoolLevel = bodySchoolLevel;
      let personalizationData = null;

      if (usePersonalization || !bodySchoolLevel) {
        personalizationData = await getUserPersonalization(userId);

        if (personalizationData) {
          // Utiliser les données de personnalisation
          schoolLevel = personalizationData.classe || bodySchoolLevel || "COLLEGE";

          logger.log("[PREPROCESSOR] 👤 Personnalisation récupérée depuis DB:", {
            classe: personalizationData.classe,
            etude: personalizationData.etude,
            filiere: personalizationData.filiere,
            presentation: personalizationData.presentation?.slice(0, 50),
            attente: personalizationData.attente?.slice(0, 50),
            resolvedSchoolLevel: schoolLevel,
          });
        } else {
          logger.log("[PREPROCESSOR] ⚠️ Aucune personnalisation trouvée pour l'utilisateur");
        }
      }

      // Validation
      if (!schoolLevel) {
        res.status(400).json({
          error: "schoolLevel requis (ou personnalisation utilisateur)",
        });
        return;
      }

      if (!pageProjectIds.length && !workspaceIds.length) {
        res.status(400).json({
          error: "Au moins une page/projet ou un workspace requis",
        });
        return;
      }

      // 1. Analyser le contenu des sources pour extraction de contexte
      const sourceAnalysis = await PreprocessorController.analyzeSourceContent(
        userId,
        pageProjectIds,
        workspaceIds,
      );

      if (!sourceAnalysis.textContent || sourceAnalysis.wordCount < 50) {
        res.status(400).json({
          error: "Contenu insuffisant dans les sources sélectionnées",
        });
        return;
      }

      // 📊 LOG 2: Analyse des sources
      logger.log("[PREPROCESSOR] 📄 Analyse des sources:", {
        wordCount: sourceAnalysis.wordCount,
        topicsCount: sourceAnalysis.topics.length,
        topics: sourceAnalysis.topics,
        hasFormulas: sourceAnalysis.hasFormulas,
        hasDefinitions: sourceAnalysis.hasDefinitions,
        summaryPreview: sourceAnalysis.summary.slice(0, 100) + "...",
      });

      // 2. Récupérer les limites utilisateur
      const userLimits = await prisma.userLimits.findUnique({
        where: { userId },
        select: {
          questionsPerQuizLimit: true,
        },
      });

      const subscriptionLimit = userLimits?.questionsPerQuizLimit || 10;

      // 3. Mapper les paramètres frontend → preprocessor
      const preprocessorParams: PreprocessorPromptParams = {
        schoolLevel: schoolLevel,
        studyLevel: PreprocessorController.mapSchoolLevelToStudyLevel(schoolLevel),
        quizType: quizType,
        sourceSummary: sourceAnalysis.summary,
        sourceTopics: sourceAnalysis.topics,
        wordCount: sourceAnalysis.wordCount,
        hasFormulas: sourceAnalysis.hasFormulas,
        hasDefinitions: sourceAnalysis.hasDefinitions,
        subscriptionLimit,
        userLanguage: "French",
      };

      // 📊 LOG 3: Paramètres envoyés à l'IA
      logger.log("[PREPROCESSOR] 🤖 Paramètres envoyés à l'IA:", {
        schoolLevel: preprocessorParams.schoolLevel,
        studyLevel: preprocessorParams.studyLevel,
        quizType: preprocessorParams.quizType,
        wordCount: preprocessorParams.wordCount,
        hasFormulas: preprocessorParams.hasFormulas,
        hasDefinitions: preprocessorParams.hasDefinitions,
        subscriptionLimit: preprocessorParams.subscriptionLimit,
        topicsCount: preprocessorParams.sourceTopics.length,
      });

      // 4. Appeler l'agent preprocessor
      const recommendations = await quizPreprocessorAgent.analyzeAndRecommend(
        preprocessorParams,
        userId,
      );

      // 📊 LOG 4: Décision de l'IA - DÉTAILLÉE
      // Compter les types de questions
      const questionTypeCounts = recommendations.questionTypes.reduce(
        (acc, type) => {
          acc[type] = (acc[type] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );

      logger.log("[PREPROCESSOR] ✅ Décision de l'IA:", {
        recommendedQuestionCount: recommendations.recommendedQuestionCount,
        difficulty: recommendations.difficulty,
        suggestedTimeLimit: recommendations.suggestedTimeLimit,
        questionTypes: questionTypeCounts,
        reasoning: recommendations.reasoning,
        correctedByLimits: recommendations.correctedByLimits,
      });

      // 5. Retourner les recommandations
      res.status(200).json({
        success: true,
        data: {
          recommendations,
          sourceAnalysis: {
            wordCount: sourceAnalysis.wordCount,
            topics: sourceAnalysis.topics,
            hasFormulas: sourceAnalysis.hasFormulas,
            hasDefinitions: sourceAnalysis.hasDefinitions,
          },
        },
      });
    } catch (error) {
      logger.error("[PREPROCESSOR] Erreur:", error);
      res.status(500).json({
        error: "Erreur lors de l'analyse des sources",
        details: error instanceof Error ? error.message : "Erreur inconnue",
      });
    }
  }

  /**
   * Analyse le contenu des sources pour extraction de métadonnées
   */
  private static async analyzeSourceContent(
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

        // Extraire le contenu BlockNote
        try {
          const content =
            typeof page.blockNoteContent === "string"
              ? JSON.parse(page.blockNoteContent)
              : page.blockNoteContent;

          if (content && Array.isArray(content)) {
            for (const block of content) {
              // Texte
              if (block?.type === "paragraph" && block?.content) {
                const text = Array.isArray(block.content)
                  ? block.content
                      .map((item: unknown) => {
                        if (typeof item === "object" && item !== null && "text" in item) {
                          return String((item as { text: unknown }).text ?? "");
                        }
                        return "";
                      })
                      .join("")
                  : "";
                allText += text + "\n";
              }

              // Formules (LaTeX)
              if (block?.type === "latex" || block?.type === "latexBlock") {
                hasFormulas = true;
              }

              // Définitions (headings + bold text patterns)
              if (block?.type === "heading") {
                hasDefinitions = true;
              }
            }
          }
        } catch (error) {
          logger.warn("[PREPROCESSOR] Erreur parsing BlockNote:", error);
        }
      }
    }

    // Analyser les workspaces (similar logic)
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

          // Same extraction logic as above
          try {
            const content =
              typeof page.blockNoteContent === "string"
                ? JSON.parse(page.blockNoteContent)
                : page.blockNoteContent;

            if (content && Array.isArray(content)) {
              for (const block of content) {
                if (block?.type === "paragraph" && block?.content) {
                  const text = Array.isArray(block.content)
                    ? block.content
                        .map((item: unknown) => {
                          if (typeof item === "object" && item !== null && "text" in item) {
                            return String((item as { text: unknown }).text ?? "");
                          }
                          return "";
                        })
                        .join("")
                    : "";
                  allText += text + "\n";
                }
                if (block?.type === "latex" || block?.type === "latexBlock") {
                  hasFormulas = true;
                }
                if (block?.type === "heading") {
                  hasDefinitions = true;
                }
              }
            }
          } catch (error) {
            logger.warn("[PREPROCESSOR] Erreur parsing BlockNote:", error);
          }
        }
      }
    }

    const wordCount = allText.split(/\s+/).filter(Boolean).length;
    const topicsList = Array.from(topics).slice(0, 10); // Max 10 topics

    // Générer un summary simple (premiers 200 mots)
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
   * Mapper les niveaux scolaires Prisma vers les catégories d'étude
   */
  private static mapSchoolLevelToStudyLevel(schoolLevel: string): string {
    // Mapping based on SchoolLevel enum
    if (schoolLevel === "COLLEGE") return "College";
    if (schoolLevel.startsWith("LYCEE_")) return "Lycée";
    if (schoolLevel === "ETUDES_SUPERIEURES") return "Université";
    return "College"; // Default
  }
}
