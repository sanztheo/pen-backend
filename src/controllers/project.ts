import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { logger } from "../utils/logger.js";
import { archiveProjectCascade } from "../services/trashService.js";
import { withSerializableRetry } from "../services/withSerializableRetry.js";

// Schémas de validation
const createProjectSchema = z.object({
  workspaceId: z.string().uuid("ID workspace invalide"),
  name: z.string().min(1, "Le nom est requis").max(255),
  description: z.string().optional(),
});

const updateProjectSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  settings: z.object({}).optional(),
});

// Créer un projet
export const createProject = async (req: Request, res: Response) => {
  const startTime = Date.now(); // 🕐 DÉBUT
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    }

    const validatedData = createProjectSchema.parse(req.body);
    const userId = req.user.id;
    logger.log(`⏱️  [PERF] Validation projet: ${Date.now() - startTime}ms`);

    const beforeValidations = Date.now();
    // 🚀 PHASE 1 OPTIMIZATION: Paralléliser validations (160-200ms → 100-120ms)
    const [userLimits, workspace] = await Promise.all([
      // 1. Vérifier les limitations utilisateur
      prisma.userLimits.findUnique({
        where: { userId },
      }),
      // 2. Vérifier l'accès au workspace
      prisma.workspace.findFirst({
        where: {
          id: validatedData.workspaceId,
          OR: [
            { ownerId: req.user.id },
            {
              members: {
                some: {
                  userId: req.user.id,
                  isActive: true,
                },
              },
            },
          ],
        },
      }),
    ]);
    logger.log(`⏱️  [PERF] Queries parallèles projet: ${Date.now() - beforeValidations}ms`);

    // Validations après parallélisation
    if (!userLimits) {
      return res.status(404).json({ error: "Limitations utilisateur non trouvées" });
    }

    const canCreateProject =
      userLimits.projectsLimit === -1 || userLimits.projectsUsed < userLimits.projectsLimit;
    if (!canCreateProject) {
      return res.status(403).json({
        error: "Limite de projets atteinte",
        message: `Vous avez atteint votre limite de ${userLimits.projectsLimit} projets. Passez à Premium pour créer des projets illimités.`,
        limits: {
          used: userLimits.projectsUsed,
          limit: userLimits.projectsLimit,
        },
      });
    }

    if (!workspace) {
      return res.status(404).json({ error: "Workspace non trouvé ou accès refusé" });
    }

    const beforeCreate = Date.now();
    // Transaction: project creation + counter increment (atomic to prevent desync)
    const project = await prisma.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: {
          name: validatedData.name,
          description: validatedData.description,
          workspaceId: validatedData.workspaceId,
          createdBy: req.user!.id,
          parentId: null,
        },
        include: {
          owner: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          workspace: {
            select: {
              id: true,
              name: true,
            },
          },
          _count: {
            select: {
              pages: true,
            },
          },
        },
      });

      await tx.userLimits.update({
        where: { userId },
        data: { projectsUsed: { increment: 1 } },
      });

      return created;
    });
    logger.log(`⏱️  [PERF] Création projet DB: ${Date.now() - beforeCreate}ms`);

    // Update workspace activity (non-blocking, not critical for consistency)
    prisma.workspace
      .update({
        where: { id: validatedData.workspaceId },
        data: { lastActivityAt: new Date() },
      })
      .catch((error) => {
        logger.error("⚠️ [ASYNC] Erreur update workspace activity:", error);
      });

    // ❌ LOGS D'ACTIVITÉ DÉSACTIVÉS pour économiser l'espace
    // await prisma.activityLog.create({
    //   data: {
    //     userId: req.user.id,
    //     workspaceId: validatedData.workspaceId,
    //     projectId: project.id,
    //     action: 'create',
    //     entityType: 'project',
    //     entityId: project.id,
    //     details: {
    //       projectName: project.name
    //     }
    //   }
    // });

    logger.log(`⏱️  [PERF] TOTAL createProject: ${Date.now() - startTime}ms`);
    res.status(201).json({
      message: "Projet créé avec succès",
      project,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: "Données invalides",
        details: error.errors,
      });
    }

    logger.error("Erreur création projet:", error);
    res.status(500).json({ error: "Erreur interne du serveur" });
  }
};

// Récupérer les projets d'un workspace
export const getWorkspaceProjects = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    }

    const { workspaceId } = req.params;
    // Pagination
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    // Vérifier l'accès au workspace
    const workspace = await prisma.workspace.findFirst({
      where: {
        id: workspaceId,
        OR: [
          { ownerId: req.user.id },
          {
            members: {
              some: {
                userId: req.user.id,
                isActive: true,
              },
            },
          },
        ],
      },
    });

    if (!workspace) {
      return res.status(404).json({ error: "Workspace non trouvé ou accès refusé" });
    }

    const projects = await prisma.project.findMany({
      where: {
        workspaceId,
        isArchived: false,
      },
      orderBy: {
        lastActivityAt: "desc",
      },
      skip,
      take: limit,
      select: {
        id: true,
        name: true,
        description: true,
        lastActivityAt: true,
        owner: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        _count: {
          select: {
            pages: true,
          },
        },
      },
    });

    res.json({ projects, pagination: { page, limit } });
  } catch (error) {
    logger.error("Erreur récupération projets:", error);
    res.status(500).json({ error: "Erreur interne du serveur" });
  }
};

// Récupérer un projet spécifique
export const getProject = async (req: Request, res: Response) => {
  try {
    logger.log("🚀 [PROJECT-CTRL] Tentative de récupération de projet...");
    if (!req.user) {
      logger.error("❌ [PROJECT-CTRL] Échec: Utilisateur non authentifié.");
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    }

    const { id } = req.params;
    logger.log(
      `🔍 [PROJECT-CTRL] Recherche du projet avec ID: ${id} pour l'utilisateur: ${req.user.id}`,
    );

    // Vérifier l'accès via le workspace
    const project = await prisma.project.findFirst({
      where: {
        id,
        isArchived: false,
        workspace: {
          OR: [
            { ownerId: req.user.id },
            { members: { some: { userId: req.user.id, isActive: true } } },
          ],
        },
      },
      include: {
        owner: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        workspace: { select: { id: true, name: true, ownerId: true } },
        pages: {
          where: { isArchived: false },
          orderBy: { position: "asc" },
        },
      },
    });

    if (!project) {
      logger.warn(`⚠️ [PROJECT-CTRL] Projet non trouvé ou accès refusé pour ID: ${id}`);
      return res.status(404).json({ error: "Projet non trouvé ou accès refusé" });
    }

    logger.log(`✅ [PROJECT-CTRL] Projet trouvé: "${project.name}"`);
    res.json({ project });
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.error("❌ [PROJECT-CTRL] Erreur de validation Zod:", error.errors);
      return res.status(400).json({
        error: "Données invalides",
        details: error.errors,
      });
    }
    logger.error("❌ [PROJECT-CTRL] Erreur interne lors de la récupération du projet:", error);
    res.status(500).json({ error: "Erreur interne du serveur" });
  }
};

// Mettre à jour un projet
export const updateProject = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    }

    const { id } = req.params;
    const validatedData = updateProjectSchema.parse(req.body);

    // Vérifier les permissions
    const project = await prisma.project.findFirst({
      where: {
        id,
        workspace: {
          OR: [
            { ownerId: req.user.id },
            {
              members: {
                some: {
                  userId: req.user.id,
                  role: { in: ["owner", "admin", "member"] },
                  isActive: true,
                },
              },
            },
          ],
        },
      },
    });

    if (!project) {
      return res.status(404).json({ error: "Projet non trouvé ou permissions insuffisantes" });
    }

    const updatedProject = await prisma.project.update({
      where: { id },
      data: {
        ...validatedData,
        lastActivityAt: new Date(),
      },
      include: {
        owner: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        workspace: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    // Mettre à jour l'activité du workspace
    await prisma.workspace.update({
      where: { id: project.workspaceId },
      data: { lastActivityAt: new Date() },
    });

    // ❌ LOGS D'ACTIVITÉ DÉSACTIVÉS pour économiser l'espace
    // await prisma.activityLog.create({
    //   data: {
    //     userId: req.user.id,
    //     workspaceId: project.workspaceId,
    //     projectId: id,
    //     action: 'update',
    //     entityType: 'project',
    //     entityId: id,
    //     details: {
    //       changes: validatedData
    //     }
    //   }
    // });

    res.json({
      message: "Projet mis à jour avec succès",
      project: updatedProject,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: "Données invalides",
        details: error.errors,
      });
    }

    logger.error("Erreur mise à jour projet:", error);
    res.status(500).json({ error: "Erreur interne du serveur" });
  }
};

// Supprimer un projet
/**
 * Soft-delete a project: archives it and its whole subtree (pages + nested
 * projects) into the trash. Restorable via POST /projects/:id/restore.
 *
 * userLimits counters are NOT decremented here — the project still consumes
 * quota while in the trash. Decrement happens when the trash is emptied or
 * the project is bulk-deleted (hard delete in trashService).
 */
export const deleteProject = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    }

    const { id } = req.params;

    const project = await prisma.project.findFirst({
      where: {
        id,
        OR: [{ createdBy: req.user.id }, { workspace: { ownerId: req.user.id } }],
      },
      select: { id: true, workspaceId: true, isArchived: true },
    });

    if (!project) {
      return res.status(404).json({ error: "Projet non trouvé ou permissions insuffisantes" });
    }
    if (project.isArchived) {
      return res.status(404).json({ error: "Projet déjà dans la corbeille" });
    }

    const result = await withSerializableRetry(() =>
      archiveProjectCascade({
        projectId: id,
        workspaceId: project.workspaceId,
        userId: req.user!.id,
      }),
    );

    res.json({
      success: true,
      message: "Projet archivé dans la corbeille",
      ...result,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg === "PROJECT_NOT_FOUND_OR_ALREADY_ARCHIVED") {
      return res.status(404).json({ error: "Projet non trouvé" });
    }
    if (msg === "TREE_TOO_LARGE") {
      return res.status(400).json({ error: "TREE_TOO_LARGE" });
    }
    logger.error("[PROJECT] deleteProject failed", {
      projectId: req.params.id,
      error: msg,
    });
    res.status(500).json({ error: "Erreur interne du serveur" });
  }
};

// Toggle pin/unpin d'un projet
export const toggleProjectPin = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    }

    const { id } = req.params;
    const userId = req.user.id;

    // Vérifier que le projet existe et appartient à l'utilisateur
    const project = await prisma.project.findFirst({
      where: {
        id,
        createdBy: userId,
      },
    });

    if (!project) {
      return res.status(404).json({ error: "Projet non trouvé" });
    }

    // Toggle le statut isPinned
    const updatedProject = await prisma.project.update({
      where: { id },
      data: {
        isPinned: !project.isPinned,
        updatedAt: new Date(),
      },
      include: {
        owner: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    res.json({
      message: updatedProject.isPinned ? "Projet épinglé" : "Projet désépinglé",
      project: updatedProject,
    });
  } catch (error) {
    logger.error("Erreur toggle pin projet:", error);
    res.status(500).json({ error: "Erreur interne du serveur" });
  }
};
