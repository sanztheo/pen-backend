// preprocessor/limitValidator.ts - Service de validation et correction des limites de quiz

import { prisma } from "../../../lib/prisma.js";
import { SUBSCRIPTION_LIMITS, DEFAULT_QUESTION_TYPES, UPGRADE_MESSAGES } from "./constants.js";
import { normalizePlan } from "../../../utils/plans.js";
import type {
  QuizPreprocessorOutput,
  UserQuizContext,
  ValidationResult,
  ValidationCorrection,
  SubscriptionPlan,
  QuestionType,
} from "./types.js";

/**
 * Service de validation et correction des paramètres de quiz
 * selon les limites d'abonnement de l'utilisateur
 */
export class QuizLimitValidator {
  /**
   * Valide et corrige les suggestions de l'IA selon les limites de l'utilisateur
   */
  async validateAndCorrect(
    aiSuggestion: QuizPreprocessorOutput,
    userId: string,
  ): Promise<ValidationResult> {
    // Récupérer le contexte utilisateur
    const userContext = await this.getUserContext(userId);

    // Récupérer les limites du plan
    const planLimits = SUBSCRIPTION_LIMITS[userContext.plan];

    const corrections: ValidationCorrection[] = [];
    const correctedOutput = { ...aiSuggestion };
    let upgradeRequired = false;

    // 1. Valider et corriger le nombre de questions
    if (aiSuggestion.recommendedQuestionCount > planLimits.maxQuestionsPerQuiz) {
      corrections.push({
        field: "questionCount",
        originalValue: aiSuggestion.recommendedQuestionCount,
        correctedValue: planLimits.maxQuestionsPerQuiz,
        reason: UPGRADE_MESSAGES.questionCount,
      });

      correctedOutput.recommendedQuestionCount = planLimits.maxQuestionsPerQuiz;
      upgradeRequired = true;
    }

    // 2. Valider et corriger les types de questions
    const invalidTypes = aiSuggestion.questionTypes.filter(
      (type) => !planLimits.allowedQuestionTypes.includes(type),
    );

    if (invalidTypes.length > 0) {
      const allowedTypes = aiSuggestion.questionTypes.filter((type) =>
        planLimits.allowedQuestionTypes.includes(type),
      );

      // Si aucun type valide, utiliser les types par défaut du plan
      const finalTypes =
        allowedTypes.length > 0 ? allowedTypes : DEFAULT_QUESTION_TYPES[userContext.plan];

      corrections.push({
        field: "questionTypes",
        originalValue: aiSuggestion.questionTypes,
        correctedValue: finalTypes,
        reason: UPGRADE_MESSAGES.questionTypes,
      });

      correctedOutput.questionTypes = finalTypes;
      upgradeRequired = true;
    }

    // 3. Ajouter les métadonnées de correction
    if (corrections.length > 0) {
      correctedOutput.correctedByLimits = true;
      correctedOutput.originalRecommendations = {
        questionCount: aiSuggestion.recommendedQuestionCount,
        questionTypes: aiSuggestion.questionTypes,
      };
    }

    return {
      isValid: corrections.length === 0,
      correctedOutput,
      corrections,
      upgradeRequired,
    };
  }

  /**
   * Récupère le contexte utilisateur avec son plan et ses limites
   */
  private async getUserContext(userId: string): Promise<UserQuizContext> {
    const [subscription, existingLimits] = await Promise.all([
      prisma.userSubscription.findUnique({ where: { userId } }),
      prisma.userLimits.findUnique({ where: { userId } }),
    ]);

    const plan = normalizePlan(subscription?.plan) as SubscriptionPlan;
    let userLimits = existingLimits;

    // Si pas de limites, créer avec valeurs par défaut du plan
    if (!userLimits) {
      const planDefaults = SUBSCRIPTION_LIMITS[plan];
      userLimits = await prisma.userLimits.create({
        data: {
          userId,
          questionsPerQuizLimit: planDefaults.maxQuestionsPerQuiz,
          pagesSelectionLimit: planDefaults.maxPagesSelection,
          customQuizzesLimit: planDefaults.maxQuizzesPerMonth,
          customQuizzesUsed: 0,
        },
      });
    }

    return {
      userId,
      plan,
      currentLimits: {
        questionsPerQuizLimit: userLimits.questionsPerQuizLimit,
        pagesSelectionLimit: userLimits.pagesSelectionLimit,
        customQuizzesLimit: userLimits.customQuizzesLimit,
        customQuizzesUsed: userLimits.customQuizzesUsed,
      },
    };
  }

  /**
   * Expose le contexte utilisateur pour l'affichage (frontend/debug).
   * Évite d'accéder à la méthode privée via cast.
   */
  async getUserContextForDisplay(userId: string): Promise<UserQuizContext> {
    return this.getUserContext(userId);
  }

  /**
   * Vérifie si l'utilisateur peut créer un quiz avec les paramètres donnés
   */
  async canCreateQuiz(
    userId: string,
    questionCount: number,
    questionTypes: QuestionType[],
  ): Promise<{ allowed: boolean; reason?: string }> {
    const userContext = await this.getUserContext(userId);
    const planLimits = SUBSCRIPTION_LIMITS[userContext.plan];

    // Vérifier le nombre de questions
    if (questionCount > planLimits.maxQuestionsPerQuiz) {
      return {
        allowed: false,
        reason: UPGRADE_MESSAGES.questionCount,
      };
    }

    // Vérifier les types de questions
    const hasInvalidTypes = questionTypes.some(
      (type) => !planLimits.allowedQuestionTypes.includes(type),
    );

    if (hasInvalidTypes) {
      return {
        allowed: false,
        reason: UPGRADE_MESSAGES.questionTypes,
      };
    }

    // Vérifier le quota mensuel (si limité)
    if (
      userContext.currentLimits.customQuizzesLimit !== -1 &&
      userContext.currentLimits.customQuizzesUsed >= userContext.currentLimits.customQuizzesLimit
    ) {
      return {
        allowed: false,
        reason: "Quota mensuel de quiz atteint. Passez au plan supérieur pour plus de quiz.",
      };
    }

    return { allowed: true };
  }

  /**
   * Retourne les limites pour un plan donné
   */
  getLimitsForPlan(plan: SubscriptionPlan) {
    return SUBSCRIPTION_LIMITS[plan];
  }
}

// Export singleton instance
export const quizLimitValidator = new QuizLimitValidator();
