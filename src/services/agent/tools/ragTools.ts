// 🔍 RAG Tools - Vercel AI SDK Format
import { tool } from "ai";
import { z } from "zod";
import {
  prismaEmbeddings,
  type Prisma,
  type RAGSourceType,
} from "../../../lib/prismaEmbeddings.js";
import { ragSystem, type RAGSearchOptions } from "../../rag/index.js";
import { logger } from "../../../utils/logger.js";

/**
 * User context injected via closure in createRagTools()
 */
interface RagToolsContext {
  userId: string;
  workspaceId: string;
}

const listAvailableSourcesSchema = z.object({
  includeGlobal: z
    .boolean()
    .optional()
    .default(true)
    .describe("Include global sources (Wikipedia)"),
  sourceTypes: z
    .array(z.enum(["PDF", "TEXT_FILE", "WIKIPEDIA", "WORKSPACE_PAGE", "USER_NOTES"]))
    .optional()
    .describe("Filter by source types"),
});

const searchRagChunksSchema = z.object({
  query: z.string().min(3).describe("Search query or keywords"),
  sourceIds: z
    .array(z.string())
    .optional()
    .describe("IDs of specific sources to search in (if empty, searches all sources)"),
  limit: z.number().min(1).max(20).optional().default(8).describe("Maximum number of results"),
  threshold: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .default(0.2)
    .describe("Minimum similarity score (0-1)"),
});

const readRagSourceSchema = z.object({
  sourceId: z.string().describe("ID of the RAG source to read"),
  maxChunks: z
    .number()
    .min(1)
    .max(50)
    .optional()
    .default(20)
    .describe("Maximum number of chunks to return"),
});

const checkSourcesRagStatusSchema = z.object({
  titles: z.array(z.string()).describe("Titles of sources to check"),
});

/**
 * Creates RAG tools with user context
 */
export function createRagTools(ctx: RagToolsContext) {
  return {
    listAvailableSources: tool({
      description: `Lists all available RAG sources for the user. Use this tool FIRST before searching to discover which sources (uploaded PDFs, documents, indexed Wikipedia articles, workspace pages) are available and how many chunks each contains.`,
      inputSchema: listAvailableSourcesSchema,
      execute: async ({ includeGlobal, sourceTypes }) => {
        logger.log(
          `🔍 [TOOL:listAvailableSources] userId=${ctx.userId}, workspaceId=${ctx.workspaceId}`,
        );

        try {
          // Construire le WHERE clause
          const whereClause: Prisma.RAGSourceWhereInput = {
            status: "COMPLETED",
            OR: [
              // Sources privées de l'utilisateur
              {
                userId: ctx.userId,
                workspaceId: ctx.workspaceId,
                isGlobal: false,
              },
            ],
          };

          // Ajouter sources globales si demandé
          if (includeGlobal && whereClause.OR) {
            (whereClause.OR as Prisma.RAGSourceWhereInput[]).push({
              isGlobal: true,
            });
          }

          // Filtrer par type si spécifié
          if (sourceTypes && sourceTypes.length > 0) {
            whereClause.sourceType = { in: sourceTypes as RAGSourceType[] };
          }

          const sources = await prismaEmbeddings.rAGSource.findMany({
            where: whereClause,
            select: {
              id: true,
              title: true,
              sourceType: true,
              totalChunks: true,
              fileName: true,
              isGlobal: true,
              createdAt: true,
              lastUsedAt: true,
            },
            orderBy: { lastUsedAt: "desc" },
            take: 50,
          });

          logger.log(`✅ [TOOL:listAvailableSources] ${sources.length} sources trouvées`);

          return {
            count: sources.length,
            sources: sources.map((s) => ({
              id: s.id,
              title: s.title,
              type: s.sourceType,
              chunks: s.totalChunks || 0,
              fileName: s.fileName,
              isGlobal: s.isGlobal,
            })),
          };
        } catch (error) {
          logger.error(`❌ [TOOL:listAvailableSources] Erreur:`, error);
          return {
            error: "Failed to retrieve RAG sources. Try again or use searchRagChunks directly.",
            count: 0,
            sources: [],
          };
        }
      },
    }),

    searchRagChunks: tool({
      description: `Performs semantic search across indexed RAG sources using vector embeddings. Use this tool when you need to find specific information, answer factual questions, or locate relevant passages. Returns matching chunks with content, source, and similarity score.`,
      inputSchema: searchRagChunksSchema,
      execute: async ({ query, sourceIds, limit, threshold }) => {
        logger.log(
          `🔍 [TOOL:searchRagChunks] query="${query}", sources=${sourceIds?.length || "all"}, limit=${limit}`,
        );

        try {
          const searchOptions: RAGSearchOptions = {
            userId: ctx.userId,
            workspaceId: ctx.workspaceId,
            limit,
            threshold,
          };

          // Si des sources spécifiques sont demandées
          if (sourceIds && sourceIds.length > 0) {
            searchOptions.specificSourceIds = sourceIds;
          }

          const results = await ragSystem.intelligentSearch(query, searchOptions);

          logger.log(`✅ [TOOL:searchRagChunks] ${results.length} chunks trouvés`);

          return {
            count: results.length,
            chunks: results.map((r) => ({
              content: r.content,
              source: {
                id: r.source.id,
                title: r.source.title,
                type: r.source.sourceType,
              },
              similarity: Math.round(r.similarity * 100) / 100,
              section: r.sectionTitle,
              page: r.pageNumber,
            })),
          };
        } catch (error) {
          logger.error(`❌ [TOOL:searchRagChunks] Erreur:`, error);
          return {
            error:
              "RAG search failed for this query. Try rephrasing your query or use an alternative tool.",
            count: 0,
            chunks: [],
          };
        }
      },
    }),

    readRagSource: tool({
      description: `Retrieves all chunks from a specific RAG source. Use this tool when you need a complete view of a document or article. Returns content organized by sections when available.`,
      inputSchema: readRagSourceSchema,
      execute: async ({ sourceId, maxChunks }) => {
        logger.log(`🔍 [TOOL:readRagSource] sourceId=${sourceId}, maxChunks=${maxChunks}`);

        try {
          // Vérifier que la source existe et est accessible
          const source = await prismaEmbeddings.rAGSource.findFirst({
            where: {
              id: sourceId,
              status: "COMPLETED",
              OR: [{ userId: ctx.userId, workspaceId: ctx.workspaceId }, { isGlobal: true }],
            },
            select: {
              id: true,
              title: true,
              sourceType: true,
              totalChunks: true,
              originalUrl: true,
            },
          });

          if (!source) {
            return {
              error:
                "Source not found or not accessible. Verify the sourceId with listAvailableSources.",
              content: null,
            };
          }

          // Récupérer les chunks
          const chunks = await prismaEmbeddings.rAGChunk.findMany({
            where: { sourceId },
            select: {
              content: true,
              cleanContent: true,
              sectionTitle: true,
              pageNumber: true,
              chunkIndex: true,
            },
            orderBy: { chunkIndex: "asc" },
            take: maxChunks,
          });

          logger.log(
            `✅ [TOOL:readRagSource] ${chunks.length} chunks récupérés pour "${source.title}"`,
          );

          // Organiser par sections si possible
          const sections: Record<string, string[]> = {};
          for (const chunk of chunks) {
            const sectionKey = chunk.sectionTitle || "Main content";
            if (!sections[sectionKey]) {
              sections[sectionKey] = [];
            }
            sections[sectionKey].push(chunk.cleanContent || chunk.content);
          }

          return {
            source: {
              id: source.id,
              title: source.title,
              type: source.sourceType,
              url: source.originalUrl,
              totalChunks: source.totalChunks,
            },
            sections: Object.entries(sections).map(([title, contents]) => ({
              title,
              content: contents.join("\n\n"),
            })),
            chunksRetrieved: chunks.length,
          };
        } catch (error) {
          logger.error(`❌ [TOOL:readRagSource] Error:`, error);
          return {
            error:
              "Failed to read RAG source. Verify the sourceId exists with listAvailableSources.",
            content: null,
          };
        }
      },
    }),

    checkSourcesRagStatus: tool({
      description: `Checks whether specific sources are indexed and ready for RAG search. Use this tool to verify if a file or Wikipedia article has been processed before attempting to search it.`,
      inputSchema: checkSourcesRagStatusSchema,
      execute: async ({ titles }) => {
        logger.log(`🔍 [TOOL:checkSourcesRagStatus] Checking ${titles.length} sources`);

        try {
          const results = await Promise.all(
            titles.map(async (title: string) => {
              const source = await prismaEmbeddings.rAGSource.findFirst({
                where: {
                  title: { contains: title, mode: "insensitive" },
                  status: "COMPLETED",
                  OR: [{ userId: ctx.userId, workspaceId: ctx.workspaceId }, { isGlobal: true }],
                },
                select: {
                  id: true,
                  title: true,
                  status: true,
                  totalChunks: true,
                  sourceType: true,
                },
              });

              return {
                searchedTitle: title,
                found: !!source,
                sourceId: source?.id || null,
                actualTitle: source?.title || null,
                type: source?.sourceType || null,
                chunks: source?.totalChunks || 0,
                ready: source?.status === "COMPLETED",
              };
            }),
          );

          const readyCount = results.filter((r) => r.ready).length;
          logger.log(
            `✅ [TOOL:checkSourcesRagStatus] ${readyCount}/${titles.length} sources ready`,
          );

          return {
            totalChecked: titles.length,
            readyCount,
            results,
          };
        } catch (error) {
          logger.error(`❌ [TOOL:checkSourcesRagStatus] Error:`, error);
          return {
            error: "Failed to check source status. Try again with fewer titles.",
            totalChecked: 0,
            readyCount: 0,
            results: [],
          };
        }
      },
    }),
  };
}
