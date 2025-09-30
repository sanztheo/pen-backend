/**
 * 📁 SERVICE CONTENU SIMPLIFIÉ
 * API simplifiée qui masque les workspaces et expose directement projets/pages
 */

import { prisma } from '../lib/prisma.js';
import { DefaultWorkspaceService } from './defaultWorkspace.js';

export class SimplifiedContentService {
  /**
   * Récupère tous les projets de l'utilisateur (depuis un workspace donné)
   */
  private static async _getUserProjects(userId: string, workspaceId: string) {
    const projects = await prisma.project.findMany({
      where: {
        workspaceId: workspaceId,
        isArchived: false
      },
      orderBy: { position: 'asc' },
      include: {
        _count: { select: { pages: true } },
        owner: { select: { id: true, firstName: true, lastName: true, email: true } },
        pages: {
          where: { isArchived: false },
          orderBy: { position: 'asc' },
          select: { 
            id: true, 
            title: true, 
            projectId: true, 
            slug: true, 
            position: true,
            isPinned: true,
            icon: true,
            iconColor: true,
            createdAt: true,
            updatedAt: true
          }
        }
      }
    });
    return projects;
  }

  /**
   * Récupère toutes les pages à la racine (sans projet) de l'utilisateur
   */
  private static async _getUserRootPages(userId: string, workspaceId: string) {
    const pages = await prisma.page.findMany({
      where: {
        workspaceId: workspaceId,
        projectId: null, // Pages à la racine
        isArchived: false
      },
      orderBy: { position: 'asc' },
      select: {
        id: true,
        title: true,
        projectId: true,
        workspaceId: true,
        slug: true,
        position: true,
        isPinned: true,
        icon: true,
        iconColor: true,
        createdAt: true,
        updatedAt: true,
        author: { select: { id: true, firstName: true, lastName: true, email: true } }
      }
    });
    return pages;
  }

  public static async getUserProjects(userId: string) {
    try {
      const defaultWorkspaceId = await DefaultWorkspaceService.getDefaultWorkspaceId(userId);
      return this._getUserProjects(userId, defaultWorkspaceId);
    } catch (error) {
      console.error('❌ [SIMPLIFIED-CONTENT] Erreur récupération projets:', error);
      // Si pas de workspace par défaut, retourner un tableau vide au lieu d'échouer
      return [];
    }
  }

  public static async getUserRootPages(userId: string) {
    try {
      const defaultWorkspaceId = await DefaultWorkspaceService.getDefaultWorkspaceId(userId);
      return this._getUserRootPages(userId, defaultWorkspaceId);
    } catch (error) {
      console.error('❌ [SIMPLIFIED-CONTENT] Erreur récupération pages racine:', error);
      // Si pas de workspace par défaut, retourner un tableau vide au lieu d'échouer
      return [];
    }
  }

  /**
   * Récupère tout le contenu de l'utilisateur (projets + pages racine)
   */
  static async getUserContent(userId: string) {
    try {
      const defaultWorkspaceId = await DefaultWorkspaceService.getDefaultWorkspaceId(userId);
      const [projects, rootPages] = await Promise.all([
        this._getUserProjects(userId, defaultWorkspaceId),
        this._getUserRootPages(userId, defaultWorkspaceId)
      ]);

      return {
        success: true,
        projects,
        pages: rootPages
      };
    } catch (error) {
      console.error('❌ [SIMPLIFIED-CONTENT] Erreur récupération contenu:', error);
      // Si le workspace par défaut n'existe pas, on retourne un contenu vide
      return { success: true, projects: [], pages: [] };
    }
  }

  /**
   * Crée un projet (dans le workspace par défaut)
   */
  static async createProject(userId: string, data: { name: string; description?: string }) {
    try {
      const defaultWorkspaceId = await DefaultWorkspaceService.getDefaultWorkspaceId(userId);
      
      const userLimits = await prisma.userLimits.findUnique({ where: { userId } });
      if (!userLimits) throw new Error('Limitations utilisateur non trouvées');

      console.log('🔍 [SIMPLIFIED-CONTENT] Debug limitations projet:', {
        userId,
        projectsUsed: userLimits.projectsUsed,
        projectsLimit: userLimits.projectsLimit,
        calculation: `${userLimits.projectsUsed} < ${userLimits.projectsLimit}`,
        result: userLimits.projectsUsed < userLimits.projectsLimit,
        isPremium: userLimits.projectsLimit === -1
      });

      const canCreateProject = userLimits.projectsLimit === -1 || userLimits.projectsUsed < userLimits.projectsLimit;
      if (!canCreateProject) {
        console.error('🚫 [SIMPLIFIED-CONTENT] Création bloquée par limitation:', {
          projectsUsed: userLimits.projectsUsed,
          projectsLimit: userLimits.projectsLimit,
          canCreate: canCreateProject
        });
        throw new Error(`Limite de projets atteinte (${userLimits.projectsUsed}/${userLimits.projectsLimit})`);
      }

      const project = await prisma.$transaction(async (tx) => {
        const newProject = await tx.project.create({
          data: {
            name: data.name,
            description: data.description,
            workspaceId: defaultWorkspaceId,
            createdBy: userId
          },
          include: {
            owner: { select: { id: true, firstName: true, lastName: true, email: true } },
            _count: { select: { pages: true } }
          }
        });

        await tx.userLimits.update({ where: { userId }, data: { projectsUsed: { increment: 1 } } });
        return newProject;
      });

      await prisma.workspace.update({ where: { id: defaultWorkspaceId }, data: { lastActivityAt: new Date() } });
      return project;
    } catch (error) {
      console.error('❌ [SIMPLIFIED-CONTENT] Erreur création projet:', error);
      throw error;
    }
  }

  /**
   * Crée une page (dans le workspace par défaut, avec ou sans projet)
   */
  static async createPage(userId: string, data: { title: string; projectId?: string | null; }) {
    try {
      const defaultWorkspaceId = await DefaultWorkspaceService.getDefaultWorkspaceId(userId);
      
      if (data.projectId) {
        const project = await prisma.project.findFirst({
          where: {
            id: data.projectId,
            workspaceId: defaultWorkspaceId,
            createdBy: userId // SÉCURITÉ: Vérifier que l'utilisateur est bien le créateur
          }
        });

        if (!project) {
          throw new Error('Projet non trouvé ou accès non autorisé.');
        }
      }

      const page = await prisma.page.create({
        data: {
          title: data.title,
          workspaceId: defaultWorkspaceId,
          projectId: data.projectId || null,
          createdBy: userId
        },
        select: {
          id: true, title: true, projectId: true, workspaceId: true, slug: true, position: true, createdAt: true, updatedAt: true
        }
      });

      await prisma.workspace.update({ where: { id: defaultWorkspaceId }, data: { lastActivityAt: new Date() } });
      return page;
    } catch (error) {
      console.error('❌ [SIMPLIFIED-CONTENT] Erreur création page:', error);
      throw error;
    }
  }

  /**
   * Supprime un projet et décremente les compteurs
   */
  static async deleteProject(userId: string, projectId: string) {
    try {
      const defaultWorkspaceId = await DefaultWorkspaceService.getDefaultWorkspaceId(userId);
      
      const project = await prisma.project.findFirst({
        where: { id: projectId, workspaceId: defaultWorkspaceId, createdBy: userId }
      });
      if (!project) throw new Error('Projet non trouvé');

      const pagesCount = await prisma.page.count({ where: { projectId } });

      await prisma.$transaction(async (tx) => {
        await tx.project.delete({ where: { id: projectId } });
        await tx.userLimits.update({
          where: { userId },
          data: { projectsUsed: { decrement: 1 }, pagesUsed: { decrement: pagesCount } }
        });
      });

      return { success: true };
    } catch (error) {
      console.error('❌ [SIMPLIFIED-CONTENT] Erreur suppression projet:', error);
      throw error;
    }
  }

  /**
   * Supprime une page
   */
  static async deletePage(userId: string, pageId: string) {
    try {
      const defaultWorkspaceId = await DefaultWorkspaceService.getDefaultWorkspaceId(userId);
      
      const page = await prisma.page.findFirst({
        where: { id: pageId, workspaceId: defaultWorkspaceId, createdBy: userId }
      });
      if (!page) throw new Error('Page non trouvée');

      await prisma.page.delete({ where: { id: pageId } });
      return { success: true };
    } catch (error) {
      console.error('❌ [SIMPLIFIED-CONTENT] Erreur suppression page:', error);
      throw error;
    }
  }
}