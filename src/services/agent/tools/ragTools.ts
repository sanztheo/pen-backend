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
 * Context utilisateur injecté via closure dans createRagTools()
 */
interface RagToolsContext {
  userId: string;
  workspaceId: string;
}

// Définition des schémas Zod pour chaque tool
const listAvailableSourcesSchema = z.object({
  includeGlobal: z
    .boolean()
    .optional()
    .default(true)
    .describe("Inclure les sources globales (Wikipedia)"),
  sourceTypes: z
    .array(z.enum(["PDF", "TEXT_FILE", "WIKIPEDIA", "WORKSPACE_PAGE", "USER_NOTES"]))
    .optional()
    .describe("Filtrer par types de sources"),
});

const searchRagChunksSchema = z.object({
  query: z.string().min(3).describe("Question ou mots-clés à rechercher"),
  sourceIds: z
    .array(z.string())
    .optional()
    .describe("IDs des sources spécifiques à interroger (si vide, cherche dans toutes)"),
  limit: z.number().min(1).max(20).optional().default(8).describe("Nombre max de résultats"),
  threshold: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .default(0.2)
    .describe("Score minimum de similarité (0-1)"),
});

const readRagSourceSchema = z.object({
  sourceId: z.string().describe("ID de la source RAG à lire"),
  maxChunks: z
    .number()
    .min(1)
    .max(50)
    .optional()
    .default(20)
    .describe("Nombre max de chunks à retourner"),
});

const checkSourcesRagStatusSchema = z.object({
  titles: z.array(z.string()).describe("Titres des sources à vérifier"),
});

/**
 * Crée les tools RAG avec le contexte utilisateur
 */
export function createRagTools(ctx: RagToolsContext) {
  return {
    /**
     * Liste toutes les sources RAG disponibles dans le workspace
     */
    listAvailableSources: tool({
      description: `Liste toutes les sources RAG disponibles pour l'utilisateur.
Retourne les fichiers uploadés (PDF, documents), les pages Wikipedia indexées,
et les pages workspace avec leur statut et nombre de chunks.
Utilise cet outil EN PREMIER pour savoir quelles sources sont disponibles avant de chercher.`,
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
            error: "Erreur lors de la récupération des sources",
            count: 0,
            sources: [],
          };
        }
      },
    }),

    /**
     * Recherche dans les chunks RAG avec similarité vectorielle
     */
    searchRagChunks: tool({
      description: `Recherche sémantique dans les sources RAG indexées.
Utilise les embeddings vectoriels pour trouver les passages les plus pertinents.
Retourne les chunks avec leur contenu, source, et score de similarité.
Idéal pour répondre à des questions factuelles ou trouver des informations précises.`,
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
            error: "Erreur lors de la recherche RAG",
            count: 0,
            chunks: [],
          };
        }
      },
    }),

    /**
     * Lit le contenu complet d'une source RAG
     */
    readRagSource: tool({
      description: `Récupère tous les chunks d'une source RAG spécifique.
Utile pour obtenir une vue complète d'un document ou article.
Retourne le contenu organisé par sections si disponible.`,
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
              error: "Source non trouvée ou non accessible",
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
            const sectionKey = chunk.sectionTitle || "Contenu principal";
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
          logger.error(`❌ [TOOL:readRagSource] Erreur:`, error);
          return {
            error: "Erreur lors de la lecture de la source",
            content: null,
          };
        }
      },
    }),

    /**
     * Vérifie le statut RAG de sources spécifiques
     */
    checkSourcesRagStatus: tool({
      description: `Vérifie si des sources sont indexées et prêtes pour la recherche RAG.
Utile pour savoir si un fichier ou article Wikipedia a été traité.`,
      inputSchema: checkSourcesRagStatusSchema,
      execute: async ({ titles }) => {
        logger.log(`🔍 [TOOL:checkSourcesRagStatus] Vérification de ${titles.length} sources`);

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
            `✅ [TOOL:checkSourcesRagStatus] ${readyCount}/${titles.length} sources prêtes`,
          );

          return {
            totalChecked: titles.length,
            readyCount,
            results,
          };
        } catch (error) {
          logger.error(`❌ [TOOL:checkSourcesRagStatus] Erreur:`, error);
          return {
            error: "Erreur lors de la vérification",
            totalChecked: 0,
            readyCount: 0,
            results: [],
          };
        }
      },
    }),
  };
}
