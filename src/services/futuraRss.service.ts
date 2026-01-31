import Parser from "rss-parser";
import { prisma } from "../lib/prisma.js";
import OpenAI from "openai";

// Types pour les articles RSS
interface FuturaArticle {
  title: string;
  description: string;
  link: string;
  pubDate: string;
  content?: string;
  contentSnippet?: string;
  guid?: string;
  enclosure?: {
    url: string;
    type: string;
  };
}

// Type for RSS parser items with optional fields
interface RssItem {
  title?: string;
  description?: string;
  link?: string;
  pubDate?: string;
  content?: string;
  contentSnippet?: string;
  guid?: string;
  enclosure?: {
    url?: string;
    type?: string;
  };
}

// Cache pour les résultats de validation AI éducative
const aiValidationCache = new Map<
  string,
  { isValid: boolean; score: number; reason: string; timestamp: number }
>();
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 heures

// Rate limiting pour l'API OpenAI
let lastAICallTime = 0;
const MIN_CALL_INTERVAL = 3000; // 3 secondes entre chaque appel pour gpt-4.1-nano

export class FuturaRssService {
  private static RSS_URL = "https://www.futura-sciences.com/rss/actualites.xml";
  private static parser = new Parser();

  /**
   * Récupère le contenu complet d'un article depuis sa page web
   * @param url URL de l'article
   * @returns Le contenu complet de l'article avec HTML formaté ou null
   */
  private static async fetchFullArticleContent(
    url: string,
  ): Promise<string | null> {
    try {
      const response = await fetch(url);
      const html = await response.text();

      // 1. Extraire le synopsis (description courte)
      const synopsisMatch = html.match(
        /<div[^>]*class="[^"]*article-synopsis[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      );
      let synopsis = "";
      if (synopsisMatch) {
        synopsis = synopsisMatch[1]
          .replace(/<p[^>]*>/gi, "<p>")
          .replace(/<\/?div[^>]*>/gi, "")
          .replace(/<\/?span[^>]*>/gi, "")
          .trim();
        console.log("📝 Synopsis extracted");
      }

      // 2. Extraire le contenu principal de l'article
      // Trouver le début de la div principale
      const startMatch = html.match(
        /<div[^>]*id="article-anchor-article-main-content"[^>]*>/i,
      );
      if (!startMatch) {
        console.warn("⚠️ Could not find main article content div");
        return synopsis || null;
      }

      const startIndex = html.indexOf(startMatch[0]) + startMatch[0].length;

      // Compter les divs pour trouver la div fermante correcte
      let divCount = 1;
      let endIndex = startIndex;

      while (divCount > 0 && endIndex < html.length) {
        const nextOpenDiv = html.indexOf("<div", endIndex);
        const nextCloseDiv = html.indexOf("</div>", endIndex);

        if (nextCloseDiv === -1) break;

        if (nextOpenDiv !== -1 && nextOpenDiv < nextCloseDiv) {
          divCount++;
          endIndex = nextOpenDiv + 4;
        } else {
          divCount--;
          endIndex = nextCloseDiv + 6;
        }
      }

      if (divCount !== 0) {
        console.warn("⚠️ Could not find matching closing div");
        return synopsis || null;
      }

      let articleContent = html.substring(startIndex, endIndex - 6); // -6 pour enlever </div>

      // 3. Supprimer le sommaire et autres éléments indésirables
      articleContent = articleContent
        // Supprimer le sommaire
        .replace(
          /<div[^>]*class="[^"]*article-summary[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
          "",
        )
        .replace(
          /<div[^>]*class="[^"]*WrapperSummary[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
          "",
        )
        // Supprimer les séparateurs
        .replace(/<hr[^>]*>/gi, "")
        // Supprimer footer, aside, nav
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
        .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, "")
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
        // Supprimer les boutons de partage et autres widgets
        .replace(/<div[^>]*class="[^"]*share[^"]*"[^>]*>[\s\S]*?<\/div>/gi, "")
        .replace(/<div[^>]*class="[^"]*author[^"]*"[^>]*>[\s\S]*?<\/div>/gi, "")
        .replace(/<button[^>]*>[\s\S]*?<\/button>/gi, "");

      // 4. Nettoyer le contenu en gardant les balises importantes
      let cleanContent = articleContent
        // Supprimer les scripts et styles
        .replace(/<script[^>]*>.*?<\/script>/gi, "")
        .replace(/<style[^>]*>.*?<\/style>/gi, "")
        // Supprimer les noscript
        .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "")
        // Convertir les blocs d'images fs-media en figures
        .replace(
          /<div[^>]*class="[^"]*fs-media[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
          (match) => {
            // Extraire le contenu picture avec toutes ses sources
            const pictureMatch = match.match(
              /<picture[^>]*>([\s\S]*?)<\/picture>/i,
            );
            // Extraire la légende
            const legendMatch = match.match(
              /<span[^>]*class="[^"]*fs-legende[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
            );

            if (pictureMatch) {
              const picture = pictureMatch[0];
              const legend = legendMatch
                ? `<figcaption>${legendMatch[1]}</figcaption>`
                : "";
              return `<figure>${picture}${legend}</figure>`;
            }
            return "";
          },
        )
        // Supprimer les div image-wrapper et open-icon-button restantes
        .replace(/<div[^>]*class="[^"]*image-wrapper[^"]*"[^>]*>/gi, "")
        .replace(
          /<div[^>]*class="[^"]*open-icon-button[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
          "",
        )
        // Garder les légendes mais supprimer les autres spans
        .replace(
          /<span[^>]*class="[^"]*tooltip[^"]*"[^>]*>[\s\S]*?<\/span>/gi,
          "",
        )
        .replace(
          /<span[^>]*class="[^"]*wrappers__Span[^"]*"[^>]*>([\s\S]*?)<\/span>/gi,
          "$1",
        )
        // Nettoyer les balises picture en gardant les sources
        .replace(/<picture([^>]*)>/gi, "<picture>")
        // Supprimer les attributs inutiles mais garder src/srcset/media pour images/vidéos et href pour liens
        .replace(
          /<(h1|h2|h3|h4|p|img|video|iframe|ul|ol|li|blockquote|figure|figcaption|a|source)([^>]*)>/gi,
          (_match, tag, attrs) => {
            // Pour les sources (dans picture), garder media, srcset, sizes
            if (tag === "source") {
              const mediaMatch = attrs.match(/media="([^"]*)"/i);
              const srcsetMatch = attrs.match(/srcset="([^"]*)"/i);
              const sizesMatch = attrs.match(/sizes="([^"]*)"/i);
              const media = mediaMatch ? ` media="${mediaMatch[1]}"` : "";
              const srcset = srcsetMatch ? ` srcset="${srcsetMatch[1]}"` : "";
              const sizes = sizesMatch ? ` sizes="${sizesMatch[1]}"` : "";
              return `<${tag}${media}${srcset}${sizes}>`;
            }
            // Pour les images, garder src, srcset, alt, title, loading
            if (tag === "img") {
              const srcMatch = attrs.match(/src="([^"]*)"/i);
              const srcsetMatch = attrs.match(/srcset="([^"]*)"/i);
              const altMatch = attrs.match(/alt="([^"]*)"/i);
              const titleMatch = attrs.match(/title="([^"]*)"/i);
              const loadingMatch = attrs.match(/loading="([^"]*)"/i);
              const src = srcMatch ? ` src="${srcMatch[1]}"` : "";
              const srcset = srcsetMatch ? ` srcset="${srcsetMatch[1]}"` : "";
              const alt = altMatch
                ? ` alt="${altMatch[1]}"`
                : titleMatch
                  ? ` alt="${titleMatch[1]}"`
                  : "";
              const loading = loadingMatch
                ? ` loading="${loadingMatch[1]}"`
                : ' loading="lazy"';
              return `<${tag}${src}${srcset}${alt}${loading}>`;
            }
            // Pour les vidéos et iframes, garder src et alt
            if (tag === "video" || tag === "iframe") {
              const srcMatch = attrs.match(/src="([^"]*)"/i);
              const altMatch = attrs.match(/alt="([^"]*)"/i);
              const titleMatch = attrs.match(/title="([^"]*)"/i);
              const src = srcMatch ? ` src="${srcMatch[1]}"` : "";
              const alt = altMatch
                ? ` alt="${altMatch[1]}"`
                : titleMatch
                  ? ` alt="${titleMatch[1]}"`
                  : "";
              return `<${tag}${src}${alt}>`;
            }
            // Pour les liens, garder href et title
            if (tag === "a") {
              const hrefMatch = attrs.match(/href="([^"]*)"/i);
              const titleMatch = attrs.match(/title="([^"]*)"/i);
              const href = hrefMatch ? ` href="${hrefMatch[1]}"` : "";
              const title = titleMatch ? ` title="${titleMatch[1]}"` : "";
              return `<${tag}${href}${title} target="_blank" rel="noopener noreferrer">`;
            }
            return `<${tag}>`;
          },
        )
        // Supprimer les divs et sections en gardant leur contenu
        .replace(/<\/?div[^>]*>/gi, "")
        .replace(/<\/?section[^>]*>/gi, "")
        .replace(/<\/?header[^>]*>/gi, "")
        .replace(/<\/?main[^>]*>/gi, "")
        .replace(/<\/?article[^>]*>/gi, "")
        // Supprimer les icônes et éléments vides
        .replace(/<i[^>]*>[\s\S]*?<\/i>/gi, "")
        .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, "")
        // Supprimer les balises vides restantes
        .replace(/<span[^>]*><\/span>/gi, "")
        .replace(/<a[^>]*><\/a>/gi, "")
        // Nettoyer les entités HTML
        .replace(/&nbsp;/g, " ")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&rsquo;/g, "'")
        .replace(/&lsquo;/g, "'")
        .replace(/&rdquo;/g, '"')
        .replace(/&ldquo;/g, '"')
        .replace(/&eacute;/g, "é")
        .replace(/&egrave;/g, "è")
        .replace(/&agrave;/g, "à")
        .replace(/&ccedil;/g, "ç")
        .replace(/&ecirc;/g, "ê")
        .replace(/&ocirc;/g, "ô")
        .replace(/&ucirc;/g, "û")
        .replace(/&iuml;/g, "ï")
        .replace(/&euml;/g, "ë")
        // Normaliser les espaces multiples et lignes vides
        .replace(/\s+/g, " ")
        .replace(/<p>\s*<\/p>/gi, "")
        .replace(/<figcaption>\s*<\/figcaption>/gi, "")
        .trim();

      // 5. Combiner synopsis et contenu
      const fullContent = synopsis
        ? `${synopsis}\n\n${cleanContent}`
        : cleanContent;

      console.log(
        `📄 Extracted ${fullContent.length} characters from article (synopsis + main content)`,
      );
      return fullContent;
    } catch (error) {
      console.error("❌ Error fetching full article content:", error);
      return null;
    }
  }

  /**
   * Validation AI de la pertinence éducative d'un article avec gpt-4o-mini
   * @param article Article à analyser
   * @returns Object avec isValid (pertinence éducative) et score de confiance
   */
  private static async validateEducationalRelevanceAI(
    article: RssItem,
  ): Promise<{ isValid: boolean; score: number; reason: string }> {
    try {
      // Vérifier le cache
      const cacheKey = article.guid ?? article.link ?? "";
      if (cacheKey) {
        const cached = aiValidationCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
          console.log(
            `📦 Cache hit pour validation éducative: ${cacheKey.substring(0, 50)}...`,
          );
          return {
            isValid: cached.isValid,
            score: cached.score,
            reason: cached.reason,
          };
        }
      }

      // Rate limiting (silencieux)
      const now = Date.now();
      const timeSinceLastCall = now - lastAICallTime;
      if (timeSinceLastCall < MIN_CALL_INTERVAL) {
        const waitTime = MIN_CALL_INTERVAL - timeSinceLastCall;
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }

      // Vérifier la clé API
      if (!process.env.OPENAI_API_KEY) {
        console.warn(
          "⚠️ OPENAI_API_KEY non configurée, acceptation par défaut avec score faible",
        );
        return { isValid: true, score: 0.5, reason: "no_api_key" };
      }

      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const title = article.title || "";
      const description = article.description || "";
      const contentSnippet = article.contentSnippet || "";

      lastAICallTime = Date.now();

      const response = await openai.chat.completions.create({
        model: "gpt-4.1-nano",
        messages: [
          {
            role: "system",
            content: `Tu es un classificateur d'articles scientifiques pour une plateforme éducative (SaaS éducatif).
Évalue si l'article est pertinent pour l'apprentissage et l'éducation scientifique.

✅ ACCEPTER (score 7-10) - Contenu éducatif et scientifique:
- Sciences fondamentales: physique, chimie, biologie, astronomie, géologie
- Technologie et innovation: recherche, découvertes, nouvelles technologies
- Mathématiques et informatique
- Santé et médecine: recherche médicale, découvertes scientifiques
- Environnement et climat: études, recherches, phénomènes naturels
- Ingénierie et robotique
- Espace et exploration spatiale
- Archéologie et paléontologie
- Histoire des sciences

❌ REJETER (score 0-3) - Contenu non-éducatif:
- Divertissement: films, séries TV, jeux vidéo, musique pop
- Culture populaire et célébrités
- Sport et événements sportifs
- Actualité politique, faits divers
- Contenu commercial: promotions, bons plans, comparatifs de prix
- Télé-réalité et programmes de divertissement

⚠️ ZONE GRISE (score 4-6) - À évaluer selon le contexte éducatif

Réponds au format JSON: {"valid": true/false, "score": 0-10, "reason": "raison brève en français"}`,
          },
          {
            role: "user",
            content: `Titre: ${title}\nDescription: ${description}\nExtrait: ${contentSnippet}`,
          },
        ],
        max_tokens: 150,
        temperature: 0,
        response_format: { type: "json_object" },
      });

      const result = JSON.parse(
        response.choices[0]?.message?.content ||
          '{"valid": false, "score": 0, "reason": "erreur parsing"}',
      );
      const isValid = result.valid === true && result.score >= 6;
      const score = result.score / 10; // Normaliser entre 0 et 1
      const reason = result.reason || "unknown";

      // Mettre en cache
      if (cacheKey) {
        aiValidationCache.set(cacheKey, {
          isValid,
          score,
          reason,
          timestamp: Date.now(),
        });
      }

      // Log uniquement les articles validés (réduire le bruit)
      if (isValid) {
        console.log(
          `🎓 Article validé: "${title.substring(0, 50)}..." (score: ${result.score}/10)`,
        );
      }
      return { isValid, score, reason };
    } catch (error) {
      console.error("❌ Erreur validation éducative AI:", error);
      // En cas d'erreur, on rejette l'article par sécurité
      return { isValid: false, score: 0, reason: "error_api" };
    }
  }

  /**
   * Fetch un article scientifique aléatoire depuis Futura Sciences RSS
   * Utilise l'AI (gpt-4.1-nano) pour valider la pertinence éducative
   * @returns Un article aléatoire validé par l'AI ou null en cas d'erreur
   */
  static async fetchLatestArticle(): Promise<FuturaArticle | null> {
    try {
      console.log("📡 Fetching Futura Sciences RSS feed...");
      const feed = await this.parser.parseURL(this.RSS_URL);

      if (!feed.items || feed.items.length === 0) {
        console.error("❌ No articles found in RSS feed");
        return null;
      }

      // Valider les articles avec l'AI (on teste les 30 premiers)
      const first30Articles = feed.items.slice(0, 30) as RssItem[];
      const validatedArticles: {
        item: RssItem;
        score: number;
        reason: string;
      }[] = [];

      console.log(`🔍 Validation AI de ${first30Articles.length} articles...`);

      for (const item of first30Articles) {
        const validation = await this.validateEducationalRelevanceAI(item);
        if (validation.isValid) {
          validatedArticles.push({
            item,
            score: validation.score,
            reason: validation.reason,
          });
        }
      }

      console.log(
        `✅ ${validatedArticles.length} articles éducatifs validés par l'AI sur ${first30Articles.length}`,
      );

      // Sélectionner un article au hasard parmi les validés (prioriser les meilleurs scores)
      let selectedArticle: RssItem;
      if (validatedArticles.length === 0) {
        console.warn(
          "⚠️ Aucun article validé par l'AI, utilisation du premier article disponible",
        );
        selectedArticle = feed.items[0] as RssItem;
        console.log(
          `🎲 Article de secours: "${selectedArticle.title?.substring(0, 80)}..."`,
        );
      } else {
        // Trier par score décroissant et prendre un article au hasard parmi les 5 meilleurs
        validatedArticles.sort((a, b) => b.score - a.score);
        const topArticles = validatedArticles.slice(
          0,
          Math.min(5, validatedArticles.length),
        );
        const randomIndex = Math.floor(Math.random() * topArticles.length);
        selectedArticle = topArticles[randomIndex].item;
        console.log(
          `🎲 Article sélectionné: "${selectedArticle.title?.substring(0, 80)}..." (score: ${topArticles[randomIndex].score.toFixed(2)}, raison: ${topArticles[randomIndex].reason})`,
        );
      }

      const latestItem = selectedArticle;

      // Extraire l'image depuis l'enclosure ou le contenu
      let imageUrl = latestItem.enclosure?.url;

      // Si pas d'enclosure, essayer d'extraire l'image du contenu HTML
      if (!imageUrl && latestItem.content) {
        const imgMatch = latestItem.content.match(/<img[^>]+src="([^">]+)"/);
        if (imgMatch) {
          imageUrl = imgMatch[1];
        }
      }

      // 🔥 SOLUTION SIMPLIFIÉE: Utiliser UNIQUEMENT le contenu RSS
      // Le scraping web de Futura Sciences ne fonctionne plus car ils changent trop souvent leur structure HTML
      // Le RSS contient une description correcte et fiable (même si courte)

      console.log("📝 Using RSS description (reliable source)");
      let cleanContent =
        latestItem.description || latestItem.contentSnippet || "";

      // Nettoyer le contenu de la description
      cleanContent = cleanContent
        // Nettoyer les entités HTML courantes
        .replace(/&nbsp;/g, " ")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/&eacute;/g, "é")
        .replace(/&egrave;/g, "è")
        .replace(/&agrave;/g, "à")
        .replace(/&ccedil;/g, "ç")
        .replace(/&ecirc;/g, "ê")
        .replace(/&ocirc;/g, "ô")
        .replace(/&ucirc;/g, "û")
        .replace(/&rsquo;/g, "'")
        .replace(/&lsquo;/g, "'")
        .replace(/&rdquo;/g, '"')
        .replace(/&ldquo;/g, '"')
        // Normaliser les espaces
        .replace(/\s+/g, " ")
        .trim();

      console.log(
        `📊 RSS description length: ${cleanContent.length} characters`,
      );

      const article: FuturaArticle = {
        title: latestItem.title || "Article sans titre",
        description: cleanContent,
        link: latestItem.link || "",
        pubDate: latestItem.pubDate || new Date().toISOString(),
        content: latestItem.content,
        contentSnippet: latestItem.contentSnippet,
        guid: latestItem.guid,
        enclosure: imageUrl ? { url: imageUrl, type: "image/jpeg" } : undefined,
      };

      console.log("✅ Latest article fetched:", article.title);
      console.log(`📊 Content length: ${cleanContent.length} characters`);
      return article;
    } catch (error) {
      console.error("❌ Error fetching Futura RSS feed:", error);
      return null;
    }
  }

  /**
   * Sauvegarde l'article de la semaine dans la base de données
   * @param article Article à sauvegarder
   * @param forceNew Si true, supprime l'article existant et en crée un nouveau
   * @returns L'article sauvegardé ou null en cas d'erreur
   */
  static async saveWeeklyArticle(
    article: FuturaArticle,
    forceNew: boolean = false,
  ) {
    try {
      // Vérifier si un article a déjà été sauvegardé cette semaine
      const startOfWeek = new Date();
      startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
      startOfWeek.setHours(0, 0, 0, 0);

      const existingArticle = await prisma.dailyArticle.findFirst({
        where: {
          fetchedAt: {
            gte: startOfWeek,
          },
        },
      });

      // Si forceNew = true, supprimer l'ancien article de cette semaine
      if (existingArticle && forceNew) {
        await prisma.dailyArticle.delete({
          where: { id: existingArticle.id },
        });
        console.log("🗑️ Ancien article supprimé pour en créer un nouveau");
      } else if (existingArticle) {
        console.log("ℹ️ Weekly article already exists for this week");
        return existingArticle;
      }

      // Sauvegarder le nouvel article
      const savedArticle = await prisma.dailyArticle.create({
        data: {
          title: article.title,
          description: article.description, // Utiliser la description nettoyée qui contient plus de contenu
          url: article.link,
          imageUrl: article.enclosure?.url || null,
          publishedAt: new Date(article.pubDate),
          fetchedAt: new Date(),
        },
      });

      console.log("✅ Weekly article saved to database:", savedArticle.id);

      // Nettoyer les anciens articles après avoir sauvegardé le nouveau
      await this.cleanupOldArticles();

      return savedArticle;
    } catch (error) {
      console.error("❌ Error saving weekly article:", error);
      return null;
    }
  }

  /**
   * Récupère l'article de la semaine depuis la base de données
   * Si aucun article n'existe pour cette semaine, fetch et sauvegarde un nouveau
   * @returns L'article de la semaine
   */
  static async getWeeklyArticle() {
    try {
      // Vérifier si un article existe pour cette semaine
      const startOfWeek = new Date();
      startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
      startOfWeek.setHours(0, 0, 0, 0);

      let article = await prisma.dailyArticle.findFirst({
        where: {
          fetchedAt: {
            gte: startOfWeek,
          },
        },
        orderBy: {
          fetchedAt: "desc",
        },
      });

      // Si aucun article pour cette semaine, en fetch un nouveau
      if (!article) {
        console.log("📰 No article for this week, fetching new one...");
        const latestArticle = await this.fetchLatestArticle();

        if (latestArticle) {
          article = await this.saveWeeklyArticle(latestArticle);
        }
      }

      return article;
    } catch (error) {
      console.error("❌ Error getting weekly article:", error);
      return null;
    }
  }

  /**
   * Récupère l'article du jour depuis la base de données (alias pour getWeeklyArticle)
   * @deprecated Utiliser getWeeklyArticle() à la place
   * @returns L'article de la semaine
   */
  static async getDailyArticle() {
    return this.getWeeklyArticle();
  }

  /**
   * Récupère le dernier article disponible dans la base de données (peu importe la date)
   * @returns Le dernier article disponible ou null si aucun article n'existe
   */
  static async getLatestAvailableArticle() {
    try {
      const article = await prisma.dailyArticle.findFirst({
        orderBy: {
          fetchedAt: "desc",
        },
      });

      return article;
    } catch (error) {
      console.error("❌ Error getting latest available article:", error);
      return null;
    }
  }

  /**
   * Nettoie les anciens articles (garde seulement les 30 derniers jours)
   */
  static async cleanupOldArticles() {
    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const deleted = await prisma.dailyArticle.deleteMany({
        where: {
          fetchedAt: {
            lt: sevenDaysAgo,
          },
        },
      });

      console.log(`🗑️ Cleaned up ${deleted.count} old articles`);
      return deleted.count;
    } catch (error) {
      console.error("❌ Error cleaning up old articles:", error);
      return 0;
    }
  }
}
