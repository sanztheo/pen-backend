import { Request, Response } from "express";
import { z } from "zod";
import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { redisCache } from "../services/cache/redisCache.js";
import { invalidateBlockNoteCache } from "../lib/redis.js";
import { logger } from "../utils/logger.js";

// Type pour les pages du projet avec arborescence
interface ProjectPageWithChildren {
  id: string;
  title: string;
  parentId: string | null;
  position: number;
  _count: { children: number };
  author: {
    id: string;
    firstName: string | null;
    lastName: string | null;
  } | null;
  children: ProjectPageWithChildren[];
  hasChildren: boolean;
  depth: number;
}

// Type pour les données de mise à jour de page
interface PageUpdateData {
  title?: string;
  position?: number;
  parentId?: string | null;
  projectId?: string | null;
  slug?: string;
}

// Schémas de validation
const createPageSchema = z
  .object({
    title: z.string().min(1, "Le titre est requis").max(255),
    parentId: z.string().uuid().optional(),
    position: z.number().int().min(0).optional(),
    projectId: z.string().uuid("ID projet invalide").optional(),
    workspaceId: z.string().uuid("ID workspace invalide").optional(),
    blockNoteContent: z.unknown().optional(), // Contenu pré-rempli (import PDF) - JSON structure
  })
  .refine((data) => data.projectId || data.workspaceId, {
    message: "Un projectId ou un workspaceId est requis",
    path: ["projectId", "workspaceId"],
  });

const updatePageSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  position: z.number().int().min(0).optional(),
  parentId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
});

// Créer une page
export const createPage = async (req: Request, res: Response) => {
  const startTime = Date.now(); // 🕐 DÉBUT
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    }

    const validatedData = createPageSchema.parse(req.body);
    const userId = req.user.id;
    logger.log(`⏱️  [PERF] Validation: ${Date.now() - startTime}ms`);

    // 🚀 PHASE 1 OPTIMIZATION: Déterminer workspaceId avant la parallélisation
    let workspaceIdForCheck: string | undefined;
    let finalWorkspaceId: string;

    if (validatedData.projectId) {
      // Si un projectId est fourni, on doit le récupérer pour obtenir le workspaceId
      const projectPromise = prisma.project.findUnique({
        where: { id: validatedData.projectId },
        select: { workspaceId: true },
      });
      const project = await projectPromise;
      if (!project) {
        return res.status(404).json({ error: "Projet non trouvé" });
      }
      finalWorkspaceId = project.workspaceId;
      workspaceIdForCheck = finalWorkspaceId;
    } else {
      finalWorkspaceId = validatedData.workspaceId!;
      workspaceIdForCheck = finalWorkspaceId;
    }

    const beforeValidations = Date.now();
    // 🚀 PHASE 1 OPTIMIZATION: Paralléliser TOUTES les validations (80-120ms → 120ms)
    const [userLimits, workspace, parentPage, lastPage] = await Promise.all([
      // 1. Vérifier les limitations utilisateur
      prisma.userLimits.findUnique({
        where: { userId },
      }),
      // 2. Vérifier l'accès au workspace
      prisma.workspace.findFirst({
        where: {
          id: workspaceIdForCheck,
          OR: [
            { ownerId: req.user.id },
            { members: { some: { userId: req.user.id, isActive: true } } },
          ],
        },
      }),
      // 3. Vérifier la page parent si spécifiée
      validatedData.parentId
        ? prisma.page.findFirst({
            where: {
              id: validatedData.parentId,
              workspaceId: finalWorkspaceId,
            },
          })
        : Promise.resolve(null),
      // 4. Calculer la position si non spécifiée
      validatedData.position === undefined
        ? prisma.page.findFirst({
            where: {
              workspaceId: finalWorkspaceId,
              projectId: validatedData.projectId || null,
              parentId: validatedData.parentId || null,
            },
            orderBy: { position: "desc" },
          })
        : Promise.resolve(null),
    ]);
    logger.log(`⏱️  [PERF] Queries parallèles: ${Date.now() - beforeValidations}ms`);

    // Validations après parallélisation
    if (!userLimits) {
      return res.status(404).json({ error: "Limitations utilisateur non trouvées" });
    }

    const canCreatePage =
      userLimits.pagesLimit === -1 || userLimits.pagesUsed < userLimits.pagesLimit;
    if (!canCreatePage) {
      return res.status(403).json({
        error: "Limite de pages atteinte",
        message: `Vous avez atteint votre limite de ${userLimits.pagesLimit} pages. Passez à Premium pour créer des pages illimitées.`,
        limits: {
          used: userLimits.pagesUsed,
          limit: userLimits.pagesLimit,
        },
      });
    }

    if (!workspace) {
      return res.status(404).json({ error: "Workspace non trouvé ou accès refusé" });
    }

    if (validatedData.parentId && !parentPage) {
      return res.status(404).json({ error: "Page parent non trouvée dans le même workspace" });
    }

    // Calculer la position finale
    const position = validatedData.position ?? (lastPage ? lastPage.position + 1 : 0);

    // 🚀 PHASE 1 OPTIMIZATION: Simplifier génération de slug (sortir de la transaction)
    const baseSlug = validatedData.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const timestamp = Date.now().toString(36); // Base36 pour compacité
    const randomSuffix = Math.random().toString(36).substring(2, 6); // 4 chars aléatoires
    const slug = `${baseSlug}-${timestamp}${randomSuffix}`;

    const beforeCreate = Date.now();
    // Transaction: page creation + counter increment (atomic to prevent desync)
    const page = await prisma.$transaction(async (tx) => {
      const created = await tx.page.create({
        data: {
          title: validatedData.title,
          slug,
          position,
          projectId: validatedData.projectId,
          workspaceId: finalWorkspaceId,
          parentId: validatedData.parentId,
          createdBy: req.user!.id,
          blockNoteContent: validatedData.blockNoteContent as Prisma.InputJsonValue | undefined,
        },
        include: {
          author: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          project: { select: { id: true, name: true, workspaceId: true } },
          children: {
            where: { isArchived: false },
            orderBy: { position: "asc" },
          },
          _count: { select: { children: true } },
        },
      });

      await tx.userLimits.update({
        where: { userId },
        data: { pagesUsed: { increment: 1 } },
      });

      return created;
    });
    logger.log(`⏱️  [PERF] Création page DB: ${Date.now() - beforeCreate}ms`);

    // Activity updates (non-critical, fire-and-forget is OK)
    Promise.all([
      prisma.workspace.update({
        where: { id: finalWorkspaceId },
        data: { lastActivityAt: new Date() },
      }),
      validatedData.projectId
        ? prisma.project.update({
            where: { id: validatedData.projectId },
            data: { lastActivityAt: new Date() },
          })
        : Promise.resolve(null),
    ]).catch((error) => {
      logger.error("⚠️ [ASYNC] Erreur updates activité:", error);
    });

    // 🧠 RAG: Traiter la page pour l'embedding (mode asynchrone, pas bloquant)
    try {
      const { userPagesRAG } = await import("../services/rag/userPages.js");

      // Traitement asynchrone si la page a du contenu
      if (page.title && page.title.length > 10) {
        userPagesRAG
          .processUserPage({
            id: page.id,
            title: page.title,
            content: page.title, // On n'a que le titre pour l'instant
            userId: req.user!.id,
            workspaceId: finalWorkspaceId,
            updatedAt: page.updatedAt,
          })
          .catch((error) => {
            logger.error(`🧠 [RAG] Erreur traitement page "${page.title}":`, error);
          });
      }
    } catch (error) {
      logger.error("🧠 [RAG] Service non disponible:", error);
    }

    // 🗑️ REDIS CACHE INVALIDATION: Invalider sidebar + pages récentes AVANT la réponse
    const { invalidateSidebarCache } = await import("../lib/redis.js");
    await invalidateSidebarCache(req.user!.id);
    await redisCache.invalidatePattern(`recent-pages:${req.user!.id}:*`, {
      namespace: "pages",
    });

    logger.log(`⏱️  [PERF] TOTAL createPage: ${Date.now() - startTime}ms`);
    res.status(201).json({
      message: "Page créée avec succès",
      page,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: "Données invalides",
        details: error.errors,
      });
    }
    logger.error("Erreur création page:", error);
    res.status(500).json({ error: "Erreur interne du serveur" });
  }
};

// Récupérer une page avec ses blocs
export const getPage = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    }

    const { id } = req.params;

    // 🚫 BLOQUER les IDs temporaires (optimistic UI)
    if (id.startsWith("temp-")) {
      logger.log(`⏭️  [GET-PAGE] ID temporaire ignoré: "${id}"`);
      return res.status(404).json({ error: "Page temporaire, en cours de création" });
    }

    logger.log(`🔍 [GET-PAGE] ID reçu: "${id}" (type: ${typeof id}, length: ${id?.length})`);

    const page = await prisma.page.findFirst({
      where: {
        id,
        workspace: {
          OR: [
            { ownerId: req.user.id },
            { members: { some: { userId: req.user.id, isActive: true } } },
          ],
        },
      },
      include: {
        author: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        project: { select: { id: true, name: true, workspaceId: true } },
        parent: { select: { id: true, title: true } },
        workspace: { select: { id: true, name: true } }, // 🚀 AJOUTÉ
        children: {
          where: { isArchived: false },
          select: { id: true, title: true, position: true, createdAt: true },
          orderBy: { position: "asc" },
        },
      },
    });

    if (!page) {
      return res.status(404).json({ error: "Page non trouvée" });
    }

    res.json({ page });
  } catch (error) {
    logger.error("Erreur récupération page:", error);
    res.status(500).json({ error: "Erreur interne du serveur" });
  }
};

export const getWorkspaceRootPages = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    }

    const { workspaceId } = req.params;

    const workspace = await prisma.workspace.findFirst({
      where: {
        id: workspaceId,
        OR: [
          { ownerId: req.user.id },
          { members: { some: { userId: req.user.id, isActive: true } } },
        ],
      },
    });

    if (!workspace) {
      return res.status(404).json({ error: "Workspace non trouvé ou accès refusé" });
    }

    const pages = await prisma.page.findMany({
      where: {
        workspaceId,
        projectId: null,
        isArchived: false,
      },
      include: {
        author: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { children: true } },
      },
      orderBy: { position: "asc" },
    });

    res.json({ pages });
  } catch (error) {
    logger.error("Erreur récupération pages racine:", error);
    res.status(500).json({ error: "Erreur interne du serveur" });
  }
};

// Récupérer les pages récemment consultées par l'utilisateur
export const getRecentPages = async (req: Request, res: Response) => {
  const startTime = Date.now();
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    }

    // Pagination
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    // 🚀 REDIS CACHE: Clé unique par utilisateur et pagination
    const cacheKey = `recent-pages:${req.user.id}:page${page}:limit${limit}`;

    const RecentPagesSchema = z.array(
      z
        .object({
          id: z.string(),
          title: z.string(),
        })
        .passthrough(),
    );

    // 🚀 INSTANT RESPONSE: Utiliser getOrSet pour cache-aside pattern
    const recentPages = await redisCache.getOrSet(
      cacheKey,
      async () => {
        logger.log(`🔄 [Cache MISS] Fetching pages from DB for user ${req.user!.id}`);
        const pages = await prisma.page.findMany({
          where: {
            isArchived: false,
            workspace: {
              OR: [
                { ownerId: req.user!.id },
                { members: { some: { userId: req.user!.id, isActive: true } } },
              ],
            },
          },
          orderBy: {
            updatedAt: "desc",
          },
          skip,
          take: limit,
          select: {
            id: true,
            title: true,
            slug: true,
            updatedAt: true,
            icon: true,
            iconColor: true,
            projectId: true,
            workspaceId: true,
            author: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
            project: {
              select: {
                id: true,
                name: true,
              },
            },
            _count: {
              select: {
                children: true,
              },
            },
          },
        });
        return pages;
      },
      (value) => RecentPagesSchema.parse(value),
      { ttl: 120, namespace: "pages" }, // 2 minutes de cache
    );

    const duration = Date.now() - startTime;
    logger.log(`⚡ [getRecentPages] Réponse en ${duration}ms`);

    res.json({ pages: recentPages, pagination: { page, limit } });
  } catch (error) {
    logger.error("❌ [getRecentPages] Erreur:", error);
    res.status(500).json({ error: "Erreur interne du serveur" });
  }
};

// Récupérer l'arborescence des pages d'un projet
export const getProjectPages = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    }

    const { projectId } = req.params;
    // Pagination
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const skip = (page - 1) * limit;

    // Vérifier l'accès au projet
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        workspace: {
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
      },
    });

    if (!project) {
      return res.status(404).json({ error: "Projet non trouvé ou accès refusé" });
    }

    // Récupération paginée et optimisée
    const pages = await prisma.page.findMany({
      where: {
        projectId,
        isArchived: false,
      },
      orderBy: [{ parentId: "asc" }, { position: "asc" }],
      skip,
      take: limit,
      select: {
        id: true,
        title: true,
        parentId: true,
        position: true,
        _count: { select: { children: true } },
        author: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    // Construction d'arborescence avec types stricts
    const pageMap = new Map<string, ProjectPageWithChildren>();
    const rootPages: ProjectPageWithChildren[] = [];

    // Type pour les pages retournées par Prisma
    type ProjectPageFromDB = (typeof pages)[number];

    pages.forEach((pageItem: ProjectPageFromDB) => {
      pageMap.set(pageItem.id, {
        ...pageItem,
        children: [],
        hasChildren: pageItem._count.children > 0,
        depth: 0,
      });
    });

    const calculateDepth = (pageId: string, depth: number = 0): void => {
      const pageItem = pageMap.get(pageId);
      if (pageItem) {
        pageItem.depth = depth;
        pages
          .filter((p: ProjectPageFromDB) => p.parentId === pageId)
          .forEach((child: ProjectPageFromDB) => {
            const childPage = pageMap.get(child.id);
            if (childPage) {
              pageItem.children.push(childPage);
              calculateDepth(child.id, depth + 1);
            }
          });
      }
    };

    pages
      .filter((pageItem: ProjectPageFromDB) => !pageItem.parentId)
      .forEach((rootPage: ProjectPageFromDB) => {
        const rootPageWithChildren = pageMap.get(rootPage.id);
        if (rootPageWithChildren) {
          rootPages.push(rootPageWithChildren);
          calculateDepth(rootPage.id, 0);
        }
      });

    const stats = {
      totalPages: pages.length,
      rootPages: rootPages.length,
      maxDepth: Math.max(
        ...Array.from(pageMap.values()).map((p: ProjectPageWithChildren) => p.depth),
        0,
      ),
    };
    res.json({
      pages: rootPages,
      stats,
      pagination: { page, limit },
    });
  } catch (error) {
    logger.error("Erreur récupération pages projet:", error);
    res.status(500).json({ error: "Erreur interne du serveur" });
  }
};

// Mettre à jour une page
export const updatePage = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    }

    const { id } = req.params;
    const validatedData = updatePageSchema.parse(req.body);

    // Vérifier les permissions via le workspace
    const page = await prisma.page.findFirst({
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

    if (!page) {
      return res.status(404).json({ error: "Page non trouvée ou permissions insuffisantes" });
    }

    const updateData: PageUpdateData = { ...validatedData };

    // Gérer le déplacement de la page
    if (validatedData.projectId !== undefined) {
      if (validatedData.projectId === null) {
        // Déplacer à la racine du workspace
        updateData.projectId = null;
      } else {
        // Déplacer vers un autre projet
        const targetProject = await prisma.project.findFirst({
          where: { id: validatedData.projectId, workspaceId: page.workspaceId },
        });
        if (!targetProject) {
          return res.status(404).json({
            error: "Projet de destination non trouvé dans le même workspace",
          });
        }
        updateData.projectId = validatedData.projectId;
      }
    }

    // Gérer le déplacement hiérarchique
    if (validatedData.parentId !== undefined) {
      if (validatedData.parentId) {
        // ... (vérification cycle et page parente)
      }
    }

    // Mettre à jour le slug si le titre change
    if (validatedData.title && validatedData.title !== page.title) {
      const baseSlug = validatedData.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      let slug = baseSlug;
      let counter = 1;
      while (
        await prisma.page.findFirst({
          where: { workspaceId: page.workspaceId, slug, id: { not: id } },
        })
      ) {
        slug = `${baseSlug}-${counter}`;
        counter++;
      }
      updateData.slug = slug;
    }

    const updatedPage = await prisma.page.update({
      where: { id },
      data: updateData,
      include: {
        author: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        project: { select: { id: true, name: true, workspaceId: true } },
        children: {
          where: { isArchived: false },
          orderBy: { position: "asc" },
        },
      },
    });

    // Mettre à jour l'activité
    await prisma.workspace.update({
      where: { id: page.workspaceId },
      data: { lastActivityAt: new Date() },
    });
    if (page.projectId) {
      await prisma.project.update({
        where: { id: page.projectId },
        data: { lastActivityAt: new Date() },
      });
    }

    // 🧠 RAG: Re-traiter la page pour l'embedding si titre modifié (mode asynchrone)
    try {
      if (validatedData.title && validatedData.title !== page.title) {
        const { userPagesRAG } = await import("../services/rag/userPages.js");

        userPagesRAG
          .processUserPage({
            id: updatedPage.id,
            title: updatedPage.title,
            content: updatedPage.title, // On n'a que le titre pour l'instant
            userId: req.user!.id,
            workspaceId: updatedPage.workspaceId,
            updatedAt: updatedPage.updatedAt,
          })
          .catch((error) => {
            logger.error(`🧠 [RAG] Erreur re-traitement page "${updatedPage.title}":`, error);
          });
      }
    } catch (error) {
      logger.error("🧠 [RAG] Service non disponible:", error);
    }

    // 🗑️ REDIS CACHE INVALIDATION: Invalider le cache des pages récentes pour tous les membres du workspace
    try {
      // Récupérer tous les membres du workspace pour invalider leur cache
      const workspaceMembers = await prisma.workspace.findUnique({
        where: { id: page.workspaceId },
        select: {
          ownerId: true,
          members: {
            where: { isActive: true },
            select: { userId: true },
          },
        },
      });

      if (workspaceMembers) {
        const userIds = [
          workspaceMembers.ownerId,
          ...workspaceMembers.members.map((m) => m.userId),
        ];

        // Invalider le cache pour chaque utilisateur du workspace
        for (const userId of userIds) {
          await redisCache.invalidatePattern(`recent-pages:${userId}:*`, {
            namespace: "pages",
          });
        }

        logger.log(
          `🗑️ [Cache Invalidation] Pages récentes invalidées pour ${userIds.length} utilisateurs`,
        );
      }
    } catch (cacheError) {
      logger.warn("⚠️ [Cache Invalidation] Échec invalidation cache (non bloquant):", cacheError);
    }

    res.json({
      message: "Page mise à jour avec succès",
      page: updatedPage,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: "Données invalides",
        details: error.errors,
      });
    }
    logger.error("Erreur mise à jour page:", error);
    res.status(500).json({ error: "Erreur interne du serveur" });
  }
};

// 🚀 OPTIMISATION : Fonction helper pour récupérer récursivement toutes les pages descendantes
// Utilise une approche optimisée avec moins de requêtes à la base de données
const getAllDescendantPages = async (pageId: string): Promise<string[]> => {
  const allDescendants: string[] = [];
  const pageQueue = [pageId];

  while (pageQueue.length > 0) {
    // Traitement par batches pour réduire le nombre de requêtes
    const currentBatch = pageQueue.splice(0, 50); // Traiter max 50 pages à la fois

    const children = await prisma.page.findMany({
      where: {
        parentId: { in: currentBatch },
      },
      select: { id: true },
    });

    const childIds = children.map((child: { id: string }) => child.id);
    allDescendants.push(...childIds);
    pageQueue.push(...childIds);
  }

  return allDescendants;
};

// Supprimer une page
export const deletePage = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    }

    const { id } = req.params;

    // Vérifier les permissions
    const page = await prisma.page.findFirst({
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
      include: {
        workspace: {
          select: {
            id: true,
          },
        },
      },
    });

    if (!page) {
      return res.status(404).json({ error: "Page non trouvée ou permissions insuffisantes" });
    }

    // Compter le nombre de pages qui seront supprimées (page + descendants)
    const allDescendantIds = await getAllDescendantPages(id);
    const totalPagesToDelete = 1 + allDescendantIds.length; // 1 pour la page elle-même + ses descendants

    // Supprimer les pages et décrémenter le compteur d'usage
    await prisma.$transaction(
      async (
        tx: Omit<
          PrismaClient,
          "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
        >,
      ) => {
        // 🧠 RAG: supprimer la/les sources liées à la page (et descendants) AVANT la suppression
        try {
          const { userPagesRAG } = await import("../services/rag/userPages.js");
          const allIds = [id, ...allDescendantIds];
          await Promise.all(
            allIds.map((pid) => userPagesRAG.removeUserPage(pid, req.user!.id, page.workspace.id)),
          );
        } catch (e) {
          logger.warn("🧠 [RAG] Échec suppression sources liées à la page (continuation):", e);
        }

        // Supprimer la page (suppression en cascade des enfants grâce au schéma)
        await tx.page.delete({
          where: { id: id },
        });

        // Décrémenter le compteur d'usage des pages (protégé contre valeurs négatives)
        await tx.$executeRaw`
        UPDATE "user_limits"
        SET "pages_used" = GREATEST(0, "pages_used" - ${totalPagesToDelete})
        WHERE "user_id" = ${req.user!.id}
      `;
      },
    );

    // 🗑️ REDIS CACHE INVALIDATION: Invalider le cache BlockNote pour toutes les pages supprimées
    const allDeletedIds = [id, ...allDescendantIds];
    for (const pageId of allDeletedIds) {
      invalidateBlockNoteCache(pageId).catch((err) =>
        logger.warn(`⚠️ [REDIS] Erreur invalidation cache page ${pageId}:`, err),
      );
    }

    // Invalider aussi le cache des pages récentes
    redisCache
      .invalidatePattern(`recent-pages:${req.user!.id}:*`, {
        namespace: "pages",
      })
      .catch((err) => logger.warn("⚠️ [Cache] Échec invalidation pages récentes:", err));

    // 🗑️ REDIS CACHE INVALIDATION: Invalider le cache Sidebar
    const { invalidateSidebarCache } = await import("../lib/redis.js");
    invalidateSidebarCache(req.user!.id).catch((err) =>
      logger.warn("⚠️ [Cache] Échec invalidation cache sidebar:", err),
    );

    logger.log(`🗑️ [DELETE] ${allDeletedIds.length} page(s) supprimée(s) et cache invalidé`);

    res.json({
      message: `Page et ses descendants supprimés avec succès`,
      deletedPageId: id,
    });
  } catch (error) {
    logger.error("Erreur suppression page:", error);
    res.status(500).json({ error: "Erreur interne du serveur" });
  }
};

// Nettoyer définitivement les pages archivées (fonction de maintenance)
export const cleanupArchivedPages = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    }

    // Récupérer toutes les pages archivées accessibles par l'utilisateur
    const archivedPages = await prisma.page.findMany({
      where: {
        isArchived: true,
        workspace: {
          OR: [
            { ownerId: req.user.id },
            {
              members: {
                some: {
                  userId: req.user.id,
                  role: { in: ["owner", "admin"] }, // Seuls les admins peuvent nettoyer
                  isActive: true,
                },
              },
            },
          ],
        },
      },
      select: { id: true, title: true, projectId: true, workspaceId: true },
    });

    if (archivedPages.length === 0) {
      return res.json({
        message: "Aucune page archivée à nettoyer",
        deletedCount: 0,
      });
    }

    const pageIds = archivedPages.map((p: { id: string }) => p.id);

    // 🧠 RAG: Supprimer les sources RAG avant suppression des pages
    try {
      const { userPagesRAG } = await import("../services/rag/userPages.js");

      await Promise.all(
        archivedPages.map((page) =>
          userPagesRAG.removeUserPage(page.id, req.user!.id, page.workspaceId),
        ),
      );
    } catch (error) {
      logger.error("🧠 [RAG] Erreur suppression sources:", error);
    }

    // Supprimer toutes les pages archivées
    // Note: Le contenu est maintenant stocké dans blockNoteContent (JSON)
    const deletedPages = await prisma.page.deleteMany({
      where: {
        id: { in: pageIds },
      },
    });

    // ❌ LOGS D'ACTIVITÉ DÉSACTIVÉS pour économiser l'espace
    // await prisma.activityLog.create({
    //   data: {
    //     userId: req.user.id,
    //     workspaceId: archivedPages[0]?.projectId ?
    //       (await prisma.project.findUnique({
    //         where: { id: archivedPages[0].projectId },
    //         select: { workspaceId: true }
    //       }))?.workspaceId || '' : '',
    //     action: 'cleanup',
    //     entityType: 'page',
    //     entityId: 'bulk',
    //     details: {
    //       deletedPages: deletedPages.count,
    //       pageIds
    //     }
    //   }
    // });

    res.json({
      message: `Nettoyage terminé : ${deletedPages.count} pages archivées supprimées définitivement`,
      deletedPages: deletedPages.count,
    });
  } catch (error) {
    logger.error("Erreur nettoyage pages archivées:", error);
    res.status(500).json({ error: "Erreur interne du serveur" });
  }
};

// Toggle pin/unpin d'une page
export const togglePagePin = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    }

    const { id } = req.params;
    const userId = req.user.id;

    // Vérifier que la page existe et appartient à l'utilisateur
    const page = await prisma.page.findFirst({
      where: {
        id,
        createdBy: userId,
      },
    });

    if (!page) {
      return res.status(404).json({ error: "Page non trouvée" });
    }

    // Toggle le statut isPinned
    const updatedPage = await prisma.page.update({
      where: { id },
      data: {
        isPinned: !page.isPinned,
        updatedAt: new Date(),
      },
      include: {
        author: {
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
      message: updatedPage.isPinned ? "Page épinglée" : "Page désépinglée",
      page: updatedPage,
    });
  } catch (error) {
    logger.error("Erreur toggle pin page:", error);
    res.status(500).json({ error: "Erreur interne du serveur" });
  }
};
