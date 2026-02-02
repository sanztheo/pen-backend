/**
 * 🔗 Integration Helpers - PEN-18
 * Fonctions d'intégration des services d'intelligence dans QuizStreamingController
 *
 * Ces helpers permettent d'intégrer ThematicClusterer et SmartContentSelector
 * dans le système de streaming SSE existant sans le remplacer.
 */

import { logger } from "../../../utils/logger.js";
import {
  ThematicClustererService,
  ThematicCluster,
} from "./thematicClusterer.js";
import { SmartContentSelectorService } from "./smartContentSelector.js";
import { type SelectedContent } from "./types.js";
import { ConceptExtractorService } from "./conceptExtractor.js";
import { prisma } from "../../../lib/prisma.js";

// ============================================================================
// Types
// ============================================================================

export interface IntelligentGenerationConfig {
  /** Activer la génération intelligente */
  enabled: boolean;
  /** Tokens max pour le contexte RAG enrichi */
  maxTokens?: number;
  /** Équilibrer les types de contenu (définitions, formules, etc.) */
  balanceContentTypes?: boolean;
  /** Générer les noms de clusters avec l'IA */
  generateClusterNames?: boolean;
  /** Nombre minimum de pages pour activer le clustering */
  minPagesForClustering?: number;
}

export interface ClusterQuestionDistribution {
  clusterId: string;
  clusterName: string;
  keywords: string[];
  questionCount: number;
  content: string;
  pageIds: string[];
}

export interface IntelligentContextResult {
  /** Contexte RAG enrichi et priorisé */
  enrichedRagContext: string;
  /** Distribution des questions par cluster */
  questionDistribution: ClusterQuestionDistribution[];
  /** Clusters détectés (pour le frontend) */
  clusters: Array<{
    id: string;
    name: string;
    pageCount: number;
    keywords: string[];
    importance: number;
  }>;
  /** Temps de traitement en ms */
  processingTimeMs: number;
  /** Statistiques */
  stats: {
    totalPages: number;
    totalClusters: number;
    totalTokens: number;
    contentTypes: Record<string, number>;
  };
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: Required<IntelligentGenerationConfig> = {
  enabled: false,
  maxTokens: 8000,
  balanceContentTypes: true,
  generateClusterNames: true,
  minPagesForClustering: 2,
};

// ============================================================================
// Main Integration Functions
// ============================================================================

/**
 * Prépare le contexte intelligent pour la génération de quiz
 * Cette fonction orchestre le clustering et la sélection de contenu
 */
export async function prepareIntelligentContext(
  pageIds: string[],
  questionCount: number,
  config: Partial<IntelligentGenerationConfig> = {},
): Promise<IntelligentContextResult | null> {
  const startTime = Date.now();
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Vérifier si on a assez de pages pour le mode intelligent
  if (!cfg.enabled || pageIds.length < cfg.minPagesForClustering) {
    return null;
  }

  logger.log(
    `🧠 [INTELLIGENT] Préparation contexte intelligent pour ${pageIds.length} pages, ${questionCount} questions`,
  );

  try {
    // 1. S'assurer que les concepts sont extraits pour toutes les pages
    logger.log(`📝 [INTELLIGENT] Vérification/extraction des concepts...`);
    await ensureConceptsExtracted(pageIds);

    // 2. Clustering thématique des pages
    logger.log(`🎯 [INTELLIGENT] Clustering thématique...`);
    const clusterResult = await ThematicClustererService.clusterPages(pageIds, {
      generateNames: cfg.generateClusterNames,
      minClusterSize: 1,
    });

    if (clusterResult.clusters.length === 0) {
      logger.warn(
        `⚠️ [INTELLIGENT] Aucun cluster créé, fallback au mode normal`,
      );
      return null;
    }

    logger.log(
      `✅ [INTELLIGENT] ${clusterResult.clusters.length} clusters créés`,
    );

    // 3. Sélection intelligente du contenu pour chaque cluster
    logger.log(`📦 [INTELLIGENT] Sélection du contenu pertinent...`);
    const tokensPerCluster = Math.floor(
      cfg.maxTokens / clusterResult.clusters.length,
    );

    const selectedContentMap =
      await SmartContentSelectorService.selectForClusters(
        clusterResult.clusters,
        {
          maxTokens: tokensPerCluster,
          balanceTypes: cfg.balanceContentTypes,
        },
      );

    // 4. Distribuer les questions entre les clusters
    const questionDistribution = distributeQuestionsByClusters(
      questionCount,
      clusterResult.clusters,
      selectedContentMap,
    );

    // 5. Construire le contexte RAG enrichi global
    const enrichedRagContext = buildEnrichedRagContext(
      clusterResult.clusters,
      selectedContentMap,
    );

    // 6. Calculer les statistiques
    const stats = calculateStats(clusterResult.clusters, selectedContentMap);

    const processingTimeMs = Date.now() - startTime;
    logger.log(`⏱️ [INTELLIGENT] Contexte préparé en ${processingTimeMs}ms`);

    return {
      enrichedRagContext,
      questionDistribution,
      clusters: clusterResult.clusters.map((c) => ({
        id: c.id,
        name: c.name,
        pageCount: c.pages.length,
        keywords: c.keywords.slice(0, 5),
        importance: c.importance,
      })),
      processingTimeMs,
      stats,
    };
  } catch (error) {
    logger.error(`❌ [INTELLIGENT] Erreur préparation contexte:`, error);
    return null;
  }
}

/**
 * Récupère le contexte spécifique pour une question donnée
 * basé sur la distribution thématique
 */
export function getQuestionContext(
  questionIndex: number,
  distribution: ClusterQuestionDistribution[],
): { content: string; clusterName: string; themeHint: string } | null {
  // Trouver quel cluster doit générer cette question
  let cumulative = 0;
  for (const cluster of distribution) {
    cumulative += cluster.questionCount;
    if (questionIndex < cumulative) {
      return {
        content: cluster.content,
        clusterName: cluster.clusterName,
        themeHint: `Thème: ${cluster.clusterName}. Mots-clés: ${cluster.keywords.join(", ")}`,
      };
    }
  }
  return null;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * S'assure que les concepts sont extraits pour toutes les pages
 */
async function ensureConceptsExtracted(pageIds: string[]): Promise<void> {
  // Vérifier quelles pages ont déjà des concepts
  const existingConcepts = await prisma.pageConcepts.findMany({
    where: { pageId: { in: pageIds } },
    select: { pageId: true, updatedAt: true },
  });

  const existingPageIds = new Set(existingConcepts.map((c) => c.pageId));
  const missingPageIds = pageIds.filter((id) => !existingPageIds.has(id));

  if (missingPageIds.length === 0) {
    logger.log(`✅ [INTELLIGENT] Tous les concepts déjà extraits`);
    return;
  }

  logger.log(
    `📝 [INTELLIGENT] Extraction des concepts pour ${missingPageIds.length} pages...`,
  );

  // Extraire les concepts pour les pages manquantes (en parallèle avec limite)
  const BATCH_SIZE = 5;
  for (let i = 0; i < missingPageIds.length; i += BATCH_SIZE) {
    const batch = missingPageIds.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map((pageId) =>
        ConceptExtractorService.extractAndStore(pageId).catch((err) => {
          logger.warn(
            `⚠️ [INTELLIGENT] Échec extraction page ${pageId}:`,
            err.message,
          );
        }),
      ),
    );
  }
}

/**
 * Distribue les questions entre les clusters de manière proportionnelle
 */
function distributeQuestionsByClusters(
  questionCount: number,
  clusters: ThematicCluster[],
  selectedContentMap: Map<string, SelectedContent>,
): ClusterQuestionDistribution[] {
  // Calculer l'importance totale
  const totalImportance = clusters.reduce((sum, c) => sum + c.importance, 0);

  // Répartition proportionnelle
  const distribution: ClusterQuestionDistribution[] = [];
  let remainingQuestions = questionCount;

  clusters.forEach((cluster, index) => {
    const isLast = index === clusters.length - 1;

    // Calculer le nombre de questions pour ce cluster
    let questionsForCluster: number;
    if (isLast) {
      // Le dernier cluster prend les questions restantes
      questionsForCluster = remainingQuestions;
    } else {
      questionsForCluster = Math.max(
        1, // Au moins 1 question par cluster
        Math.round((cluster.importance / totalImportance) * questionCount),
      );
      questionsForCluster = Math.min(
        questionsForCluster,
        remainingQuestions - (clusters.length - index - 1),
      );
    }

    remainingQuestions -= questionsForCluster;

    // Récupérer le contenu sélectionné pour ce cluster
    const selectedContent = selectedContentMap.get(cluster.id);
    const formattedContent = selectedContent
      ? SmartContentSelectorService.formatForPrompt(selectedContent)
      : "";

    distribution.push({
      clusterId: cluster.id,
      clusterName: cluster.name,
      keywords: cluster.keywords,
      questionCount: questionsForCluster,
      content: formattedContent,
      pageIds: cluster.pages.map((p) => p.id),
    });
  });

  logger.log(
    `📊 [INTELLIGENT] Distribution: ${distribution
      .map((d) => `${d.clusterName}(${d.questionCount})`)
      .join(", ")}`,
  );

  return distribution;
}

/**
 * Construit le contexte RAG enrichi global
 */
function buildEnrichedRagContext(
  clusters: ThematicCluster[],
  selectedContentMap: Map<string, SelectedContent>,
): string {
  const sections: string[] = [];

  sections.push("# Contenu de référence pour la génération de questions\n");

  for (const cluster of clusters) {
    const selectedContent = selectedContentMap.get(cluster.id);
    if (!selectedContent || selectedContent.chunks.length === 0) continue;

    sections.push(`\n## Thème: ${cluster.name}`);
    sections.push(`Mots-clés: ${cluster.keywords.slice(0, 5).join(", ")}`);
    sections.push("");
    sections.push(SmartContentSelectorService.formatForPrompt(selectedContent));
  }

  return sections.join("\n");
}

/**
 * Calcule les statistiques du contexte intelligent
 */
function calculateStats(
  clusters: ThematicCluster[],
  selectedContentMap: Map<string, SelectedContent>,
): IntelligentContextResult["stats"] {
  let totalTokens = 0;
  const contentTypes: Record<string, number> = {};
  const uniquePageIds = new Set<string>();

  for (const cluster of clusters) {
    cluster.pages.forEach((p) => uniquePageIds.add(p.id));

    const selectedContent = selectedContentMap.get(cluster.id);
    if (selectedContent) {
      totalTokens += selectedContent.totalTokens;
      for (const [type, count] of Object.entries(
        selectedContent.typeDistribution,
      ) as [string, number][]) {
        contentTypes[type] = (contentTypes[type] || 0) + count;
      }
    }
  }

  return {
    totalPages: uniquePageIds.size,
    totalClusters: clusters.length,
    totalTokens,
    contentTypes,
  };
}

// ============================================================================
// SSE Event Helpers
// ============================================================================

/**
 * Événements SSE pour le mode intelligent
 */
export interface IntelligentSSEEvents {
  /** Clusters détectés */
  "clusters-detected": {
    clusters: Array<{
      name: string;
      pageCount: number;
      keywords: string[];
      questionCount: number;
    }>;
    totalClusters: number;
    processingTimeMs: number;
  };

  /** Début de génération pour un cluster */
  "cluster-start": {
    clusterName: string;
    clusterIndex: number;
    totalClusters: number;
    questionCount: number;
  };

  /** Fin de génération pour un cluster */
  "cluster-complete": {
    clusterName: string;
    clusterIndex: number;
    questionsGenerated: number;
  };
}

/**
 * Crée l'événement "clusters-detected" pour SSE
 */
export function createClustersDetectedEvent(
  result: IntelligentContextResult,
): IntelligentSSEEvents["clusters-detected"] {
  return {
    clusters: result.questionDistribution.map((d) => ({
      name: d.clusterName,
      pageCount: d.pageIds.length,
      keywords: d.keywords,
      questionCount: d.questionCount,
    })),
    totalClusters: result.clusters.length,
    processingTimeMs: result.processingTimeMs,
  };
}
