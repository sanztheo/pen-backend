/**
 * 🎯 SOURCE SELECTION SERVICE
 * Extraction de la logique complexe de sélection de sources de searchStream.ts
 */

import { prisma } from '../../../lib/prisma.js';
import { selectRelevantPagesWithAssistant } from '../../../services/ai/assistants/selectPages.js';
import { titleRelevanceScore } from '../helpers/scoring.js';
import { DebugLogger } from '../config/debug.js';

export interface SourceSelectionContext {
  query: string;
  workspaceId: string;
  userId: string;
  ragSources: Array<{ title: string; id?: string; type?: string }>;
  sourcesScope?: 'all' | 'selected' | 'auto';
  selectedPageIds: string[];
}

export interface SourceSelectionResult {
  selectedPageIds: string[];
  ragSources: Array<{ title: string; id?: string; type?: string }>;
  strategy: 'rag' | 'workspace_all' | 'workspace_selected' | 'fallback';
}

/**
 * Strategy Pattern pour la sélection de sources
 * FIXE: Triple fallback complexe dans searchStream.ts
 */
export class SourceSelectionService {
  static async selectSources(context: SourceSelectionContext): Promise<SourceSelectionResult> {
    const { query, workspaceId, userId, ragSources, sourcesScope, selectedPageIds } = context;

    DebugLogger.rag(`Sélection sources - query: "${query}", ragSources: ${ragSources.length}, scope: ${sourcesScope}`);

    // Stratégie 1: Sources RAG externes (prioritaire)
    if (ragSources && ragSources.length > 0 && sourcesScope !== 'all') {
      DebugLogger.rag(`Stratégie RAG externe - ${ragSources.length} sources`);
      return {
        selectedPageIds: [],
        ragSources,
        strategy: 'rag'
      };
    }

    // Stratégie 2: Toutes les sources workspace
    if (sourcesScope === 'all') {
      DebugLogger.rag('Stratégie toutes les sources workspace');
      const selectedIds = await this.selectAllWorkspaceSources(query, workspaceId);
      return {
        selectedPageIds: selectedIds,
        ragSources: [],
        strategy: 'workspace_all'
      };
    }

    // Stratégie 3: Sources sélectionnées
    if (selectedPageIds && selectedPageIds.length > 0) {
      DebugLogger.rag(`Stratégie sources sélectionnées - ${selectedPageIds.length} pages`);
      return {
        selectedPageIds,
        ragSources: [],
        strategy: 'workspace_selected'
      };
    }

    // Stratégie 4: Fallback vide
    DebugLogger.rag('Stratégie fallback - aucune source');
    return {
      selectedPageIds: [],
      ragSources: [],
      strategy: 'fallback'
    };
  }

  /**
   * Sélection intelligente toutes sources workspace
   * FIXE: Logique complexe extraite de searchStream.ts:89-134
   */
  private static async selectAllWorkspaceSources(query: string, workspaceId: string): Promise<string[]> {
    try {
      // Récupération des pages
      const allPages = await prisma.page.findMany({
        where: { workspaceId, isArchived: false },
        select: { id: true, title: true },
        orderBy: { updatedAt: 'desc' },
        take: 200
      });

      if (allPages.length === 0) {
        DebugLogger.rag('Aucune page trouvée dans le workspace');
        return [];
      }

      // Sélection IA
      const aiSelection = await selectRelevantPagesWithAssistant({
        question: query,
        pages: allPages.map(p => ({ id: p.id, title: p.title })),
        maxResults: 5
      });

      const initialSelected = aiSelection.selected || [];
      DebugLogger.rag(`IA sélection brute: ${initialSelected.map(p => p.title)}`);

      // Filtrage par pertinence
      const prunedSelection = initialSelected
        .map(p => ({ ...p, score: titleRelevanceScore(p.title, query) }))
        .filter(p => p.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map(p => p.id);

      DebugLogger.rag(`IA sélection filtrée: ${prunedSelection.length} pages`);

      // Fallback si échec IA
      if (prunedSelection.length === 0 || prunedSelection.length === allPages.length) {
        DebugLogger.rag('Échec sélection IA, utilisation fallback intelligent');
        return this.smartFallbackSelection(query, allPages);
      }

      return prunedSelection;
    } catch (error) {
      DebugLogger.rag('Erreur sélection toutes sources:', error);
      return [];
    }
  }

  /**
   * Fallback intelligent si l'IA échoue
   * FIXE: Algorithme de scoring extrait de searchStream.ts:105-128
   */
  private static smartFallbackSelection(query: string, allPages: Array<{ id: string; title: string }>): string[] {
    const scoreTitle = (title: string): number => {
      const queryWords = (query || '').toLowerCase()
        .split(/[^a-zàâçéèêëîïôûùüÿñæœ0-9]+/)
        .filter(w => w.length >= 2);

      const titleLower = (title || '').toLowerCase();
      let totalScore = 0;

      for (const word of queryWords) {
        if (titleLower.includes(word)) {
          totalScore += word.length * 2;
        }

        const wordParts = word.split('');
        let partialMatch = 0;
        for (const char of wordParts) {
          if (titleLower.includes(char)) partialMatch++;
        }
        totalScore += (partialMatch / word.length) * 0.5;
      }

      return totalScore;
    };

    const scored = allPages
      .map(p => ({ ...p, score: scoreTitle(p.title) }))
      .filter(p => p.score > 0)
      .sort((a, b) => b.score - a.score);

    const selectedIds = scored.slice(0, Math.min(5, scored.length)).map(p => p.id);

    DebugLogger.rag(`Fallback sélection: ${scored.slice(0, 5).map(p => `${p.title} (${p.score})`).join(', ')}`);

    // Fallback final : pages récentes
    if (selectedIds.length === 0) {
      const fallbackIds = allPages.slice(0, 3).map(p => p.id);
      DebugLogger.rag('Fallback final: pages récentes');
      return fallbackIds;
    }

    return selectedIds;
  }
}