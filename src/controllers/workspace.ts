import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
// Types will be inferred from Prisma client

// Schémas de validation
const createWorkspaceSchema = z.object({
  name: z.string().min(1, 'Le nom est requis').max(255),
  description: z.string().optional(),
  color: z.string().regex(/^#[0-9A-F]{6}$/i, 'Couleur invalide').optional()
});

const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  color: z.string().regex(/^#[0-9A-F]{6}$/i).optional()
});

// Créer un workspace
export const createWorkspace = async (req: Request, res: Response) => {
  try {
    const validatedData = createWorkspaceSchema.parse(req.body);
    const userId = req.user!.id;

    // Vérifier les limitations de l'utilisateur
    const userLimits = await prisma.userLimits.findUnique({
      where: { userId }
    });

    if (!userLimits) {
      return res.status(404).json({ error: 'Limitations utilisateur non trouvées' });
    }

    // Vérifier si l'utilisateur peut créer un nouveau workspace
    const canCreateWorkspace = userLimits.workspacesLimit === -1 || userLimits.workspacesUsed < userLimits.workspacesLimit;
    
    if (!canCreateWorkspace) {
      return res.status(403).json({ 
        error: 'Limite de workspaces atteinte',
        message: `Vous avez atteint votre limite de ${userLimits.workspacesLimit} workspaces. Passez à Premium pour créer des workspaces illimités.`,
        limits: {
          used: userLimits.workspacesUsed,
          limit: userLimits.workspacesLimit
        }
      });
    }

    // Utiliser une transaction pour garantir la cohérence
    const workspace = await prisma.$transaction(async (tx: any) => {
      // Créer le workspace
      const newWorkspace = await tx.workspace.create({
        data: {
          name: validatedData.name,
          description: validatedData.description,
          color: validatedData.color || '#3B82F6',
          ownerId: req.user!.id
        }
      });

      // Créer automatiquement le membre propriétaire
      await tx.workspaceMember.create({
        data: {
          workspaceId: newWorkspace.id,
          userId: req.user!.id,
          role: 'owner',
          joinedAt: new Date()
        }
      });

      // Incrémenter le compteur d'usage des workspaces
      await tx.userLimits.update({
        where: { userId },
        data: {
          workspacesUsed: {
            increment: 1
          }
        }
      });

      // Retourner le workspace avec tous les includes nécessaires
      return await tx.workspace.findUnique({
        where: { id: newWorkspace.id },
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
    });

    // ❌ LOGS D'ACTIVITÉ DÉSACTIVÉS pour économiser l'espace
    // await prisma.activityLog.create({
    //   data: {
    //     userId: req.user.id,
    //     workspaceId: workspace.id,
    //     action: 'create',
    //     entityType: 'workspace',
    //     entityId: workspace.id,
    //     details: {
    //       workspaceName: workspace.name
    //     }
    //   }
    // });

    res.status(201).json({
      message: 'Workspace créé avec succès',
      workspace
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Données invalides',
        details: error.errors
      });
    }

    console.error('Erreur création workspace:', error);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
};

// Récupérer tous les workspaces de l'utilisateur avec pagination
export const getUserWorkspaces = async (req: Request, res: Response) => {
  try {
    // Paramètres de pagination avec valeurs par défaut
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    // Condition de base pour les workspaces accessibles
    const whereCondition = {
      OR: [
        { ownerId: req.user!.id },
        {
          members: {
            some: {
              userId: req.user!.id,
              isActive: true
            }
          }
        }
      ],
      isArchived: false
    };

    // Récupérer les workspaces avec pagination et select optimisé
    const [workspaces, totalCount] = await prisma.$transaction([
      prisma.workspace.findMany({
        where: whereCondition,
        select: {
          id: true,
          name: true,
          description: true,
          color: true,
          lastActivityAt: true,
          owner: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true
            }
          },
          _count: {
            select: {
              projects: true,
              members: true
            }
          }
        },
        orderBy: {
          lastActivityAt: 'desc'
        },
        skip,
        take: limit
      }),
      prisma.workspace.count({
        where: whereCondition
      })
    ]);

    // Calcul des métadonnées de pagination
    const totalPages = Math.ceil(totalCount / limit);
    const hasNextPage = page < totalPages;
    const hasPreviousPage = page > 1;

    res.json({
      workspaces,
      pagination: {
        currentPage: page,
        totalPages,
        totalCount,
        limit,
        hasNextPage,
        hasPreviousPage
      }
    });

  } catch (error) {
    console.error('Erreur récupération workspaces:', error);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
};

export const getWorkspaces = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    const workspaces = await prisma.workspace.findMany({
      where: { members: { some: { userId } } },
      orderBy: { lastActivityAt: 'desc' },
      include: {
        _count: { select: { projects: true, members: true } },
        owner: { select: { id: true, firstName: true, lastName: true, email: true } },
        members: {
          select: {
            user: { select: { id: true, firstName: true, lastName: true, email: true } },
          },
          take: 5,
        },
        projects: {
          orderBy: { position: 'asc' },
          include: {
            _count: { select: { pages: true } },
            owner: { select: { id: true, firstName: true, lastName: true, email: true } },
            pages: {
              orderBy: { position: 'asc' },
              select: { 
                id: true, 
                title: true, 
                projectId: true, 
                slug: true, 
                position: true,
                icon: true,
                iconColor: true
              }
            },
          },
        },
        pages: {
          where: { projectId: null },
          orderBy: { position: 'asc' },
          select: {
            id: true,
            title: true,
            projectId: true,
            slug: true,
            position: true,
            workspaceId: true,
            icon: true,
            iconColor: true,
            author: { select: { id: true, firstName: true, lastName: true, email: true } },
          },
        },
      },
    });

    res.status(200).json({ workspaces });
  } catch (error) {
    console.error('Erreur chargement workspaces:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

export const getWorkspaceById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const workspace = await prisma.workspace.findFirst({
      where: {
        id,
        OR: [
          { ownerId: req.user!.id },
          {
            members: {
              some: {
                userId: req.user!.id,
                isActive: true
              }
            }
          }
        ]
      },
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
          where: { isActive: true },
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                avatarUrl: true
              }
            }
          }
        },
        projects: {
          where: { isArchived: false },
          include: {
            owner: {
              select: {
                id: true,
                firstName: true,
                lastName: true
              }
            },
            _count: {
              select: {
                pages: true
              }
            },
            pages: { // Inclure les pages dans chaque projet
              where: { isArchived: false },
              orderBy: { position: 'asc' }
            }
          },
          orderBy: {
            lastActivityAt: 'desc'
          }
        },
        pages: { // Inclure les pages à la racine du workspace
          where: { isArchived: false, projectId: null },
          orderBy: { position: 'asc' }
        },
        _count: {
          select: {
            projects: true,
            members: true
          }
        }
      }
    });

    if (!workspace) {
      return res.status(404).json({ error: 'Workspace non trouvé' });
    }

    res.json({ workspace });

  } catch (error) {
    console.error('Erreur récupération workspace:', error);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
};

// Mettre à jour un workspace
export const updateWorkspace = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const validatedData = updateWorkspaceSchema.parse(req.body);

    // Vérifier les permissions
    const workspace = await prisma.workspace.findFirst({
      where: {
        id,
        OR: [
          { ownerId: req.user!.id },
          {
            members: {
              some: {
                userId: req.user!.id,
                role: { in: ['owner', 'admin'] },
                isActive: true
              }
            }
          }
        ]
      }
    });

    if (!workspace) {
      return res.status(404).json({ error: 'Workspace non trouvé ou permissions insuffisantes' });
    }

    const updatedWorkspace = await prisma.workspace.update({
      where: { id },
      data: {
        ...validatedData,
        lastActivityAt: new Date()
      },
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
        }
      }
    });

    // ❌ LOGS D'ACTIVITÉ DÉSACTIVÉS pour économiser l'espace
    // await prisma.activityLog.create({
    //   data: {
    //     userId: req.user.id,
    //     workspaceId: id,
    //     action: 'update',
    //     entityType: 'workspace',
    //     entityId: id,
    //     details: {
    //       changes: validatedData
    //     }
    //   }
    // });

    res.json({
      message: 'Workspace mis à jour avec succès',
      workspace: updatedWorkspace
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Données invalides',
        details: error.errors
      });
    }

    console.error('Erreur mise à jour workspace:', error);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
};

// Supprimer un workspace
export const deleteWorkspace = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Vérifier que l'utilisateur est propriétaire
    const workspace = await prisma.workspace.findFirst({
      where: {
        id,
        ownerId: req.user!.id
      }
    });

    if (!workspace) {
      return res.status(404).json({ error: 'Workspace non trouvé ou vous n\'êtes pas propriétaire' });
    }

    // Compter les projets et pages avant suppression pour ajuster les compteurs
    const projectsCount = await prisma.project.count({
      where: { workspaceId: id }
    });

    const pagesCount = await prisma.page.count({
      where: { workspaceId: id }
    });

    // Supprimer le workspace et décrémenter les compteurs d'usage
    await prisma.$transaction(async (tx: any) => {
      // Supprimer le workspace. La suppression en cascade est gérée par Prisma.
      await tx.workspace.delete({
        where: { id },
      });

      // Décrémenter tous les compteurs d'usage concernés
      await tx.userLimits.update({
        where: { userId: req.user!.id },
        data: {
          workspacesUsed: {
            decrement: 1
          },
          projectsUsed: {
            decrement: projectsCount
          },
          pagesUsed: {
            decrement: pagesCount
          }
        }
      });
    });

    // ❌ LOGS D'ACTIVITÉ DÉSACTIVÉS pour économiser l'espace
    // await prisma.activityLog.create({
    //   data: {
    //     userId: req.user.id,
    //     workspaceId: id,
    //     action: 'delete',
    //     entityType: 'workspace',
    //     entityId: id,
    //     details: {
    //       workspaceName: workspace.name
    //     }
    //   }
    // });

    res.json({ message: 'Workspace supprimé avec succès' });

  } catch (error) {
    console.error('Erreur suppression workspace:', error);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
}; 