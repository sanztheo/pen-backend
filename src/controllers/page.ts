import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

// Schémas de validation
const createPageSchema = z.object({
  title: z.string().min(1, 'Le titre est requis').max(255),
  parentId: z.string().uuid().optional(),
  position: z.number().int().min(0).optional(),
  projectId: z.string().uuid('ID projet invalide').optional(),
  workspaceId: z.string().uuid('ID workspace invalide').optional()
}).refine(data => data.projectId || data.workspaceId, {
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
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Utilisateur non authentifié' });
    }

    const validatedData = createPageSchema.parse(req.body);
    const userId = req.user.id;

    // Vérifier les limitations de l'utilisateur
    const userLimits = await prisma.userLimits.findUnique({
      where: { userId }
    });

    if (!userLimits) {
      return res.status(404).json({ error: 'Limitations utilisateur non trouvées' });
    }

    // Vérifier si l'utilisateur peut créer une nouvelle page
    const canCreatePage = userLimits.pagesLimit === -1 || userLimits.pagesUsed < userLimits.pagesLimit;
    
    if (!canCreatePage) {
      return res.status(403).json({ 
        error: 'Limite de pages atteinte',
        message: `Vous avez atteint votre limite de ${userLimits.pagesLimit} pages. Passez à Premium pour créer des pages illimitées.`,
        limits: {
          used: userLimits.pagesUsed,
          limit: userLimits.pagesLimit
        }
      });
    }

    let workspaceIdForCheck: string | undefined;
    let finalWorkspaceId: string;

    if (validatedData.projectId) {
      const project = await prisma.project.findUnique({
        where: { id: validatedData.projectId },
        select: { workspaceId: true }
      });
      if (!project) {
        return res.status(404).json({ error: 'Projet non trouvé' });
      }
      finalWorkspaceId = project.workspaceId;
      workspaceIdForCheck = finalWorkspaceId;
    } else {
      finalWorkspaceId = validatedData.workspaceId!;
      workspaceIdForCheck = finalWorkspaceId;
    }

    // Vérifier l'accès au workspace
    const workspace = await prisma.workspace.findFirst({
      where: {
        id: workspaceIdForCheck,
        OR: [
          { ownerId: req.user.id },
          { members: { some: { userId: req.user.id, isActive: true } } }
        ]
      }
    });

    if (!workspace) {
      return res.status(404).json({ error: 'Workspace non trouvé ou accès refusé' });
    }

    // Vérifier la page parent si spécifiée
    if (validatedData.parentId) {
      const parentPage = await prisma.page.findFirst({
        where: {
          id: validatedData.parentId,
          workspaceId: finalWorkspaceId // La page parente doit être dans le même workspace
        }
      });
      if (!parentPage) {
        return res.status(404).json({ error: 'Page parent non trouvée dans le même workspace' });
      }
    }
    
    // Calculer la position
    let position = validatedData.position;
    if (position === undefined) {
      const lastPage = await prisma.page.findFirst({
        where: {
          workspaceId: finalWorkspaceId,
          projectId: validatedData.projectId || null,
          parentId: validatedData.parentId || null
        },
        orderBy: { position: 'desc' }
      });
      position = lastPage ? lastPage.position + 1 : 0;
    }

    // Utiliser une transaction pour la création et l'incrémentation
    // 🛡️ Déplacer la génération de slug À L'INTÉRIEUR de la transaction pour éviter les race conditions
    const page = await prisma.$transaction(async (tx: any) => {
      // Générer un slug unique à l'intérieur de la transaction
      const baseSlug = validatedData.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const existingSlugs = await tx.page.findMany({
        where: {
          workspaceId: finalWorkspaceId,
          slug: { startsWith: baseSlug }
        },
        select: { slug: true }
      });
      const slugSet = new Set(existingSlugs.map((p: { slug: string | null }) => p.slug || ''));
      let slug = baseSlug;
      let counter = 1;
      while (slugSet.has(slug)) {
        slug = `${baseSlug}-${counter}`;
        counter++;
      }

      // Créer la page avec le slug généré de façon atomique
      const newPage = await tx.page.create({
        data: {
          title: validatedData.title,
          slug,
          position,
          projectId: validatedData.projectId,
          workspaceId: finalWorkspaceId,
          parentId: validatedData.parentId,
          createdBy: req.user!.id
        },
        include: {
          author: { select: { id: true, firstName: true, lastName: true, email: true } },
          project: { select: { id: true, name: true, workspaceId: true } },
          children: { where: { isArchived: false }, orderBy: { position: 'asc' } },
          _count: { select: { children: true } }
        }
      });

      // Incrémenter le compteur d'usage des pages
      await tx.userLimits.update({
        where: { userId },
        data: {
          pagesUsed: {
            increment: 1
          }
        }
      });

      return newPage;
    });

    // Mettre à jour l'activité
    await prisma.workspace.update({
      where: { id: finalWorkspaceId },
      data: { lastActivityAt: new Date() }
    });
    if (validatedData.projectId) {
      await prisma.project.update({
        where: { id: validatedData.projectId },
        data: { lastActivityAt: new Date() }
      });
    }

    // 🧠 RAG: Traiter la page pour l'embedding (mode asynchrone, pas bloquant)
    try {
      const { userPagesRAG } = await import('../services/rag/userPages.js');
      
      // Traitement asynchrone si la page a du contenu
      if (page.title && page.title.length > 10) {
        userPagesRAG.processUserPage({
          id: page.id,
          title: page.title,
          content: page.title, // On n'a que le titre pour l'instant
          userId: req.user!.id,
          workspaceId: finalWorkspaceId,
          updatedAt: page.updatedAt
        }).catch(error => {
          console.error(`🧠 [RAG] Erreur traitement page "${page.title}":`, error);
        });
      }
    } catch (error) {
      console.error('🧠 [RAG] Service non disponible:', error);
    }

    res.status(201).json({
      message: 'Page créée avec succès',
      page
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Données invalides',
        details: error.errors
      });
    }
    console.error('Erreur création page:', error);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
};

// Récupérer une page avec ses blocs
export const getPage = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Utilisateur non authentifié' });
    }

    const { id } = req.params;

    const page = await prisma.page.findFirst({
      where: {
        id,
        workspace: {
          OR: [
            { ownerId: req.user.id },
            { members: { some: { userId: req.user.id, isActive: true } } }
          ]
        }
      },
      include: {
        author: { select: { id: true, firstName: true, lastName: true, email: true } },
        project: { select: { id: true, name: true, workspaceId: true } },
        parent: { select: { id: true, title: true } },
        workspace: { select: { id: true, name: true } }, // 🚀 AJOUTÉ
        children: {
          where: { isArchived: false },
          select: { id: true, title: true, position: true, createdAt: true },
          orderBy: { position: 'asc' }
        }
      }
    });

    if (!page) {
      return res.status(404).json({ error: 'Page non trouvée' });
    }

    res.json({ page });

  } catch (error) {
    console.error('Erreur récupération page:', error);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
};

export const getWorkspaceRootPages = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Utilisateur non authentifié' });
    }

    const { workspaceId } = req.params;

    const workspace = await prisma.workspace.findFirst({
      where: {
        id: workspaceId,
        OR: [
          { ownerId: req.user.id },
          { members: { some: { userId: req.user.id, isActive: true } } }
        ]
      }
    });

    if (!workspace) {
      return res.status(404).json({ error: 'Workspace non trouvé ou accès refusé' });
    }

    const pages = await prisma.page.findMany({
      where: {
        workspaceId,
        projectId: null,
        isArchived: false,
      },
      include: {
        author: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { children: true } }
      },
      orderBy: { position: 'asc' },
    });

    res.json({ pages });
  } catch (error) {
    console.error('Erreur récupération pages racine:', error);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
};

// Récupérer les pages récemment consultées par l'utilisateur
export const getRecentPages = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Utilisateur non authentifié' });
    }

    // Pagination
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const recentPages = await prisma.page.findMany({
      where: {
        isArchived: false,
        workspace: {
          OR: [
            { ownerId: req.user.id },
            { members: { some: { userId: req.user.id, isActive: true } } },
          ],
        },
      },
      orderBy: {
        updatedAt: 'desc',
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
            email: true
          }
        },
        project: {
          select: {
            id: true,
            name: true
          }
        },
        _count: {
          select: {
            children: true
          }
        }
      }
    });

    res.json({ pages: recentPages, pagination: { page, limit } });
  } catch (error) {
    console.error('Erreur récupération pages récentes:', error);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
};

// Récupérer l'arborescence des pages d'un projet
export const getProjectPages = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Utilisateur non authentifié' });
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
                  isActive: true
                }
              }
            }
          ]
        }
      }
    });

    if (!project) {
      return res.status(404).json({ error: 'Projet non trouvé ou accès refusé' });
    }

    // Récupération paginée et optimisée
    const pages = await prisma.page.findMany({
      where: {
        projectId,
        isArchived: false
      },
      orderBy: [
        { parentId: 'asc' },
        { position: 'asc' }
      ],
      skip,
      take: limit,
      select: {
        id: true,
        title: true,
        parentId: true,
        position: true,
        _count: { select: { children: true } },
        author: { select: { id: true, firstName: true, lastName: true } }
      }
    });

    // Construction d'arborescence (inchangée)
    const pageMap = new Map<string, any>();
    const rootPages: any[] = [];
    pages.forEach((page: any) => {
      pageMap.set(page.id, {
        ...page,
        children: [],
        hasChildren: page._count.children > 0,
        depth: 0
      });
    });
    const calculateDepth = (pageId: string, depth: number = 0): void => {
      const page = pageMap.get(pageId);
      if (page) {
        page.depth = depth;
        pages
          .filter((p: any) => p.parentId === pageId)
          .forEach((child: any) => {
            const childPage = pageMap.get(child.id);
            if (childPage) {
              page.children.push(childPage);
              calculateDepth(child.id, depth + 1);
            }
          });
      }
    };
    pages
      .filter((page: any) => !page.parentId)
      .forEach((rootPage: any) => {
        const rootPageWithChildren = pageMap.get(rootPage.id);
        if (rootPageWithChildren) {
          rootPages.push(rootPageWithChildren);
          calculateDepth(rootPage.id, 0);
        }
      });
    const stats = {
      totalPages: pages.length,
      rootPages: rootPages.length,
      maxDepth: Math.max(...Array.from(pageMap.values()).map(p => p.depth), 0)
    };
    res.json({ 
      pages: rootPages,
      stats,
      pagination: { page, limit }
    });
  } catch (error) {
    console.error('Erreur récupération pages projet:', error);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
};

// Mettre à jour une page
export const updatePage = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Utilisateur non authentifié' });
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
                some: { userId: req.user.id, role: { in: ['owner', 'admin', 'member'] }, isActive: true }
              }
            }
          ]
        }
      }
    });

    if (!page) {
      return res.status(404).json({ error: 'Page non trouvée ou permissions insuffisantes' });
    }

    let updateData: any = { ...validatedData };
    
    // Gérer le déplacement de la page
    if (validatedData.projectId !== undefined) {
      if (validatedData.projectId === null) {
        // Déplacer à la racine du workspace
        updateData.projectId = null;
      } else {
        // Déplacer vers un autre projet
        const targetProject = await prisma.project.findFirst({
          where: { id: validatedData.projectId, workspaceId: page.workspaceId }
        });
        if (!targetProject) {
          return res.status(404).json({ error: 'Projet de destination non trouvé dans le même workspace' });
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
      const baseSlug = validatedData.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      let slug = baseSlug;
      let counter = 1;
      while (await prisma.page.findFirst({ where: { workspaceId: page.workspaceId, slug, id: { not: id } } })) {
        slug = `${baseSlug}-${counter}`;
        counter++;
      }
      updateData.slug = slug;
    }

    const updatedPage = await prisma.page.update({
      where: { id },
      data: updateData,
      include: {
        author: { select: { id: true, firstName: true, lastName: true, email: true } },
        project: { select: { id: true, name: true, workspaceId: true } },
        children: { where: { isArchived: false }, orderBy: { position: 'asc' } }
      }
    });

    // Mettre à jour l'activité
    await prisma.workspace.update({
      where: { id: page.workspaceId },
      data: { lastActivityAt: new Date() }
    });
    if (page.projectId) {
      await prisma.project.update({
        where: { id: page.projectId },
        data: { lastActivityAt: new Date() }
      });
    }

    // 🧠 RAG: Re-traiter la page pour l'embedding si titre modifié (mode asynchrone)
    try {
      if (validatedData.title && validatedData.title !== page.title) {
        const { userPagesRAG } = await import('../services/rag/userPages.js');
        
        userPagesRAG.processUserPage({
          id: updatedPage.id,
          title: updatedPage.title,
          content: updatedPage.title, // On n'a que le titre pour l'instant
          userId: req.user!.id,
          workspaceId: updatedPage.workspaceId,
          updatedAt: updatedPage.updatedAt
        }).catch(error => {
          console.error(`🧠 [RAG] Erreur re-traitement page "${updatedPage.title}":`, error);
        });
      }
    } catch (error) {
      console.error('🧠 [RAG] Service non disponible:', error);
    }

    res.json({
      message: 'Page mise à jour avec succès',
      page: updatedPage
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Données invalides',
        details: error.errors
      });
    }
    console.error('Erreur mise à jour page:', error);
    res.status(500).json({ error: 'Erreur interne du serveur' });
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
        parentId: { in: currentBatch }
      },
      select: { id: true }
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
      return res.status(401).json({ error: 'Utilisateur non authentifié' });
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
                some: { userId: req.user.id, role: { in: ['owner', 'admin', 'member'] }, isActive: true }
              }
            }
          ]
        }
      },
      include: {
        workspace: {
          select: {
            id: true
          }
        }
      }
    });

    if (!page) {
      return res.status(404).json({ error: 'Page non trouvée ou permissions insuffisantes' });
    }

    // Compter le nombre de pages qui seront supprimées (page + descendants)
    const allDescendantIds = await getAllDescendantPages(id);
    const totalPagesToDelete = 1 + allDescendantIds.length; // 1 pour la page elle-même + ses descendants

    // Supprimer les pages et décrémenter le compteur d'usage
    await prisma.$transaction(async (tx: any) => {
      // Supprimer la page (suppression en cascade des enfants grâce au schéma)
      await tx.page.delete({
        where: { id: id }
      });

      // Décrémenter le compteur d'usage des pages selon le nombre total supprimé
      await tx.userLimits.update({
        where: { userId: req.user!.id },
        data: {
          pagesUsed: {
            decrement: totalPagesToDelete
          }
        }
      });
    });

    res.json({ 
      message: `Page et ses descendants supprimés avec succès`,
      deletedPageId: id
    });

  } catch (error) {
    console.error('Erreur suppression page:', error);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
};

// Nettoyer définitivement les pages archivées (fonction de maintenance)
export const cleanupArchivedPages = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Utilisateur non authentifié' });
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
                  role: { in: ['owner', 'admin'] }, // Seuls les admins peuvent nettoyer
                  isActive: true
                }
              }
            }
          ]
        }
      },
      select: { id: true, title: true, projectId: true, workspaceId: true }
    });

    if (archivedPages.length === 0) {
      return res.json({ 
        message: 'Aucune page archivée à nettoyer',
        deletedCount: 0 
      });
    }

    const pageIds = archivedPages.map((p: { id: string }) => p.id);

    // 🧠 RAG: Supprimer les sources RAG avant suppression des pages
    try {
      const { userPagesRAG } = await import('../services/rag/userPages.js');
      
      for (const page of archivedPages) {
        await userPagesRAG.removeUserPage(page.id, req.user!.id, page.workspaceId);
      }
    } catch (error) {
      console.error('🧠 [RAG] Erreur suppression sources:', error);
    }

    // Supprimer toutes les pages archivées
    // Note: Le contenu est maintenant stocké dans blockNoteContent (JSON)
    const deletedPages = await prisma.page.deleteMany({
      where: {
        id: { in: pageIds }
      }
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
      deletedPages: deletedPages.count
    });

  } catch (error) {
    console.error('Erreur nettoyage pages archivées:', error);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
};

// Toggle pin/unpin d'une page
export const togglePagePin = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Utilisateur non authentifié' });
    }

    const { id } = req.params;
    const userId = req.user.id;

    // Vérifier que la page existe et appartient à l'utilisateur
    const page = await prisma.page.findFirst({
      where: { 
        id,
        createdBy: userId
      }
    });

    if (!page) {
      return res.status(404).json({ error: 'Page non trouvée' });
    }

    // Toggle le statut isPinned
    const updatedPage = await prisma.page.update({
      where: { id },
      data: { 
        isPinned: !page.isPinned,
        updatedAt: new Date()
      },
      include: {
        author: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      }
    });

    res.json({
      message: updatedPage.isPinned ? 'Page épinglée' : 'Page désépinglée',
      page: updatedPage
    });

  } catch (error) {
    console.error('Erreur toggle pin page:', error);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
}; 