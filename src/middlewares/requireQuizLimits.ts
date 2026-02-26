/**
 * 🎓 MIDDLEWARE DE LIMITATION DES QUIZ
 * Middleware pour vérifier et déduire les limites de quiz personnalisés et presets
 */

import { Request, Response, NextFunction } from "express";
import { QuizLimitsService } from "../services/credits/quizLimitsService.js";
import { AuthUser } from "../services/auth.js";
import { SecureLogger } from "./secureLogging.js";
import { z } from "zod";
import { LyceeSpecialty } from "../services/quiz/types.js";

// Interface pour les requêtes authentifiées
interface AuthRequest extends Request {
  user?: AuthUser;
}

// LyceeSpecialty enum values for validation
const LyceeSpecialtyValues = Object.values(LyceeSpecialty) as [string, ...string[]];

// JSON value schema for recursive JSON structures
const JsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(JsonValueSchema),
  ]),
);

// Schémas de validation Zod
const PresetSequenceSchema = z.object({
  preset: z.enum(["BREVET", "BAC", "PARTIELS"], {
    errorMap: () => ({
      message: "Le preset doit être BREVET, BAC ou PARTIELS",
    }),
  }),
  subjects: z.array(z.record(JsonValueSchema)).optional().default([]),
  totalSubjects: z.number().int().min(0).optional().default(0),
  specialties: z.array(z.enum(LyceeSpecialtyValues)).optional(),
  higherEdField: z.string().optional(),
  workspaceIds: z.array(z.string()).optional().default([]),
  metadata: z.record(JsonValueSchema).optional().default({}),
});

/**
 * Middleware pour vérifier et déduire les limites de quiz personnalisés
 * @param autoDeduct - Si true, déduit automatiquement un quota après vérification
 */
export function requireCustomQuizLimits(autoDeduct: boolean = true) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "AUTHENTICATION_REQUIRED",
          message: "Authentification requise",
        });
      }

      SecureLogger.debug(`🎯 [QUIZ-MIDDLEWARE] Vérification limites quiz personnalisés`, {
        userId,
        autoDeduct,
      });

      // Vérifier si l'utilisateur peut créer un quiz personnalisé
      const canCreate = await QuizLimitsService.canCreateCustomQuiz(userId);

      if (!canCreate.success) {
        SecureLogger.warn(`❌ [QUIZ-MIDDLEWARE] Limite quiz personnalisés atteinte`, {
          userId,
          remainingQuizzes: canCreate.remainingQuizzes,
        });

        return res.status(403).json({
          success: false,
          error: "CUSTOM_QUIZ_LIMIT_REACHED",
          message: canCreate.message,
          remainingQuizzes: canCreate.remainingQuizzes,
          limitType: "quiz-custom",
        });
      }

      // Si auto-déduction activée, déduire un quota
      if (autoDeduct) {
        const deductResult = await QuizLimitsService.deductCustomQuiz(userId);

        if (!deductResult.success) {
          SecureLogger.warn(`❌ [QUIZ-MIDDLEWARE] Échec déduction quiz personnalisé`, {
            userId,
            message: deductResult.message,
          });

          return res.status(403).json({
            success: false,
            error: "CUSTOM_QUIZ_DEDUCTION_FAILED",
            message: deductResult.message,
            remainingQuizzes: deductResult.remainingQuizzes,
            limitType: "quiz-custom",
          });
        }

        SecureLogger.debug(`✅ [QUIZ-MIDDLEWARE] Quiz personnalisé déduit`, {
          userId,
          remainingQuizzes: deductResult.remainingQuizzes,
        });

        // Stocker les informations de limite dans la requête pour usage ultérieur
        req.quizLimits = {
          type: "custom",
          remainingQuizzes: deductResult.remainingQuizzes,
          deducted: true,
        };
      } else {
        req.quizLimits = {
          type: "custom",
          remainingQuizzes: canCreate.remainingQuizzes,
          deducted: false,
        };
      }

      next();
    } catch (error) {
      SecureLogger.error("❌ Erreur middleware limites quiz personnalisés", error);
      res.status(500).json({
        success: false,
        error: "QUIZ_LIMITS_CHECK_ERROR",
        message: "Erreur lors de la vérification des limites de quiz",
      });
    }
  };
}

/**
 * Middleware pour vérifier les limites de séquences de preset
 * @param autoStart - Si true, démarre automatiquement une nouvelle séquence
 */
export function requirePresetSequenceLimits(autoStart: boolean = false) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "AUTHENTICATION_REQUIRED",
          message: "Authentification requise",
        });
      }

      // Valider seulement le preset pour la vérification initiale
      const presetCheck = z.enum(["BREVET", "BAC", "PARTIELS"]).safeParse(req.body?.preset);
      if (!presetCheck.success) {
        return res.status(400).json({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Preset invalide ou manquant.",
        });
      }
      const preset = presetCheck.data;

      SecureLogger.debug(`🎯 [QUIZ-MIDDLEWARE] Vérification limites séquences preset`, {
        userId,
        preset,
        autoStart,
      });

      // Vérifier si l'utilisateur peut créer une nouvelle séquence de preset
      const canCreate = await QuizLimitsService.canCreatePresetSequence(userId, preset);

      if (!canCreate.success) {
        SecureLogger.warn(`❌ [QUIZ-MIDDLEWARE] Limite séquences preset atteinte`, {
          userId,
          preset,
          existingSequence: canCreate.existingSequence,
        });

        return res.status(403).json({
          success: false,
          error: "PRESET_SEQUENCE_LIMIT_REACHED",
          message: canCreate.message,
          limitType: "quiz-preset",
          existingSequence: canCreate.existingSequence,
        });
      }

      // Si auto-start activé, valider le reste du corps et démarrer la séquence
      if (autoStart) {
        const validationResult = PresetSequenceSchema.safeParse(req.body);
        if (!validationResult.success) {
          return res.status(400).json({
            success: false,
            error: "VALIDATION_ERROR",
            message: "Données de requête invalides pour le démarrage de la séquence.",
            details: validationResult.error.issues,
          });
        }

        const sequenceData = validationResult.data;
        const startResult = await QuizLimitsService.startPresetSequence(
          userId,
          preset,
          sequenceData,
        );

        if (!startResult.success) {
          SecureLogger.warn(`❌ [QUIZ-MIDDLEWARE] Échec démarrage séquence preset`, {
            userId,
            preset,
            message: startResult.message,
          });
          return res.status(403).json({
            success: false,
            error: "PRESET_SEQUENCE_START_FAILED",
            message: startResult.message,
            limitType: "quiz-preset",
          });
        }

        SecureLogger.debug(`✅ [QUIZ-MIDDLEWARE] Séquence preset démarrée`, {
          userId,
          preset,
          sequenceId: startResult.sequenceId,
        });

        req.quizSequence = {
          id: startResult.sequenceId!,
          preset,
          started: true,
        };
        // Marquer comme déduit pour le rollback en cas d'erreur
        req.quizLimits = { type: "preset", deducted: true };
      } else {
        req.quizLimits = { type: "preset", canCreate: true };
      }

      next();
    } catch (error) {
      SecureLogger.error("❌ Erreur middleware limites séquences preset", error);
      res.status(500).json({
        success: false,
        error: "PRESET_LIMITS_CHECK_ERROR",
        message: "Erreur lors de la vérification des limites de preset",
      });
    }
  };
}

/**
 * Middleware pour rembourser les quotas en cas d'erreur
 */
export function setupQuizRefundOnError() {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const originalJson = res.json.bind(res);

    res.json = function (body: unknown) {
      // Si c'est une erreur et qu'on a déduit des quotas, les rembourser
      if (res.statusCode >= 400 && req.quizLimits?.deducted && req.user?.id) {
        const userId = req.user.id;
        const limitType = req.quizLimits.type;

        SecureLogger.debug(`🔄 [QUIZ-MIDDLEWARE] Remboursement automatique détecté`, {
          userId,
          limitType,
          statusCode: res.statusCode,
        });

        // Remboursement asynchrone (ne pas bloquer la réponse)
        void (async () => {
          try {
            const refundResult = await QuizLimitsService.refundQuiz(
              userId,
              limitType === "custom" ? "custom" : "preset",
            );
            if (refundResult.success) {
              SecureLogger.debug(`✅ [QUIZ-MIDDLEWARE] Remboursement automatique réussi`, {
                userId,
                limitType,
              });
            } else {
              SecureLogger.error(`❌ [QUIZ-MIDDLEWARE] Échec remboursement automatique`, {
                userId,
                limitType,
                error: refundResult.message,
              });
            }
          } catch (error) {
            SecureLogger.error("❌ Erreur remboursement automatique quiz", error);
          }
        })();

        // Ajouter info de remboursement dans la réponse
        if (typeof body === "object" && body !== null) {
          (body as Record<string, unknown>).refundInfo = {
            message: "Quota de quiz remboursé suite à l'erreur",
            type: limitType,
          };
        }
      }

      return originalJson(body);
    };

    next();
  };
}

// Extension des types TypeScript
declare global {
  namespace Express {
    interface Request {
      quizLimits?: {
        type: "custom" | "preset";
        remainingQuizzes?: number;
        deducted?: boolean;
        canCreate?: boolean;
      };
      quizSequence?: {
        id: string;
        preset: string;
        started: boolean;
      };
    }
  }
}
