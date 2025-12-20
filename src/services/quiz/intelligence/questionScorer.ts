/**
 * 🎯 QuestionScorerService - PEN-19
 * Scoring et déduplication des questions générées
 *
 * Ce service évalue la qualité de chaque question générée
 * et élimine les doublons pour garantir un quiz de haute qualité.
 *
 * IMPORTANT: Scoring basé sur des heuristiques rapides, SANS appel IA.
 */

import { Question, QuestionType } from "../types.js";

// ============================================================================
// Types
// ============================================================================

export interface QuestionScore {
  /** Score global 0-1 */
  overall: number;
  /** Clarté de l'énoncé (longueur, structure) */
  clarity: number;
  /** Pertinence (présence d'explication, complétude) */
  relevance: number;
  /** Variété des options (pour QCM) */
  optionVariety: number;
  /** Cohérence avec la difficulté demandée */
  difficultyCoherence: number;
  /** Raisons du score (pour debug) */
  reasons: string[];
}

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  similarTo?: number; // Index de la question similaire
  similarity: number; // Score de similarité 0-1
}

export interface ScoringConfig {
  /** Seuil minimum pour accepter une question (défaut: 0.5) */
  minScore?: number;
  /** Seuil de similarité pour considérer comme doublon (défaut: 0.85) */
  duplicateThreshold?: number;
  /** Longueur min de l'énoncé (défaut: 20 chars) */
  minQuestionLength?: number;
  /** Longueur max de l'énoncé (défaut: 500 chars) */
  maxQuestionLength?: number;
}

const DEFAULT_CONFIG: Required<ScoringConfig> = {
  minScore: 0.5,
  duplicateThreshold: 0.85,
  minQuestionLength: 20,
  maxQuestionLength: 500,
};

// ============================================================================
// Helper: Get question text (common property)
// ============================================================================

/**
 * Récupère l'énoncé de la question (propriété commune à tous les types)
 */
function getQuestionText(question: Question): string {
  return question.question;
}

/**
 * Vérifie si la question a une réponse correcte définie
 */
function hasCorrectAnswer(question: Question): boolean {
  switch (question.type) {
    case QuestionType.OPEN_QUESTION:
      return !!(
        question.expectedAnswer ||
        (question.keywords && question.keywords.length > 0)
      );
    case QuestionType.MULTIPLE_CHOICE:
      return question.options?.some((opt) => opt.isCorrect) ?? false;
    case QuestionType.TRUE_FALSE:
      return question.correctAnswer !== undefined;
    case QuestionType.MATCHING:
      return question.correctMatches && question.correctMatches.length > 0;
    default:
      return false;
  }
}

/**
 * Récupère l'explication si disponible
 */
function getExplanation(question: Question): string | undefined {
  if (question.type === QuestionType.TRUE_FALSE) {
    return question.explanation;
  }
  // Les autres types n'ont pas d'explanation dans BaseQuestion
  return undefined;
}

/**
 * Récupère les options pour les QCM
 */
function getOptions(question: Question): string[] {
  if (question.type === QuestionType.MULTIPLE_CHOICE && question.options) {
    return question.options.map((opt) => opt.text);
  }
  return [];
}

// ============================================================================
// QuestionScorerService
// ============================================================================

export class QuestionScorerService {
  /**
   * Score une question basé sur des heuristiques rapides (sans IA)
   */
  static scoreQuestion(
    question: Question,
    config: ScoringConfig = {},
  ): QuestionScore {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const reasons: string[] = [];

    const questionText = getQuestionText(question);

    // 1. Score de clarté (longueur de l'énoncé)
    const clarity = this.scoreClarityByLength(
      questionText,
      cfg.minQuestionLength,
      cfg.maxQuestionLength,
      reasons,
    );

    // 2. Score de pertinence (réponse correcte, complétude)
    const relevance = this.scoreRelevance(question, reasons);

    // 3. Score de variété des options (pour QCM)
    const optionVariety = this.scoreOptionVariety(question, reasons);

    // 4. Score de cohérence de difficulté
    const difficultyCoherence = this.scoreDifficultyCoherence(
      question,
      reasons,
    );

    // Calcul du score global (moyenne pondérée)
    const weights = {
      clarity: 0.25,
      relevance: 0.35,
      optionVariety: 0.25,
      difficultyCoherence: 0.15,
    };

    const overall =
      clarity * weights.clarity +
      relevance * weights.relevance +
      optionVariety * weights.optionVariety +
      difficultyCoherence * weights.difficultyCoherence;

    return {
      overall: Math.round(overall * 100) / 100,
      clarity: Math.round(clarity * 100) / 100,
      relevance: Math.round(relevance * 100) / 100,
      optionVariety: Math.round(optionVariety * 100) / 100,
      difficultyCoherence: Math.round(difficultyCoherence * 100) / 100,
      reasons,
    };
  }

  /**
   * Vérifie si une question est un doublon d'une question existante
   */
  static isDuplicate(
    question: Question,
    existingQuestions: Question[],
    threshold: number = DEFAULT_CONFIG.duplicateThreshold,
  ): DuplicateCheckResult {
    if (existingQuestions.length === 0) {
      return { isDuplicate: false, similarity: 0 };
    }

    const questionText = getQuestionText(question);
    let maxSimilarity = 0;
    let mostSimilarIndex = -1;

    for (let i = 0; i < existingQuestions.length; i++) {
      const existingText = getQuestionText(existingQuestions[i]);
      const similarity = this.calculateSimilarity(questionText, existingText);

      if (similarity > maxSimilarity) {
        maxSimilarity = similarity;
        mostSimilarIndex = i;
      }
    }

    return {
      isDuplicate: maxSimilarity >= threshold,
      similarTo: mostSimilarIndex >= 0 ? mostSimilarIndex : undefined,
      similarity: Math.round(maxSimilarity * 100) / 100,
    };
  }

  /**
   * Vérifie si une question passe les critères de qualité
   */
  static isAcceptable(
    question: Question,
    existingQuestions: Question[],
    config: ScoringConfig = {},
  ): {
    acceptable: boolean;
    score: QuestionScore;
    duplicate: DuplicateCheckResult;
  } {
    const cfg = { ...DEFAULT_CONFIG, ...config };

    const score = this.scoreQuestion(question, cfg);
    const duplicate = this.isDuplicate(
      question,
      existingQuestions,
      cfg.duplicateThreshold,
    );

    const acceptable = score.overall >= cfg.minScore && !duplicate.isDuplicate;

    return { acceptable, score, duplicate };
  }

  /**
   * Suggestions d'amélioration basées sur le score
   */
  static getSuggestions(question: Question, score: QuestionScore): string[] {
    const suggestions: string[] = [];
    const questionText = getQuestionText(question);

    if (score.clarity < 0.6) {
      if (questionText.length < 20) {
        suggestions.push("L'énoncé est trop court. Ajouter plus de contexte.");
      } else if (questionText.length > 500) {
        suggestions.push("L'énoncé est trop long. Simplifier la formulation.");
      }
    }

    if (score.relevance < 0.6) {
      if (!hasCorrectAnswer(question)) {
        suggestions.push("Définir une réponse correcte pour la question.");
      }
    }

    if (score.optionVariety < 0.6) {
      if (question.type === QuestionType.MULTIPLE_CHOICE) {
        suggestions.push(
          "Les options de réponse manquent de variété ou sont trop similaires.",
        );
      }
    }

    if (score.difficultyCoherence < 0.6) {
      suggestions.push(
        "La difficulté estimée ne correspond pas au contenu de la question.",
      );
    }

    return suggestions;
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Score la clarté basée sur la longueur
   */
  private static scoreClarityByLength(
    text: string,
    minLength: number,
    maxLength: number,
    reasons: string[],
  ): number {
    const length = text.trim().length;

    if (length < minLength) {
      reasons.push(`Énoncé trop court (${length} < ${minLength} chars)`);
      return 0.3;
    }

    if (length > maxLength) {
      reasons.push(`Énoncé trop long (${length} > ${maxLength} chars)`);
      return 0.5;
    }

    // Zone optimale: 50-200 caractères
    if (length >= 50 && length <= 200) {
      reasons.push("Longueur d'énoncé optimale");
      return 1.0;
    }

    // Zone acceptable
    if (length >= minLength && length <= maxLength) {
      reasons.push("Longueur d'énoncé acceptable");
      return 0.8;
    }

    return 0.6;
  }

  /**
   * Score la pertinence (réponse correcte, complétude)
   */
  private static scoreRelevance(question: Question, reasons: string[]): number {
    let score = 0.5; // Score de base

    // Bonus pour l'explication (uniquement TrueFalse)
    const explanation = getExplanation(question);
    if (explanation && explanation.trim().length > 10) {
      score += 0.2;
      reasons.push("Explication fournie");
    }

    // Bonus pour la réponse correcte définie
    if (hasCorrectAnswer(question)) {
      score += 0.3;
      reasons.push("Réponse correcte définie");
    } else {
      reasons.push("Réponse correcte manquante");
      score -= 0.3;
    }

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Score la variété des options (pour QCM)
   */
  private static scoreOptionVariety(
    question: Question,
    reasons: string[],
  ): number {
    // Pour les questions non-QCM, score parfait par défaut
    if (question.type !== QuestionType.MULTIPLE_CHOICE) {
      return 1.0;
    }

    const options = getOptions(question);

    if (options.length === 0) {
      reasons.push("Aucune option définie");
      return 0.2;
    }

    // Vérifier le nombre d'options
    if (options.length < 2) {
      reasons.push("Pas assez d'options (minimum 2)");
      return 0.2;
    }

    if (options.length < 3) {
      reasons.push("Seulement 2 options");
      return 0.6;
    }

    // Vérifier la variété (longueurs différentes, pas de doublons)
    const uniqueOptions = new Set(options.map((o) => o.toLowerCase().trim()));
    if (uniqueOptions.size < options.length) {
      reasons.push("Options en double détectées");
      return 0.4;
    }

    // Vérifier que les options ne sont pas trop similaires
    const avgLength =
      options.reduce((sum, o) => sum + o.length, 0) / options.length;
    const lengthVariance =
      options.reduce((sum, o) => sum + Math.pow(o.length - avgLength, 2), 0) /
      options.length;

    if (lengthVariance < 10) {
      reasons.push("Options de longueur trop uniforme");
      return 0.7;
    }

    reasons.push("Bonne variété d'options");
    return 1.0;
  }

  /**
   * Score la cohérence de difficulté
   */
  private static scoreDifficultyCoherence(
    question: Question,
    reasons: string[],
  ): number {
    // Si pas de difficulté spécifiée, score neutre
    if (!question.difficulty) {
      return 0.7;
    }

    const questionText = getQuestionText(question);
    const textLength = questionText.length;
    const hasFormula =
      questionText.includes("=") ||
      questionText.includes("²") ||
      questionText.includes("√");
    const hasMultipleConcepts =
      (questionText.match(/,|et|ou|ainsi que/gi) || []).length >= 2;

    // Heuristiques simples de difficulté
    let estimatedDifficulty: "facile" | "moyen" | "difficile" = "moyen";

    if (textLength < 50 && !hasFormula && !hasMultipleConcepts) {
      estimatedDifficulty = "facile";
    } else if (textLength > 200 || hasFormula || hasMultipleConcepts) {
      estimatedDifficulty = "difficile";
    }

    // Comparer avec la difficulté déclarée
    const declaredDifficulty = question.difficulty.toLowerCase() as
      | "facile"
      | "moyen"
      | "difficile";

    if (declaredDifficulty === estimatedDifficulty) {
      reasons.push("Difficulté cohérente avec le contenu");
      return 1.0;
    }

    // Tolérance d'un niveau
    const difficultyLevels = ["facile", "moyen", "difficile"];
    const declaredIndex = difficultyLevels.indexOf(declaredDifficulty);
    const estimatedIndex = difficultyLevels.indexOf(estimatedDifficulty);

    if (Math.abs(declaredIndex - estimatedIndex) === 1) {
      reasons.push("Difficulté légèrement décalée");
      return 0.7;
    }

    reasons.push("Difficulté incohérente avec le contenu");
    return 0.4;
  }

  /**
   * Calcule la similarité entre deux textes (Jaccard sur les mots)
   */
  private static calculateSimilarity(text1: string, text2: string): number {
    const words1 = this.tokenize(text1);
    const words2 = this.tokenize(text2);

    if (words1.size === 0 && words2.size === 0) return 1;
    if (words1.size === 0 || words2.size === 0) return 0;

    // Similarité de Jaccard
    const intersection = new Set([...words1].filter((w) => words2.has(w)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }

  /**
   * Tokenize un texte en ensemble de mots normalisés
   */
  private static tokenize(text: string): Set<string> {
    return new Set(
      text
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // Supprimer les accents
        .replace(/[^\w\s]/g, " ") // Supprimer la ponctuation
        .split(/\s+/)
        .filter((w) => w.length > 2), // Ignorer les mots courts
    );
  }
}

// ============================================================================
// Exports
// ============================================================================

export default QuestionScorerService;
