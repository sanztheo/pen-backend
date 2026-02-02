import { Request, Response } from "express";
import { AuthService } from "../services/auth.js";
import { UserSyncService } from "../services/userSync.js";
import { z } from "zod";
import { logger } from "../utils/logger.js";

// Schémas de validation
const registerSchema = z.object({
  email: z.string().email("Email invalide"),
  password: z
    .string()
    .min(6, "Le mot de passe doit contenir au moins 6 caractères"),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email("Email invalide"),
  password: z.string().min(1, "Mot de passe requis"),
});

/**
 * SÉCURITÉ: Filtrage des métadonnées utilisateur
 *
 * Cette fonction garantit que seules les propriétés autorisées des user_metadata
 * sont exposées au client. Cela évite la fuite d'informations sensibles qui
 * pourraient être stockées dans Supabase user_metadata.
 *
 * IMPORTANT: Toujours mettre à jour allowedFields lors de l'ajout de nouveaux
 * champs publics dans user_metadata.
 */
const getSafeUserMetadata = (
  userMetadata: unknown,
): Record<string, unknown> => {
  if (!userMetadata || typeof userMetadata !== "object") {
    return {};
  }

  const metadata = userMetadata as Record<string, unknown>;

  // Liste des propriétés autorisées à être exposées au client
  // SÉCURITÉ: Ne jamais ajouter de champs contenant des informations sensibles
  const allowedFields = [
    "firstName",
    "lastName",
    "displayName",
    "avatar",
    "timezone",
    "language",
    "theme",
    "autocompletionEnabled",
  ];

  const safeMetadata: Record<string, unknown> = {};

  allowedFields.forEach((field) => {
    if (metadata[field] !== undefined && metadata[field] !== null) {
      // Validation basique pour éviter l'injection de contenu malveillant
      const value = metadata[field];
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        safeMetadata[field] = value;
      }
    }
  });

  return safeMetadata;
};

// Générer un avatar DiceBear par défaut
const generateDefaultAvatar = (seed: string) => {
  // Utilise DiceBear v9 (stateless URL). Collections possibles: adventurer, fun-emoji, botttsNeutral, identicon, pixel-art
  const safeSeed = encodeURIComponent(seed || "pensaas");
  const collection = "adventurer";
  // Arrière-plans doux + bord arrondi pour se fondre avec l'UI
  const params = "radius=50&backgroundColor=b6e3f4,c0aede,d1d4f9";
  return `https://api.dicebear.com/9.x/${collection}/svg?seed=${safeSeed}&${params}`;
};

/**
 * Interface minimale pour les données utilisateur nécessaires au formatage
 */
interface UserData {
  id: string;
  email: string;
  user_metadata?: unknown;
}

/**
 * Fonction utilitaire pour formatter les données utilisateur de manière sécurisée
 *
 * Formate un objet utilisateur en ne retournant que les propriétés sûres :
 * - id: identifiant utilisateur
 * - email: adresse email
 * - user_metadata: métadonnées filtrées (via getSafeUserMetadata)
 */
const formatSafeUserData = (user: UserData) => ({
  id: user.id,
  email: user.email,
  user_metadata: getSafeUserMetadata(user.user_metadata),
});

// Inscription
export const register = async (req: Request, res: Response) => {
  try {
    const validatedData = registerSchema.parse(req.body);

    // Avec Clerk, l'inscription se fait côté client
    // Cette route ne devrait plus être utilisée
    return res.status(400).json({
      error: "Inscription gérée par Clerk côté client",
      code: "USE_CLERK_SIGNUP",
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: "Données invalides",
        details: error.errors,
        code: "VALIDATION_ERROR",
      });
    }

    logger.error("Erreur inscription:", error);
    res.status(500).json({
      error: "Erreur interne du serveur",
      code: "INTERNAL_ERROR",
    });
  }
};

// Connexion
export const login = async (req: Request, res: Response) => {
  try {
    const validatedData = loginSchema.parse(req.body);

    // Avec Clerk, la connexion se fait côté client
    return res.status(400).json({
      error: "Connexion gérée par Clerk côté client",
      code: "USE_CLERK_SIGNIN",
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: "Données invalides",
        details: error.errors,
        code: "VALIDATION_ERROR",
      });
    }

    logger.error("Erreur connexion:", error);
    res.status(500).json({
      error: "Erreur interne du serveur",
      code: "INTERNAL_ERROR",
    });
  }
};

// Déconnexion
export const logout = async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(" ")[1];

    if (token) {
      // Avec Clerk, la déconnexion se fait principalement côté client
      logger.log("Token de déconnexion reçu:", token ? "Présent" : "Absent");
    }

    res.json({
      message: "Déconnexion réussie",
    });
  } catch (error) {
    logger.error("Erreur déconnexion:", error);
    res.status(500).json({
      error: "Erreur interne du serveur",
      code: "INTERNAL_ERROR",
    });
  }
};

// Profil utilisateur
export const getProfile = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: "Utilisateur non authentifié",
        code: "NOT_AUTHENTICATED",
      });
    }

    // 🚀 NOUVEAU : Récupérer les données depuis PostgreSQL pour avoir les vrais paramètres
    const pgUser = await UserSyncService.getUser(req.user.id);

    // Fusionner les données Supabase avec PostgreSQL
    const completeUserData = {
      ...formatSafeUserData(req.user),
      user_metadata: {
        ...req.user.user_metadata,
        autocompletionEnabled: pgUser?.autocompletionEnabled ?? true,
      },
    };

    res.json({
      user: completeUserData,
    });
  } catch (error) {
    logger.error("Erreur profil:", error);
    res.status(500).json({
      error: "Erreur interne du serveur",
      code: "INTERNAL_ERROR",
    });
  }
};

// Rafraîchir le token
export const refresh = async (req: Request, res: Response) => {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      return res.status(400).json({
        error: "Refresh token requis",
        code: "MISSING_REFRESH_TOKEN",
      });
    }

    // Avec Clerk, le refresh des tokens est géré côté client
    return res.status(400).json({
      error: "Refresh des tokens géré par Clerk côté client",
      code: "USE_CLERK_REFRESH",
    });
  } catch (error) {
    logger.error("Erreur refresh token:", error);
    res.status(500).json({
      error: "Erreur interne du serveur",
      code: "INTERNAL_ERROR",
    });
  }
};

// Schéma de validation pour la mise à jour du profil
const updateProfileSchema = z
  .object({
    firstName: z.string().optional().or(z.literal("")),
    lastName: z.string().optional().or(z.literal("")),
    displayName: z.string().optional().or(z.literal("")),
    timezone: z.string().optional().or(z.literal("")),
    language: z.string().optional().or(z.literal("")),
    theme: z.string().optional().or(z.literal("")),
    avatar: z.string().url().optional().or(z.literal("")),
    // 🚀 NOUVEAU : Paramètre d'autocomplétion
    autocompletionEnabled: z.boolean().optional(),
  })
  .transform((data) => {
    // Convertir les chaînes vides en undefined pour éviter d'envoyer des valeurs vides à Supabase
    const cleaned: Record<string, string | boolean> = {};
    Object.entries(data).forEach(([key, value]) => {
      if (key === "autocompletionEnabled") {
        // Pour les booléens, garder la valeur telle quelle
        if (value !== undefined) {
          cleaned[key] = value;
        }
      } else if (value && typeof value === "string" && value.trim() !== "") {
        cleaned[key] = value;
      }
    });
    return cleaned;
  });

// Schéma de validation pour la mise à jour du mot de passe
const updatePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Mot de passe actuel requis"),
  newPassword: z
    .string()
    .min(6, "Le nouveau mot de passe doit contenir au moins 6 caractères"),
});

// Schéma de validation pour la mise à jour de l'email
const updateEmailSchema = z.object({
  newEmail: z.string().email("Email invalide"),
  currentPassword: z.string().min(1, "Mot de passe actuel requis"),
});

// Mettre à jour le profil utilisateur
export const updateProfile = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: "Utilisateur non authentifié",
        code: "NOT_AUTHENTICATED",
      });
    }

    const validatedData = updateProfileSchema.parse(req.body);

    // Récupérer le token depuis les headers
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
      return res.status(401).json({
        error: "Token manquant",
        code: "MISSING_TOKEN",
      });
    }

    // Avec Clerk, la mise à jour du profil se fait côté client via les composants Clerk
    // Ici on peut juste mettre à jour PostgreSQL
    try {
      // Synchroniser avec PostgreSQL
      await UserSyncService.updateUserMetadata(req.user.id, validatedData);

      // Créer un objet utilisateur mis à jour
      const updatedUser = {
        ...req.user,
        user_metadata: {
          ...req.user.user_metadata,
          ...validatedData,
        },
      };

      res.json({
        message: "Profil mis à jour avec succès",
        user: formatSafeUserData(updatedUser),
      });
    } catch (syncError) {
      logger.error("Erreur sync PostgreSQL:", syncError);
      return res.status(500).json({
        error: "Erreur lors de la mise à jour des données",
        code: "SYNC_ERROR",
      });
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: "Données invalides",
        details: error.errors,
        code: "VALIDATION_ERROR",
      });
    }

    logger.error("Erreur mise à jour profil:", error);
    res.status(500).json({
      error: "Erreur interne du serveur",
      code: "INTERNAL_ERROR",
    });
  }
};

// Mettre à jour l'email
export const updateEmail = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: "Utilisateur non authentifié",
        code: "NOT_AUTHENTICATED",
      });
    }

    const { newEmail, currentPassword } = updateEmailSchema.parse(req.body);

    // Avec Clerk, la mise à jour de l'email se fait côté client
    return res.status(400).json({
      error: "Mise à jour email gérée par Clerk côté client",
      code: "USE_CLERK_UPDATE_EMAIL",
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: "Données invalides",
        details: error.errors,
        code: "VALIDATION_ERROR",
      });
    }
    logger.error("Erreur mise à jour email:", error);
    return res.status(500).json({
      error: "Erreur interne du serveur",
      code: "INTERNAL_ERROR",
    });
  }
};

// Mettre à jour le mot de passe
export const updatePassword = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: "Utilisateur non authentifié",
        code: "NOT_AUTHENTICATED",
      });
    }

    const validatedData = updatePasswordSchema.parse(req.body);

    // Avec Clerk, la mise à jour du mot de passe se fait côté client
    return res.status(400).json({
      error: "Mise à jour mot de passe gérée par Clerk côté client",
      code: "USE_CLERK_UPDATE_PASSWORD",
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: "Données invalides",
        details: error.errors,
        code: "VALIDATION_ERROR",
      });
    }

    logger.error("Erreur mise à jour mot de passe:", error);
    res.status(500).json({
      error: "Erreur interne du serveur",
      code: "INTERNAL_ERROR",
    });
  }
};

// Exports pour compatibilité (utilisent la méthode getProfile)
export const profile = getProfile;
