// 📄 Workspace Tools - Vercel AI SDK Format
import { tool } from "ai";
import { z } from "zod";
import { prisma } from "../../../lib/prisma.js";

/**
 * Context utilisateur injecté via closure
 */
interface WorkspaceToolsContext {
  userId: string;
  workspaceId: string;
}

// Définition des schémas Zod pour chaque tool
const listWorkspacePagesSchema = z.object({
  projectId: z.string().optional().describe("Filtrer par projet spécifique"),
  limit: z
    .number()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe("Nombre max de pages"),
  search: z.string().optional().describe("Recherche dans les titres"),
  includeArchived: z
    .boolean()
    .optional()
    .default(false)
    .describe("Inclure les pages archivées"),
});

const readWorkspacePageSchema = z.object({
  pageId: z.string().describe("ID de la page à lire"),
});

const listWorkspaceProjectsSchema = z.object({
  limit: z
    .number()
    .min(1)
    .max(50)
    .optional()
    .default(20)
    .describe("Nombre max de projets"),
});

/**
 * Crée les tools Workspace avec le contexte utilisateur
 */
export function createWorkspaceTools(ctx: WorkspaceToolsContext) {
  return {
    /**
     * Liste les pages du workspace
     */
    listWorkspacePages: tool({
      description: `Liste les pages disponibles dans le workspace de l'utilisateur.
Retourne les titres, IDs, et métadonnées des pages.
Utile pour savoir quelles pages peuvent être référencées ou lues.`,
      inputSchema: listWorkspacePagesSchema,
      execute: async ({ projectId, limit, search, includeArchived }) => {
        console.log(
          `🔍 [TOOL:listWorkspacePages] workspaceId=${ctx.workspaceId}, projectId=${projectId || "all"}`,
        );

        try {
          const whereClause: any = {
            workspaceId: ctx.workspaceId,
            isArchived: includeArchived ? undefined : false,
          };

          if (projectId) {
            whereClause.projectId = projectId;
          }

          if (search) {
            whereClause.title = { contains: search, mode: "insensitive" };
          }

          const pages = await prisma.page.findMany({
            where: whereClause,
            select: {
              id: true,
              title: true,
              slug: true,
              projectId: true,
              createdAt: true,
              updatedAt: true,
              project: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
            orderBy: { updatedAt: "desc" },
            take: limit,
          });

          console.log(
            `✅ [TOOL:listWorkspacePages] ${pages.length} pages trouvées`,
          );

          return {
            count: pages.length,
            pages: pages.map((p) => ({
              id: p.id,
              title: p.title || "Sans titre",
              slug: p.slug,
              projectId: p.projectId,
              projectName: p.project?.name,
              updatedAt: p.updatedAt.toISOString(),
            })),
          };
        } catch (error) {
          console.error(`❌ [TOOL:listWorkspacePages] Erreur:`, error);
          return {
            error: "Erreur lors de la récupération des pages",
            count: 0,
            pages: [],
          };
        }
      },
    }),

    /**
     * Lit le contenu d'une page workspace
     */
    readWorkspacePage: tool({
      description: `Lit le contenu complet d'une page du workspace.
Retourne le titre, le contenu en texte brut, et les métadonnées.
Le contenu BlockNote est converti en texte lisible.`,
      inputSchema: readWorkspacePageSchema,
      execute: async ({ pageId }) => {
        console.log(`🔍 [TOOL:readWorkspacePage] pageId=${pageId}`);

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
              blockNoteContent: true,
              createdAt: true,
              updatedAt: true,
              project: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          });

          if (!page) {
            return {
              error: "Page non trouvée ou non accessible",
              content: null,
            };
          }

          // Extraire le texte du contenu BlockNote
          let textContent = "";
          try {
            if (page.blockNoteContent) {
              const content =
                typeof page.blockNoteContent === "string"
                  ? JSON.parse(page.blockNoteContent)
                  : page.blockNoteContent;

              if (Array.isArray(content)) {
                textContent = extractTextFromBlockNote(content);
              }
            }
          } catch (e) {
            console.warn(
              `⚠️ [TOOL:readWorkspacePage] Erreur extraction BlockNote:`,
              e,
            );
          }

          console.log(
            `✅ [TOOL:readWorkspacePage] Page "${page.title}" lue (${textContent.length} chars)`,
          );

          return {
            id: page.id,
            title: page.title || "Sans titre",
            content: textContent || "(Page vide)",
            contentLength: textContent.length,
            projectId: page.project?.id,
            projectName: page.project?.name,
            createdAt: page.createdAt.toISOString(),
            updatedAt: page.updatedAt.toISOString(),
          };
        } catch (error) {
          console.error(`❌ [TOOL:readWorkspacePage] Erreur:`, error);
          return {
            error: "Erreur lors de la lecture de la page",
            content: null,
          };
        }
      },
    }),

    /**
     * Liste les projets du workspace
     */
    listWorkspaceProjects: tool({
      description: `Liste les projets (dossiers) du workspace.
Retourne les noms, IDs, et nombre de pages par projet.`,
      inputSchema: listWorkspaceProjectsSchema,
      execute: async ({ limit }) => {
        console.log(
          `🔍 [TOOL:listWorkspaceProjects] workspaceId=${ctx.workspaceId}`,
        );

        try {
          const projects = await prisma.project.findMany({
            where: {
              workspaceId: ctx.workspaceId,
            },
            select: {
              id: true,
              name: true,
              createdAt: true,
              _count: {
                select: { pages: true },
              },
            },
            orderBy: { name: "asc" },
            take: limit,
          });

          console.log(
            `✅ [TOOL:listWorkspaceProjects] ${projects.length} projets trouvés`,
          );

          return {
            count: projects.length,
            projects: projects.map((p) => ({
              id: p.id,
              name: p.name,
              pagesCount: p._count.pages,
            })),
          };
        } catch (error) {
          console.error(`❌ [TOOL:listWorkspaceProjects] Erreur:`, error);
          return {
            error: "Erreur lors de la récupération des projets",
            count: 0,
            projects: [],
          };
        }
      },
    }),
  };
}

/**
 * Extrait le texte brut depuis un contenu BlockNote
 */
function extractTextFromBlockNote(blocks: any[]): string {
  const textParts: string[] = [];

  for (const block of blocks) {
    if (!block) continue;

    // Extraire le texte des différents types de blocs
    switch (block.type) {
      case "paragraph":
      case "heading":
      case "bulletListItem":
      case "numberedListItem":
      case "checkListItem":
        if (block.content && Array.isArray(block.content)) {
          const blockText = block.content
            .map((item: any) => item?.text || "")
            .filter(Boolean)
            .join("");
          if (blockText) {
            // Ajouter le niveau de heading si applicable
            if (block.type === "heading" && block.props?.level) {
              textParts.push("#".repeat(block.props.level) + " " + blockText);
            } else if (block.type === "bulletListItem") {
              textParts.push("- " + blockText);
            } else if (block.type === "numberedListItem") {
              textParts.push("1. " + blockText);
            } else if (block.type === "checkListItem") {
              const checked = block.props?.checked ? "[x]" : "[ ]";
              textParts.push(checked + " " + blockText);
            } else {
              textParts.push(blockText);
            }
          }
        }
        break;

      case "codeBlock":
        if (block.content && Array.isArray(block.content)) {
          const code = block.content
            .map((item: any) => item?.text || "")
            .join("");
          if (code) {
            const lang = block.props?.language || "";
            textParts.push("```" + lang + "\n" + code + "\n```");
          }
        }
        break;

      case "table":
        // Extraction basique des tables
        if (block.content?.rows) {
          for (const row of block.content.rows) {
            if (row.cells) {
              const cellTexts = row.cells.map((cell: any) => {
                if (Array.isArray(cell)) {
                  return cell.map((item: any) => item?.text || "").join("");
                }
                return "";
              });
              textParts.push("| " + cellTexts.join(" | ") + " |");
            }
          }
        }
        break;

      case "image":
        if (block.props?.caption) {
          textParts.push(`[Image: ${block.props.caption}]`);
        }
        break;
    }

    // Traiter les blocs enfants récursivement
    if (
      block.children &&
      Array.isArray(block.children) &&
      block.children.length > 0
    ) {
      const childText = extractTextFromBlockNote(block.children);
      if (childText) {
        textParts.push(childText);
      }
    }
  }

  return textParts.join("\n\n");
}
