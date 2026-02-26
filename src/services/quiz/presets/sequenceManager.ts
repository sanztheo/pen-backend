import { logger } from "../../../utils/logger.js";
import {
  QuizGenerationRequest,
  SequentialQuizConfig,
  QuizPreset,
  LyceeSpecialty,
  CollegeGrade,
  SubjectResult,
  QuizCorrectionRequest,
  QuizCorrectionResult,
} from "../types.js";

// Import des modules spécialisés
import {
  createBrevetSequentialConfig,
  generateBrevetSubjectRequest,
  calculateBrevetGlobalScore,
  BREVET_CONFIG,
} from "./brevet/index.js";

import {
  createBacSequentialConfig,
  generateBacSubjectRequest,
  calculateBacGlobalScore,
  BAC_CONFIG,
} from "./bac/index.js";

import {
  createPartielsSequentialConfig,
  generatePartielsSubjectRequest,
  calculatePartielsGlobalScore,
  getCurrentSubjectName,
  PARTIELS_CONFIG,
} from "./partiels/index.js";

/**
 * Interface pour les options de création de séquence
 */
export interface SequenceCreationOptions {
  userId: string;
  preset: QuizPreset;
  specialties?: LyceeSpecialty[];
  higherEdField?: string;
  collegeGrade?: CollegeGrade;
  workspaceIds?: string[];
}

/**
 * Gestionnaire principal pour les quiz séquentiels
 */
export class SequenceManager {
  /**
   * Crée une nouvelle configuration séquentielle selon le preset
   */
  static async createSequentialConfig(
    options: SequenceCreationOptions,
  ): Promise<SequentialQuizConfig> {
    const { userId, preset, specialties, higherEdField, collegeGrade } = options;

    switch (preset) {
      case QuizPreset.BREVET:
        return createBrevetSequentialConfig(userId, collegeGrade);

      case QuizPreset.BAC:
        if (!specialties || specialties.length !== 2) {
          throw new Error("Le Baccalauréat nécessite exactement 2 spécialités");
        }
        return createBacSequentialConfig(userId, specialties);

      case QuizPreset.PARTIELS:
        if (!higherEdField) {
          throw new Error("Les partiels nécessitent de spécifier une filière d'études supérieures");
        }
        return await createPartielsSequentialConfig(userId, higherEdField);

      default:
        throw new Error(`Preset non supporté: ${preset}`);
    }
  }

  /**
   * Génère la requête pour la matière courante
   */
  static generateCurrentSubjectRequest(
    config: SequentialQuizConfig,
    workspaceIds?: string[],
  ): QuizGenerationRequest {
    if (config.isCompleted) {
      throw new Error("La séquence de quiz est déjà terminée");
    }

    if (config.currentSubjectIndex >= config.totalSubjects) {
      throw new Error("Index de matière invalide");
    }

    // L'ID est au format: brevet_user_XXXXX_timestamp
    const parts = config.id.split("_");
    const userId = parts.slice(1, -1).join("_"); // Récupérer tout entre le preset et le timestamp

    logger.log("🔍 Extraction userId depuis ID séquence:", {
      sequenceId: config.id,
      extractedUserId: userId,
      parts,
    });

    switch (config.preset) {
      case QuizPreset.BREVET:
        return generateBrevetSubjectRequest(config, userId, workspaceIds);

      case QuizPreset.BAC:
        return generateBacSubjectRequest(config, userId, workspaceIds);

      case QuizPreset.PARTIELS:
        return generatePartielsSubjectRequest(config, userId, workspaceIds);

      default:
        throw new Error(`Preset non supporté: ${config.preset}`);
    }
  }

  /**
   * Met à jour la configuration après génération d'un quiz
   */
  static markQuizGenerated(config: SequentialQuizConfig, quizId: string): SequentialQuizConfig {
    const updatedConfig = { ...config };
    const currentResult = updatedConfig.subjectResults[config.currentSubjectIndex];

    if (currentResult) {
      currentResult.quizId = quizId;
      currentResult.isGenerating = false;
    }

    return updatedConfig;
  }

  /**
   * Met à jour la configuration après soumission d'un quiz
   */
  static markQuizSubmitted(
    config: SequentialQuizConfig,
    correctionResult: QuizCorrectionResult,
  ): SequentialQuizConfig {
    const updatedConfig = { ...config };
    const currentResult = updatedConfig.subjectResults[config.currentSubjectIndex];

    if (currentResult) {
      currentResult.isCompleted = true;
      currentResult.score = correctionResult.totalScore;
      currentResult.maxScore = correctionResult.maxScore;
      currentResult.percentage = correctionResult.percentage;
      // 🔧 FIX: Gérer le cas où startedAt peut être une chaîne ou un objet Date
      const startedAt =
        config.metadata.startedAt instanceof Date
          ? config.metadata.startedAt
          : new Date(config.metadata.startedAt);

      currentResult.timeSpent = Math.round((new Date().getTime() - startedAt.getTime()) / 60000); // en minutes
      currentResult.isCorrecting = false;
    }

    // Passer à la matière suivante ou terminer
    if (config.currentSubjectIndex + 1 < config.totalSubjects) {
      updatedConfig.currentSubjectIndex++;
      // NE PLUS marquer automatiquement le prochain quiz comme en cours de génération
      // La génération se fera manuellement via le bouton "Générer"
    } else {
      // Séquence terminée
      updatedConfig.isCompleted = true;

      // Calculer les scores globaux
      const globalScore = this.calculateGlobalScore(updatedConfig);
      updatedConfig.globalScore = globalScore.totalScore;
      updatedConfig.globalMaxScore = globalScore.maxScore;

      // Mettre à jour le temps total réel
      updatedConfig.metadata.realTotalTime = Math.round(
        (new Date().getTime() - config.metadata.startedAt.getTime()) / 60000,
      );
    }

    return updatedConfig;
  }

  /**
   * Marque la correction comme en cours
   */
  static markCorrectionInProgress(config: SequentialQuizConfig): SequentialQuizConfig {
    const updatedConfig = { ...config };
    const currentResult = updatedConfig.subjectResults[config.currentSubjectIndex];

    if (currentResult) {
      currentResult.isCorrecting = true;
    }

    return updatedConfig;
  }

  /**
   * Vérifie si un quiz suivant doit être généré
   */
  static shouldGenerateNext(config: SequentialQuizConfig): boolean {
    return !config.isCompleted && config.currentSubjectIndex + 1 < config.totalSubjects;
  }

  /**
   * Retourne les informations sur la matière courante
   */
  static getCurrentSubjectInfo(config: SequentialQuizConfig): {
    name: string;
    index: number;
    total: number;
    isLast: boolean;
  } {
    let name: string;

    switch (config.preset) {
      case QuizPreset.BREVET:
        const brevetSubject = BREVET_CONFIG.subjects[config.currentSubjectIndex];
        name = brevetSubject ? brevetSubject.description : "Matière inconnue";
        break;

      case QuizPreset.BAC:
        // Le nom est géré dans le module BAC
        name = `Matière ${config.currentSubjectIndex + 1}`;
        break;

      case QuizPreset.PARTIELS:
        name = getCurrentSubjectName(config);
        break;

      default:
        name = "Matière inconnue";
    }

    return {
      name,
      index: config.currentSubjectIndex + 1,
      total: config.totalSubjects,
      isLast: config.currentSubjectIndex === config.totalSubjects - 1,
    };
  }

  /**
   * Calcule le score global selon le preset
   */
  static calculateGlobalScore(config: SequentialQuizConfig): {
    totalScore: number;
    maxScore: number;
    grade: number;
    mention?: string;
  } {
    switch (config.preset) {
      case QuizPreset.BREVET:
        return calculateBrevetGlobalScore(config);

      case QuizPreset.BAC:
        return calculateBacGlobalScore(config);

      case QuizPreset.PARTIELS:
        return calculatePartielsGlobalScore(config);

      default:
        // Calcul générique
        const totalScore = config.subjectResults.reduce(
          (sum, result) => sum + (result.score || 0),
          0,
        );
        const maxScore = config.subjectResults.reduce(
          (sum, result) => sum + (result.maxScore || 0),
          0,
        );
        const grade = maxScore > 0 ? (totalScore / maxScore) * 20 : 0;

        return {
          totalScore,
          maxScore,
          grade: Math.round(grade * 100) / 100,
        };
    }
  }

  /**
   * Génère un résumé de la progression
   */
  static getProgressSummary(config: SequentialQuizConfig): {
    preset: string;
    completed: number;
    total: number;
    currentSubject?: string;
    estimatedTimeRemaining?: number; // en minutes
    globalProgress: number; // pourcentage
  } {
    const completed = config.subjectResults.filter((r) => r.isCompleted).length;
    const globalProgress = Math.round((completed / config.totalSubjects) * 100);

    let presetName: string;
    switch (config.preset) {
      case QuizPreset.BREVET:
        presetName = "Brevet des Collèges";
        break;
      case QuizPreset.BAC:
        presetName = "Baccalauréat Général";
        break;
      case QuizPreset.PARTIELS:
        presetName = `Partiels ${config.higherEdField || ""}`;
        break;
      default:
        presetName = "Quiz Séquentiel";
    }

    const summary: {
      preset: string;
      completed: number;
      total: number;
      globalProgress: number;
      currentSubject?: string;
      estimatedTimeRemaining?: number;
    } = {
      preset: presetName,
      completed,
      total: config.totalSubjects,
      globalProgress,
    };

    if (!config.isCompleted) {
      summary.currentSubject = this.getCurrentSubjectInfo(config).name;

      // Estimation du temps restant basée sur le temps déjà écoulé
      if (completed > 0) {
        const elapsedTime = (new Date().getTime() - config.metadata.startedAt.getTime()) / 60000;
        const avgTimePerSubject = elapsedTime / completed;
        summary.estimatedTimeRemaining = Math.round(
          avgTimePerSubject * (config.totalSubjects - completed),
        );
      } else {
        // Utiliser l'estimation initiale
        const remainingSubjects = config.totalSubjects - config.currentSubjectIndex;
        summary.estimatedTimeRemaining = Math.round(
          config.metadata.estimatedTotalTime * (remainingSubjects / config.totalSubjects),
        );
      }
    }

    return summary;
  }

  /**
   * Valide la configuration d'une séquence
   */
  static validateSequentialConfig(config: SequentialQuizConfig): boolean {
    if (!config.id || !config.preset || !config.subjects || config.subjects.length === 0) {
      return false;
    }

    if (config.currentSubjectIndex < 0 || config.currentSubjectIndex >= config.totalSubjects) {
      return false;
    }

    if (config.subjectResults.length !== config.subjects.length) {
      return false;
    }

    // Validations spécifiques par preset
    switch (config.preset) {
      case QuizPreset.BAC:
        return config.specialties !== undefined && config.specialties.length === 2;

      case QuizPreset.PARTIELS:
        return config.higherEdField !== undefined;

      default:
        return true;
    }
  }
}
