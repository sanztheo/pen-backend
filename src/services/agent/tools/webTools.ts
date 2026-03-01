// 🌐 Web Tools - Vercel AI SDK Format avec OpenAI Web Search
import { tool } from "ai";
import { z } from "zod";
import OpenAI from "openai";
import { logger } from "../../../utils/logger.js";
import { MODELS } from "../../../config/models.js";

/**
 * Context utilisateur injecté via closure
 */
interface WebToolsContext {
  userId: string;
  workspaceId: string;
}

// Client OpenAI pour les appels Responses API
const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Définition des schémas Zod pour chaque tool
const searchWebSchema = z.object({
  query: z.string().min(3).describe("Requête de recherche web"),
  searchContextSize: z
    .enum(["low", "medium", "high"])
    .optional()
    .default("medium")
    .describe("Profondeur de recherche (high = plus de résultats)"),
});

const searchWikipediaSchema = z.object({
  query: z.string().min(2).describe("Terme de recherche"),
  limit: z.number().min(1).max(10).optional().default(5).describe("Nombre max de résultats"),
});

const getWikipediaArticleSchema = z.object({
  pageid: z.number().optional().describe("ID de la page Wikipedia"),
  title: z.string().optional().describe("Titre de l'article (si pas de pageid)"),
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
 * Crée les tools Web avec le contexte utilisateur
 */
export function createWebTools(_ctx: WebToolsContext) {
  return {
    /**
     * Recherche sur le web via OpenAI Responses API (web_search_preview)
     */
    searchWeb: tool({
      description: `Effectue une recherche sur le web pour trouver des informations actuelles.
Utilise OpenAI Web Search pour des résultats de qualité avec sources citées.
Idéal pour des questions sur l'actualité, des faits récents, ou des informations non présentes dans les sources RAG.`,
      inputSchema: searchWebSchema,
      execute: async ({ query, searchContextSize }) => {
        logger.log(`🔍 [TOOL:searchWeb] query="${query}", contextSize=${searchContextSize}`);

        if (!process.env.OPENAI_API_KEY) {
          logger.warn(`⚠️ [TOOL:searchWeb] OPENAI_API_KEY non configurée`);
          return {
            error: "Recherche web non disponible (API key manquante)",
            results: [],
            answer: null,
          };
        }

        try {
          // Utiliser l'API Responses avec web_search_preview
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

          // Extraire le texte de la réponse
          let answerText = "";
          const sources: Array<{
            title: string;
            url: string;
            snippet?: string;
          }> = [];

          // Parser la réponse
          if (response.output) {
            for (const item of response.output) {
              if (item.type === "message" && item.content) {
                for (const content of item.content) {
                  if (content.type === "output_text") {
                    answerText = content.text;
                    // Extraire les annotations de sources si disponibles
                    if (content.annotations) {
                      for (const annotation of content.annotations) {
                        if (annotation.type === "url_citation") {
                          sources.push({
                            title: annotation.title || annotation.url,
                            url: annotation.url,
                            snippet: undefined, // URLCitation n'a pas de propriété text
                          });
                        }
                      }
                    }
                  }
                }
              }
            }
          }

          logger.log(`✅ [TOOL:searchWeb] Réponse obtenue avec ${sources.length} sources`);

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
          logger.error(`❌ [TOOL:searchWeb] Erreur:`, error);
          return {
            error: "Erreur lors de la recherche web",
            results: [],
            answer: null,
          };
        }
      },
    }),

    /**
     * Recherche Wikipedia
     */
    searchWikipedia: tool({
      description: `Recherche des articles Wikipedia en français.
Retourne les titres et extraits des articles correspondants.
Utile pour des informations encyclopédiques de référence.`,
      inputSchema: searchWikipediaSchema,
      execute: async ({ query, limit }) => {
        logger.log(`🔍 [TOOL:searchWikipedia] query="${query}", limit=${limit}`);

        try {
          const searchUrl = `https://fr.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=${limit}&format=json&origin=*`;

          const response = await fetch(searchUrl);
          const raw: unknown = await response.json();
          const parsed = WikipediaSearchResponseSchema.safeParse(raw);
          if (!parsed.success) {
            return { count: 0, articles: [] };
          }
          const data = parsed.data;

          const results = data.query?.search || [];

          logger.log(`✅ [TOOL:searchWikipedia] ${results.length} articles trouvés`);

          return {
            count: results.length,
            articles: results.map((r) => ({
              pageid: r.pageid,
              title: r.title,
              snippet: r.snippet.replace(/<[^>]+>/g, ""), // Nettoyer HTML
              url: `https://fr.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, "_"))}`,
            })),
          };
        } catch (error) {
          logger.error(`❌ [TOOL:searchWikipedia] Erreur:`, error);
          return {
            error: "Erreur lors de la recherche Wikipedia",
            count: 0,
            articles: [],
          };
        }
      },
    }),

    /**
     * Récupère le contenu d'un article Wikipedia
     */
    getWikipediaArticle: tool({
      description: `Récupère le contenu complet d'un article Wikipedia par son ID ou titre.
Retourne l'extrait, les catégories, et l'URL de l'article.`,
      inputSchema: getWikipediaArticleSchema,
      execute: async ({ pageid, title }) => {
        logger.log(`🔍 [TOOL:getWikipediaArticle] pageid=${pageid}, title=${title}`);

        if (!pageid && !title) {
          return { error: "Fournir soit pageid soit title", article: null };
        }

        try {
          const queryParam = pageid ? `pageids=${pageid}` : `titles=${encodeURIComponent(title!)}`;

          const url = `https://fr.wikipedia.org/w/api.php?action=query&${queryParam}&prop=extracts|categories|info&exintro=1&explaintext=1&inprop=url&cllimit=10&format=json&origin=*`;

          const response = await fetch(url);
          const raw: unknown = await response.json();
          const parsed = WikipediaArticleResponseSchema.safeParse(raw);
          if (!parsed.success) {
            return { error: "Réponse Wikipedia invalide", article: null };
          }
          const data = parsed.data;

          const pages = data.query?.pages;
          if (!pages) {
            return { error: "Article non trouvé", article: null };
          }

          const pageKey = Object.keys(pages)[0];
          const page = pages[pageKey];

          if (page.missing) {
            return { error: "Article non trouvé", article: null };
          }

          logger.log(`✅ [TOOL:getWikipediaArticle] Article "${page.title}" récupéré`);

          return {
            article: {
              pageid: page.pageid,
              title: page.title,
              extract: page.extract || "",
              url:
                page.fullurl ||
                `https://fr.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`,
              categories: (page.categories || []).map((c) => c.title.replace("Catégorie:", "")),
            },
          };
        } catch (error) {
          logger.error(`❌ [TOOL:getWikipediaArticle] Erreur:`, error);
          return {
            error: "Erreur lors de la récupération de l'article",
            article: null,
          };
        }
      },
    }),
  };
}
