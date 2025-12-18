// 📄 Page Tools - Création et gestion de pages via l'agent
import { tool } from "ai";
import { z } from "zod";
import { prisma } from "../../../lib/prisma.js";
import { nanoid } from "nanoid";

/**
 * Context utilisateur injecté via closure
 */
interface PageToolsContext {
  userId: string;
  workspaceId: string;
}

// Helper pour transformer chaînes vides en undefined
const emptyToUndefined = (val: unknown) =>
  val === "" || val === null ? undefined : val;

// Schéma Zod pour createPage
// Note: On utilise preprocess pour transformer les chaînes vides en undefined
const createPageSchema = z.object({
  title: z.string().min(1).max(255).describe("Titre de la page à créer"),
  content: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .optional()
      .describe(
        "Contenu initial de la page en texte (sera converti en BlockNote)",
      ),
  ),
  projectId: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .uuid()
      .optional()
      .describe("ID du projet dans lequel créer la page (optionnel)"),
  ),
  icon: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .max(10)
      .optional()
      .describe("Emoji ou icône pour la page (ex: '📝')"),
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
        console.log(
          `🔍 [TOOL:createPage] title="${title}", projectId=${projectId || "root"}`,
        );

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

          // 5. Convertir le contenu texte en format BlockNote
          const blockNoteContent = content
            ? convertTextToBlockNote(content)
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
              blockNoteContent: blockNoteContent,
            },
            select: {
              id: true,
              title: true,
              slug: true,
              icon: true,
              createdAt: true,
              project: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          });

          console.log(
            `✅ [TOOL:createPage] Page créée: "${page.title}" (ID: ${page.id})`,
          );

          return {
            success: true,
            pageId: page.id,
            title: page.title,
            slug: page.slug,
            icon: page.icon,
            url: `/page/${page.id}`,
            projectId: page.project?.id || null,
            projectName: page.project?.name || null,
            createdAt: page.createdAt.toISOString(),
          };
        } catch (error) {
          console.error(`❌ [TOOL:createPage] Erreur:`, error);
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
        console.log(`🔍 [TOOL:checkPageExists] pageId=${pageId}`);

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
          console.error(`❌ [TOOL:checkPageExists] Erreur:`, error);
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

/**
 * Convertit du texte brut en format BlockNote
 */
function convertTextToBlockNote(text: string): any[] {
  const lines = text.split("\n");
  const blocks: any[] = [];

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    // Détecter les headings (# Titre)
    const headingMatch = trimmedLine.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        id: nanoid(10),
        type: "heading",
        props: {
          level: Math.min(headingMatch[1].length, 3) as 1 | 2 | 3,
          textColor: "default",
          backgroundColor: "default",
          textAlignment: "left",
        },
        content: [{ type: "text", text: headingMatch[2], styles: {} }],
        children: [],
      });
      continue;
    }

    // Détecter les listes à puces (- item ou * item)
    const bulletMatch = trimmedLine.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      blocks.push({
        id: nanoid(10),
        type: "bulletListItem",
        props: {
          textColor: "default",
          backgroundColor: "default",
          textAlignment: "left",
        },
        content: [{ type: "text", text: bulletMatch[1], styles: {} }],
        children: [],
      });
      continue;
    }

    // Détecter les listes numérotées (1. item)
    const numberedMatch = trimmedLine.match(/^\d+\.\s+(.+)$/);
    if (numberedMatch) {
      blocks.push({
        id: nanoid(10),
        type: "numberedListItem",
        props: {
          textColor: "default",
          backgroundColor: "default",
          textAlignment: "left",
        },
        content: [{ type: "text", text: numberedMatch[1], styles: {} }],
        children: [],
      });
      continue;
    }

    // Paragraphe par défaut
    blocks.push({
      id: nanoid(10),
      type: "paragraph",
      props: {
        textColor: "default",
        backgroundColor: "default",
        textAlignment: "left",
      },
      content: [{ type: "text", text: trimmedLine, styles: {} }],
      children: [],
    });
  }

  return blocks;
}
