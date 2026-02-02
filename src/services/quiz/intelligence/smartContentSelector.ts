/**
 * 📋 Quiz Intelligence - Service de sélection intelligente de contenu
 * PEN-17: Sélectionne le contenu pertinent pour la génération de questions
 */

import { prisma } from "../../../lib/prisma.js";
import { extractTextFromBlockNote } from "../../../controllers/assistant/helpers/blocknote.js";
import {
  type ContentType,
  type ContentChunk,
  type SelectionOptions,
  type SelectedContent,
  CONTENT_PRIORITY,
} from "./types.js";
import type { ThematicCluster, PageWithConcepts } from "./thematicClusterer.js";

// Estimation tokens: ~4 chars par token en moyenne
const CHARS_PER_TOKEN = 4;

/**
 * Estime le nombre de tokens dans un texte
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Service de sélection intelligente de contenu pour Quiz Intelligence
 */
export class SmartContentSelectorService {
  /**
   * Sélectionne le contenu pertinent pour un cluster
   * Point d'entrée principal
   */
  static async selectForCluster(
    cluster: ThematicCluster,
    options: SelectionOptions = {},
  ): Promise<SelectedContent> {
    const startTime = Date.now();
    const {
      maxTokens = 8000,
      minCoverage = 0.3,
      balanceTypes = true,
    } = options;

    console.log(
      `📋 [SmartSelector] Sélection pour cluster "${cluster.name}" (${cluster.pages.length} pages)...`,
    );

    // 1. Extraire tous les chunks de contenu des pages
    const allChunks = await this.extractChunksFromPages(cluster.pages);
    console.log(`   📦 ${allChunks.length} chunks extraits`);

    if (allChunks.length === 0) {
      return {
        clusterId: cluster.id,
        clusterName: cluster.name,
        chunks: [],
        totalTokens: 0,
        coverage: 0,
        typeDistribution: {
          definition: 0,
          formula: 0,
          keypoint: 0,
          example: 0,
          paragraph: 0,
        },
        processingTimeMs: Date.now() - startTime,
      };
    }

    // 2. Prioriser les chunks
    const prioritizedChunks = this.prioritizeChunks(allChunks, options);

    // 3. Sélectionner dans la limite de tokens
    const selectedChunks = balanceTypes
      ? this.selectBalanced(prioritizedChunks, maxTokens)
      : this.selectGreedy(prioritizedChunks, maxTokens);

    // 4. Calculer la couverture
    const totalOriginalTokens = allChunks.reduce((sum, c) => sum + c.tokens, 0);
    const selectedTokens = selectedChunks.reduce((sum, c) => sum + c.tokens, 0);
    const coverage =
      totalOriginalTokens > 0 ? selectedTokens / totalOriginalTokens : 0;

    // 5. Calculer la distribution par type
    const typeDistribution = this.calculateTypeDistribution(selectedChunks);

    const processingTimeMs = Date.now() - startTime;
    console.log(
      `✅ [SmartSelector] ${selectedChunks.length} chunks sélectionnés (${selectedTokens} tokens, ${(coverage * 100).toFixed(1)}% coverage)`,
    );

    // Avertir si couverture insuffisante
    if (coverage < minCoverage) {
      console.warn(
        `⚠️ [SmartSelector] Couverture faible (${(coverage * 100).toFixed(1)}% < ${minCoverage * 100}%)`,
      );
    }

    return {
      clusterId: cluster.id,
      clusterName: cluster.name,
      chunks: selectedChunks,
      totalTokens: selectedTokens,
      coverage,
      typeDistribution,
      processingTimeMs,
    };
  }

  /**
   * Extrait les chunks de contenu des pages
   */
  private static async extractChunksFromPages(
    pages: PageWithConcepts[],
  ): Promise<ContentChunk[]> {
    const chunks: ContentChunk[] = [];

    for (const page of pages) {
      // Récupérer le contenu BlockNote de la page
      const pageData = await prisma.page.findUnique({
        where: { id: page.id },
        select: { blockNoteContent: true },
      });

      if (!pageData?.blockNoteContent) continue;

      const blocks = pageData.blockNoteContent as unknown[];
      let chunkIndex = 0;

      // 1. Extraire les définitions depuis les concepts
      const concepts = await prisma.pageConcepts.findUnique({
        where: { pageId: page.id },
      });

      if (concepts?.definitions) {
        const definitions = concepts.definitions as Record<string, string>;
        for (const [term, definition] of Object.entries(definitions)) {
          const content = `${term}: ${definition}`;
          chunks.push({
            id: `${page.id}-def-${chunkIndex++}`,
            pageId: page.id,
            pageTitle: page.title,
            type: "definition",
            content,
            tokens: estimateTokens(content),
            priority: CONTENT_PRIORITY.definition,
            metadata: { term, index: chunkIndex },
          });
        }
      }

      // 2. Extraire les formules
      if (concepts?.formulas && concepts.formulas.length > 0) {
        for (const formula of concepts.formulas) {
          const content = `Formula: $${formula}$`;
          chunks.push({
            id: `${page.id}-formula-${chunkIndex++}`,
            pageId: page.id,
            pageTitle: page.title,
            type: "formula",
            content,
            tokens: estimateTokens(content),
            priority: CONTENT_PRIORITY.formula,
            metadata: { formula, index: chunkIndex },
          });
        }
      }

      // 3. Extraire les keypoints
      if (concepts?.keyPoints && concepts.keyPoints.length > 0) {
        for (const keypoint of concepts.keyPoints) {
          chunks.push({
            id: `${page.id}-keypoint-${chunkIndex++}`,
            pageId: page.id,
            pageTitle: page.title,
            type: "keypoint",
            content: keypoint,
            tokens: estimateTokens(keypoint),
            priority: CONTENT_PRIORITY.keypoint,
            metadata: { index: chunkIndex },
          });
        }
      }

      // 4. Extraire les paragraphes du contenu BlockNote
      const paragraphs = this.extractParagraphs(blocks);
      for (const para of paragraphs) {
        if (para.length < 50) continue; // Ignorer les paragraphes trop courts

        // Détecter si c'est un exemple
        const isExample =
          para.toLowerCase().includes("exemple") ||
          para.toLowerCase().includes("example") ||
          para.toLowerCase().includes("par exemple") ||
          para.toLowerCase().includes("for instance");

        const type: ContentType = isExample ? "example" : "paragraph";

        chunks.push({
          id: `${page.id}-para-${chunkIndex++}`,
          pageId: page.id,
          pageTitle: page.title,
          type,
          content: para,
          tokens: estimateTokens(para),
          priority: CONTENT_PRIORITY[type],
          metadata: { index: chunkIndex },
        });
      }
    }

    return chunks;
  }

  /**
   * Extrait les paragraphes d'un contenu BlockNote
   */
  private static extractParagraphs(blocks: unknown[]): string[] {
    const paragraphs: string[] = [];

    for (const block of blocks) {
      if (!isRecord(block)) continue;

      const type = block.type;
      if (type === "paragraph" || type === "heading") {
        const text = extractTextFromBlockNote([block]);
        if (text.trim().length > 0) {
          paragraphs.push(text.trim());
        }
      }

      // Récursion pour les blocs imbriqués
      if (Array.isArray(block.children)) {
        paragraphs.push(...this.extractParagraphs(block.children));
      }
    }

    return paragraphs;
  }

  /**
   * Priorise les chunks selon les options
   */
  private static prioritizeChunks(
    chunks: ContentChunk[],
    options: SelectionOptions,
  ): ContentChunk[] {
    const { prioritizeTypes } = options;

    // Calculer la priorité ajustée
    const adjustedChunks = chunks.map((chunk) => {
      let adjustedPriority = chunk.priority;

      // Bonus pour les types prioritaires
      if (prioritizeTypes && prioritizeTypes.includes(chunk.type)) {
        adjustedPriority += 50;
      }

      // Malus pour les chunks très longs (moins efficaces)
      if (chunk.tokens > 500) {
        adjustedPriority -= 10;
      }

      return { ...chunk, priority: adjustedPriority };
    });

    // Trier par priorité décroissante
    return adjustedChunks.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Sélection greedy (par priorité)
   */
  private static selectGreedy(
    chunks: ContentChunk[],
    maxTokens: number,
  ): ContentChunk[] {
    const selected: ContentChunk[] = [];
    let currentTokens = 0;

    for (const chunk of chunks) {
      if (currentTokens + chunk.tokens <= maxTokens) {
        selected.push(chunk);
        currentTokens += chunk.tokens;
      }
    }

    return selected;
  }

  /**
   * Sélection équilibrée (diversité des types)
   */
  private static selectBalanced(
    chunks: ContentChunk[],
    maxTokens: number,
  ): ContentChunk[] {
    const selected: ContentChunk[] = [];
    let currentTokens = 0;

    // Grouper par type
    const byType = new Map<ContentType, ContentChunk[]>();
    for (const chunk of chunks) {
      if (!byType.has(chunk.type)) {
        byType.set(chunk.type, []);
      }
      byType.get(chunk.type)!.push(chunk);
    }

    // Quotas par type (proportionnels à la priorité)
    const typeOrder: ContentType[] = [
      "definition",
      "formula",
      "keypoint",
      "example",
      "paragraph",
    ];

    // Round-robin par type jusqu'à atteindre la limite
    let round = 0;
    let addedInRound = true;

    while (currentTokens < maxTokens && addedInRound) {
      addedInRound = false;

      for (const type of typeOrder) {
        const typeChunks = byType.get(type);
        if (!typeChunks || typeChunks.length <= round) continue;

        const chunk = typeChunks[round];
        if (currentTokens + chunk.tokens <= maxTokens) {
          selected.push(chunk);
          currentTokens += chunk.tokens;
          addedInRound = true;
        }
      }

      round++;
    }

    return selected;
  }

  /**
   * Calcule la distribution par type
   */
  private static calculateTypeDistribution(
    chunks: ContentChunk[],
  ): Record<ContentType, number> {
    const distribution: Record<ContentType, number> = {
      definition: 0,
      formula: 0,
      keypoint: 0,
      example: 0,
      paragraph: 0,
    };

    for (const chunk of chunks) {
      distribution[chunk.type]++;
    }

    return distribution;
  }

  /**
   * Sélectionne le contenu pour plusieurs clusters
   */
  static async selectForClusters(
    clusters: ThematicCluster[],
    options: SelectionOptions = {},
  ): Promise<Map<string, SelectedContent>> {
    console.log(
      `📋 [SmartSelector] Sélection pour ${clusters.length} clusters...`,
    );

    const results = new Map<string, SelectedContent>();

    for (const cluster of clusters) {
      const selected = await this.selectForCluster(cluster, options);
      results.set(cluster.id, selected);
    }

    return results;
  }

  /**
   * Optimise la sélection pour une limite de tokens stricte
   * Utilisé quand on doit absolument respecter une limite
   */
  static optimizeForTokenLimit(
    chunks: ContentChunk[],
    maxTokens: number,
  ): ContentChunk[] {
    // Algorithme du sac à dos simplifié (greedy par ratio valeur/poids)
    const scored = chunks.map((chunk) => ({
      chunk,
      ratio: chunk.priority / chunk.tokens,
    }));

    scored.sort((a, b) => b.ratio - a.ratio);

    const selected: ContentChunk[] = [];
    let currentTokens = 0;

    for (const { chunk } of scored) {
      if (currentTokens + chunk.tokens <= maxTokens) {
        selected.push(chunk);
        currentTokens += chunk.tokens;
      }
    }

    return selected;
  }

  /**
   * Génère un résumé du contenu sélectionné pour le prompt AI
   */
  static formatForPrompt(selected: SelectedContent): string {
    const lines: string[] = [];

    // Grouper par page
    const byPage = new Map<string, ContentChunk[]>();
    for (const chunk of selected.chunks) {
      if (!byPage.has(chunk.pageId)) {
        byPage.set(chunk.pageId, []);
      }
      byPage.get(chunk.pageId)!.push(chunk);
    }

    for (const [pageId, chunks] of byPage) {
      const pageTitle = chunks[0]?.pageTitle || pageId;
      lines.push(`\n## ${pageTitle}\n`);

      // Regrouper par type pour une meilleure lisibilité
      const definitions = chunks.filter((c) => c.type === "definition");
      const formulas = chunks.filter((c) => c.type === "formula");
      const keypoints = chunks.filter((c) => c.type === "keypoint");
      const examples = chunks.filter((c) => c.type === "example");
      const paragraphs = chunks.filter((c) => c.type === "paragraph");

      if (definitions.length > 0) {
        lines.push("### Definitions");
        for (const def of definitions) {
          lines.push(`- ${def.content}`);
        }
      }

      if (formulas.length > 0) {
        lines.push("### Formulas");
        for (const formula of formulas) {
          lines.push(`- ${formula.content}`);
        }
      }

      if (keypoints.length > 0) {
        lines.push("### Key Points");
        for (const kp of keypoints) {
          lines.push(`- ${kp.content}`);
        }
      }

      if (examples.length > 0) {
        lines.push("### Examples");
        for (const ex of examples) {
          lines.push(ex.content);
        }
      }

      if (paragraphs.length > 0) {
        lines.push("### Content");
        for (const para of paragraphs) {
          lines.push(para.content);
        }
      }
    }

    return lines.join("\n");
  }
}
