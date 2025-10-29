import Parser from 'rss-parser';
import { prisma } from '../lib/prisma.js';
import OpenAI from 'openai';

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

// Cache pour les résultats de détection AI
const aiDetectionCache = new Map<string, { isPromo: boolean; timestamp: number }>();
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 heures

// Rate limiting pour l'API OpenAI
let lastAICallTime = 0;
const MIN_CALL_INTERVAL = 6000; // 6 secondes entre chaque appel (max 10/min)

export class FuturaRssService {
  private static RSS_URL = 'https://www.futura-sciences.com/rss/actualites.xml';
  private static parser = new Parser();

  /**
   * Récupère le contenu complet d'un article depuis sa page web
   * @param url URL de l'article
   * @returns Le contenu complet de l'article avec HTML formaté ou null
   */
  private static async fetchFullArticleContent(url: string): Promise<string | null> {
    try {
      const response = await fetch(url);
      const html = await response.text();

      // 1. Extraire le synopsis (description courte)
      const synopsisMatch = html.match(/<div[^>]*class="[^"]*article-synopsis[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      let synopsis = '';
      if (synopsisMatch) {
        synopsis = synopsisMatch[1]
          .replace(/<p[^>]*>/gi, '<p>')
          .replace(/<\/?div[^>]*>/gi, '')
          .replace(/<\/?span[^>]*>/gi, '')
          .trim();
        console.log('📝 Synopsis extracted');
      }

      // 2. Extraire le contenu principal de l'article
      // Trouver le début de la div principale
      const startMatch = html.match(/<div[^>]*id="article-anchor-article-main-content"[^>]*>/i);
      if (!startMatch) {
        console.warn('⚠️ Could not find main article content div');
        return synopsis || null;
      }

      const startIndex = html.indexOf(startMatch[0]) + startMatch[0].length;

      // Compter les divs pour trouver la div fermante correcte
      let divCount = 1;
      let endIndex = startIndex;

      while (divCount > 0 && endIndex < html.length) {
        const nextOpenDiv = html.indexOf('<div', endIndex);
        const nextCloseDiv = html.indexOf('</div>', endIndex);

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
        console.warn('⚠️ Could not find matching closing div');
        return synopsis || null;
      }

      let articleContent = html.substring(startIndex, endIndex - 6); // -6 pour enlever </div>

      // 3. Supprimer le sommaire et autres éléments indésirables
      articleContent = articleContent
        // Supprimer le sommaire
        .replace(/<div[^>]*class="[^"]*article-summary[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '')
        .replace(/<div[^>]*class="[^"]*WrapperSummary[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '')
        // Supprimer les séparateurs
        .replace(/<hr[^>]*>/gi, '')
        // Supprimer footer, aside, nav
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
        .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
        // Supprimer les boutons de partage et autres widgets
        .replace(/<div[^>]*class="[^"]*share[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '')
        .replace(/<div[^>]*class="[^"]*author[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '')
        .replace(/<button[^>]*>[\s\S]*?<\/button>/gi, '');

      // 4. Nettoyer le contenu en gardant les balises importantes
      let cleanContent = articleContent
        // Supprimer les scripts et styles
        .replace(/<script[^>]*>.*?<\/script>/gi, '')
        .replace(/<style[^>]*>.*?<\/style>/gi, '')
        // Supprimer les noscript
        .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
        // Convertir les blocs d'images fs-media en figures
        .replace(/<div[^>]*class="[^"]*fs-media[^"]*"[^>]*>([\s\S]*?)<\/div>/gi, (match) => {
          // Extraire le contenu picture avec toutes ses sources
          const pictureMatch = match.match(/<picture[^>]*>([\s\S]*?)<\/picture>/i);
          // Extraire la légende
          const legendMatch = match.match(/<span[^>]*class="[^"]*fs-legende[^"]*"[^>]*>([\s\S]*?)<\/span>/i);

          if (pictureMatch) {
            const picture = pictureMatch[0];
            const legend = legendMatch ? `<figcaption>${legendMatch[1]}</figcaption>` : '';
            return `<figure>${picture}${legend}</figure>`;
          }
          return '';
        })
        // Supprimer les div image-wrapper et open-icon-button restantes
        .replace(/<div[^>]*class="[^"]*image-wrapper[^"]*"[^>]*>/gi, '')
        .replace(/<div[^>]*class="[^"]*open-icon-button[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '')
        // Garder les légendes mais supprimer les autres spans
        .replace(/<span[^>]*class="[^"]*tooltip[^"]*"[^>]*>[\s\S]*?<\/span>/gi, '')
        .replace(/<span[^>]*class="[^"]*wrappers__Span[^"]*"[^>]*>([\s\S]*?)<\/span>/gi, '$1')
        // Nettoyer les balises picture en gardant les sources
        .replace(/<picture([^>]*)>/gi, '<picture>')
        // Supprimer les attributs inutiles mais garder src/srcset/media pour images/vidéos et href pour liens
        .replace(/<(h1|h2|h3|h4|p|img|video|iframe|ul|ol|li|blockquote|figure|figcaption|a|source)([^>]*)>/gi, (_match, tag, attrs) => {
          // Pour les sources (dans picture), garder media, srcset, sizes
          if (tag === 'source') {
            const mediaMatch = attrs.match(/media="([^"]*)"/i);
            const srcsetMatch = attrs.match(/srcset="([^"]*)"/i);
            const sizesMatch = attrs.match(/sizes="([^"]*)"/i);
            const media = mediaMatch ? ` media="${mediaMatch[1]}"` : '';
            const srcset = srcsetMatch ? ` srcset="${srcsetMatch[1]}"` : '';
            const sizes = sizesMatch ? ` sizes="${sizesMatch[1]}"` : '';
            return `<${tag}${media}${srcset}${sizes}>`;
          }
          // Pour les images, garder src, srcset, alt, title, loading
          if (tag === 'img') {
            const srcMatch = attrs.match(/src="([^"]*)"/i);
            const srcsetMatch = attrs.match(/srcset="([^"]*)"/i);
            const altMatch = attrs.match(/alt="([^"]*)"/i);
            const titleMatch = attrs.match(/title="([^"]*)"/i);
            const loadingMatch = attrs.match(/loading="([^"]*)"/i);
            const src = srcMatch ? ` src="${srcMatch[1]}"` : '';
            const srcset = srcsetMatch ? ` srcset="${srcsetMatch[1]}"` : '';
            const alt = altMatch ? ` alt="${altMatch[1]}"` : (titleMatch ? ` alt="${titleMatch[1]}"` : '');
            const loading = loadingMatch ? ` loading="${loadingMatch[1]}"` : ' loading="lazy"';
            return `<${tag}${src}${srcset}${alt}${loading}>`;
          }
          // Pour les vidéos et iframes, garder src et alt
          if (tag === 'video' || tag === 'iframe') {
            const srcMatch = attrs.match(/src="([^"]*)"/i);
            const altMatch = attrs.match(/alt="([^"]*)"/i);
            const titleMatch = attrs.match(/title="([^"]*)"/i);
            const src = srcMatch ? ` src="${srcMatch[1]}"` : '';
            const alt = altMatch ? ` alt="${altMatch[1]}"` : (titleMatch ? ` alt="${titleMatch[1]}"` : '');
            return `<${tag}${src}${alt}>`;
          }
          // Pour les liens, garder href et title
          if (tag === 'a') {
            const hrefMatch = attrs.match(/href="([^"]*)"/i);
            const titleMatch = attrs.match(/title="([^"]*)"/i);
            const href = hrefMatch ? ` href="${hrefMatch[1]}"` : '';
            const title = titleMatch ? ` title="${titleMatch[1]}"` : '';
            return `<${tag}${href}${title} target="_blank" rel="noopener noreferrer">`;
          }
          return `<${tag}>`;
        })
        // Supprimer les divs et sections en gardant leur contenu
        .replace(/<\/?div[^>]*>/gi, '')
        .replace(/<\/?section[^>]*>/gi, '')
        .replace(/<\/?header[^>]*>/gi, '')
        .replace(/<\/?main[^>]*>/gi, '')
        .replace(/<\/?article[^>]*>/gi, '')
        // Supprimer les icônes et éléments vides
        .replace(/<i[^>]*>[\s\S]*?<\/i>/gi, '')
        .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, '')
        // Supprimer les balises vides restantes
        .replace(/<span[^>]*><\/span>/gi, '')
        .replace(/<a[^>]*><\/a>/gi, '')
        // Nettoyer les entités HTML
        .replace(/&nbsp;/g, ' ')
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&rsquo;/g, "'")
        .replace(/&lsquo;/g, "'")
        .replace(/&rdquo;/g, '"')
        .replace(/&ldquo;/g, '"')
        .replace(/&eacute;/g, 'é')
        .replace(/&egrave;/g, 'è')
        .replace(/&agrave;/g, 'à')
        .replace(/&ccedil;/g, 'ç')
        .replace(/&ecirc;/g, 'ê')
        .replace(/&ocirc;/g, 'ô')
        .replace(/&ucirc;/g, 'û')
        .replace(/&iuml;/g, 'ï')
        .replace(/&euml;/g, 'ë')
        // Normaliser les espaces multiples et lignes vides
        .replace(/\s+/g, ' ')
        .replace(/<p>\s*<\/p>/gi, '')
        .replace(/<figcaption>\s*<\/figcaption>/gi, '')
        .trim();

      // 5. Combiner synopsis et contenu
      const fullContent = synopsis ? `${synopsis}\n\n${cleanContent}` : cleanContent;

      console.log(`📄 Extracted ${fullContent.length} characters from article (synopsis + main content)`);
      return fullContent;
    } catch (error) {
      console.error('❌ Error fetching full article content:', error);
      return null;
    }
  }

  /**
   * Détection AI avec GPT-4o-mini pour les cas limites
   * @param article Article à analyser
   * @returns true si l'article est promotionnel
   */
  private static async isPromotionalAI(article: any): Promise<boolean> {
    try {
      // Vérifier le cache
      const cacheKey = article.guid || article.link;
      const cached = aiDetectionCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        console.log(`📦 Cache hit pour article: ${cacheKey}`);
        return cached.isPromo;
      }

      // Rate limiting
      const now = Date.now();
      const timeSinceLastCall = now - lastAICallTime;
      if (timeSinceLastCall < MIN_CALL_INTERVAL) {
        const waitTime = MIN_CALL_INTERVAL - timeSinceLastCall;
        console.log(`⏳ Rate limit: attente ${waitTime}ms`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }

      // Vérifier la clé API
      if (!process.env.OPENAI_API_KEY) {
        console.warn('⚠️ OPENAI_API_KEY non configurée, utilisation de la détection par mots-clés uniquement');
        return false;
      }

      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const title = article.title || '';
      const description = article.description || '';
      const contentSnippet = article.contentSnippet || '';

      lastAICallTime = Date.now();

      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'Tu es un classificateur d\'articles. Réponds uniquement "OUI" si l\'article est promotionnel/publicitaire (vente, réduction, code promo, comparatif commercial, bon plan), sinon "NON".'
          },
          {
            role: 'user',
            content: `Titre: ${title}\nDescription: ${description}\nExtrait: ${contentSnippet}`
          }
        ],
        max_tokens: 10,
        temperature: 0
      });

      const result = response.choices[0]?.message?.content?.trim().toUpperCase();
      const isPromo = result === 'OUI';

      // Mettre en cache
      aiDetectionCache.set(cacheKey, { isPromo, timestamp: Date.now() });

      console.log(`🤖 AI détection: "${title.substring(0, 40)}..." → ${isPromo ? 'PROMO' : 'OK'}`);
      return isPromo;

    } catch (error) {
      console.error('❌ Erreur AI detection:', error);
      return false; // En cas d'erreur, on considère que ce n'est pas promotionnel
    }
  }

  /**
   * Vérifie si un article est une promotion/offre (détection hybride)
   * @param article Article à vérifier
   * @returns true si l'article est une promotion
   */
  private static async isPromotionalArticle(article: any): Promise<boolean> {
    const title = (article.title || '').toLowerCase();
    const description = (article.description || '').toLowerCase();
    const contentSnippet = (article.contentSnippet || '').toLowerCase();
    const content = (article.content || '').toLowerCase();

    // Keywords forts (1 seul suffit pour détection)
    const strongKeywords = [
      'rakuten', 'amazon', 'cdiscount', 'fnac', 'darty', 'boulanger',
      'code promo', 'code promo', 'coupon', 'bon de réduction',
      'surfshark', 'cyberghost', 'expressvpn', 'nordvpn',
      'sponsorisé', 'sponsor', 'publicité', 'partenariat', 'partenaire'
    ];

    // Keywords faibles (2+ nécessaires pour détection)
    const weakKeywords = [
      'promo', 'économisez', 'économiser', 'réduction', 'offre', 'offres limitées',
      'jusqu\'à', 'rabais', 'soldes', 'bons plans', 'bon plan', 'deal', 'deals',
      'achetez', 'acheter', 'commander', 'comparatif', 'vente', 'achats',
      'vpn', 'antivirus', 'cyber', 'sécurité vpn',
      'prix', 'tarif', 'coûte', 'coût', '€', 'euros',
      'livraison', 'gratuit', 'moins cher'
    ];

    const combinedText = `${title} ${description} ${contentSnippet} ${content}`;

    // 1. Détection par keywords forts
    const matchingStrongKeywords = strongKeywords.filter(keyword =>
      combinedText.includes(keyword)
    );

    if (matchingStrongKeywords.length >= 1) {
      console.log(`⚠️ Article promotionnel (strong): "${title.substring(0, 50)}..." (${matchingStrongKeywords.join(', ')})`);
      return true;
    }

    // 2. Détection par pattern de prix (XX,XX € ou XX.XX €)
    const pricePattern = /\d+[.,]\d+\s*€/g;
    const priceMatches = combinedText.match(pricePattern);
    if (priceMatches && priceMatches.length >= 2) {
      console.log(`⚠️ Article promotionnel (prix): "${title.substring(0, 50)}..." (${priceMatches.length} prix détectés)`);
      return true;
    }

    // 3. Détection par keywords faibles
    const matchingWeakKeywords = weakKeywords.filter(keyword =>
      combinedText.includes(keyword)
    );

    // Si 2+ keywords faibles trouvés, c'est probablement une promotion
    if (matchingWeakKeywords.length >= 2) {
      console.log(`⚠️ Article promotionnel (weak): "${title.substring(0, 50)}..." (${matchingWeakKeywords.join(', ')})`);
      return true;
    }

    // 4. Cas limite: 1 keyword faible détecté → utiliser l'AI pour confirmation
    if (matchingWeakKeywords.length === 1) {
      console.log(`🤔 Article incertain, vérification AI: "${title.substring(0, 50)}..."`);
      return await this.isPromotionalAI(article);
    }

    // 5. Pattern stricte pour les promotions évidentes
    const promotionalPattern = /^(surfshark|cyberghost|expressvpn|nordvpn|vpn).*(vs|versus|comparaison|économisez|réduction|promo)/i;
    if (promotionalPattern.test(title)) {
      console.log(`⚠️ Article promotionnel (pattern): "${title}"`);
      return true;
    }

    // Aucun indicateur de promotion détecté
    return false;
  }

  /**
   * Fetch un article scientifique aléatoire depuis Futura Sciences RSS
   * @returns Un article aléatoire parmi les 10 derniers ou null en cas d'erreur
   */
  static async fetchLatestArticle(): Promise<FuturaArticle | null> {
    try {
      console.log('📡 Fetching Futura Sciences RSS feed...');
      const feed = await this.parser.parseURL(this.RSS_URL);

      if (!feed.items || feed.items.length === 0) {
        console.error('❌ No articles found in RSS feed');
        return null;
      }

      // Filtrer les articles promotionnels (avec async/await)
      const first30Articles = feed.items.slice(0, 30);
      const validArticles: any[] = [];

      for (const item of first30Articles) {
        const isPromo = await this.isPromotionalArticle(item);
        if (!isPromo) {
          validArticles.push(item);
        }
      }

      console.log(`✅ ${validArticles.length} articles non-promotionnels trouvés sur ${first30Articles.length}`);

      if (validArticles.length === 0) {
        console.warn('⚠️ Tous les articles disponibles sont des promotions, en prenant un quand même');
        validArticles.push(feed.items[0]);
      }

      // Prendre un article au hasard parmi les articles valides
      const randomIndex = Math.floor(Math.random() * validArticles.length);
      const latestItem = validArticles[randomIndex];

      console.log(`🎲 Article sélectionné: "${latestItem.title?.substring(0, 80)}..." (${randomIndex + 1}/${validArticles.length})`);

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

      console.log('📝 Using RSS description (reliable source)');
      let cleanContent = latestItem.description || latestItem.contentSnippet || '';

      // Nettoyer le contenu de la description
      cleanContent = cleanContent
        // Nettoyer les entités HTML courantes
        .replace(/&nbsp;/g, ' ')
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&eacute;/g, 'é')
        .replace(/&egrave;/g, 'è')
        .replace(/&agrave;/g, 'à')
        .replace(/&ccedil;/g, 'ç')
        .replace(/&ecirc;/g, 'ê')
        .replace(/&ocirc;/g, 'ô')
        .replace(/&ucirc;/g, 'û')
        .replace(/&rsquo;/g, "'")
        .replace(/&lsquo;/g, "'")
        .replace(/&rdquo;/g, '"')
        .replace(/&ldquo;/g, '"')
        // Normaliser les espaces
        .replace(/\s+/g, ' ')
        .trim();

      console.log(`📊 RSS description length: ${cleanContent.length} characters`);

      const article: FuturaArticle = {
        title: latestItem.title || 'Article sans titre',
        description: cleanContent,
        link: latestItem.link || '',
        pubDate: latestItem.pubDate || new Date().toISOString(),
        content: latestItem.content,
        contentSnippet: latestItem.contentSnippet,
        guid: latestItem.guid,
        enclosure: imageUrl ? { url: imageUrl, type: 'image/jpeg' } : undefined
      };

      console.log('✅ Latest article fetched:', article.title);
      console.log(`📊 Content length: ${cleanContent.length} characters`);
      return article;
    } catch (error) {
      console.error('❌ Error fetching Futura RSS feed:', error);
      return null;
    }
  }

  /**
   * Sauvegarde l'article du jour dans la base de données
   * @param article Article à sauvegarder
   * @param forceNew Si true, supprime l'article existant et en crée un nouveau
   * @returns L'article sauvegardé ou null en cas d'erreur
   */
  static async saveDailyArticle(article: FuturaArticle, forceNew: boolean = false) {
    try {
      // Vérifier si un article a déjà été sauvegardé aujourd'hui
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const existingArticle = await prisma.dailyArticle.findFirst({
        where: {
          fetchedAt: {
            gte: today
          }
        }
      });

      // Si forceNew = true, supprimer l'ancien article d'aujourd'hui
      if (existingArticle && forceNew) {
        await prisma.dailyArticle.delete({
          where: { id: existingArticle.id }
        });
        console.log('🗑️ Ancien article supprimé pour en créer un nouveau');
      } else if (existingArticle) {
        console.log('ℹ️ Daily article already exists for today');
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
          fetchedAt: new Date()
        }
      });

      console.log('✅ Daily article saved to database:', savedArticle.id);
      
      // Nettoyer les anciens articles après avoir sauvegardé le nouveau
      await this.cleanupOldArticles();
      
      return savedArticle;
    } catch (error) {
      console.error('❌ Error saving daily article:', error);
      return null;
    }
  }

  /**
   * Récupère l'article du jour depuis la base de données
   * Si aucun article n'existe pour aujourd'hui, fetch et sauvegarde un nouveau
   * @returns L'article du jour
   */
  static async getDailyArticle() {
    try {
      // Vérifier si un article existe pour aujourd'hui
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      let article = await prisma.dailyArticle.findFirst({
        where: {
          fetchedAt: {
            gte: today
          }
        },
        orderBy: {
          fetchedAt: 'desc'
        }
      });

      // Si aucun article pour aujourd'hui, en fetch un nouveau
      if (!article) {
        console.log('📰 No article for today, fetching new one...');
        const latestArticle = await this.fetchLatestArticle();

        if (latestArticle) {
          article = await this.saveDailyArticle(latestArticle);
        }
      }

      return article;
    } catch (error) {
      console.error('❌ Error getting daily article:', error);
      return null;
    }
  }

  /**
   * Récupère le dernier article disponible dans la base de données (peu importe la date)
   * @returns Le dernier article disponible ou null si aucun article n'existe
   */
  static async getLatestAvailableArticle() {
    try {
      const article = await prisma.dailyArticle.findFirst({
        orderBy: {
          fetchedAt: 'desc'
        }
      });

      return article;
    } catch (error) {
      console.error('❌ Error getting latest available article:', error);
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
            lt: sevenDaysAgo
          }
        }
      });

      console.log(`🗑️ Cleaned up ${deleted.count} old articles`);
      return deleted.count;
    } catch (error) {
      console.error('❌ Error cleaning up old articles:', error);
      return 0;
    }
  }
}
