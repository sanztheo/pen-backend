import { v4 as uuidv4 } from "uuid";
import { AIService } from "../../ai/base.js";
import { z } from "zod";
import {
  QuizSubject,
  SubjectDocument,
  Question,
  QuestionType,
  SchoolLevel,
  ExamSubject,
  QuizGenerationRequest,
} from "../types.js";

// Types for AI-generated subject data
interface AIGeneratedSubjectData {
  title: string;
  description: string;
  category?: string;
  timeLimit?: number;
  instructions?: string;
  questions: AIGeneratedQuestionData[];
}

interface AIGeneratedQuestionData {
  id?: string;
  type: QuestionType;
  question: string;
  difficulty: "facile" | "moyen" | "difficile";
  points: number;
  category?: string;
  choices?: string[];
  options?: Array<{ id: string; text: string; isCorrect?: boolean }>;
  expectedAnswer?: string;
  correctAnswer?: boolean;
}

interface AISubjectsResponse {
  subjects: AIGeneratedSubjectData[];
}

interface AIDocumentResponse {
  title: string;
  content: string;
  source?: string;
  context?: string;
  period?: string;
  author?: string;
}

interface AIThemeResponse {
  title: string;
  description: string;
  category: string;
  instructions?: string;
}

// Subject name mapping type
type SubjectNameMapping = Record<string, string>;

const DifficultySchema = z.enum(["facile", "moyen", "difficile"]);

const AIGeneratedQuestionSchema: z.ZodType<AIGeneratedQuestionData> = z.object({
  id: z.string().optional(),
  type: z.nativeEnum(QuestionType),
  question: z.string(),
  difficulty: DifficultySchema,
  points: z.coerce.number(),
  category: z.string().optional(),
  choices: z.array(z.string()).optional(),
  options: z
    .array(
      z.object({
        id: z.string(),
        text: z.string(),
        isCorrect: z.boolean().optional(),
      }),
    )
    .optional(),
  expectedAnswer: z.string().optional(),
  correctAnswer: z.boolean().optional(),
});

const AIGeneratedSubjectSchema: z.ZodType<AIGeneratedSubjectData> = z.object({
  title: z.string(),
  description: z.string(),
  category: z.string().optional(),
  timeLimit: z.coerce.number().optional(),
  instructions: z.string().optional(),
  questions: z.array(AIGeneratedQuestionSchema),
});

const AISubjectsResponseSchema: z.ZodType<AISubjectsResponse> = z.object({
  subjects: z.array(AIGeneratedSubjectSchema),
});

/**
 * Générateur de sujets thématiques pour les quiz
 * Remplace la génération question par question par des sujets cohérents
 */
export class SubjectGenerator {
  /**
   * Génère des sujets thématiques pour un preset donné (version optimisée)
   */
  static async generateSubjects(
    request: QuizGenerationRequest,
  ): Promise<QuizSubject[]> {
    const {
      preset,
      schoolLevel,
      specificSubject,
      questionCount = 30,
    } = request;

    // Calculer le nombre de sujets et questions par sujet
    const subjectCount = this.getSubjectCount(preset, schoolLevel);
    const questionsPerSubject = Math.ceil(questionCount / subjectCount);

    console.log(
      `📚 Génération optimisée de ${subjectCount} sujets avec ${questionsPerSubject} questions chacun`,
    );

    // **OPTIMISATION**: Générer tous les sujets en une seule requête IA
    return await this.generateAllSubjectsOptimized(
      request,
      subjectCount,
      questionsPerSubject,
    );
  }

  /**
   * NOUVELLE MÉTHODE OPTIMISÉE : Génère tous les sujets en une seule requête
   */
  private static async generateAllSubjectsOptimized(
    request: QuizGenerationRequest,
    subjectCount: number,
    questionsPerSubject: number,
  ): Promise<QuizSubject[]> {
    const subjectName = this.getSubjectName(request);
    console.log(`🎯 Génération optimisée pour: ${subjectName}`);

    const prompt = `
Tu es un expert en conception d'examens pour ${subjectName} niveau ${request.schoolLevel}.

Génère exactement ${subjectCount} sujets thématiques avec ${questionsPerSubject} questions chacun.

CONTRAINTES:
- Matière: ${subjectName}
- Niveau: ${request.schoolLevel}
- ${subjectCount} sujets distincts et cohérents
- ${questionsPerSubject} questions par sujet
- Types de questions: ${request.questionTypes.join(", ")}

FORMAT JSON ATTENDU:
{
  "subjects": [
    {
      "title": "Titre du sujet 1",
      "description": "Description courte",
      "category": "${subjectName}",
      "timeLimit": ${questionsPerSubject * 2},
      "instructions": "Instructions du sujet",
      "questions": [
        {
          "id": "q1_s1",
          "type": "${request.questionTypes[0]}",
          "question": "Question 1 pour ce sujet",
          "difficulty": "facile|moyen|difficile",
          "points": 2,
          "category": "Titre du sujet"
        }
        // ... ${questionsPerSubject} questions au total
      ]
    }
    // ... ${subjectCount} sujets au total
  ]
}

IMPORTANT:
- Questions cohérentes avec le titre du sujet
- Progression logique dans chaque sujet
- Respect exact du nombre de questions demandé
- Types de questions variés selon les types demandés
`;

    try {
      const response = await AIService.generateContent({
        prompt,
        maxTokens: 25000, // Augmenté pour les sujets multiples
        temperature: 0.7,
      });

      const parsedUnknown: unknown = JSON.parse(response.content.trim());
      const parsed = AISubjectsResponseSchema.safeParse(parsedUnknown);
      if (!parsed.success) {
        throw new Error("Réponse IA invalide (subjects JSON)");
      }
      const data = parsed.data;

      // Transformer en format QuizSubject
      return data.subjects.map(
        (subjectData: AIGeneratedSubjectData): QuizSubject => ({
          id: uuidv4(),
          title: subjectData.title,
          description: subjectData.description,
          questions: subjectData.questions.map(
            (q: AIGeneratedQuestionData): Question => {
              // Base question properties
              const baseQuestion = {
                id: q.id || uuidv4(),
                question: q.question,
                difficulty: q.difficulty,
                points: q.points,
                category: q.category || subjectData.title,
                subjectId: subjectData.title,
                timeEstimate: 90,
              };

              // Conversion choices -> options pour MULTIPLE_CHOICE
              if (
                q.type === QuestionType.MULTIPLE_CHOICE &&
                q.choices &&
                Array.isArray(q.choices)
              ) {
                return {
                  ...baseQuestion,
                  type: QuestionType.MULTIPLE_CHOICE,
                  options: q.choices.map(
                    (choice: string, choiceIndex: number) => ({
                      id: `option_${choiceIndex + 1}`,
                      text: choice,
                      isCorrect: false, // À définir côté correction
                    }),
                  ),
                };
              }

              // If already has options array
              if (q.options && Array.isArray(q.options)) {
                return {
                  ...baseQuestion,
                  type: QuestionType.MULTIPLE_CHOICE,
                  options: q.options.map((o) => ({
                    ...o,
                    isCorrect: o.isCorrect ?? false,
                  })),
                };
              }

              // For TRUE_FALSE questions
              if (q.type === QuestionType.TRUE_FALSE) {
                return {
                  ...baseQuestion,
                  type: QuestionType.TRUE_FALSE,
                  correctAnswer: q.correctAnswer ?? true,
                };
              }

              // For OPEN_QUESTION
              if (q.type === QuestionType.OPEN_QUESTION) {
                return {
                  ...baseQuestion,
                  type: QuestionType.OPEN_QUESTION,
                  expectedAnswer: q.expectedAnswer,
                };
              }

              // Default to MULTIPLE_CHOICE with empty options
              return {
                ...baseQuestion,
                type: QuestionType.MULTIPLE_CHOICE,
                options: [],
              };
            },
          ),
          timeLimit: subjectData.timeLimit || questionsPerSubject * 2,
          difficulty: this.determineDifficulty(request.schoolLevel),
          category: subjectData.category || subjectName,
          instructions: subjectData.instructions,
        }),
      );
    } catch (error) {
      console.warn(
        "⚠️ Erreur génération optimisée, fallback vers méthode individuelle:",
        error,
      );

      // Fallback vers l'ancienne méthode
      const subjects: QuizSubject[] = [];
      for (let i = 0; i < subjectCount; i++) {
        const subject = await this.generateSingleSubject(
          request,
          i,
          questionsPerSubject,
        );
        subjects.push(subject);
      }
      return subjects;
    }
  }

  /**
   * Génère un seul sujet thématique (fallback)
   */
  private static async generateSingleSubject(
    request: QuizGenerationRequest,
    subjectIndex: number,
    questionCount: number,
  ): Promise<QuizSubject> {
    // Générer le thème/titre du sujet
    const subjectTheme = await this.generateSubjectTheme(request, subjectIndex);

    // Générer les documents si nécessaire (Histoire, Littérature)
    const documents = await this.generateDocuments(request, subjectTheme);

    // Générer les questions pour ce sujet
    const questions = await this.generateQuestionsForSubject(
      request,
      subjectTheme,
      questionCount,
      documents,
    );

    return {
      id: uuidv4(),
      title: subjectTheme.title,
      description: subjectTheme.description,
      questions,
      documents,
      timeLimit: this.calculateTimeLimit(questionCount, request.schoolLevel),
      difficulty: this.determineDifficulty(request.schoolLevel),
      category: subjectTheme.category,
      instructions: subjectTheme.instructions,
    };
  }

  /**
   * Génère le thème/titre d'un sujet
   */
  private static async generateSubjectTheme(
    request: QuizGenerationRequest,
    subjectIndex: number,
  ): Promise<{
    title: string;
    description: string;
    category: string;
    instructions?: string;
  }> {
    const subjectName = this.getSubjectName(request);

    const prompt = `
Tu es un expert en conception d'examens pour ${subjectName} niveau ${request.schoolLevel}.

Génère le thème pour le sujet n°${subjectIndex + 1} d'un examen.

CONSIGNES:
- Réponds UNIQUEMENT avec un objet JSON
- Titre précis et académique
- Description courte (1-2 lignes)
- Catégorie thématique
- Instructions spécifiques si nécessaire

Format:
{
  "title": "Titre du sujet",
  "description": "Description courte",
  "category": "Catégorie",
  "instructions": "Instructions optionnelles"
}

Exemples selon la matière:
- Histoire: "La Révolution française (1789-1799)"
- Mathématiques: "Équations du second degré"
- Français: "L'analyse de texte argumentatif"

Matière: ${subjectName}
Niveau: ${request.schoolLevel}
`;

    try {
      const response = await AIService.generateContent({
        prompt,
        maxTokens: 500,
        temperature: 0.7,
      });

      const theme = JSON.parse(response.content.trim());
      return theme;
    } catch (error) {
      console.warn("⚠️ Erreur génération thème:", error);

      // Fallback
      return {
        title: `${subjectName} - Sujet ${subjectIndex + 1}`,
        description: `Sujet d'examen en ${subjectName}`,
        category: subjectName,
        instructions: `Répondez à toutes les questions de ce sujet.`,
      };
    }
  }

  /**
   * Génère des documents d'étude pour certaines matières
   */
  private static async generateDocuments(
    request: QuizGenerationRequest,
    theme: { title: string; category: string },
  ): Promise<SubjectDocument[] | undefined> {
    // Documents uniquement pour Histoire et Littérature pour l'instant
    const needsDocuments = this.subjectNeedsDocuments(request);

    if (!needsDocuments) {
      return undefined;
    }

    console.log(`📄 Génération de document pour: ${theme.title}`);

    // Pour l'instant, on utilise la génération IA
    // Plus tard, on ajoutera le scraping et les APIs
    return await this.generateAIDocument(theme);
  }

  /**
   * Génère un document via IA (temporaire)
   */
  private static async generateAIDocument(theme: {
    title: string;
    category: string;
  }): Promise<SubjectDocument[]> {
    const prompt = `
Génère un document historique authentique pour le thème "${theme.title}".

CONSIGNES:
- Document primaire réaliste
- 200-400 mots
- Style d'époque approprié
- Source fictive mais vraisemblable
- Contexte historique précis

Format JSON:
{
  "title": "Titre du document",
  "content": "Contenu du document...",
  "source": "Source du document",
  "context": "Contexte historique",
  "period": "Période (ex: 1789-1799)",
  "author": "Auteur si applicable"
}
`;

    try {
      const response = await AIService.generateContent({
        prompt,
        maxTokens: 800,
        temperature: 0.8,
      });

      const docData = JSON.parse(response.content.trim());

      return [
        {
          id: uuidv4(),
          type: "text",
          title: docData.title,
          content: docData.content,
          source: docData.source,
          context: docData.context,
          period: docData.period,
          author: docData.author,
        },
      ];
    } catch (error) {
      console.warn("⚠️ Erreur génération document:", error);
      return [];
    }
  }

  /**
   * Génère les questions pour un sujet donné
   */
  private static async generateQuestionsForSubject(
    request: QuizGenerationRequest,
    theme: { title: string; description: string },
    questionCount: number,
    documents?: SubjectDocument[],
  ): Promise<Question[]> {
    // Utiliser le générateur de questions existant mais adapté pour un sujet
    const subjectName = this.getSubjectName(request);

    const prompt = `
Tu es un expert en conception d'examens pour ${subjectName} niveau ${request.schoolLevel}.

Génère exactement ${questionCount} questions pour le sujet: "${theme.title}"

${
  documents && documents.length > 0
    ? `
DOCUMENT D'ÉTUDE:
Titre: ${documents[0].title}
Contenu: ${documents[0].content}
Source: ${documents[0].source}

Certaines questions doivent porter sur ce document.
`
    : ""
}

CONSIGNES:
- Questions cohérentes avec le thème
- Niveaux de difficulté variés
- Types de questions: ${request.questionTypes.join(", ")}
- Format JSON valide uniquement

[Continuer avec le format de génération de questions existant...]
`;

    // Pour l'instant, simuler la génération
    // Plus tard, intégrer avec le système de génération existant
    const questions: Question[] = [];

    for (let i = 0; i < questionCount; i++) {
      questions.push({
        id: uuidv4(),
        type: QuestionType.MULTIPLE_CHOICE,
        question: `Question ${i + 1} sur ${theme.title}`,
        difficulty: i < 3 ? "facile" : i < 7 ? "moyen" : "difficile",
        points: 2,
        category: theme.title,
        timeEstimate: 90,
        subjectId: theme.title,
        documentRef: documents?.[0]?.id,
        options: [
          { id: "A", text: "Option A", isCorrect: true },
          { id: "B", text: "Option B", isCorrect: false },
          { id: "C", text: "Option C", isCorrect: false },
          { id: "D", text: "Option D", isCorrect: false },
        ],
      });
    }

    return questions;
  }

  /**
   * Détermine si une matière a besoin de documents
   */
  private static subjectNeedsDocuments(
    request: QuizGenerationRequest,
  ): boolean {
    const subjectName = this.getSubjectName(request).toLowerCase();

    return (
      subjectName.includes("histoire") ||
      subjectName.includes("français") ||
      subjectName.includes("littérature") ||
      subjectName.includes("philosophie")
    );
  }

  /**
   * Obtient le nom de la matière (CORRIGÉ avec support des Partiels)
   */
  private static getSubjectName(request: QuizGenerationRequest): string {
    // **PRIORITÉ 1**: Matière spécifique des Partiels depuis la configuration séquentielle
    if (
      request.preset === "PARTIELS" &&
      request.sequentialConfig &&
      request.higherEdField
    ) {
      const config = request.sequentialConfig;
      if (config.subjectResults && config.currentSubjectIndex !== undefined) {
        const currentSubjectResult =
          config.subjectResults[config.currentSubjectIndex];

        if (currentSubjectResult && currentSubjectResult.subjectName) {
          console.log(
            `🎯 Matière Partiel détectée: ${currentSubjectResult.subjectName} (matière spécifique de ${request.higherEdField})`,
          );
          return currentSubjectResult.subjectName;
        }
      }
    }

    // **PRIORITÉ 2**: Titre du quiz (pour les requêtes avec titre personnalisé)
    if (request.title && request.title.includes(" - ")) {
      const parts = request.title.split(" - ");
      if (parts.length >= 2) {
        const subjectName = parts[parts.length - 1].trim();
        console.log(`🎯 Matière détectée depuis le titre: ${subjectName}`);
        return subjectName;
      }
    }

    // **PRIORITÉ 3**: Filière d'études supérieures (Partiels - fallback)
    if (request.higherEdField) {
      console.log(
        `🎯 Matière détectée: ${request.higherEdField} (filière d'études supérieures)`,
      );
      return request.higherEdField;
    }

    // **PRIORITÉ 4**: Matière spécifique (Brevet, Bac)
    if (request.specificSubject) {
      const subjectNames: SubjectNameMapping = {
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

      const subjectName =
        subjectNames[request.specificSubject] || request.specificSubject;
      console.log(`🎯 Matière détectée: ${subjectName} (matière spécifique)`);
      return subjectName;
    }

    // **FALLBACK**: Matière générale
    console.log(`🎯 Matière détectée: Matière générale (fallback)`);
    return "Matière générale";
  }

  /**
   * Détermine le nombre de sujets selon le preset
   */
  private static getSubjectCount(
    preset?: string,
    schoolLevel?: SchoolLevel,
  ): number {
    // Pour les examens officiels, on utilise généralement 3 sujets
    // Cela peut être personnalisé selon les besoins
    return 3;
  }

  /**
   * Calcule le temps limite pour un sujet
   */
  private static calculateTimeLimit(
    questionCount: number,
    schoolLevel?: SchoolLevel,
  ): number {
    // Environ 2-3 minutes par question selon le niveau
    const timePerQuestion =
      schoolLevel === SchoolLevel.ETUDES_SUPERIEURES ? 3 : 2;
    return questionCount * timePerQuestion;
  }

  /**
   * Détermine la difficulté selon le niveau scolaire
   */
  private static determineDifficulty(
    schoolLevel?: SchoolLevel,
  ): "facile" | "moyen" | "difficile" {
    switch (schoolLevel) {
      case SchoolLevel.COLLEGE:
        return "facile";
      case SchoolLevel.LYCEE_SECONDE:
      case SchoolLevel.LYCEE_PREMIERE:
        return "moyen";
      case SchoolLevel.LYCEE_TERMINALE:
      case SchoolLevel.ETUDES_SUPERIEURES:
        return "difficile";
      default:
        return "moyen";
    }
  }
}
