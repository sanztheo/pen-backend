// assistant/utils/logging.ts - Utilitaires de logging pour l'assistant

// Interfaces pour le typage des données de logging
import { logger } from "../../../../utils/logger.js";
interface LogAnswer {
  questionId: string;
  answer: unknown;
}

interface LogQuestionOption {
  id: string;
  isCorrect?: boolean;
}

interface LogQuestion {
  id: string;
  type: string;
  options?: LogQuestionOption[];
}

interface LogCorrection {
  questionId: string;
  isCorrect: boolean;
  pointsObtained: number;
  correctAnswer: unknown;
  userAnswer: unknown;
}

interface LogCorrectionResult {
  corrections?: LogCorrection[];
}

/**
 * Log détaillé pour debugging des opérations de l'assistant
 */
export function logOperation(
  operation: string,
  params: unknown,
  result?: unknown,
  error?: Error,
): void {
  const timestamp = new Date().toISOString();

  logger.log(`🤖 [${timestamp}] Assistant Operation: ${operation}`);
  logger.log(`📥 Params:`, JSON.stringify(params, null, 2));

  if (error) {
    logger.error(`❌ Error:`, error.message);
    logger.error(`📚 Stack:`, error.stack);
  } else if (result) {
    logger.log(`✅ Success`);
    logger.log(`📤 Result:`, JSON.stringify(result, null, 2));
  }
}

/**
 * Log pour les opérations de génération
 */
export function logGeneration(
  type: string,
  options: unknown,
  success: boolean,
  details?: string,
): void {
  const timestamp = new Date().toISOString();
  const status = success ? "✅" : "❌";

  logger.log(`${status} [${timestamp}] Génération ${type}`);
  logger.log(`   Options:`, JSON.stringify(options, null, 2));
  if (details) {
    logger.log(`   Détails: ${details}`);
  }
}

/**
 * Log pour les opérations de correction
 */
export function logCorrection(
  quizId: string,
  answersCount: number,
  success: boolean,
  details?: string,
): void {
  const timestamp = new Date().toISOString();
  const status = success ? "✅" : "❌";

  logger.log(`${status} [${timestamp}] Correction Quiz ${quizId}`);
  logger.log(`   Réponses: ${answersCount}`);
  if (details) {
    logger.log(`   Détails: ${details}`);
  }
}

/**
 * Log pour le debug des données de correction
 */
export function logCorrectionDebug(
  quizId: string,
  answers: LogAnswer[],
  questions: LogQuestion[],
): void {
  logger.log("🐛 [DEBUG] [CORRECTION] Données reçues:", {
    quizId,
    answersCount: answers.length,
    answers: answers.map((a) => ({
      questionId: a.questionId,
      answer: a.answer,
    })),
    questionsCount: questions?.length || 0,
    questions:
      questions?.map((q) => ({
        id: q.id,
        type: q.type,
        correctOption: q.options?.find((opt) => opt.isCorrect)?.id,
      })) || [],
  });
}

/**
 * Log pour les résultats de correction
 */
export function logCorrectionResult(result: LogCorrectionResult): void {
  logger.log("🐛 [DEBUG] [CORRECTION] Résultat IA:", {
    correctionsCount: result?.corrections?.length || 0,
    corrections:
      result?.corrections?.map((corr) => ({
        questionId: corr.questionId,
        isCorrect: corr.isCorrect,
        pointsObtained: corr.pointsObtained,
        correctAnswer: corr.correctAnswer,
        userAnswerFromResult: corr.userAnswer,
      })) || [],
  });
}
