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

export class QuizStreamingController {
  static generateQuizStream = generateQuizStream;
  static getStreamStatus = getStreamStatus;
  static createStreamingSession = createStreamingSession;
  static streamQuizGeneration = streamQuizGeneration;
  static submitAndCorrectStream = submitAndCorrectStream;
}
