/**
 * 🎓 SERVICE DE GESTION DES LIMITES DE QUIZ
 * Gestion des limitations pour les quiz personnalisés et les séquences de preset
 */

import { prisma } from "../../lib/prisma.js";
import { SecureLogger } from "../../middlewares/secureLogging.js";
import { retryPrismaTransaction } from "../../lib/retryWithBackoff.js";
import { QuizPreset, LyceeSpecialty } from "../quiz/types.js";
import type { Prisma } from "@prisma/client";

/**
 * Subject data structure for quiz sequences (JSON-compatible for Prisma)
 * Represents a single subject entry in the sequence
 */
export type SequenceSubjectData = Record<string, unknown>;

/**
 * Metadata structure for quiz sequences (JSON-compatible for Prisma)
 */
export type SequenceMetadata = Record<string, unknown>;

/**
 * Metadata for quiz usage records (JSON-compatible for Prisma)
 */
export type QuizUsageMetadata = Record<string, unknown>;

/**
 * Helper to cast to Prisma InputJsonValue
 */
function toJsonValue<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

const LYCEE_SPECIALTY_VALUES: ReadonlySet<string> = new Set(Object.values(LyceeSpecialty));

function isLyceeSpecialty(value: string): value is LyceeSpecialty {
  return LYCEE_SPECIALTY_VALUES.has(value);
}

/**
 * Helper to cast string array to LyceeSpecialty array
 */
function toLyceeSpecialties(values: string[] | undefined): LyceeSpecialty[] {
  return (values ?? []).filter(isLyceeSpecialty);
}

export interface QuizLimitResult {
  success: boolean;
  remainingQuizzes?: number;
  limitReached: boolean;
  message: string;
  existingSequence?: {
    id: string;
    preset: string;
    currentSubjectIndex: number;
    totalSubjects: number;
    progress: number;
  };
}

export class QuizLimitsService {
  /**
   * Vérifier si un utilisateur peut créer un quiz personnalisé
   * @param userId - ID de l'utilisateur
   */
  static async canCreateCustomQuiz(userId: string): Promise<QuizLimitResult> {
    SecureLogger.debug(`🎯 [QUIZ-LIMITS] Vérification limite quiz personnalisés`, { userId });

    try {
      const userLimits = await prisma.userLimits.findUnique({
        where: { userId },
      });

      if (!userLimits) {
        SecureLogger.debug(`📝 [QUIZ-LIMITS] Création nouvelles limites utilisateur`, { userId });
        // Créer les limites si elles n'existent pas
        await prisma.userLimits.create({
          data: {
            userId,
            customQuizzesLimit: 5, // Limite par défaut pour free user
          },
        });

        return {
          success: true,
          remainingQuizzes: 5,
          limitReached: false,
          message: "Quiz personnalisé autorisé",
        };
      }

      // Vérifier si l'utilisateur a atteint sa limite (-1 = illimité)
      if (userLimits.customQuizzesLimit === -1) {
        return {
          success: true,
          remainingQuizzes: -1,
          limitReached: false,
          message: "Quiz personnalisé autorisé (illimité)",
        };
      }

      const remaining = userLimits.customQuizzesLimit - userLimits.customQuizzesUsed;
      if (remaining <= 0) {
        return {
          success: false,
          remainingQuizzes: 0,
          limitReached: true,
          message: "Limite de quiz personnalisés atteinte",
        };
      }

      return {
        success: true,
        remainingQuizzes: remaining,
        limitReached: false,
        message: "Quiz personnalisé autorisé",
      };
    } catch (error) {
      SecureLogger.error("Erreur lors de la vérification des limites quiz personnalisés", error);
      return {
        success: false,
        remainingQuizzes: 0,
        limitReached: false,
        message: "Erreur lors de la vérification des limites",
      };
    }
  }

  /**
   * Déduire un quiz personnalisé (ULTRA-OPTIMISÉ POUR GRANDE ÉCHELLE)
   * Utilise UPSERT + ON CONFLICT pour éliminer complètement les deadlocks
   * @param userId - ID de l'utilisateur
   */
  static async deductCustomQuiz(userId: string): Promise<QuizLimitResult> {
    SecureLogger.debug(`🚀 [QUIZ-LIMITS] Déduction quiz ultra-optimisée`, {
      userId,
    });

    try {
      // 🎯 OPÉRATION ATOMIQUE PURE - Zéro deadlock possible
      // Stratégie: UPSERT pour créer/incrémenter en une seule opération atomique
      const now = new Date();
      const result = await prisma.$executeRaw`
        INSERT INTO "user_limits" (
          "user_id", "ai_credits_used", "ai_credits_limit",
          "workspaces_used", "workspaces_limit", "projects_used", "projects_limit", 
          "custom_quizzes_used", "custom_quizzes_limit", "preset_sequences_used", "preset_sequences_limit",
          "last_reset_at", "reset_type", "created_at", "updated_at", "pages_limit", "pages_used"
        )
        VALUES (
          ${userId}, 0, 50,
          0, 2, 0, 4,
          1, 5, 0, 1,
          ${now}, 'monthly', ${now}, ${now}, -1, 0
        )
        ON CONFLICT ("user_id") 
        DO UPDATE SET 
          "custom_quizzes_used" = CASE 
            WHEN "user_limits"."custom_quizzes_limit" = -1 THEN "user_limits"."custom_quizzes_used" + 1
            WHEN ("user_limits"."custom_quizzes_used" + 1) <= "user_limits"."custom_quizzes_limit" THEN "user_limits"."custom_quizzes_used" + 1
            ELSE "user_limits"."custom_quizzes_used"
          END,
          "updated_at" = ${now}
        WHERE "user_limits"."custom_quizzes_limit" = -1 
           OR ("user_limits"."custom_quizzes_used" + 1) <= "user_limits"."custom_quizzes_limit"
      `;

      SecureLogger.debug(`⚡ [QUIZ-LIMITS] UPSERT atomique exécuté`, {
        userId,
        affected: result,
      });

      // Récupérer l'état final pour validation (lecture unique)
      const finalLimits = await prisma.userLimits.findUnique({
        where: { userId },
        select: {
          customQuizzesUsed: true,
          customQuizzesLimit: true,
        },
      });

      if (!finalLimits) {
        SecureLogger.error(`❌ [QUIZ-LIMITS] Limites introuvables après UPSERT`, { userId });
        return {
          success: false,
          remainingQuizzes: 0,
          limitReached: false,
          message: "Erreur système lors de la déduction",
        };
      }

      // Vérifier si la déduction a réussi (usage a augmenté)
      const previousUsage = result === 0 ? finalLimits.customQuizzesUsed - 1 : 0; // Si INSERT, usage était 0
      const deductionSucceeded = finalLimits.customQuizzesUsed > previousUsage;

      if (!deductionSucceeded) {
        const currentRemaining =
          finalLimits.customQuizzesLimit === -1
            ? -1
            : Math.max(0, finalLimits.customQuizzesLimit - finalLimits.customQuizzesUsed);

        SecureLogger.warn(`❌ [QUIZ-LIMITS] Limite atteinte (déduction refusée)`, {
          userId,
          currentUsage: finalLimits.customQuizzesUsed,
          limit: finalLimits.customQuizzesLimit,
          remainingQuizzes: currentRemaining,
        });

        return {
          success: false,
          remainingQuizzes: currentRemaining,
          limitReached: true,
          message: "Limite de quiz personnalisés atteinte",
        };
      }

      // Succès - calculer les quiz restants
      const remainingQuizzes =
        finalLimits.customQuizzesLimit === -1
          ? -1 // Illimité
          : Math.max(0, finalLimits.customQuizzesLimit - finalLimits.customQuizzesUsed);

      SecureLogger.debug(`✅ [QUIZ-LIMITS] Déduction ultra-rapide réussie`, {
        userId,
        newUsage: finalLimits.customQuizzesUsed,
        remainingQuizzes,
        operationType: result === 0 ? "UPDATE" : "INSERT",
      });

      // Enregistrer l'utilisation (asynchrone, pas critique)
      setImmediate(() => {
        this.recordQuizUsage(userId, "custom_quiz", 1, {
          type: "custom_quiz_creation",
          method: "upsert_atomic",
        }).catch((err) => SecureLogger.warn("Erreur enregistrement usage (non-critique)", err));
      });

      return {
        success: true,
        remainingQuizzes,
        limitReached: false,
        message: "Quiz personnalisé déduit avec succès",
      };
    } catch (error: unknown) {
      SecureLogger.error("❌ Erreur lors de la déduction atomique quiz personnalisé", error);

      // Gestion spécifique des erreurs Prisma
      const isPrismaError = error !== null && typeof error === "object" && "code" in error;
      if (isPrismaError && (error as { code: string }).code === "P2034") {
        // Transaction timeout
        return {
          success: false,
          remainingQuizzes: 0,
          limitReached: false,
          message: "Timeout lors de la déduction (trop de trafic)",
        };
      }

      return {
        success: false,
        remainingQuizzes: 0,
        limitReached: false,
        message: "Erreur lors de la déduction du quiz",
      };
    }
  }

  /**
   * Vérifier si un utilisateur peut créer une nouvelle séquence de preset
   * @param userId - ID de l'utilisateur
   * @param preset - Type de preset (BREVET, BAC, PARTIELS)
   */
  static async canCreatePresetSequence(userId: string, preset: string): Promise<QuizLimitResult> {
    SecureLogger.debug(`🎯 [QUIZ-LIMITS] Vérification limite séquences preset`, { userId, preset });

    try {
      // Vérifier les limites utilisateur d'abord pour déterminer le plan
      const userLimits = await prisma.userLimits.findUnique({
        where: { userId },
      });

      if (!userLimits) {
        // Créer les limites si elles n'existent pas
        await prisma.userLimits.create({
          data: {
            userId,
            presetSequencesLimit: 1, // Limite par défaut pour free user
          },
        });

        return {
          success: true,
          limitReached: false,
          message: "Séquence de preset autorisée",
        };
      }

      // Premium : illimité - peut créer plusieurs séquences
      if (userLimits.presetSequencesLimit === -1) {
        SecureLogger.debug(`✅ [QUIZ-LIMITS] Utilisateur premium - séquences illimitées`, {
          userId,
        });
        return {
          success: true,
          limitReached: false,
          message: "Séquence de preset autorisée (illimité)",
        };
      }

      // Free : vérifier s'il existe déjà une séquence non terminée
      const existingSequence = await prisma.quizSequence.findFirst({
        where: {
          userId,
          isCompleted: false,
        },
        select: {
          id: true,
          preset: true,
          currentSubjectIndex: true,
          totalSubjects: true,
        },
      });

      if (existingSequence) {
        const progress = Math.round(
          (existingSequence.currentSubjectIndex / existingSequence.totalSubjects) * 100,
        );

        SecureLogger.debug(`📊 [QUIZ-LIMITS] Séquence existante trouvée (utilisateur gratuit)`, {
          userId,
          sequenceId: existingSequence.id,
          progress,
        });

        return {
          success: false,
          limitReached: true,
          message: "Séquence de preset déjà en cours (limite gratuit)",
          existingSequence: {
            id: existingSequence.id,
            preset: existingSequence.preset,
            currentSubjectIndex: existingSequence.currentSubjectIndex,
            totalSubjects: existingSequence.totalSubjects,
            progress,
          },
        };
      }

      // Free : 1 séquence max à la fois, mais aucune en cours
      return {
        success: true,
        limitReached: false,
        message: "Séquence de preset autorisée",
      };
    } catch (error) {
      SecureLogger.error("Erreur lors de la vérification des limites séquences preset", error);
      return {
        success: false,
        limitReached: false,
        message: "Erreur lors de la vérification des limites",
      };
    }
  }

  /**
   * Démarrer une nouvelle séquence de preset (ATOMIQUE)
   * @param userId - ID de l'utilisateur
   * @param preset - Type de preset
   * @param sequenceData - Données de la séquence
   */
  static async startPresetSequence(
    userId: string,
    preset: string,
    sequenceData: {
      subjects: SequenceSubjectData[];
      totalSubjects: number;
      specialties?: string[];
      higherEdField?: string;
      workspaceIds: string[];
      metadata: SequenceMetadata;
    },
  ): Promise<{ success: boolean; sequenceId?: string; message: string }> {
    SecureLogger.debug(`🚀 [QUIZ-LIMITS] Démarrage séquence preset`, {
      userId,
      preset,
    });

    try {
      // 🔒 TRANSACTION ATOMIQUE avec RETRY
      const retryResult = await retryPrismaTransaction(
        async () => {
          return await prisma.$transaction(
            async (tx) => {
              // Vérifier à nouveau qu'il n'y a pas de séquence en cours
              const existingSequence = await tx.quizSequence.findFirst({
                where: {
                  userId,
                  isCompleted: false,
                },
              });

              if (existingSequence) {
                return {
                  success: false,
                  message: "Une séquence est déjà en cours",
                };
              }

              // Créer la nouvelle séquence
              const newSequence = await tx.quizSequence.create({
                data: {
                  userId,
                  preset: preset as QuizPreset,
                  totalSubjects: sequenceData.totalSubjects,
                  subjects: toJsonValue(sequenceData.subjects),
                  subjectResults: [],
                  specialties: toLyceeSpecialties(sequenceData.specialties),
                  higherEdField: sequenceData.higherEdField,
                  workspaceIds: sequenceData.workspaceIds,
                  metadata: toJsonValue(sequenceData.metadata),
                },
              });

              // Incrémenter l'usage des séquences preset
              await tx.$executeRaw`
          UPDATE "user_limits" 
          SET "preset_sequences_used" = "preset_sequences_used" + 1
          WHERE "user_id" = ${userId}
        `;

              SecureLogger.debug(`✅ [QUIZ-LIMITS] Séquence preset créée`, {
                userId,
                sequenceId: newSequence.id,
              });

              return {
                success: true,
                sequenceId: newSequence.id,
                message: "Séquence de preset créée avec succès",
              };
            },
            {
              isolationLevel: "Serializable",
              timeout: 10000,
            },
          );
        },
        { userId, operation: "startPresetSequence", preset },
      );

      // Vérifier le résultat du retry
      if (!retryResult.success) {
        SecureLogger.error(
          `❌ [QUIZ-LIMITS] Échec définitif création séquence après ${retryResult.attempts} tentatives`,
          {
            userId,
            preset,
            attempts: retryResult.attempts,
            totalTime: retryResult.totalTime,
            error: retryResult.error,
          },
        );

        // Type guard pour accès sécurisé au code d'erreur
        const errorCode =
          retryResult.error !== null &&
          typeof retryResult.error === "object" &&
          "code" in retryResult.error
            ? String((retryResult.error as { code: unknown }).code)
            : undefined;

        if (errorCode === "P2034") {
          return {
            success: false,
            message: "Service temporairement surchargé, veuillez réessayer",
          };
        }

        return {
          success: false,
          message: "Erreur lors de la création de la séquence",
        };
      }

      const result = retryResult.data!;

      // Enregistrer l'utilisation après la transaction
      if (result.success) {
        await this.recordQuizUsage(userId, "preset_sequence", 1, {
          type: "preset_sequence_start",
          preset,
          sequenceId: result.sequenceId,
        });
      }

      return result;
    } catch (error) {
      SecureLogger.error("❌ Erreur lors du démarrage de la séquence preset", error);
      return {
        success: false,
        message: "Erreur lors de la création de la séquence",
      };
    }
  }

  /**
   * Rembourser un quota de quiz en cas d'échec
   * @param userId - ID de l'utilisateur
   * @param type - Type de quiz ('custom' ou 'preset')
   */
  static async refundQuiz(
    userId: string,
    type: "custom" | "preset",
  ): Promise<{ success: boolean; message?: string }> {
    SecureLogger.debug(`🔄 [QUIZ-LIMITS] Remboursement quota quiz`, {
      userId,
      type,
    });

    try {
      if (type === "custom") {
        // Remboursement quiz personnalisé
        await prisma.$executeRaw`
          UPDATE "user_limits" 
          SET "custom_quizzes_used" = GREATEST(0, "custom_quizzes_used" - 1)
          WHERE "user_id" = ${userId}
        `;

        await this.recordQuizUsage(userId, "custom_quiz_refund", -1, {
          reason: "generation_failure",
        });
      } else {
        // Remboursement séquence preset - supprimer la séquence non complétée
        const deletedSequence = await prisma.quizSequence.deleteMany({
          where: {
            userId,
            isCompleted: false,
          },
        });

        if (deletedSequence.count > 0) {
          await prisma.$executeRaw`
            UPDATE "user_limits" 
            SET "preset_sequences_used" = GREATEST(0, "preset_sequences_used" - 1)
            WHERE "user_id" = ${userId}
          `;

          await this.recordQuizUsage(userId, "preset_sequence_refund", -1, {
            reason: "generation_failure",
          });
        }
      }

      SecureLogger.debug(`✅ [QUIZ-LIMITS] Remboursement réussi`, {
        userId,
        type,
      });
      return {
        success: true,
        message: "Quota de quiz remboursé avec succès",
      };
    } catch (error) {
      SecureLogger.error("❌ Erreur lors du remboursement quota quiz", error);
      return {
        success: false,
        message: "Erreur lors du remboursement",
      };
    }
  }

  /**
   * Vérifier si un utilisateur peut créer un quiz avancé (>30 questions ET >10 pages)
   * @param userId - ID de l'utilisateur
   * @param questionCount - Nombre de questions
   * @param pagesCount - Nombre de pages sélectionnées
   */
  static async canCreateAdvancedQuiz(
    userId: string,
    questionCount: number,
    pagesCount: number,
  ): Promise<QuizLimitResult> {
    SecureLogger.debug(`🎯 [QUIZ-LIMITS] Vérification limite quiz avancés`, {
      userId,
      questionCount,
      pagesCount,
    });

    // Vérifier si c'est un quiz avancé (>30 questions ET >10 pages)
    const isAdvanced = questionCount > 30 && pagesCount > 10;
    if (!isAdvanced) {
      return {
        success: true,
        limitReached: false,
        message: "Quiz non-avancé, aucune limite spéciale",
      };
    }

    try {
      const userLimits = await prisma.userLimits.findUnique({
        where: { userId },
      });

      if (!userLimits) {
        SecureLogger.debug(`📝 [QUIZ-LIMITS] Création nouvelles limites utilisateur`, { userId });
        await prisma.userLimits.create({
          data: {
            userId,
            advancedQuizzesLimit: 10,
          },
        });

        return {
          success: true,
          limitReached: false,
          message: "Quiz avancé autorisé",
        };
      }

      // Vérifier et reset si nécessaire (24h après premier quiz avancé)
      const now = new Date();
      if (userLimits.advancedQuizzesResetAt) {
        const hoursSinceReset =
          (now.getTime() - userLimits.advancedQuizzesResetAt.getTime()) / (1000 * 60 * 60);

        if (hoursSinceReset >= 24) {
          SecureLogger.debug(`🔄 [QUIZ-LIMITS] Reset automatique quiz avancés`, {
            userId,
            hoursSinceReset,
          });

          await prisma.userLimits.update({
            where: { userId },
            data: {
              advancedQuizzesUsed: 0,
              advancedQuizzesResetAt: null,
            },
          });

          return {
            success: true,
            limitReached: false,
            message: "Quiz avancé autorisé (reset automatique effectué)",
          };
        }
      }

      // Vérifier la limite
      if (userLimits.advancedQuizzesUsed >= userLimits.advancedQuizzesLimit) {
        const hoursUntilReset = userLimits.advancedQuizzesResetAt
          ? Math.max(
              0,
              24 - (now.getTime() - userLimits.advancedQuizzesResetAt.getTime()) / (1000 * 60 * 60),
            )
          : 0;

        return {
          success: false,
          limitReached: true,
          message: `Limite de ${userLimits.advancedQuizzesLimit} quiz avancés par jour atteinte. Réessayez dans ${Math.ceil(hoursUntilReset)}h.`,
        };
      }

      return {
        success: true,
        limitReached: false,
        message: "Quiz avancé autorisé",
      };
    } catch (error) {
      SecureLogger.error("Erreur lors de la vérification des limites quiz avancés", error);
      return {
        success: false,
        limitReached: false,
        message: "Erreur lors de la vérification des limites",
      };
    }
  }

  /**
   * Déduire un quiz avancé (incrémenter le compteur)
   * @param userId - ID de l'utilisateur
   */
  static async deductAdvancedQuiz(userId: string): Promise<QuizLimitResult> {
    SecureLogger.debug(`🚀 [QUIZ-LIMITS] Déduction quiz avancé`, { userId });

    try {
      const now = new Date();

      // Atomic: increment usage + set resetAt (NULL → now) with WHERE guard on limit
      const affected = await prisma.$executeRaw`
        UPDATE "user_limits"
        SET "advanced_quizzes_used" = "advanced_quizzes_used" + 1,
            "advanced_quizzes_reset_at" = COALESCE("advanced_quizzes_reset_at", ${now}),
            "updated_at" = ${now}
        WHERE "user_id" = ${userId}
          AND ("advanced_quizzes_limit" = -1 OR "advanced_quizzes_used" < "advanced_quizzes_limit")
      `;

      if (affected === 0) {
        const userLimits = await prisma.userLimits.findUnique({
          where: { userId },
          select: { advancedQuizzesUsed: true, advancedQuizzesLimit: true },
        });

        if (!userLimits) {
          return {
            success: false,
            limitReached: false,
            message: "Limites utilisateur introuvables",
          };
        }

        return {
          success: false,
          remainingQuizzes: 0,
          limitReached: true,
          message: "Limite de quiz avancés atteinte",
        };
      }

      // Read final state for response
      const finalLimits = await prisma.userLimits.findUnique({
        where: { userId },
        select: { advancedQuizzesUsed: true, advancedQuizzesLimit: true },
      });

      const remaining = finalLimits
        ? finalLimits.advancedQuizzesLimit - finalLimits.advancedQuizzesUsed
        : 0;

      SecureLogger.debug(`✅ [QUIZ-LIMITS] Quiz avancé déduit`, {
        userId,
        newUsage: finalLimits?.advancedQuizzesUsed,
        remaining,
      });

      // Enregistrer l'utilisation
      await this.recordQuizUsage(userId, "advanced_quiz", 1, {
        type: "advanced_quiz_creation",
      });

      return {
        success: true,
        remainingQuizzes: remaining,
        limitReached: false,
        message: "Quiz avancé déduit avec succès",
      };
    } catch (error) {
      SecureLogger.error("❌ Erreur lors de la déduction quiz avancé", error);
      return {
        success: false,
        limitReached: false,
        message: "Erreur lors de la déduction",
      };
    }
  }

  /**
   * Enregistrer une utilisation de quiz dans les logs
   * @param userId - ID de l'utilisateur
   * @param resourceType - Type de ressource
   * @param quantity - Quantité utilisée
   * @param metadata - Métadonnées supplémentaires
   */
  private static async recordQuizUsage(
    userId: string,
    resourceType: string,
    quantity: number,
    metadata: QuizUsageMetadata = {},
  ): Promise<void> {
    try {
      await prisma.usageRecord.create({
        data: {
          userId,
          resourceType,
          action: quantity > 0 ? "quiz_creation" : "quiz_refund",
          quantity,
          metadata: toJsonValue(metadata),
        },
      });
    } catch (error) {
      SecureLogger.error("Erreur lors de l'enregistrement de l'utilisation quiz", error);
    }
  }
}
