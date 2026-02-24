import { logger } from "../../utils/logger.js";
import {
  SchoolLevel,
  CollegeGrade,
  LyceeSpecialty,
  QuestionType,
  Question,
  QuizGenerationRequest,
  QuizCorrectionRequest,
  QuizCorrectionResult,
  GeneratedQuiz,
  UserAnswer,
  WorkspaceAnalysisResult,
  MultipleChoiceQuestion,
} from "./types.js";

// Import du service Quiz (Chat Completion uniquement)
import { OpenAIAssistantService } from "./assistant/index.js";
// Import des types depuis le module assistant
import type { GraphicData } from "./assistant/types/index.js";
// Import des modules refactorisés (fallback)
import { QuizGenerator, CorrectionGenerator, WorkspaceAnalyzer } from "./generators/index.js";
import { PromptUtils } from "./utils/index.js";
import { progressService } from "../progressService.js";

/** Référence documentaire simplifiée pour la correction */
interface DocumentReferenceLocal {
  reference: string;
  questionId: string;
}

/** Capacités de correction détectées */
interface CorrectionCapabilities {
  hasGraphics: boolean;
  hasDocuments: boolean;
  useFileUpload: boolean;
  graphicsData: GraphicData[];
  documentsData: DocumentReferenceLocal[];
}

/** Correction individuelle d'une question (résultat Assistant) */
interface QuestionCorrectionFromAssistant {
  questionId?: string;
  isCorrect?: boolean;
  pointsObtained?: number;
  pointsTotal?: number;
  userAnswer?: string;
  correctAnswer?: string;
  explanation?: string;
  feedback?: string;
}

/** Score global du résultat Assistant */
interface GlobalScoreFromAssistant {
  pointsObtained?: number;
  pointsTotal?: number;
}

/** Résultat de correction retourné par l'Assistant */
interface AssistantCorrectionResult {
  corrections?: QuestionCorrectionFromAssistant[];
  globalScore?: GlobalScoreFromAssistant;
  globalFeedback?: string;
  recommendations?: string[];
  strengths?: string[];
  weaknesses?: string[];
  correctionType?: string;
  graphicCompetencies?: unknown;
  documentaryCompetencies?: unknown;
}

/** Résultat transformé d'une question */
interface TransformedQuestionResult {
  questionId: string;
  isCorrect: boolean;
  userAnswer: string;
  correctAnswer: string;
  explanation: string;
  score: number;
  maxScore: number;
  feedback: string;
  difficulty: string;
}

/**
 * Service d'intégration IA spécialisé pour le système de quiz
 * ✅ MIGRÉ vers OpenAI Assistant avec détection automatique
 */
export class AIQuizService {
  /**
   * Génère un quiz complet basé sur les paramètres
   * ✅ MIGRÉ - Utilise maintenant OpenAI Assistant avec détection intelligente
   * 🆕 PARALLÈLE - Option de génération avec 2 assistants pour plus de questions
   * 📊 PROGRESSION - Envoie des mises à jour de progression en temps réel via WebSocket
   */
  static async generateQuiz(
    request: QuizGenerationRequest,
    processId?: string,
  ): Promise<GeneratedQuiz> {
    logger.log("🎯 AIQuizService.generateQuiz()");

    // Initialisation de la progression
    if (processId && progressService.hasActiveConnection(processId)) {
      progressService.sendProgress(processId, {
        percentage: 0,
        stage: "initialization",
        message: "Initialisation de la génération...",
      });
    }

    try {
      // Progression : Analyse de la requête
      if (processId && progressService.hasActiveConnection(processId)) {
        progressService.sendProgress(processId, {
          percentage: 5,
          stage: "analysis",
          message: "Analyse de la requête de génération...",
        });
      }

      // Utilisation du générateur standard (le streaming est maintenant utilisé via generateSingleQuestion)
      logger.log("📦 Utilisation du générateur de quiz standard");

      // Progression : Génération
      if (processId && progressService.hasActiveConnection(processId)) {
        progressService.sendProgress(processId, {
          percentage: 30,
          stage: "generation",
          message: "Génération du quiz...",
        });
      }

      return QuizGenerator.generateQuiz(request);
    } catch (error) {
      logger.error("❌ Erreur génération quiz:", error);

      // Progression : Erreur
      if (processId && progressService.hasActiveConnection(processId)) {
        progressService.sendError(processId, `Erreur de génération: ${error}`);
      }

      // Fallback en cas d'erreur
      return QuizGenerator.generateQuiz(request);
    }
  }

  /**
   * Génère un quiz basé sur le contenu d'un workspace
   * @deprecated Utilisez QuizGenerator.generateQuizFromWorkspace() directement
   */
  static async generateQuizFromWorkspace(
    request: QuizGenerationRequest,
    workspaceContent: WorkspaceAnalysisResult[],
    ragContext?: string,
  ): Promise<GeneratedQuiz> {
    return QuizGenerator.generateQuizFromWorkspace(request, workspaceContent, ragContext);
  }

  /**
   * Corrige un quiz avec l'IA
   * ✅ MIGRÉ - Utilise maintenant OpenAI Assistant avec détection intelligente
   * 📊 PROGRESSION - Envoie des mises à jour de progression en temps réel via WebSocket
   */
  static async correctQuiz(
    questions: Question[],
    userAnswers: UserAnswer[],
    request: QuizCorrectionRequest,
    processId?: string,
  ): Promise<QuizCorrectionResult> {
    logger.log("🎯 AIQuizService.correctQuiz() - Migration vers Assistant");

    // Progression : Initialisation correction
    if (processId && progressService.hasActiveConnection(processId)) {
      progressService.sendProgress(processId, {
        percentage: 0,
        stage: "correction_init",
        message: "Initialisation de la correction...",
      });
    }

    try {
      // Progression : Analyse des réponses
      if (processId && progressService.hasActiveConnection(processId)) {
        progressService.sendProgress(processId, {
          percentage: 10,
          stage: "response_analysis",
          message: "Analyse des réponses utilisateur...",
        });
      }

      // PRIORITÉ: Si coursesOnly est activé, utiliser le CorrectionGenerator pour une correction stricte
      if (request.coursesOnly && request.workspaceContent && request.workspaceContent.length > 0) {
        logger.log(
          "📚 Mode coursesOnly détecté - Utilisation du CorrectionGenerator pour correction stricte",
        );

        // Progression : Correction basée sur les cours
        if (processId && progressService.hasActiveConnection(processId)) {
          progressService.sendProgress(processId, {
            percentage: 30,
            stage: "courses_only_correction",
            message: "Correction basée uniquement sur le contenu de vos cours...",
          });
        }

        // Utiliser directement le CorrectionGenerator pour une correction stricte
        return CorrectionGenerator.correctQuiz(questions, userAnswers, request);
      }

      // Détection automatique du type de correction nécessaire (pour les autres cas)
      const correctionCapabilities = this.detectCorrectionCapabilities(questions);
      logger.log("🔍 Correction - Capacités détectées:", correctionCapabilities);

      const assistantService = new OpenAIAssistantService();
      let assistantResult: AssistantCorrectionResult;

      // Progression : Sélection du type de correction
      if (processId && progressService.hasActiveConnection(processId)) {
        progressService.sendProgress(processId, {
          percentage: 20,
          stage: "correction_type",
          message: "Sélection du type de correction...",
        });
      }

      // Choix de la méthode de correction Assistant appropriée
      if (correctionCapabilities.hasGraphics && correctionCapabilities.hasDocuments) {
        // Progression : Correction complète
        if (processId && progressService.hasActiveConnection(processId)) {
          progressService.sendProgress(processId, {
            percentage: 30,
            stage: "complete_correction",
            message: "Correction avancée avec graphiques et documents...",
          });
        }

        logger.log("🚀 Correction complète: graphiques + documents via Chat Completion");
        assistantResult = await assistantService.correctWithRetry(
          () =>
            assistantService.correctCompleteQuizChatCompletion(
              request.quizId || "quiz",
              userAnswers,
              {
                graphicsData: correctionCapabilities.graphicsData,
                documentsData: undefined,
                documentReferences: correctionCapabilities.documentsData,
                correctionType: "complete",
                questions: questions.map((q) => ({
                  id: q.id,
                  question: q.question,
                  type: q.type,
                  options: "options" in q ? q.options : undefined,
                })),
                schoolLevel: request.schoolLevel,
                collegeGrade: request.collegeGrade,
              },
            ),
          `Complete Correction (Chat Completion): ${request.quizId}`,
        );
      } else if (correctionCapabilities.hasDocuments) {
        if (correctionCapabilities.useFileUpload) {
          // Progression : Correction avec documents
          if (processId && progressService.hasActiveConnection(processId)) {
            progressService.sendProgress(processId, {
              percentage: 35,
              stage: "document_correction",
              message: "Correction basée sur les documents...",
            });
          }

          logger.log("🚀 Correction documents avec File Upload via Chat Completion");
          assistantResult = await assistantService.correctWithRetry(
            () =>
              assistantService.correctCompleteQuizChatCompletion(
                request.quizId || "quiz",
                userAnswers,
                {
                  graphicsData: [],
                  documentsData: undefined,
                  documentReferences: correctionCapabilities.documentsData,
                  correctionType: "documents_files",
                  questions: questions.map((q) => ({
                    id: q.id,
                    question: q.question,
                    type: q.type,
                    options: "options" in q ? q.options : undefined,
                  })),
                  schoolLevel: request.schoolLevel,
                  collegeGrade: request.collegeGrade,
                },
              ),
            `Documents Correction (Chat Completion): ${request.quizId}`,
          );
        } else {
          // Progression : Correction documents standard
          if (processId && progressService.hasActiveConnection(processId)) {
            progressService.sendProgress(processId, {
              percentage: 32,
              stage: "standard_document_correction",
              message: "Correction avec documents intégrés...",
            });
          }

          logger.log("🚀 Correction documents standard via Chat Completion");
          assistantResult = await assistantService.correctWithRetry(
            () =>
              assistantService.correctCompleteQuizChatCompletion(
                request.quizId || "quiz",
                userAnswers,
                {
                  graphicsData: [],
                  documentsData: undefined,
                  documentReferences: correctionCapabilities.documentsData,
                  correctionType: "documents",
                  questions: questions.map((q) => ({
                    id: q.id,
                    question: q.question,
                    type: q.type,
                    options: "options" in q ? q.options : undefined,
                  })),
                  schoolLevel: request.schoolLevel,
                  collegeGrade: request.collegeGrade,
                },
              ),
            `Documents Correction (Chat Completion): ${request.quizId}`,
          );
        }
      } else if (correctionCapabilities.hasGraphics) {
        // Progression : Correction graphiques
        if (processId && progressService.hasActiveConnection(processId)) {
          progressService.sendProgress(processId, {
            percentage: 35,
            stage: "graphics_correction",
            message: "Correction des graphiques et visualisations...",
          });
        }

        logger.log("🚀 Correction graphiques via Chat Completion");
        assistantResult = await assistantService.correctWithRetry(
          () =>
            assistantService.correctCompleteQuizChatCompletion(
              request.quizId || "quiz",
              userAnswers,
              {
                graphicsData: correctionCapabilities.graphicsData,
                documentsData: [],
                correctionType: "graphics",
                questions: questions.map((q) => ({
                  id: q.id,
                  question: q.question,
                  type: q.type,
                  options: "options" in q ? q.options : undefined,
                })),
                schoolLevel: request.schoolLevel,
                collegeGrade: request.collegeGrade,
              },
            ),
          `Graphics Correction (Chat Completion): ${request.quizId}`,
        );
      } else {
        // Progression : Correction standard
        if (processId && progressService.hasActiveConnection(processId)) {
          progressService.sendProgress(processId, {
            percentage: 30,
            stage: "standard_correction",
            message: "Correction standard des réponses...",
          });
        }

        logger.log("🚀 Correction standard via Chat Completion + JSON strict");
        assistantResult = await assistantService.correctWithRetry(
          () =>
            assistantService.correctStandardQuizChatCompletion(
              request.quizId || "quiz",
              userAnswers,
              {
                questions: questions.map((q) => ({
                  id: q.id,
                  question: q.question,
                  type: q.type,
                  options:
                    q.type === QuestionType.MULTIPLE_CHOICE
                      ? (q as MultipleChoiceQuestion).options
                      : undefined,
                  correctAnswerId:
                    q.type === QuestionType.MULTIPLE_CHOICE
                      ? (q as MultipleChoiceQuestion).options.find((opt) => opt.isCorrect)?.id
                      : undefined,
                })),
                schoolLevel: request.schoolLevel,
                collegeGrade: request.collegeGrade,
              },
            ),
          `Standard Correction (Chat Completion): ${request.quizId}`,
        );
      }

      // Progression : Finalisation correction
      if (processId && progressService.hasActiveConnection(processId)) {
        progressService.sendProgress(processId, {
          percentage: 90,
          stage: "correction_finalization",
          message: "Finalisation de la correction...",
        });
      }

      // Transformation du résultat Assistant vers le format QuizCorrectionResult
      const result = this.transformAssistantResult(
        assistantResult,
        questions,
        userAnswers,
        request.quizId,
      );

      // Progression : Succès
      if (processId && progressService.hasActiveConnection(processId)) {
        progressService.sendSuccess(processId, result);
      }

      return result;
    } catch (error) {
      logger.error("❌ Erreur correction Assistant, fallback vers ancien système:", error);

      // Progression : Erreur
      if (processId && progressService.hasActiveConnection(processId)) {
        progressService.sendError(processId, `Erreur de correction: ${error}`);
      }

      // Fallback vers l'ancien système en cas d'erreur
      return CorrectionGenerator.correctQuiz(questions, userAnswers, request);
    }
  }

  /**
   * Analyse le contenu d'un workspace pour la génération de quiz
   * @deprecated Utilisez WorkspaceAnalyzer.analyzeWorkspaceContent() directement
   */
  static async analyzeWorkspaceContent(
    workspaceContent: string,
    workspaceName: string,
    schoolLevel: SchoolLevel,
  ): Promise<{
    mainTopics: string[];
    complexity: "basique" | "intermédiaire" | "avancé";
    suggestedQuestionCount: number;
    relevanceScore: number;
  }> {
    return WorkspaceAnalyzer.analyzeWorkspaceContent(workspaceContent, workspaceName, schoolLevel);
  }

  // ========================================
  // MÉTHODES UTILITAIRES CONSERVÉES
  // ========================================

  /**
   * Génère un prompt adapté au niveau scolaire et à la classe spécifique
   * @deprecated Utilisez PromptUtils.getGenerationPromptByLevel() directement
   */
  static getGenerationPromptByLevel(level: SchoolLevel, collegeGrade?: CollegeGrade): string {
    return PromptUtils.getGenerationPromptByLevel(level, collegeGrade);
  }

  /**
   * Templates de prompts par type de question
   * @deprecated Utilisez PromptUtils.getQuestionTypePrompt() directement
   */
  static getQuestionTypePrompt(type: QuestionType): string {
    return PromptUtils.getQuestionTypePrompt(type);
  }

  // ========================================
  // 🆕 NOUVELLES MÉTHODES ASSISTANT
  // ========================================

  /**
   * Détecte automatiquement les capacités nécessaires pour la correction
   */
  private static detectCorrectionCapabilities(questions: Question[]): CorrectionCapabilities {
    let hasGraphics = false;
    let hasDocuments = false;
    const graphicsData: GraphicData[] = [];
    const documentsData: DocumentReferenceLocal[] = [];

    // Analyser chaque question pour détecter le contexte
    questions.forEach((question) => {
      if (question.hasGraphic) {
        hasGraphics = true;
        if (question.graphicId && question.graphicConfig && question.graphicLibrary) {
          // ✅ CORRECTION: Inclure TOUTES les données du graphique pour la correction
          graphicsData.push({
            // Format attendu par les méthodes Assistant
            graphicId: question.graphicId, // ID du graphique (format Assistant)
            config: question.graphicConfig, // Configuration JSON complète (ApexCharts/Plotly)
            library: question.graphicLibrary, // Bibliothèque utilisée
            dataValues: question.graphicDataValues || [], // Valeurs clés pour analyse mathématique
            // 🆕 DONNÉES ADDITIONNELLES ENRICHIES:
            type: question.graphicType, // Type de graphique (2d/3d)
            description: question.graphicDescription, // Description textuelle pour l'IA
            htmlContainer: "quiz-graphic-container", // Container HTML par défaut
            questionText: question.question, // Texte de la question associée
            questionId: question.id, // ID de la question pour référence
          });
        }
      }

      if (question.basedOnDocument) {
        hasDocuments = true;
        if (question.documentReference) {
          documentsData.push({
            reference: question.documentReference,
            questionId: question.id,
          });
        }
      }
    });

    // Déterminer si File Upload est nécessaire pour les documents
    const useFileUpload = hasDocuments && documentsData.length > 0;

    return {
      hasGraphics,
      hasDocuments,
      useFileUpload,
      graphicsData,
      documentsData,
    };
  }

  /**
   * Transforme le résultat Assistant vers le format QuizCorrectionResult attendu
   */
  private static transformAssistantResult(
    assistantResult: AssistantCorrectionResult,
    questions: Question[],
    userAnswers: UserAnswer[],
    quizId?: string,
  ): QuizCorrectionResult {
    logger.log("🔄 Transformation résultat Assistant:", assistantResult);

    // Transformation des corrections par question vers le format frontend
    const questionResults: TransformedQuestionResult[] = (assistantResult.corrections || []).map(
      (correction: QuestionCorrectionFromAssistant, index: number) => {
        const actualMaxScore = correction.pointsTotal || questions[index]?.points || 1;
        let score = correction.pointsObtained || 0;
        const isCorrect = correction.isCorrect || false;

        // 🔧 FIX CRITIQUE: Si l'Assistant indique que la réponse est correcte (isCorrect: true),
        // forcer le score à être égal au maxScore pour éviter les points partiels sur des bonnes réponses
        if (isCorrect && score < actualMaxScore) {
          logger.log(
            `🔧 [ASSISTANT-FIX] Question ${correction.questionId || questions[index]?.id}: Assistant dit correct mais score partiel ${score}/${actualMaxScore} → Correction à ${actualMaxScore}/${actualMaxScore}`,
          );
          score = actualMaxScore;
        }

        // Récupérer la réponse utilisateur et la convertir en string
        const foundUserAnswer = userAnswers.find(
          (a) => a.questionId === (correction.questionId || questions[index]?.id),
        )?.answer;

        // Convertir AnswerValue en string pour le résultat
        const userAnswerAsString =
          correction.userAnswer ||
          (typeof foundUserAnswer === "string"
            ? foundUserAnswer
            : foundUserAnswer !== undefined
              ? JSON.stringify(foundUserAnswer)
              : "");

        return {
          questionId: correction.questionId || questions[index]?.id || `q_${index}`,
          isCorrect: isCorrect,
          userAnswer: userAnswerAsString,
          correctAnswer: correction.correctAnswer || "",
          explanation: correction.explanation || "",
          score: score, // Frontend attend 'score'
          maxScore: actualMaxScore, // Frontend attend 'maxScore'
          feedback: correction.feedback || "",
          difficulty: questions[index]?.difficulty || "moyen",
        };
      },
    );

    // Calculer les scores de base depuis le résultat Assistant
    const totalScore =
      assistantResult.globalScore?.pointsObtained ||
      questionResults.reduce((sum: number, qr: TransformedQuestionResult) => sum + qr.score, 0);
    const maxScore =
      assistantResult.globalScore?.pointsTotal ||
      questionResults.reduce((sum: number, qr: TransformedQuestionResult) => sum + qr.maxScore, 0);
    const percentage = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;

    // Créer l'objet aiCorrection avec des valeurs par défaut sûres
    const aiCorrection = {
      globalFeedback: this.generateGlobalFeedback(assistantResult, percentage, questionResults),
      recommendations: assistantResult.recommendations || [],
      strengths: this.extractStrengths(assistantResult, questionResults),
      weaknesses: this.extractWeaknesses(assistantResult, questionResults),
    };

    // Calculer la note adaptée au système français
    const adaptedGrade = this.calculateFrenchGrade(percentage);

    return {
      quizId: quizId || "unknown",
      totalScore,
      maxScore,
      percentage,
      adaptedGrade: adaptedGrade.grade,
      gradeScale: adaptedGrade.scale,
      questionResults: questionResults, // Champ requis
      detailedScoring: questionResults, // Frontend attend 'detailedScoring'
      aiCorrection,
      metadata: {
        correctedAt: new Date(),
        aiModel: "OpenAI Assistant",
        correctionTime: 0, // Temps de correction non mesuré pour l'instant
      },
    };
  }

  /**
   * Extrait les points forts à partir du résultat Assistant
   */
  private static extractStrengths(
    assistantResult: AssistantCorrectionResult,
    questionResults: TransformedQuestionResult[],
  ): string[] {
    // Si des forces sont directement fournies
    if (assistantResult.strengths && Array.isArray(assistantResult.strengths)) {
      return assistantResult.strengths;
    }

    // Sinon, les déduire des bonnes réponses
    const strengths: string[] = [];
    const correctAnswers = questionResults.filter((q) => q.isCorrect);

    if (correctAnswers.length > 0) {
      strengths.push(`Bonnes réponses sur ${correctAnswers.length} question(s)`);

      // Analyser les compétences spécifiques selon le type de correction
      if (
        assistantResult.correctionType === "with_graphics" &&
        assistantResult.graphicCompetencies
      ) {
        strengths.push("Bonne analyse des graphiques");
      }
      if (
        assistantResult.correctionType === "with_documents" &&
        assistantResult.documentaryCompetencies
      ) {
        strengths.push("Bonne compréhension des documents");
      }
    }

    return strengths.length > 0 ? strengths : ["Participation au quiz complétée"];
  }

  /**
   * Extrait les points faibles à partir du résultat Assistant
   */
  private static extractWeaknesses(
    assistantResult: AssistantCorrectionResult,
    questionResults: TransformedQuestionResult[],
  ): string[] {
    // Si des faiblesses sont directement fournies
    if (assistantResult.weaknesses && Array.isArray(assistantResult.weaknesses)) {
      return assistantResult.weaknesses;
    }

    // Sinon, les déduire des mauvaises réponses
    const weaknesses: string[] = [];
    const incorrectAnswers = questionResults.filter((q) => !q.isCorrect);

    if (incorrectAnswers.length > 0) {
      weaknesses.push(`Erreurs sur ${incorrectAnswers.length} question(s)`);

      // Analyser les difficultés spécifiques
      const conceptErrors = incorrectAnswers.filter(
        (q) =>
          q.explanation?.toLowerCase().includes("concept") ||
          q.explanation?.toLowerCase().includes("définition"),
      );

      if (conceptErrors.length > 0) {
        weaknesses.push("Révision des concepts de base recommandée");
      }
    }

    return weaknesses.length > 0 ? weaknesses : [];
  }

  /**
   * Calcule la note selon le système français
   */
  private static calculateFrenchGrade(percentage: number): {
    grade: number;
    scale: string;
  } {
    // Système français standard sur 20
    const grade = Math.round((percentage / 100) * 20 * 100) / 100; // Arrondi à 2 décimales
    return {
      grade: Math.max(0, Math.min(20, grade)), // Borné entre 0 et 20
      scale: "/20",
    };
  }

  /**
   * Génère un feedback global basé sur les résultats
   */
  private static generateGlobalFeedback(
    assistantResult: AssistantCorrectionResult,
    percentage: number,
    questionResults: TransformedQuestionResult[],
  ): string {
    // Si un feedback global est fourni par l'Assistant, l'utiliser
    if (assistantResult.globalFeedback) {
      return assistantResult.globalFeedback;
    }

    // Sinon, générer un feedback basé sur la performance
    const correctAnswers = questionResults.filter((q) => q.isCorrect).length;
    const totalQuestions = questionResults.length;

    let feedback = `Résultat: ${correctAnswers}/${totalQuestions} (${percentage}%).\n`;

    if (percentage >= 80) {
      feedback += "Excellent travail ! Vous maîtrisez bien le sujet.";
    } else if (percentage >= 60) {
      feedback += "Bon travail ! Quelques points à approfondir.";
    } else if (percentage >= 40) {
      feedback += "Travail correct. Une révision des concepts serait bénéfique.";
    } else {
      feedback += "Des efforts supplémentaires sont nécessaires. Reprenez les bases du sujet.";
    }

    // Ajouter des conseils spécifiques selon le type de correction
    if (assistantResult.correctionType === "with_graphics") {
      feedback += " Continuez à travailler l'analyse graphique.";
    } else if (assistantResult.correctionType === "with_documents") {
      feedback += " Approfondissez la compréhension des documents.";
    }

    return feedback;
  }
}
