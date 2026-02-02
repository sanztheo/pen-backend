/**
 * DocumentBasedQuizGenerator - Générateur de quiz intégrant des documents Wikipedia
 * Intègre le système de recherche documentaire avec les embeddings dans la génération de quiz
 * Permet de créer des examens basés sur des documents authentiques
 */

import {
  QuizGenerationRequest,
  GeneratedQuiz,
  Question,
  QuestionType,
  OpenQuestion,
  MultipleChoiceQuestion,
  TrueFalseQuestion,
} from "../types.js";
import { z } from "zod";
import {
  documentSearchService,
  DocumentChunk,
  SearchRequest,
} from "../documentSearchService.js";
import { AIService } from "../../ai/base.js";
import { getPartielsPrompt } from "../presets/partiels/index.js";

// Interfaces for AI response parsing
interface AIQuestionResponse {
  id: number | string;
  type?: string;
  text?: string;
  question?: string;
  choices?: string[];
  correctAnswer?: string | boolean;
  explanation?: string;
  basedOnDocument?: boolean;
  documentReference?: string;
  keywords?: string[];
}

interface AIQuizResponse {
  questions: AIQuestionResponse[];
  metadata?: QuizResponseMetadata;
}

interface QuizResponseMetadata {
  totalQuestions?: number;
  documentQuestions?: number;
  knowledgeQuestions?: number;
  subject?: string;
  generatedAt?: Date;
  documentBased?: boolean;
  documentsUsed?: number;
  documentRatio?: number;
  aiModel?: string;
  generationTime?: number;
  basedOnWorkspaces?: string[];
}

const AIQuestionResponseSchema = z
  .object({
    id: z.union([z.number(), z.string()]),
    type: z.string().optional(),
    text: z.string().optional(),
    question: z.string().optional(),
    choices: z.array(z.string()).optional(),
    correctAnswer: z.union([z.string(), z.boolean()]).optional(),
    explanation: z.string().optional(),
    basedOnDocument: z.boolean().optional(),
    documentReference: z.string().optional(),
    keywords: z.array(z.string()).optional(),
  })
  .passthrough();

const QuizResponseMetadataSchema = z
  .object({
    totalQuestions: z.number().optional(),
    documentQuestions: z.number().optional(),
    knowledgeQuestions: z.number().optional(),
    subject: z.string().optional(),
    generatedAt: z.coerce.date().optional(),
    documentBased: z.boolean().optional(),
    documentsUsed: z.number().optional(),
    documentRatio: z.number().optional(),
    aiModel: z.string().optional(),
    generationTime: z.number().optional(),
    basedOnWorkspaces: z.array(z.string()).optional(),
  })
  .passthrough() satisfies z.ZodType<QuizResponseMetadata>;

const AIQuizResponseSchema = z
  .object({
    questions: z.array(AIQuestionResponseSchema),
    metadata: QuizResponseMetadataSchema.optional(),
  })
  .passthrough() satisfies z.ZodType<AIQuizResponse>;

interface QuestionOption {
  id: string;
  text: string;
  isCorrect: boolean;
}

export interface DocumentBasedQuizMetadata {
  hasDocuments: boolean;
  sourceDocuments: DocumentChunk[];
  documentsSearchTime: number;
  detectedTopics: string[];
  searchStrategy: "topic_based" | "semantic_search" | "hybrid";
  documentRatio: number; // Pourcentage de questions basées sur documents
}

export interface DocumentBasedQuizResult {
  quiz: GeneratedQuiz;
  documentMetadata: DocumentBasedQuizMetadata;
}

// Configuration par matière pour la recherche documentaire
const SUBJECT_TOPIC_MAPPING = {
  histoire: [
    "antiquite",
    "moyen_age",
    "renaissance",
    "revolution",
    "moderne",
    "guerre_conflits",
  ],
  "histoire contemporaine": ["moderne", "revolution", "guerre_conflits"],
  "méthodologie historique": ["histoire", "moderne", "antiquite"],
  "sources et archives": ["histoire", "moderne", "revolution"],
  historiographie: ["moderne", "renaissance", "revolution"],

  sciences: [
    "sciences",
    "technologie",
    "medecine",
    "physique",
    "chimie",
    "mathematiques",
  ],
  mathématiques: ["mathematiques", "sciences", "physique"],
  physique: ["physique", "sciences", "technologie"],
  chimie: ["chimie", "sciences", "medecine"],
  "méthodes expérimentales": ["sciences", "physique", "chimie"],
  modélisation: ["mathematiques", "physique", "sciences"],

  philosophie: ["philosophie", "philosophie_antique", "philosophie_moderne"],
  arts: ["arts", "litterature", "architecture"],
  "littérature française": ["litterature", "arts"],
  "littérature comparée": ["litterature", "arts"],
  linguistique: ["litterature", "philosophie"],

  économie: ["economie", "moderne"],
  droit: ["droit", "moderne"],
  gestion: ["economie", "moderne"],
  psychologie: ["psychologie", "medecine", "sciences"],
  médecine: ["medecine", "sciences", "biologie"],
  informatique: ["informatique", "technologie", "sciences"],
} as const;

export class DocumentBasedQuizGenerator {
  /**
   * Déduplicque les chunks de documents pour garder un chunk par document unique
   * Garde le chunk avec la meilleure similarité pour chaque document
   */
  private deduplicateDocumentChunks(chunks: DocumentChunk[]): DocumentChunk[] {
    const docMap = new Map<string, DocumentChunk>();

    for (const chunk of chunks) {
      const docKey = chunk.parent_id || chunk.doc_id;
      const existing = docMap.get(docKey);

      if (!existing || chunk.similarity > existing.similarity) {
        docMap.set(docKey, chunk);
      }
    }

    console.log(
      `🗡️ Déduplication: ${chunks.length} chunks → ${docMap.size} documents uniques`,
    );
    return Array.from(docMap.values());
  }

  /**
   * Construit les stratégies de recherche progressive pour garantir de trouver des documents
   */
  private buildSearchStrategies(
    subjectName: string,
    topics: string[],
  ): Array<{
    name: string;
    query: string;
    threshold: number;
    topics: string[];
  }> {
    const subjectLower = subjectName.toLowerCase();

    // Stratégies ordonnées par précision décroissante
    const strategies = [];

    // Stratégie 1: Requête optimisée spécifique (la plus précise)
    const specificQuery = this.buildOptimalSearchQuery(subjectName, topics);
    strategies.push({
      name: "Requête spécifique optimisée",
      query: specificQuery,
      threshold: 0.3,
      topics: topics,
    });

    // Stratégie 2: Recherche par topic principal + matière
    if (topics.length > 0) {
      strategies.push({
        name: "Topic principal + matière",
        query: `${topics[0]} ${subjectName}`,
        threshold: 0.25,
        topics: topics.slice(0, 2), // Limiter aux 2 premiers topics
      });
    }

    // Stratégie 3: Recherche sur tous les topics sans matière
    if (topics.length > 1) {
      strategies.push({
        name: "Topics multiples",
        query: topics.slice(0, 3).join(" "), // Combine 3 premiers topics
        threshold: 0.2,
        topics: topics,
      });
    }

    // Stratégie 4: Recherche par topic individuel (fallback)
    if (topics.length > 0) {
      strategies.push({
        name: "Topic principal seul",
        query: topics[0],
        threshold: 0.15,
        topics: [topics[0]], // Un seul topic pour élargir
      });
    }

    // Stratégie 5: Recherche très large par matière (dernière chance)
    strategies.push({
      name: "Matière générale",
      query: subjectName,
      threshold: 0.1, // Seuil très bas
      topics: [], // Tous les topics
    });

    return strategies;
  }

  /**
   * Construit une requête de recherche optimisée pour éviter les termes trop génériques
   */
  private buildOptimalSearchQuery(
    subjectName: string,
    topics: string[],
  ): string {
    const subjectLower = subjectName.toLowerCase();

    // Mappage des matières vers des requêtes plus spécifiques
    const specificQueries: Record<string, string> = {
      histoire: "révolution française napoléon guerre",
      "histoire contemporaine": "guerre mondiale révolution moderne",
      sciences: "physique chimie biologie expérience",
      philosophie: "kant descartes socrate éthique",
      littérature: "roman poésie théâtre écrivain",
      mathématiques: "théorème calcul géométrie algèbre",
      géographie: "territoire population climat économie",
    };

    // Si on a une requête spécifique, l'utiliser
    if (specificQueries[subjectLower]) {
      return specificQueries[subjectLower];
    }

    // Sinon, combiner le premier topic avec des mots-clés généraux
    if (topics.length > 0) {
      const primaryTopic = topics[0];
      return `${primaryTopic} ${subjectName}`;
    }

    // Fallback : utiliser le nom de matière original
    return subjectName;
  }

  /**
   * Génère un quiz basé sur des documents Wikipedia
   */
  async generateDocumentBasedQuiz(
    request: QuizGenerationRequest,
    subjectName: string,
    documentConfig: {
      enableDocuments: boolean;
      documentRatio: number; // 0.0 à 1.0 (ex: 0.6 = 60% questions sur documents)
      minDocumentLength: number;
      maxDocuments: number;
      topics?: string[];
    },
  ): Promise<DocumentBasedQuizResult> {
    console.log(`📚 Génération quiz documentaire pour: ${subjectName}`);
    console.log(`🔧 Config:`, documentConfig);

    // Si les documents ne sont pas activés, retourner un quiz classique
    if (!documentConfig.enableDocuments) {
      return this.generateClassicQuiz(request, subjectName);
    }

    const startTime = Date.now();

    // 1. Recherche des documents pertinents
    const documents = await this.searchRelevantDocuments(
      subjectName,
      documentConfig,
    );
    const searchTime = Date.now() - startTime;

    console.log(
      `📊 Documents trouvés: ${documents.chunks.length} en ${searchTime}ms`,
    );

    // 2. Génération du quiz avec intégration des documents
    const quiz = await this.generateQuizWithDocuments(
      request,
      subjectName,
      documents.chunks,
      documentConfig.documentRatio,
    );

    const documentMetadata: DocumentBasedQuizMetadata = {
      hasDocuments: documents.chunks.length > 0,
      sourceDocuments: documents.chunks,
      documentsSearchTime: searchTime,
      detectedTopics: documents.detected_topics,
      searchStrategy:
        (documents.search_strategy as
          | "topic_based"
          | "semantic_search"
          | "hybrid") || "semantic_search",
      documentRatio: documentConfig.documentRatio,
    };

    return {
      quiz,
      documentMetadata,
    };
  }

  /**
   * Recherche des documents pertinents pour la matière avec fallback progressif
   */
  private async searchRelevantDocuments(
    subjectName: string,
    config: {
      topics?: string[];
      maxDocuments: number;
      minDocumentLength: number;
    },
  ) {
    // Détermine les topics à utiliser
    const subjectKey = subjectName.toLowerCase();
    const mappedTopics =
      SUBJECT_TOPIC_MAPPING[subjectKey as keyof typeof SUBJECT_TOPIC_MAPPING] ||
      [];

    const searchTopics = config.topics || [...mappedTopics];

    console.log(
      `🔍 Recherche documentaire pour "${subjectName}" avec topics:`,
      searchTopics,
    );

    // Stratégies de recherche progressive
    const searchStrategies = this.buildSearchStrategies(
      subjectName,
      searchTopics,
    );

    let finalResult = null;
    let attemptNumber = 1;

    for (const strategy of searchStrategies) {
      console.log(
        `🎯 Tentative ${attemptNumber}/${searchStrategies.length}: "${strategy.query}" (seuil: ${strategy.threshold})`,
      );

      const searchRequest: SearchRequest = {
        query: strategy.query,
        limit: config.maxDocuments * 3, // Rechercher plus pour avoir des options
        similarity_threshold: strategy.threshold,
        topics: strategy.topics,
      };

      const searchResult =
        await documentSearchService.searchDocuments(searchRequest);

      // Filtrer les documents trop courts
      const filteredChunks = searchResult.chunks.filter(
        (chunk) => chunk.content.length >= config.minDocumentLength,
      );

      console.log(
        `📊 Résultats tentative ${attemptNumber}: ${filteredChunks.length} documents valides`,
      );

      if (filteredChunks.length > 0) {
        // Succès ! Déduplication puis sélection des meilleurs documents
        const uniqueDocuments = this.deduplicateDocumentChunks(filteredChunks);
        const selectedChunks = uniqueDocuments
          .sort((a, b) => b.similarity - a.similarity) // Trier par similarité décroissante
          .slice(0, config.maxDocuments);

        console.log(
          `✅ Documents sélectionnés: ${selectedChunks.length} uniques sur ${filteredChunks.length} chunks (stratégie: ${strategy.name})`,
        );

        finalResult = {
          ...searchResult,
          chunks: selectedChunks,
        };
        break;
      }

      attemptNumber++;
    }

    // Si aucune stratégie n'a fonctionné, utiliser le dernier résultat même vide
    if (!finalResult) {
      console.log(
        `⚠️ Aucun document pertinent trouvé après ${searchStrategies.length} tentatives`,
      );
      finalResult = {
        chunks: [],
        detected_topics: searchTopics,
        search_strategy: "hybrid",
        total_searched: 0,
      };
    }

    return finalResult;
  }

  /**
   * Génère un quiz en intégrant les documents trouvés
   */
  private async generateQuizWithDocuments(
    request: QuizGenerationRequest,
    subjectName: string,
    documents: DocumentChunk[],
    documentRatio: number,
  ): Promise<GeneratedQuiz> {
    const totalQuestions = request.questionCount || 20;
    const documentQuestions = Math.ceil(totalQuestions * documentRatio);
    const knowledgeQuestions = totalQuestions - documentQuestions;

    console.log(
      `📝 Génération: ${documentQuestions} questions docs + ${knowledgeQuestions} questions connaissances`,
    );

    // Construire le prompt enrichi avec les documents
    const documentsContext = this.buildDocumentsContext(documents);
    const enhancedPrompt = this.buildEnhancedPrompt(
      request,
      subjectName,
      documentsContext,
      documentQuestions,
      knowledgeQuestions,
    );

    console.log(
      `🤖 Génération du quiz avec ${documents.length} documents intégrés`,
    );

    try {
      const aiResponse = await AIService.generateContent({
        prompt: enhancedPrompt,
        maxTokens: 12000,
        temperature: 0.7,
      });

      const quizData = this.parseQuizResponse(aiResponse.content);

      // Marquer les questions basées sur documents
      const questions = this.markDocumentQuestions(
        quizData.questions,
        documentQuestions,
      );

      // Créer un sujet unique contenant toutes les questions
      const subject = {
        id: `subject_${Date.now()}`,
        title: subjectName,
        description: `Quiz avec documents Wikipedia - ${subjectName}`,
        questions,
        timeLimit: Math.ceil(questions.length * 2), // 2 minutes par question
        difficulty: "moyen" as const,
        category: subjectName,
        instructions: `Ce quiz contient des questions basées sur ${documents.length} document(s) Wikipedia. Consultez les documents fournis avant de répondre.`,
      };

      const finalQuiz = {
        id: `quiz_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        title: request.title || `Quiz ${subjectName}`,
        description:
          request.description || `Quiz avec documents - ${subjectName}`,
        questions: [], // Vide pour le nouveau système
        subjects: [subject], // NOUVEAU: Système de sujets
        subjectBased: true, // NOUVEAU: Indicateur du système utilisé
        sourceDocuments: documents.map((doc) => ({
          id: doc.id,
          title: doc.title,
          content: this.truncateOnSentenceEnd(doc.content, 6500), // Troncature intelligente pour le frontend
          source: doc.source || "Wikipedia",
          topic: doc.topic || "général",
          similarity: doc.similarity || 0,
        })), // Documents Wikipedia utilisés transformés au format frontend
        hasDocuments: true, // Indicateur de présence de documents
        metadata: {
          ...quizData.metadata,
          generatedAt: new Date(),
          documentBased: true,
          documentsUsed: documents.length,
          documentRatio: documentRatio,
        },
      };

      // DEBUG: Logging pour déboguer
      console.log("🐛 DEBUG DocumentBasedQuizGenerator:", {
        documentsCount: documents.length,
        questionsCount: questions.length,
        subjectQuestionsCount: subject.questions.length,
        firstQuestion: questions[0],
        firstDocument: documents[0],
        finalQuiz: finalQuiz,
      });

      return finalQuiz;
    } catch (error) {
      console.error("❌ Erreur génération quiz documentaire:", error);
      // Fallback vers génération classique
      console.log("🔄 Fallback vers génération classique");
      return this.generateClassicQuizFallback(request, subjectName);
    }
  }

  /**
   * Construit le contexte documentaire pour le prompt
   */
  private buildDocumentsContext(documents: DocumentChunk[]): string {
    if (documents.length === 0) {
      return "Aucun document spécifique disponible.";
    }

    let context = "DOCUMENTS SOURCES DISPONIBLES :\n\n";

    documents.forEach((doc, index) => {
      context += `--- DOCUMENT ${index + 1} ---\n`;
      context += `Titre: ${doc.title}\n`;
      context += `Source: ${doc.source || "Wikipedia"}\n`;
      context += `Topic: ${doc.topic}\n`;
      context += `Similarité: ${(doc.similarity * 100).toFixed(1)}%\n`;

      // Troncature intelligente à 6500 caractères avec fin sur point
      const truncatedContent = this.truncateOnSentenceEnd(doc.content, 6500);
      context += `Contenu:\n${truncatedContent}\n\n`;
    });

    return context;
  }

  /**
   * Tronque un texte à une longueur donnée en finissant sur un point
   */
  private truncateOnSentenceEnd(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }

    // Chercher le dernier point avant la limite
    const substring = text.substring(0, maxLength);
    const lastDotIndex = substring.lastIndexOf(".");

    // Si on trouve un point, couper après le point
    if (lastDotIndex > 0 && lastDotIndex > maxLength * 0.8) {
      // Au moins 80% de la longueur cible
      return text.substring(0, lastDotIndex + 1);
    }

    // Sinon, chercher d'autres signes de ponctuation
    const lastPunctuationIndex = Math.max(
      substring.lastIndexOf("!"),
      substring.lastIndexOf("?"),
      substring.lastIndexOf(";"),
    );

    if (lastPunctuationIndex > 0 && lastPunctuationIndex > maxLength * 0.8) {
      return text.substring(0, lastPunctuationIndex + 1);
    }

    // En dernier recours, couper au dernier espace avant la limite
    const lastSpaceIndex = substring.lastIndexOf(" ");
    if (lastSpaceIndex > 0) {
      return text.substring(0, lastSpaceIndex) + "...";
    }

    // Si aucune solution élégante, couper brutalement
    return text.substring(0, maxLength) + "...";
  }

  /**
   * Construit le prompt enrichi pour la génération avec documents
   */
  private buildEnhancedPrompt(
    request: QuizGenerationRequest,
    subjectName: string,
    documentsContext: string,
    documentQuestions: number,
    knowledgeQuestions: number,
  ): string {
    // Utilise le prompt spécialisé selon le contexte (partiels, etc.)
    let basePrompt = "";

    if (request.preset === "PARTIELS" && request.higherEdField) {
      basePrompt = getPartielsPrompt(request.higherEdField, subjectName);
    } else {
      basePrompt = `Tu es un expert en création de quiz universitaires pour la matière ${subjectName}.`;
    }

    const enhancedPrompt = `${basePrompt}

${documentsContext}

CONSIGNES SPÉCIALES QUIZ DOCUMENTAIRE :

Tu dois créer exactement ${request.questionCount} questions au total :
- ${documentQuestions} questions basées sur les DOCUMENTS SOURCES ci-dessus
- ${knowledgeQuestions} questions basées sur les connaissances générales de ${subjectName}

QUESTIONS BASÉES SUR DOCUMENTS (${documentQuestions} questions) :
- Utilise OBLIGATOIREMENT le contenu des documents fournis
- Cite des passages spécifiques des documents
- Teste la compréhension et l'analyse des documents
- Intègre des éléments factuels présents dans les documents
- Assure-toi que la réponse peut être trouvée dans les documents

QUESTIONS DE CONNAISSANCES GÉNÉRALES (${knowledgeQuestions} questions) :
- Basées sur la connaissance académique classique de ${subjectName}
- Complètent les documents avec des concepts théoriques
- Permettent d'évaluer la maîtrise globale de la matière

TYPES DE QUESTIONS À UTILISER :
${request.questionTypes?.map((type) => `- ${type}`).join("\n") || "- Questions ouvertes\n- QCM\n- Vrai/Faux"}

IMPORTANT : 
- Mélange intelligemment questions documentaires et connaissances
- Assure une progression logique et équilibrée
- Indique clairement quand une question se réfère aux documents
- Format JSON strict attendu pour la réponse

Format de réponse attendu (JSON uniquement) :
{
  "questions": [
    {
      "id": 1,
      "type": "MULTIPLE_CHOICE",
      "text": "Question basée sur le document 1...",
      "choices": ["A", "B", "C", "D"],
      "correctAnswer": "A",
      "explanation": "Explication avec référence au document",
      "basedOnDocument": true,
      "documentReference": "Document 1: Titre du document"
    }
  ],
  "metadata": {
    "totalQuestions": ${request.questionCount},
    "documentQuestions": ${documentQuestions},
    "knowledgeQuestions": ${knowledgeQuestions},
    "subject": "${subjectName}"
  }
}`;

    return enhancedPrompt;
  }

  /**
   * Parse la réponse de l'IA en format JSON
   */
  private parseQuizResponse(content: string): {
    questions: Question[];
    metadata: QuizResponseMetadata;
  } {
    try {
      // Nettoie le contenu pour extraire le JSON
      let cleanContent = content.trim();

      // Extrait le JSON si il y a du texte avant/après
      const jsonMatch = cleanContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        cleanContent = jsonMatch[0];
      }

      const parsedUnknown: unknown = JSON.parse(cleanContent);
      const parsed = AIQuizResponseSchema.parse(parsedUnknown);

      if (!parsed.questions || !Array.isArray(parsed.questions)) {
        throw new Error("Format de réponse invalide: questions manquantes");
      }

      // Transformer les questions au format attendu par le frontend
      const transformedQuestions = parsed.questions.map(
        (q: AIQuestionResponse) => this.transformQuestionFormat(q),
      );

      return {
        questions: transformedQuestions,
        metadata: parsed.metadata || {},
      };
    } catch (error) {
      console.error("❌ Erreur parsing réponse IA:", error);
      console.error("📄 Contenu brut:", content.substring(0, 500));
      throw new Error("Impossible de parser la réponse de l'IA");
    }
  }

  /**
   * Transforme une question du format IA vers le format frontend
   */
  private transformQuestionFormat(aiQuestion: AIQuestionResponse): Question {
    const baseQuestion = {
      id: String(aiQuestion.id || Math.random()),
      question:
        aiQuestion.text || aiQuestion.question || "Question non disponible",
      difficulty: "moyen" as const,
      points: 1,
      basedOnDocument: aiQuestion.basedOnDocument || false,
      documentReference: aiQuestion.documentReference,
    };

    // Transformation selon le type de question
    switch (aiQuestion.type) {
      case "MULTIPLE_CHOICE": {
        // Transformer choices ["A", "B", "C", "D"] vers options [{id, text}]
        const choices = aiQuestion.choices || [];
        const correctAnswer =
          typeof aiQuestion.correctAnswer === "string"
            ? aiQuestion.correctAnswer
            : "";

        const options: QuestionOption[] = choices.map(
          (choice: string, index: number) => {
            const isCorrect =
              choice === correctAnswer || choice.startsWith(correctAnswer);
            return {
              id: String(index),
              text: choice,
              isCorrect: correctAnswer ? isCorrect : index === 0,
            };
          },
        );

        const mcQuestion: MultipleChoiceQuestion = {
          ...baseQuestion,
          type: QuestionType.MULTIPLE_CHOICE,
          options,
          multipleAnswers: false,
        };
        return mcQuestion;
      }

      case "TRUE_FALSE": {
        const tfQuestion: TrueFalseQuestion = {
          ...baseQuestion,
          type: QuestionType.TRUE_FALSE,
          correctAnswer:
            aiQuestion.correctAnswer === "true" ||
            aiQuestion.correctAnswer === true,
          explanation: aiQuestion.explanation,
        };
        return tfQuestion;
      }

      case "OPEN_QUESTION": {
        const correctAnswerStr =
          typeof aiQuestion.correctAnswer === "string"
            ? aiQuestion.correctAnswer
            : aiQuestion.explanation;
        const openQuestion: OpenQuestion = {
          ...baseQuestion,
          type: QuestionType.OPEN_QUESTION,
          expectedAnswer: correctAnswerStr,
          keywords: aiQuestion.keywords || [],
          minWords: 10,
          maxWords: 200,
        };
        return openQuestion;
      }

      default: {
        // Par défaut, traité comme MULTIPLE_CHOICE
        const defaultQuestion: MultipleChoiceQuestion = {
          ...baseQuestion,
          type: QuestionType.MULTIPLE_CHOICE,
          options: [
            {
              id: "0",
              text: "Option par défaut",
              isCorrect: true,
            },
          ],
          multipleAnswers: false,
        };
        return defaultQuestion;
      }
    }
  }

  /**
   * Marque les questions qui sont basées sur les documents
   */
  private markDocumentQuestions(
    questions: Question[],
    documentQuestionCount: number,
  ): Question[] {
    return questions.map((question, index) => ({
      ...question,
      basedOnDocument: index < documentQuestionCount,
      documentReference:
        index < documentQuestionCount
          ? question.documentReference || "Documents sources fournis"
          : undefined,
    }));
  }

  /**
   * Génère un quiz classique sans documents (fallback)
   */
  private async generateClassicQuiz(
    request: QuizGenerationRequest,
    subjectName: string,
  ): Promise<DocumentBasedQuizResult> {
    const quiz = await this.generateClassicQuizFallback(request, subjectName);

    const documentMetadata: DocumentBasedQuizMetadata = {
      hasDocuments: false,
      sourceDocuments: [],
      documentsSearchTime: 0,
      detectedTopics: [],
      searchStrategy: "semantic_search",
      documentRatio: 0,
    };

    return {
      quiz,
      documentMetadata,
    };
  }

  /**
   * Génération classique de fallback
   */
  private async generateClassicQuizFallback(
    request: QuizGenerationRequest,
    subjectName: string,
  ): Promise<GeneratedQuiz> {
    // Prompt basique pour génération classique
    let basePrompt = "";

    if (request.preset === "PARTIELS" && request.higherEdField) {
      basePrompt = getPartielsPrompt(request.higherEdField, subjectName);
    } else {
      basePrompt = `Tu es un expert en création de quiz universitaires pour la matière ${subjectName}.
      
Génère ${request.questionCount} questions de niveau universitaire pour évaluer la maîtrise de ${subjectName}.

Types de questions à utiliser :
${request.questionTypes?.map((type) => `- ${type}`).join("\n") || "- Questions ouvertes\n- QCM\n- Vrai/Faux"}`;
    }

    const prompt = `${basePrompt}

Format de réponse attendu (JSON uniquement) :
{
  "questions": [
    {
      "id": 1,
      "type": "MULTIPLE_CHOICE",
      "text": "Question...",
      "choices": ["A", "B", "C", "D"],
      "correctAnswer": "A",
      "explanation": "Explication"
    }
  ],
  "metadata": {
    "totalQuestions": ${request.questionCount},
    "subject": "${subjectName}"
  }
}`;

    try {
      const aiResponse = await AIService.generateContent({
        prompt,
        maxTokens: 12000,
        temperature: 0.7,
      });

      const quizData = this.parseQuizResponse(aiResponse.content);

      // Créer un sujet unique contenant toutes les questions (mode fallback)
      const subject = {
        id: `subject_${Date.now()}`,
        title: subjectName,
        description: `Quiz classique - ${subjectName}`,
        questions: quizData.questions,
        timeLimit: Math.ceil(quizData.questions.length * 2), // 2 minutes par question
        difficulty: "moyen" as const,
        category: subjectName,
        instructions: `Quiz classique sans documents - ${subjectName}`,
      };

      return {
        id: `quiz_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        title: request.title || `Quiz ${subjectName}`,
        description: request.description || `Quiz classique - ${subjectName}`,
        questions: [], // Vide pour le nouveau système
        subjects: [subject], // NOUVEAU: Système de sujets
        subjectBased: true, // NOUVEAU: Indicateur du système utilisé
        sourceDocuments: [], // Pas de documents en mode fallback
        hasDocuments: false, // Pas de documents
        metadata: {
          ...quizData.metadata,
          generatedAt: new Date(),
          documentBased: false,
        },
      };
    } catch (error) {
      console.error("❌ Erreur génération quiz classique:", error);
      throw new Error("Impossible de générer le quiz");
    }
  }
}

export const documentBasedQuizGenerator = new DocumentBasedQuizGenerator();
