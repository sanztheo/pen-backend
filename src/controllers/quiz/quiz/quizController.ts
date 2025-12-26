import { Request, Response } from "express";
import { QuizService } from "../../../services/quiz/quizService.js";
import {
  SchoolLevel,
  QuestionType,
  Question,
} from "../../../services/quiz/types.js";
import { prisma } from "../../../lib/prisma.js";
import { prismaEmbeddings } from "../../../lib/prismaEmbeddings.js";
import { CorrectionGenerator } from "../../../services/quiz/generators/correctionGenerator.js";
import { validateSourceDocuments } from "../utils/validators.js";
import { getUserPersonalization } from "../../../services/quiz/utils/personalizationUtils.js";

/**
 * Contrôleur pour les opérations CRUD de base sur les quiz
 */
export class QuizController {
  /**
   * POST /api/quiz/generate - Génère un nouveau quiz
   */
  static async generateQuiz(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: "Utilisateur non authentifié" });
        return;
      }

      const {
        schoolLevel: bodySchoolLevel,
        usePersonalization = false, // ✅ PEN-32: Récupérer personnalisation depuis DB
        preset,
        specificSubject,
        sequentialConfig,
        lyceeSpecialties,
        higherEdField,
        targetGrade,
        workspaceIds, // Deprecated - support rétrocompatibilité
        pageProjectIds, // Nouveau système
        questionTypes,
        questionCount,
        title,
        description,
        coursesOnly,
        letAIChoose, // PEN-35: Nouveau - Laisser l'IA choisir les paramètres
        quizType, // PEN-35: Type de quiz pour le preprocessor
      } = req.body;

      // ✅ PEN-32: Récupérer la personnalisation depuis la DB si demandé
      let schoolLevel = bodySchoolLevel;
      if (usePersonalization || !bodySchoolLevel) {
        const personalizationData = await getUserPersonalization(userId);
        if (personalizationData) {
          schoolLevel =
            personalizationData.classe || bodySchoolLevel || "COLLEGE";
          console.log(
            "[QUIZ-GENERATE] 👤 Personnalisation récupérée depuis DB:",
            {
              classe: personalizationData.classe,
              etude: personalizationData.etude,
              filiere: personalizationData.filiere,
              resolvedSchoolLevel: schoolLevel,
            },
          );
        } else {
          console.log(
            "[QUIZ-GENERATE] ⚠️ Aucune personnalisation trouvée, utilisation du bodySchoolLevel",
          );
        }
      }

      // PEN-35: Si letAIChoose est activé, utiliser le preprocessor
      let finalQuestionTypes = questionTypes;
      let finalQuestionCount = questionCount;

      if (letAIChoose === true) {
        try {
          const { runPreprocessorForGeneration } =
            await import("../../../services/quiz/preprocessor/integrationHelper.js");

          console.log(
            "🤖 [PREPROCESSOR] Mode 'Laisser l'IA choisir' activé, analyse des sources...",
          );

          const preprocessorResult = await runPreprocessorForGeneration({
            userId,
            schoolLevel,
            higherEdField,
            quizType: quizType || "ENTRAINEMENT",
            pageProjectIds: pageProjectIds || [],
            workspaceIds: workspaceIds || [],
          });

          // Utiliser les paramètres recommandés par l'IA
          finalQuestionTypes = preprocessorResult.questionTypes;
          finalQuestionCount = preprocessorResult.questionCount;

          console.log("✅ [PREPROCESSOR] Paramètres optimisés:", {
            questionCount: finalQuestionCount,
            typesCount: finalQuestionTypes.length,
            difficulty: preprocessorResult.difficulty,
            reasoning: preprocessorResult.reasoning,
          });
        } catch (error) {
          console.error(
            "❌ [PREPROCESSOR] Erreur, fallback sur params manuels:",
            error,
          );
          // Si le preprocessor échoue, utiliser les params par défaut ou retourner erreur
          if (!questionTypes || !questionCount) {
            res.status(400).json({
              error:
                "Impossible d'analyser les sources automatiquement. Veuillez sélectionner manuellement les paramètres.",
              details:
                error instanceof Error ? error.message : "Erreur inconnue",
            });
            return;
          }
        }
      }

      // Validation des paramètres requis (après preprocessor)
      if (!schoolLevel || !finalQuestionTypes || !finalQuestionCount) {
        res.status(400).json({
          error:
            "Paramètres manquants: schoolLevel, questionTypes et questionCount sont requis",
        });
        return;
      }

      // Validation des enums
      if (!Object.values(SchoolLevel).includes(schoolLevel)) {
        res.status(400).json({ error: "Niveau scolaire invalide" });
        return;
      }

      if (
        !Array.isArray(finalQuestionTypes) ||
        !finalQuestionTypes.every((type) =>
          Object.values(QuestionType).includes(type),
        )
      ) {
        res.status(400).json({ error: "Types de questions invalides" });
        return;
      }

      if (finalQuestionCount < 1 || finalQuestionCount > 100) {
        res
          .status(400)
          .json({ error: "Le nombre de questions doit être entre 1 et 100" });
        return;
      }

      // Construction de la requête
      const generationRequest = {
        userId,
        schoolLevel,
        preset,
        specificSubject,
        sequentialConfig,
        lyceeSpecialties: lyceeSpecialties || [],
        higherEdField,
        targetGrade,
        workspaceIds: workspaceIds || [], // Compatibilité ancienne API
        pageProjectIds: pageProjectIds || [], // Nouvelle API
        questionTypes: finalQuestionTypes, // PEN-35: Utiliser les params finaux (preprocessor ou manuels)
        questionCount: finalQuestionCount, // PEN-35: Utiliser les params finaux (preprocessor ou manuels)
        title,
        description,
        coursesOnly,
      };

      // Décision du type de génération basée sur le contenu sélectionné
      let quizId: string;

      if (pageProjectIds && pageProjectIds.length > 0) {
        console.log(
          "📄 Génération quiz basée sur pages/projets avec RAG:",
          pageProjectIds,
          "coursesOnly:",
          coursesOnly,
        );

        // 🧠 Système d'embedding automatique inspiré d'AssistantInput.tsx
        try {
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

          console.log(
            `🔍 [QUIZ-RAG] Pages trouvées: ${pages.length}/${pageProjectIds.length}`,
          );

          // Système d'embedding automatique pour chaque page
          if (pages.length > 0) {
            console.log(
              `🚀 [QUIZ-RAG] Démarrage embedding automatique pour ${pages.length} page(s)`,
            );

            const { userPagesRAG } =
              await import("../../../services/rag/userPages.js");

            let alreadyEmbedded = 0;
            let newlyProcessed = 0;
            let embeddingErrors = 0;

            for (const page of pages) {
              if (!page.title || !page.blockNoteContent) {
                console.warn(
                  `⚠️ [QUIZ-RAG] Page "${page.title || page.id}" ignorée (titre ou contenu manquant)`,
                );
                continue;
              }

              try {
                console.log(
                  `🔥 [QUIZ-RAG] Vérification et traitement page: "${page.title}"`,
                );

                // 🔍 1. Vérification d'existence comme dans AssistantInput.tsx
                const existingSource = await userPagesRAG.findExistingSource(
                  page.id,
                  userId,
                  page.workspaceId,
                );

                // 🔄 2. Décider si embedding nécessaire
                const needsEmbedding =
                  !existingSource ||
                  existingSource.status === "FAILED" ||
                  new Date(existingSource.updatedAt) < new Date(page.updatedAt);

                if (!needsEmbedding) {
                  console.log(
                    `✅ [QUIZ-RAG] Page "${page.title}" déjà embedée et à jour → Skip`,
                  );
                  alreadyEmbedded++;
                  continue;
                }

                if (existingSource && existingSource.status === "FAILED") {
                  console.log(
                    `🔄 [QUIZ-RAG] Page "${page.title}" précédemment échouée → Re-traitement`,
                  );
                } else if (existingSource) {
                  console.log(
                    `🔄 [QUIZ-RAG] Page "${page.title}" obsolète → Mise à jour`,
                  );
                } else {
                  console.log(
                    `🆕 [QUIZ-RAG] Nouvelle page "${page.title}" → Premier embedding`,
                  );
                }

                // 📦 3. Extraction du contenu (logique améliorée)
                let textContent = page.title;
                try {
                  const content =
                    typeof page.blockNoteContent === "string"
                      ? JSON.parse(page.blockNoteContent)
                      : page.blockNoteContent;

                  if (content && Array.isArray(content)) {
                    const textParts = content
                      .filter(
                        (block: any) =>
                          block?.type === "paragraph" && block?.content,
                      )
                      .map((block: any) =>
                        Array.isArray(block.content)
                          ? block.content
                              .map((item: any) => item?.text || "")
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

                // ⚡ 4. Vérification de contenu minimum (comme AssistantInput)
                if (textContent.length < 50) {
                  console.log(
                    `⚠️ [QUIZ-RAG] Contenu trop court pour "${page.title}" (${textContent.length} chars) → Skip embedding`,
                  );
                  continue;
                }

                // 🧠 5. Embedding immédiat et synchrone (comme AssistantInput.tsx)
                console.log(
                  `🧠 [QUIZ-RAG] Embedding immédiat: "${page.title}" (${textContent.length} chars)`,
                );

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
                    `✅ [QUIZ-RAG] Page "${page.title}" → RAG sourceId: ${sourceId}`,
                  );
                  newlyProcessed++;

                  // 🔍 Vérifier immédiatement que des chunks ont été créés
                  const chunkCount = await prismaEmbeddings.rAGChunk.count({
                    where: { sourceId },
                  });
                  console.log(
                    `📊 [QUIZ-RAG] Chunks générés pour "${page.title}": ${chunkCount}`,
                  );
                } else {
                  console.warn(
                    `⚠️ [QUIZ-RAG] Échec embedding pour page "${page.title}"`,
                  );
                  embeddingErrors++;
                }
              } catch (error) {
                console.error(
                  `❌ [QUIZ-RAG] Erreur embedding page "${page.title}":`,
                  error,
                );
                embeddingErrors++;
              }
            }

            console.log(`📊 [QUIZ-RAG] Résumé embedding automatique:`);
            console.log(`   • ${newlyProcessed} pages nouvellement embedées`);
            console.log(`   • ${alreadyEmbedded} pages déjà à jour`);
            console.log(`   • ${embeddingErrors} erreurs d'embedding`);

            // 🎯 Attendre un court délai pour que les embeddings soient disponibles
            if (newlyProcessed > 0) {
              console.log(
                `⏱️ [QUIZ-RAG] Attente 2s pour stabilisation des embeddings...`,
              );
              await new Promise((resolve) => setTimeout(resolve, 2000));
            }
          }
        } catch (error) {
          console.warn(
            "⚠️ [QUIZ-RAG] Erreur système embedding automatique, génération continue sans RAG:",
            error,
          );
        }

        // NOUVEAU: Génération basée sur pages/projets spécifiques avec RAG
        quizId = await QuizService.generateQuizFromPageProjects(
          generationRequest as any,
        );
      } else if (workspaceIds && workspaceIds.length > 0) {
        console.log(
          "🏢 Génération quiz basée sur workspaces:",
          workspaceIds,
          "coursesOnly:",
          coursesOnly,
        );
        // Génération basée sur workspaces (rétrocompatibilité)
        quizId = await QuizService.generateQuizFromWorkspace(
          generationRequest as any,
        );
      } else {
        console.log("📚 Génération quiz générique sans contenu");
        // Génération générique
        quizId = await QuizService.generateQuiz(generationRequest);
      }

      res.status(201).json({
        success: true,
        message: "Quiz généré avec succès",
        data: { quizId },
      });
    } catch (error) {
      console.error("Erreur génération quiz:", error);
      res.status(500).json({
        error: "Erreur lors de la génération du quiz",
        details: error instanceof Error ? error.message : "Erreur inconnue",
      });
    }
  }

  /**
   * GET /api/quiz/:id - Récupère un quiz par son ID
   */
  static async getQuiz(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const quizId = req.params.id;

      if (!userId) {
        res.status(401).json({ error: "Utilisateur non authentifié" });
        return;
      }

      if (!quizId) {
        res.status(400).json({ error: "ID du quiz requis" });
        return;
      }

      const quiz = await QuizService.getQuiz(quizId, userId);

      res.status(200).json({
        success: true,
        data: quiz,
      });
    } catch (error) {
      console.error("Erreur récupération quiz:", error);
      if (error instanceof Error && error.message.includes("not found")) {
        res.status(404).json({ error: "Quiz non trouvé" });
      } else {
        res.status(500).json({
          error: "Erreur lors de la récupération du quiz",
          details: error instanceof Error ? error.message : "Erreur inconnue",
        });
      }
    }
  }

  /**
   * POST /api/quiz/:id/submit - Soumet un quiz pour correction (utilise maintenant le streaming)
   */
  static async submitQuiz(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const quizId = req.params.id;
      const { answers, sourceDocuments, hasDocuments } = req.body;

      if (!userId) {
        res.status(401).json({ error: "Utilisateur non authentifié" });
        return;
      }

      if (!quizId) {
        res.status(400).json({ error: "ID du quiz requis" });
        return;
      }

      if (!answers || !Array.isArray(answers)) {
        res
          .status(400)
          .json({ error: "Réponses requises sous forme de tableau" });
        return;
      }

      // 🛡️ Validation stricte de sourceDocuments pour éviter saturation mémoire
      const validation = validateSourceDocuments(sourceDocuments);
      if (!validation.valid) {
        res.status(400).json({
          error: validation.error,
          ...validation.details,
        });
        return;
      }

      // ✅ Utiliser le streaming pour la correction (similaire à submitAndCorrectStream)
      console.log(
        "📝 [SUBMIT-QUIZ] Requête de correction via submitQuiz (redirection vers streaming)",
      );
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      // Utiliser le même service de streaming que l'endpoint dédié
      const quiz = await prisma.quiz.findFirst({
        where: {
          id: quizId,
          userId: userId,
        },
      });

      if (!quiz) {
        res.status(404).json({ error: "Quiz non trouvé" });
        return;
      }

      const correctionRequest: any = {
        quizId,
        userId,
        preset: (quiz as any).preset,
        specificSubject: null,
        schoolLevel: quiz.schoolLevel as any,
        // Utiliser les sourceDocuments du quiz pour la cohérence
        hasDocuments: quiz.hasDocuments || hasDocuments || false,
        sourceDocuments: (quiz.sourceDocuments as any) || sourceDocuments || [],
        coursesOnly: false,
        workspaceContent: [],
        userAnswers: answers,
        submittedAt: new Date(),
      };

      // Démarrer le streaming de correction
      const generator = CorrectionGenerator.correctQuizStreaming(
        quiz.questions as unknown as Question[],
        answers,
        correctionRequest,
      );

      // Envoyer les événements
      for await (const event of generator) {
        const eventData = JSON.stringify(event);
        res.write(`data: ${eventData}\n\n`);

        // Quand la correction est terminée, marquer le quiz comme complété
        if (event.type === "completion" && event.finalResult) {
          console.log(
            "✅ [SUBMIT-QUIZ] Correction complétée, marquage du quiz comme isCompleted",
          );
          await prisma.quiz.update({
            where: { id: quizId },
            data: {
              isCompleted: true,
              updatedAt: new Date(),
            },
          });
        }
      }

      res.end();
    } catch (error) {
      console.error("Erreur soumission quiz:", error);
      if (error instanceof Error && error.message.includes("not found")) {
        res.status(404).json({ error: "Quiz non trouvé" });
      } else if (
        error instanceof Error &&
        error.message.includes("already submitted")
      ) {
        res.status(409).json({ error: "Quiz déjà soumis" });
      } else {
        res.status(500).json({
          error: "Erreur lors de la soumission du quiz",
          details: error instanceof Error ? error.message : "Erreur inconnue",
        });
      }
    }
  }

  /**
   * GET /api/quiz/history - Récupère l'historique des quiz
   */
  static async getQuizHistory(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const { limit = 10, offset = 0 } = req.query;

      if (!userId) {
        res.status(401).json({ error: "Utilisateur non authentifié" });
        return;
      }

      const parsedLimit = parseInt(limit as string, 10);
      const parsedOffset = parseInt(offset as string, 10);

      if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
        res.status(400).json({ error: "Limite doit être entre 1 et 100" });
        return;
      }

      if (isNaN(parsedOffset) || parsedOffset < 0) {
        res.status(400).json({ error: "Offset doit être >= 0" });
        return;
      }

      // 🚀 Essayer de récupérer depuis le cache Redis
      const { cacheQuizHistory, saveQuizHistoryCache } =
        await import("../../../lib/redis.js");
      const cachedHistory = await cacheQuizHistory(
        userId,
        parsedLimit,
        parsedOffset,
      );

      if (cachedHistory) {
        console.log("✅ [QUIZ-HISTORY] Retour depuis cache Redis");
        res.status(200).json({
          success: true,
          data: {
            quizzes: cachedHistory,
            pagination: {
              limit: parsedLimit,
              offset: parsedOffset,
            },
          },
        });
        return;
      }

      // ❌ Pas de cache : récupérer depuis la DB
      console.log("❌ [QUIZ-HISTORY] Cache MISS - récupération DB");
      const history = await QuizService.getQuizHistory(
        userId,
        parsedLimit,
        parsedOffset,
      );

      // 💾 Sauvegarder dans le cache pour les prochaines requêtes
      saveQuizHistoryCache(userId, parsedLimit, parsedOffset, history).catch(
        (err) => console.warn("⚠️ [QUIZ-HISTORY] Échec sauvegarde cache:", err),
      );

      res.status(200).json({
        success: true,
        data: {
          quizzes: history,
          pagination: {
            limit: parsedLimit,
            offset: parsedOffset,
          },
        },
      });
    } catch (error) {
      console.error("Erreur récupération historique:", error);
      res.status(500).json({
        error: "Erreur lors de la récupération de l'historique",
        details: error instanceof Error ? error.message : "Erreur inconnue",
      });
    }
  }
}
