import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma.js";
import { prismaEmbeddings } from "../../../lib/prismaEmbeddings.js";

/**
 * Types pour le parsing de blockNoteContent
 */
interface BlockNoteContentItem {
  text?: string;
  type?: string;
}

interface BlockNoteBlock {
  type?: string;
  content?: BlockNoteContentItem[] | unknown;
}

/**
 * Type pour les résultats de questions
 */
interface QuestionResult {
  questionId: string;
  isCorrect: boolean;
  userAnswer?: string;
  correctAnswer?: string;
  score?: number;
  maxScore?: number;
}

/**
 * Type pour les sources RAG dans la réponse
 */
interface RAGSourceResponse {
  title: string;
  type: string | undefined;
  similarity: number;
}

/**
 * Contrôleur pour la gestion du contexte RAG et des corrections rapides
 */
export class RAGController {
  /**
   * POST /api/quiz/context-rag - Construit le contexte RAG pour la génération de quiz
   */
  static async buildQuizRAGContext(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const { pageProjectIds, scopeMode } = req.body;

      if (!userId) {
        res.status(401).json({ error: "Utilisateur non authentifié" });
        return;
      }

      if (!pageProjectIds || !Array.isArray(pageProjectIds)) {
        res
          .status(400)
          .json({ error: "Liste des IDs de pages/projets requise" });
        return;
      }

      console.log(
        `🧠 [QUIZ-RAG] Construction contexte pour ${pageProjectIds.length} éléments, mode: ${scopeMode}`,
      );

      // Récupérer les pages sélectionnées
      const pages = await prisma.page.findMany({
        where: {
          id: { in: pageProjectIds },
          workspace: {
            members: {
              some: { userId: userId },
            },
          },
          isArchived: false,
        },
        select: {
          id: true,
          title: true,
          workspaceId: true,
          blockNoteContent: true,
          updatedAt: true,
        },
      });

      if (pages.length === 0) {
        res.status(404).json({
          success: false,
          error: "Aucune page valide trouvée",
          ragContext: "",
          ragSources: [],
        });
        return;
      }

      // Construire la query RAG basée sur les pages sélectionnées
      const pagesQuery = pages.map((p) => p.title).join(" + ");

      try {
        // Importer le système RAG
        const { ragSystem } = await import("../../../services/rag/index.js");

        // 🔄 Vérifier et reprocesser les pages échouées ou manquantes
        for (const page of pages) {
          const existingSource = await prismaEmbeddings.rAGSource.findFirst({
            where: {
              sourceType: "WORKSPACE_PAGE",
              userId: userId,
              workspaceId: page.workspaceId,
              metadata: {
                path: ["pageId"],
                equals: page.id,
              },
            },
          });

          if (!existingSource || existingSource.status === "FAILED") {
            console.log(
              `🔄 [QUIZ-RAG] Reprocessing page ${page.title} (${page.id})`,
            );
            try {
              if (page.blockNoteContent) {
                console.log(
                  `🔍 [QUIZ-RAG] Page "${page.title}" - blockNoteContent type: ${typeof page.blockNoteContent}, length: ${JSON.stringify(page.blockNoteContent).length}`,
                );

                // 📦 Extraire le contenu texte depuis blockNoteContent
                let textContent = page.title;
                try {
                  const content =
                    typeof page.blockNoteContent === "string"
                      ? JSON.parse(page.blockNoteContent)
                      : page.blockNoteContent;

                  if (content && Array.isArray(content)) {
                    const textParts = (content as BlockNoteBlock[])
                      .filter(
                        (block: BlockNoteBlock) =>
                          block?.type === "paragraph" && block?.content,
                      )
                      .map((block: BlockNoteBlock) =>
                        Array.isArray(block.content)
                          ? (block.content as BlockNoteContentItem[])
                              .map(
                                (item: BlockNoteContentItem) =>
                                  item?.text ?? "",
                              )
                              .join("")
                          : "",
                      )
                      .filter(Boolean);

                    if (textParts.length > 0) {
                      textContent =
                        page.title + "\n\n" + textParts.join("\n\n");
                    }
                  }
                } catch (error) {
                  console.warn(
                    `🧠 [QUIZ-RAG] Erreur extraction contenu page "${page.title}":`,
                    error,
                  );
                }

                console.log(
                  `📦 [QUIZ-RAG] Contenu extrait pour "${page.title}": ${textContent.length} caractères`,
                );

                // ⚡ Vérification de contenu minimum (même logique que userPages.ts)
                if (textContent.length < 50) {
                  console.log(
                    `⚠️ [QUIZ-RAG] Contenu trop court pour "${page.title}" (${textContent.length} chars) → Skip embedding`,
                  );
                  continue;
                }

                const { userPagesRAG } =
                  await import("../../../services/rag/userPages.js");
                const sourceId = await userPagesRAG.processUserPage({
                  id: page.id,
                  title: page.title,
                  content: textContent,
                  userId: userId,
                  workspaceId: page.workspaceId,
                  updatedAt: page.updatedAt,
                });

                if (sourceId) {
                  console.log(
                    `✅ [QUIZ-RAG] Page ${page.title} reprocessed successfully → sourceId: ${sourceId}`,
                  );

                  // Vérifier que des chunks ont été créés
                  const chunkCount = await prismaEmbeddings.rAGChunk.count({
                    where: { sourceId },
                  });
                  console.log(`📊 [QUIZ-RAG] Chunks créés: ${chunkCount}`);
                } else {
                  console.warn(
                    `⚠️ [QUIZ-RAG] Échec reprocessing pour page "${page.title}"`,
                  );
                }
              } else {
                console.warn(
                  `⚠️ [QUIZ-RAG] Page "${page.title}" sans contenu blockNoteContent`,
                );
              }
            } catch (error) {
              console.error(
                `❌ [QUIZ-RAG] Failed to reprocess page ${page.title}:`,
                error,
              );
            }
          }
        }

        // 🔍 Récupérer les sources RAG correspondant aux pages sélectionnées
        const completedRagSources = await prismaEmbeddings.rAGSource.findMany({
          where: {
            sourceType: "WORKSPACE_PAGE",
            userId: userId,
            workspaceId: pages[0]?.workspaceId,
            status: "COMPLETED",
            OR: pageProjectIds.map((pageId) => ({
              metadata: {
                path: ["pageId"],
                equals: pageId,
              },
            })),
          },
          select: { id: true, title: true },
        });

        const specificSourceIds = completedRagSources.map((s) => s.id);
        console.log(
          `🔍 [QUIZ-RAG] Sources RAG trouvées: ${specificSourceIds.length} (${completedRagSources.map((s) => s.title).join(", ")})`,
        );

        // Recherche RAG intelligente avec sources RAG spécifiques
        const searchResults = await ragSystem.intelligentSearch(pagesQuery, {
          userId: userId,
          workspaceId: pages[0]?.workspaceId,
          limit: scopeMode === "pages_only" ? 5 : 10,
          includeUserSources: true,
          specificSourceIds: specificSourceIds, // 🆕 Passer les IDs des sources RAG
        });

        console.log(
          `🧠 [QUIZ-RAG] ${searchResults.length} sources RAG trouvées`,
        );

        let ragContext = "";
        let ragSourcesForResponse: RAGSourceResponse[] = [];

        if (searchResults.length > 0) {
          // Mode "pages uniquement" : filtrer seulement les pages utilisateur
          const filteredResults =
            scopeMode === "pages_only"
              ? searchResults.filter(
                  (r) =>
                    r.source.type === "user_page" ||
                    r.source.sourceType === "WORKSPACE_PAGE" ||
                    (specificSourceIds.length > 0 &&
                      specificSourceIds.includes(r.source.id)),
                )
              : searchResults;

          console.log(
            `🔍 [QUIZ-RAG] Résultats avant filtrage: ${searchResults.length}, après: ${filteredResults.length}`,
          );
          console.log(
            `🔍 [QUIZ-RAG] Types de sources: ${searchResults.map((r) => r.source.type || r.source.sourceType).join(", ")}`,
          );

          if (filteredResults.length > 0) {
            ragContext = await ragSystem.buildOptimizedContext(
              pagesQuery,
              filteredResults,
            );
            ragSourcesForResponse = filteredResults.map((r) => ({
              title: r.source.title,
              type: r.source.type,
              similarity: r.similarity,
            }));
            console.log(
              `✅ [QUIZ-RAG] Contexte construit: ${ragContext.length} caractères`,
            );
          } else {
            console.log(
              `⚠️ [QUIZ-RAG] Aucun résultat après filtrage pour mode: ${scopeMode}`,
            );
          }
        }

        res.status(200).json({
          success: true,
          ragContext,
          ragSources: ragSourcesForResponse,
          scopeMode,
          metadata: {
            pagesQueried: pages.length,
            sourcesFound: ragSourcesForResponse.length,
            contextLength: ragContext.length,
          },
        });
      } catch (ragError) {
        console.warn(
          "⚠️ [QUIZ-RAG] Erreur récupération contexte RAG:",
          ragError,
        );
        res.status(200).json({
          success: false,
          error: "Contexte RAG non disponible",
          ragContext: "",
          ragSources: [],
        });
      }
    } catch (error) {
      console.error("Erreur construction contexte RAG quiz:", error);
      res.status(500).json({
        error: "Erreur lors de la construction du contexte RAG",
        details: error instanceof Error ? error.message : "Erreur inconnue",
      });
    }
  }

  /**
   * POST /api/quiz/save-fast-correction - Sauvegarde une correction rapide côté frontend
   */
  static async saveFastCorrection(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: "Utilisateur non authentifié" });
        return;
      }

      const {
        quizId,
        totalScore,
        maxScore,
        percentage,
        questionResults,
        fastCorrection,
      } = req.body;

      if (!quizId || !Array.isArray(questionResults)) {
        res.status(400).json({ error: "Données de correction invalides" });
        return;
      }

      console.log(
        `🚀 [FAST-CORRECTION] Sauvegarde correction rapide pour quiz: ${quizId}`,
      );

      // Vérifier que le quiz appartient à l'utilisateur
      const quiz = await prisma.quiz.findFirst({
        where: {
          id: quizId,
          userId,
        },
      });

      if (!quiz) {
        res.status(404).json({ error: "Quiz non trouvé" });
        return;
      }

      // Préparer le résultat pour la base de données
      const quizResult = {
        quizId,
        totalScore,
        maxScore,
        percentage,
        adaptedGrade: Math.round((totalScore / maxScore) * 20),
        gradeScale: "/20",
        questionResults,
        detailedScoring: questionResults,
        aiCorrection: {
          globalFeedback: `Résultat: ${totalScore}/${maxScore} (${percentage}%) - Correction automatique`,
          recommendations: [],
          strengths: [
            `Bonnes réponses sur ${(questionResults as QuestionResult[]).filter((r: QuestionResult) => r.isCorrect).length} question(s)`,
          ],
          weaknesses: [
            `Erreurs sur ${(questionResults as QuestionResult[]).filter((r: QuestionResult) => !r.isCorrect).length} question(s)`,
          ],
        },
        metadata: {
          correctedAt: new Date().toISOString(),
          aiModel: "Frontend Fast Correction",
          correctionTime: 0,
        },
      };

      // Sauvegarder le résultat ET marquer le quiz comme terminé (même logique que submitQuiz)
      const savedResult = await prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          // Marquer le quiz comme terminé
          await tx.quiz.update({
            where: { id: quizId },
            data: {
              isCompleted: true,
              completedAt: new Date(),
            },
          });

          // Créer le résultat
          return await tx.quizResult.create({
            data: {
              quizId,
              totalScore,
              maxScore,
              percentage,
              adaptedGrade: Math.round((totalScore / maxScore) * 20),
              gradeScale: "/20",
              detailedScoring:
                questionResults as unknown as Prisma.InputJsonValue,
              aiCorrection:
                quizResult.aiCorrection as unknown as Prisma.InputJsonValue,
              recommendations: quizResult.aiCorrection
                .recommendations as unknown as Prisma.InputJsonValue,
            },
          });
        },
      );

      console.log(
        `✅ [FAST-CORRECTION] Résultat sauvegardé et quiz marqué comme terminé: ${savedResult.id}`,
      );

      // 🗑️ Invalider le cache de l'historique après complétion du quiz
      const { invalidateQuizHistoryCache } =
        await import("../../../lib/redis.js");
      invalidateQuizHistoryCache(userId).catch((err) =>
        console.warn("⚠️ [FAST-CORRECTION] Échec invalidation cache:", err),
      );

      res.status(200).json({
        success: true,
        data: quizResult,
      });
    } catch (error) {
      console.error("❌ [FAST-CORRECTION] Erreur sauvegarde:", error);
      res.status(500).json({
        error: "Erreur lors de la sauvegarde de la correction rapide",
        details: error instanceof Error ? error.message : "Erreur inconnue",
      });
    }
  }
}
