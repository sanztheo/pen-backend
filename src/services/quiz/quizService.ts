import { PrismaClient } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AIQuizService } from "./aiQuizService.js";
import {
  SchoolLevel,
  LyceeSpecialty,
  QuestionType,
  QuizGenerationRequest,
  QuizCorrectionRequest,
  GeneratedQuiz,
  UserAnswer,
  UserQuizPreferences,
  Question,
  WorkspaceAnalysisOptions,
  WorkspaceAnalysisResult,
  PageProjectAnalysisOptions,
  UserProgressStats,
  QuizPreset,
  SequentialQuizConfig,
  ExamSubject,
} from "./types.js";

// Import du gestionnaire de séquences
import {
  SequenceManager,
  SequenceCreationOptions,
} from "./presets/sequenceManager.js";
import { tempSequenceStorage } from "./tempSequenceStorage.js";
import { shouldIncludeDocumentsForSubject } from "./utils/documents.js";
import { OpenAIAssistantService } from "./assistant/index.js";
import { progressService } from "../progressService.js";

/**
 * Service principal pour la gestion des quiz
 */
export class QuizService {
  /**
   * Génère un nouveau quiz basé sur les paramètres
   */
  static async generateQuiz(
    request: QuizGenerationRequest,
    sequenceOptions?: {
      sequenceId: string;
      sequenceOrder: number;
    },
  ): Promise<string> {
    try {
      console.log("🎯 Génération quiz pour utilisateur:", request.userId);

      // Validation des paramètres
      if (
        !request.userId ||
        !request.schoolLevel ||
        !request.questionTypes?.length
      ) {
        throw new Error("Paramètres manquants pour la génération du quiz");
      }

      // Génération du processId unique pour cette génération
      const processId = `quiz_gen_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      progressService.registerProcessOwner(processId, request.userId);
      console.log(`🎯 Génération quiz avec processId: ${processId}`);

      // Génération du quiz via IA
      const generatedQuiz = await AIQuizService.generateQuiz(
        request,
        processId,
      );

      // Sauvegarde en base de données (ADAPTÉ pour les sujets)
      const quizData: any = {
        userId: request.userId,
        title:
          generatedQuiz.title || request.title || `Quiz ${request.schoolLevel}`,
        aiGeneratedTitle: generatedQuiz.aiGeneratedTitle,
        schoolLevel: request.schoolLevel,
        questions: generatedQuiz.questions as any, // Rétrocompatibilité
        isCompleted: false,
        isSequential: !!sequenceOptions,
        sequenceId: sequenceOptions?.sequenceId,
        sequenceOrder: sequenceOptions?.sequenceOrder,
        preset: request.preset || "NONE",
        selectedSpecialties: request.lyceeSpecialties || [],
        higherEdField: request.higherEdField,
      };

      // **NOUVEAU**: Support des sujets thématiques
      if (generatedQuiz.subjectBased && generatedQuiz.subjects) {
        console.log(
          `💾 Sauvegarde quiz avec ${generatedQuiz.subjects.length} sujets thématiques`,
        );

        // 🔍 DEBUG: Vérifier les propriétés graphiques avant sauvegarde
        generatedQuiz.subjects.forEach((subject, subjectIndex) => {
          subject.questions.forEach((question, questionIndex) => {
            if (question.hasGraphic) {
              console.log(
                `🔍 [SAVE-DEBUG] Sujet ${subjectIndex}, Question ${questionIndex}:`,
                {
                  hasGraphic: question.hasGraphic,
                  graphicId: question.graphicId,
                  graphicConfig: question.graphicConfig
                    ? "PRESENT"
                    : "UNDEFINED",
                  graphicDescription: question.graphicDescription
                    ? "PRESENT"
                    : "UNDEFINED",
                  graphicDataValues: question.graphicDataValues
                    ? `${question.graphicDataValues.length} values`
                    : "UNDEFINED/EMPTY",
                },
              );
            }
          });
        });

        // 🛠️ CORRECTION: Nettoyer les propriétés undefined avant sérialisation JSON
        const cleanedSubjects = this.cleanGraphicPropertiesForSave(
          generatedQuiz.subjects,
        );
        quizData.subjects = cleanedSubjects as any; // Nouveau champ
        quizData.subjectBased = true;
        quizData.currentSubjectIndex = 0; // Commencer au premier sujet
      }

      // **FIX DOCUMENTS**: Sauvegarde des documents Wikipedia
      if (generatedQuiz.sourceDocuments) {
        console.log(
          `📚 [SAVE] Sauvegarde quiz avec ${generatedQuiz.sourceDocuments.length} documents Wikipedia`,
        );
        quizData.sourceDocuments = generatedQuiz.sourceDocuments;
        quizData.hasDocuments = generatedQuiz.hasDocuments || true;
      } else {
        quizData.sourceDocuments = [];
        quizData.hasDocuments = false;
      }

      const savedQuiz = await prisma.quiz.create({
        data: quizData,
      });

      console.log(
        "✅ Quiz généré et sauvegardé:",
        savedQuiz.id,
        sequenceOptions ? "(séquentiel)" : "(normal)",
      );

      // 🗑️ Invalider le cache de l'historique après création du quiz
      const { invalidateQuizHistoryCache } = await import("../../lib/redis.js");
      invalidateQuizHistoryCache(request.userId).catch((err) =>
        console.warn("⚠️ [QUIZ-SERVICE] Échec invalidation cache:", err),
      );

      return savedQuiz.id;
    } catch (error) {
      console.error("❌ Erreur génération quiz:", error);
      throw new Error(
        `Échec de la génération du quiz: ${error instanceof Error ? error.message : "Erreur inconnue"}`,
      );
    }
  }

  /**
   * Génère un quiz basé sur des pages/projets spécifiques
   */
  static async generateQuizFromPageProjects(
    request: QuizGenerationRequest & { pageProjectIds: string[] },
  ): Promise<string> {
    try {
      console.log(
        "📄 Génération quiz depuis pages/projets:",
        request.pageProjectIds,
      );
      console.log("📚 Mode coursesOnly activé:", request.coursesOnly);

      // Analyse du contenu des pages/projets sélectionnés
      const contentAnalysis = await this.analyzePageProjectContent({
        pageProjectIds: request.pageProjectIds,
        maxPagesPerProject: 10,
        includeBlocks: true,
        minContentLength: 100,
        schoolLevel: request.schoolLevel, // Passer le niveau scolaire de la requête
      });

      console.log(
        "🔍 Résultats de l'analyse:",
        contentAnalysis.length,
        "éléments analysés",
      );

      if (!contentAnalysis.length) {
        console.warn(
          "⚠️ Aucun contenu analysable trouvé dans les pages/projets fournis",
        );
        throw new Error(
          "Aucun contenu analysable trouvé dans les pages/projets sélectionnés. Vérifiez que vos pages contiennent du texte.",
        );
      }

      // 🧠 Intégrer le contexte RAG pour améliorer la génération
      let ragContext = "";
      let ragSources: any[] = [];

      try {
        // Construire une query basée sur les pages sélectionnées
        const pagesQuery = contentAnalysis
          .flatMap((w) => w.extractedContent)
          .map((c) => c.title)
          .join(" + ");
        console.log(
          `🧠 [QUIZ-RAG] Recherche contexte RAG pour: "${pagesQuery}"`,
        );

        // Importer le système RAG
        const { ragSystem } = await import("../rag/index.js");

        // Recherche RAG intelligente basée sur le contenu des pages
        const searchResults = await ragSystem.intelligentSearch(pagesQuery, {
          userId: request.userId,
          workspaceId: contentAnalysis[0]?.workspaceId, // Utiliser le workspace de la première page
          limit: 8,
          includeUserSources: true, // Inclure les pages utilisateur traitées
        });

        console.log(
          `🧠 [QUIZ-RAG] ${searchResults.length} sources RAG trouvées`,
        );

        if (searchResults.length > 0) {
          // Construire le contexte optimisé
          ragContext = await ragSystem.buildOptimizedContext(
            pagesQuery,
            searchResults,
          );
          ragSources = searchResults.map((r) => ({
            title: r.source.title,
            type: r.source.type,
            similarity: r.similarity,
          }));

          console.log(
            `✅ [QUIZ-RAG] Contexte construit: ${ragContext.length} caractères, ${ragSources.length} sources`,
          );
        }
      } catch (error) {
        console.warn(
          "⚠️ [QUIZ-RAG] Erreur récupération contexte RAG, génération continue sans RAG:",
          error,
        );
      }

      // Génération du quiz basé sur le contenu + contexte RAG
      const generatedQuiz = await AIQuizService.generateQuizFromWorkspace(
        request,
        contentAnalysis,
        ragContext,
      );

      // Debug : vérifier le quiz généré
      console.log("🔍 [DEBUG] Quiz généré par l'IA:", {
        title: generatedQuiz.title,
        hasQuestions: !!generatedQuiz.questions,
        questionsCount: Array.isArray(generatedQuiz.questions)
          ? generatedQuiz.questions.length
          : "N/A",
        questionsType: typeof generatedQuiz.questions,
        questionsPreview: generatedQuiz.questions
          ? JSON.stringify(generatedQuiz.questions).substring(0, 300)
          : "null",
      });

      // Création du template d'abord
      const pageProjectNames = contentAnalysis
        .map((c) => c.workspaceName)
        .join(", ");
      const template = await prisma.quizTemplate.create({
        data: {
          userId: request.userId,
          title: `Quiz basé sur: ${pageProjectNames}`,
          description:
            "Quiz généré automatiquement depuis vos pages et projets sélectionnés",
          schoolLevel: request.schoolLevel,
          lyceeSpecialties: request.lyceeSpecialties || [],
          higherEdField: request.higherEdField,
          workspaceIds: [], // Pas de workspaces entiers
          questionTypes: request.questionTypes,
          questionCount: request.questionCount,
          targetGrade: request.targetGrade,
          parameters: JSON.parse(
            JSON.stringify({
              pageProjectAnalysis: contentAnalysis,
              pageProjectIds: request.pageProjectIds,
              generationMetadata: generatedQuiz.metadata,
              coursesOnly: request.coursesOnly, // Stocker le paramètre coursesOnly
            }),
          ),
        },
      });

      // Puis création du quiz avec référence au template
      const savedQuiz = await prisma.quiz.create({
        data: {
          userId: request.userId,
          templateId: template.id,
          title: generatedQuiz.title,
          aiGeneratedTitle: generatedQuiz.aiGeneratedTitle,
          schoolLevel: request.schoolLevel,
          questions: generatedQuiz.questions as any,
          isCompleted: false,
        },
      });

      console.log("✅ Quiz généré depuis pages/projets:", savedQuiz.id);
      return savedQuiz.id;
    } catch (error) {
      console.error("❌ Erreur génération quiz pages/projets:", error);
      throw new Error(
        `Échec de la génération du quiz depuis pages/projets: ${error instanceof Error ? error.message : "Erreur inconnue"}`,
      );
    }
  }

  /**
   * Génère un quiz basé sur le contenu d'un ou plusieurs workspaces
   */
  static async generateQuizFromWorkspace(
    request: QuizGenerationRequest & { workspaceIds: string[] },
  ): Promise<string> {
    try {
      console.log(
        "🏢 Génération quiz depuis workspaces:",
        request.workspaceIds,
      );
      console.log("📚 Mode coursesOnly activé:", request.coursesOnly);

      // Analyse du contenu des workspaces
      const workspaceAnalysis = await this.analyzeWorkspaceContent({
        workspaceIds: request.workspaceIds,
        maxPages: 10,
        includeBlocks: true,
        minContentLength: 100,
        schoolLevel: request.schoolLevel, // Passer le niveau scolaire de la requête
      });

      console.log(
        "🔍 Résultats de l'analyse:",
        workspaceAnalysis.length,
        "workspaces analysés",
      );

      if (!workspaceAnalysis.length) {
        console.warn(
          "⚠️ Aucun contenu analysable trouvé dans les workspaces fournis",
        );
        throw new Error(
          "Aucun contenu analysable trouvé dans les workspaces. Vérifiez que les workspaces contiennent des pages avec du contenu.",
        );
      }

      // Génération du quiz basé sur le contenu
      const generatedQuiz = await AIQuizService.generateQuizFromWorkspace(
        request,
        workspaceAnalysis,
      );

      // Création du template d'abord
      const template = await prisma.quizTemplate.create({
        data: {
          userId: request.userId,
          title: `Quiz basé sur: ${workspaceAnalysis.map((w) => w.workspaceName).join(", ")}`,
          description:
            "Quiz généré automatiquement depuis le contenu de vos workspaces",
          schoolLevel: request.schoolLevel,
          lyceeSpecialties: request.lyceeSpecialties || [],
          higherEdField: request.higherEdField,
          workspaceIds: request.workspaceIds,
          questionTypes: request.questionTypes,
          questionCount: request.questionCount,
          targetGrade: request.targetGrade,
          parameters: JSON.parse(
            JSON.stringify({
              workspaceAnalysis,
              generationMetadata: generatedQuiz.metadata,
              coursesOnly: request.coursesOnly, // Stocker le paramètre coursesOnly
            }),
          ),
        },
      });

      // Puis création du quiz avec référence au template
      const savedQuiz = await prisma.quiz.create({
        data: {
          userId: request.userId,
          templateId: template.id,
          title: generatedQuiz.title,
          aiGeneratedTitle: generatedQuiz.aiGeneratedTitle, // ✅ Titre IA workspace
          schoolLevel: request.schoolLevel,
          questions: generatedQuiz.questions as any,
          isCompleted: false,
          // examSubject: request.specificSubject || undefined // TODO: Ajouter après migration
        },
      });

      console.log("✅ Quiz généré depuis workspaces:", savedQuiz.id);
      return savedQuiz.id;
    } catch (error) {
      console.error("❌ Erreur génération quiz workspace:", error);
      throw new Error(
        `Échec de la génération du quiz depuis workspace: ${error instanceof Error ? error.message : "Erreur inconnue"}`,
      );
    }
  }

  /**
   * Récupère un quiz par son ID
   */
  static async getQuiz(quizId: string, userId: string): Promise<any> {
    try {
      const quiz = await prisma.quiz.findFirst({
        where: {
          id: quizId,
          userId: userId,
        },
        include: {
          template: true,
          result: true,
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      });

      if (!quiz) {
        throw new Error("Quiz introuvable ou accès non autorisé");
      }

      // Debug : vérifier le contenu des questions
      console.log("🔍 [DEBUG] Quiz récupéré:", {
        id: quiz.id,
        title: quiz.title,
        hasQuestions: !!quiz.questions,
        questionsType: typeof quiz.questions,
        questionsLength: Array.isArray(quiz.questions)
          ? quiz.questions.length
          : "N/A",
        questionsPreview: quiz.questions
          ? JSON.stringify(quiz.questions).substring(0, 200)
          : "null",
      });

      return quiz;
    } catch (error) {
      console.error("❌ Erreur récupération quiz:", error);
      throw new Error(
        `Impossible de récupérer le quiz: ${error instanceof Error ? error.message : "Erreur inconnue"}`,
      );
    }
  }

  /**
   * Démarre un quiz (marque le temps de début)
   */
  static async startQuiz(quizId: string, userId: string): Promise<void> {
    try {
      await prisma.quiz.updateMany({
        where: {
          id: quizId,
          userId: userId,
          startedAt: null, // Uniquement si pas encore démarré
        },
        data: {
          startedAt: new Date(),
        },
      });

      console.log("▶️ Quiz démarré:", quizId);
    } catch (error) {
      console.error("❌ Erreur démarrage quiz:", error);
      throw new Error("Impossible de démarrer le quiz");
    }
  }

  /**
   * Sauvegarde les réponses utilisateur (sauvegarde progressive)
   */
  static async saveUserAnswers(
    quizId: string,
    userId: string,
    userAnswers: UserAnswer[],
  ): Promise<void> {
    try {
      await prisma.quiz.updateMany({
        where: {
          id: quizId,
          userId: userId,
        },
        data: {
          userAnswers: userAnswers as any, // JSON
        },
      });

      console.log("💾 Réponses sauvegardées pour quiz:", quizId);
    } catch (error) {
      console.error("❌ Erreur sauvegarde réponses:", error);
      throw new Error("Impossible de sauvegarder les réponses");
    }
  }

  /**
   * Soumet un quiz pour correction automatique
   */
  static async submitQuiz(
    quizId: string,
    userId: string,
    userAnswers: UserAnswer[],
    sourceDocuments?: any[],
    hasDocuments?: boolean,
    processId?: string,
  ): Promise<any> {
    try {
      console.log("📝 Soumission quiz pour correction:", quizId);

      // Récupération du quiz
      const quiz = await this.getQuiz(quizId, userId);
      if (quiz.isCompleted) {
        throw new Error("Ce quiz a déjà été complété");
      }

      // Pour les quiz séquentiels, récupérer la matière depuis la configuration
      let specificSubject = quiz.examSubject;
      if (quiz.isSequential && quiz.sequenceId) {
        try {
          const config = await this.getSequenceConfig(quiz.sequenceId, userId);
          const currentSubjectResult =
            config.subjectResults[quiz.sequenceOrder || 0];

          // Utiliser le nom réel de la matière depuis subjectResults (ex: "Microéconomie")
          if (currentSubjectResult && currentSubjectResult.subjectName) {
            specificSubject = currentSubjectResult.subjectName;
            console.log(
              "🔍 Matière récupérée depuis séquence:",
              currentSubjectResult.subjectName,
            );
          } else {
            // Fallback vers l'ancien système
            const currentSubject = config.subjects[quiz.sequenceOrder || 0];
            specificSubject = currentSubject;
            console.log(
              "🔍 Matière récupérée depuis séquence (fallback):",
              currentSubject,
            );
          }
        } catch (error) {
          console.warn(
            "⚠️ Impossible de récupérer la configuration de séquence:",
            error,
          );
        }
      }

      // Récupération des paramètres coursesOnly et workspaceContent depuis le template
      let coursesOnly = false;
      let workspaceContent: any[] = [];

      if (quiz.template && quiz.template.parameters) {
        const params = quiz.template.parameters as any;
        coursesOnly = params.coursesOnly || false;

        // Support des deux systèmes : ancien (workspaceAnalysis) et nouveau (pageProjectAnalysis)
        workspaceContent =
          params.workspaceAnalysis || params.pageProjectAnalysis || [];

        console.log("📄 Contenu récupéré pour correction:", {
          hasWorkspaceAnalysis: !!(
            params.workspaceAnalysis && params.workspaceAnalysis.length
          ),
          hasPageProjectAnalysis: !!(
            params.pageProjectAnalysis && params.pageProjectAnalysis.length
          ),
          totalContentSources: workspaceContent.length,
          coursesOnly,
        });
      }

      console.log("🔍 Quiz récupéré pour correction:", {
        id: quiz.id,
        preset: quiz.preset,
        examSubject: quiz.examSubject,
        specificSubject,
        isSequential: quiz.isSequential,
        sequenceId: quiz.sequenceId,
        coursesOnly, // Nouveau
        hasWorkspaceContent: workspaceContent.length > 0, // Nouveau
      });

      // Préparation de la requête de correction
      const correctionRequest: QuizCorrectionRequest = {
        quizId,
        userId,
        userAnswers,
        schoolLevel: quiz.schoolLevel,
        collegeGrade: quiz.collegeGrade,
        preset: quiz.preset, // Ajout du preset pour utiliser les prompts spécialisés
        specificSubject, // Utilisation de la matière récupérée
        coursesOnly, // Nouveau - mode correction basée uniquement sur les cours
        workspaceContent, // Nouveau - contenu des workspaces pour la correction
        sourceDocuments, // NOUVEAU - Documents Wikipedia sources pour la correction
        hasDocuments, // NOUVEAU - Indique si le quiz contient des documents
        submittedAt: new Date(),
      };

      console.log("🔍 Requête de correction:", {
        preset: correctionRequest.preset,
        specificSubject: correctionRequest.specificSubject,
        coursesOnly: correctionRequest.coursesOnly,
        hasWorkspaceContent:
          (correctionRequest.workspaceContent || []).length > 0,
      });

      // Extraction des questions selon le type de quiz
      let questionsForCorrection: Question[] = [];

      if (quiz.subjectBased && quiz.subjects && Array.isArray(quiz.subjects)) {
        // Nouveau système: extraire toutes les questions des sujets
        console.log(
          `📚 [CORRECTION] Quiz basé sur des sujets - extraction des questions depuis ${quiz.subjects.length} sujets`,
        );

        // 🛠️ CORRECTION: Reconstruire les propriétés graphiques lors de la lecture
        const rawQuestions = quiz.subjects.flatMap(
          (subject: any) => subject.questions || [],
        );
        questionsForCorrection =
          this.reconstructGraphicProperties(rawQuestions);

        console.log(
          `📝 [CORRECTION] ${questionsForCorrection.length} questions extraites des sujets`,
        );
      } else {
        // Ancien système: utiliser les questions directes
        console.log(
          `📝 [CORRECTION] Quiz classique - utilisation des questions directes`,
        );
        questionsForCorrection = quiz.questions as Question[];
      }

      if (questionsForCorrection.length === 0) {
        throw new Error("Aucune question trouvée pour la correction");
      }

      console.log(
        `🔍 [CORRECTION] Questions trouvées: ${questionsForCorrection.map((q) => q.id).join(", ")}`,
      );
      console.log(
        `🔍 [CORRECTION] Réponses utilisateur: ${userAnswers.map((ua) => ua.questionId).join(", ")}`,
      );

      // CORRECTIF: S'assurer qu'on a une réponse pour chaque question (même vide)
      const completeUserAnswers = questionsForCorrection.map((question) => {
        const existingAnswer = userAnswers.find(
          (ua) => ua.questionId === question.id,
        );
        return (
          existingAnswer || {
            questionId: question.id,
            answer: "", // Réponse vide si l'utilisateur n'a pas répondu
            timeSpent: 0,
            subjectId: undefined,
            subjectIndex: undefined,
          }
        );
      });

      console.log(
        `✅ [CORRECTION] Réponses complétées: ${completeUserAnswers.length} réponses pour ${questionsForCorrection.length} questions`,
      );
      console.log(
        `📊 [CORRECTION] Réponses fournies: ${userAnswers.length}, Réponses vides générées: ${completeUserAnswers.length - userAnswers.length}`,
      );

      // Génération du processId unique pour cette correction
      const processId = `quiz_correct_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      progressService.registerProcessOwner(processId, userId);
      console.log(`🎯 Correction quiz avec processId: ${processId}`);

      // Correction via IA
      const correctionResult = await AIQuizService.correctQuiz(
        questionsForCorrection,
        completeUserAnswers,
        correctionRequest,
        processId,
      );

      // Debug : Afficher le résultat de correction avant sauvegarde
      console.log(
        "🔍 Résultat correction avant sauvegarde:",
        JSON.stringify(correctionResult, null, 2),
      );

      // Sauvegarde du résultat et récupération des données complètes
      let savedResult: any = null;
      await prisma.$transaction(async (tx: any) => {
        // Mise à jour du quiz
        await tx.quiz.update({
          where: { id: quizId },
          data: {
            userAnswers: completeUserAnswers as any,
            isCompleted: true,
            completedAt: new Date(),
          },
        });

        // Création du résultat avec relation quiz
        savedResult = await tx.quizResult.create({
          data: {
            totalScore: correctionResult.totalScore,
            maxScore: correctionResult.maxScore,
            percentage: correctionResult.percentage,
            adaptedGrade: correctionResult.adaptedGrade,
            gradeScale: correctionResult.gradeScale,
            detailedScoring: correctionResult.questionResults as any,
            aiCorrection: correctionResult.aiCorrection as any,
            recommendations: correctionResult.aiCorrection
              .recommendations as any,
            strengths: correctionResult.aiCorrection.strengths as any,
            weaknesses: correctionResult.aiCorrection.weaknesses as any,
            quiz: {
              connect: { id: quizId },
            },
          },
        });
      });

      if (!savedResult) {
        throw new Error("Erreur lors de la sauvegarde du résultat");
      }

      console.log("✅ Quiz corrigé et résultat sauvegardé");

      // Retourner les résultats complets au lieu de seulement l'ID
      return {
        id: savedResult.id,
        quizId: savedResult.quizId,
        totalScore: savedResult.totalScore,
        maxScore: savedResult.maxScore,
        percentage: savedResult.percentage,
        adaptedGrade: savedResult.adaptedGrade,
        detailedScoring: savedResult.detailedScoring,
        aiCorrection: savedResult.aiCorrection,
        recommendations: savedResult.recommendations,
        createdAt: savedResult.createdAt,
      };
    } catch (error) {
      console.error("❌ Erreur soumission quiz:", error);
      throw new Error(
        `Échec de la soumission du quiz: ${error instanceof Error ? error.message : "Erreur inconnue"}`,
      );
    }
  }

  /**
   * Récupère l'historique des quiz d'un utilisateur
   */
  static async getQuizHistory(
    userId: string,
    limit = 20,
    offset = 0,
  ): Promise<any[]> {
    try {
      // Récupérer les quiz individuels (non-séquentiels)
      const individualQuizzes = await prisma.quiz.findMany({
        where: {
          userId,
          isSequential: false, // Seulement les quiz non-séquentiels
          sequenceId: null, // Double vérification
        },
        include: {
          template: {
            select: {
              title: true,
              description: true,
              schoolLevel: true,
            },
          },
          result: {
            select: {
              totalScore: true,
              maxScore: true,
              percentage: true,
              adaptedGrade: true,
              gradeScale: true,
              detailedScoring: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      // Récupérer les séquences de quiz
      const quizSequences = await prisma.quizSequence.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
      });

      // Transformer les séquences pour les rendre compatibles avec l'affichage
      const formattedSequences = quizSequences.map((sequence) => {
        const subjects = Array.isArray(sequence.subjects)
          ? sequence.subjects
          : [];
        const subjectResults = Array.isArray(sequence.subjectResults)
          ? sequence.subjectResults
          : [];

        // Calculer les statistiques globales
        let totalQuestions = 0;
        let completedQuizzes = 0;
        let totalCorrect = 0;

        subjectResults.forEach((result: any) => {
          if (result.quizId && result.completed) {
            completedQuizzes++;
            if (result.score && result.maxScore) {
              totalQuestions += result.maxScore;
              totalCorrect += result.score;
            }
          }
        });

        const globalPercentage =
          totalQuestions > 0 ? (totalCorrect / totalQuestions) * 100 : 0;
        const globalGrade = globalPercentage * 0.2; // Conversion sur 20

        return {
          id: sequence.id,
          title: `Séquence ${sequence.preset} (${completedQuizzes}/${sequence.totalSubjects})`,
          preset: sequence.preset,
          isSequential: true,
          isSequence: true,
          isCompleted: sequence.isCompleted,
          createdAt: sequence.createdAt,
          updatedAt: sequence.updatedAt,
          currentSubjectIndex: sequence.currentSubjectIndex,
          totalSubjects: sequence.totalSubjects,
          subjects: subjects,
          schoolLevel: sequence.preset, // Utiliser le preset comme niveau
          questions: subjects, // Pour compatibilité avec l'affichage
          result:
            sequence.isCompleted && totalQuestions > 0
              ? {
                  totalScore: totalCorrect,
                  maxScore: totalQuestions,
                  percentage: globalPercentage,
                  adaptedGrade: globalGrade,
                  gradeScale: "/20",
                  detailedScoring: subjectResults
                    .filter((r: any) => r.completed)
                    .map((r: any) => ({
                      questionId: r.subject,
                      isCorrect: r.score >= r.maxScore * 0.6, // 60% comme seuil de réussite
                      score: r.score,
                      maxScore: r.maxScore,
                    })),
                }
              : null,
          // Propriétés spécifiques aux séquences
          sequenceType: "sequence",
          canContinue:
            !sequence.isCompleted &&
            sequence.currentSubjectIndex < sequence.totalSubjects,
          nextSubject:
            !sequence.isCompleted &&
            sequence.currentSubjectIndex < subjects.length
              ? subjects[sequence.currentSubjectIndex]
              : null,
        };
      });

      // Combiner et trier par date de création (plus récent d'abord)
      const allItems = [
        ...individualQuizzes.map((quiz) => ({
          ...quiz,
          sequenceType: "individual",
        })),
        ...formattedSequences,
      ].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

      // Appliquer la pagination sur le résultat combiné
      return allItems.slice(offset, offset + limit);
    } catch (error) {
      console.error("❌ Erreur récupération historique:", error);
      throw new Error("Impossible de récupérer l'historique des quiz");
    }
  }

  /**
   * Sauvegarde ou met à jour les préférences utilisateur
   */
  static async saveUserPreferences(
    userId: string,
    preferences: Omit<UserQuizPreferences, "id" | "userId">,
  ): Promise<void> {
    try {
      await prisma.userQuizPreferences.upsert({
        where: { userId },
        update: {
          schoolLevel: preferences.schoolLevel,
          collegeGrade: preferences.collegeGrade,
          lyceeSpecialties: preferences.lyceeSpecialties,
          higherEdField: preferences.higherEdField,
          preferredWorkspace: preferences.preferredWorkspace,
          targetGrade: preferences.targetGrade,
          questionTypes: preferences.questionTypes,
          defaultQuestionCount: preferences.defaultQuestionCount,
        },
        create: {
          userId,
          schoolLevel: preferences.schoolLevel,
          collegeGrade: preferences.collegeGrade,
          lyceeSpecialties: preferences.lyceeSpecialties,
          higherEdField: preferences.higherEdField,
          preferredWorkspace: preferences.preferredWorkspace,
          targetGrade: preferences.targetGrade,
          questionTypes: preferences.questionTypes,
          defaultQuestionCount: preferences.defaultQuestionCount,
        },
      });

      console.log("💾 Préférences utilisateur sauvegardées");
    } catch (error) {
      console.error("❌ Erreur sauvegarde préférences:", error);
      throw new Error("Impossible de sauvegarder les préférences");
    }
  }

  /**
   * Récupère les préférences utilisateur
   */
  static async getUserPreferences(
    userId: string,
  ): Promise<UserQuizPreferences | null> {
    try {
      const preferences = await prisma.userQuizPreferences.findUnique({
        where: { userId },
      });

      return preferences as UserQuizPreferences | null;
    } catch (error) {
      console.error("❌ Erreur récupération préférences:", error);
      throw new Error("Impossible de récupérer les préférences");
    }
  }

  /**
   * Analyse le contenu des workspaces pour la génération de quiz
   */
  private static async analyzeWorkspaceContent(
    options: WorkspaceAnalysisOptions,
  ): Promise<WorkspaceAnalysisResult[]> {
    try {
      const results: WorkspaceAnalysisResult[] = [];

      for (const workspaceId of options.workspaceIds) {
        // Récupération du workspace et de ses pages
        const workspace = await prisma.workspace.findUnique({
          where: { id: workspaceId },
          include: {
            projects: {
              include: {
                pages: {
                  select: {
                    id: true,
                    title: true,
                    blockNoteContent: true,
                  },
                  take: options.maxPages || 10,
                },
              },
            },
          },
        });

        if (!workspace) continue;

        // Extraction du contenu
        const extractedContent: WorkspaceAnalysisResult["extractedContent"] =
          [];
        let totalWords = 0;

        console.log(
          "🔍 Analyse du workspace:",
          workspace.name,
          "avec",
          workspace.projects.length,
          "projets",
        );

        // 🚀 Pour chaque projet, récupérer TOUTES les pages (incluant sous-projets)
        for (const project of workspace.projects) {
          console.log(
            "📁 Analyse du projet:",
            project.name || "Sans nom",
            "avec",
            project.pages.length,
            "pages directes",
          );

          // Récupération récursive de toutes les pages
          const allProjectPages = await this.getAllPagesRecursively(project.id);
          console.log(
            `📊 Total pages pour "${project.name}" (incluant sous-projets): ${allProjectPages.length}`,
          );

          for (const page of allProjectPages) {
            if (page.blockNoteContent) {
              try {
                // Extraire le contenu du JSON BlockNote
                const blockNoteContent = page.blockNoteContent as any[];

                if (Array.isArray(blockNoteContent)) {
                  const pageContent = blockNoteContent
                    .map((block) => {
                      if (typeof block.content === "string") {
                        return block.content;
                      } else if (Array.isArray(block.content)) {
                        return block.content
                          .map((item: any) => item.text || "")
                          .join("");
                      }
                      return "";
                    })
                    .filter((content) => content.trim().length > 0)
                    .join("\n");

                  console.log(
                    "📄 Page:",
                    page.title,
                    "- Contenu extrait:",
                    pageContent.length,
                    "caractères",
                  );

                  if (pageContent.length >= (options.minContentLength || 0)) {
                    extractedContent.push({
                      pageId: page.id,
                      title: page.title,
                      content: pageContent,
                      relevanceScore: Math.min(100, pageContent.length / 10), // Score basique
                    });
                    totalWords += pageContent.split(/\s+/).length;
                  }
                }
              } catch (error) {
                console.warn(
                  "⚠️ Erreur lors de l'extraction du contenu de la page:",
                  page.title,
                  error,
                );
              }
            } else {
              console.log(
                "📄 Page:",
                page.title,
                "- Pas de contenu blockNoteContent",
              );
            }
          }
        }

        // Analyse du contenu via IA si suffisant
        if (extractedContent.length > 0) {
          const contentForAnalysis = extractedContent
            .slice(0, 3) // Limite pour l'analyse IA
            .map((c) => c.content)
            .join("\n\n");

          const analysis = await AIQuizService.analyzeWorkspaceContent(
            contentForAnalysis,
            workspace.name,
            options.schoolLevel || SchoolLevel.LYCEE_PREMIERE, // Utilise le niveau fourni ou valeur par défaut
          );

          results.push({
            workspaceId: workspace.id,
            workspaceName: workspace.name,
            totalPages: workspace.projects.reduce(
              (sum: number, p: any) => sum + p.pages.length,
              0,
            ),
            analyzedPages: extractedContent.length,
            contentSummary: {
              totalWords,
              mainTopics: analysis.mainTopics,
              complexity: analysis.complexity,
              suggestedQuestionCount: analysis.suggestedQuestionCount,
            },
            extractedContent,
          });
        }
      }

      return results;
    } catch (error) {
      console.error("❌ Erreur analyse workspace:", error);
      return [];
    }
  }

  /**
   * Analyse le contenu des pages/projets spécifiques pour la génération de quiz
   */
  private static async analyzePageProjectContent(
    options: PageProjectAnalysisOptions,
  ): Promise<WorkspaceAnalysisResult[]> {
    try {
      const results: WorkspaceAnalysisResult[] = [];

      for (const itemId of options.pageProjectIds) {
        console.log("📄 Analyse de l'item:", itemId);

        // D'abord, déterminer si c'est une page ou un projet
        const page = await prisma.page.findUnique({
          where: { id: itemId },
          include: {
            workspace: true,
            project: {
              select: { id: true, name: true },
            },
            // Le contenu est maintenant dans blockNoteContent (JSON)
            yjsDocument: options.includeBlocks,
          },
        });

        if (page) {
          // C'est une page individuelle
          await this.processPageContent(page, options, results);
          continue;
        }

        // Si ce n'est pas une page, vérifier si c'est un projet
        const project = await prisma.project.findUnique({
          where: { id: itemId },
          include: {
            workspace: true,
            pages: {
              where: {
                isArchived: false,
              },
              include: {
                // Le contenu est maintenant dans blockNoteContent (JSON)
                yjsDocument: options.includeBlocks,
              },
              take: options.maxPagesPerProject || 10,
            },
          },
        });

        if (project) {
          // C'est un projet - analyser toutes ses pages
          await this.processProjectContent(project, options, results);
        }
      }

      return results;
    } catch (error) {
      console.error("❌ Erreur analyse pages/projets:", error);
      return [];
    }
  }

  /**
   * Traite le contenu d'une page individuelle
   */
  private static async processPageContent(
    page: any,
    options: PageProjectAnalysisOptions,
    results: WorkspaceAnalysisResult[],
  ) {
    const extractedContent: WorkspaceAnalysisResult["extractedContent"] = [];
    let totalWords = 0;

    // Extraction du contenu de la page depuis blockNoteContent (JSON)
    let pageContent = "";
    if (page.blockNoteContent && typeof page.blockNoteContent === "object") {
      pageContent = this.extractTextFromBlockNoteContent(page.blockNoteContent);
      if (
        pageContent &&
        pageContent.length >= (options.minContentLength || 100)
      ) {
        totalWords += pageContent.split(/\s+/).length;
      }
    }

    if (pageContent.trim()) {
      extractedContent.push({
        pageId: page.id,
        title: page.title || "Page sans titre",
        content: pageContent.trim(),
        relevanceScore: 1.0, // Score maximal pour une page explicitement sélectionnée
      });
    }

    // Analyse du contenu via IA si suffisant
    if (extractedContent.length > 0) {
      const contentForAnalysis = extractedContent
        .map((c) => c.content)
        .join("\n\n");

      const analysis = await AIQuizService.analyzeWorkspaceContent(
        contentForAnalysis,
        page.title || "Page sélectionnée",
        options.schoolLevel || SchoolLevel.LYCEE_PREMIERE, // Utilise le niveau fourni ou valeur par défaut
      );

      results.push({
        workspaceId: page.workspace.id,
        workspaceName: `${page.title}${page.project ? ` (${page.project.name})` : ""}`,
        totalPages: 1,
        analyzedPages: 1,
        contentSummary: {
          totalWords,
          mainTopics: analysis.mainTopics,
          complexity: analysis.complexity,
          suggestedQuestionCount: analysis.suggestedQuestionCount,
        },
        extractedContent,
      });
    }
  }

  /**
   * Traite le contenu d'un projet entier (récursivement pour les projets imbriqués)
   */
  private static async processProjectContent(
    project: any,
    options: PageProjectAnalysisOptions,
    results: WorkspaceAnalysisResult[],
  ) {
    const extractedContent: WorkspaceAnalysisResult["extractedContent"] = [];
    let totalWords = 0;

    console.log(
      "📁 Analyse du projet:",
      project.name,
      "avec",
      project.pages.length,
      "pages",
    );

    // 🚀 Récupération RÉCURSIVE de toutes les pages (projet + sous-projets)
    const allPages = await this.getAllPagesRecursively(project.id);
    console.log(
      `📊 Total pages récupérées (incluant sous-projets): ${allPages.length}`,
    );

    // Extraction du contenu de toutes les pages (directes + des sous-projets)
    for (const page of allPages) {
      let pageContent = "";

      if (page.blockNoteContent && typeof page.blockNoteContent === "object") {
        pageContent = this.extractTextFromBlockNoteContent(
          page.blockNoteContent,
        );
        if (
          pageContent &&
          pageContent.length >= (options.minContentLength || 100)
        ) {
          totalWords += pageContent.split(/\s+/).length;
        }
      }

      if (pageContent && pageContent.trim()) {
        extractedContent.push({
          pageId: page.id,
          title: page.title || "Page sans titre",
          content: pageContent.trim(),
          relevanceScore: 1.0, // Score maximal pour un projet explicitement sélectionné
        });
      }
    }

    // Analyse du contenu via IA si suffisant
    if (extractedContent.length > 0) {
      const contentForAnalysis = extractedContent
        .slice(0, 5) // Limite pour l'analyse IA (projets peuvent être volumineux)
        .map((c) => c.content)
        .join("\n\n");

      const analysis = await AIQuizService.analyzeWorkspaceContent(
        contentForAnalysis,
        project.name,
        options.schoolLevel || SchoolLevel.LYCEE_PREMIERE, // Utilise le niveau fourni ou valeur par défaut
      );

      results.push({
        workspaceId: project.workspace.id,
        workspaceName: `${project.name} (Projet)`,
        totalPages: allPages.length, // 🚀 Compte total incluant sous-projets
        analyzedPages: extractedContent.length,
        contentSummary: {
          totalWords,
          mainTopics: analysis.mainTopics,
          complexity: analysis.complexity,
          suggestedQuestionCount: analysis.suggestedQuestionCount,
        },
        extractedContent,
      });
    }
  }

  /**
   * 🚀 Récupère récursivement toutes les pages d'un projet et de ses enfants
   */
  private static async getAllPagesRecursively(
    projectId: string,
  ): Promise<any[]> {
    const allPages: any[] = [];

    // Récupérer le projet avec ses pages et ses enfants
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        pages: {
          where: { isArchived: false },
          select: {
            id: true,
            title: true,
            blockNoteContent: true,
          },
        },
        children: {
          where: { isArchived: false },
          select: { id: true },
        },
      },
    });

    if (!project) return allPages;

    // Ajouter les pages directes du projet
    allPages.push(...project.pages);

    // Récupérer récursivement les pages des sous-projets
    for (const child of project.children) {
      const childPages = await this.getAllPagesRecursively(child.id);
      allPages.push(...childPages);
    }

    return allPages;
  }

  /**
   * Extrait le contenu textuel depuis le format BlockNote JSON
   */
  private static extractTextFromBlockNoteContent(
    blockNoteContent: any,
  ): string {
    if (!blockNoteContent || typeof blockNoteContent !== "object") {
      return "";
    }

    let extractedText = "";

    // BlockNote structure: array of blocks ou objet avec content
    const content = Array.isArray(blockNoteContent)
      ? blockNoteContent
      : blockNoteContent.content;

    if (!content || !Array.isArray(content)) {
      return "";
    }

    const extractTextFromBlock = (block: any): string => {
      let text = "";

      if (!block || typeof block !== "object") {
        return text;
      }

      // Extraire le text content si disponible
      if (block.content && Array.isArray(block.content)) {
        for (const contentItem of block.content) {
          if (
            contentItem &&
            typeof contentItem === "object" &&
            contentItem.text
          ) {
            text += contentItem.text;
          }
        }
      }

      // Ajouter une ligne vide entre les blocs
      if (text.trim()) {
        text += "\n\n";
      }

      // Traiter les blocs enfants (nested blocks)
      if (block.children && Array.isArray(block.children)) {
        for (const child of block.children) {
          text += extractTextFromBlock(child);
        }
      }

      return text;
    };

    // Extraire le texte de tous les blocs
    for (const block of content) {
      extractedText += extractTextFromBlock(block);
    }

    return extractedText.trim();
  }

  /**
   * Calcule les statistiques de progression d'un utilisateur
   */
  static async getUserProgressStats(
    userId: string,
  ): Promise<UserProgressStats> {
    try {
      // Récupération des quiz complétés
      const completedQuizzes = await prisma.quiz.findMany({
        where: {
          userId,
          isCompleted: true,
        },
        include: {
          result: true,
          template: true,
        },
        orderBy: { completedAt: "desc" },
      });

      if (!completedQuizzes.length) {
        return {
          userId,
          totalQuizzes: 0,
          averageScore: 0,
          bestScore: 0,
          recentScores: [],
          subjectPerformance: {},
          difficultyPerformance: {
            facile: { averageScore: 0, count: 0 },
            moyen: { averageScore: 0, count: 0 },
            difficile: { averageScore: 0, count: 0 },
          },
          timeAnalytics: {
            averageQuizTime: 0,
            averageTimePerQuestion: 0,
            efficiency: 0,
          },
        };
      }

      // Calculs statistiques
      const scores = completedQuizzes.map(
        (q: any) => q.result?.percentage || 0,
      );
      const averageScore =
        scores.reduce((sum: number, score: number) => sum + score, 0) /
        scores.length;
      const bestScore = Math.max(...scores);
      const recentScores = scores.slice(0, 10);

      // Analyse par temps
      const totalTime = completedQuizzes.reduce(
        (sum: number, q: any) => sum + (q.timeSpent || 0),
        0,
      );
      const averageQuizTime = totalTime / completedQuizzes.length;
      const totalQuestions = completedQuizzes.reduce((sum: number, q: any) => {
        const questions = (q.questions as any[]) || [];
        return sum + questions.length;
      }, 0);
      const averageTimePerQuestion =
        totalQuestions > 0 ? totalTime / totalQuestions : 0;

      const stats: UserProgressStats = {
        userId,
        totalQuizzes: completedQuizzes.length,
        averageScore,
        bestScore,
        recentScores,
        subjectPerformance: {}, // TODO: Implémenter selon les catégories
        difficultyPerformance: {
          facile: { averageScore: 0, count: 0 },
          moyen: { averageScore: 0, count: 0 },
          difficile: { averageScore: 0, count: 0 },
        },
        timeAnalytics: {
          averageQuizTime,
          averageTimePerQuestion,
          efficiency: averageScore / (averageTimePerQuestion || 1),
        },
      };

      return stats;
    } catch (error) {
      console.error("❌ Erreur calcul statistiques:", error);
      throw new Error("Impossible de calculer les statistiques de progression");
    }
  }

  // ======================================
  // MÉTHODES POUR LES SÉQUENCES DE QUIZ
  // ======================================

  /**
   * Crée une nouvelle séquence de quiz selon le preset
   */
  static async startPresetSequence(options: SequenceCreationOptions): Promise<{
    sequenceId: string;
    config: SequentialQuizConfig;
    firstQuizId?: string;
  }> {
    try {
      console.log("🎯 Création séquence preset:", options.preset);

      // Création de la configuration séquentielle
      const config = await SequenceManager.createSequentialConfig(options);

      // 🔧 FIX: Sauvegarder la séquence en base de données pour l'historique
      const savedSequence = await prisma.quizSequence.create({
        data: {
          id: config.id,
          userId: options.userId,
          preset: config.preset,
          subjects: config.subjects as any, // Array d'ExamSubject
          currentSubjectIndex: config.currentSubjectIndex,
          totalSubjects: config.totalSubjects,
          isCompleted: false,
          subjectResults: config.subjectResults as any,
          specialties: options.specialties || [],
          higherEdField: options.higherEdField,
          metadata: {
            startedAt: config.metadata.startedAt,
            estimatedTotalTime: config.metadata.estimatedTotalTime,
            realTotalTime: config.metadata.realTotalTime,
          },
        },
      });

      // Sauvegarde AUSSI en stockage temporaire pour la compatibilité avec l'existant
      tempSequenceStorage.save(config);

      console.log("✅ Séquence créée et sauvegardée en base:", config.id);
      console.log("📋 Séquence prête pour génération manuelle");

      return {
        sequenceId: config.id,
        config,
        firstQuizId: undefined, // Pas de quiz généré automatiquement
      };
    } catch (error) {
      console.error("❌ Erreur création séquence:", error);
      throw new Error(
        `Impossible de créer la séquence: ${error instanceof Error ? error.message : "Erreur inconnue"}`,
      );
    }
  }

  /**
   * Récupère la configuration d'une séquence
   */
  static async getSequenceConfig(
    sequenceId: string,
    userId: string,
  ): Promise<SequentialQuizConfig> {
    try {
      // 1. D'abord essayer le stockage temporaire en mémoire
      let config = tempSequenceStorage.get(sequenceId);

      // 2. Si pas trouvé, récupérer depuis la base de données
      if (!config) {
        console.log(
          "🔄 Séquence non trouvée en cache, récupération depuis BDD:",
          sequenceId,
        );

        const dbSequence = await prisma.quizSequence.findUnique({
          where: {
            id: sequenceId,
            userId: userId, // Vérification de propriété directe
          },
        });

        if (!dbSequence) {
          throw new Error("Séquence introuvable ou accès non autorisé");
        }

        // Reconstituer la config depuis les données DB
        config = {
          id: dbSequence.id,
          preset: dbSequence.preset as QuizPreset,
          subjects: dbSequence.subjects as ExamSubject[],
          totalSubjects: dbSequence.totalSubjects,
          currentSubjectIndex: dbSequence.currentSubjectIndex,
          isCompleted: dbSequence.isCompleted,
          subjectResults: dbSequence.subjectResults as any[],
          globalScore: dbSequence.globalScore || 0,
          globalMaxScore: dbSequence.globalMaxScore || 0,
          metadata: (dbSequence.metadata as any) || {},
          specialties: (dbSequence.specialties as LyceeSpecialty[]) || [],
          higherEdField: dbSequence.higherEdField || undefined,
        };

        // Remettre en cache pour les prochains accès
        tempSequenceStorage.set(sequenceId, config);
        console.log("✅ Séquence rechargée en cache depuis BDD");
      }

      // Vérification de propriété pour les configs en cache
      if (!config) {
        throw new Error("Configuration de séquence introuvable");
      }

      if (!config.id.includes(userId)) {
        throw new Error("Accès non autorisé à cette séquence");
      }

      return config;
    } catch (error) {
      console.error("❌ Erreur récupération séquence:", error);
      throw new Error(
        `Impossible de récupérer la séquence: ${error instanceof Error ? error.message : "Erreur inconnue"}`,
      );
    }
  }

  /**
   * Synchronise une séquence avec la base de données
   */
  static async syncSequenceToDatabase(
    sequenceId: string,
    config: SequentialQuizConfig,
  ): Promise<void> {
    try {
      await prisma.quizSequence.update({
        where: { id: sequenceId },
        data: {
          currentSubjectIndex: config.currentSubjectIndex,
          isCompleted: config.isCompleted,
          subjectResults: config.subjectResults as any,
          globalScore: config.globalScore,
          globalMaxScore: config.globalMaxScore,
          updatedAt: new Date(),
          metadata: config.metadata
            ? {
                startedAt: config.metadata.startedAt,
                estimatedTotalTime: config.metadata.estimatedTotalTime,
                realTotalTime: config.metadata.realTotalTime,
              }
            : {},
        },
      });

      console.log(
        "✅ Séquence synchronisée avec la base de données:",
        sequenceId,
      );
    } catch (error) {
      console.error("❌ Erreur synchronisation séquence avec la base:", error);
      // Ne pas faire échouer l'opération principale, juste logguer l'erreur
    }
  }

  /**
   * Génère le quiz suivant dans la séquence (avec service parallèle automatique)
   */
  static async generateNextQuizInSequence(
    sequenceId: string,
    userId: string,
  ): Promise<{
    quizId: string;
    subject: ExamSubject;
    isLastQuiz: boolean;
    quiz?: any; // Quiz complet avec documents pour transmission frontend
  }> {
    try {
      console.log(
        "⚡ Génération quiz suivant pour séquence (service parallèle):",
        sequenceId,
      );

      // Récupération de la configuration de séquence
      const config = await this.getSequenceConfig(sequenceId, userId);

      if (config.isCompleted) {
        throw new Error("La séquence est déjà terminée");
      }

      // Vérifier si le quiz actuel est déjà généré
      const currentResult = config.subjectResults[config.currentSubjectIndex];
      if (currentResult?.quizId) {
        console.log("✅ Quiz déjà généré pour ce sujet:", currentResult.quizId);
        const fullQuiz = await this.getQuiz(currentResult.quizId, userId);
        const currentSubject = config.subjects[config.currentSubjectIndex];
        const isLastQuiz =
          config.currentSubjectIndex >= config.totalSubjects - 1;

        return {
          quizId: currentResult.quizId,
          subject: currentSubject,
          isLastQuiz,
          quiz: fullQuiz,
        };
      }

      // Marquer immédiatement la génération en cours
      const generatingConfig = { ...config };
      if (currentResult) {
        currentResult.isGenerating = true;
      }
      tempSequenceStorage.update(sequenceId, generatingConfig);
      await this.syncSequenceToDatabase(sequenceId, generatingConfig);

      try {
        // 🚀 APPROCHE SIMPLIFIÉE: Utiliser l'assistant standard avec les nouvelles fonctions Wikipedia
        console.log(
          "⚡ Utilisation de l'assistant standard avec API Wikipedia...",
        );

        // Générer uniquement le quiz actuel (pas de pré-génération pour éviter complexité)
        const currentSubject = config.subjects[config.currentSubjectIndex];
        console.log(`📚 Génération du quiz pour: ${currentSubject}`);

        // Déterminer si le sujet doit inclure des documents Wikipedia
        const shouldIncludeDocuments =
          this.shouldSubjectIncludeDocuments(currentSubject);
        console.log(
          `📋 Sujet "${currentSubject}": includeDocuments = ${shouldIncludeDocuments}`,
        );

        // Génération du processId pour cette génération spécifique
        const processId = `quiz_generation_${sequenceId}_${config.currentSubjectIndex}`;
        progressService.registerProcessOwner(processId, userId);
        console.log(
          `🎯 Génération quiz séquentiel avec processId: ${processId}`,
        );

        // Utiliser le générateur spécialisé du preset pour inclure TOUTES les configs (documents + graphiques)
        const generationRequest = SequenceManager.generateCurrentSubjectRequest(
          config,
          [],
        );

        const assistantResult = await AIQuizService.generateQuiz(
          generationRequest,
          processId,
        );

        // Convertir le résultat unique en format array pour compatibilité
        const parallelResults = [
          {
            subject: currentSubject,
            quiz: assistantResult, // assistantResult contient déjà le quiz complet
            generatedBy: "assistant1" as const,
            generationTime: Date.now(),
            error: null,
          },
        ];

        let currentQuizId = "";
        let currentQuizData: any = null;

        // Traiter les résultats et sauvegarder en base
        for (let i = 0; i < parallelResults.length; i++) {
          const result = parallelResults[i];
          const subjectIndex = config.currentSubjectIndex + i;
          const subject = config.subjects[subjectIndex];

          if (!result.error && result.quiz) {
            try {
              // Sauvegarder le quiz généré en base de données
              const quizId = await this.saveGeneratedQuizToDatabase(
                userId,
                result.quiz,
                {
                  sequenceId,
                  sequenceOrder: subjectIndex,
                  preset: config.preset,
                  subject: subject,
                },
              );

              // Le premier quiz est celui qu'on va retourner
              if (i === 0) {
                currentQuizId = quizId;
                currentQuizData = result.quiz;
              }

              // Marquer le sujet comme généré dans la configuration
              let updatedConfig = await this.getSequenceConfig(
                sequenceId,
                userId,
              );
              if (updatedConfig.subjectResults[subjectIndex]) {
                updatedConfig.subjectResults[subjectIndex].quizId = quizId;
                updatedConfig.subjectResults[subjectIndex].isGenerating = false;
              }
              tempSequenceStorage.update(sequenceId, updatedConfig);
              await this.syncSequenceToDatabase(sequenceId, updatedConfig);

              console.log(
                `✅ Quiz sauvé via service parallèle: ${quizId} pour ${subject} (${result.generatedBy}, ${result.generationTime}ms)`,
              );
            } catch (saveError) {
              console.error(
                `❌ Erreur sauvegarde quiz parallèle pour ${subject}:`,
                saveError,
              );
              if (i === 0) {
                throw saveError; // Échec du quiz principal, propager l'erreur
              }
            }
          } else {
            console.error(
              `❌ Échec génération parallèle pour ${subject}:`,
              result.error,
            );
            if (i === 0) {
              throw new Error(
                `Échec génération du quiz principal: ${result.error}`,
              );
            }
          }
        }

        if (!currentQuizId) {
          throw new Error("Aucun quiz généré par le service parallèle");
        }

        // Mettre à jour la configuration avec le quiz principal
        const finalConfig = SequenceManager.markQuizGenerated(
          config,
          currentQuizId,
        );
        tempSequenceStorage.update(sequenceId, finalConfig);
        await this.syncSequenceToDatabase(sequenceId, finalConfig);

        // Récupérer le quiz complet pour transmission frontend
        const fullQuiz = await this.getQuiz(currentQuizId, userId);
        console.log("🔍 DEBUG: Quiz récupéré pour transmission:", {
          hasSourceDocuments: !!fullQuiz.sourceDocuments,
          sourceDocumentsLength: fullQuiz.sourceDocuments?.length,
          quizId: fullQuiz.id,
          generatedBy: parallelResults[0]?.generatedBy,
          generationTime: parallelResults[0]?.generationTime,
        });

        const isLastQuiz =
          config.currentSubjectIndex >= config.totalSubjects - 1;

        const successCount = parallelResults.filter((r) => !r.error).length;
        console.log(
          `⚡ Génération parallèle terminée: ${successCount}/${parallelResults.length} quiz générés`,
        );
        console.log(
          `✅ Quiz principal retourné: ${currentQuizId} pour matière: ${parallelResults[0]?.subject}`,
        );

        return {
          quizId: currentQuizId,
          subject: parallelResults[0]?.subject,
          isLastQuiz,
          quiz: fullQuiz,
        };
      } catch (generationError) {
        // En cas d'erreur, remettre isGenerating à false
        const errorConfig = await this.getSequenceConfig(sequenceId, userId);
        const currentResult =
          errorConfig.subjectResults[config.currentSubjectIndex];
        if (currentResult) {
          currentResult.isGenerating = false;
        }
        tempSequenceStorage.update(sequenceId, errorConfig);

        try {
          await this.syncSequenceToDatabase(sequenceId, errorConfig);
        } catch (syncError) {
          console.error(
            "❌ Erreur synchronisation après échec génération:",
            syncError,
          );
        }

        console.error(
          "❌ Échec service parallèle, tentative de fallback vers génération classique...",
        );

        // FALLBACK: Si le service parallèle échoue, utiliser l'ancienne méthode
        try {
          const quizRequest = SequenceManager.generateCurrentSubjectRequest(
            config,
            [],
          );
          const quizId = await this.generateQuiz(quizRequest, {
            sequenceId: sequenceId,
            sequenceOrder: config.currentSubjectIndex,
          });

          const updatedConfig = SequenceManager.markQuizGenerated(
            config,
            quizId,
          );
          tempSequenceStorage.update(sequenceId, updatedConfig);
          await this.syncSequenceToDatabase(sequenceId, updatedConfig);

          const fullQuiz = await this.getQuiz(quizId, userId);
          const currentSubject = config.subjects[config.currentSubjectIndex];
          const isLastQuiz =
            config.currentSubjectIndex >= config.totalSubjects - 1;

          console.log(
            "✅ Fallback réussi - Quiz généré via méthode classique:",
            quizId,
          );
          return {
            quizId,
            subject: currentSubject,
            isLastQuiz,
            quiz: fullQuiz,
          };
        } catch (fallbackError) {
          console.error("❌ Échec du fallback également:", fallbackError);
          throw new Error(
            `Échec génération (parallèle et fallback): ${generationError instanceof Error ? generationError.message : "Erreur inconnue"}`,
          );
        }
      }
    } catch (error) {
      console.error(
        "❌ Erreur génération quiz séquentiel (service parallèle):",
        error,
      );
      throw new Error(
        `Impossible de générer le quiz suivant: ${error instanceof Error ? error.message : "Erreur inconnue"}`,
      );
    }
  }

  /**
   * Soumet un quiz dans une séquence et gère la progression
   */
  static async submitSequentialQuiz(
    sequenceId: string,
    quizId: string,
    userId: string,
    userAnswers: UserAnswer[],
    sourceDocuments?: any[],
    hasDocuments?: boolean,
  ): Promise<{
    result: any;
    nextQuizGenerated: boolean;
    isSequenceCompleted: boolean;
    nextQuizId?: string;
  }> {
    try {
      console.log("📝 Soumission quiz séquentiel:", quizId);

      // Récupération de la configuration
      const config = await this.getSequenceConfig(sequenceId, userId);

      // Marquer la correction en cours IMMÉDIATEMENT
      const correctionConfig = SequenceManager.markCorrectionInProgress(config);
      tempSequenceStorage.update(sequenceId, correctionConfig);

      // 🔧 FIX: Synchroniser avec la base de données
      await this.syncSequenceToDatabase(sequenceId, correctionConfig);

      // Retourner immédiatement un résultat temporaire avec le statut "correction en cours"
      const tempResult = {
        id: "temp_correction",
        quizId: quizId,
        totalScore: 0,
        maxScore: 0,
        percentage: 0,
        adaptedGrade: 0,
        detailedScoring: [],
        aiCorrection: {
          summary: "Correction en cours...",
          strengths: [],
          weaknesses: [],
          recommendations: [],
        },
        recommendations: [],
        createdAt: new Date().toISOString(),
        isCorrectingInProgress: true,
        isSequenceCompleted: false,
      };

      // Générer le processId pour la correction
      const currentSubjectIndex = config.currentSubjectIndex;
      const correctionProcessId = `quiz_correction_${sequenceId}_${currentSubjectIndex}`;
      progressService.registerProcessOwner(correctionProcessId, userId);

      // Lancer la correction en arrière-plan (sans attendre)
      this.processCorrectionInBackground(
        sequenceId,
        quizId,
        userId,
        userAnswers,
        sourceDocuments,
        hasDocuments,
        correctionProcessId,
      );

      console.log("✅ Quiz séquentiel soumis, correction en arrière-plan");
      return {
        result: tempResult,
        nextQuizGenerated: false,
        isSequenceCompleted: false,
        nextQuizId: undefined,
      };
    } catch (error) {
      console.error("❌ Erreur soumission quiz séquentiel:", error);
      throw new Error(
        `Impossible de soumettre le quiz séquentiel: ${error instanceof Error ? error.message : "Erreur inconnue"}`,
      );
    }
  }

  /**
   * Traite la correction en arrière-plan (méthode privée)
   */
  private static async processCorrectionInBackground(
    sequenceId: string,
    quizId: string,
    userId: string,
    userAnswers: UserAnswer[],
    sourceDocuments?: any[],
    hasDocuments?: boolean,
    processId?: string,
  ): Promise<void> {
    try {
      console.log("🔄 Début correction en arrière-plan pour quiz:", quizId);

      // Soumission et correction du quiz avec processId
      const result = await this.submitQuiz(
        quizId,
        userId,
        userAnswers,
        sourceDocuments,
        hasDocuments,
        processId,
      );

      // Récupération de la configuration mise à jour
      const config = await this.getSequenceConfig(sequenceId, userId);

      // Mise à jour de la séquence avec les résultats
      const updatedConfig = SequenceManager.markQuizSubmitted(config, result);

      // Sauvegarde finale dans le stockage temporaire
      tempSequenceStorage.update(sequenceId, updatedConfig);

      // 🔧 FIX: Synchroniser avec la base de données
      await this.syncSequenceToDatabase(sequenceId, updatedConfig);

      console.log("✅ Correction en arrière-plan terminée pour quiz:", quizId);
    } catch (error) {
      console.error("❌ Erreur correction en arrière-plan:", error);

      // En cas d'erreur, marquer comme non en cours de correction
      try {
        const config = await this.getSequenceConfig(sequenceId, userId);
        const currentResult = config.subjectResults[config.currentSubjectIndex];
        if (currentResult) {
          currentResult.isCorrecting = false;
        }
        tempSequenceStorage.update(sequenceId, config);

        // 🔧 FIX: Synchroniser avec la base de données même en cas d'erreur
        try {
          await this.syncSequenceToDatabase(sequenceId, config);
        } catch (syncError) {
          console.error(
            "❌ Erreur synchronisation après échec correction:",
            syncError,
          );
        }
      } catch (updateError) {
        console.error(
          "❌ Erreur mise à jour config après échec correction:",
          updateError,
        );
      }
    }
  }

  /**
   * Récupère les résultats complets d'une séquence
   */
  static async getSequenceResults(
    sequenceId: string,
    userId: string,
  ): Promise<{
    globalScore: number;
    globalMaxScore: number;
    globalPercentage: number;
    mention?: string;
    subjectResults: Array<{
      subject: ExamSubject;
      score: number;
      maxScore: number;
      percentage: number;
      timeSpent: number;
    }>;
    metadata: {
      totalTimeSpent: number;
      completedAt: string;
    };
  }> {
    try {
      const config = await this.getSequenceConfig(sequenceId, userId);

      if (!config.isCompleted) {
        throw new Error("La séquence n'est pas encore terminée");
      }

      // Calcul des scores globaux
      const globalScore = SequenceManager.calculateGlobalScore(config);

      // Formatage des résultats par matière
      const subjectResults = config.subjectResults
        .filter((result) => result.isCompleted)
        .map((result) => ({
          subject: result.subject,
          score: result.score || 0,
          maxScore: result.maxScore || 0,
          percentage: result.percentage || 0,
          timeSpent: result.timeSpent || 0,
        }));

      return {
        globalScore: globalScore.totalScore,
        globalMaxScore: globalScore.maxScore,
        globalPercentage: Math.round(
          (globalScore.totalScore / globalScore.maxScore) * 100,
        ),
        mention: globalScore.mention,
        subjectResults,
        metadata: {
          totalTimeSpent: config.metadata.realTotalTime || 0,
          completedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      console.error("❌ Erreur récupération résultats séquence:", error);
      throw new Error(
        `Impossible de récupérer les résultats: ${error instanceof Error ? error.message : "Erreur inconnue"}`,
      );
    }
  }

  /**
   * Sauvegarde un quiz généré en base de données
   * Helper method pour la génération parallèle
   */
  private static async saveGeneratedQuizToDatabase(
    userId: string,
    generatedQuiz: any,
    options: {
      sequenceId?: string;
      sequenceOrder?: number;
      preset?: string;
      subject?: string;
    } = {},
  ): Promise<string> {
    // Cette méthode reprend la logique de sauvegarde de generateQuiz
    // mais adaptée pour les quiz pré-générés en parallèle

    const quiz = await prisma.quiz.create({
      data: {
        userId,
        title: generatedQuiz.title || `Quiz ${options.subject || "Généré"}`,
        questions:
          generatedQuiz.questions ||
          generatedQuiz.subjects?.[0]?.questions ||
          [],
        sourceDocuments:
          generatedQuiz.documents ||
          generatedQuiz.sourceDocuments ||
          generatedQuiz.subject?.documents ||
          [],
        hasDocuments: !!(
          (generatedQuiz.documents && generatedQuiz.documents.length > 0) ||
          (generatedQuiz.sourceDocuments &&
            generatedQuiz.sourceDocuments.length > 0) ||
          (generatedQuiz.subject?.documents &&
            generatedQuiz.subject.documents.length > 0)
        ),
        preset: (options.preset as QuizPreset) || QuizPreset.NONE,
        sequenceId: options.sequenceId,
        sequenceOrder: options.sequenceOrder,
        isCompleted: false,
        schoolLevel: SchoolLevel.ETUDES_SUPERIEURES, // Default value as it's required
      },
    });

    console.log(
      `💾 Quiz sauvegardé: ${quiz.id} pour séquence ${options.sequenceId}`,
    );
    return quiz.id;
  }

  // ===== FIN DES MÉTHODES DE GÉNÉRATION PARALLÈLE =====

  /**
   * 🛠️ CORRECTION: Reconstitue les propriétés graphiques perdues lors de la désérialisation
   * Remplace les valeurs null/vides par les vraies données depuis la base/cache
   */
  private static reconstructGraphicProperties(rawQuestions: any[]): Question[] {
    return rawQuestions.map((question: any) => {
      if (question.hasGraphic && question.graphicId) {
        // Si les propriétés sont vides/null, tenter de les récupérer
        if (
          !question.graphicConfig ||
          !question.graphicDescription ||
          !question.graphicDataValues?.length
        ) {
          console.log(
            `🔧 [RECONSTRUCT] Question ${question.id} - propriétés graphiques manquantes, tentative de récupération...`,
          );

          // TODO: Ici on pourrait appeler un service pour récupérer les vraies données graphiques
          // Pour l'instant, on reconstruit avec des valeurs par défaut intelligentes

          // Analyser la question pour deviner le type de graphique
          const questionText = question.question?.toLowerCase() || "";
          let estimatedConfig = null;
          let estimatedDescription = "";
          let estimatedDataValues: number[] = [];

          if (
            questionText.includes("quadratique") ||
            questionText.includes("x^2") ||
            questionText.includes("parabole")
          ) {
            // Graphique quadratique
            estimatedDescription =
              "Graphique représentant une fonction quadratique y = x²";
            estimatedDataValues = [0, 1, 4, 9, 16, 25]; // Valeurs de x² pour x=0,1,2,3,4,5
            estimatedConfig = {
              chart: { type: "line", height: 350 },
              series: [
                {
                  name: "y = x²",
                  data: [
                    [-3, 9],
                    [-2, 4],
                    [-1, 1],
                    [0, 0],
                    [1, 1],
                    [2, 4],
                    [3, 9],
                  ],
                },
              ],
              xaxis: { title: { text: "x" } },
              yaxis: { title: { text: "y" } },
              title: { text: "Fonction quadratique y = x²", align: "center" },
              stroke: { curve: "smooth" },
            };
          } else if (
            questionText.includes("minimum") ||
            questionText.includes("maximum")
          ) {
            // Graphique d'optimisation
            estimatedDescription =
              "Graphique montrant les extremums d'une fonction";
            estimatedDataValues = [0, 1, 4, 9, 16];
            estimatedConfig = {
              chart: { type: "line", height: 350 },
              series: [
                {
                  name: "f(x)",
                  data: [
                    [0, 0],
                    [1, 1],
                    [2, 4],
                    [3, 9],
                    [4, 16],
                  ],
                },
              ],
              title: { text: "Analyse des extremums", align: "center" },
            };
          }

          return {
            ...question,
            graphicConfig: estimatedConfig,
            graphicDescription: estimatedDescription,
            graphicDataValues: estimatedDataValues,
            graphicType: question.graphicType || "2d",
            graphicLibrary: question.graphicLibrary || "apexcharts",
          };
        }
      }

      return question;
    });
  }

  /**
   * 🛠️ CORRECTION: Nettoie les propriétés graphiques undefined avant sauvegarde JSON
   * Remplace undefined par des valeurs par défaut pour éviter la perte de données
   */
  private static cleanGraphicPropertiesForSave(subjects: any[]): any[] {
    return subjects.map((subject) => ({
      ...subject,
      questions: subject.questions.map((question: any) => {
        if (question.hasGraphic) {
          return {
            ...question,
            // 🔧 Remplacer undefined par des valeurs par défaut
            graphicConfig: question.graphicConfig || null, // undefined → null
            graphicDescription: question.graphicDescription || "", // undefined → chaîne vide
            graphicDataValues: question.graphicDataValues || [], // undefined → array vide
            graphicType: question.graphicType || "2d", // undefined → '2d'
            graphicLibrary: question.graphicLibrary || "apexcharts", // undefined → 'apexcharts'
            graphicId: question.graphicId || `graphic_${Date.now()}`, // undefined → ID généré
          };
        }
        return question;
      }),
    }));
  }

  /**
   * 🔍 Détermine si un sujet doit inclure des documents Wikipedia
   * Logique basée sur les matières qui bénéficient de documents littéraires/historiques
   */
  private static shouldSubjectIncludeDocuments(subject: string): boolean {
    return shouldIncludeDocumentsForSubject(subject);
  }
}
