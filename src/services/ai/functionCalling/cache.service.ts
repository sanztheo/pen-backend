/**
 * 💾 CACHE SERVICE - Prompt Caching pour réduire les coûts
 *
 * Ce service implémente le prompt caching inspiré de Cursor:
 * - System prompt + descriptions d'outils : STATIQUE → caché
 * - Métadonnées workspace : TTL 5 min → caché
 * - Requête utilisateur + résultats : DYNAMIQUE → pas caché
 *
 * Avantages:
 * - 90% de réduction de coût avec OpenAI prompt caching
 * - Réduction de latence (tokens pré-processés)
 * - Architecture modulaire et maintenable
 */

/**
 * Contexte caché contenant les informations statiques
 */
export interface CachedContext {
  systemPrompt: string;
  toolDescriptions: ToolDescription[];
  workspaceMetadata: WorkspaceMetadata;
}

/**
 * Description d'un outil Pennote
 */
export interface ToolDescription {
  name: string;
  description: string;
  params: Record<string, string>;
}

/**
 * Métadonnées du workspace (TTL 5 min)
 */
export interface WorkspaceMetadata {
  sourceCount: number;
  lastUpdate: number;
}

/**
 * Données cachées avec timestamp
 */
interface CachedData {
  data: CachedContext;
  timestamp: number;
}

/**
 * Service de caching pour les prompts
 */
export class CacheService {
  private static cache = new Map<string, CachedData>();
  private static TTL = 5 * 60 * 1000; // 5 minutes

  /**
   * Récupère le contexte caché (system prompt + tool descriptions)
   *
   * Si le cache est expiré, régénère le contexte.
   * Sinon, retourne le contexte caché pour éviter de retraiter les tokens.
   */
  static getCachedContext(): CachedContext {
    const cacheKey = "pennote_system_context";
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.TTL) {
      console.log("💾 [CACHE] Context hit - using cached system prompt");
      return cached.data;
    }

    console.log("🔄 [CACHE] Context miss - generating new context");

    const context = {
      systemPrompt: this.getSystemPrompt(),
      toolDescriptions: this.getPennoteToolDescriptions(),
      workspaceMetadata: this.getWorkspaceMetadata(),
    };

    this.cache.set(cacheKey, {
      data: context,
      timestamp: Date.now(),
    });

    return context;
  }

  /**
   * Invalide le cache (utile pour les tests ou après une mise à jour importante)
   */
  static invalidateCache(): void {
    console.log("🔄 [CACHE] Cache invalidated");
    this.cache.clear();
  }

  /**
   * Retourne le system prompt statique pour Pennote
   *
   * Ce prompt est STATIQUE et peut être caché par OpenAI.
   */
  private static getSystemPrompt(): string {
    return `You are Pennote AI, an intelligent assistant for knowledge management.
Your role is to help users find, synthesize and understand information from their sources.

Available tools:
- list_available_sources: List personal sources (pages, files, personal Wikipedia)
- list_global_wikipedia_sources: List global shared Wikipedia sources
- select_relevant_sources: Select relevant sources based on query
- read_rag_source: Read complete content of a RAG source
- search_rag_chunks: Semantic search within RAG source chunks
- search_web: External web search
- read_workspace_page: Read workspace page
- list_workspace_pages: List workspace pages
- check_sources_rag_status: Check RAG processing status of sources

Key characteristics:
- All tools are READ-ONLY and can execute in parallel
- Prioritize user's personal sources over web
- Synthesize information from multiple sources
- Always cite sources in responses
- Optimize queries for better semantic search results

Execution strategy:
1. First Thinking: Generate a complete plan of tools to execute
2. Parallel Execution: Execute all read-only tools simultaneously
3. Strategic Reflection: Only reflect if errors or ambiguity detected
4. Synthesis: Generate final comprehensive response`;
  }

  /**
   * Retourne les descriptions des outils Pennote
   *
   * Ces descriptions sont STATIQUES et peuvent être cachées.
   */
  private static getPennoteToolDescriptions(): ToolDescription[] {
    return [
      {
        name: "list_available_sources",
        description:
          "Lists all available personal sources (pages, files, personal Wikipedia). Accepts optional query parameter for filtering.",
        params: { query: "string (optional)" },
      },
      {
        name: "list_global_wikipedia_sources",
        description:
          "Lists global shared Wikipedia sources available to all users. Accepts optional query parameter for filtering.",
        params: { query: "string (optional)" },
      },
      {
        name: "select_relevant_sources",
        description:
          "Selects relevant sources based on query. Requires question and availableSources array with {id, title, sourceType}.",
        params: {
          question: "string (required)",
          availableSources: "array of {id, title, sourceType} (required)",
        },
      },
      {
        name: "read_rag_source",
        description:
          "Reads complete content of a RAG source. Requires sourceId and query for targeted extraction.",
        params: {
          sourceId: "string (required)",
          query: "string (required)",
        },
      },
      {
        name: "search_rag_chunks",
        description:
          "Performs semantic search within RAG source chunks. Requires query, optional sourceIds array.",
        params: {
          query: "string (required)",
          sourceIds: "array of strings (optional)",
        },
      },
      {
        name: "search_web",
        description:
          "External web search. Takes ONLY query parameter (string), no other fields.",
        params: { query: "string (required)" },
      },
      {
        name: "read_workspace_page",
        description:
          "Reads a specific workspace page. Requires pageId parameter.",
        params: { pageId: "string (required)" },
      },
      {
        name: "list_workspace_pages",
        description:
          "Lists all workspace pages. No parameters required, returns array of pages.",
        params: {},
      },
      {
        name: "check_sources_rag_status",
        description:
          "Checks RAG processing status of sources. Requires sourceIds array.",
        params: { sourceIds: "array of strings (required)" },
      },
    ];
  }

  /**
   * Retourne les métadonnées du workspace
   *
   * Ces données changent peu souvent (TTL 5 min).
   */
  private static getWorkspaceMetadata(): WorkspaceMetadata {
    return {
      sourceCount: 0, // À remplir dynamiquement si nécessaire
      lastUpdate: Date.now(),
    };
  }

  /**
   * Met à jour les métadonnées du workspace
   *
   * Appeler cette méthode quand le nombre de sources change.
   */
  static updateWorkspaceMetadata(sourceCount: number): void {
    const context = this.getCachedContext();
    context.workspaceMetadata.sourceCount = sourceCount;
    context.workspaceMetadata.lastUpdate = Date.now();

    this.cache.set("pennote_system_context", {
      data: context,
      timestamp: Date.now(),
    });

    console.log(
      `💾 [CACHE] Workspace metadata updated: ${sourceCount} sources`,
    );
  }

  // ============================================
  // 🚀 SCORE CACHE - Évite les recalculs
  // ============================================

  private static scoreCache = new Map<string, { score: any; timestamp: number }>();
  private static SCORE_TTL = 10 * 60 * 1000; // 10 minutes

  /**
   * Génère une clé de cache pour un score
   * Basée sur : toolName + hash du résultat (premiers 500 chars) + query
   */
  static generateScoreCacheKey(toolName: string, result: string, query: string): string {
    // Hash simple basé sur les premiers 500 caractères du résultat
    const resultHash = this.simpleHash(result.slice(0, 500));
    const queryHash = this.simpleHash(query.toLowerCase().trim());
    return `score_${toolName}_${resultHash}_${queryHash}`;
  }

  /**
   * Hash simple pour générer une clé courte
   */
  private static simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Récupère un score depuis le cache
   * @returns Le score caché ou null si non trouvé/expiré
   */
  static getCachedScore(toolName: string, result: string, query: string): any | null {
    const key = this.generateScoreCacheKey(toolName, result, query);
    const cached = this.scoreCache.get(key);

    if (cached && Date.now() - cached.timestamp < this.SCORE_TTL) {
      console.log(`💾 [SCORE-CACHE] HIT: ${toolName} (économise 1 appel API)`);
      return cached.score;
    }

    return null;
  }

  /**
   * Stocke un score dans le cache
   */
  static setCachedScore(toolName: string, result: string, query: string, score: any): void {
    const key = this.generateScoreCacheKey(toolName, result, query);
    this.scoreCache.set(key, {
      score,
      timestamp: Date.now(),
    });
    console.log(`💾 [SCORE-CACHE] SET: ${toolName}`);
  }

  /**
   * Nettoie les scores expirés du cache
   */
  static cleanExpiredScores(): void {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, value] of this.scoreCache.entries()) {
      if (now - value.timestamp >= this.SCORE_TTL) {
        this.scoreCache.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.log(`🧹 [SCORE-CACHE] Nettoyé ${cleaned} scores expirés`);
    }
  }

  /**
   * Statistiques du cache des scores
   */
  static getScoreCacheStats(): { size: number; hitRate: string } {
    return {
      size: this.scoreCache.size,
      hitRate: "N/A", // Pourrait être implémenté avec des compteurs
    };
  }
}
