// 🧠 RAG Session Memory - Mémoire persistante entre sessions
import { prisma } from '../../lib/prisma.js';
import type { RAGSearchResult } from './index.js';

export interface SessionContext {
  queries: string[];
  responses: string[];
  sourcesUsed: string[];
  cumulativeContext: string;
  lastQuery?: string;
  lastResponse?: string;
}

export interface SessionMemoryOptions {
  maxQueries?: number;
  maxContextLength?: number;
  autoSummarize?: boolean;
}

export class SessionMemorySystem {
  private readonly defaultOptions: SessionMemoryOptions = {
    maxQueries: 20,
    maxContextLength: 8000,
    autoSummarize: true
  };

  // 🆔 Génération/récupération d'une session
  async getOrCreateSession(
    userId: string,
    workspaceId: string | null,
    sessionKey?: string
  ): Promise<string> {
    // Si pas de clé fournie, générer une nouvelle session
    if (!sessionKey) {
      sessionKey = this.generateSessionKey();
    }

    // Chercher session existante
    let session = await prisma.rAGSession.findUnique({
      where: { sessionKey },
      include: { sourcesUsed: true }
    });

    if (!session) {
      // Créer nouvelle session
      session = await prisma.rAGSession.create({
        data: {
          userId,
          workspaceId,
          sessionKey,
          title: `Session ${new Date().toLocaleDateString('fr-FR')}`
        },
        include: { sourcesUsed: true }
      });
    }

    return session.id;
  }

  // 💾 Sauvegarde d'une interaction
  async saveInteraction(
    sessionId: string,
    query: string,
    response: string,
    sourcesUsed: string[],
    searchResults?: RAGSearchResult[]
  ): Promise<void> {
    try {
      const session = await prisma.rAGSession.findUnique({
        where: { id: sessionId }
      });

      if (!session) {
        throw new Error('Session non trouvée');
      }

      // Récupérer l'historique actuel
      const currentQueries = Array.isArray(session.queries) ? session.queries as string[] : [];
      const currentResponses = Array.isArray(session.responses) ? session.responses as string[] : [];

      // Ajouter la nouvelle interaction
      const updatedQueries = [...currentQueries, query];
      const updatedResponses = [...currentResponses, response];

      // Construire le contexte cumulé
      const newContext = await this.buildCumulativeContext(
        session.id,
        updatedQueries,
        updatedResponses,
        searchResults
      );

      // Appliquer les limites et la compression si nécessaire
      const { queries, responses, context } = await this.applyLimitsAndCompression(
        updatedQueries,
        updatedResponses,
        newContext
      );

      // Mettre à jour la session
      await prisma.rAGSession.update({
        where: { id: sessionId },
        data: {
          queries,
          responses,
          context,
          totalQueries: queries.length,
          lastQueryAt: new Date(),
          // Connecter les nouvelles sources utilisées
          sourcesUsed: {
            connect: sourcesUsed.map(id => ({ id }))
          }
        }
      });

    } catch (error) {
      console.error('Erreur sauvegarde interaction:', error);
      throw error;
    }
  }

  // 🔍 Récupération de la mémoire récente
  async getRecentMemory(
    sessionId: string,
    maxInteractions: number = 5
  ): Promise<string> {
    try {
      const session = await prisma.rAGSession.findUnique({
        where: { id: sessionId }
      });

      if (!session) {
        return '';
      }

      const queries = Array.isArray(session.queries) ? session.queries as string[] : [];
      const responses = Array.isArray(session.responses) ? session.responses as string[] : [];
      
      const recentQueries = queries.slice(-maxInteractions);
      const recentResponses = responses.slice(-maxInteractions);
      
      let memoryText = '';
      for (let i = 0; i < Math.min(recentQueries.length, recentResponses.length); i++) {
        memoryText += `Q: ${recentQueries[i]}\nR: ${recentResponses[i]}\n\n`;
      }
      
      return memoryText;
    } catch (error) {
      console.error('Erreur récupération mémoire récente:', error);
      return '';
    }
  }

  // 🔍 Récupération du contexte de session
  async getSessionContext(
    sessionId: string,
    options: SessionMemoryOptions = {}
  ): Promise<SessionContext> {
    const opts = { ...this.defaultOptions, ...options };
    
    const session = await prisma.rAGSession.findUnique({
      where: { id: sessionId },
      include: { sourcesUsed: { select: { id: true, title: true, sourceType: true } } }
    });

    if (!session) {
      return {
        queries: [],
        responses: [],
        sourcesUsed: [],
        cumulativeContext: ''
      };
    }

    const queries = Array.isArray(session.queries) ? session.queries as string[] : [];
    const responses = Array.isArray(session.responses) ? session.responses as string[] : [];
    const context = typeof session.context === 'object' ? session.context as any : {};
    
    return {
      queries: queries.slice(-opts.maxQueries!),
      responses: responses.slice(-opts.maxQueries!),
      sourcesUsed: session.sourcesUsed.map(s => s.id),
      cumulativeContext: context.summary || '',
      lastQuery: queries[queries.length - 1],
      lastResponse: responses[responses.length - 1]
    };
  }

  // 🎯 Construction contexte pour nouvelle requête
  async buildContextForNewQuery(
    sessionId: string,
    newQuery: string,
    searchResults: RAGSearchResult[]
  ): Promise<string> {
    const sessionContext = await this.getSessionContext(sessionId);
    
    const contextParts = [
      // 1. Contexte de session s'il existe
      sessionContext.cumulativeContext ? 
        `# Contexte de la conversation\n${sessionContext.cumulativeContext}\n` : '',
      
      // 2. Dernière interaction si pertinente
      this.isQueryRelatedToPrevious(newQuery, sessionContext.lastQuery) && sessionContext.lastQuery ? 
        `## Dernière question\n${sessionContext.lastQuery}\n${sessionContext.lastResponse || ''}\n` : '',
      
      // 3. Question actuelle
      `# Question actuelle\n${newQuery}\n`,
      
      // 4. Sources pertinentes
      searchResults.length > 0 ? 
        `# Sources pertinentes\n${this.formatSearchResults(searchResults)}` : ''
    ];

    return contextParts.filter(Boolean).join('\n');
  }

  // 🗑️ Nettoyage des sessions anciennes
  async cleanupOldSessions(daysOld: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const deletedSessions = await prisma.rAGSession.deleteMany({
      where: {
        OR: [
          { lastQueryAt: { lt: cutoffDate } },
          { 
            AND: [
              { lastQueryAt: null },
              { createdAt: { lt: cutoffDate } }
            ]
          }
        ]
      }
    });

    return deletedSessions.count;
  }

  // 📊 Statistiques de session
  async getSessionStats(userId: string): Promise<{
    totalSessions: number;
    activeSessions: number;
    totalQueries: number;
    averageQueriesPerSession: number;
    mostUsedSources: Array<{ sourceId: string; title: string; count: number; }>;
  }> {
    const sessions = await prisma.rAGSession.findMany({
      where: { userId },
      include: { sourcesUsed: { select: { id: true, title: true } } }
    });

    const activeSessions = sessions.filter((s: any) => 
      s.lastQueryAt && s.lastQueryAt > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    );

    const totalQueries = sessions.reduce((sum: any, s: any) => sum + s.totalQueries, 0);

    // Compter les sources les plus utilisées
    const sourceUsage = new Map<string, { title: string; count: number }>();
    sessions.forEach((session: any) => {
      session.sourcesUsed.forEach((source: any) => {
        const current = sourceUsage.get(source.id) || { title: source.title, count: 0 };
        sourceUsage.set(source.id, { ...current, count: current.count + 1 });
      });
    });

    const mostUsedSources = Array.from(sourceUsage.entries())
      .map(([sourceId, data]) => ({ sourceId, ...data }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      totalSessions: sessions.length,
      activeSessions: activeSessions.length,
      totalQueries,
      averageQueriesPerSession: sessions.length > 0 ? totalQueries / sessions.length : 0,
      mostUsedSources
    };
  }

  // 🔧 Méthodes privées
  private generateSessionKey(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private async buildCumulativeContext(
    _sessionId: string,
    queries: string[],
    responses: string[],
    searchResults?: RAGSearchResult[]
  ): Promise<any> {
    // Construire un résumé du contexte accumulé
    const recentQueries = queries.slice(-5); // Garder les 5 dernières
    const recentResponses = responses.slice(-5);

    const summary = recentQueries.map((query, index) => 
      `Q: ${query}\nR: ${recentResponses[index] || 'Pas de réponse'}`
    ).join('\n\n');

    return {
      summary: summary.length > 2000 ? this.summarizeText(summary, 2000) : summary,
      keyTopics: this.extractKeyTopics(queries),
      lastSearchResults: searchResults?.slice(0, 3).map(r => ({
        sourceTitle: r.source.title,
        content: r.content.slice(0, 200)
      })) || []
    };
  }

  private async applyLimitsAndCompression(
    queries: string[],
    responses: string[],
    context: any
  ): Promise<{ queries: string[]; responses: string[]; context: any }> {
    const options = this.defaultOptions;
    
    // Appliquer la limite du nombre de queries
    if (queries.length > options.maxQueries!) {
      queries = queries.slice(-options.maxQueries!);
      responses = responses.slice(-options.maxQueries!);
    }

    // Compresser le contexte si nécessaire
    const contextString = JSON.stringify(context);
    if (contextString.length > options.maxContextLength!) {
      context = await this.compressContext(context, options.maxContextLength!);
    }

    return { queries, responses, context };
  }

  private async compressContext(context: any, maxLength: number): Promise<any> {
    // Compression intelligente du contexte
    const compressed = { ...context };
    
    // Résumer le summary s'il est trop long
    if (compressed.summary && compressed.summary.length > maxLength * 0.7) {
      compressed.summary = this.summarizeText(compressed.summary, Math.floor(maxLength * 0.7));
    }

    // Garder seulement les topics les plus importants
    if (compressed.keyTopics && compressed.keyTopics.length > 10) {
      compressed.keyTopics = compressed.keyTopics.slice(0, 10);
    }

    // Limiter les résultats de recherche
    if (compressed.lastSearchResults && compressed.lastSearchResults.length > 2) {
      compressed.lastSearchResults = compressed.lastSearchResults.slice(0, 2);
    }

    return compressed;
  }

  private summarizeText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    
    // Technique simple : garder les premières et dernières phrases
    const sentences = text.split(/[.!?]+/).filter(s => s.trim());
    if (sentences.length <= 2) return text.slice(0, maxLength) + '...';
    
    const firstSentence = sentences[0] + '.';
    const lastSentence = sentences[sentences.length - 1] + '.';
    
    const summary = `${firstSentence}\n[...résumé...]\n${lastSentence}`;
    
    return summary.length <= maxLength ? summary : text.slice(0, maxLength) + '...';
  }

  private extractKeyTopics(queries: string[]): string[] {
    // Extraction simple des mots-clés (à améliorer avec NLP)
    const allWords = queries.join(' ').toLowerCase().split(/\s+/);
    const stopWords = new Set(['le', 'la', 'les', 'un', 'une', 'de', 'du', 'des', 'et', 'ou', 'que', 'qui', 'quoi', 'comment', 'pourquoi']);
    
    const wordCounts = new Map<string, number>();
    allWords.forEach(word => {
      if (word.length > 3 && !stopWords.has(word)) {
        wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
      }
    });

    return Array.from(wordCounts.entries())
      .filter(([, count]) => count > 1)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([word]) => word);
  }

  private isQueryRelatedToPrevious(newQuery: string, previousQuery?: string): boolean {
    if (!previousQuery) return false;
    
    // Analyse simple de similarité (à améliorer)
    const newWords = new Set(newQuery.toLowerCase().split(/\s+/));
    const prevWords = new Set(previousQuery.toLowerCase().split(/\s+/));
    
    const intersection = new Set([...newWords].filter(word => prevWords.has(word)));
    const union = new Set([...newWords, ...prevWords]);
    
    return intersection.size / union.size > 0.3; // 30% de similarité
  }

  private formatSearchResults(results: RAGSearchResult[]): string {
    return results.map((result, index) =>
      `## Source ${index + 1}: ${result.source.title}\n` +
      (result.sectionTitle ? `### ${result.sectionTitle}\n` : '') +
      `${result.content.slice(0, 500)}${result.content.length > 500 ? '...' : ''}\n`
    ).join('\n');
  }

  // 🔍 Récupérer une session active pour un utilisateur et workspace
  async getActiveSession(userId: string, workspaceId: string): Promise<any | null> {
    try {
      const session = await prisma.rAGSession.findFirst({
        where: {
          userId,
          workspaceId,
          // Considérer comme active si utilisée dans les dernières 24h
          lastQueryAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000)
          }
        },
        orderBy: { lastQueryAt: 'desc' },
        include: { sourcesUsed: true }
      });

      return session;
    } catch (error) {
      console.error('Erreur récupération session active:', error);
      return null;
    }
  }

  // 📚 Récupérer les sources d'une session
  async getSessionSources(sessionId: string): Promise<Array<{ title: string; type: string; id: string }> | null> {
    try {
      const session = await prisma.rAGSession.findUnique({
        where: { id: sessionId },
        include: {
          sourcesUsed: {
            select: {
              id: true,
              title: true,
              sourceType: true
            }
          }
        }
      });

      if (!session || !session.sourcesUsed) {
        return null;
      }

      return session.sourcesUsed.map(source => ({
        id: source.id,
        title: source.title,
        type: source.sourceType || 'unknown'
      }));
    } catch (error) {
      console.error('Erreur récupération sources session:', error);
      return null;
    }
  }

  // 💾 Sauvegarder les sources utilisées dans une session
  async saveSessionSources(sessionId: string, sources: Array<{ id: string; title: string; type: string }>): Promise<boolean> {
    try {
      // D'abord, supprimer les sources existantes pour cette session
      await prisma.rAGSession.update({
        where: { id: sessionId },
        data: {
          sourcesUsed: {
            set: [] // Vider la relation
          }
        }
      });

      // Ensuite, ajouter les nouvelles sources
      const sourceConnections = sources.map(source => ({ id: source.id }));

      await prisma.rAGSession.update({
        where: { id: sessionId },
        data: {
          sourcesUsed: {
            connect: sourceConnections
          }
        }
      });

      console.log(`✅ Session ${sessionId}: ${sources.length} sources sauvegardées`);
      return true;
    } catch (error) {
      console.error('Erreur sauvegarde sources session:', error);
      return false;
    }
  }
}

export const sessionMemory = new SessionMemorySystem();