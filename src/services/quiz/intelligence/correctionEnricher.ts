/**
 * 📚 CorrectionEnricherService - PEN-22
 * Enrichissement des corrections avec références aux sources
 *
 * Ce service améliore les corrections de quiz en ajoutant :
 * - Des références précises aux pages/documents sources
 * - Des explications détaillées avec citations
 * - Des concepts à réviser pour les mauvaises réponses
 *
 * IMPORTANT: Utilise le RAG pour trouver les passages pertinents
 * sans appel IA supplémentaire - recherche vectorielle uniquement.
 */

import { ragSystem, type RAGSearchResult } from "../../rag/index.js";
import type { Question, QuestionResult } from "../types.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Référence à une source avec passage exact
 */
export interface SourceReference {
  /** ID de la page source */
  pageId: string;
  /** Titre de la page/source */
  pageTitle: string;
  /** Type de source (WORKSPACE_PAGE, PDF, etc.) */
  sourceType: string;
  /** Passage exact du texte (citation) */
  excerpt: string;
  /** Section de la page si disponible */
  sectionTitle?: string;
  /** Score de pertinence (0-1) */
  relevance: number;
}

/**
 * Concept à réviser
 */
export interface ConceptToReview {
  /** Nom du concept */
  concept: string;
  /** Courte description */
  description: string;
  /** Pages sources où le concept est expliqué */
  relatedPages: Array<{
    pageId: string;
    pageTitle: string;
    sectionTitle?: string;
  }>;
}

/**
 * Correction enrichie avec références aux sources
 */
export interface EnrichedQuestionResult extends QuestionResult {
  /** Références aux sources justifiant la correction */
  sourceReferences: SourceReference[];
  /** Explication détaillée avec citations des sources */
  detailedExplanation?: string;
  /** Concepts à réviser (pour les réponses incorrectes) */
  conceptsToReview?: ConceptToReview[];
  /** Indique si l'enrichissement a été effectué */
  isEnriched: boolean;
}

/**
 * Configuration pour l'enrichissement
 */
export interface EnrichmentConfig {
  /** ID de l'utilisateur (pour filtrer les sources) */
  userId: string;
  /** ID du workspace (pour filtrer les sources) */
  workspaceId?: string;
  /** IDs des pages sources du quiz (prioritaires) */
  quizSourcePageIds?: string[];
  /** Nombre max de références par question */
  maxReferencesPerQuestion?: number;
  /** Seuil de pertinence minimum (0-1) */
  minRelevanceThreshold?: number;
  /** Activer la suggestion de concepts à réviser */
  enableConceptSuggestions?: boolean;
}

const DEFAULT_CONFIG = {
  quizSourcePageIds: [] as string[],
  maxReferencesPerQuestion: 3,
  minRelevanceThreshold: 0.3,
  enableConceptSuggestions: true,
};

/**
 * Type pour la configuration fusionnée (avec défauts appliqués)
 */
type MergedEnrichmentConfig = {
  userId: string;
  workspaceId?: string;
  quizSourcePageIds: string[];
  maxReferencesPerQuestion: number;
  minRelevanceThreshold: number;
  enableConceptSuggestions: boolean;
};

// ============================================================================
// CorrectionEnricherService
// ============================================================================

export class CorrectionEnricherService {
  /**
   * Enrichit une correction unique avec les références aux sources
   */
  static async enrichCorrection(
    question: Question,
    correction: QuestionResult,
    config: EnrichmentConfig,
  ): Promise<EnrichedQuestionResult> {
    const cfg = { ...DEFAULT_CONFIG, ...config };

    try {
      console.log(
        `📚 [ENRICHER] Enrichissement question: "${question.question.slice(0, 50)}..."`,
      );

      // 1. Rechercher les passages pertinents dans les sources
      const sourceReferences = await this.findSourceReferences(
        question,
        correction,
        cfg,
      );

      // 2. Générer l'explication détaillée avec citations
      const detailedExplanation = this.buildDetailedExplanation(
        correction,
        sourceReferences,
      );

      // 3. Si réponse incorrecte, suggérer des concepts à réviser
      let conceptsToReview: ConceptToReview[] | undefined;
      if (!correction.isCorrect && cfg.enableConceptSuggestions) {
        conceptsToReview = await this.suggestConceptsToReview(
          question,
          correction,
          sourceReferences,
          cfg,
        );
      }

      const enriched: EnrichedQuestionResult = {
        ...correction,
        sourceReferences,
        detailedExplanation,
        conceptsToReview,
        isEnriched: sourceReferences.length > 0,
      };

      console.log(
        `✅ [ENRICHER] Enrichi avec ${sourceReferences.length} références`,
      );
      return enriched;
    } catch (error) {
      console.error(`⚠️ [ENRICHER] Erreur enrichissement:`, error);
      // En cas d'erreur, retourner la correction non enrichie
      return {
        ...correction,
        sourceReferences: [],
        isEnriched: false,
      };
    }
  }

  /**
   * Enrichit un batch de corrections (plus efficace pour plusieurs questions)
   */
  static async enrichCorrections(
    questions: Question[],
    corrections: QuestionResult[],
    config: EnrichmentConfig,
  ): Promise<EnrichedQuestionResult[]> {
    console.log(
      `📚 [ENRICHER] Enrichissement batch: ${corrections.length} corrections`,
    );

    const enrichedResults: EnrichedQuestionResult[] = [];

    for (const correction of corrections) {
      const question = questions.find((q) => q.id === correction.questionId);
      if (!question) {
        // Question non trouvée, garder la correction sans enrichissement
        enrichedResults.push({
          ...correction,
          sourceReferences: [],
          isEnriched: false,
        });
        continue;
      }

      const enriched = await this.enrichCorrection(
        question,
        correction,
        config,
      );
      enrichedResults.push(enriched);
    }

    const enrichedCount = enrichedResults.filter((r) => r.isEnriched).length;
    console.log(
      `✅ [ENRICHER] Batch terminé: ${enrichedCount}/${corrections.length} enrichis`,
    );

    return enrichedResults;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Recherche les références aux sources pertinentes
   */
  private static async findSourceReferences(
    question: Question,
    correction: QuestionResult,
    config: MergedEnrichmentConfig,
  ): Promise<SourceReference[]> {
    // Construire la requête de recherche basée sur la question et la correction
    const searchQuery = this.buildSearchQuery(question, correction);

    try {
      // Rechercher dans les sources RAG
      const searchResults = await ragSystem.search(searchQuery, {
        userId: config.userId,
        workspaceId: config.workspaceId,
        specificPageIds:
          config.quizSourcePageIds && config.quizSourcePageIds.length > 0
            ? config.quizSourcePageIds
            : undefined,
        limit: config.maxReferencesPerQuestion * 2, // Récupérer plus pour filtrer
        threshold: config.minRelevanceThreshold,
      });

      // Convertir en SourceReference
      const references = searchResults
        .slice(0, config.maxReferencesPerQuestion)
        .map((result) => this.ragResultToSourceReference(result));

      return references;
    } catch (error) {
      console.error(`⚠️ [ENRICHER] Erreur recherche RAG:`, error);
      return [];
    }
  }

  /**
   * Construit la requête de recherche basée sur la question et la correction
   */
  private static buildSearchQuery(
    question: Question,
    correction: QuestionResult,
  ): string {
    // Combiner l'énoncé de la question avec la bonne réponse
    const questionText = question.question;
    const correctAnswerText = this.extractCorrectAnswerText(question);

    // Si la correction a une explication, l'utiliser aussi
    const explanation = correction.explanation || "";

    // Construire une requête riche pour le RAG
    const queryParts = [questionText];

    if (correctAnswerText) {
      queryParts.push(correctAnswerText);
    }

    // Extraire les mots-clés de l'explication (si courte)
    if (explanation && explanation.length < 200) {
      queryParts.push(explanation);
    }

    return queryParts.join(" ");
  }

  /**
   * Extrait le texte de la bonne réponse selon le type de question
   */
  private static extractCorrectAnswerText(question: Question): string {
    switch (question.type) {
      case "OPEN_QUESTION":
        return question.expectedAnswer || question.keywords?.join(", ") || "";

      case "MULTIPLE_CHOICE":
        const correctOption = question.options?.find((opt) => opt.isCorrect);
        return correctOption?.text || "";

      case "TRUE_FALSE":
        return question.correctAnswer ? "Vrai" : "Faux";

      case "MATCHING":
        // Pour matching, on retourne les correspondances
        return (
          question.correctMatches
            ?.map((m) => {
              const left = question.leftColumn?.find((l) => l.id === m.leftId);
              const right = question.rightColumn?.find(
                (r) => r.id === m.rightId,
              );
              return `${left?.text || ""} ↔ ${right?.text || ""}`;
            })
            .join(", ") || ""
        );

      default:
        return "";
    }
  }

  /**
   * Convertit un résultat RAG en SourceReference
   */
  private static ragResultToSourceReference(
    result: RAGSearchResult,
  ): SourceReference {
    // Tronquer le contenu pour l'excerpt (max 300 caractères)
    const excerpt = this.truncateText(result.content, 300);

    return {
      pageId: result.source.id,
      pageTitle: result.source.title,
      sourceType: result.source.sourceType,
      excerpt,
      sectionTitle: result.sectionTitle,
      relevance: Math.round(result.similarity * 100) / 100,
    };
  }

  /**
   * Construit l'explication détaillée avec les citations des sources
   */
  private static buildDetailedExplanation(
    correction: QuestionResult,
    sourceReferences: SourceReference[],
  ): string {
    if (sourceReferences.length === 0) {
      return correction.explanation || correction.feedback;
    }

    // Construire l'explication avec les citations
    const parts: string[] = [];

    // Feedback de base
    if (correction.feedback) {
      parts.push(correction.feedback);
    }

    // Ajouter les citations des sources
    if (sourceReferences.length > 0) {
      parts.push("\n\n📖 **Sources de référence :**");

      sourceReferences.forEach((ref, index) => {
        const citation = `\n${index + 1}. **${ref.pageTitle}**${ref.sectionTitle ? ` (${ref.sectionTitle})` : ""}\n   > "${ref.excerpt}"`;
        parts.push(citation);
      });
    }

    return parts.join("");
  }

  /**
   * Suggère des concepts à réviser basé sur la question et les sources
   */
  private static async suggestConceptsToReview(
    question: Question,
    _correction: QuestionResult,
    sourceReferences: SourceReference[],
    config: MergedEnrichmentConfig,
  ): Promise<ConceptToReview[]> {
    // Extraire les concepts de la question (mots-clés importants)
    const concepts = this.extractConceptsFromQuestion(question);

    if (concepts.length === 0) {
      return [];
    }

    // Pour chaque concept, chercher les pages sources pertinentes
    const conceptsToReview: ConceptToReview[] = [];

    for (const concept of concepts.slice(0, 3)) {
      // Max 3 concepts
      try {
        // Chercher les pages qui parlent de ce concept
        const conceptResults = await ragSystem.search(concept, {
          userId: config.userId,
          workspaceId: config.workspaceId,
          specificPageIds:
            config.quizSourcePageIds && config.quizSourcePageIds.length > 0
              ? config.quizSourcePageIds
              : undefined,
          limit: 2,
          threshold: 0.4,
        });

        // Si on trouve des sources, ajouter le concept
        if (conceptResults.length > 0) {
          conceptsToReview.push({
            concept,
            description: `Concept clé lié à la question`,
            relatedPages: conceptResults.map((r) => ({
              pageId: r.source.id,
              pageTitle: r.source.title,
              sectionTitle: r.sectionTitle,
            })),
          });
        }
      } catch {
        // Ignorer les erreurs pour les concepts individuels
      }
    }

    // Ajouter les sources déjà trouvées si elles ne sont pas déjà incluses
    if (conceptsToReview.length === 0 && sourceReferences.length > 0) {
      conceptsToReview.push({
        concept: "Contenu du cours",
        description: "Revoir les passages suivants",
        relatedPages: sourceReferences.map((ref) => ({
          pageId: ref.pageId,
          pageTitle: ref.pageTitle,
          sectionTitle: ref.sectionTitle,
        })),
      });
    }

    return conceptsToReview;
  }

  /**
   * Extrait les concepts clés d'une question (mots importants)
   */
  private static extractConceptsFromQuestion(question: Question): string[] {
    const text = question.question.toLowerCase();

    // Supprimer les mots courants (stop words français)
    const stopWords = new Set([
      "le",
      "la",
      "les",
      "un",
      "une",
      "des",
      "de",
      "du",
      "au",
      "aux",
      "ce",
      "ces",
      "cette",
      "quel",
      "quelle",
      "quels",
      "quelles",
      "qui",
      "que",
      "quoi",
      "dont",
      "où",
      "comment",
      "pourquoi",
      "est",
      "sont",
      "a",
      "ont",
      "fait",
      "peut",
      "doit",
      "dans",
      "sur",
      "pour",
      "par",
      "avec",
      "sans",
      "en",
      "et",
      "ou",
      "ni",
      "mais",
      "donc",
      "car",
      "si",
      "ne",
      "pas",
      "plus",
      "moins",
      "très",
      "bien",
      "mal",
      "tout",
      "tous",
      "toute",
      "toutes",
      "autre",
      "autres",
      "même",
      "mêmes",
      "chaque",
      "plusieurs",
      "aucun",
      "aucune",
      "certains",
      "certaines",
      "quelques",
      "beaucoup",
      "peu",
      "trop",
      "assez",
      "entre",
      "parmi",
      "vers",
      "chez",
      "avant",
      "après",
      "pendant",
      "depuis",
      "jusqu",
      "jusque",
      "selon",
      "suivant",
      "malgré",
      "sauf",
      "vrai",
      "faux",
      "correct",
      "correcte",
      "incorrect",
      "incorrecte",
    ]);

    // Tokeniser et filtrer
    const words = text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // Supprimer accents
      .replace(/[^\w\s]/g, " ") // Supprimer ponctuation
      .split(/\s+/)
      .filter((word) => word.length > 3 && !stopWords.has(word));

    // Dédupliquer et retourner les mots uniques
    return [...new Set(words)];
  }

  /**
   * Tronque un texte à une longueur maximale
   */
  private static truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }

    // Couper au dernier espace avant la limite
    const truncated = text.slice(0, maxLength);
    const lastSpace = truncated.lastIndexOf(" ");

    if (lastSpace > maxLength * 0.7) {
      return truncated.slice(0, lastSpace) + "...";
    }

    return truncated + "...";
  }
}

// ============================================================================
// Exports
// ============================================================================
