// assistant/service.refactored.ts - Service principal refactoré (Façade)
// Ce fichier réorganise le service original en utilisant les modules séparés

import OpenAI from "openai";
import {
  createThread as createAssistantThread,
  addMessageToThread,
  runAssistantOnThread,
  waitForRunCompletion,
} from "./thread.js";
import { ASSISTANT_ID } from "./index.js";

// Imports depuis les modules refactorisés
import { QUIZ_QUESTION_SCHEMA, QUIZ_CORRECTION_STANDARD_SCHEMA, QUIZ_CORRECTION_COMPLETE_SCHEMA } from "./config/index.js";
import { QuestionGenerator } from "./generation/questionGenerator.js";
import { QuizGenerators } from "./generation/quizGenerators.js";
import { AssistantCorrection } from "./correction/assistantCorrection.js";
import { ChatCorrection } from "./correction/chatCorrection.js";
import {
  executeWithRetry,
  generateWithRetry,
  correctWithRetry,
  validateAssistantResponse,
  logOperation,
  generateOperationId,
  cleanupThread,
} from "./utils/index.js";
import type {
  QuizPreset,
  Difficulty,
  GenerateQuizOptions,
  GenerateQuizWithGraphicsOptions,
  GenerateQuizWithDocumentsOptions,
  GenerateQuizWithFullDocumentsOptions,
  GenerateCompleteQuizOptions,
  GenerateStandardQuizOptions,
  GenerateGraphicOptions,
  QuizAnswer,
  LegacyQuizAnswer,
  GraphicData,
  DocumentData,
  DocumentReference,
  QuizQuestion,
  CorrectStandardQuizOptions,
  CorrectGraphicsQuizOptions,
  CorrectDocumentaryQuizOptions,
  CorrectCompleteQuizOptions,
  CorrectQuizOptions,
  RetryOptions,
} from "./types/index.js";

/**
 * Service principal refactoré pour interagir avec l'Assistant OpenAI Quiz
 * Utilise le pattern Façade pour déléguer aux modules spécialisés
 */
export class OpenAIAssistantServiceRefactored {
  private assistantId: string;
  private openai: OpenAI;

  // Modules spécialisés
  private questionGenerator: QuestionGenerator;
  private quizGenerators: QuizGenerators;
  private assistantCorrection: AssistantCorrection;
  private chatCorrection: ChatCorrection;

  constructor(assistantId?: string) {
    this.assistantId = assistantId || ASSISTANT_ID;
    if (!this.assistantId) {
      throw new Error(
        "ASSISTANT_ID non défini dans les variables d'environnement",
      );
    }

    // Initialiser le client OpenAI
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // Initialiser les modules spécialisés
    this.questionGenerator = new QuestionGenerator();
    this.quizGenerators = new QuizGenerators(this.assistantId);
    this.assistantCorrection = new AssistantCorrection(this.assistantId);
    this.chatCorrection = new ChatCorrection();
  }

  // ===== GÉNÉRATION DE QUESTIONS (Chat Completion) =====

  /**
   * Génère une seule question pour le streaming avec chat completion + JSON strict
   */
  async generateSingleQuestion(request: any): Promise<any> {
    return this.questionGenerator.generateSingleQuestion(request);
  }

  // ===== GÉNÉRATION DE QUIZ (Assistant API) =====

  /**
   * Génère un quiz personnalisé via l'assistant
   */
  async generateQuiz(options: GenerateQuizOptions): Promise<any> {
    return this.quizGenerators.generateQuiz(options);
  }

  /**
   * Génère un quiz basé sur un preset prédéfini
   */
  async generatePresetQuiz(
    preset: QuizPreset,
    subject?: string,
    questionCount: number = 10,
  ): Promise<any> {
    return this.quizGenerators.generatePresetQuiz(preset, subject, questionCount);
  }

  /**
   * Génère un quiz avec graphiques pédagogiques
   */
  async generateQuizWithGraphics(options: GenerateQuizWithGraphicsOptions): Promise<any> {
    return this.quizGenerators.generateQuizWithGraphics(options);
  }

  /**
   * Génère un quiz avec documents Wikipedia
   */
  async generateQuizWithDocuments(options: GenerateQuizWithDocumentsOptions): Promise<any> {
    return this.quizGenerators.generateQuizWithDocuments(options);
  }

  /**
   * Génère un quiz avec documents complets via File Upload
   */
  async generateQuizWithFullDocuments(options: GenerateQuizWithFullDocumentsOptions): Promise<any> {
    return this.quizGenerators.generateQuizWithFullDocuments(options);
  }

  /**
   * Génère un quiz complet avec graphiques ET documents
   */
  async generateCompleteQuiz(options: GenerateCompleteQuizOptions): Promise<any> {
    return this.quizGenerators.generateCompleteQuiz(options);
  }

  /**
   * Génère un quiz standard sans contexte spécial
   */
  async generateStandardQuiz(options: GenerateStandardQuizOptions): Promise<any> {
    return this.quizGenerators.generateStandardQuiz(options);
  }

  /**
   * Génère un graphique pédagogique
   */
  async generateGraphic(options: GenerateGraphicOptions): Promise<any> {
    return this.quizGenerators.generateGraphic(options);
  }

  /**
   * Recherche et enrichit un sujet avec des documents
   */
  async enrichSubjectWithDocuments(
    subject: string,
    preset: QuizPreset,
    keywords?: string[],
    maxDocuments = 3,
  ): Promise<any> {
    return this.quizGenerators.enrichSubjectWithDocuments(subject, preset, keywords, maxDocuments);
  }

  /**
   * Méthode générique pour interagir directement avec l'assistant
   */
  async chat(message: string): Promise<any> {
    return this.quizGenerators.chat(message);
  }

  // ===== CORRECTION DE QUIZ (Assistant API) =====

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
    return this.assistantCorrection.correctStandardQuiz(quizId, answers, questions, options);
  }

  /**
   * Corrige un quiz avec graphiques
   */
  async correctGraphicsQuiz(
    quizId: string,
    answers: QuizAnswer[],
    graphicsData: GraphicData[],
    options: CorrectGraphicsQuizOptions = {},
  ): Promise<any> {
    return this.assistantCorrection.correctGraphicsQuiz(quizId, answers, graphicsData, options);
  }

  /**
   * Corrige un quiz documentaire
   */
  async correctDocumentaryQuiz(
    quizId: string,
    answers: QuizAnswer[],
    documentsData: DocumentData[],
    options: CorrectDocumentaryQuizOptions = {},
  ): Promise<any> {
    return this.assistantCorrection.correctDocumentaryQuiz(quizId, answers, documentsData, options);
  }

  /**
   * Corrige un quiz documentaire avec fichiers complets
   */
  async correctDocumentaryQuizWithFiles(
    quizId: string,
    answers: QuizAnswer[],
    documentsData: DocumentReference[],
    questions: QuizQuestion[],
    options: CorrectDocumentaryQuizOptions = {},
  ): Promise<any> {
    return this.assistantCorrection.correctDocumentaryQuizWithFiles(
      quizId,
      answers,
      documentsData,
      questions,
      options,
    );
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
    return this.assistantCorrection.correctCompleteQuiz(
      quizId,
      answers,
      graphicsData,
      documentsData,
      options,
    );
  }

  // ===== CORRECTION DE QUIZ (Chat Completion) =====

  /**
   * Méthode de correction générique (compatibilité)
   */
  async correctQuiz(
    quizId: string,
    answers: LegacyQuizAnswer[],
    options: CorrectQuizOptions = {},
  ): Promise<any> {
    return this.chatCorrection.correctQuiz(quizId, answers, options);
  }

  /**
   * Corrige un quiz standard via Chat Completion + JSON strict
   */
  async correctStandardQuizChatCompletion(
    quizId: string,
    answers: QuizAnswer[],
    options?: CorrectQuizOptions,
  ): Promise<any> {
    return this.chatCorrection.correctStandardQuizChatCompletion(quizId, answers, options);
  }

  /**
   * Corrige un quiz complet via Chat Completion + JSON strict
   */
  async correctCompleteQuizChatCompletion(
    quizId: string,
    answers: QuizAnswer[],
    options?: CorrectQuizOptions,
  ): Promise<any> {
    return this.chatCorrection.correctCompleteQuizChatCompletion(quizId, answers, options);
  }

  // ===== MÉTHODES DE TEST/DEV =====

  /**
   * Crée un nouveau thread pour l'Assistant
   */
  async createThread(): Promise<string> {
    return await createAssistantThread();
  }

  /**
   * Envoie un message dans un thread existant
   */
  async sendMessage(threadId: string, message: string): Promise<any> {
    console.log(
      "🔍 sendMessage - ThreadId:",
      threadId,
      "Type:",
      typeof threadId,
    );
    console.log("🔍 sendMessage - AssistantId:", this.assistantId);

    await addMessageToThread(threadId, message);
    const runId = await runAssistantOnThread(threadId, this.assistantId);

    console.log(
      "🔍 sendMessage - Avant waitForRunCompletion, ThreadId:",
      threadId,
      "RunId:",
      runId,
    );

    return await waitForRunCompletion(threadId, runId);
  }

  /**
   * Test simple de disponibilité de l'Assistant
   */
  async ping(): Promise<boolean> {
    try {
      const threadId = await createAssistantThread();
      await addMessageToThread(threadId, "ping");
      const runId = await runAssistantOnThread(threadId, this.assistantId);

      // On attend juste que ça se lance, pas forcément que ça finisse
      await new Promise((resolve) => setTimeout(resolve, 1000));

      return true;
    } catch (error) {
      console.error("Erreur ping Assistant:", error);
      return false;
    }
  }

  // ===== GESTION D'ERREURS ET VALIDATION =====

  /**
   * Exécute une opération avec retry automatique et validation JSON
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    options: RetryOptions = {},
  ): Promise<T> {
    return executeWithRetry(operation, options);
  }

  /**
   * Wrapper pour les méthodes de génération avec retry
   */
  async generateWithRetry<T>(
    generatorFn: () => Promise<T>,
    operationName: string,
  ): Promise<T> {
    return generateWithRetry(generatorFn, operationName);
  }

  /**
   * Wrapper pour les méthodes de correction avec retry
   */
  async correctWithRetry<T>(
    correctorFn: () => Promise<T>,
    operationName: string,
  ): Promise<T> {
    return correctWithRetry(correctorFn, operationName);
  }

  /**
   * Nettoyage des threads après opération
   */
  async cleanupThread(threadId: string): Promise<void> {
    return cleanupThread(threadId);
  }
}

// Export pour rétrocompatibilité
export { OpenAIAssistantServiceRefactored as OpenAIAssistantService };
