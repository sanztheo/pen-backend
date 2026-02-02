import { Request, Response } from 'express';
import { prisma } from '../../../lib/prisma.js';
import { logger } from "../../../utils/logger.js";

/**
 * Contrôleur pour la gestion des pages et projets
 */
export class PagesProjectsController {

  /**
   * GET /api/quiz/pages-projects - Récupère les pages et projets disponibles
   */
  static async getPagesProjects(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Utilisateur non authentifié' });
        return;
      }

      // Récupérer tous les workspaces de l'utilisateur avec leurs pages et projets
      const workspaces = await prisma.workspace.findMany({
        where: {
          members: {
            some: {
              userId: userId
            }
          }
        },
        include: {
          pages: {
            where: {
              isArchived: false
            },
            select: {
              id: true,
              title: true,
              updatedAt: true,
              projectId: true,
              icon: true,
              iconColor: true,
              project: {
                select: {
                  id: true,
                  name: true
                }
              }
            }
          },
          projects: {
            where: {
              isArchived: false
            },
            include: {
              _count: {
                select: {
                  pages: {
                    where: {
                      isArchived: false
                    }
                  }
                }
              }
            }
          }
        }
      });

      // Formater les données pour le frontend
      const items = [];

      for (const workspace of workspaces) {
        // Ajouter les pages
        for (const page of workspace.pages) {
          // Estimer le nombre de mots basé sur le titre (approximation simple)
          const estimatedWordCount = Math.max(50, page.title.length * 10);

          items.push({
            id: page.id,
            title: page.title,
            type: 'page' as const,
            workspaceId: workspace.id,
            workspaceName: workspace.name,
            workspaceColor: workspace.color,
            lastModified: page.updatedAt.toISOString(),
            estimatedQuestions: Math.max(1, Math.floor(estimatedWordCount / 200)), // ~1 question par 200 mots
            project: page.project,
            icon: page.icon,
            iconColor: page.iconColor
          });
        }

        // Ajouter les projets
        for (const project of workspace.projects) {
          // Estimer les mots basés sur le nombre de pages (approximation)
          const estimatedWordsPerPage = 300;
          const totalWords = project._count.pages * estimatedWordsPerPage;

          items.push({
            id: project.id,
            title: project.name,
            type: 'project' as const,
            workspaceId: workspace.id,
            workspaceName: workspace.name,
            workspaceColor: workspace.color,
            excerpt: project.description || `Projet avec ${project._count.pages} page(s)`,
            lastModified: project.updatedAt.toISOString(),
            wordCount: totalWords,
            estimatedQuestions: Math.max(1, Math.floor(totalWords / 150)), // ~1 question par 150 mots pour les projets
            pageCount: project._count.pages
          });
        }
      }

      // Trier par dernière modification
      items.sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());

      res.status(200).json({
        success: true,
        items
      });

    } catch (error) {
      logger.error('Erreur récupération pages/projets:', error);
      res.status(500).json({
        error: 'Erreur lors de la récupération des pages et projets',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }
  }

  /**
   * POST /api/quiz/analyze-pages-projects - Analyse les pages/projets sélectionnés
   */
  static async analyzePagesProjects(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const { itemIds } = req.body;

      if (!userId) {
        res.status(401).json({ error: 'Utilisateur non authentifié' });
        return;
      }

      if (!itemIds || !Array.isArray(itemIds)) {
        res.status(400).json({ error: 'Liste des IDs requise' });
        return;
      }

      const analysisResults = [];

      for (const itemId of itemIds) {
        // Essayer de trouver l'élément comme une page d'abord
        let page = await prisma.page.findFirst({
          where: {
            id: itemId,
            isArchived: false,
            workspace: {
              members: {
                some: {
                  userId: userId
                }
              }
            }
          }
        });

        if (page) {
          // Estimer le nombre de mots basé sur le titre
          const estimatedWordCount = Math.max(50, page.title.length * 10);

          analysisResults.push({
            id: page.id,
            title: page.title,
            type: 'page',
            estimatedQuestions: Math.max(1, Math.floor(estimatedWordCount / 200)),
            lastActivity: page.updatedAt.toISOString()
          });
          continue;
        }

        // Sinon, essayer comme un projet
        let project = await prisma.project.findFirst({
          where: {
            id: itemId,
            isArchived: false,
            workspace: {
              members: {
                some: {
                  userId: userId
                }
              }
            }
          },
          include: {
            _count: {
              select: {
                pages: {
                  where: {
                    isArchived: false
                  }
                }
              }
            }
          }
        });

        if (project) {
          // Estimer les mots basés sur le nombre de pages
          const estimatedWordsPerPage = 300;
          const totalWords = project._count.pages * estimatedWordsPerPage;

          analysisResults.push({
            id: project.id,
            title: project.name,
            type: 'project',
            pageCount: project._count.pages,
            estimatedQuestions: Math.max(1, Math.floor(totalWords / 150)),
            lastActivity: project.updatedAt.toISOString()
          });
        }
      }

      res.status(200).json({
        success: true,
        items: analysisResults
      });

    } catch (error) {
      logger.error('Erreur analyse pages/projets:', error);
      res.status(500).json({
        error: 'Erreur lors de l\'analyse des pages et projets',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }
  }
}
