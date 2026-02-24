import { prisma } from "../../../lib/prisma.js";
import { logger } from "../../../utils/logger.js";

/**
 * BlockNote content type definitions for type-safe parsing
 */
interface BlockNoteTextItem {
  text?: string;
  type?: string;
  [key: string]: unknown;
}

interface BlockNoteBlock {
  type?: string;
  content?: BlockNoteTextItem[] | unknown;
  [key: string]: unknown;
}

/**
 * Type guard for BlockNote block with paragraph content
 */
function isParagraphBlockWithContent(block: unknown): block is BlockNoteBlock & {
  type: "paragraph";
  content: BlockNoteTextItem[];
} {
  if (typeof block !== "object" || block === null) return false;
  const b = block as Record<string, unknown>;
  return b.type === "paragraph" && Array.isArray(b.content);
}

function safeJsonParse(value: string): unknown {
  const parsed: unknown = JSON.parse(value);
  return parsed;
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/**
 * 🔧 Helper - Indexe les pages mentionnées et retourne les sources RAG
 * Utilisé par askStream et searchStream pour éviter la duplication
 */
export async function indexAndPreparePagesForAI(
  pageObjects: Array<{ id: string; title: string }>,
  userId: string,
  workspaceId: string,
): Promise<Array<{ id: string; title: string; type: string }>> {
  const { userPagesRAG } = await import("../../../services/rag/userPages.js");

  const pageContents = await Promise.all(
    pageObjects.map(async (p) => {
      try {
        // Récupérer le contenu de la page
        const pageData = await prisma.page.findUnique({
          where: { id: p.id },
          select: { title: true, blockNoteContent: true, updatedAt: true },
        });

        if (pageData) {
          let textContent = pageData.title || "";
          try {
            if (pageData.blockNoteContent) {
              const content: unknown =
                typeof pageData.blockNoteContent === "string"
                  ? safeJsonParse(pageData.blockNoteContent)
                  : pageData.blockNoteContent;
              if (isUnknownArray(content)) {
                const textParts = content
                  .filter(isParagraphBlockWithContent)
                  .map((block) =>
                    block.content.map((item: BlockNoteTextItem) => item.text || "").join(""),
                  )
                  .filter(Boolean);
                if (textParts.length > 0) {
                  textContent = (pageData.title || "") + "\n\n" + textParts.join("\n\n");
                }
              }
            }
          } catch (e) {
            const errorMsg = e instanceof Error ? e.message : String(e);
            logger.log(`⚠️ Erreur extraction contenu page: ${errorMsg}`);
          }

          // Indexer la page si pas déjà fait
          const ragSourceId = await userPagesRAG.processUserPage({
            id: p.id,
            title: pageData.title || "Sans titre",
            content: textContent,
            userId,
            workspaceId,
            updatedAt: pageData.updatedAt,
          });

          return {
            id: ragSourceId || p.id,
            title: pageData.title || p.title || "Page sans titre",
            type: "WORKSPACE_PAGE",
          };
        }
        return { id: p.id, title: p.title, type: "WORKSPACE_PAGE" };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.log(`⚠️ Erreur traitement page "${p.title}": ${errorMsg}`);
        return { id: p.id, title: p.title, type: "WORKSPACE_PAGE" };
      }
    }),
  );

  return pageContents.filter(Boolean);
}
