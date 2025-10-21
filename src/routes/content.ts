/**
 * 📁 ROUTES CONTENU SIMPLIFIÉ
 * API simplifiée qui masque les workspaces aux utilisateurs
 */

import { Router } from 'express';
import { z } from 'zod';
import { authenticateToken } from '../middlewares/auth.js';
import { SimplifiedContentService } from '../services/simplifiedContent.js';
import { prisma } from '../lib/prisma.js';

const router = Router();

// Schémas de validation
const createProjectSchema = z.object({
  name: z.string().min(1, 'Le nom est requis').max(255),
  description: z.string().optional(),
  parentId: z.string().uuid().nullable().optional() // 🚀 Support des projets imbriqués
});

const createPageSchema = z.object({
  title: z.string().min(1, 'Le titre est requis').max(255),
  projectId: z.string().uuid().nullable().optional()
});

const updateProjectSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional()
});

const updatePageSchema = z.object({
  title: z.string().min(1).max(255).optional()
});

/**
 * GET /api/content
 * Récupère tout le contenu de l'utilisateur (projets + pages)
 * 🚀 OPTIMISÉ avec REDIS CACHE (5min TTL)
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user!.id;
    const { cacheSidebarContent, saveSidebarContent } = await import('../lib/redis.js');

    // 🚀 Essayer de récupérer depuis le cache Redis
    const cachedContent = await cacheSidebarContent(userId);
    if (cachedContent) {
      console.log('✅ [CONTENT-API] Retour depuis cache Redis');
      return res.json(cachedContent);
    }

    // ❌ Pas de cache : récupérer depuis la DB
    console.log('❌ [CONTENT-API] Cache MISS - récupération DB');
    const content = await SimplifiedContentService.getUserContent(userId);

    // 💾 Sauvegarder dans le cache pour les prochaines requêtes
    saveSidebarContent(userId, content).catch(err =>
      console.warn('⚠️ [CONTENT-API] Échec sauvegarde cache:', err)
    );

    res.json(content);
  } catch (error: any) {
    console.error('❌ [CONTENT-API] Erreur récupération contenu:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erreur interne du serveur'
    });
  }
});

/**
 * GET /api/content/workspace
 * Récupère l'ID du workspace par défaut de l'utilisateur
 */
router.get('/workspace', authenticateToken, async (req, res) => {
  try {
    const userId = req.user!.id;
    const { DefaultWorkspaceService } = await import('../services/defaultWorkspace.js');
    const workspaceId = await DefaultWorkspaceService.getDefaultWorkspaceId(userId);
    
    res.json({
      success: true,
      workspaceId
    });
  } catch (error: any) {
    console.error('❌ [CONTENT-API] Erreur récupération workspaceId:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erreur lors de la récupération du workspace'
    });
  }
});

/**
 * GET /api/content/projects
 * Récupère uniquement les projets
 */
router.get('/projects', authenticateToken, async (req, res) => {
  try {
    const userId = req.user!.id;
    const projects = await SimplifiedContentService.getUserProjects(userId);
    
    res.json({
      success: true,
      projects
    });
  } catch (error: any) {
    console.error('❌ [CONTENT-API] Erreur récupération projets:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erreur interne du serveur'
    });
  }
});

/**
 * GET /api/content/pages
 * Récupère uniquement les pages à la racine
 */
router.get('/pages', authenticateToken, async (req, res) => {
  try {
    const userId = req.user!.id;
    const pages = await SimplifiedContentService.getUserRootPages(userId);
    
    res.json({
      success: true,
      pages
    });
  } catch (error: any) {
    console.error('❌ [CONTENT-API] Erreur récupération pages:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erreur interne du serveur'
    });
  }
});

/**
 * POST /api/content/projects
 * Crée un nouveau projet
 */
router.post('/projects', authenticateToken, async (req, res) => {
  try {
    const userId = req.user!.id;
    const validatedData = createProjectSchema.parse(req.body);

    const project = await SimplifiedContentService.createProject(userId, validatedData);

    // 🗑️ Invalider le cache sidebar après création
    const { invalidateSidebarCache } = await import('../lib/redis.js');
    invalidateSidebarCache(userId).catch(err =>
      console.warn('⚠️ [CONTENT-API] Échec invalidation cache:', err)
    );

    res.status(201).json({
      success: true,
      message: 'Projet créé avec succès',
      project
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Données invalides',
        details: error.errors
      });
    }

    if (error.message.includes('Limite de projets atteinte')) {
      return res.status(403).json({
        success: false,
        error: error.message,
        code: 'PROJECTS_LIMIT_REACHED',
        limitType: 'project'
      });
    }

    console.error('❌ [CONTENT-API] Erreur création projet:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erreur interne du serveur'
    });
  }
});

/**
 * POST /api/content/pages
 * Crée une nouvelle page
 */
router.post('/pages', authenticateToken, async (req, res) => {
  try {
    const userId = req.user!.id;
    const validatedData = createPageSchema.parse(req.body);

    const page = await SimplifiedContentService.createPage(userId, validatedData);

    // 🗑️ Invalider le cache sidebar après création
    const { invalidateSidebarCache } = await import('../lib/redis.js');
    invalidateSidebarCache(userId).catch(err =>
      console.warn('⚠️ [CONTENT-API] Échec invalidation cache:', err)
    );

    res.status(201).json({
      success: true,
      message: 'Page créée avec succès',
      page
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Données invalides',
        details: error.errors
      });
    }

    console.error('❌ [CONTENT-API] Erreur création page:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erreur interne du serveur'
    });
  }
});

/**
 * PUT /api/content/projects/:id
 * Met à jour un projet
 */
router.put('/projects/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;
    const validatedData = updateProjectSchema.parse(req.body);

    // Réutiliser la logique existante du contrôleur projet
    const project = await prisma.project.update({
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
        }
      }
    });

    // 🗑️ Invalider le cache sidebar après modification
    const { invalidateSidebarCache } = await import('../lib/redis.js');
    invalidateSidebarCache(userId).catch(err =>
      console.warn('⚠️ [CONTENT-API] Échec invalidation cache:', err)
    );

    res.json({
      success: true,
      message: 'Projet mis à jour avec succès',
      project
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Données invalides',
        details: error.errors
      });
    }

    console.error('❌ [CONTENT-API] Erreur mise à jour projet:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erreur interne du serveur'
    });
  }
});

/**
 * DELETE /api/content/projects/:id
 * Supprime un projet
 */
router.delete('/projects/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;

    await SimplifiedContentService.deleteProject(userId, id);

    // 🗑️ Invalider le cache sidebar après suppression
    const { invalidateSidebarCache } = await import('../lib/redis.js');
    invalidateSidebarCache(userId).catch(err =>
      console.warn('⚠️ [CONTENT-API] Échec invalidation cache:', err)
    );

    res.json({
      success: true,
      message: 'Projet supprimé avec succès'
    });
  } catch (error: any) {
    console.error('❌ [CONTENT-API] Erreur suppression projet:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erreur interne du serveur'
    });
  }
});

/**
 * DELETE /api/content/pages/:id
 * Supprime une page
 */
router.delete('/pages/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;

    await SimplifiedContentService.deletePage(userId, id);

    // 🗑️ Invalider le cache sidebar après suppression
    const { invalidateSidebarCache } = await import('../lib/redis.js');
    invalidateSidebarCache(userId).catch(err =>
      console.warn('⚠️ [CONTENT-API] Échec invalidation cache:', err)
    );

    res.json({
      success: true,
      message: 'Page supprimée avec succès'
    });
  } catch (error: any) {
    console.error('❌ [CONTENT-API] Erreur suppression page:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erreur interne du serveur'
    });
  }
});

/**
 * PATCH /api/content/projects/:id/pin
 * Toggle pin/unpin d'un projet
 */
router.patch('/projects/:id/pin', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    // Vérifier que le projet appartient à l'utilisateur
    const project = await prisma.project.findFirst({
      where: {
        id,
        createdBy: userId
      }
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        error: 'Projet non trouvé'
      });
    }

    // Toggle le statut pin
    const updatedProject = await prisma.project.update({
      where: { id },
      data: {
        isPinned: !project.isPinned,
        updatedAt: new Date()
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
        _count: {
          select: {
            pages: true
          }
        }
      }
    });

    // 🗑️ Invalider le cache sidebar après modification
    const { invalidateSidebarCache } = await import('../lib/redis.js');
    invalidateSidebarCache(userId).catch(err =>
      console.warn('⚠️ [CONTENT-API] Échec invalidation cache:', err)
    );

    res.json({
      message: updatedProject.isPinned ? 'Projet épinglé' : 'Projet désépinglé',
      project: updatedProject
    });
  } catch (error: any) {
    console.error('❌ [CONTENT-API] Erreur toggle pin projet:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erreur interne du serveur'
    });
  }
});

/**
 * PATCH /api/content/pages/:id/pin
 * Toggle pin/unpin d'une page
 */
router.patch('/pages/:id/pin', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    // Vérifier que la page appartient à l'utilisateur
    const page = await prisma.page.findFirst({
      where: {
        id,
        createdBy: userId
      }
    });

    if (!page) {
      return res.status(404).json({
        success: false,
        error: 'Page non trouvée'
      });
    }

    // Toggle le statut pin
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

    // 🗑️ Invalider le cache sidebar après modification
    const { invalidateSidebarCache } = await import('../lib/redis.js');
    invalidateSidebarCache(userId).catch(err =>
      console.warn('⚠️ [CONTENT-API] Échec invalidation cache:', err)
    );

    res.json({
      message: updatedPage.isPinned ? 'Page épinglée' : 'Page désépinglée',
      page: updatedPage
    });
  } catch (error: any) {
    console.error('❌ [CONTENT-API] Erreur toggle pin page:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erreur interne du serveur'
    });
  }
});

export default router;