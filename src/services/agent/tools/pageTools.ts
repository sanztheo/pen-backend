// 📄 Page Tools - Création et gestion de pages via l'agent
import { tool } from "ai";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma.js";
import { nanoid } from "nanoid";
import { logger } from "../../../utils/logger.js";
import {
  toBlockNoteAuto,
  sanitizeAIGeneratedContent,
} from "../../../controllers/assistant/helpers/blocknote.js";

/**
 * Context utilisateur injecté via closure
 */
interface PageToolsContext {
  userId: string;
  workspaceId: string;
}

// Helper pour transformer chaînes vides en undefined
const emptyToUndefined = (val: unknown) => (val === "" || val === null ? undefined : val);

// Schéma Zod pour createPage
// Note: On utilise preprocess pour transformer les chaînes vides en undefined
const createPageSchema = z.object({
  title: z.string().min(1).max(255).describe("Titre de la page à créer"),
  content: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .optional()
      .describe("Contenu initial de la page en texte (sera converti en BlockNote)"),
  ),
  projectId: z.preprocess(
    emptyToUndefined,
    z.string().uuid().optional().describe("ID du projet dans lequel créer la page (optionnel)"),
  ),
  icon: z.preprocess(
    emptyToUndefined,
    z.string().max(10).optional().describe("Emoji ou icône pour la page (ex: '📝')"),
  ),
});

// Schéma pour vérifier l'existence d'une page
const checkPageExistsSchema = z.object({
  pageId: z.string().uuid().describe("ID de la page à vérifier"),
});

/**
 * Crée les tools de gestion de pages avec le contexte utilisateur
 */
export function createPageTools(ctx: PageToolsContext) {
  return {
    /**
     * Crée une nouvelle page dans le workspace
     */
    createPage: tool({
      description: `Crée une nouvelle page dans le workspace de l'utilisateur.
La page peut être créée à la racine du workspace ou dans un projet spécifique.
Retourne l'ID, le titre et l'URL de la page créée.
Utilise ce tool quand l'utilisateur demande de créer une page, un document, ou des notes.`,
      inputSchema: createPageSchema,
      execute: async ({ title, content, projectId, icon }) => {
        logger.log(`🔍 [TOOL:createPage] title="${title}", projectId=${projectId || "root"}`);

        try {
          // 1. Vérifier que le projet existe (si fourni)
          if (projectId) {
            const project = await prisma.project.findFirst({
              where: {
                id: projectId,
                workspaceId: ctx.workspaceId,
              },
            });
            if (!project) {
              return {
                success: false,
                error: "Projet non trouvé dans ce workspace",
                pageId: null,
              };
            }
          }

          // 3. Calculer la position
          const lastPage = await prisma.page.findFirst({
            where: {
              workspaceId: ctx.workspaceId,
              projectId: projectId || null,
              parentId: null,
            },
            orderBy: { position: "desc" },
            select: { position: true },
          });
          const position = (lastPage?.position ?? -1) + 1;

          // 4. Générer le slug unique
          const baseSlug = title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
            .slice(0, 50);
          const slug = `${baseSlug}-${Date.now()}-${nanoid(4)}`;

          // 5. Convertir le contenu texte en format BlockNote (avec support LaTeX $/$$ et markdown)
          const blockNoteContent = content
            ? (toBlockNoteAuto(
                sanitizeAIGeneratedContent(content),
              ) as unknown as Prisma.InputJsonValue)
            : null;

          // 6. Créer la page
          const page = await prisma.page.create({
            data: {
              title,
              slug,
              position,
              workspaceId: ctx.workspaceId,
              projectId: projectId || null,
              createdBy: ctx.userId,
              icon: icon || null,
              blockNoteContent: blockNoteContent ?? undefined,
            },
            select: {
              id: true,
              title: true,
              slug: true,
              icon: true,
              createdAt: true,
              projectId: true,
            },
          });

          logger.log(`✅ [TOOL:createPage] Page créée: "${page.title}" (ID: ${page.id})`);

          return {
            success: true,
            pageId: page.id,
            title: page.title,
            slug: page.slug,
            icon: page.icon,
            url: `/page/${page.id}`,
            projectId: page.projectId || null,
            projectName: null, // Simplifié - pas de join sur project
            createdAt: page.createdAt.toISOString(),
          };
        } catch (error) {
          logger.error(`❌ [TOOL:createPage] Erreur:`, error);
          return {
            success: false,
            error: "Erreur lors de la création de la page",
            pageId: null,
          };
        }
      },
    }),

    /**
     * Vérifie si une page existe encore
     */
    checkPageExists: tool({
      description: `Vérifie si une page existe toujours dans le workspace.
Utile pour vérifier qu'une page créée précédemment n'a pas été supprimée.`,
      inputSchema: checkPageExistsSchema,
      execute: async ({ pageId }) => {
        logger.log(`🔍 [TOOL:checkPageExists] pageId=${pageId}`);

        try {
          const page = await prisma.page.findFirst({
            where: {
              id: pageId,
              workspaceId: ctx.workspaceId,
              isArchived: false,
            },
            select: {
              id: true,
              title: true,
              slug: true,
              icon: true,
            },
          });

          if (!page) {
            return {
              exists: false,
              pageId,
              message: "Page non trouvée ou supprimée",
            };
          }

          return {
            exists: true,
            pageId: page.id,
            title: page.title,
            slug: page.slug,
            icon: page.icon,
            url: `/page/${page.id}`,
          };
        } catch (error) {
          logger.error(`❌ [TOOL:checkPageExists] Erreur:`, error);
          return {
            exists: false,
            pageId,
            error: "Erreur lors de la vérification",
          };
        }
      },
    }),
  };
}
