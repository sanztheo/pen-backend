// assistant/types/index.ts - Types et interfaces pour l'assistant quiz

// Types de preset pour les quiz
export type QuizPreset = "BREVET" | "BAC" | "PARTIELS";

// Types de difficulté
export type Difficulty = "facile" | "moyen" | "difficile";

// Types de graphiques
export type GraphicType = "2d" | "3d";
export type GraphicLibrary = "apexcharts" | "plotly";
export type ChartType =
  | "line"
  | "bar"
  | "pie"
  | "scatter"
  | "area"
  | "histogram"
  | "box"
  | "heatmap";

// Types de correction
export type CorrectionType = "standard" | "with_graphics" | "with_documents" | "complete";
export type SourceType = "graphic" | "document" | "mixed" | "knowledge";

// Interface pour les options de génération de quiz
export interface GenerateQuizOptions {
  preset: QuizPreset;
  subject: string;
  numQuestions: number;
  difficulty?: Difficulty;
  includeGraphics?: boolean;
  includeDocuments?: boolean;
  questionTypes?: string[];
  documentTopics?: string[];
}

// Interface pour les options de quiz avec graphiques
export interface GenerateQuizWithGraphicsOptions {
  preset: QuizPreset;
  subject: string;
  numQuestions: number;
  graphicType?: GraphicType;
  library?: GraphicLibrary;
  difficulty?: Difficulty;
  questionTypes?: string[];
}

// Interface pour les options de quiz avec documents
export interface GenerateQuizWithDocumentsOptions {
  preset: QuizPreset;
  subject: string;
  numQuestions: number;
  documentTopics?: string[];
  difficulty?: Difficulty;
  questionTypes?: string[];
}

// Interface pour les documents
export interface QuizDocument {
  id: string;
  title: string;
  content: string;
  topic: string;
  similarity?: number;
  source?: string;
}

// Interface pour les options de quiz avec documents complets
export interface GenerateQuizWithFullDocumentsOptions {
  preset: QuizPreset;
  subject: string;
  numQuestions: number;
  documents: QuizDocument[];
  difficulty?: Difficulty;
  questionTypes?: string[];
}

// Interface pour les options de quiz complet
export interface GenerateCompleteQuizOptions {
  preset: QuizPreset;
  subject: string;
  numQuestions: number;
  graphicType?: GraphicType;
  library?: GraphicLibrary;
  documentTopics?: string[];
  difficulty?: Difficulty;
  questionTypes?: string[];
}

// Interface pour les options de quiz standard
export interface GenerateStandardQuizOptions {
  preset: QuizPreset;
  subject: string;
  numQuestions: number;
  difficulty?: Difficulty;
  specialties?: string[];
  targetGrade?: number;
  questionTypes?: string[];
}

// Interface pour les réponses de quiz
export interface QuizAnswer {
  questionId: string;
  answer: string;
  timeSpent?: number;
}

// Interface pour les réponses au format legacy
export interface LegacyQuizAnswer {
  question_id: string;
  user_answer: string;
}

// Interface pour les données de graphique
export interface GraphicData {
  graphicId: string;
  config: any;
  library: GraphicLibrary;
  dataValues: number[];
  type?: string;
  description?: string;
  htmlContainer?: string;
  questionText?: string;
  questionId?: string;
}

// Interface pour les données de document
export interface DocumentData {
  documentId: string;
  title: string;
  content: string;
  topic: string;
  relevantPassages: string[];
}

// Interface pour les données de document simplifié (correction)
export interface DocumentReference {
  reference: string;
  questionId: string;
}

// Interface pour les questions
export interface QuizQuestion {
  id: string;
  type: string;
  question: string;
  options?: QuizOption[];
}

// Interface pour les options de question
export interface QuizOption {
  id: string;
  text: string;
  isCorrect?: boolean;
}

// Options de correction standard
export interface CorrectStandardQuizOptions {
  includeRecommendations?: boolean;
  personalizedFeedback?: boolean;
}

// Options de correction avec graphiques
export interface CorrectGraphicsQuizOptions {
  analyzeVisualSkills?: boolean;
  includeTrendAnalysis?: boolean;
}

// Options de correction documentaire
export interface CorrectDocumentaryQuizOptions {
  analyzeComprehension?: boolean;
  includeTextualEvidence?: boolean;
}

// Options de correction complète
export interface CorrectCompleteQuizOptions {
  analyzeCrossReferences?: boolean;
  generateLearningPath?: boolean;
  detailedCompetencies?: boolean;
}

// Options de correction générique
export interface CorrectQuizOptions {
  type?: CorrectionType;
  graphicsData?: GraphicData[];
  documentsData?: DocumentData[];
  questions?: QuizQuestion[];
  schoolLevel?: string;
  collegeGrade?: string;
  [key: string]: any;
}

// Options de génération de graphique
export interface GenerateGraphicOptions {
  chartType: ChartType;
  title: string;
  data: any;
  library: GraphicLibrary;
  educationalContext?: string;
}

// Options pour executeWithRetry
export interface RetryOptions {
  maxRetries?: number;
  retryDelay?: number;
  validateJson?: boolean;
  operationName?: string;
}

// Métadonnées de fichier
export interface FileUploadMetadata {
  uploadedFiles: number;
  fileIds: string[];
  documentsInfo: Array<{
    title: string;
    topic: string;
    contentLength: number;
  }>;
}

// Métadonnées de correction avec fichiers
export interface FileCorrectionMetadata {
  usedFiles: number;
  fileIds: string[];
  totalQuestions: number;
  documentaryQuestions: number;
  correctionMethod: string;
  timestamp: string;
}
