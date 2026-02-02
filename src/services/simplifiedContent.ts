/**
 * 📁 SERVICE CONTENU SIMPLIFIÉ
 * API simplifiée qui masque les workspaces et expose directement projets/pages
 */

import { logger } from "../utils/logger.js";
import { prisma } from "../lib/prisma.js";
import { DefaultWorkspaceService } from "./defaultWorkspace.js";
import {
  cacheUserLimits,
  cacheWorkspace,
  cacheProject,
  cacheDefaultWorkspaceId,
  invalidateUserLimitsCache,
} from "../lib/redis.js";

export class SimplifiedContentService {
  /**
   * Récupère tous les projets de l'utilisateur (depuis un workspace donné)
   */
  private static async _getUserProjects(userId: string, workspaceId: string) {
    const projects = await prisma.project.findMany({
      where: {
        workspaceId: workspaceId,
        isArchived: false,
      },
      orderBy: { position: "asc" },
      include: {
        _count: { select: { pages: true } },
        owner: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        children: {
          // 🚀 Support des projets imbriqués
          orderBy: { position: "asc" },
        },
        pages: {
          where: { isArchived: false },
          orderBy: { position: "asc" },
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
            updatedAt: true,
          },
        },
      },
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
        isArchived: false,
      },
      orderBy: { position: "asc" },
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
        author: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });
    return pages;
  }

  public static async getUserProjects(userId: string) {
    try {
      const defaultWorkspaceId =
        await DefaultWorkspaceService.getDefaultWorkspaceId(userId);
      return this._getUserProjects(userId, defaultWorkspaceId);
    } catch (error) {
      logger.error(
        "❌ [SIMPLIFIED-CONTENT] Erreur récupération projets:",
        error,
      );
      // Si pas de workspace par défaut, retourner un tableau vide au lieu d'échouer
      return [];
    }
  }

  public static async getUserRootPages(userId: string) {
    try {
      const defaultWorkspaceId =
        await DefaultWorkspaceService.getDefaultWorkspaceId(userId);
      return this._getUserRootPages(userId, defaultWorkspaceId);
    } catch (error) {
      logger.error(
        "❌ [SIMPLIFIED-CONTENT] Erreur récupération pages racine:",
        error,
      );
      // Si pas de workspace par défaut, retourner un tableau vide au lieu d'échouer
      return [];
    }
  }

  /**
   * Récupère tout le contenu de l'utilisateur (projets + pages racine)
   */
  static async getUserContent(userId: string) {
    try {
      const defaultWorkspaceId =
        await DefaultWorkspaceService.getDefaultWorkspaceId(userId);
      const [projects, rootPages] = await Promise.all([
        this._getUserProjects(userId, defaultWorkspaceId),
        this._getUserRootPages(userId, defaultWorkspaceId),
      ]);

      return {
        success: true,
        projects,
        pages: rootPages,
      };
    } catch (error) {
      logger.error(
        "❌ [SIMPLIFIED-CONTENT] Erreur récupération contenu:",
        error,
      );
      // Si le workspace par défaut n'existe pas, on retourne un contenu vide
      return { success: true, projects: [], pages: [] };
    }
  }

  /**
   * Crée un projet (dans le workspace par défaut)
   */
  static async createProject(
    userId: string,
    data: { name: string; description?: string; parentId?: string | null },
  ) {
    try {
      const startTime = Date.now(); // 🕐 DÉBUT
      logger.log(`⏱️  [SIMPLIFIED-PERF] START createProject`);

      // 🚀 PHASE 2 OPTIMIZATION: Paralléliser avec REDIS CACHE
      const beforeValidations = Date.now();
      const [defaultWorkspaceId, userLimits, parentProject] = await Promise.all(
        [
          cacheDefaultWorkspaceId(userId), // Redis cache (1h TTL)
          cacheUserLimits(userId), // Redis cache (5min TTL)
          data.parentId
            ? cacheProject(data.parentId, userId) // Redis cache (10min TTL)
            : Promise.resolve(null),
        ],
      );
      logger.log(
        `⏱️  [SIMPLIFIED-PERF] Validations parallèles (REDIS): ${Date.now() - beforeValidations}ms`,
      );

      // Vérifications
      if (!defaultWorkspaceId)
        throw new Error("Workspace par défaut non trouvé");
      if (!userLimits) throw new Error("Limitations utilisateur non trouvées");

      logger.log("🔍 [SIMPLIFIED-CONTENT] Debug limitations projet:", {
        userId,
        projectsUsed: userLimits.projectsUsed,
        projectsLimit: userLimits.projectsLimit,
        calculation: `${userLimits.projectsUsed} < ${userLimits.projectsLimit}`,
        result: userLimits.projectsUsed < userLimits.projectsLimit,
        isPremium: userLimits.projectsLimit === -1,
      });

      const canCreateProject =
        userLimits.projectsLimit === -1 ||
        userLimits.projectsUsed < userLimits.projectsLimit;
      if (!canCreateProject) {
        logger.error(
          "🚫 [SIMPLIFIED-CONTENT] Création bloquée par limitation:",
          {
            projectsUsed: userLimits.projectsUsed,
            projectsLimit: userLimits.projectsLimit,
            canCreate: canCreateProject,
          },
        );
        throw new Error(
          `Limite de projets atteinte (${userLimits.projectsUsed}/${userLimits.projectsLimit})`,
        );
      }

      if (data.parentId && !parentProject) {
        throw new Error("Parent project not found or access denied");
      }
      if (parentProject && parentProject.workspaceId !== defaultWorkspaceId) {
        throw new Error(
          "Le projet parent n'appartient pas au workspace par défaut.",
        );
      }

      // 🚀 Création projet (sans transaction lourde)
      const beforeCreate = Date.now();
      const project = await prisma.project.create({
        data: {
          name: data.name,
          description: data.description,
          workspaceId: defaultWorkspaceId,
          createdBy: userId,
          parentId: data.parentId || null,
        },
        include: {
          owner: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          _count: { select: { pages: true } },
        },
      });
      logger.log(
        `⏱️  [SIMPLIFIED-PERF] Création projet DB: ${Date.now() - beforeCreate}ms`,
      );

      // 🚀 Updates asynchrones (non-bloquant) + invalidation cache
      void (async () => {
        try {
          await Promise.all([
            (async () => {
              await prisma.userLimits.update({
                where: { userId },
                data: { projectsUsed: { increment: 1 } },
              });
              invalidateUserLimitsCache(userId);
            })(),
            prisma.workspace.update({
              where: { id: defaultWorkspaceId },
              data: { lastActivityAt: new Date() },
            }),
          ]);
        } catch (err) {
          logger.error("⚠️ [ASYNC] Erreur updates projet:", err);
        }
      })();

      logger.log(
        `⏱️  [SIMPLIFIED-PERF] TOTAL createProject: ${Date.now() - startTime}ms`,
      );
      return project;
    } catch (error) {
      logger.error("❌ [SIMPLIFIED-CONTENT] Erreur création projet:", error);
      throw error;
    }
  }

  /**
   * Crée une page (dans le workspace par défaut, avec ou sans projet)
   */
  static async createPage(
    userId: string,
    data: {
      title: string;
      projectId?: string | null;
      blockNoteContent?: unknown;
    },
  ) {
    try {
      const startTime = Date.now(); // 🕐 DÉBUT
      logger.log(`⏱️  [SIMPLIFIED-PERF] START createPage`);

      // 🚀 PHASE 2 OPTIMIZATION: Paralléliser avec REDIS CACHE
      const beforeValidations = Date.now();
      const [defaultWorkspaceId, project] = await Promise.all([
        cacheDefaultWorkspaceId(userId), // Redis cache (1h TTL)
        data.projectId
          ? cacheProject(data.projectId, userId) // Redis cache (10min TTL)
          : Promise.resolve(null),
      ]);
      logger.log(
        `⏱️  [SIMPLIFIED-PERF] Validations parallèles (REDIS): ${Date.now() - beforeValidations}ms`,
      );

      // Vérifications sécurité
      if (!defaultWorkspaceId)
        throw new Error("Workspace par défaut non trouvé");
      if (data.projectId && !project) {
        throw new Error("Projet non trouvé ou accès non autorisé.");
      }
      if (project && project.workspaceId !== defaultWorkspaceId) {
        throw new Error("Le projet n'appartient pas au workspace par défaut.");
      }

      // 🚀 Création page (avec blockNoteContent si fourni - import PDF)
      const beforeCreate = Date.now();
      const page = await prisma.page.create({
        data: {
          title: data.title,
          workspaceId: defaultWorkspaceId,
          projectId: data.projectId || null,
          createdBy: userId,
          blockNoteContent: data.blockNoteContent ?? undefined, // Contenu pré-rempli (import PDF)
        },
        select: {
          id: true,
          title: true,
          projectId: true,
          workspaceId: true,
          slug: true,
          position: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      logger.log(
        `⏱️  [SIMPLIFIED-PERF] Création page DB: ${Date.now() - beforeCreate}ms`,
      );

      // 🚀 Update workspace asynchrone (non-bloquant)
      prisma.workspace
        .update({
          where: { id: defaultWorkspaceId },
          data: { lastActivityAt: new Date() },
        })
        .catch((err) =>
          logger.error("⚠️ [ASYNC] Erreur update workspace:", err),
        );

      logger.log(
        `⏱️  [SIMPLIFIED-PERF] TOTAL createPage: ${Date.now() - startTime}ms`,
      );
      return page;
    } catch (error) {
      logger.error("❌ [SIMPLIFIED-CONTENT] Erreur création page:", error);
      throw error;
    }
  }

  /**
   * Supprime un projet et décremente les compteurs
   */
  static async deleteProject(userId: string, projectId: string) {
    try {
      const defaultWorkspaceId =
        await DefaultWorkspaceService.getDefaultWorkspaceId(userId);

      const project = await prisma.project.findFirst({
        where: {
          id: projectId,
          workspaceId: defaultWorkspaceId,
          createdBy: userId,
        },
      });
      if (!project) throw new Error("Projet non trouvé");

      const pagesCount = await prisma.page.count({ where: { projectId } });

      await prisma.$transaction(async (tx) => {
        await tx.project.delete({ where: { id: projectId } });
        await tx.$executeRaw`
          UPDATE "user_limits"
          SET "projects_used" = GREATEST(0, "projects_used" - 1),
              "pages_used" = GREATEST(0, "pages_used" - ${pagesCount})
          WHERE "user_id" = ${userId}
        `;
      });

      return { success: true };
    } catch (error) {
      logger.error(
        "❌ [SIMPLIFIED-CONTENT] Erreur suppression projet:",
        error,
      );
      throw error;
    }
  }

  /**
   * Supprime une page
   */
  static async deletePage(userId: string, pageId: string) {
    try {
      const defaultWorkspaceId =
        await DefaultWorkspaceService.getDefaultWorkspaceId(userId);

      const page = await prisma.page.findFirst({
        where: {
          id: pageId,
          workspaceId: defaultWorkspaceId,
          createdBy: userId,
        },
      });
      if (!page) throw new Error("Page non trouvée");

      // 🧠 RAG: supprimer la/les sources liées à cette page avant deletion
      try {
        const { userPagesRAG } = await import("./rag/userPages.js");
        await userPagesRAG.removeUserPage(pageId, userId, page.workspaceId);
      } catch (e) {
        logger.warn(
          "🧠 [RAG] Échec suppression sources (simplifiedContent.deletePage), poursuite de la suppression de la page:",
          e,
        );
      }

      await prisma.page.delete({ where: { id: pageId } });
      return { success: true };
    } catch (error) {
      logger.error("❌ [SIMPLIFIED-CONTENT] Erreur suppression page:", error);
      throw error;
    }
  }
}
