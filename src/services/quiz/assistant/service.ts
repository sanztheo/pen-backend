// assistant/service.ts - Service OpenAI Quiz (Chat Completion uniquement)

import { QuestionGenerator } from "./generation/questionGenerator.js";
import { ChatCorrection } from "./correction/chatCorrection.js";
import type {
  SingleQuestionGenerationRequest,
  SingleQuestionGenerationResult,
} from "./generation/questionGenerator.js";
import type {
  QuizAnswer,
  LegacyQuizAnswer,
  CorrectQuizOptions,
} from "./types/index.js";

/**
 * Service principal pour les quiz OpenAI
 * Utilise Chat Completion avec JSON strict (plus d'Assistant API)
 */
export class OpenAIAssistantService {
  private questionGenerator: QuestionGenerator;
  private chatCorrection: ChatCorrection;

  constructor() {
    this.questionGenerator = new QuestionGenerator();
    this.chatCorrection = new ChatCorrection();
  }

  // ===== GÉNÉRATION DE QUESTIONS (Chat Completion) =====

	  /**
	   * Génère une seule question pour le streaming avec chat completion + JSON strict
	   */
	  async generateSingleQuestion(
	    request: SingleQuestionGenerationRequest,
	  ): Promise<SingleQuestionGenerationResult> {
	    return this.questionGenerator.generateSingleQuestion(request);
	  }

  // ===== CORRECTION DE QUIZ (Chat Completion) =====

  /**
   * Méthode de correction générique (compatibilité)
   */
	  async correctQuiz(
	    quizId: string,
	    answers: LegacyQuizAnswer[],
	    options: CorrectQuizOptions = {},
	  ): ReturnType<ChatCorrection["correctQuiz"]> {
	    return this.chatCorrection.correctQuiz(quizId, answers, options);
	  }

  /**
   * Corrige un quiz standard via Chat Completion + JSON strict
   */
	  async correctStandardQuizChatCompletion(
	    quizId: string,
	    answers: QuizAnswer[],
	    options?: CorrectQuizOptions,
	  ): ReturnType<ChatCorrection["correctStandardQuizChatCompletion"]> {
	    return this.chatCorrection.correctStandardQuizChatCompletion(
	      quizId,
	      answers,
	      options,
	    );
	  }

  /**
   * Corrige un quiz complet via Chat Completion + JSON strict
   */
	  async correctCompleteQuizChatCompletion(
	    quizId: string,
	    answers: QuizAnswer[],
	    options?: CorrectQuizOptions,
	  ): ReturnType<ChatCorrection["correctCompleteQuizChatCompletion"]> {
	    return this.chatCorrection.correctCompleteQuizChatCompletion(
	      quizId,
	      answers,
	      options,
	    );
	  }

  // ===== MÉTHODES UTILITAIRES =====

  /**
   * Wrapper pour les méthodes de génération avec retry
   */
  async generateWithRetry<T>(
    generatorFn: () => Promise<T>,
    operationName: string,
    maxRetries: number = 3,
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`🔄 [${operationName}] Tentative ${attempt}/${maxRetries}`);
        const result = await generatorFn();
        console.log(`✅ [${operationName}] Succès`);
        return result;
      } catch (error) {
        lastError = error as Error;
        console.error(
          `❌ [${operationName}] Erreur tentative ${attempt}:`,
          error,
        );

        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw (
      lastError ||
      new Error(`${operationName} failed after ${maxRetries} attempts`)
    );
  }

  /**
   * Wrapper pour les méthodes de correction avec retry
   */
  async correctWithRetry<T>(
    correctorFn: () => Promise<T>,
    operationName: string,
    maxRetries: number = 3,
  ): Promise<T> {
    return this.generateWithRetry(correctorFn, operationName, maxRetries);
  }
}
