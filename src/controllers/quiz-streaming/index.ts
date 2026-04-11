/**
 * Quiz Streaming Controller — backward-compatible re-export.
 *
 * All logic lives in dedicated modules under this directory.
 * This index provides the same static-method class that routes/quiz.ts expects.
 */
import { generateQuizStream } from "./generateStreamController.js";
import { getStreamStatus } from "./streamStatusController.js";
import { createStreamingSession, streamQuizGeneration } from "./streamSessionController.js";
import { submitAndCorrectStream } from "./correctionStreamController.js";
import { correctSingleQuestion } from "./singleCorrectionController.js";
import { completeQuiz } from "./quizCompletionController.js";

export class QuizStreamingController {
  static generateQuizStream = generateQuizStream;
  static getStreamStatus = getStreamStatus;
  static createStreamingSession = createStreamingSession;
  static streamQuizGeneration = streamQuizGeneration;
  static submitAndCorrectStream = submitAndCorrectStream;
  static correctSingleQuestion = correctSingleQuestion;
  static completeQuiz = completeQuiz;
}
