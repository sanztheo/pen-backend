/**
 * 🌐 WEB SEARCH SERVICE (OpenAI Native)
 *
 * Utilise la fonctionnalité native de web search d'OpenAI (gpt-4o-mini)
 * Remplace Tavily pour une intégration plus simple et native.
 *
 * Documentation : https://platform.openai.com/docs/guides/tools-web-search
 */

import OpenAI from 'openai';
import { AIService } from './base.js';

export interface WebSearchOptions {
  query: string;
  maxResults?: number;
  allowedDomains?: string[];        // Limite à max 20 domaines
  location?: {                      // Localisation géographique
    country?: string;               // Code pays (ex: "FR", "US")
    city?: string;                  // Ville (ex: "Paris", "Montpellier")
    region?: string;                // Région
  };
  searchContextSize?: 'low' | 'medium' | 'high';  // Taille du contexte récupéré
}

export interface WebSearchResult {
  success: boolean;
  content: string;                  // Réponse formatée du modèle
  sources?: WebSearchSource[];      // Sources utilisées
  error?: string;
}

export interface WebSearchSource {
  title: string;
  url: string;
  snippet?: string;
}

export class WebSearchService {
  private static openai: OpenAI;

  /**
   * Initialise le client OpenAI
   */
  private static getClient(): OpenAI {
    if (!this.openai) {
      this.openai = AIService.getOpenAI();
    }
    return this.openai;
  }

  /**
   * 🔍 Effectue une recherche web avec OpenAI web search
   *
   * @param options Options de recherche
   * @returns Résultat de la recherche
   */
  static async search(options: WebSearchOptions): Promise<WebSearchResult> {
    const { query, allowedDomains, location, searchContextSize = 'medium' } = options;

    console.log(`🌐 [WEB-SEARCH] Recherche: "${query}"`);
    if (allowedDomains) {
      console.log(`   Domaines autorisés: ${allowedDomains.join(', ')}`);
    }
    if (location) {
      console.log(`   Localisation: ${location.city || location.country || location.region}`);
    }

    try {
      const client = this.getClient();

      // Configuration de l'outil web search
      // 🔥 NOTE: gpt-4o-mini ne supporte que le web search basique
      // Les paramètres avancés (filters, location, search_context_size) ne sont pas supportés
      const webSearchTool: any = {
        type: 'web_search'
        // ❌ search_context_size: Non supporté avec gpt-4o-mini
        // ❌ filters: Non supporté avec gpt-4o-mini
        // ❌ location: Non supporté avec gpt-4o-mini
      };

      // 🔥 IMPORTANT: Utiliser responses.create() et non chat.completions.create()
      // Ceci est l'API spécifique pour web search
      const response = await (client as any).responses.create({
        model: 'gpt-4o-mini',  // Web search basique uniquement
        tools: [webSearchTool],
        tool_choice: 'auto',  // Le modèle décide automatiquement
        include: ['web_search_call.action.sources'],  // Inclure les sources dans la réponse
        input: query
      });

      console.log(`✅ [WEB-SEARCH] Recherche réussie`);

      // Parser la réponse
      const content = response.output_text || '';
      const sources: WebSearchSource[] = [];

      // Extraire les sources si disponibles
      if (response.sources && Array.isArray(response.sources)) {
        response.sources.forEach((source: any) => {
          sources.push({
            title: source.title || 'Sans titre',
            url: source.url || '',
            snippet: source.snippet || ''
          });
        });
        console.log(`📚 [WEB-SEARCH] ${sources.length} sources trouvées`);
      }

      return {
        success: true,
        content,
        sources
      };

    } catch (error: any) {
      console.error(`❌ [WEB-SEARCH] Erreur:`, error);

      // Gérer les erreurs spécifiques
      if (error.status === 401) {
        return {
          success: false,
          content: '',
          error: 'Erreur d\'authentification OpenAI. Vérifiez votre clé API.'
        };
      }

      if (error.status === 429) {
        return {
          success: false,
          content: '',
          error: 'Limite de taux dépassée. Veuillez réessayer dans quelques instants.'
        };
      }

      // Fallback: utiliser une completion classique si web search échoue
      console.warn(`⚠️ [WEB-SEARCH] Fallback sur completion classique`);
      try {
        const fallbackClient = this.getClient();
        const fallbackResponse = await fallbackClient.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: 'Tu es un assistant qui répond aux questions de manière concise et factuelle.'
            },
            {
              role: 'user',
              content: `Réponds à cette question du mieux que tu peux (sans accès au web) : ${query}`
            }
          ],
          temperature: 0.3,
          max_tokens: 1000
        });

        const fallbackContent = fallbackResponse.choices[0]?.message?.content || '';

        return {
          success: true,
          content: `⚠️ Réponse sans accès web (fonctionnalité indisponible):\n\n${fallbackContent}`,
          sources: []
        };

      } catch (fallbackError) {
        return {
          success: false,
          content: '',
          error: `Erreur web search: ${error.message}`
        };
      }
    }
  }

  /**
   * 🔍 Recherche web simple (version simplifiée)
   *
   * @param query Question de recherche
   * @param maxResults Nombre de résultats (non utilisé avec OpenAI web search natif)
   * @returns Résultat formaté
   */
  static async simpleSearch(query: string, maxResults?: number): Promise<string> {
    const result = await this.search({ query, maxResults });

    if (!result.success) {
      return `❌ Erreur lors de la recherche web: ${result.error || 'Erreur inconnue'}`;
    }

    // Formater la réponse avec les sources
    let formatted = result.content;

    if (result.sources && result.sources.length > 0) {
      formatted += '\n\n📚 **Sources** :\n';
      result.sources.forEach((source, idx) => {
        formatted += `${idx + 1}. [${source.title}](${source.url})\n`;
        if (source.snippet) {
          formatted += `   ${source.snippet}\n`;
        }
      });
    }

    return formatted;
  }

  /**
   * 🔍 Recherche web avec filtrage de domaines
   *
   * @param query Question de recherche
   * @param domains Domaines autorisés (max 20)
   * @returns Résultat formaté
   */
  static async searchWithDomains(query: string, domains: string[]): Promise<string> {
    const result = await this.search({
      query,
      allowedDomains: domains
    });

    if (!result.success) {
      return `❌ Erreur lors de la recherche web: ${result.error || 'Erreur inconnue'}`;
    }

    let formatted = result.content;

    if (result.sources && result.sources.length > 0) {
      formatted += '\n\n📚 **Sources** (domaines filtrés) :\n';
      result.sources.forEach((source, idx) => {
        formatted += `${idx + 1}. [${source.title}](${source.url})\n`;
      });
    }

    return formatted;
  }

  /**
   * 🔍 Recherche web avec localisation
   *
   * @param query Question de recherche
   * @param location Localisation géographique
   * @returns Résultat formaté
   */
  static async searchWithLocation(
    query: string,
    location: { country?: string; city?: string; region?: string }
  ): Promise<string> {
    const result = await this.search({
      query,
      location
    });

    if (!result.success) {
      return `❌ Erreur lors de la recherche web: ${result.error || 'Erreur inconnue'}`;
    }

    let formatted = result.content;

    const locationStr = location.city || location.country || location.region;
    formatted = `🌍 Recherche localisée (${locationStr}):\n\n` + formatted;

    if (result.sources && result.sources.length > 0) {
      formatted += '\n\n📚 **Sources** :\n';
      result.sources.forEach((source, idx) => {
        formatted += `${idx + 1}. [${source.title}](${source.url})\n`;
      });
    }

    return formatted;
  }
}
