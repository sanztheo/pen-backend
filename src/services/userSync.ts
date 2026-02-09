import { AuthUser } from "./auth.js";
import { prisma } from "../lib/prisma.js";
import { DefaultWorkspaceService } from "./defaultWorkspace.js";
import { PaddleBillingService } from "./billing/paddleBilling.js";
import { withRetry } from "../lib/retry.js";
import { logger } from "../utils/logger.js";

export class UserSyncService {
  // Synchroniser un utilisateur Clerk avec PostgreSQL
  static async syncUser(clerkUser: AuthUser) {
    return withRetry(
      async () => {
        try {
          // 1. D'abord, vérifier si un utilisateur avec cet email existe déjà
          const existingUserByEmail = await prisma.user.findUnique({
            where: { email: clerkUser.email },
          });

          let user;
          let isNewUser = false;

          if (existingUserByEmail) {
            // Si un utilisateur avec cet email existe déjà
            if (existingUserByEmail.id !== clerkUser.id) {
              // 🚨 CONFLIT DÉTECTÉ : Même email avec ID différent
              logger.error(`🚨 [USER-SYNC] CONFLIT CRITIQUE détecté:
              Email: ${clerkUser.email}
              ID existant DB: ${existingUserByEmail.id}
              ID Clerk entrant: ${clerkUser.id}
              Créé le: ${existingUserByEmail.createdAt}
              Dernière MAJ: ${existingUserByEmail.updatedAt}
            `);

              // 🛡️ SÉCURITÉ : On refuse la synchronisation pour éviter la perte de données.
              throw new Error(
                `CONFLIT_ID_EMAIL: Email ${clerkUser.email} existe déjà avec un ID différent. Intervention manuelle requise.`,
              );
            } else {
              // Même ID, simple mise à jour
              user = await prisma.user.update({
                where: { id: clerkUser.id },
                data: {
                  email: clerkUser.email,
                  firstName: clerkUser.user_metadata?.firstName || "",
                  lastName: clerkUser.user_metadata?.lastName || "",
                  avatarUrl: clerkUser.user_metadata?.avatar,
                  autocompletionEnabled:
                    clerkUser.user_metadata?.autocompletionEnabled ?? true,
                  updatedAt: new Date(),
                },
              });
            }
          } else {
            // Aucun utilisateur avec cet email, vérifier si c'est vraiment nouveau
            const existingById = await prisma.user.findUnique({
              where: { id: clerkUser.id },
            });

            if (!existingById) {
              isNewUser = true;
            }

            // Utiliser upsert classique
            user = await prisma.user.upsert({
              where: { id: clerkUser.id },
              update: {
                email: clerkUser.email,
                firstName: clerkUser.user_metadata?.firstName || "",
                lastName: clerkUser.user_metadata?.lastName || "",
                avatarUrl: clerkUser.user_metadata?.avatar,
                autocompletionEnabled:
                  clerkUser.user_metadata?.autocompletionEnabled ?? true,
                updatedAt: new Date(),
              },
              create: {
                id: clerkUser.id,
                email: clerkUser.email,
                firstName: clerkUser.user_metadata?.firstName || "",
                lastName: clerkUser.user_metadata?.lastName || "",
                avatarUrl: clerkUser.user_metadata?.avatar,
                autocompletionEnabled:
                  clerkUser.user_metadata?.autocompletionEnabled ?? true,
              },
            });
          }

          // 🏠 Créer automatiquement le workspace par défaut SEULEMENT lors de la création d'un nouvel utilisateur
          // 🎁 Beta users get premium automatically
          if (isNewUser) {
            try {
              await DefaultWorkspaceService.getOrCreateDefaultWorkspace(
                user.id,
              );
              logger.log(
                `🏠 [USER-SYNC] Workspace par défaut créé pour le nouvel utilisateur ${user.firstName} ${user.lastName}`,
              );
            } catch (error) {
              logger.error(
                "❌ [USER-SYNC] Erreur création workspace par défaut:",
                error,
              );
            }

            // Beta: activate premium for all new signups (atomic transaction)
            try {
              await prisma.$transaction(async (tx) => {
                await tx.userSubscription.upsert({
                  where: { userId: user.id },
                  update: { plan: "premium", status: "active" },
                  create: {
                    userId: user.id,
                    plan: "premium",
                    status: "active",
                  },
                });
                await PaddleBillingService.syncUserLimitsAfterPlanChange(
                  user.id,
                  "premium",
                );
              });
              logger.log(
                `[USER-SYNC] Premium beta activated for ${user.firstName} ${user.lastName}`,
              );
            } catch (error) {
              logger.error(
                "[USER-SYNC] Failed to activate beta premium (rolled back):",
                error,
              );
            }
          }

          return user;
        } catch (error: unknown) {
          logger.error(
            `❌ [USER-SYNC] Erreur lors de la synchronisation de l'utilisateur ${clerkUser.email}:`,
            error,
          );
          throw error;
        }
      },
      3,
      2000,
    ); // 3 tentatives avec 2s de délai (pour Neon cold start)
  }

  // Récupérer un utilisateur depuis PostgreSQL
  static async getUser(userId: string) {
    return withRetry(
      async () => {
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
            autocompletionEnabled: true, // 🚀 NOUVEAU : Inclure le paramètre d'autocomplétion
            createdAt: true,
            updatedAt: true,
            ownedWorkspaces: true,
            workspaceMembers: {
              include: {
                workspace: true,
              },
            },
            projects: true,
          },
        });

        return user;
      },
      2,
      500,
    );
  }

  // Supprimer un utilisateur de PostgreSQL
  static async deleteUser(userId: string) {
    return withRetry(
      async () => {
        await prisma.user.delete({
          where: { id: userId },
        });
        logger.log(`🗑️ [USER-SYNC] Utilisateur supprimé: ${userId}`);
        return true;
      },
      2,
      500,
    );
  }

  // Mettre à jour les métadonnées utilisateur
  static async updateUserMetadata(
    userId: string,
    metadata: {
      firstName?: string;
      lastName?: string;
      avatarUrl?: string;
      avatar?: string; // compat front: certains clients envoient 'avatar' (URL)
      displayName?: string;
      timezone?: string;
      language?: string;
      theme?: string;
      autocompletionEnabled?: boolean;
    },
  ) {
    return withRetry(
      async () => {
        // Mettre à jour les champs disponibles dans Prisma
        const updateData: {
          firstName?: string;
          lastName?: string;
          avatarUrl?: string;
          autocompletionEnabled?: boolean;
        } = {};

        if (metadata.firstName !== undefined)
          updateData.firstName = metadata.firstName;
        if (metadata.lastName !== undefined)
          updateData.lastName = metadata.lastName;
        if (metadata.avatarUrl !== undefined)
          updateData.avatarUrl = metadata.avatarUrl;
        // Support front qui enverrait 'avatar' (URL) côté updateProfile
        if (metadata.avatar !== undefined)
          updateData.avatarUrl = metadata.avatar;

        // 🚀 NOUVEAU : Gérer le paramètre d'autocomplétion
        if (metadata.autocompletionEnabled !== undefined)
          updateData.autocompletionEnabled = metadata.autocompletionEnabled;

        // Les autres métadonnées (displayName, timezone, language, theme) sont gérées uniquement dans Supabase
        // car elles ne sont pas encore dans le schéma Prisma

        return await prisma.user.update({
          where: { id: userId },
          data: updateData,
        });
      },
      2,
      500,
    );
  }
}
