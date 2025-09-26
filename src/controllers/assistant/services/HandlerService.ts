/**
 * 🏗️ UNIFIED HANDLER SERVICE
 * Service unifié pour éliminer la duplication entre handlers
 */

import { Request } from 'express';
import { tavilySearch, tavilySearchRefs } from '../helpers/web.js';
import { buildPagesContextChunked } from '../helpers/context.js';
import { DebugLogger } from '../config/debug.js';
import { ValidationUtils } from '../utils/validation.js';

export interface HandlerRequest {
  query: string;
  workspaceId: string;
  pageIds: string[];
  useWeb: boolean;
  ragSources: Array<{ title: string; id?: string; type?: string }>;
  userId: string;
}

export interface ContextResult {
  pageContext: string;
  webContext: string;
  webRefs?: Array<{ title?: string; url?: string }>;
  ragContext?: string;
}

export class AssistantHandlerService {
  /**
   * Trace les paramètres web de manière unifiée
   * FIXE: Code debug identique dans les 3 handlers
   */
  static traceWebParams(mode: 'ASK' | 'SEARCH' | 'CREATE', params: HandlerRequest) {
    DebugLogger.web(`[${mode}] Paramètre useWeb reçu: ${params.useWeb} (type: ${typeof params.useWeb})`);
    DebugLogger.web(`[${mode}] Tous les paramètres:`, JSON.stringify({
      hasQuery: !!params.query,
      workspaceId: !!params.workspaceId,
      pageIdsCount: params.pageIds.length,
      useWeb: params.useWeb,
      ragSourcesCount: params.ragSources.length
    }));
  }

  /**
   * Construction contexte unifiée selon la stratégie
   * FIXE: Construction de contexte similaire mais différente
   */
  static async buildContextStrategy(
    mode: 'ask' | 'search' | 'create',
    request: HandlerRequest
  ): Promise<ContextResult> {
    const { query, workspaceId, pageIds, useWeb, ragSources, userId } = request;

    DebugLogger.performance(`[${mode.toUpperCase()}] Construction contexte - début`);
    const startTime = Date.now();

    // 🧠 RAG: Si sources RAG externes, les utiliser prioritairement
    let ragContext = '';
    let effectivePageIds = pageIds;

    if (ragSources && ragSources.length > 0) {
      DebugLogger.rag(`[${mode.toUpperCase()}] Mode RAG externe détecté avec ${ragSources.length} sources`);
      effectivePageIds = []; // Pas de pages workspace en mode RAG externe

      try {
        ragContext = await this.buildRAGContext(query, ragSources, workspaceId, userId);
      } catch (error) {
        DebugLogger.rag(`[${mode.toUpperCase()}] Erreur construction contexte RAG:`, error);
      }
    }

    // Construction du contexte des pages workspace
    const pageContext = effectivePageIds.length > 0
      ? await buildPagesContextChunked(workspaceId, effectivePageIds, 10, query, 12)
      : '';

    // Recherche web selon le mode
    let webContext = '';
    let webRefs: Array<{ title?: string; url?: string }> = [];

    DebugLogger.web(`[${mode.toUpperCase()}] Avant recherche web - useWeb: ${useWeb}`);

    if (useWeb) {
      if (mode === 'search') {
        const webWithRefs = await tavilySearchRefs(query);
        webContext = webWithRefs.text;
        webRefs = webWithRefs.refs || [];
      } else {
        webContext = await tavilySearch(query);
      }
    }

    // Validation des résultats web
    DebugLogger.web(`[${mode.toUpperCase()}] Après recherche web - useWeb: ${useWeb}`);
    DebugLogger.web(`[${mode.toUpperCase()}] - Web text length: ${webContext.length}`);
    if (useWeb && webContext.length === 0) {
      DebugLogger.web(`[${mode.toUpperCase()}] ⚠️ ATTENTION: Web activé mais aucun contenu trouvé!`);
    }
    if (!useWeb && webContext.length > 0) {
      DebugLogger.web(`[${mode.toUpperCase()}] 🚨 ERREUR: Web désactivé mais contenu présent!`);
    }

    const endTime = Date.now();
    DebugLogger.performance(`[${mode.toUpperCase()}] Construction contexte - fin (${endTime - startTime}ms)`);

    return {
      pageContext,
      webContext,
      webRefs: mode === 'search' ? webRefs : undefined,
      ragContext: ragContext || undefined
    };
  }

  /**
   * Construction contexte RAG
   */
  private static async buildRAGContext(
    query: string,
    ragSources: Array<{ title: string; id?: string; type?: string }>,
    workspaceId: string,
    userId: string
  ): Promise<string> {
    try {
      const { ragSystem } = await import('../../../services/rag/index.js');
      const { prisma } = await import('../../../lib/prisma.js');

      // Extraire les IDs des sources RAG spécifiques
      const ragSourceIds = [];
      for (const ragSource of ragSources) {
        const sourceRecord = await prisma.rAGSource.findFirst({
          where: {
            title: ragSource.title,
            isGlobal: true,
            status: 'COMPLETED'
          },
          select: { id: true }
        });
        if (sourceRecord) {
          ragSourceIds.push(sourceRecord.id);
        }
      }

      DebugLogger.rag(`Sources RAG trouvées: ${ragSourceIds.length} sur ${ragSources.length} demandées`);

      if (ragSourceIds.length === 0) return '';

      const ragResults = await ragSystem.intelligentSearch(query, {
        workspaceId,
        userId,
        limit: 12,
        threshold: 0.15,
        specificSourceIds: ragSourceIds
      });

      if (ragResults.length === 0) {
        DebugLogger.rag('Aucun résultat RAG trouvé');
        return '';
      }

      const ragContext = await ragSystem.buildOptimizedContext(query, ragResults);
      DebugLogger.rag(`Contexte RAG construit: ${ragContext.length} caractères`);

      return ragContext;
    } catch (error) {
      DebugLogger.rag('Erreur construction contexte RAG:', error);
      return '';
    }
  }

  /**
   * Validation et parsing de requête unifié
   */
  static parseRequest(req: Request): { request: HandlerRequest; errors: string[] } {
    if (!req.user) {
      return {
        request: {} as HandlerRequest,
        errors: ['Utilisateur non authentifié']
      };
    }

    const validation = ValidationUtils.validateCommonParams(req.body);

    if (validation.errors.length > 0) {
      return {
        request: {} as HandlerRequest,
        errors: validation.errors
      };
    }

    return {
      request: {
        ...validation.sanitized,
        userId: req.user.id
      },
      errors: []
    };
  }
}