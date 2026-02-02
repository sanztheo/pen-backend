import { Request, Response } from "express";
import fetch from "node-fetch";
import { z } from "zod";

export interface WikipediaArticle {
  title: string;
  pageid: number;
  extract: string;
  url: string;
  categories?: string[];
  fullContent?: string;
}

interface WikipediaSearchResult {
  articles: WikipediaArticle[];
  totalFound: number;
}

// Wikipedia API Response Interfaces
interface WikipediaSearchItem {
  pageid: number;
  title: string;
  snippet?: string;
  size?: number;
  wordcount?: number;
  timestamp?: string;
}

interface WikipediaSearchInfo {
  totalhits?: number;
}

interface WikipediaSearchResponse {
  query?: {
    search?: WikipediaSearchItem[];
    searchinfo?: WikipediaSearchInfo;
  };
}

interface WikipediaCategory {
  title: string;
}

interface WikipediaPageData {
  pageid: number;
  title: string;
  extract?: string;
  fullurl?: string;
  missing?: boolean;
  categories?: WikipediaCategory[];
}

interface WikipediaPagesMap {
  [pageId: string]: WikipediaPageData;
}

interface WikipediaExtractResponse {
  query?: {
    pages?: WikipediaPagesMap;
  };
}

interface WikipediaCategoryMember {
  pageid: number;
  title: string;
}

interface WikipediaCategoryMembersResponse {
  query?: {
    categorymembers?: WikipediaCategoryMember[];
  };
}

const WikipediaCategoryMembersResponseSchema: z.ZodType<WikipediaCategoryMembersResponse> =
  z
    .object({
      query: z
        .object({
          categorymembers: z
            .array(z.object({ pageid: z.number(), title: z.string() }))
            .optional(),
        })
        .optional(),
    })
    .passthrough();

const WikipediaExtractResponseSchema: z.ZodType<WikipediaExtractResponse> = z
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
                missing: z.boolean().optional(),
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
 * Recherche des articles sur Wikipedia via l'API MediaWiki
 */
export const wikipediaSearch = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { q: query, lang = "fr", limit = 10 } = req.query;

    if (!query || typeof query !== "string") {
      res.status(400).json({ error: "Paramètre de recherche requis" });
      return;
    }

    const searchQuery = query.trim();
    if (searchQuery.length === 0) {
      res.json({ articles: [], totalFound: 0 });
      return;
    }

    console.log(
      `🔍 [WikipediaSearch] Recherche: "${searchQuery}" (lang: ${lang})`,
    );

    // Étape 1: Rechercher les articles
    const searchUrl =
      `https://${lang}.wikipedia.org/w/api.php?` +
      new URLSearchParams({
        action: "query",
        list: "search",
        srsearch: searchQuery,
        format: "json",
        srlimit: String(Math.min(Number(limit) || 10, 20)), // Maximum 20 résultats
        srprop: "snippet|titlesnippet|size|wordcount|timestamp",
        origin: "*", // Pour les requêtes CORS
      }).toString();

    console.log(`📡 [WikipediaSearch] URL de recherche: ${searchUrl}`);

    const searchResponse = await fetch(searchUrl, {
      headers: {
        "User-Agent": "PenSaaS/1.0 (https://example.com/contact) Research Tool",
      },
    });

    if (!searchResponse.ok) {
      throw new Error(`Erreur API Wikipedia: ${searchResponse.status}`);
    }

    const searchData = (await searchResponse.json()) as WikipediaSearchResponse;

    if (!searchData.query?.search) {
      console.log(
        `⚠️ [WikipediaSearch] Aucun résultat trouvé pour: "${searchQuery}"`,
      );
      res.json({ articles: [], totalFound: 0 });
      return;
    }

    const searchResults = searchData.query.search;
    console.log(
      `📊 [WikipediaSearch] ${searchResults.length} résultats trouvés`,
    );

    // Étape 2: Récupérer les extraits des articles les plus pertinents
    const pageIds = searchResults
      .slice(0, Math.min(searchResults.length, 10))
      .map((r: WikipediaSearchItem) => r.pageid);

    const extractUrl =
      `https://${lang}.wikipedia.org/w/api.php?` +
      new URLSearchParams({
        action: "query",
        prop: "extracts|info",
        pageids: pageIds.join("|"),
        format: "json",
        exintro: "1", // Seulement l'introduction
        explaintext: "1", // Texte brut sans HTML
        exsectionformat: "plain",
        exchars: "500", // Limite à 500 caractères
        inprop: "url",
        origin: "*",
      }).toString();

    console.log(`📖 [WikipediaSearch] URL des extraits: ${extractUrl}`);

    const extractResponse = await fetch(extractUrl, {
      headers: {
        "User-Agent": "PenSaaS/1.0 (https://example.com/contact) Research Tool",
      },
    });

    if (!extractResponse.ok) {
      throw new Error(
        `Erreur API Wikipedia extraits: ${extractResponse.status}`,
      );
    }

    const extractData =
      (await extractResponse.json()) as WikipediaExtractResponse;
    const pages: WikipediaPagesMap = extractData.query?.pages || {};

    // Étape 3: Combiner les résultats de recherche avec les extraits
    const articles: WikipediaArticle[] = [];

    for (const searchResult of searchResults.slice(0, 10)) {
      const pageData = pages[searchResult.pageid];

      if (pageData && !pageData.missing) {
        const article: WikipediaArticle = {
          title: pageData.title || searchResult.title,
          pageid: searchResult.pageid,
          extract:
            pageData.extract ||
            searchResult.snippet?.replace(/<[^>]*>/g, "") ||
            "",
          url:
            pageData.fullurl ||
            `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(pageData.title || searchResult.title)}`,
        };

        // Nettoyer l'extrait
        article.extract = article.extract
          .replace(/<[^>]*>/g, "") // Supprimer les balises HTML
          .replace(/\s+/g, " ") // Normaliser les espaces
          .trim();

        if (article.extract.length > 400) {
          article.extract = article.extract.substring(0, 400).trim() + "...";
        }

        articles.push(article);
        console.log(
          `✅ [WikipediaSearch] Article ajouté: "${article.title}" (${article.extract.length} chars)`,
        );
      }
    }

    const result: WikipediaSearchResult = {
      articles,
      totalFound: searchData.query?.searchinfo?.totalhits || articles.length,
    };

    console.log(
      `🎯 [WikipediaSearch] Retour de ${articles.length} articles pour "${searchQuery}"`,
    );
    res.json(result);
  } catch (error) {
    console.error("❌ [WikipediaSearch] Erreur:", error);
    res.status(500).json({
      error: "Erreur lors de la recherche Wikipedia",
      details: error instanceof Error ? error.message : "Erreur inconnue",
    });
  }
};

/**
 * Récupère le contenu enrichi d'articles Wikipedia avec catégories et contenu selon le mode
 */
export const wikipediaGetEnrichedArticles = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { pageIds, mode = "ask", query, lang = "fr" } = req.body;

    if (!pageIds || !Array.isArray(pageIds)) {
      res.status(400).json({ error: "Liste des pageIds requise" });
      return;
    }

    console.log(
      `🔍 [WikipediaEnriched] Mode: ${mode}, Pages: ${pageIds.length}, Query: "${query}"`,
    );

    // Déterminer les limites de caractères selon le mode
    const limits = {
      ask: 3000,
      search: 30000,
      create: 3000,
    };

    // Pour le mode create, vérifier le paramètre reflection
    let charLimit = limits[mode as keyof typeof limits] || 3000;
    if (mode === "create" && req.body.reflection === "profond") {
      charLimit = 30000;
    }
    console.log(`📏 [WikipediaEnriched] Limite caractères: ${charLimit}`);

    const articles: WikipediaArticle[] = [];

    for (const pageId of pageIds) {
      // Récupérer le contenu principal + catégories
      const contentParams = new URLSearchParams({
        action: "query",
        prop: "extracts|categories|info",
        pageids: String(pageId),
        format: "json",
        explaintext: "1",
        exsectionformat: "plain",
        exchars: String(charLimit),
        exintro: charLimit > 5000 ? "0" : "1", // Si plus de 5K chars, prendre tout l'article, pas juste l'intro
        clshow: "!hidden", // Exclure les catégories cachées
        cllimit: "50", // Maximum 50 catégories
        inprop: "url",
        origin: "*",
      });

      const contentUrl = `https://${lang}.wikipedia.org/w/api.php?${contentParams}`;

      const contentResponse = await fetch(contentUrl, {
        headers: {
          "User-Agent":
            "PenSaaS/1.0 (https://example.com/contact) Research Tool",
        },
      });

      if (!contentResponse.ok) {
        console.error(
          `❌ Erreur récupération article ${pageId}: ${contentResponse.status}`,
        );
        continue;
      }

      const contentData =
        (await contentResponse.json()) as WikipediaExtractResponse;
      const pageData = contentData.query?.pages?.[pageId];

      if (!pageData || pageData.missing) {
        console.warn(`⚠️ Article ${pageId} non trouvé`);
        continue;
      }

      // Extraire les catégories
      const categories =
        pageData.categories?.map((cat: WikipediaCategory) =>
          cat.title.replace("Catégorie:", "").replace("Category:", ""),
        ) || [];

      console.log(
        `📂 [${pageData.title}] ${categories.length} catégories trouvées:`,
        categories.slice(0, 5),
      );

      // Pour les modes research/create profond, analyser les catégories pertinentes
      let relevantCategories: string[] = [];
      let categoryContent = "";

      if (
        mode === "search" ||
        (mode === "create" && req.body.reflection === "profond")
      ) {
        relevantCategories = await analyzeRelevantCategories(
          categories,
          query || "",
        );
        console.log(
          `🎯 [${pageData.title}] ${relevantCategories.length} catégories pertinentes sélectionnées`,
        );

        // Récupérer le contenu des catégories pertinentes
        if (relevantCategories.length > 0) {
          categoryContent = await getCategoryContent(
            relevantCategories,
            lang,
            Math.floor(charLimit * 0.2),
          );
          console.log(
            `📖 [${pageData.title}] Contenu des catégories: ${categoryContent.length} chars`,
          );
        } else {
          console.log(
            `⚠️ [${pageData.title}] Aucune catégorie pertinente, utilisation de toutes les catégories`,
          );
          relevantCategories = categories.slice(0, 8);
          if (relevantCategories.length > 0) {
            categoryContent = await getCategoryContent(
              relevantCategories,
              lang,
              Math.floor(charLimit * 0.2),
            );
          }
        }
      }

      const article: WikipediaArticle = {
        title: pageData.title,
        pageid: pageData.pageid,
        extract: pageData.extract || "",
        url:
          pageData.fullurl ||
          `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(pageData.title)}`,
        categories:
          relevantCategories.length > 0
            ? relevantCategories
            : categories.slice(0, 10),
        fullContent: categoryContent
          ? `${pageData.extract}\n\n=== Contenu des catégories pertinentes ===\n${categoryContent}`
          : pageData.extract,
      };

      articles.push(article);
      console.log(
        `✅ [WikipediaEnriched] Article traité: "${article.title}" (${article.fullContent?.length || 0} chars)`,
      );
    }

    res.json({ articles, mode, totalProcessed: articles.length });
  } catch (error) {
    console.error("❌ [WikipediaEnriched] Erreur:", error);
    res.status(500).json({
      error: "Erreur lors de la récupération enrichie Wikipedia",
      details: error instanceof Error ? error.message : "Erreur inconnue",
    });
  }
};

/**
 * Analyse les catégories pertinentes par rapport à la query avec une IA simple
 */
async function analyzeRelevantCategories(
  categories: string[],
  query: string,
): Promise<string[]> {
  if (categories.length === 0) return [];

  // Si pas de query, prendre les catégories les plus importantes
  if (!query || query.length < 3) {
    return categories.slice(0, 8);
  }

  console.log(`🧠 Analyse de ${categories.length} catégories pour: "${query}"`);

  // IA améliorée basée sur les mots-clés et le contexte
  const queryWords = query
    .toLowerCase()
    .replace(/[^\w\sàâäéèêëîïôöùûüÿç]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);

  const relevantCategories: Array<{ category: string; score: number }> = [];

  categories.forEach((category) => {
    const categoryLower = category.toLowerCase();
    let score = 0;

    // Correspondance directe avec les mots de la query
    queryWords.forEach((word) => {
      if (categoryLower.includes(word)) {
        score += 5; // Correspondance directe
      } else if (
        categoryLower.includes(word.substring(0, Math.max(3, word.length - 1)))
      ) {
        score += 2; // Correspondance partielle
      }

      // Synonymes et mots-clés liés
      const synonyms: { [key: string]: string[] } = {
        guerre: [
          "conflit",
          "bataille",
          "militaire",
          "combat",
          "armée",
          "stratégie",
        ],
        physique: [
          "science",
          "théorie",
          "loi",
          "principe",
          "quantum",
          "relativité",
        ],
        histoire: [
          "historique",
          "chronologie",
          "époque",
          "siècle",
          "ancien",
          "événement",
        ],
        politique: ["gouvernement", "état", "pouvoir", "société", "social"],
      };

      Object.entries(synonyms).forEach(([key, syns]) => {
        if (word.includes(key) || key.includes(word)) {
          syns.forEach((syn) => {
            if (categoryLower.includes(syn)) {
              score += 3;
            }
          });
        }
      });
    });

    // Bonus pour les catégories importantes et générales
    const importantKeywords = [
      "histoire",
      "politique",
      "science",
      "physique",
      "mathématiques",
      "géographie",
      "économie",
      "société",
      "culture",
      "art",
      "littérature",
      "philosophie",
      "guerre",
      "conflit",
      "militaire",
      "stratégie",
      "bataille",
      "armée",
      "théorie",
      "principe",
      "loi",
      "concept",
      "définition",
    ];

    importantKeywords.forEach((keyword) => {
      if (categoryLower.includes(keyword)) {
        score += 3;
      }
    });

    // Éviter les catégories trop spécifiques ou administratives
    const excludePatterns = [
      "maintenance",
      "ébauche",
      "homonymie",
      "redirection",
      "page",
      "projet",
      "portail",
      "catégorie",
      "modèle",
      "utilisateur",
    ];

    const shouldExclude = excludePatterns.some((pattern) =>
      categoryLower.includes(pattern),
    );

    if (!shouldExclude && score > 0) {
      relevantCategories.push({ category, score });
      console.log(`📝 Catégorie "${category}": score ${score}`);
    }
  });

  // Trier par score et prendre les 8 meilleures
  relevantCategories.sort((a, b) => b.score - a.score);
  const selected = relevantCategories.slice(0, 8).map((item) => item.category);

  console.log(`🎯 ${selected.length} catégories sélectionnées:`, selected);
  return selected;
}

/**
 * Récupère le contenu des catégories sélectionnées
 */
async function getCategoryContent(
  categories: string[],
  lang: string,
  maxChars: number,
): Promise<string> {
  const contents: string[] = [];
  let totalChars = 0;

  for (const category of categories) {
    if (totalChars >= maxChars) break;

    try {
      const params = new URLSearchParams({
        action: "query",
        list: "categorymembers",
        cmtitle: `${lang === "fr" ? "Catégorie" : "Category"}:${category}`,
        format: "json",
        cmlimit: "5", // 5 articles par catégorie
        cmtype: "page",
        origin: "*",
      });

      const url = `https://${lang}.wikipedia.org/w/api.php?${params}`;
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "PenSaaS/1.0 (https://example.com/contact) Research Tool",
        },
      });

      if (!response.ok) continue;

      const raw: unknown = await response.json();
      const parsed = WikipediaCategoryMembersResponseSchema.safeParse(raw);
      if (!parsed.success) continue;
      const data = parsed.data;
      const members = data.query?.categorymembers || [];

      if (members.length > 0) {
        const memberTitles = members
          .slice(0, 3)
          .map((m: WikipediaCategoryMember) => `• ${m.title}`)
          .join("\n");
        const categorySection = `\n**${category}**:\n${memberTitles}\n`;

        if (totalChars + categorySection.length <= maxChars) {
          contents.push(categorySection);
          totalChars += categorySection.length;
        }
      }
    } catch (error) {
      console.error(`Erreur récupération catégorie ${category}:`, error);
    }
  }

  return contents.join("");
}

/**
 * Récupère le contenu complet d'un article Wikipedia (fonction legacy)
 */
export const wikipediaGetArticle = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { pageid, title, lang = "fr" } = req.query;

    if (!pageid && !title) {
      res.status(400).json({ error: "Paramètre pageid ou title requis" });
      return;
    }

    console.log(
      `📄 [WikipediaGetArticle] Récupération: pageid=${pageid}, title=${title} (lang: ${lang})`,
    );

    let params: Record<string, string> = {
      action: "query",
      prop: "extracts|info",
      format: "json",
      explaintext: "1",
      exsectionformat: "plain",
      inprop: "url",
      origin: "*",
    };

    if (pageid) {
      params.pageids = String(pageid);
    } else {
      params.titles = String(title);
    }

    const url =
      `https://${lang}.wikipedia.org/w/api.php?` +
      new URLSearchParams(params).toString();

    const response = await fetch(url, {
      headers: {
        "User-Agent": "PenSaaS/1.0 (https://example.com/contact) Research Tool",
      },
    });

    if (!response.ok) {
      throw new Error(`Erreur API Wikipedia: ${response.status}`);
    }

    const raw: unknown = await response.json();
    const parsed = WikipediaExtractResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error("Réponse API Wikipedia invalide (query.pages)");
    }
    const data = parsed.data;
    const pages: WikipediaPagesMap = data.query?.pages || {};
    const pagesArray = Object.values(pages);
    const pageData: WikipediaPageData | undefined = pagesArray[0];

    if (!pageData || pageData.missing) {
      res.status(404).json({ error: "Article non trouvé" });
      return;
    }

    const article: WikipediaArticle = {
      title: pageData.title,
      pageid: pageData.pageid,
      extract: pageData.extract || "",
      url:
        pageData.fullurl ||
        `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(pageData.title)}`,
    };

    console.log(
      `✅ [WikipediaGetArticle] Article récupéré: "${article.title}" (${article.extract.length} chars)`,
    );
    res.json({ article });
  } catch (error) {
    console.error("❌ [WikipediaGetArticle] Erreur:", error);
    res.status(500).json({
      error: "Erreur lors de la récupération de l'article Wikipedia",
      details: error instanceof Error ? error.message : "Erreur inconnue",
    });
  }
};
