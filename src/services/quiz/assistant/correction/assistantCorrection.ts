// assistant/correction/assistantCorrection.ts - Correction via Assistant API

import {
  createThread as createAssistantThread,
  addMessageToThread,
  runAssistantOnThread,
  waitForRunCompletion,
} from "../thread.js";
import { ASSISTANT_ID, ASSISTANT_ID_DOCUMENTS } from "../index.js";
import {
  STATIC_CORRECTION_INSTRUCTIONS,
  buildFullCachedPrompt,
  buildDynamicCorrectionContent,
} from "../promptCache.js";
import type {
  QuizAnswer,
  GraphicData,
  DocumentData,
  DocumentReference,
  QuizQuestion,
  CorrectStandardQuizOptions,
  CorrectGraphicsQuizOptions,
  CorrectDocumentaryQuizOptions,
  CorrectCompleteQuizOptions,
} from "../types/index.js";

/**
 * Classe pour la correction de quiz via l'Assistant API OpenAI
 */
export class AssistantCorrection {
  private assistantId: string;

  constructor(assistantId?: string) {
    this.assistantId = assistantId || ASSISTANT_ID;
    if (!this.assistantId) {
      throw new Error(
        "ASSISTANT_ID non défini dans les variables d'environnement",
      );
    }
  }

  /**
   * Corrige un quiz standard avec barème français officiel
   */
  async correctStandardQuiz(
    quizId: string,
    answers: QuizAnswer[],
    questions?: Array<{
      id: string;
      question: string;
      options: Array<{ id: string; text: string }>;
      correctAnswerId: string;
    }>,
    options: CorrectStandardQuizOptions = {},
  ): Promise<any> {
    console.log(
      "🚀 Correction optimisée (system prompt supprimé) avec Prompt Caching 2024",
    );
    const threadId = await createAssistantThread();

    // Contenu dynamique pour la correction
    const dynamicContent = buildDynamicCorrectionContent({
      quizId,
      answers,
      questions,
      personalizedFeedback: options.personalizedFeedback,
      includeRecommendations: options.includeRecommendations,
    });

    // Prompt complet pour correction
    const optimizedPrompt = buildFullCachedPrompt("PRINCIPAL", dynamicContent, {
      includeDocuments: false,
      includeGraphics: false,
      includeCorrection: true,
    });

    console.log(
      `📊 Correction Caching - Prompt: ${Math.round(optimizedPrompt.length / 1024)}KB`,
    );

    await addMessageToThread(threadId, optimizedPrompt);
    const runId = await runAssistantOnThread(threadId, this.assistantId);

    return await waitForRunCompletion(threadId, runId);
  }

  /**
   * Corrige un quiz avec graphiques en ayant accès aux configurations sources
   */
  async correctGraphicsQuiz(
    quizId: string,
    answers: QuizAnswer[],
    graphicsData: GraphicData[],
    options: CorrectGraphicsQuizOptions = {},
  ): Promise<any> {
    const threadId = await createAssistantThread();

    const prompt = `Corrige ce quiz avec graphiques en utilisant correct_quiz_with_graphics.

Données du quiz:
- ID: ${quizId}
- Réponses: ${JSON.stringify(answers)}

Données graphiques sources:
${JSON.stringify(graphicsData, null, 2)}

Options d'analyse:
- Compétences visuelles: ${options.analyzeVisualSkills ? "Oui" : "Non"}
- Analyse des tendances: ${options.includeTrendAnalysis ? "Oui" : "Non"}

Évalue les compétences de lecture graphique et d'analyse des données.`;

    await addMessageToThread(threadId, prompt);
    const runId = await runAssistantOnThread(threadId, this.assistantId);

    return await waitForRunCompletion(threadId, runId);
  }

  /**
   * Corrige un quiz documentaire avec accès aux documents Wikipedia sources
   */
  async correctDocumentaryQuiz(
    quizId: string,
    answers: QuizAnswer[],
    documentsData: DocumentData[],
    options: CorrectDocumentaryQuizOptions = {},
  ): Promise<any> {
    const threadId = await createAssistantThread();

    const prompt = `Corrige ce quiz documentaire en utilisant correct_quiz_with_documents.

Données du quiz:
- ID: ${quizId}
- Réponses: ${JSON.stringify(answers)}

Documents Wikipedia sources:
${JSON.stringify(documentsData, null, 2)}

Options d'analyse:
- Compréhension textuelle: ${options.analyzeComprehension ? "Oui" : "Non"}
- Preuves textuelles: ${options.includeTextualEvidence ? "Oui" : "Non"}

Évalue les compétences d'analyse documentaire et de synthèse.`;

    await addMessageToThread(threadId, prompt);
    const runId = await runAssistantOnThread(threadId, this.assistantId);

    return await waitForRunCompletion(threadId, runId);
  }

  /**
   * Corrige un quiz documentaire avec fichiers complets
   * Utilise les fichiers uploadés pour une correction précise avec documents intégraux
   */
  async correctDocumentaryQuizWithFiles(
    quizId: string,
    answers: QuizAnswer[],
    documentsData: DocumentReference[],
    questions: QuizQuestion[],
    options: CorrectDocumentaryQuizOptions = {},
  ): Promise<any> {
    try {
      const uniqueFileIds = [...new Set(documentsData.map((d) => d.reference))];
      console.log(
        `📝 Correction quiz documentaire avec ${uniqueFileIds.length} fichiers complets...`,
      );

      const threadId = await createAssistantThread();

      // Séparer les questions par type pour un traitement adapté
      const openQuestions = questions.filter((q) => q.type === "OPEN_QUESTION");
      const multipleChoiceQuestions = questions.filter(
        (q) => q.type === "MULTIPLE_CHOICE",
      );
      const documentaryQuestions = questions.filter((q) =>
        documentsData.some((doc) => doc.questionId === q.id),
      );

      const prompt = `Corrige ce quiz COMPLET en utilisant correct_quiz_with_documents.

🔹 DONNÉES DU QUIZ COMPLET:
- ID: ${quizId}
- TOTAL QUESTIONS: ${questions.length}
- Questions ouvertes: ${openQuestions.length}
- Questions à choix multiples: ${multipleChoiceQuestions.length}
- Questions documentaires: ${documentaryQuestions.length}

🔹 QUESTIONS DÉTAILLÉES:
${questions
  .map((q) => {
    const userAnswer = answers.find((a) => a.questionId === q.id);
    const docData = documentsData.find((doc) => doc.questionId === q.id);
    return `
Question ${q.id} (Type: ${q.type}):
Question: ${q.question}
${q.options ? `Options: ${q.options.map((opt) => `${opt.id}. ${opt.text}`).join(", ")}` : ""}
Réponse utilisateur: "${userAnswer?.answer || "Pas de réponse"}"
${docData ? `Document de référence: ${docData.reference}` : "Aucun document"}
---`;
  })
  .join("\n")}

🔹 DOCUMENTS DISPONIBLES:
- Files IDs: ${uniqueFileIds.join(", ")}
- Vous avez accès au CONTENU COMPLET de ces documents

🔹 INSTRUCTIONS SPÉCIFIQUES PAR TYPE:

📝 QUESTIONS OUVERTES (${openQuestions.length}):
- Lisez les documents pour comprendre le contexte
- Rédigez une VRAIE réponse basée sur les documents (pas juste "A", "B", "C")
- Analysez la réponse de l'utilisateur contre le contenu des documents
- Donnez une explication détaillée de pourquoi c'est correct/incorrect

🔘 QUESTIONS À CHOIX MULTIPLES (${multipleChoiceQuestions.length}):
- Indiquez la lettre de la bonne réponse (A, B, C, D)
- Expliquez pourquoi cette option est correcte

📚 QUESTIONS DOCUMENTAIRES (${documentaryQuestions.length}):
- Utilisez OBLIGATOIREMENT les fichiers uploadés
- Citez des passages spécifiques des documents
- Fournissez des preuves textuelles

CORRECTION OBLIGATOIRE DES ${questions.length} QUESTIONS AVEC TYPES APPROPRIÉS !`;

      await addMessageToThread(threadId, prompt);

      // Utiliser l'Assistant spécialisé pour documents (gpt-4o-mini)
      const documentAssistantId = ASSISTANT_ID_DOCUMENTS;
      console.log(
        `🚀 Utilisation de l'Assistant optimisé pour correction documents: ${documentAssistantId}`,
      );
      const runId = await runAssistantOnThread(threadId, documentAssistantId);

      // TIMEOUT RÉDUIT: gpt-4o-mini est 10x plus rapide
      const result = await waitForRunCompletion(threadId, runId, 60);

      // Ajouter les métadonnées de correction
      if (result) {
        result.fileCorrectionMetadata = {
          usedFiles: uniqueFileIds.length,
          fileIds: uniqueFileIds,
          totalQuestions: answers.length,
          documentaryQuestions: documentsData.length,
          correctionMethod: "full_documents_via_files",
          timestamp: new Date().toISOString(),
        };
      }

      console.log(
        `✅ Correction terminée avec ${uniqueFileIds.length} fichiers complets`,
      );
      return result;
    } catch (error) {
      console.error("❌ Erreur correction avec fichiers:", error);
      throw error;
    }
  }

  /**
   * Corrige un quiz complet intégrant graphiques ET documents
   */
  async correctCompleteQuiz(
    quizId: string,
    answers: QuizAnswer[],
    graphicsData: GraphicData[],
    documentsData: DocumentData[],
    options: CorrectCompleteQuizOptions = {},
  ): Promise<any> {
    const threadId = await createAssistantThread();

    const prompt = `Corrige ce quiz complet multimédia en utilisant correct_quiz_complete.

Données du quiz:
- ID: ${quizId}
- Réponses: ${JSON.stringify(answers)}

Graphiques sources:
${JSON.stringify(graphicsData, null, 2)}

Documents Wikipedia sources:
${JSON.stringify(documentsData, null, 2)}

Options d'analyse avancée:
- Références croisées: ${options.analyzeCrossReferences ? "Oui" : "Non"}
- Parcours d'apprentissage: ${options.generateLearningPath ? "Oui" : "Non"}
- Compétences détaillées: ${options.detailedCompetencies ? "Oui" : "Non"}

Fais une analyse croisée graphiques + documents avec parcours personnalisé.`;

    await addMessageToThread(threadId, prompt);
    const runId = await runAssistantOnThread(threadId, this.assistantId);

    return await waitForRunCompletion(threadId, runId);
  }
}

// Export d'une instance par défaut
export const assistantCorrection = new AssistantCorrection();
