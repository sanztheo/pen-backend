import { createClerkClient, verifyToken } from "@clerk/backend";
import dotenv from "dotenv";

dotenv.config();

// Types pour l'authentification
export interface AuthUser {
  id: string;
  email: string;
  user_metadata?: {
    firstName?: string;
    lastName?: string;
    avatar?: string;
    displayName?: string;
    timezone?: string;
    language?: string;
    theme?: string;
    autocompletionEnabled?: boolean;
  };
}

// Validation et initialisation du client Clerk
if (!process.env.CLERK_SECRET_KEY) {
  console.error(
    "❌ CRITIQUE: CLERK_SECRET_KEY manquante. Le service ne peut pas démarrer.",
  );
  process.exit(1);
}

const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
});

// Service d'authentification
export class AuthService {
  // Vérifier l'authentification Clerk (pour les routes API)
  static async verifyAuth(): Promise<AuthUser | null> {
    try {
      // Cette méthode est désormais utilisée principalement pour les tokens
      console.warn(
        "verifyAuth() sans token - utiliser verifyToken() à la place",
      );
      return null;
    } catch (error) {
      console.error("Erreur vérification auth:", error);
      return null;
    }
  }

  // Vérifier un token de session Clerk (pour WebSocket et API)
  static async verifyToken(token: string): Promise<AuthUser | null> {
    try {
      if (!token) {
        return null;
      }

      // Vérifier le token de session
      const sessionToken = await verifyToken(token, {
        secretKey: process.env.CLERK_SECRET_KEY,
      });

      // Double vérification de l'expiration pour renforcer la sécurité
      if (
        !sessionToken ||
        (sessionToken.exp && sessionToken.exp * 1000 < Date.now())
      ) {
        console.warn(
          "[AuthService] Tentative d'utilisation d'un token expiré.",
        );
        return null;
      }

      if (!sessionToken.sub) {
        return null;
      }

      // Récupérer les informations de l'utilisateur
      const user = await clerkClient.users.getUser(sessionToken.sub);

      return {
        id: user.id,
        email: user.emailAddresses?.[0]?.emailAddress || "",
        user_metadata: {
          firstName: user.firstName || "",
          lastName: user.lastName || "",
          avatar: user.imageUrl || "",
          displayName:
            user.fullName ||
            `${user.firstName || ""} ${user.lastName || ""}`.trim(),
          // Récupérer depuis publicMetadata/privateMetadata si définis
          timezone: user.publicMetadata?.timezone as string,
          language: (user.publicMetadata?.language as string) || "fr",
          theme: (user.publicMetadata?.theme as string) || "light",
          autocompletionEnabled:
            (user.publicMetadata?.autocompletionEnabled as boolean) ?? true,
        },
      };
    } catch (error) {
      // Clerk lèvera une erreur si le token est invalide ou expiré, c'est normal
      const isExpiredError =
        error instanceof Error && error.message.includes("expired");
      if (!isExpiredError) {
        console.error("Erreur vérification token Clerk:", error);
      }
      return null;
    }
  }

  // Note: Clerk gère la création d'utilisateurs via son interface web
  // Ces méthodes ne sont plus nécessaires avec Clerk
  static async createUser(email: string, password: string, metadata?: any) {
    throw new Error("Utilisez l'interface Clerk pour créer des utilisateurs");
  }

  static async deleteUser(userId: string) {
    throw new Error(
      "Utilisez l'interface Clerk pour supprimer des utilisateurs",
    );
  }

  static async updateUserPassword(userId: string, newPassword: string) {
    throw new Error(
      "Utilisez l'interface Clerk pour changer les mots de passe",
    );
  }

  static async updateUserEmail(userId: string, newEmail: string) {
    throw new Error("Utilisez l'interface Clerk pour changer les emails");
  }

  // Mettre à jour les métadonnées d'un utilisateur via Clerk
  static async updateUserMetadata(userId: string, metadata: any) {
    try {
      // Note: Cette méthode nécessiterait l'API Backend de Clerk
      // Pour l'instant, nous indiquons que cela doit être fait via l'interface
      throw new Error("Utilisez l'API Backend de Clerk pour les métadonnées");
    } catch (error) {
      console.error("Erreur mise à jour métadonnées:", error);
      throw error;
    }
  }

  // Note: Clerk gère la vérification des mots de passe automatiquement
  static async verifyCurrentPassword(
    email: string,
    password: string,
  ): Promise<boolean> {
    throw new Error(
      "Clerk gère la vérification des mots de passe automatiquement",
    );
  }
}
