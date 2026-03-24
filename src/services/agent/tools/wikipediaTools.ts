import { tool } from "ai";
import { z } from "zod";
import { prismaEmbeddings, Prisma } from "../../../lib/prismaEmbeddings.js";
import { wikipediaRAG, type WikipediaArticle } from "../../rag/wikipedia.js";
import { ragSystem } from "../../rag/index.js";
import { logger } from "../../../utils/logger.js";
import { MODELS, EMBEDDING_DIMENSION } from "../../../config/models.js";
import { mapLanguageToWikiCode } from "./webTools.js";

/**
 * User context injected via closure
 */
export interface WikipediaToolsContext {
  userId: string;
  workspaceId: string;
  language?: string;
}

const indexWikipediaToRAGSchema = z.object({
  pageid: z.number().optional().describe("Wikipedia page ID to index"),
  title: z.string().optional().describe("Wikipedia article title (if no pageid)"),
});

const getWikipediaFullContentSchema = z.object({
  pageid: z.number().optional().describe("Wikipedia page ID"),
  title: z.string().optional().describe("Article title (if no pageid)"),
  maxSections: z
    .number()
    .min(1)
    .max(30)
    .optional()
    .default(15)
    .describe("Maximum number of sections to return"),
});

const searchWikipediaRAGSchema = z.object({
  query: z.string().min(3).describe("Search query or keywords"),
  limit: z
    .number()
    .min(1)
    .max(15)
    .optional()
    .default(6)
    .describe("Maximum number of chunks to return"),
  threshold: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .default(0.25)
    .describe("Minimum similarity score (0-1)"),
});

const listWikipediaRAGSourcesSchema = z.object({
  limit: z
    .number()
    .min(1)
    .max(50)
    .optional()
    .default(20)
    .describe("Maximum number of sources to return"),
});

const WikipediaSearchApiResponseSchema = z
  .object({
    query: z
      .object({
        search: z
          .array(
            z.object({
              pageid: z.number(),
              title: z.string().optional(),
            }),
          )
          .optional(),
      })
      .optional(),
  })
  .passthrough();

const WikipediaIntroExtractResponseSchema = z
  .object({
    query: z
      .object({
        pages: z
          .record(
            z
              .object({
                pageid: z.number(),
                title: z.string(),
                extract: z.string().optional(),
              })
              .passthrough(),
          )
          .optional(),
      })
      .optional(),
  })
  .passthrough();

const WikipediaFullContentResponseSchema = z
  .object({
    query: z
      .object({
        pages: z
          .record(
            z
              .object({
                pageid: z.number(),
                title: z.string(),
                extract: z.string().optional(),
                canonicalurl: z.string().optional(),
                categories: z.array(z.object({ title: z.string() })).optional(),
              })
              .passthrough(),
          )
          .optional(),
      })
      .optional(),
  })
  .passthrough();

/**
 * Creates Wikipedia tools with pgvector integration
 */
export function createWikipediaTools(ctx: WikipediaToolsContext) {
  const wikiLang = mapLanguageToWikiCode(ctx.language);
  const wikiBase = `https://${wikiLang}.wikipedia.org`;

  // Category prefix varies by language
  const categoryPrefixes: Record<string, string> = {
    fr: "Catégorie:",
    en: "Category:",
    es: "Categoría:",
    de: "Kategorie:",
    it: "Categoria:",
    pt: "Categoria:",
    ja: "Category:",
    zh: "Category:",
    ar: "تصنيف:",
  };
  const catPrefix = categoryPrefixes[wikiLang] ?? "Category:";

  return {
    indexWikipediaToRAG: tool({
      description: `Indexes a Wikipedia article into the pgvector database for semantic search. Use this tool to store important Wikipedia articles so you can search them later with searchWikipediaRAG. Articles are chunked and embedded with text-embedding-3-small (1536D). Indexed articles are GLOBAL and shared across all users.`,
      inputSchema: indexWikipediaToRAGSchema,
      execute: async ({ pageid, title }) => {
        logger.log(`🔄 [TOOL:indexWikipediaToRAG] pageid=${pageid}, title=${title}`);

        if (!pageid && !title) {
          return {
            error: "Provide either pageid or title. Use searchWikipedia first to find articles.",
            indexed: false,
          };
        }

        try {
          let resolvedPageId = pageid;
          let resolvedTitle = title;

          if (!resolvedPageId && title) {
            const searchUrl = `${wikiBase}/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(title)}&srlimit=1&format=json&origin=*`;
            const response = await fetch(searchUrl, { signal: AbortSignal.timeout(15_000) });
            const raw: unknown = await response.json();
            const parsed = WikipediaSearchApiResponseSchema.safeParse(raw);
            if (!parsed.success) {
              return {
                error: `Invalid Wikipedia response for search "${title}". Try a different title.`,
                indexed: false,
              };
            }
            const data = parsed.data;

            const firstResult = data.query?.search?.[0];
            if (!firstResult) {
              return {
                error: `Wikipedia article "${title}" not found. Try searchWikipedia to find the correct title.`,
                indexed: false,
              };
            }
            resolvedPageId = firstResult.pageid;
            resolvedTitle = firstResult.title;
          }

          // Check if already indexed
          const existing = await prismaEmbeddings.rAGSource.findFirst({
            where: {
              sourceType: "WIKIPEDIA",
              metadata: { path: ["pageid"], equals: resolvedPageId },
              status: "COMPLETED",
            },
            select: { id: true, title: true, totalChunks: true },
          });

          if (existing) {
            logger.log(
              `♻️ [TOOL:indexWikipediaToRAG] Already indexed: "${existing.title}" (${existing.totalChunks} chunks)`,
            );
            return {
              indexed: true,
              alreadyExists: true,
              sourceId: existing.id,
              title: existing.title,
              chunks: existing.totalChunks,
              message: `Article "${existing.title}" already indexed with ${existing.totalChunks} chunks`,
            };
          }

          // Fetch intro extract for context
          const infoUrl = `${wikiBase}/w/api.php?action=query&pageids=${resolvedPageId}&prop=extracts&exintro=1&explaintext=1&format=json&origin=*`;
          const infoResponse = await fetch(infoUrl, { signal: AbortSignal.timeout(15_000) });
          const infoRaw: unknown = await infoResponse.json();
          const infoParsed = WikipediaIntroExtractResponseSchema.safeParse(infoRaw);
          const pageInfo = infoParsed.success
            ? infoParsed.data.query?.pages?.[String(resolvedPageId)]
            : undefined;
          const extract = pageInfo?.extract || "";
          resolvedTitle = pageInfo?.title || resolvedTitle || "Wikipedia Article";

          const article: WikipediaArticle = {
            pageid: resolvedPageId!,
            title: resolvedTitle,
            extract,
          };

          logger.log(`📖 [TOOL:indexWikipediaToRAG] Indexing "${resolvedTitle}"...`);
          const sourceIds = await wikipediaRAG.processWikipediaArticles(
            ctx.userId,
            ctx.workspaceId,
            [article],
          );

          if (sourceIds.length === 0) {
            return {
              error:
                "Indexing failed. The article may be too short or empty. Try a different article.",
              indexed: false,
            };
          }

          const source = await prismaEmbeddings.rAGSource.findUnique({
            where: { id: sourceIds[0] },
            select: { id: true, title: true, totalChunks: true, status: true },
          });

          logger.log(
            `✅ [TOOL:indexWikipediaToRAG] "${resolvedTitle}" indexed with ${source?.totalChunks || 0} chunks`,
          );

          return {
            indexed: true,
            alreadyExists: false,
            sourceId: source?.id,
            title: source?.title,
            chunks: source?.totalChunks || 0,
            message: `Article "${resolvedTitle}" successfully indexed (${source?.totalChunks} chunks with text-embedding-3-small embeddings)`,
          };
        } catch (error) {
          logger.error(`❌ [TOOL:indexWikipediaToRAG] Error:`, error);
          return {
            error: "Wikipedia indexing failed. Try again or use a different article.",
            indexed: false,
          };
        }
      },
    }),

    getWikipediaFullContent: tool({
      description: `Retrieves the FULL content of a Wikipedia article with all sections. Unlike getWikipediaArticle which only returns the introduction, this tool returns the entire article organized by sections. Use this for in-depth reading or before indexing into RAG.`,
      inputSchema: getWikipediaFullContentSchema,
      execute: async ({ pageid, title, maxSections }) => {
        logger.log(`📖 [TOOL:getWikipediaFullContent] pageid=${pageid}, title=${title}`);

        if (!pageid && !title) {
          return {
            error: "Provide either pageid or title. Use searchWikipedia first to find articles.",
            article: null,
          };
        }

        try {
          let resolvedPageId = pageid;

          if (!resolvedPageId && title) {
            const searchUrl = `${wikiBase}/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(title)}&srlimit=1&format=json&origin=*`;
            const response = await fetch(searchUrl, { signal: AbortSignal.timeout(15_000) });
            const raw: unknown = await response.json();
            const parsed = WikipediaSearchApiResponseSchema.safeParse(raw);
            resolvedPageId = parsed.success ? parsed.data.query?.search?.[0]?.pageid : undefined;

            if (!resolvedPageId) {
              return {
                error: `Article "${title}" not found. Use searchWikipedia to find valid articles first.`,
                article: null,
              };
            }
          }

          const url = `${wikiBase}/w/api.php?action=query&format=json&pageids=${resolvedPageId}&prop=extracts|info|categories&explaintext=1&exsectionformat=wiki&inprop=url&cllimit=10&origin=*`;

          const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
          const raw: unknown = await response.json();
          const parsed = WikipediaFullContentResponseSchema.safeParse(raw);
          if (!parsed.success) {
            return {
              error: "Invalid Wikipedia response. Try again with a different pageid or title.",
              article: null,
            };
          }
          const data = parsed.data;

          const pageData = data.query?.pages?.[String(resolvedPageId)];
          if (!pageData) {
            return {
              error: "Article not found. Use searchWikipedia to find valid articles first.",
              article: null,
            };
          }

          const fullText = pageData.extract || "";
          const categories = pageData.categories?.map((c) => c.title.replace(catPrefix, "")) || [];

          const sections = parseWikiSections(fullText).slice(0, maxSections);

          logger.log(
            `✅ [TOOL:getWikipediaFullContent] "${pageData.title}": ${fullText.length} chars, ${sections.length} sections`,
          );

          return {
            article: {
              pageid: resolvedPageId,
              title: pageData.title,
              url: pageData.canonicalurl,
              categories,
              totalChars: fullText.length,
              sectionsCount: sections.length,
              sections: sections.map((s) => ({
                title: s.title,
                level: s.level,
                content: s.content,
                charCount: s.content.length,
              })),
            },
          };
        } catch (error) {
          logger.error(`❌ [TOOL:getWikipediaFullContent] Error:`, error);
          return {
            error: "Failed to retrieve full Wikipedia content. Try again or use searchWeb instead.",
            article: null,
          };
        }
      },
    }),

    searchWikipediaRAG: tool({
      description: `Performs semantic search ONLY across Wikipedia articles already indexed in pgvector. Uses text-embedding-3-small (1536D) embeddings to find the most relevant passages. DIFFERENT from searchRagChunks: this searches ONLY Wikipedia sources. Use indexWikipediaToRAG first to index articles before searching them.`,
      inputSchema: searchWikipediaRAGSchema,
      execute: async ({ query, limit, threshold }) => {
        logger.log(`🔍 [TOOL:searchWikipediaRAG] query="${query}", limit=${limit}`);

        try {
          const queryEmbedding = await ragSystem.embeddingService.generateEmbedding(query);
          const embeddingStr = `[${queryEmbedding.join(",")}]`;
          const vectorCast = Prisma.raw(`'${embeddingStr}'::vector`);
          const safeLimit = Math.max(1, Math.floor(limit * 2));

          const results = await prismaEmbeddings.$queryRaw<
            Array<{
              id: string;
              clean_content: string;
              section_title: string | null;
              similarity: number;
              source_id: string;
              source_title: string;
              source_url: string | null;
            }>
          >`
            SELECT
              c.id,
              c.clean_content,
              c.section_title,
              1 - (c.embedding <=> ${vectorCast}) as similarity,
              s.id as source_id,
              s.title as source_title,
              s.original_url as source_url
            FROM rag_chunks c
            JOIN rag_sources s ON c.source_id = s.id
            WHERE s.source_type = 'WIKIPEDIA'
              AND s.status = 'COMPLETED'
              AND (s.is_global = true OR (s.user_id = ${ctx.userId} AND s.workspace_id = ${ctx.workspaceId}))
              AND 1 - (c.embedding <=> ${vectorCast}) >= ${threshold}
            ORDER BY c.embedding <=> ${vectorCast}
            LIMIT ${safeLimit}
          `;

          const seen = new Set<string>();
          const uniqueResults = results
            .filter((r) => {
              const key = r.clean_content.slice(0, 100);
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            })
            .slice(0, limit);

          logger.log(`✅ [TOOL:searchWikipediaRAG] ${uniqueResults.length} Wikipedia chunks found`);

          return {
            count: uniqueResults.length,
            model: `${MODELS.EMBEDDING} (${EMBEDDING_DIMENSION}D)`,
            chunks: uniqueResults.map((r) => ({
              content: r.clean_content,
              section: r.section_title,
              similarity: Math.round(r.similarity * 1000) / 1000,
              source: {
                id: r.source_id,
                title: r.source_title,
                url: r.source_url,
              },
            })),
          };
        } catch (error) {
          logger.error(`❌ [TOOL:searchWikipediaRAG] Error:`, error);
          return {
            error:
              "Wikipedia RAG search failed. Ensure articles are indexed first with indexWikipediaToRAG.",
            count: 0,
            chunks: [],
          };
        }
      },
    }),

    listWikipediaRAGSources: tool({
      description: `Lists all Wikipedia articles already indexed in pgvector. Use this tool to see which articles are available for semantic search before using searchWikipediaRAG. Returns title, chunk count, and indexing date.`,
      inputSchema: listWikipediaRAGSourcesSchema,
      execute: async ({ limit }) => {
        logger.log(`📋 [TOOL:listWikipediaRAGSources] limit=${limit}`);

        try {
          const sources = await prismaEmbeddings.rAGSource.findMany({
            where: {
              sourceType: "WIKIPEDIA",
              status: "COMPLETED",
              OR: [{ isGlobal: true }, { userId: ctx.userId, workspaceId: ctx.workspaceId }],
            },
            select: {
              id: true,
              title: true,
              totalChunks: true,
              originalUrl: true,
              createdAt: true,
              isGlobal: true,
            },
            orderBy: { createdAt: "desc" },
            take: limit,
          });

          logger.log(
            `✅ [TOOL:listWikipediaRAGSources] ${sources.length} indexed Wikipedia articles`,
          );

          return {
            count: sources.length,
            sources: sources.map((s) => ({
              id: s.id,
              title: s.title,
              chunks: s.totalChunks || 0,
              url: s.originalUrl,
              isGlobal: s.isGlobal,
              indexedAt: s.createdAt.toISOString(),
            })),
          };
        } catch (error) {
          logger.error(`❌ [TOOL:listWikipediaRAGSources] Error:`, error);
          return {
            error: "Failed to list Wikipedia sources. Try again.",
            count: 0,
            sources: [],
          };
        }
      },
    }),
  };
}

/**
 * Parses Wikipedia text into sections
 */
function parseWikiSections(
  fullText: string,
): Array<{ title: string; content: string; level: number }> {
  const sections: Array<{ title: string; content: string; level: number }> = [];
  const lines = fullText.split("\n");

  let introContent = "";
  let currentSection: { title: string; content: string; level: number } | null = null;
  let foundFirstSection = false;

  for (const line of lines) {
    const sectionMatch = line.match(/^(={2,6})\s*(.*?)\s*\1$/);

    if (sectionMatch) {
      foundFirstSection = true;

      if (currentSection?.content.trim()) {
        sections.push({
          ...currentSection,
          content: currentSection.content.trim(),
        });
      }

      currentSection = {
        title: sectionMatch[2].trim(),
        content: "",
        level: sectionMatch[1].length - 1,
      };
    } else {
      if (!foundFirstSection) {
        introContent += line + "\n";
      } else if (currentSection) {
        currentSection.content += line + "\n";
      }
    }
  }

  if (currentSection?.content.trim()) {
    sections.push({
      ...currentSection,
      content: currentSection.content.trim(),
    });
  }

  if (introContent.trim().length > 50) {
    sections.unshift({
      title: "Introduction",
      content: introContent.trim(),
      level: 1,
    });
  }

  return sections.filter((s) => s.content.length > 30);
}
