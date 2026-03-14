import { tool } from "ai";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prismaEmbeddings } from "../../../lib/prismaEmbeddings.js";
import { wikipediaRAG, type WikipediaArticle } from "../../rag/wikipedia.js";
import { ragSystem } from "../../rag/index.js";
import { logger } from "../../../utils/logger.js";
import { MODELS, EMBEDDING_DIMENSION } from "../../../config/models.js";

/**
 * Context utilisateur injecté via closure
 */
interface WikipediaToolsContext {
  userId: string;
  workspaceId: string;
}

// 📋 Schémas Zod pour les tools

const indexWikipediaToRAGSchema = z.object({
  pageid: z.number().optional().describe("ID de la page Wikipedia à indexer"),
  title: z.string().optional().describe("Titre de l'article Wikipedia (si pas de pageid)"),
});

const getWikipediaFullContentSchema = z.object({
  pageid: z.number().optional().describe("ID de la page Wikipedia"),
  title: z.string().optional().describe("Titre de l'article (si pas de pageid)"),
  maxSections: z
    .number()
    .min(1)
    .max(30)
    .optional()
    .default(15)
    .describe("Nombre max de sections à retourner"),
});

const searchWikipediaRAGSchema = z.object({
  query: z.string().min(3).describe("Question ou mots-clés à rechercher"),
  limit: z
    .number()
    .min(1)
    .max(15)
    .optional()
    .default(6)
    .describe("Nombre max de chunks à retourner"),
  threshold: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .default(0.25)
    .describe("Score minimum de similarité (0-1)"),
});

const listWikipediaRAGSourcesSchema = z.object({
  limit: z
    .number()
    .min(1)
    .max(50)
    .optional()
    .default(20)
    .describe("Nombre max de sources à retourner"),
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
 * Crée les tools Wikipedia avec intégration pgvector
 */
export function createWikipediaTools(ctx: WikipediaToolsContext) {
  return {
    /**
     * 🔄 Indexe un article Wikipedia dans pgvector pour recherche sémantique
     */
    indexWikipediaToRAG: tool({
      description: `Indexe un article Wikipedia dans la base vectorielle pgvector.
L'article sera découpé en chunks, chaque chunk recevra un embedding text-embedding-3-small (1536D).
Permet ensuite des recherches sémantiques ultra-précises sur le contenu.
UTILISE CET OUTIL pour stocker des articles Wikipedia importants que tu veux pouvoir rechercher plus tard.
Les articles indexés sont GLOBAUX et partagés entre tous les utilisateurs.`,
      inputSchema: indexWikipediaToRAGSchema,
      execute: async ({ pageid, title }) => {
        logger.log(`🔄 [TOOL:indexWikipediaToRAG] pageid=${pageid}, title=${title}`);

        if (!pageid && !title) {
          return { error: "Fournir soit pageid soit title", indexed: false };
        }

        try {
          // 1. Si on a seulement le titre, rechercher le pageid
          let resolvedPageId = pageid;
          let resolvedTitle = title;

          if (!resolvedPageId && title) {
            const searchUrl = `https://fr.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(title)}&srlimit=1&format=json&origin=*`;
            const response = await fetch(searchUrl);
            const raw: unknown = await response.json();
            const parsed = WikipediaSearchApiResponseSchema.safeParse(raw);
            if (!parsed.success) {
              return {
                error: `Réponse Wikipedia invalide pour la recherche "${title}"`,
                indexed: false,
              };
            }
            const data = parsed.data;

            const firstResult = data.query?.search?.[0];
            if (!firstResult) {
              return {
                error: `Article Wikipedia "${title}" non trouvé`,
                indexed: false,
              };
            }
            resolvedPageId = firstResult.pageid;
            resolvedTitle = firstResult.title;
          }

          // 2. Vérifier si déjà indexé
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
              `♻️ [TOOL:indexWikipediaToRAG] Article déjà indexé: "${existing.title}" (${existing.totalChunks} chunks)`,
            );
            return {
              indexed: true,
              alreadyExists: true,
              sourceId: existing.id,
              title: existing.title,
              chunks: existing.totalChunks,
              message: `Article "${existing.title}" déjà indexé avec ${existing.totalChunks} chunks`,
            };
          }

          // 3. Récupérer l'extrait pour le contexte
          const infoUrl = `https://fr.wikipedia.org/w/api.php?action=query&pageids=${resolvedPageId}&prop=extracts&exintro=1&explaintext=1&format=json&origin=*`;
          const infoResponse = await fetch(infoUrl);
          const infoRaw: unknown = await infoResponse.json();
          const infoParsed = WikipediaIntroExtractResponseSchema.safeParse(infoRaw);
          const pageInfo = infoParsed.success
            ? infoParsed.data.query?.pages?.[String(resolvedPageId)]
            : undefined;
          const extract = pageInfo?.extract || "";
          resolvedTitle = pageInfo?.title || resolvedTitle || "Article Wikipedia";

          // 4. Créer l'objet article pour le système RAG
          const article: WikipediaArticle = {
            pageid: resolvedPageId!,
            title: resolvedTitle,
            extract,
          };

          // 5. Indexer via WikipediaRAGSystem (chunks + embeddings + pgvector)
          logger.log(`📖 [TOOL:indexWikipediaToRAG] Indexation de "${resolvedTitle}"...`);
          const sourceIds = await wikipediaRAG.processWikipediaArticles(
            ctx.userId,
            ctx.workspaceId,
            [article],
          );

          if (sourceIds.length === 0) {
            return {
              error: "Échec de l'indexation",
              indexed: false,
            };
          }

          // 6. Récupérer les stats finales
          const source = await prismaEmbeddings.rAGSource.findUnique({
            where: { id: sourceIds[0] },
            select: { id: true, title: true, totalChunks: true, status: true },
          });

          logger.log(
            `✅ [TOOL:indexWikipediaToRAG] "${resolvedTitle}" indexé avec ${source?.totalChunks || 0} chunks`,
          );

          return {
            indexed: true,
            alreadyExists: false,
            sourceId: source?.id,
            title: source?.title,
            chunks: source?.totalChunks || 0,
            message: `Article "${resolvedTitle}" indexé avec succès (${source?.totalChunks} chunks avec embeddings text-embedding-3-small)`,
          };
        } catch (error) {
          logger.error(`❌ [TOOL:indexWikipediaToRAG] Erreur:`, error);
          return {
            error: "Erreur lors de l'indexation Wikipedia",
            indexed: false,
          };
        }
      },
    }),

    /**
     * 📖 Récupère le contenu complet d'un article Wikipedia avec toutes les sections
     */
    getWikipediaFullContent: tool({
      description: `Récupère le contenu COMPLET d'un article Wikipedia avec toutes ses sections.
Contrairement à getWikipediaArticle qui ne retourne que l'introduction,
cet outil retourne l'article entier organisé par sections.
Idéal pour une lecture approfondie ou avant d'indexer dans RAG.`,
      inputSchema: getWikipediaFullContentSchema,
      execute: async ({ pageid, title, maxSections }) => {
        logger.log(`📖 [TOOL:getWikipediaFullContent] pageid=${pageid}, title=${title}`);

        if (!pageid && !title) {
          return { error: "Fournir soit pageid soit title", article: null };
        }

        try {
          // Résoudre le pageid si on a seulement le titre
          let resolvedPageId = pageid;

          if (!resolvedPageId && title) {
            const searchUrl = `https://fr.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(title)}&srlimit=1&format=json&origin=*`;
            const response = await fetch(searchUrl);
            const raw: unknown = await response.json();
            const parsed = WikipediaSearchApiResponseSchema.safeParse(raw);
            resolvedPageId = parsed.success ? parsed.data.query?.search?.[0]?.pageid : undefined;

            if (!resolvedPageId) {
              return { error: `Article "${title}" non trouvé`, article: null };
            }
          }

          // Récupérer le contenu complet avec sections
          const url = `https://fr.wikipedia.org/w/api.php?action=query&format=json&pageids=${resolvedPageId}&prop=extracts|info|categories&explaintext=1&exsectionformat=wiki&inprop=url&cllimit=10&origin=*`;

          const response = await fetch(url);
          const raw: unknown = await response.json();
          const parsed = WikipediaFullContentResponseSchema.safeParse(raw);
          if (!parsed.success) {
            return { error: "Réponse Wikipedia invalide", article: null };
          }
          const data = parsed.data;

          const pageData = data.query?.pages?.[String(resolvedPageId)];
          if (!pageData) {
            return { error: "Article non trouvé", article: null };
          }

          const fullText = pageData.extract || "";
          const categories =
            pageData.categories?.map((c) => c.title.replace("Catégorie:", "")) || [];

          // Parser les sections
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
          logger.error(`❌ [TOOL:getWikipediaFullContent] Erreur:`, error);
          return { error: "Erreur lors de la récupération", article: null };
        }
      },
    }),

    /**
     * 🔍 Recherche sémantique UNIQUEMENT dans les articles Wikipedia indexés
     */
    searchWikipediaRAG: tool({
      description: `Recherche sémantique dans les articles Wikipedia déjà indexés en pgvector.
Utilise les embeddings text-embedding-3-small (1536D) pour trouver les passages les plus pertinents.
DIFFÉRENT de searchRagChunks: celui-ci cherche UNIQUEMENT dans les sources Wikipedia.
Utilise d'abord indexWikipediaToRAG pour indexer des articles avant de les rechercher.`,
      inputSchema: searchWikipediaRAGSchema,
      execute: async ({ query, limit, threshold }) => {
        logger.log(`🔍 [TOOL:searchWikipediaRAG] query="${query}", limit=${limit}`);

        try {
          // Générer l'embedding de la requête
          const queryEmbedding = await ragSystem.embeddingService.generateEmbedding(query);
          const embeddingStr = `[${queryEmbedding.join(",")}]`;
          // Prisma.raw() pour le cast ::vector (même pattern que ragSystem.search)
          const vectorCast = Prisma.raw(`'${embeddingStr}'::vector`);
          const safeLimit = Math.max(1, Math.floor(limit * 2));

          // Recherche vectorielle UNIQUEMENT sur les sources Wikipedia
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

          // Dédupliquer et limiter
          const seen = new Set<string>();
          const uniqueResults = results
            .filter((r) => {
              const key = r.clean_content.slice(0, 100);
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            })
            .slice(0, limit);

          logger.log(
            `✅ [TOOL:searchWikipediaRAG] ${uniqueResults.length} chunks Wikipedia trouvés`,
          );

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
          logger.error(`❌ [TOOL:searchWikipediaRAG] Erreur:`, error);
          return {
            error: "Erreur lors de la recherche Wikipedia RAG",
            count: 0,
            chunks: [],
          };
        }
      },
    }),

    /**
     * 📋 Liste tous les articles Wikipedia indexés dans pgvector
     */
    listWikipediaRAGSources: tool({
      description: `Liste tous les articles Wikipedia déjà indexés dans pgvector.
Utile pour voir quels articles sont disponibles pour la recherche sémantique.
Retourne le titre, nombre de chunks, et date d'indexation.`,
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
            `✅ [TOOL:listWikipediaRAGSources] ${sources.length} articles Wikipedia indexés`,
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
          logger.error(`❌ [TOOL:listWikipediaRAGSources] Erreur:`, error);
          return {
            error: "Erreur lors de la récupération",
            count: 0,
            sources: [],
          };
        }
      },
    }),
  };
}

/**
 * Parse le texte Wikipedia en sections
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

  // Ajouter l'introduction comme première section
  if (introContent.trim().length > 50) {
    sections.unshift({
      title: "Introduction",
      content: introContent.trim(),
      level: 1,
    });
  }

  return sections.filter((s) => s.content.length > 30);
}
