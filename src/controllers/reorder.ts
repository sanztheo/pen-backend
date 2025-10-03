import { Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { z } from 'zod';

// Schema de validation pour les opérations de drag & drop
const ReorderItemSchema = z.object({
  id: z.string(),
  type: z.enum(['page', 'project']),
  position: z.number().int().min(0),
  parentId: z.string().nullable().optional(), // null pour root, string pour dans un projet (ou un autre projet pour les projets imbriqués)
});

const ReorderRequestSchema = z.object({
  items: z.array(ReorderItemSchema),
  workspaceId: z.string(),
});

export const reorderItems = async (req: Request, res: Response) => {
  try {
    const { items, workspaceId } = ReorderRequestSchema.parse(req.body);
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Non authentifié', code: 'UNAUTHENTICATED' });
    }

    console.log(`🔄 [REORDER] Début réorganisation : ${items.length} items dans workspace ${workspaceId} par user ${userId}`);

    // 1. Vérifier les permissions sur le workspace
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { ownerId: true, members: { select: { userId: true } } }
    });

    if (!workspace) {
      return res.status(404).json({ success: false, error: 'Workspace non trouvé', code: 'WORKSPACE_NOT_FOUND' });
    }

    const isOwner = workspace.ownerId === userId;
    const isMember = workspace.members.some(member => member.userId === userId);

    if (!isOwner && !isMember) {
      return res.status(403).json({ success: false, error: 'Accès non autorisé à ce workspace', code: 'FORBIDDEN' });
    }

    // 2. Validation des items en une seule fois pour éviter N+1
    const itemIds = items.map(i => i.id);
    const projectsInDb = await prisma.project.findMany({ where: { id: { in: itemIds }, workspaceId: workspaceId }, select: { id: true } });
    const pagesInDb = await prisma.page.findMany({ where: { id: { in: itemIds }, workspaceId: workspaceId }, select: { id: true } });
    const projectIdsInDb = new Set(projectsInDb.map(p => p.id));
    const pageIdsInDb = new Set(pagesInDb.map(p => p.id));

    for (const item of items) {
      if (item.type === 'project' && !projectIdsInDb.has(item.id)) {
        return res.status(400).json({ success: false, error: `Projet ${item.id} invalide`, code: 'INVALID_PROJECT_ID' });
      }
      if (item.type === 'page' && !pageIdsInDb.has(item.id)) {
        return res.status(400).json({ success: false, error: `Page ${item.id} invalide`, code: 'INVALID_PAGE_ID' });
      }
    }

    // 🛡️ SÉCURITÉ: Valider tous les parentId fournis
    const parentIds = items
      .filter(item => item.parentId !== null && item.parentId !== undefined)
      .map(item => item.parentId as string);

    if (parentIds.length > 0) {
      const validParents = await prisma.project.findMany({
        where: {
          id: { in: parentIds },
          workspaceId: workspaceId // Doit être dans le même workspace
        },
        select: { id: true }
      });

      const validParentIds = new Set(validParents.map(p => p.id));

      for (const item of items) {
        if (item.parentId && !validParentIds.has(item.parentId)) {
          console.error('🚫 [REORDER] Parent project invalide:', {
            itemId: item.id,
            parentId: item.parentId,
            workspaceId
          });
          return res.status(403).json({
            success: false,
            error: `Parent project ${item.parentId} not found or access denied`,
            code: 'INVALID_PARENT_ID'
          });
        }
      }
    }

    // 🛡️ SÉCURITÉ: Prévenir les cycles dans les projets imbriqués
    const projectItems = items.filter(item => item.type === 'project' && item.parentId);

    if (projectItems.length > 0) {
      // Récupérer tous les projets du workspace pour détecter les cycles
      const allProjects = await prisma.project.findMany({
        where: { workspaceId },
        select: { id: true, parentId: true }
      });

      // Fonction récursive pour vérifier si targetId est un descendant de projectId
      const isDescendant = (projectId: string, targetId: string): boolean => {
        const children = allProjects.filter(p => p.parentId === projectId);

        for (const child of children) {
          if (child.id === targetId) return true;
          if (isDescendant(child.id, targetId)) return true;
        }

        return false;
      };

      for (const item of projectItems) {
        // Vérification 1: Un projet ne peut pas être son propre parent
        if (item.parentId === item.id) {
          console.error('🚫 [REORDER] Cycle détecté: projet parent de lui-même:', {
            projectId: item.id
          });
          return res.status(400).json({
            success: false,
            error: 'Cannot set project as its own parent',
            code: 'CYCLE_DETECTED'
          });
        }

        // Vérification 2: Le nouveau parent ne doit pas être un descendant du projet
        if (isDescendant(item.id, item.parentId!)) {
          console.error('🚫 [REORDER] Cycle détecté: parent est un descendant:', {
            projectId: item.id,
            parentId: item.parentId
          });
          return res.status(400).json({
            success: false,
            error: 'Cannot create cycle: target parent is a descendant of the project',
            code: 'CYCLE_DETECTED'
          });
        }
      }
    }

    // 3. Transaction atomique
    const result = await prisma.$transaction(async (tx) => {
      const updates = [];
      for (const item of items) {
        if (item.type === 'page') {
          const update = await tx.page.update({
            where: { id: item.id },
            data: { position: item.position, projectId: item.parentId || null, workspaceId: workspaceId },
          });
          updates.push({ type: 'page', id: update.id });
        } else if (item.type === 'project') {
          // 🚀 Support des projets imbriqués : parentId peut maintenant être un autre projet
          const update = await tx.project.update({
            where: { id: item.id },
            data: { position: item.position, parentId: item.parentId || null, workspaceId: workspaceId },
          });
          updates.push({ type: 'project', id: update.id });
        }
      }
      return updates;
    });

    console.log(`✅ [REORDER] Réorganisation réussie : ${result.length} items mis à jour`);
    
    res.status(200).json({ 
      success: true, 
      updated: result.length,
      message: `${result.length} éléments réorganisés avec succès`
    });

  } catch (error) {
    console.error('❌ [REORDER] Erreur lors de la réorganisation:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: 'Données invalides', code: 'VALIDATION_ERROR', details: error.errors });
    }

    if (error && typeof (error as any).code === 'string' && (error as any).code.startsWith('P')) { // Erreur Prisma
      return res.status(409).json({ success: false, error: 'Conflit de données ou référence invalide', code: 'PRISMA_ERROR' });
    }

    res.status(500).json({ success: false, error: 'Erreur interne lors de la réorganisation', code: 'INTERNAL_ERROR' });
  }
}; 
