// 🌐 Web Tools - Vercel AI SDK Format with OpenAI Web Search
import { tool } from "ai";
import { z } from "zod";
import OpenAI from "openai";
import { logger } from "../../../utils/logger.js";
import { MODELS } from "../../../config/models.js";

/**
 * User context injected via closure
 */
export interface WebToolsContext {
  userId: string;
  workspaceId: string;
  language?: string;
}

/**
 * Maps common language names to Wikipedia language codes.
 */
export function mapLanguageToWikiCode(language: string | undefined): string {
  if (!language) return "fr";

  const normalized = language.trim().toLowerCase();

  const mapping: Record<string, string> = {
    français: "fr",
    french: "fr",
    fr: "fr",
    english: "en",
    anglais: "en",
    en: "en",
    español: "es",
    spanish: "es",
    espagnol: "es",
    es: "es",
    中文: "zh",
    chinese: "zh",
    chinois: "zh",
    zh: "zh",
    deutsch: "de",
    german: "de",
    allemand: "de",
    de: "de",
    italiano: "it",
    italian: "it",
    italien: "it",
    it: "it",
    português: "pt",
    portuguese: "pt",
    portugais: "pt",
    pt: "pt",
    日本語: "ja",
    japanese: "ja",
    japonais: "ja",
    ja: "ja",
    العربية: "ar",
    arabic: "ar",
    arabe: "ar",
    ar: "ar",
  };

  return mapping[normalized] ?? "fr";
}

// OpenAI client for Responses API calls
const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const searchWebSchema = z.object({
  query: z.string().min(3).describe("Web search query"),
  searchContextSize: z
    .enum(["low", "medium", "high"])
    .optional()
    .default("medium")
    .describe("Search depth (high = more results)"),
});

const searchWikipediaSchema = z.object({
  query: z.string().min(2).describe("Search term"),
  limit: z.number().min(1).max(10).optional().default(5).describe("Maximum number of results"),
});

const getWikipediaArticleSchema = z.object({
  pageid: z.number().optional().describe("Wikipedia page ID"),
  title: z.string().optional().describe("Article title (if no pageid)"),
});

const WikipediaSearchResponseSchema = z
  .object({
    query: z
      .object({
        search: z
          .array(
            z.object({
              pageid: z.number(),
              title: z.string(),
              snippet: z.string(),
            }),
          )
          .optional(),
      })
      .optional(),
  })
  .passthrough();

const WikipediaArticleResponseSchema = z
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
                fullurl: z.string().optional(),
                categories: z.array(z.object({ title: z.string() })).optional(),
                missing: z.boolean().optional(),
              })
              .passthrough(),
          )
          .optional(),
      })
      .optional(),
  })
  .passthrough();

/**
 * Creates Web tools with user context
 */
export function createWebTools(ctx: WebToolsContext) {
  const wikiLang = mapLanguageToWikiCode(ctx.language);
  const wikiBase = `https://${wikiLang}.wikipedia.org`;

  return {
    searchWeb: tool({
      description: `Searches the web for current information using OpenAI Web Search. Use this tool when you need up-to-date facts, recent events, or information not available in the user's RAG sources. Returns an answer with cited sources.`,
      inputSchema: searchWebSchema,
      execute: async ({ query, searchContextSize }) => {
        logger.log(`🔍 [TOOL:searchWeb] query="${query}", contextSize=${searchContextSize}`);

        if (!process.env.OPENAI_API_KEY) {
          logger.warn(`⚠️ [TOOL:searchWeb] OPENAI_API_KEY not configured`);
          return {
            error:
              "Web search unavailable (missing API key). Use RAG sources or Wikipedia tools instead.",
            results: [],
            answer: null,
          };
        }

        try {
          const response = await openaiClient.responses.create({
            model: MODELS.WEB_SEARCH,
            input: query,
            tools: [
              {
                type: "web_search_preview",
                search_context_size: searchContextSize,
              },
            ],
          });

          let answerText = "";
          const sources: Array<{
            title: string;
            url: string;
            snippet?: string;
          }> = [];

          if (response.output) {
            for (const item of response.output) {
              if (item.type === "message" && item.content) {
                for (const content of item.content) {
                  if (content.type === "output_text") {
                    answerText = content.text;
                    if (content.annotations) {
                      for (const annotation of content.annotations) {
                        if (annotation.type === "url_citation") {
                          sources.push({
                            title: annotation.title || annotation.url,
                            url: annotation.url,
                            snippet: undefined,
                          });
                        }
                      }
                    }
                  }
                }
              }
            }
          }

          logger.log(`✅ [TOOL:searchWeb] Got response with ${sources.length} sources`);

          return {
            count: sources.length,
            answer: answerText,
            sources: sources.map((s) => ({
              title: s.title,
              url: s.url,
              content: s.snippet || "",
            })),
          };
        } catch (error) {
          logger.error(`❌ [TOOL:searchWeb] Error:`, error);
          return {
            error: "Web search failed. Try rephrasing your query or use Wikipedia tools instead.",
            results: [],
            answer: null,
          };
        }
      },
    }),

    searchWikipedia: tool({
      description: `Searches Wikipedia articles in the user's preferred language. Use this tool for encyclopedic reference information, definitions, or background knowledge on a topic. Returns titles and snippets of matching articles.`,
      inputSchema: searchWikipediaSchema,
      execute: async ({ query, limit }) => {
        logger.log(`🔍 [TOOL:searchWikipedia] query="${query}", limit=${limit}, lang=${wikiLang}`);

        try {
          const searchUrl = `${wikiBase}/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=${limit}&format=json&origin=*`;

          const response = await fetch(searchUrl, { signal: AbortSignal.timeout(15_000) });
          const raw: unknown = await response.json();
          const parsed = WikipediaSearchResponseSchema.safeParse(raw);
          if (!parsed.success) {
            return { count: 0, articles: [] };
          }
          const data = parsed.data;

          const results = data.query?.search || [];

          logger.log(`✅ [TOOL:searchWikipedia] ${results.length} articles found`);

          return {
            count: results.length,
            articles: results.map((r) => ({
              pageid: r.pageid,
              title: r.title,
              snippet: r.snippet.replace(/<[^>]+>/g, ""),
              url: `${wikiBase}/wiki/${encodeURIComponent(r.title.replace(/ /g, "_"))}`,
            })),
          };
        } catch (error) {
          logger.error(`❌ [TOOL:searchWikipedia] Error:`, error);
          return {
            error:
              "Wikipedia search failed. Try a different query or use searchWeb for broader results.",
            count: 0,
            articles: [],
          };
        }
      },
    }),

    getWikipediaArticle: tool({
      description: `Retrieves the full content of a Wikipedia article by its page ID or title. Use this tool after searchWikipedia to get the complete article extract, categories, and URL.`,
      inputSchema: getWikipediaArticleSchema,
      execute: async ({ pageid, title }) => {
        logger.log(`🔍 [TOOL:getWikipediaArticle] pageid=${pageid}, title=${title}`);

        if (!pageid && !title) {
          return {
            error: "Provide either pageid or title. Use searchWikipedia first to find articles.",
            article: null,
          };
        }

        try {
          const queryParam = pageid ? `pageids=${pageid}` : `titles=${encodeURIComponent(title!)}`;

          const url = `${wikiBase}/w/api.php?action=query&${queryParam}&prop=extracts|categories|info&exintro=1&explaintext=1&inprop=url&cllimit=10&format=json&origin=*`;

          const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
          const raw: unknown = await response.json();
          const parsed = WikipediaArticleResponseSchema.safeParse(raw);
          if (!parsed.success) {
            return {
              error: "Invalid Wikipedia response. Try again with a different pageid or title.",
              article: null,
            };
          }
          const data = parsed.data;

          const pages = data.query?.pages;
          if (!pages) {
            return {
              error: "Article not found. Use searchWikipedia to find valid articles first.",
              article: null,
            };
          }

          const pageKey = Object.keys(pages)[0];
          const page = pages[pageKey];

          if (page.missing) {
            return {
              error: "Article not found. Use searchWikipedia to find valid articles first.",
              article: null,
            };
          }

          logger.log(`✅ [TOOL:getWikipediaArticle] Article "${page.title}" retrieved`);

          // Strip category prefix dynamically based on language
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
            article: {
              pageid: page.pageid,
              title: page.title,
              extract: page.extract || "",
              url:
                page.fullurl ||
                `${wikiBase}/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`,
              categories: (page.categories || []).map((c) => c.title.replace(catPrefix, "")),
            },
          };
        } catch (error) {
          logger.error(`❌ [TOOL:getWikipediaArticle] Error:`, error);
          return {
            error: "Failed to retrieve Wikipedia article. Try again or use searchWeb instead.",
            article: null,
          };
        }
      },
    }),
  };
}
