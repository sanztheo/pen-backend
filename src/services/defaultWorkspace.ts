/**
 * 🏠 SERVICE WORKSPACE AUTOMATIQUE
 * Gère la création et récupération automatique du workspace par défaut pour chaque utilisateur
 */

import { prisma } from '../lib/prisma.js';
import { AuthUser } from './auth.js';

export class DefaultWorkspaceService {
  /**
   * Récupère ou crée le workspace par défaut de l'utilisateur
   */
  static async getOrCreateDefaultWorkspace(userId: string) {
    try {
      // 1. Upsert le workspace sans inclure les relations pour la performance
      const workspace = await prisma.workspace.upsert({
        where: {
          ownerId_name: {
            ownerId: userId,
            name: 'Mon Espace'
          }
        },
        update: {},
        create: {
          name: 'Mon Espace',
          description: 'Votre espace personnel de travail',
          color: '#3B82F6',
          ownerId: userId
        },
        select: { id: true } // On ne récupère que l'ID
      });

      // 2. Vérifier si le membre propriétaire existe
      const member = await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: workspace.id, userId: userId } }
      });

      // 3. Si le membre n'existe pas, c'est une nouvelle création
      if (!member) {
        console.log(`🏠 [DEFAULT-WS] Nouveau workspace détecté pour utilisateur ${userId}`);
        // Utiliser une transaction pour garantir l'intégrité
        try {
          await prisma.$transaction(async (tx) => {
            // Créer le membre propriétaire
            await tx.workspaceMember.create({
              data: {
                workspaceId: workspace.id,
                userId: userId,
                role: 'owner',
                joinedAt: new Date()
              }
            });

            // Incrémenter le compteur d'usage
            await tx.userLimits.upsert({
              where: { userId },
              update: {
                workspacesUsed: { increment: 1 }
              },
              create: {
                userId: userId,
                workspacesUsed: 1,
                projectsUsed: 0,
                pagesUsed: 0
              }
            });
          });
        } catch (e) {
          console.error('❌ [DEFAULT-WS] Erreur transactionnelle lors de la création du membre/limite:', e);
          // Si la transaction échoue, il faut une stratégie de rollback ou de compensation.
          // Pour l'instant, on log l'erreur. Le workspace existe mais sans membre.
          throw e; // Propage l'erreur pour que l'appelant sache que l'opération a échoué.
        }
      }

      // 4. Retourner le workspace complet avec toutes les données nécessaires
      return await prisma.workspace.findUnique({
        where: { id: workspace.id },
        include: {
          owner: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true
            }
          },
          members: {
            include: {
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true
                }
              }
            }
          },
          _count: {
            select: {
              projects: true,
              members: true
            }
          }
        }
      });

    } catch (error) {
      console.error('❌ [DEFAULT-WS] Erreur lors de la récupération/création du workspace par défaut:', error);
      throw error;
    }
  }

  /**
   * Récupère l'ID du workspace par défaut de l'utilisateur
   */
  static async getDefaultWorkspaceId(userId: string): Promise<string> {
    const workspace = await this.getOrCreateDefaultWorkspace(userId);
    if (!workspace) {
      throw new Error('Impossible de récupérer ou créer le workspace par défaut.');
    }
    return workspace.id;
  }

  /**
   * Vérifie si un workspace est le workspace par défaut d'un utilisateur
   */
  static async isDefaultWorkspace(workspaceId: string, userId: string): Promise<boolean> {
    const workspace = await prisma.workspace.findFirst({
      where: {
        id: workspaceId,
        ownerId: userId,
        name: 'Mon Espace'
      }
    });
    return !!workspace;
  }

  /**
   * Initialise le workspace par défaut pour les utilisateurs existants (migration)
   */
  static async initializeForExistingUsers() {
    console.log('🔄 [DEFAULT-WS] Initialisation des workspaces par défaut pour utilisateurs existants...');
    
    try {
      // Récupérer tous les utilisateurs sans workspace "Mon Espace"
      const usersWithoutDefault = await prisma.user.findMany({
        where: {
          NOT: {
            ownedWorkspaces: {
              some: {
                name: 'Mon Espace'
              }
            }
          }
        },
        select: {
          id: true,
          firstName: true,
          lastName: true
        }
      });

      console.log(`🔄 [DEFAULT-WS] ${usersWithoutDefault.length} utilisateurs à traiter`);

      for (const user of usersWithoutDefault) {
        try {
          await this.getOrCreateDefaultWorkspace(user.id);
          console.log(`✅ [DEFAULT-WS] Workspace créé pour ${user.firstName} ${user.lastName}`);
        } catch (error) {
          console.error(`❌ [DEFAULT-WS] Erreur pour utilisateur ${user.id}:`, error);
        }
      }

      console.log('✅ [DEFAULT-WS] Initialisation terminée');
    } catch (error) {
      console.error('❌ [DEFAULT-WS] Erreur lors de l\'initialisation:', error);
      throw error;
    }
  }
}
