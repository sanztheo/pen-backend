// 📄 Page Tools - Création et gestion de pages via l'agent
import { tool } from "ai";
import { z } from "zod";
import { Prisma } from "@prisma/client";
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
          // Cast to Prisma.InputJsonValue for JSON column compatibility
          const blockNoteContent = content
            ? (convertTextToBlockNote(
                content,
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
            projectId: page.projectId || null,
            projectName: null, // Simplifié - pas de join sur project
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

// ============================================================================
// MARKDOWN TO BLOCKNOTE CONVERTER
// ============================================================================

interface InlineContent {
  type: "text" | "link";
  text?: string;
  styles?: Record<string, boolean>;
  href?: string;
  content?: InlineContent[];
}

/**
 * BlockNote block structure
 */
interface BlockNoteBlock {
  id: string;
  type: string;
  props: BlockNoteBlockProps;
  content: InlineContent[];
  children: BlockNoteBlock[];
}

/**
 * BlockNote block properties
 */
interface BlockNoteBlockProps {
  textColor: string;
  backgroundColor: string;
  textAlignment: string;
  level?: 1 | 2 | 3;
  checked?: boolean;
  [key: string]: string | number | boolean | undefined;
}

/**
 * Parse inline markdown formatting into BlockNote InlineContent array
 * Supports: **bold**, *italic*, `code`, ~~strike~~, [links](url)
 */
function parseInlineContent(text: string): InlineContent[] {
  const result: InlineContent[] = [];
  let remaining = text;

  // Regex patterns for inline formatting
  // Order matters: check longer patterns first
  const patterns = [
    // Links: [text](url)
    {
      regex: /^\[([^\]]+)\]\(([^)]+)\)/,
      handler: (match: RegExpMatchArray): InlineContent => ({
        type: "link",
        href: match[2],
        content: parseInlineContent(match[1]), // Recursive for nested formatting
      }),
    },
    // Bold: **text** or __text__
    {
      regex: /^\*\*([^*]+)\*\*/,
      handler: (match: RegExpMatchArray): InlineContent[] =>
        parseInlineContent(match[1]).map((item) => ({
          ...item,
          styles: { ...item.styles, bold: true },
        })),
    },
    {
      regex: /^__([^_]+)__/,
      handler: (match: RegExpMatchArray): InlineContent[] =>
        parseInlineContent(match[1]).map((item) => ({
          ...item,
          styles: { ...item.styles, bold: true },
        })),
    },
    // Italic: *text* or _text_ (single)
    {
      regex: /^\*([^*]+)\*/,
      handler: (match: RegExpMatchArray): InlineContent[] =>
        parseInlineContent(match[1]).map((item) => ({
          ...item,
          styles: { ...item.styles, italic: true },
        })),
    },
    {
      regex: /^_([^_]+)_/,
      handler: (match: RegExpMatchArray): InlineContent[] =>
        parseInlineContent(match[1]).map((item) => ({
          ...item,
          styles: { ...item.styles, italic: true },
        })),
    },
    // Inline code: `code`
    {
      regex: /^`([^`]+)`/,
      handler: (match: RegExpMatchArray): InlineContent => ({
        type: "text",
        text: match[1],
        styles: { code: true },
      }),
    },
    // Strikethrough: ~~text~~
    {
      regex: /^~~([^~]+)~~/,
      handler: (match: RegExpMatchArray): InlineContent[] =>
        parseInlineContent(match[1]).map((item) => ({
          ...item,
          styles: { ...item.styles, strike: true },
        })),
    },
  ];

  while (remaining.length > 0) {
    let matched = false;

    // Try each pattern
    for (const { regex, handler } of patterns) {
      const match = remaining.match(regex);
      if (match) {
        const handlerResult = handler(match);
        if (Array.isArray(handlerResult)) {
          result.push(...handlerResult);
        } else {
          result.push(handlerResult);
        }
        remaining = remaining.slice(match[0].length);
        matched = true;
        break;
      }
    }

    // No pattern matched - consume one character as plain text
    if (!matched) {
      // Find next special character or end
      const nextSpecial = remaining.slice(1).search(/[\[*_`~]/);
      const endIndex = nextSpecial === -1 ? remaining.length : nextSpecial + 1;
      const plainText = remaining.slice(0, endIndex);

      // Merge with previous text node if possible
      const lastItem = result[result.length - 1];
      if (
        lastItem &&
        lastItem.type === "text" &&
        !lastItem.styles?.bold &&
        !lastItem.styles?.italic &&
        !lastItem.styles?.code &&
        !lastItem.styles?.strike
      ) {
        lastItem.text = (lastItem.text || "") + plainText;
      } else {
        result.push({
          type: "text",
          text: plainText,
          styles: {},
        });
      }

      remaining = remaining.slice(endIndex);
    }
  }

  return result;
}

/**
 * Create a BlockNote block with parsed inline content
 */
function createBlock(
  type: string,
  content: string,
  props: Partial<BlockNoteBlockProps> = {},
): BlockNoteBlock {
  const defaultProps: BlockNoteBlockProps = {
    textColor: "default",
    backgroundColor: "default",
    textAlignment: "left",
    ...props,
  };

  return {
    id: nanoid(10),
    type,
    props: defaultProps,
    content: parseInlineContent(content),
    children: [],
  };
}

/**
 * Convert markdown text to BlockNote blocks with full inline formatting support
 */
function convertTextToBlockNote(text: string): BlockNoteBlock[] {
  const lines = text.split("\n");
  const blocks: BlockNoteBlock[] = [];

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    // Heading: # Title (levels 1-6, but BlockNote uses 1-3)
    const headingMatch = trimmedLine.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      blocks.push(
        createBlock("heading", headingMatch[2], {
          level: Math.min(headingMatch[1].length, 3) as 1 | 2 | 3,
        }),
      );
      continue;
    }

    // Checkbox list: - [ ] or - [x]
    const checkboxMatch = trimmedLine.match(/^[-*]\s+\[([ xX])\]\s+(.+)$/);
    if (checkboxMatch) {
      blocks.push(
        createBlock("checkListItem", checkboxMatch[2], {
          checked: checkboxMatch[1].toLowerCase() === "x",
        }),
      );
      continue;
    }

    // Bullet list: - item or * item
    const bulletMatch = trimmedLine.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      blocks.push(createBlock("bulletListItem", bulletMatch[1]));
      continue;
    }

    // Numbered list: 1. item
    const numberedMatch = trimmedLine.match(/^\d+\.\s+(.+)$/);
    if (numberedMatch) {
      blocks.push(createBlock("numberedListItem", numberedMatch[1]));
      continue;
    }

    // Blockquote: > text
    const quoteMatch = trimmedLine.match(/^>\s*(.*)$/);
    if (quoteMatch) {
      blocks.push(createBlock("paragraph", quoteMatch[1] || ""));
      continue;
    }

    // Horizontal rule: --- or ***
    if (/^[-*]{3,}$/.test(trimmedLine)) {
      // BlockNote doesn't have HR, skip or use empty paragraph
      continue;
    }

    // Default: paragraph
    blocks.push(createBlock("paragraph", trimmedLine));
  }

  return blocks;
}
