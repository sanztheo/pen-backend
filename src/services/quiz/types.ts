// Types pour le système de quiz basés sur le schéma Prisma

export enum SchoolLevel {
  COLLEGE = "COLLEGE",
  LYCEE_SECONDE = "LYCEE_SECONDE",
  LYCEE_PREMIERE = "LYCEE_PREMIERE",
  LYCEE_TERMINALE = "LYCEE_TERMINALE",
  ETUDES_SUPERIEURES = "ETUDES_SUPERIEURES",
}

export enum CollegeGrade {
  SIXIEME = "SIXIEME",
  CINQUIEME = "CINQUIEME",
  QUATRIEME = "QUATRIEME",
  TROISIEME = "TROISIEME",
}

export enum LyceeSpecialty {
  MATHEMATIQUES = "MATHEMATIQUES",
  PHYSIQUE_CHIMIE = "PHYSIQUE_CHIMIE",
  SVT = "SVT",
  HISTOIRE_GEO = "HISTOIRE_GEO",
  SES = "SES",
  LANGUES_LITTERATURE = "LANGUES_LITTERATURE",
  LLCER_ANGLAIS = "LLCER_ANGLAIS",
  LLCER_ESPAGNOL = "LLCER_ESPAGNOL",
  LLCER_ALLEMAND = "LLCER_ALLEMAND",
  LLCER_ITALIEN = "LLCER_ITALIEN",
  ARTS_PLASTIQUES = "ARTS_PLASTIQUES",
  MUSIQUE = "MUSIQUE",
  THEATRE = "THEATRE",
  CINEMA_AUDIOVISUEL = "CINEMA_AUDIOVISUEL",
  DANSE = "DANSE",
  HISTOIRE_DES_ARTS = "HISTOIRE_DES_ARTS",
  NSI = "NSI",
  SI = "SI",
  SCIENCES_INGENIEUR = "SCIENCES_INGENIEUR",
  BIOLOGIE_ECOLOGIE = "BIOLOGIE_ECOLOGIE",
  SPORT = "SPORT",
}

export enum QuestionType {
  OPEN_QUESTION = "OPEN_QUESTION",
  MULTIPLE_CHOICE = "MULTIPLE_CHOICE",
  TRUE_FALSE = "TRUE_FALSE",
  MATCHING = "MATCHING",
}

// Nouveaux presets pour examens officiels
export enum QuizPreset {
  NONE = "NONE",
  BREVET = "BREVET",
  BAC = "BAC",
  PARTIELS = "PARTIELS",
}

// Matières officielles pour les examens
export enum ExamSubject {
  // Brevet
  FRANCAIS = "FRANCAIS",
  MATHEMATIQUES = "MATHEMATIQUES",
  HISTOIRE_GEOGRAPHIE_EMC = "HISTOIRE_GEOGRAPHIE_EMC",
  SCIENCES = "SCIENCES",
  ORAL_BREVET = "ORAL_BREVET",

  // Bac général - Tronc commun
  PHILOSOPHIE = "PHILOSOPHIE",

  // Bac général - Spécialités (reprendre certaines LyceeSpecialty)
  HGGSP = "HGGSP",
  HLP = "HLP",
  LLCER = "LLCER",
  NSI_SPECIALITE = "NSI_SPECIALITE",
  SI_SPECIALITE = "SI_SPECIALITE",
  SES_SPECIALITE = "SES_SPECIALITE",
  SVT_SPECIALITE = "SVT_SPECIALITE",
  PHYSIQUE_CHIMIE_SPECIALITE = "PHYSIQUE_CHIMIE_SPECIALITE",
  MATHEMATIQUES_SPECIALITE = "MATHEMATIQUES_SPECIALITE",

  // Grand Oral
  GRAND_ORAL = "GRAND_ORAL",
}

// Configuration d'un quiz séquentiel
export interface SequentialQuizConfig {
  id: string;
  preset: QuizPreset;
  subjects: ExamSubject[];
  currentSubjectIndex: number;
  totalSubjects: number;
  isCompleted: boolean;
  globalScore?: number;
  globalMaxScore?: number;
  subjectResults: SubjectResult[];
  specialties?: LyceeSpecialty[]; // Pour le BAC
  higherEdField?: string; // Pour les PARTIELS
  metadata: {
    startedAt: Date;
    estimatedTotalTime: number; // en minutes
    realTotalTime?: number; // en minutes
    subjectsDocumentConfig?: Record<string, any>; // Configuration documentaire par matière
  };
}

// Résultat par matière
export interface SubjectResult {
  subject: ExamSubject;
  quizId?: string;
  isCompleted: boolean;
  score?: number;
  maxScore?: number;
  percentage?: number;
  timeSpent?: number; // en minutes
  isGenerating?: boolean; // Quiz suivant en cours de génération
  isCorrecting?: boolean; // Correction en cours
  subjectName?: string; // Nom personnalisé de la matière (pour Partiels et autres presets personnalisés)
  documentConfig?: {
    // NOUVEAU : Configuration documentaire dynamique par matière
    enableDocuments: boolean;
    documentTopics: string[];
    documentRatio: number;
    minDocumentLength: number;
    maxDocuments: number;
  };
  graphicConfig?: {
    // NOUVEAU : Configuration graphique dynamique par matière
    enableGraphics: boolean;
    graphicProbability: number; // 0-1
    preferredLibraries: ("apexcharts" | "plotly")[];
    graphicTypes: ("2d" | "3d")[];
  };
}

// Types pour les chunks de documents Wikipedia (système d'embeddings)
export interface DocumentChunk {
  id: number;
  title: string;
  content: string;
  source: string;
  topic: string;
  similarity: number;
}

// Interfaces pour les requêtes de génération de quiz
export interface QuizGenerationRequest {
  userId: string;
  schoolLevel: SchoolLevel;
  collegeGrade?: CollegeGrade;
  lyceeSpecialties?: LyceeSpecialty[];
  specialties?: LyceeSpecialty[]; // ✅ ADDED: For backward compatibility
  selectedSpecialties?: LyceeSpecialty[]; // ✅ ADDED: For BAC preset support
  higherEdLevel?: string; // ✅ Niveau d'études sup: L1, L2, L3, M1, M2, Doctorat, BTS, DUT, Prépa
  higherEdField?: string; // Filière: Informatique, Médecine, Droit...
  usePersonalization?: boolean; // ✅ Si true, récupère schoolLevel depuis les settings utilisateur (DB)
  targetGrade?: number;
  workspaceIds?: string[];
  questionTypes: QuestionType[];
  questionCount: number;
  title?: string;
  description?: string;
  preset?: QuizPreset;
  sequentialConfig?: Partial<SequentialQuizConfig>;
  specificSubject?: ExamSubject; // Pour générer un quiz spécifique dans une séquence
  coursesOnly?: boolean; // Si true, utilise uniquement le contenu des cours, sinon mélange cours + connaissances IA
  ragContext?: string; // ✅ ADDED: Contexte RAG construit par le frontend depuis les pages/projets sélectionnés
  documentConfig?: {
    // NOUVEAU : Configuration documentaire dynamique par matière
    enableDocuments: boolean;
    documentTopics: string[];
    documentRatio: number;
    minDocumentLength: number;
    maxDocuments: number;
  };
  graphicConfig?: {
    // NOUVEAU : Configuration graphique dynamique par matière
    enableGraphics: boolean;
    graphicProbability: number; // 0-1
    preferredLibraries: ("apexcharts" | "plotly")[];
    graphicTypes: ("2d" | "3d")[];
  };
}

// Types pour les documents d'étude (Histoire, Littérature, etc.)
export interface SubjectDocument {
  id: string;
  type: "text" | "image" | "pdf" | "audio";
  title: string;
  content: string; // Texte du document
  source?: string; // Source historique/littéraire
  context?: string; // Contexte historique/culturel
  period?: string; // Période historique (ex: "1789-1799")
  author?: string; // Auteur du document
  url?: string; // URL source si récupéré en ligne
}

// Un "Sujet" contient plusieurs questions thématiques liées
export interface QuizSubject {
  id: string;
  title: string; // "La Révolution française", "Les équations du second degré"
  description?: string; // Description du sujet/thème
  questions: Question[]; // Questions liées au thème (5-15 questions)
  documents?: SubjectDocument[]; // Documents d'étude pour Histoire, Littérature
  timeLimit?: number; // Temps pour tout le sujet en minutes
  difficulty: "facile" | "moyen" | "difficile";
  category?: string; // Catégorie thématique
  instructions?: string; // Instructions spécifiques pour le sujet
}

// Structure d'une question générique
export interface BaseQuestion {
  id: string;
  type: QuestionType;
  question: string;
  difficulty: "facile" | "moyen" | "difficile";
  points: number;
  category?: string;
  timeEstimate?: number; // en secondes
  latexRequired?: boolean; // indique si LaTeX est requis pour la réponse
  latexHint?: string; // indication sur l'utilisation du LaTeX
  subjectId?: string; // ID du sujet auquel appartient cette question
  documentRef?: string; // Référence au document d'étude si applicable
  basedOnDocument?: boolean; // Indique if la question est basée sur un document Wikipedia
  documentReference?: string; // Référence au document Wikipedia utilisé
  hasGraphic?: boolean; // Indique si la question contient un graphique IA
  graphicId?: string; // ID du graphique associé
  graphicLibrary?: "apexcharts" | "plotly"; // Bibliothèque utilisée pour le graphique
  graphicType?: string; // Type de graphique (line, bar, scatter, etc.)
  graphicDescription?: string; // Description du graphique pour accessibilité
  graphicConfig?: any; // Configuration JSON du graphique
  graphicDataValues?: number[]; // Valeurs clés du graphique pour correction IA
}

// Question ouverte
export interface OpenQuestion extends BaseQuestion {
  type: QuestionType.OPEN_QUESTION;
  expectedAnswer?: string;
  keywords?: string[];
  minWords?: number;
  maxWords?: number;
}

// Question à choix multiples
export interface MultipleChoiceQuestion extends BaseQuestion {
  type: QuestionType.MULTIPLE_CHOICE;
  options: {
    id: string;
    text: string;
    isCorrect: boolean;
  }[];
  multipleAnswers?: boolean;
}

// Question vrai/faux
export interface TrueFalseQuestion extends BaseQuestion {
  type: QuestionType.TRUE_FALSE;
  correctAnswer: boolean;
  explanation?: string;
}

// Question de correspondance
export interface MatchingQuestion extends BaseQuestion {
  type: QuestionType.MATCHING;
  leftColumn: {
    id: string;
    text: string;
  }[];
  rightColumn: {
    id: string;
    text: string;
  }[];
  correctMatches: {
    leftId: string;
    rightId: string;
  }[];
}

// Union type pour toutes les questions
export type Question =
  | OpenQuestion
  | MultipleChoiceQuestion
  | TrueFalseQuestion
  | MatchingQuestion;

// Structure d'un quiz généré
export interface GeneratedQuiz {
  id: string;
  title: string;
  aiGeneratedTitle?: string; // Titre accrocheur généré par l'IA
  description?: string;
  schoolLevel?: SchoolLevel;
  collegeGrade?: CollegeGrade;
  questions: Question[]; // Rétrocompatibilité avec l'ancien système
  subjects?: QuizSubject[]; // NOUVEAU: Système de sujets thématiques
  totalPoints?: number;
  estimatedTime?: number; // en minutes
  subjectBased?: boolean; // true = nouveau système, false/undefined = ancien système
  sourceDocuments?: any[]; // Documents Wikipedia utilisés pour la génération
  hasDocuments?: boolean; // Indique si le quiz contient des documents
  graphicsData?: any[]; // Graphiques IA générés pour le quiz
  hasGraphics?: boolean; // Indique si le quiz contient des graphiques IA
  metadata?: {
    generatedAt: Date;
    aiModel?: string;
    generationTime?: number;
    basedOnWorkspaces?: string[];
    documentBased?: boolean;
    documentsUsed?: number;
    documentRatio?: number;
  };
}

// Réponses utilisateur
export interface UserAnswer {
  questionId: string;
  answer: any; // Type flexible pour différents types de réponses
  timeSpent?: number; // en secondes
  confidence?: number; // 1-5
}

// Requête de correction
export interface QuizCorrectionRequest {
  quizId: string;
  userId: string;
  userAnswers: UserAnswer[];
  schoolLevel: SchoolLevel;
  collegeGrade?: CollegeGrade;
  targetGrade?: number;
  submittedAt: Date;
  preset?: QuizPreset; // Pour utiliser les prompts spécialisés
  specificSubject?: ExamSubject; // Pour la correction spécifique par matière
  coursesOnly?: boolean; // Si true, la correction doit se baser uniquement sur le contenu des cours
  workspaceContent?: WorkspaceAnalysisResult[]; // Contenu des workspaces pour la correction
  sourceDocuments?: DocumentChunk[]; // NOUVEAU : Documents Wikipedia sources pour corriger les questions documentaires
  hasDocuments?: boolean; // NOUVEAU : Indique si le quiz contient des documents
}

// Résultat de correction d'une question
export interface QuestionResult {
  questionId: string;
  isCorrect: boolean;
  score: number;
  maxScore: number;
  feedback: string;
  correctAnswer?: any;
  explanation?: string;
  difficulty: string;
  timeSpent?: number;
}

// Résultat complet du quiz
export interface QuizCorrectionResult {
  quizId: string;
  totalScore: number;
  maxScore: number;
  percentage: number;
  adaptedGrade: number;
  gradeScale: string;
  questionResults: QuestionResult[];
  detailedScoring?: QuestionResult[]; // Alias pour compatibilité frontend
  aiCorrection: {
    globalFeedback: string;
    strengths: string[];
    weaknesses: string[];
    recommendations: string[];
    timeAnalysis?: {
      totalTime: number;
      averageTimePerQuestion: number;
      timeDistribution: any;
    };
    difficultyAnalysis?: {
      easyQuestions: { correct: number; total: number };
      mediumQuestions: { correct: number; total: number };
      hardQuestions: { correct: number; total: number };
    };
  };
  metadata: {
    correctedAt: Date;
    aiModel: string;
    correctionTime: number;
    personalizedTips?: string[];
  };
}

// Préférences utilisateur
export interface UserQuizPreferences {
  id: string;
  userId: string;
  schoolLevel: SchoolLevel;
  collegeGrade?: CollegeGrade;
  lyceeSpecialties: LyceeSpecialty[];
  higherEdField?: string;
  preferredWorkspace?: string;
  targetGrade?: number;
  questionTypes: QuestionType[];
  defaultQuestionCount: number;
}

// Options pour l'analyse de contenu workspace
export interface WorkspaceAnalysisOptions {
  workspaceIds: string[];
  maxPages?: number;
  includeBlocks?: boolean;
  contentTypes?: string[];
  minContentLength?: number;
  schoolLevel?: SchoolLevel; // Niveau scolaire pour l'analyse
}

// Options pour l'analyse de contenu pages/projets spécifiques
export interface PageProjectAnalysisOptions {
  pageProjectIds: string[];
  maxPagesPerProject?: number;
  includeBlocks?: boolean;
  contentTypes?: string[];
  minContentLength?: number;
  schoolLevel?: SchoolLevel; // Niveau scolaire pour l'analyse
}

// Résultat d'analyse de workspace
export interface WorkspaceAnalysisResult {
  workspaceId: string;
  workspaceName: string;
  totalPages: number;
  analyzedPages: number;
  contentSummary: {
    totalWords: number;
    mainTopics: string[];
    complexity: "basique" | "intermédiaire" | "avancé";
    suggestedQuestionCount: number;
  };
  extractedContent: {
    pageId: string;
    title: string;
    content: string;
    relevanceScore: number;
  }[];
}

// Templates de prompts pour l'IA
export interface PromptTemplate {
  id: string;
  name: string;
  type: "generation" | "correction" | "analysis";
  schoolLevel?: SchoolLevel;
  questionType?: QuestionType;
  template: string;
  variables: string[];
  description: string;
}

// Statistiques de progression utilisateur
export interface UserProgressStats {
  userId: string;
  totalQuizzes: number;
  averageScore: number;
  bestScore: number;
  recentScores: number[];
  subjectPerformance: {
    [subject: string]: {
      averageScore: number;
      quizCount: number;
      trend: "improving" | "stable" | "declining";
    };
  };
  difficultyPerformance: {
    facile: { averageScore: number; count: number };
    moyen: { averageScore: number; count: number };
    difficile: { averageScore: number; count: number };
  };
  timeAnalytics: {
    averageQuizTime: number;
    averageTimePerQuestion: number;
    efficiency: number; // score/temps
  };
}
