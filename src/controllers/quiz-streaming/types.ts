import { LyceeSpecialty, Question } from "../../services/quiz/types.js";

/** Donnees envoyees via Server-Sent Events */
export interface SSEEventData {
  message?: string;
  quizId?: string;
  questionNumber?: number;
  totalQuestions?: number;
  question?: Question;
  quiz?: Record<string, unknown>;
  canStartAnswering?: boolean;
  error?: string;
  details?: string;
  [key: string]: unknown;
}

/** Fonction d'envoi SSE */
export type SSESender = (event: string, data: SSEEventData) => void;

/** Requete de session de streaming */
export interface StreamingSessionRequest {
  subject?: string;
  schoolLevel?: string;
  questionTypes?: string[];
  questionCount?: number;
  collegeGrade?: string;
  lyceeSpecialties?: LyceeSpecialty[];
  higherEdLevel?: string;
  higherEdField?: string;
  preset?: string;
  title?: string;
  description?: string;
  coursesOnly?: boolean;
  ragContext?: string;
  pageProjectIds?: string[];
  specificSubject?: string;
  sequentialConfig?: Record<string, unknown>;
  targetGrade?: number;
  timeLimit?: number;
  difficulty?: string;
  useIntelligentGeneration?: boolean;
  usePersonalization?: boolean;
  letAIChoose?: boolean;
}

/** Session de streaming stockee */
export interface StreamingSession {
  userId: string;
  request: StreamingSessionRequest;
  createdAt: Date;
}

/** Resultat de correction d'une question (compatible avec QuestionResult et EnrichedQuestionResult) */
export interface CorrectionResultItem {
  questionId: string;
  userAnswer?: string | boolean | string[] | Record<string, string>;
  correctAnswer?: string | boolean | string[] | Record<string, string>;
  score: number;
  maxScore: number;
  isCorrect: boolean;
  explanation?: string;
  feedback?: string;
  suggestion?: string;
  difficulty?: string;
  isEnriched?: boolean;
  sourceReferences?: Array<{
    pageId: string;
    pageTitle: string;
    relevantContent: string;
    relevanceScore: number;
  }>;
  conceptSuggestions?: string[];
  [key: string]: unknown;
}

/** Reponse utilisateur pour correction */
export interface UserAnswerInput {
  questionId: string;
  answer: string | boolean | string[] | Record<string, string>;
  timeSpent?: number;
}

/** Bloc de contenu BlockNote */
export interface BlockNoteBlock {
  type: string;
  content?: Array<{ text?: string }>;
  [key: string]: unknown;
}

/** Extension du type Quiz Prisma avec champs optionnels */
export interface QuizWithExtras {
  preset?: string;
  specificSubject?: string;
  sourceDocuments?: unknown[];
}
