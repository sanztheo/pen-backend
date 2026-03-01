import { AIService } from "../../ai/base.js";
import { logger } from "../../../utils/logger.js";
import { MODELS } from "../../../config/models.js";
import {
  QuizGenerationRequest,
  GeneratedQuiz,
  WorkspaceAnalysisResult,
  Question,
  QuestionType,
} from "../types.js";
import { PromptUtils } from "../utils/promptUtils.js";
import { JsonUtils } from "../utils/jsonUtils.js";
import { SubjectGenerator } from "./subjectGenerator.js";
import {
  documentBasedQuizGenerator,
  DocumentBasedQuizResult,
} from "../generation/documentBasedQuizGenerator.js";
import {
  GraphicBasedQuizGenerator,
  GraphicBasedQuizResult,
} from "../generation/graphicBasedQuizGenerator.js";
import { AIGraphicGenerator } from "../graphics/aiGraphicGenerator.js";
import { PARTIELS_CONFIG } from "../presets/partiels/index.js";
import { BAC_CONFIG } from "../presets/bac/index.js";
import { BREVET_CONFIG } from "../presets/brevet/index.js";

type Difficulty = "facile" | "moyen" | "difficile";
type GraphicLibrary = "apexcharts" | "plotly";

function isDifficulty(value: string): value is Difficulty {
  return value === "facile" || value === "moyen" || value === "difficile";
}

function isGraphicLibrary(value: string): value is GraphicLibrary {
  return value === "apexcharts" || value === "plotly";
}

// Interface pour une option QCM
interface QuizOption {
  id: string;
  text: string;
  isCorrect?: boolean;
}

// Interface pour un élément de matching
interface MatchingItem {
  id: string;
  text: string;
}

// Interface pour une question brute de l'IA
interface QuizQuestionFromAI {
  id?: string;
  type: string;
  question: string;
  options?: QuizOption[];
  leftColumn?: MatchingItem[];
  rightColumn?: MatchingItem[];
  correctMatches?: Array<{ leftId: string; rightId: string }>;
  correctAnswer?: boolean;
  expectedAnswer?: string;
  multipleAnswers?: boolean;
  points?: number;
  difficulty?: string;
  timeEstimate?: number;
  category?: string;
  hasGraphic?: boolean;
  graphicConfig?: Record<string, unknown>;
  graphicType?: string;
  graphicLibrary?: string;
  graphicDescription?: string;
  graphicDataValues?: number[];
  htmlContainer?: string;
  [key: string]: unknown;
}

// Interface pour le résultat JSON du quiz généré par l'IA
interface QuizDataFromAI {
  title?: string;
  aiGeneratedTitle?: string;
  description?: string;
  questions: QuizQuestionFromAI[];
}

// Interface pour la configuration graphique d'une matière
interface SubjectGraphicConfiguration {
  enableAIGraphics: boolean;
  graphicProbability: number;
  preferredLibrary: "auto" | "apexcharts" | "plotly";
}

// Interface pour le mapping des topics par matière
interface TopicMapping {
  [pattern: string]: string;
}

// Interface pour le résumé de contenu workspace
interface WorkspaceContentSummary {
  workspace: string;
  topics: string;
  content: string;
}

// Interface pour la configuration documentaire
interface DocumentConfiguration {
  enableDocuments: boolean;
  documentTopics: string[];
  documentRatio: number;
  minDocumentLength: number;
  maxDocuments: number;
}

// Interface pour la configuration graphique générale
interface GraphicConfiguration {
  enableGraphics: boolean;
  probability?: number;
  preferredLibrary?: "auto" | "apexcharts" | "plotly";
}

/**
 * Générateur de quiz avec IA et support graphiques
 */
export class QuizGenerator {
  private static aiGraphicGenerator = new AIGraphicGenerator();

  private static toQuestionFromAI(q: QuizQuestionFromAI): Question {
    const difficulty: Difficulty =
      typeof q.difficulty === "string" && isDifficulty(q.difficulty) ? q.difficulty : "moyen";

    const graphicLibrary: GraphicLibrary | undefined =
      typeof q.graphicLibrary === "string" && isGraphicLibrary(q.graphicLibrary)
        ? q.graphicLibrary
        : undefined;

    const base = {
      id: q.id || `q_${Date.now()}_${Math.random()}`,
      question: q.question,
      difficulty,
      points: q.points || 1,
      category: q.category || "Général",
      timeEstimate: q.timeEstimate || 30,
      hasGraphic: q.hasGraphic,
      graphicConfig: q.graphicConfig ?? null,
      graphicType: q.graphicType,
      graphicDescription: q.graphicDescription,
      graphicDataValues: Array.isArray(q.graphicDataValues)
        ? q.graphicDataValues.filter((v) => typeof v === "number")
        : undefined,
      graphicLibrary,
    };

    if (q.type === QuestionType.MULTIPLE_CHOICE) {
      return {
        ...base,
        type: QuestionType.MULTIPLE_CHOICE,
        options: (q.options ?? []).map((o, index) => ({
          id: o.id || `option_${index + 1}`,
          text: o.text,
          isCorrect: o.isCorrect ?? false,
        })),
        multipleAnswers: q.multipleAnswers,
      };
    }

    if (q.type === QuestionType.TRUE_FALSE) {
      return {
        ...base,
        type: QuestionType.TRUE_FALSE,
        correctAnswer: q.correctAnswer ?? true,
      };
    }

    if (q.type === QuestionType.MATCHING) {
      return {
        ...base,
        type: QuestionType.MATCHING,
        leftColumn: q.leftColumn ?? [],
        rightColumn: q.rightColumn ?? [],
        correctMatches: q.correctMatches ?? [],
      };
    }

    return {
      ...base,
      type: QuestionType.OPEN_QUESTION,
      expectedAnswer: q.expectedAnswer,
    };
  }

  /**
   * Détermine le nombre maximum de tokens selon le preset utilisé
   */
  private static getMaxTokensForPreset(preset?: string): number {
    logger.log("🔍 [TOKEN-DETECTION] Preset reçu:", preset);

    // Presets officiels : 32K tokens pour des quiz plus longs et détaillés
    if (preset === "BREVET" || preset === "BAC" || preset === "PARTIELS") {
      logger.log("🚀 [TOKEN-DETECTION] Preset officiel détecté → 32K tokens");
      return 32000; // gpt-4o-mini supporte bien les longs contextes
    }

    // Quiz personnalisés : 16K tokens (limite standard)
    logger.log("📝 [TOKEN-DETECTION] Quiz personnalisé → 16K tokens");
    return 16000;
  }

  /**
   * Détermine si on doit utiliser le nouveau système de sujets
   */
  private static shouldUseSubjectBasedGeneration(request: QuizGenerationRequest): boolean {
    // Utiliser le système de sujets pour les presets officiels
    const officialPresets = ["BREVET", "BAC", "PARTIELS"];
    return officialPresets.includes(request.preset || "");
  }

  /**
   * Détermine si un graphique améliore une question selon sa matière et son contenu
   */
  private static shouldGenerateGraphic(
    subject: string,
    questionContent: string,
    level: string,
  ): boolean {
    const graphicProbabilities = this.getGraphicConfigForSubject(subject);

    // Vérifier si la matière supporte les graphiques
    if (!graphicProbabilities.enableAIGraphics) return false;

    // Analyse du contenu pour détecter les mots-clés graphiques
    const graphicKeywords = [
      // Physique
      "oscillation",
      "sinusoïd",
      "courbe",
      "graphique",
      "position",
      "vitesse",
      "temps",
      "force",
      "champ",
      "onde",
      "fréquence",
      "amplitude",
      "phase",
      // Mathématiques
      "fonction",
      "dérivée",
      "intégrale",
      "courbe",
      "parabole",
      "droite",
      "tangente",
      "statistique",
      "histogramme",
      "distribution",
      "géométrie",
      "triangle",
      "cercle",
      // Chimie
      "concentration",
      "réaction",
      "cinétique",
      "équilibre",
      "titrage",
      "pH",
      "spectre",
      "orbitale",
      "liaison",
      "molécule",
      // SVT
      "croissance",
      "évolution",
      "génétique",
      "arbre",
      "pyramide",
      "écosystème",
    ];

    const hasGraphicKeywords = graphicKeywords.some((keyword) =>
      questionContent.toLowerCase().includes(keyword),
    );

    // Décision probabiliste basée sur la configuration et les mots-clés
    if (hasGraphicKeywords) {
      return Math.random() < graphicProbabilities.graphicProbability;
    }

    // Probabilité réduite sans mots-clés explicites
    return Math.random() < graphicProbabilities.graphicProbability * 0.3;
  }

  /**
   * Obtient la configuration graphique pour une matière donnée
   */
  private static getGraphicConfigForSubject(subject: string): SubjectGraphicConfiguration {
    const configs: Record<string, SubjectGraphicConfiguration> = {
      Physique: {
        enableAIGraphics: true,
        graphicProbability: 0.7,
        preferredLibrary: "auto", // Auto-sélection entre ApexCharts et Plotly
      },
      Mathématiques: {
        enableAIGraphics: true,
        graphicProbability: 0.8,
        preferredLibrary: "auto",
      },
      Chimie: {
        enableAIGraphics: true,
        graphicProbability: 0.6,
        preferredLibrary: "auto",
      },
      SVT: {
        enableAIGraphics: true,
        graphicProbability: 0.5,
        preferredLibrary: "auto",
      },
    };

    return (
      configs[subject] || {
        enableAIGraphics: false,
        graphicProbability: 0,
        preferredLibrary: "apexcharts",
      }
    );
  }

  /**
   * Enrichit les questions avec des graphiques générés par l'IA
   */
  private static async enrichQuestionsWithGraphics(
    questions: QuizQuestionFromAI[],
    subject: string,
    level: string,
  ): Promise<QuizQuestionFromAI[]> {
    logger.log(`🎨 [GRAPHICS] Enrichissement des questions pour ${subject} niveau ${level}`);

    const enrichedQuestions = [];

    for (const question of questions) {
      let enrichedQuestion = { ...question };

      // Déterminer si cette question bénéficierait d'un graphique
      if (this.shouldGenerateGraphic(subject, question.question || "", level)) {
        try {
          logger.log(
            `📊 [GRAPHICS] Génération graphique pour: "${question.question?.substring(0, 50)}..."`,
          );

          // Extraire le topic depuis la question ou utiliser un topic générique
          const topic = this.extractTopicFromQuestion(question.question || "", subject);

          // Générer le graphique avec l'IA
          const graphic = await this.aiGraphicGenerator.generateGraphicWithAI({
            subject,
            topic,
            level,
            questionContext: question.question || "",
          });

          // Ajouter le graphique à la question
          enrichedQuestion = {
            ...enrichedQuestion,
            hasGraphic: true,
            graphicConfig: graphic.config,
            graphicType: graphic.type,
            graphicLibrary: graphic.library,
            graphicDescription: graphic.description,
            graphicDataValues: graphic.dataValues,
            htmlContainer: graphic.htmlContainer || "quiz-graphic-container",
          };

          logger.log(
            `✅ [GRAPHICS] Graphique ${graphic.type} (${graphic.library}) ajouté à la question`,
          );
        } catch (error) {
          logger.error("❌ [GRAPHICS] Erreur génération graphique:", error);
          // Continuer sans graphique en cas d'erreur
        }
      }

      enrichedQuestions.push(enrichedQuestion);
    }

    const graphicsCount = enrichedQuestions.filter((q) => q.hasGraphic).length;
    logger.log(
      `🎨 [GRAPHICS] ${graphicsCount}/${questions.length} questions enrichies avec des graphiques`,
    );

    return enrichedQuestions;
  }

  /**
   * Extrait le topic principal d'une question pour la génération de graphique
   */
  private static extractTopicFromQuestion(questionText: string, subject: string): string {
    const lowerText = questionText.toLowerCase();

    // Mapping de mots-clés vers des topics spécifiques
    const topicMappings: Record<string, TopicMapping> = {
      Physique: {
        "oscillation|sinusoïd|périod|fréquence|amplitude": "oscillations",
        "position|vitesse|accélération|mouvement|cinématique": "cinématique",
        "force|champ|vecteur": "forces",
        "rayon|lentille|miroir|optique": "optique",
        "circuit|électrique|courant|tension": "électricité",
      },
      Mathématiques: {
        "fonction|courbe|dérivée|tangente": "fonctions",
        "intégrale|primitive|aire": "intégrales",
        "statistique|moyenne|histogramme|distribution": "statistiques",
        "triangle|cercle|géométrie|angle": "géométrie",
        "probabilité|chance|événement": "probabilités",
      },
      Chimie: {
        "concentration|réaction|cinétique|vitesse": "cinétique",
        "équilibre|titrage|ph|acide|base": "équilibres",
        "orbitale|électron|atome|liaison": "orbitales",
        "spectre|absorption|émission": "spectroscopie",
      },
      SVT: {
        "croissance|développement|taille": "physiologie",
        "génétique|hérédité|allèle|chromosome": "génétique",
        "écosystème|chaîne|pyramide|population": "écologie",
        "anatomie|organe|système|corps": "anatomie",
      },
    };

    const subjectMappings: TopicMapping = topicMappings[subject] || {};

    for (const [pattern, topic] of Object.entries(subjectMappings)) {
      const regex = new RegExp(pattern, "i");
      if (regex.test(lowerText)) {
        return topic as string;
      }
    }

    // Topic générique si aucun pattern trouvé
    return "default";
  }

  /**
   * Génère un quiz complet basé sur les paramètres
   */
  static async generateQuiz(request: QuizGenerationRequest): Promise<GeneratedQuiz> {
    const startTime = Date.now();

    // Décider quel système de génération utiliser
    if (this.shouldUseSubjectBasedGeneration(request)) {
      return await this.generateSubjectBasedQuiz(request, startTime);
    } else {
      return await this.generateTraditionalQuiz(request, startTime);
    }
  }

  /**
   * Génère un quiz avec le nouveau système de sujets (avec support documentaire)
   */
  private static async generateSubjectBasedQuiz(
    request: QuizGenerationRequest,
    startTime: number,
  ): Promise<GeneratedQuiz> {
    logger.log("📚 [SUBJECT-GENERATION] Utilisation du système de sujets thématiques");

    try {
      // Vérifier quel système utiliser : documents, graphiques, ou standard
      const documentConfig = this.getDocumentConfig(request);
      const graphicConfig = this.getGraphicConfig(request);
      const subjectName = this.getCurrentSubjectName(request);

      logger.log(`📄 [DOCUMENTS] Configuration pour ${subjectName}:`, documentConfig);
      logger.log(`🎨 [GRAPHICS] Configuration pour ${subjectName}:`, graphicConfig);

      // Priorité aux graphiques pour les matières scientifiques
      if (graphicConfig && graphicConfig.enableGraphics) {
        // Génération avec graphiques IA (workflow: graphique → questions)
        logger.log("🎨 [GRAPHICS] Génération quiz graphique activée");
        const graphicResult = await GraphicBasedQuizGenerator.generateGraphicBasedQuiz(
          request,
          subjectName,
          request.questionCount || 3,
        );

        // Ajouter les métadonnées graphiques au quiz
        const enhancedQuiz = {
          ...graphicResult.quiz,
          metadata: {
            generatedAt: new Date(),
            ...graphicResult.quiz.metadata,
            graphicMetadata: graphicResult.graphicMetadata,
            generationTime: Date.now() - startTime,
          },
        };

        logger.log(
          `✅ [GRAPHICS] Quiz graphique généré avec ${graphicResult.graphicMetadata.generatedGraphics.length} graphiques`,
        );
        return enhancedQuiz;
      }

      if (documentConfig && documentConfig.enableDocuments) {
        // Génération avec documents
        logger.log("📚 [DOCUMENTS] Génération quiz documentaire activée");
        const documentResult = await documentBasedQuizGenerator.generateDocumentBasedQuiz(
          request,
          subjectName,
          documentConfig,
        );

        // Ajouter les métadonnées documentaires au quiz
        const enhancedQuiz = {
          ...documentResult.quiz,
          metadata: {
            generatedAt: new Date(),
            ...documentResult.quiz.metadata,
            documentMetadata: documentResult.documentMetadata,
            generationTime: Date.now() - startTime,
          },
        };

        logger.log(
          `✅ [DOCUMENTS] Quiz documentaire généré avec ${documentResult.documentMetadata.sourceDocuments.length} documents`,
        );

        // DEBUG: Vérifier les données avant retour
        logger.log("🐛 DEBUG quizGenerator enhancedQuiz:", {
          hasSourceDocuments: !!enhancedQuiz.sourceDocuments,
          sourceDocumentsLength: enhancedQuiz.sourceDocuments?.length,
          hasDocuments: enhancedQuiz.hasDocuments,
          keys: Object.keys(enhancedQuiz),
        });

        return enhancedQuiz;
      }

      // Génération classique si pas de documents
      logger.log("📝 [SUBJECT-GENERATION] Génération classique sans documents");

      // Générer les sujets thématiques
      const subjects = await SubjectGenerator.generateSubjects(request);

      // Note : L'enrichissement graphique est maintenant géré par GraphicBasedQuizGenerator
      // avec le workflow "graphique-d'abord"

      // Calculer les totaux
      const totalQuestions = subjects.reduce((sum, subject) => sum + subject.questions.length, 0);
      const totalPoints = subjects.reduce(
        (sum, subject) => sum + subject.questions.reduce((subSum, q) => subSum + q.points, 0),
        0,
      );
      const estimatedTime = subjects.reduce((sum, subject) => sum + (subject.timeLimit || 0), 0);

      return {
        id: `quiz_${Date.now()}`,
        title: `Quiz ${request.preset} - ${this.getSubjectDisplayName(request)}`,
        aiGeneratedTitle: `🎯 Examen ${request.preset} - ${this.getSubjectDisplayName(request)}`,
        description: `Quiz thématique avec ${subjects.length} sujets`,
        schoolLevel: request.schoolLevel,
        collegeGrade: request.collegeGrade,
        questions: [], // Vide pour le nouveau système
        subjects, // NOUVEAU: Sujets thématiques
        totalPoints,
        estimatedTime,
        subjectBased: true, // NOUVEAU: Indicateur du système utilisé
        metadata: {
          generatedAt: new Date(),
          aiModel: MODELS.PREPROCESSOR,
          generationTime: Date.now() - startTime,
        },
      };
    } catch (error) {
      logger.error("❌ Erreur génération quiz par sujets:", error);
      throw error;
    }
  }

  /**
   * Génère un quiz avec l'ancien système (rétrocompatibilité)
   */
  private static async generateTraditionalQuiz(
    request: QuizGenerationRequest,
    startTime: number,
  ): Promise<GeneratedQuiz> {
    logger.log("📝 [TRADITIONAL-GENERATION] Utilisation du système question par question");

    try {
      // Construction du prompt personnalisé (preset ou niveau générique)
      const levelPrompt = PromptUtils.getGenerationPrompt(request);
      const specialtiesText = request.lyceeSpecialties?.join(", ") || "";
      const higherEdText = request.higherEdField || "";

      // Ajout de la logique coursesOnly pour les quiz génériques
      const contentSourceInstruction = request.coursesOnly
        ? "RÈGLE ABSOLUE : Tu DOIS base les questions EXCLUSIVEMENT sur le contenu des cours fournis ci-dessous. INTERDIT d'utiliser tes connaissances externes ou générales. Si une information n'est pas présente dans le contenu fourni, NE PAS créer de question sur ce sujet. SEUL le contenu explicite des cours doit être utilisé. Si le contenu est insuffisant, signaler l'erreur plutôt que d'inventer."
        : request.workspaceIds && request.workspaceIds.length > 0
          ? "INSTRUCTIONS CONTENU : Base 70% des questions sur le contenu des workspaces fournis et 30% sur tes connaissances générales du niveau scolaire pour enrichir le quiz."
          : "Génère des questions basées sur tes connaissances du programme scolaire officiel.";

      const prompt = `
${levelPrompt}

PARAMÈTRES DU QUIZ :
- Niveau scolaire : ${request.schoolLevel}
${request.collegeGrade ? `- Classe de collège : ${request.collegeGrade}` : ""}
${specialtiesText ? `- Spécialités : ${specialtiesText}` : ""}
${higherEdText ? `- Filière d'études supérieures : ${higherEdText}` : ""}
- Nombre de questions : ${request.questionCount}
- Types de questions : ${request.questionTypes.join(", ")}
${request.targetGrade ? `- Note cible : ${request.targetGrade}/20` : ""}

${contentSourceInstruction}

INSTRUCTIONS :
1. Génère exactement ${request.questionCount} questions
2. Répartis équitablement les types de questions demandés
3. Varie les niveaux de difficulté (30% facile, 50% moyen, 20% difficile)
4. IMPORTANT : Chaque question vaut exactement 1 point (le système convertira automatiquement sur 20)
5. Estime le temps nécessaire pour chaque question
${PromptUtils.getLatexInstructions()}

${PromptUtils.getQuestionInstructionsTemplate()}

Structure finale attendue :
{
  "title": "Titre du quiz basique", 
  "aiGeneratedTitle": "Titre accrocheur et motivant pour l'élève",
  "description": "Description du quiz",
  "questions": [/* array de questions suivant les formats ci-dessus */]
}

IMPORTANT pour le titre IA :
- aiGeneratedTitle doit être accrocheur et motivant 
- Maximum 60 caractères
- Adapté au niveau scolaire (vocabulaire de l'âge)
- Évoque le contenu sans spoiler les réponses
- Exemples : "🧪 Découverte des Sciences", "🏛️ Voyage en Histoire", "🔢 Défi Mathématiques"
`;

      // Génération via IA - Tokens ajustés selon le preset
      const maxTokens = this.getMaxTokensForPreset(request.preset);
      const result = await AIService.generateContent({
        prompt,
        maxTokens,
        temperature: 0.7,
        model: AIService.getDefaultModel(),
      });

      // Parse du JSON avec robustesse améliorée
      const extracted = JsonUtils.extractJsonFromText(result.content);

      // Normalisation intelligente du format de réponse IA
      const normalizedQuizData = this.normalizeQuizData(extracted);

      // Validation et normalisation des questions
      // Pour les quiz personnalisés (NONE), toutes les questions valent 1 point
      normalizedQuizData.questions = normalizedQuizData.questions.map(
        (q: QuizQuestionFromAI, index: number) => {
          // Supprimer les doublons dans les QCM
          if (q.type === "MULTIPLE_CHOICE" && q.options) {
            q.options = this.removeDuplicateOptions(q.options, q.id || `Q${index + 1}`);
          }

          // Supprimer les doublons dans les questions de matching
          if (q.type === "MATCHING") {
            if (q.leftColumn) {
              q.leftColumn = this.removeDuplicateMatchingItems(
                q.leftColumn,
                "leftColumn",
                q.id || `Q${index + 1}`,
              );
            }
            if (q.rightColumn) {
              q.rightColumn = this.removeDuplicateMatchingItems(
                q.rightColumn,
                "rightColumn",
                q.id || `Q${index + 1}`,
              );
            }
          }

          return {
            ...q,
            id: q.id || `Q${index + 1}`,
            points: 1, // Toujours 1 point pour les quiz personnalisés
            difficulty: q.difficulty || "moyen",
            timeEstimate: q.timeEstimate || 30,
            category: q.category || "Général",
          };
        },
      );

      // 🎨 NOUVEAU : Enrichissement avec graphiques IA
      const subjectName = this.getSubjectDisplayName(request);
      normalizedQuizData.questions = await this.enrichQuestionsWithGraphics(
        normalizedQuizData.questions,
        subjectName,
        request.schoolLevel,
      );

      // Construction du quiz final
      const quiz: GeneratedQuiz = {
        id: `quiz_${Date.now()}`,
        title: normalizedQuizData.title || `Quiz ${request.schoolLevel}`,
        aiGeneratedTitle: normalizedQuizData.aiGeneratedTitle, // ✅ Titre généré par l'IA
        description: normalizedQuizData.description,
        schoolLevel: request.schoolLevel,
        questions: normalizedQuizData.questions.map((q) => this.toQuestionFromAI(q)),
        totalPoints: normalizedQuizData.questions.reduce(
          (sum: number, q: QuizQuestionFromAI) => sum + (q.points || 1),
          0,
        ),
        estimatedTime: Math.ceil(
          normalizedQuizData.questions.reduce(
            (sum: number, q: QuizQuestionFromAI) => sum + (q.timeEstimate || 60),
            0,
          ) / 60,
        ),
        metadata: {
          generatedAt: new Date(),
          aiModel: result.model,
          generationTime: Date.now() - startTime,
          basedOnWorkspaces: request.workspaceIds,
        },
      };

      return quiz;
    } catch (error) {
      logger.error("Erreur génération quiz IA:", error);
      throw new Error(
        `Échec de la génération du quiz: ${error instanceof Error ? error.message : "Erreur inconnue"}`,
      );
    }
  }

  /**
   * Helper: Obtient le nom d'affichage de la matière
   */
  private static getSubjectDisplayName(request: QuizGenerationRequest): string {
    if (request.specificSubject) {
      // Mapper les ExamSubject vers des noms lisibles
      const subjectNames: Record<string, string> = {
        FRANCAIS: "Français",
        MATHEMATIQUES: "Mathématiques",
        HISTOIRE_GEOGRAPHIE_EMC: "Histoire-Géographie",
        SCIENCES: "Sciences",
        PHILOSOPHIE: "Philosophie",
        HGGSP: "Histoire-Géographie, géopolitique et sciences politiques",
        HLP: "Humanités, littérature et philosophie",
        NSI_SPECIALITE: "Numérique et sciences informatiques",
        SI_SPECIALITE: "Sciences de l'ingénieur",
        SES_SPECIALITE: "Sciences économiques et sociales",
        SVT_SPECIALITE: "Sciences de la vie et de la terre",
        PHYSIQUE_CHIMIE_SPECIALITE: "Physique-Chimie",
        MATHEMATIQUES_SPECIALITE: "Mathématiques (Spécialité)",
        GRAND_ORAL: "Grand Oral",
      };

      return subjectNames[request.specificSubject] || request.specificSubject;
    }

    if (request.higherEdField) {
      return request.higherEdField;
    }

    return "Matière générale";
  }

  /**
   * Génère un quiz basé sur le contenu d'un workspace
   */
  static async generateQuizFromWorkspace(
    request: QuizGenerationRequest,
    workspaceContent: WorkspaceAnalysisResult[],
    ragContext?: string,
  ): Promise<GeneratedQuiz> {
    const startTime = Date.now();

    try {
      logger.log(
        "📄 [CONTENT] Génération basée sur contenu utilisateur avec coursesOnly:",
        request.coursesOnly,
      );

      // Utiliser un prompt spécialisé pour le contenu utilisateur au lieu du prompt générique
      const basePrompt = request.coursesOnly
        ? `Tu es un assistant pédagogique spécialisé dans la création de quiz basés UNIQUEMENT sur le contenu fourni par l'utilisateur.`
        : `Tu es un professeur expérimenté capable de créer des quiz en combinant le contenu fourni avec tes connaissances pédagogiques.`;

      // Extraction du contenu pertinent
      const contentSummary = workspaceContent.map((ws) => ({
        workspace: ws.workspaceName,
        topics: ws.contentSummary.mainTopics.join(", "),
        content: ws.extractedContent
          .slice(0, 3)
          .map((c) => c.content)
          .join("\n\n"),
      }));

      // Validation du contenu pour le mode "coursesOnly"
      const totalContentLength = contentSummary.reduce((sum, cs) => sum + cs.content.length, 0);

      if (request.coursesOnly && totalContentLength < 100) {
        throw new Error(
          "Contenu des cours insuffisant pour générer un quiz. Veuillez ajouter plus d'informations dans vos pages ou désactiver l'option \"Utiliser uniquement les cours\".",
        );
      }

      const prompt = `
${basePrompt}

CONTENU SOURCE UTILISATEUR :
${contentSummary
  .map(
    (cs) => `
Source: ${cs.workspace}
Sujets principaux: ${cs.topics}
Contenu extrait:
${cs.content}
`,
  )
  .join("\n---\n")}${
        ragContext
          ? `

🧠 CONTEXTE ENRICHI PAR IA (RAG) :
${ragContext}

NOTES RAG :
- Ce contexte complète le contenu de vos pages avec des informations pertinentes
- Utilise ce contexte pour enrichir les questions et explications
- Privilégie toujours le contenu utilisateur, puis ce contexte en complément`
          : ""
      }

PARAMÈTRES DU QUIZ :
- Niveau scolaire : ${request.schoolLevel}
- Nombre de questions : ${request.questionCount}
- Types de questions : ${request.questionTypes.join(", ")}

INSTRUCTIONS :
${
  request.coursesOnly
    ? `⚠️ MODE STRICT COURS UNIQUEMENT - RÈGLES ABSOLUES :
1. Base les questions EXCLUSIVEMENT sur le contenu fourni ci-dessous
2. INTERDIT TOTAL d'utiliser tes connaissances générales ou externes
3. Si une information n'existe pas dans le contenu fourni, NE PAS créer de question sur ce sujet
4. Chaque question DOIT pouvoir être répondue en se basant UNIQUEMENT sur le contenu fourni
5. En cas de doute, préférer moins de questions mais 100% basées sur le contenu
6. NE JAMAIS inventer, supposer ou compléter avec tes connaissances`
    : `1. Base 70% des questions sur le contenu fourni par l'utilisateur
2. Complète avec 30% de questions basées sur tes connaissances du niveau scolaire
3. Assure-toi que les questions enrichissent et testent la compréhension`
}
4. Génère ${request.questionCount} questions pertinentes
5. Varie les niveaux de difficulté selon le niveau scolaire
6. IMPORTANT : Chaque question vaut exactement 1 point (le système convertira automatiquement sur 20)
7. Cite la source d'origine dans la catégorie

IMPORTANT : Réponds UNIQUEMENT en JSON valide, sans texte explicatif. 

${PromptUtils.getQuestionInstructionsTemplate()}

Structure finale attendue :
{
  "title": "Titre du quiz basique",
  "aiGeneratedTitle": "Titre accrocheur inspiré du contenu workspace",
  "description": "Description du quiz",
  "questions": [/* array de questions suivant les formats ci-dessus */]
}

IMPORTANT pour le titre IA :
- aiGeneratedTitle doit refléter le contenu analysé
- Maximum 60 caractères
- Accrocheur et motivant pour l'élève
- Évoque les sujets traités sans spoiler
- Exemples : "📚 Exploration de vos Notes", "🎯 Maîtrise de vos Cours"
`;

      // Quiz basés sur contenu utilisateur = toujours 16K tokens (contenu personnalisé)
      const result = await AIService.generateContent({
        prompt,
        maxTokens: 16000, // Contenu personnalisé garde la limite standard
        temperature: 0.7,
        model: AIService.getDefaultModel(),
      });

      const extracted = JsonUtils.extractJsonFromText(result.content);
      const quizData = this.normalizeQuizData(extracted);

      // Validation et normalisation des questions (workspace)
      // Pour les quiz personnalisés (basés sur workspaces), toutes les questions valent 1 point
      quizData.questions = quizData.questions.map((q, index: number) => {
        // Supprimer les doublons dans les QCM
        if (q.type === "MULTIPLE_CHOICE" && q.options) {
          q.options = this.removeDuplicateOptions(q.options, q.id || `Q${index + 1}`);
        }

        // Supprimer les doublons dans les questions de matching
        if (q.type === "MATCHING") {
          if (q.leftColumn) {
            q.leftColumn = this.removeDuplicateMatchingItems(
              q.leftColumn,
              "leftColumn",
              q.id || `Q${index + 1}`,
            );
          }
          if (q.rightColumn) {
            q.rightColumn = this.removeDuplicateMatchingItems(
              q.rightColumn,
              "rightColumn",
              q.id || `Q${index + 1}`,
            );
          }
        }

        return {
          ...q,
          id: q.id || `Q${index + 1}`,
          points: 1, // Toujours 1 point pour les quiz personnalisés
          difficulty: q.difficulty || "moyen",
          timeEstimate: q.timeEstimate || 30,
          category: q.category || "Général",
        };
      });

      // 🎨 NOUVEAU : Enrichissement avec graphiques IA (workspace)
      // PRIORITÉ 1: Utiliser directement higherEdField si fourni (quiz personnalisé)
      let primarySubject = request.higherEdField || "Général";

      // PRIORITÉ 2: Si pas de higherEdField, détecter depuis le contenu
      if (!request.higherEdField) {
        primarySubject = this.detectSubjectFromWorkspaceContent(contentSummary);
      }

      logger.log(
        `🎯 [SUBJECT-DETECTION] Matière utilisée: ${primarySubject} (higherEdField: ${request.higherEdField || "N/A"})`,
      );

      // ⚠️ GRAPHIQUES DÉSACTIVÉS pour quiz personnalisés (pas de presets)
      if (!request.preset || request.preset === "NONE") {
        logger.log("⚠️ [GRAPHICS] Graphiques désactivés pour quiz personnalisé");
      } else {
        quizData.questions = await this.enrichQuestionsWithGraphics(
          quizData.questions,
          primarySubject,
          request.schoolLevel,
        );
      }

      const quiz: GeneratedQuiz = {
        id: `quiz_workspace_${Date.now()}`,
        title: quizData.title || `Quiz basé sur vos contenus`,
        aiGeneratedTitle: quizData.aiGeneratedTitle, // ✅ Titre workspace généré par l'IA
        description: quizData.description,
        schoolLevel: request.schoolLevel,
        questions: quizData.questions.map((q) => this.toQuestionFromAI(q)),
        totalPoints: quizData.questions.reduce(
          (sum: number, q: QuizQuestionFromAI) => sum + (q.points || 1),
          0,
        ),
        estimatedTime: Math.ceil(
          quizData.questions.reduce(
            (sum: number, q: QuizQuestionFromAI) => sum + (q.timeEstimate || 60),
            0,
          ) / 60,
        ),
        metadata: {
          generatedAt: new Date(),
          aiModel: result.model,
          generationTime: Date.now() - startTime,
          basedOnWorkspaces: request.workspaceIds,
        },
      };

      return quiz;
    } catch (error) {
      logger.error("Erreur génération quiz workspace IA:", error);
      throw new Error(
        `Échec de la génération du quiz basé sur workspace: ${error instanceof Error ? error.message : "Erreur inconnue"}`,
      );
    }
  }

  /**
   * Détecte la matière principale à partir du contenu des workspaces
   */
  private static detectSubjectFromWorkspaceContent(
    contentSummary: WorkspaceContentSummary[],
  ): string {
    // Analyse des topics et contenus pour détecter la matière dominante
    const subjectKeywords: Record<string, string[]> = {
      Physique: [
        "physique",
        "force",
        "énergie",
        "mouvement",
        "mécanique",
        "électricité",
        "optique",
        "thermodynamique",
      ],
      Mathématiques: [
        "mathématiques",
        "fonction",
        "équation",
        "dérivée",
        "intégrale",
        "géométrie",
        "algèbre",
        "statistique",
      ],
      Chimie: [
        "chimie",
        "molécule",
        "réaction",
        "atome",
        "liaison",
        "acide",
        "base",
        "concentration",
      ],
      SVT: [
        "biologie",
        "cellule",
        "adn",
        "génétique",
        "évolution",
        "écosystème",
        "anatomie",
        "physiologie",
      ],
      Histoire: [
        "histoire",
        "guerre",
        "révolution",
        "empire",
        "politique",
        "société",
        "civilisation",
      ],
      Géographie: ["géographie", "climat", "population", "territoire", "relief", "urbanisation"],
      Français: ["littérature", "roman", "poésie", "grammaire", "orthographe", "analyse"],
      Philosophie: ["philosophie", "morale", "éthique", "conscience", "liberté", "vérité"],
      Sociologie: [
        "sociologie",
        "durkheim",
        "weber",
        "marx",
        "société",
        "social",
        "fait social",
        "classes",
        "inégalités",
        "socialisation",
        "institutions",
        "bourdieu",
        "habitus",
        "capital",
        "domination",
      ],
    };

    const subjectScores: Record<string, number> = {};

    // Initialiser les scores
    Object.keys(subjectKeywords).forEach((subject) => {
      subjectScores[subject] = 0;
    });

    // Analyser chaque workspace
    contentSummary.forEach((cs) => {
      const allText = `${cs.topics} ${cs.content}`.toLowerCase();

      Object.entries(subjectKeywords).forEach(([subject, keywords]) => {
        const keywordMatches = (keywords as string[]).filter((keyword) =>
          allText.includes(keyword),
        ).length;
        subjectScores[subject] += keywordMatches;
      });
    });

    // Trouver la matière avec le score le plus élevé
    const dominantSubject = Object.entries(subjectScores).sort(
      ([, a], [, b]) => (b as number) - (a as number),
    )[0];

    if (dominantSubject && (dominantSubject[1] as number) > 0) {
      logger.log(
        `🔍 [SUBJECT-DETECTION] Matière détectée: ${dominantSubject[0]} (score: ${dominantSubject[1]})`,
      );
      return dominantSubject[0] as string;
    }

    // Matière par défaut si aucune détection
    logger.log("🔍 [SUBJECT-DETECTION] Aucune matière détectée, utilisation par défaut");
    return "Général";
  }

  /**
   * Type guard pour vérifier si une valeur est une question valide
   */
  private static isValidQuestion(value: unknown): value is QuizQuestionFromAI {
    return (
      typeof value === "object" &&
      value !== null &&
      "id" in value &&
      "type" in value &&
      "question" in value
    );
  }

  /**
   * Normalise les données du quiz selon différents formats de réponse IA
   */
  private static normalizeQuizData(quizData: unknown): QuizDataFromAI {
    // Si c'est un tableau, c'est un tableau de questions
    if (Array.isArray(quizData)) {
      logger.log("🔧 Détection tableau de questions, normalisation...");
      return {
        title: "Quiz généré",
        description: "",
        questions: quizData as QuizQuestionFromAI[],
      };
    }

    // Si ce n'est pas un objet, erreur
    if (typeof quizData !== "object" || quizData === null) {
      throw new Error("Format de réponse IA non reconnu - données invalides");
    }

    const data = quizData as Record<string, unknown>;

    if (!data.questions) {
      // Cas 1 : L'IA a retourné directement une question unique
      if (this.isValidQuestion(data)) {
        logger.log("🔧 Détection question unique, normalisation...");
        return {
          title: "Quiz généré",
          description: "",
          questions: [data as QuizQuestionFromAI],
        };
      }
      // Cas 2 : Format inattendu, tentative de récupération
      else {
        logger.log("🔧 Format inattendu, tentative de récupération...");
        // Vérifier s'il y a des propriétés qui ressemblent à des questions
        const possibleQuestions = Object.values(data).filter(
          (value: unknown): value is QuizQuestionFromAI => this.isValidQuestion(value),
        );

        if (possibleQuestions.length > 0) {
          return {
            title: "Quiz généré",
            description: "",
            questions: possibleQuestions,
          };
        } else {
          throw new Error("Format de réponse IA non reconnu - aucune question valide trouvée");
        }
      }
    }

    // Sécurisation du champ questions
    if (!Array.isArray(data.questions)) {
      logger.error("❌ Le champ questions est manquant ou mal formé dans la réponse IA:", quizData);
      throw new Error("Le champ questions est manquant ou mal formé dans la réponse IA");
    }

    return {
      title: typeof data.title === "string" ? data.title : undefined,
      aiGeneratedTitle:
        typeof data.aiGeneratedTitle === "string" ? data.aiGeneratedTitle : undefined,
      description: typeof data.description === "string" ? data.description : undefined,
      questions: data.questions as QuizQuestionFromAI[],
    };
  }

  /**
   * Obtient la configuration documentaire pour une requête donnée
   */
  private static getDocumentConfig(request: QuizGenerationRequest): DocumentConfiguration | null {
    if (!request.preset) return null;

    // NOUVEAU : Utiliser d'abord la configuration dynamique si disponible
    if (request.documentConfig) {
      logger.log("📄 [CONFIG] Utilisation de la configuration dynamique:", request.documentConfig);
      return request.documentConfig;
    }

    try {
      // Configuration pour PARTIELS
      if (request.preset === "PARTIELS" && request.higherEdField) {
        const filiereConfig =
          PARTIELS_CONFIG.filieres[request.higherEdField as keyof typeof PARTIELS_CONFIG.filieres];
        if (filiereConfig) {
          return {
            enableDocuments: filiereConfig.enableDocuments || false,
            documentTopics: [...(filiereConfig.documentTopics || [])],
            documentRatio: filiereConfig.documentRatio || 0,
            minDocumentLength: filiereConfig.minDocumentLength || 300,
            maxDocuments: filiereConfig.maxDocuments || 1,
          };
        }

        // NOUVEAU : Pour les filières personnalisées, pas de documents par défaut
        logger.log("📄 [CONFIG] Filière personnalisée détectée - pas de documents par défaut");
        return {
          enableDocuments: false,
          documentTopics: [],
          documentRatio: 0,
          minDocumentLength: 6500,
          maxDocuments: 0,
        };
      }

      // Configuration pour BAC
      if (request.preset === "BAC") {
        // Pour le tronc commun (philosophie)
        if (request.specificSubject === "PHILOSOPHIE") {
          const philo = BAC_CONFIG.troncCommun[0];
          return {
            enableDocuments: philo.enableDocuments || false,
            documentTopics: [...(philo.documentTopics || [])],
            documentRatio: philo.documentRatio || 0,
            minDocumentLength: philo.minDocumentLength || 300,
            maxDocuments: philo.maxDocuments || 1,
          };
        }

        // Pour les spécialités
        if (request.lyceeSpecialties && request.lyceeSpecialties.length > 0) {
          const currentIndex = request.sequentialConfig?.currentSubjectIndex || 0;
          const subjects = [
            "PHILOSOPHIE",
            ...request.lyceeSpecialties.map(
              (s) => BAC_CONFIG.specialties[s as keyof typeof BAC_CONFIG.specialties]?.subject || s,
            ),
            "GRAND_ORAL",
          ];
          const currentSubject = subjects[currentIndex];

          // Trouver la spécialité correspondante
          for (const [specialtyKey, specialtyConfig] of Object.entries(BAC_CONFIG.specialties)) {
            if (specialtyConfig.subject === currentSubject) {
              return {
                enableDocuments: specialtyConfig.enableDocuments || false,
                documentTopics: [...(specialtyConfig.documentTopics || [])],
                documentRatio: specialtyConfig.documentRatio || 0,
                minDocumentLength: specialtyConfig.minDocumentLength || 300,
                maxDocuments: specialtyConfig.maxDocuments || 1,
              };
            }
          }
        }
      }

      // Configuration pour BREVET
      if (request.preset === "BREVET" && request.specificSubject) {
        const subjectConfig = BREVET_CONFIG.subjects.find(
          (s) => s.subject === request.specificSubject,
        );
        if (subjectConfig) {
          return {
            enableDocuments: subjectConfig.enableDocuments || false,
            documentTopics: [...(subjectConfig.documentTopics || [])],
            documentRatio: subjectConfig.documentRatio || 0,
            minDocumentLength: subjectConfig.minDocumentLength || 300,
            maxDocuments: subjectConfig.maxDocuments || 1,
          };
        }
      }
    } catch (error) {
      logger.warn("⚠️ Erreur lors de la récupération de la config documentaire:", error);
    }

    return null;
  }

  /**
   * Obtient le nom de la matière courante pour une requête donnée
   */
  private static getCurrentSubjectName(request: QuizGenerationRequest): string {
    if (request.preset === "PARTIELS" && request.higherEdField) {
      const filiereConfig =
        PARTIELS_CONFIG.filieres[request.higherEdField as keyof typeof PARTIELS_CONFIG.filieres];
      if (filiereConfig && request.sequentialConfig) {
        const currentIndex = request.sequentialConfig.currentSubjectIndex || 0;
        return filiereConfig.subjects[currentIndex] || request.higherEdField;
      }
      return request.higherEdField;
    }

    if (request.preset === "BAC") {
      // Logique pour déterminer la matière BAC actuelle
      if (request.specificSubject) {
        return this.getSubjectDisplayName(request);
      }
    }

    if (request.preset === "BREVET") {
      return this.getSubjectDisplayName(request);
    }

    return request.title || "Matière générale";
  }

  /**
   * Obtient la configuration graphique pour une requête donnée
   */
  private static getGraphicConfig(request: QuizGenerationRequest): GraphicConfiguration | null {
    if (!request.preset) return null;

    try {
      const subjectName = this.getCurrentSubjectName(request);
      logger.log(`🎨 [GRAPHIC-CONFIG] Analyse matière: ${subjectName}`);

      // Configuration par matière pour les graphiques
      const graphicConfigs: Record<string, GraphicConfiguration> = {
        // Matières scientifiques avec graphiques
        Physique: {
          enableGraphics: true,
          probability: 0.8,
          preferredLibrary: "apexcharts",
        },
        "Physique-Chimie": {
          enableGraphics: true,
          probability: 0.75,
          preferredLibrary: "auto",
        },
        PHYSIQUE_CHIMIE_SPECIALITE: {
          enableGraphics: true,
          probability: 0.75,
          preferredLibrary: "auto",
        },
        Mathématiques: {
          enableGraphics: true,
          probability: 0.9,
          preferredLibrary: "apexcharts",
        },
        MATHEMATIQUES_SPECIALITE: {
          enableGraphics: true,
          probability: 0.9,
          preferredLibrary: "apexcharts",
        },
        Chimie: {
          enableGraphics: true,
          probability: 0.7,
          preferredLibrary: "plotly",
        },
        SVT: {
          enableGraphics: true,
          probability: 0.6,
          preferredLibrary: "plotly",
        },
        SVT_SPECIALITE: {
          enableGraphics: true,
          probability: 0.6,
          preferredLibrary: "plotly",
        },

        // Matières sans graphiques (littéraires, etc.)
        Histoire: { enableGraphics: false },
        Français: { enableGraphics: false },
        Philosophie: { enableGraphics: false },
        HGGSP: { enableGraphics: false },
        SES: { enableGraphics: false },
      };

      // Rechercher par nom exact puis par correspondance partielle
      let config = graphicConfigs[subjectName];

      if (!config) {
        // Recherche par correspondance partielle
        const lowerSubject = subjectName.toLowerCase();
        for (const [key, value] of Object.entries(graphicConfigs)) {
          if (
            lowerSubject.includes(key.toLowerCase()) ||
            key.toLowerCase().includes(lowerSubject)
          ) {
            config = value;
            logger.log(`🎨 [GRAPHIC-CONFIG] Correspondance trouvée: ${key} → ${subjectName}`);
            break;
          }
        }
      }

      if (config) {
        logger.log(`🎨 [GRAPHIC-CONFIG] Configuration trouvée pour ${subjectName}:`, config);
        return config;
      }

      logger.log(`🎨 [GRAPHIC-CONFIG] Aucune configuration graphique pour ${subjectName}`);
      return { enableGraphics: false };
    } catch (error) {
      logger.warn("⚠️ Erreur lors de la récupération de la config graphique:", error);
      return { enableGraphics: false };
    }
  }

  /**
   * Supprime les options en doublon dans les QCM
   */
  private static removeDuplicateOptions(options: QuizOption[], questionId: string): QuizOption[] {
    if (!options || options.length === 0) return options;

    const seen = new Set<string>();
    const uniqueOptions: QuizOption[] = [];
    let duplicatesFound = false;

    for (const option of options) {
      const textLower = option.text?.toLowerCase().trim();

      if (!textLower || seen.has(textLower)) {
        duplicatesFound = true;
        logger.warn(
          `⚠️ [DUPLICATE-FIX] Question ${questionId}: Option en doublon détectée et supprimée: "${option.text}"`,
        );
        continue;
      }

      seen.add(textLower);
      uniqueOptions.push(option);
    }

    if (duplicatesFound) {
      logger.log(
        `✅ [DUPLICATE-FIX] Question ${questionId}: ${options.length - uniqueOptions.length} doublon(s) supprimé(s)`,
      );
    }

    return uniqueOptions;
  }

  /**
   * Supprime les éléments en doublon dans les colonnes de matching
   */
  private static removeDuplicateMatchingItems(
    items: MatchingItem[],
    columnName: string,
    questionId: string,
  ): MatchingItem[] {
    if (!items || items.length === 0) return items;

    const seen = new Set<string>();
    const uniqueItems: MatchingItem[] = [];
    let duplicatesFound = false;

    for (const item of items) {
      const textLower = item.text?.toLowerCase().trim();

      if (!textLower || seen.has(textLower)) {
        duplicatesFound = true;
        logger.warn(
          `⚠️ [DUPLICATE-FIX] Question ${questionId} (${columnName}): Élément en doublon détecté et supprimé: "${item.text}"`,
        );
        continue;
      }

      seen.add(textLower);
      uniqueItems.push(item);
    }

    if (duplicatesFound) {
      logger.log(
        `✅ [DUPLICATE-FIX] Question ${questionId} (${columnName}): ${items.length - uniqueItems.length} doublon(s) supprimé(s)`,
      );
    }

    return uniqueItems;
  }
}
