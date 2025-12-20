/**
 * 🎯 Quiz Intelligence - Service de clustering thématique
 * PEN-16: Regroupe les pages par thème similaire pour une génération organisée
 */

import OpenAI from "openai";
import { prisma } from "../../../lib/prisma.js";
import {
  kMeans,
  dbscan,
  calculateCentroid,
  silhouetteScore,
  cosineSimilarity,
} from "../../../utils/clustering.js";
import { ConceptExtractorService } from "./conceptExtractor.js";

// Lazy initialization OpenAI
let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "OPENAI_API_KEY manquant dans les variables d'environnement",
      );
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

/**
 * Page avec ses concepts extraits
 */
export interface PageWithConcepts {
  id: string;
  title: string;
  keywords: string[];
  keyPoints: string[];
  topic: string;
  summary: string;
  difficulty: string;
  embedding: number[];
  wordCount: number;
}

/**
 * Cluster thématique de pages
 */
export interface ThematicCluster {
  id: string;
  name: string;
  description: string;
  pages: PageWithConcepts[];
  centroid: number[];
  importance: number; // 0-1, based on content volume and concept density
  suggestedQuestionCount: number;
  keywords: string[]; // Merged keywords from all pages
  difficulty: "easy" | "medium" | "hard";
}

/**
 * Options de clustering
 */
export interface ClusterOptions {
  algorithm?: "auto" | "kmeans" | "dbscan";
  minClusterSize?: number;
  maxClusters?: number;
  generateNames?: boolean;
}

/**
 * Résultat du clustering
 */
export interface ClusterResult {
  clusters: ThematicCluster[];
  totalPages: number;
  algorithm: string;
  silhouetteScore: number;
  processingTimeMs: number;
}

// Prompt pour générer les noms de clusters
const CLUSTER_NAMING_PROMPT = `<system>
<role>Educational content organizer</role>
<task>Generate a concise thematic name for a cluster of related educational content</task>
</system>

<instructions>
<output_format>JSON with "name" and "description" fields</output_format>
<constraints>
  <constraint>Name must be 2-5 words maximum</constraint>
  <constraint>Description must be 1 short sentence</constraint>
  <constraint>Use the language of the content</constraint>
</constraints>
</instructions>

<example>
<input>Keywords: photosynthèse, chlorophylle, glucose, plantes, lumière</input>
<output>{"name": "Photosynthèse végétale", "description": "Processus de conversion de la lumière en énergie par les plantes."}</output>
</example>`;

/**
 * Service de clustering thématique pour le Quiz Intelligence
 */
export class ThematicClustererService {
  /**
   * Cluster les pages par thème similaire
   * Point d'entrée principal
   */
  static async clusterPages(
    pageIds: string[],
    options: ClusterOptions = {},
  ): Promise<ClusterResult> {
    const startTime = Date.now();
    const {
      algorithm = "auto",
      minClusterSize = 2,
      maxClusters = 10,
      generateNames = true,
    } = options;

    console.log(
      `🎯 [ThematicClusterer] Clustering de ${pageIds.length} pages...`,
    );

    // 1. Récupérer les concepts des pages
    const pagesWithConcepts = await this.getPagesWithConcepts(pageIds);

    if (pagesWithConcepts.length === 0) {
      console.log(`⚠️ [ThematicClusterer] Aucune page avec concepts trouvée`);
      return {
        clusters: [],
        totalPages: 0,
        algorithm: "none",
        silhouetteScore: 0,
        processingTimeMs: Date.now() - startTime,
      };
    }

    // 2. Extraire les embeddings
    const embeddings = pagesWithConcepts.map((p) => p.embedding);
    const validEmbeddings = embeddings.filter((e) => e.length > 0);

    if (validEmbeddings.length < 2) {
      // Pas assez de pages pour clusterer
      console.log(
        `⚠️ [ThematicClusterer] Pas assez de pages avec embeddings (${validEmbeddings.length})`,
      );
      const singleCluster = await this.createSingleCluster(pagesWithConcepts);
      return {
        clusters: [singleCluster],
        totalPages: pagesWithConcepts.length,
        algorithm: "single",
        silhouetteScore: 0,
        processingTimeMs: Date.now() - startTime,
      };
    }

    // 3. Déterminer l'algorithme optimal
    const selectedAlgorithm = this.selectAlgorithm(
      pagesWithConcepts.length,
      algorithm,
    );
    console.log(`🔧 [ThematicClusterer] Algorithme: ${selectedAlgorithm}`);

    // 4. Exécuter le clustering
    let clusterIndices: number[][];
    let usedAlgorithm: string;

    if (selectedAlgorithm === "kmeans") {
      const k = Math.min(maxClusters, Math.ceil(pagesWithConcepts.length / 4));
      const result = kMeans(validEmbeddings, k);
      clusterIndices = result.clusters.filter(
        (c) => c.length >= minClusterSize,
      );
      usedAlgorithm = `kmeans (k=${k})`;
    } else {
      const result = dbscan(validEmbeddings, {
        autoEps: true,
        minPts: minClusterSize,
      });
      clusterIndices = result.clusters.filter(
        (c) => c.length >= minClusterSize,
      );
      // Ajouter les points de bruit comme cluster séparé si nécessaire
      if (result.noise.length >= minClusterSize) {
        clusterIndices.push(result.noise);
      }
      usedAlgorithm = "dbscan (auto-eps)";
    }

    // 5. Créer les clusters thématiques
    let clusters: ThematicCluster[] = [];

    for (let i = 0; i < clusterIndices.length; i++) {
      const indices = clusterIndices[i];
      const clusterPages = indices.map((idx) => pagesWithConcepts[idx]);
      const clusterEmbeddings = indices.map((idx) => validEmbeddings[idx]);

      const cluster = await this.buildCluster(
        `cluster-${i + 1}`,
        clusterPages,
        clusterEmbeddings,
      );
      clusters.push(cluster);
    }

    // Gérer les pages orphelines (non clusterisées)
    const clusteredIndices = new Set(clusterIndices.flat());
    const orphanPages = pagesWithConcepts.filter(
      (_, idx) => !clusteredIndices.has(idx),
    );
    if (orphanPages.length > 0) {
      const orphanEmbeddings = orphanPages.map((p) => p.embedding);
      const orphanCluster = await this.buildCluster(
        "cluster-misc",
        orphanPages,
        orphanEmbeddings,
      );
      orphanCluster.name = "Divers";
      orphanCluster.description = "Pages diverses non regroupées par thème";
      clusters.push(orphanCluster);
    }

    // 6. Générer les noms des clusters avec AI
    if (generateNames && clusters.length > 0) {
      clusters = await this.generateClusterNames(clusters);
    }

    // 7. Calculer les quotas de questions
    clusters = this.calculateQuestionQuotas(clusters, 20); // 20 questions par défaut

    // 8. Calculer le silhouette score
    const silhouette =
      clusterIndices.length > 1
        ? silhouetteScore(validEmbeddings, clusterIndices)
        : 0;

    const processingTimeMs = Date.now() - startTime;
    console.log(
      `✅ [ThematicClusterer] ${clusters.length} clusters créés en ${processingTimeMs}ms`,
    );
    console.log(`   📊 Silhouette score: ${silhouette.toFixed(3)}`);

    return {
      clusters,
      totalPages: pagesWithConcepts.length,
      algorithm: usedAlgorithm,
      silhouetteScore: silhouette,
      processingTimeMs,
    };
  }

  /**
   * Récupère les pages avec leurs concepts depuis la base
   */
  private static async getPagesWithConcepts(
    pageIds: string[],
  ): Promise<PageWithConcepts[]> {
    // D'abord, s'assurer que les concepts sont extraits
    const existingConcepts = await prisma.pageConcepts.findMany({
      where: { pageId: { in: pageIds } },
      select: { pageId: true },
    });
    const existingIds = new Set(existingConcepts.map((c) => c.pageId));

    // Extraire les concepts des pages manquantes
    const missingIds = pageIds.filter((id) => !existingIds.has(id));
    if (missingIds.length > 0) {
      console.log(
        `🧠 [ThematicClusterer] Extraction des concepts pour ${missingIds.length} pages...`,
      );
      await ConceptExtractorService.extractBatch(missingIds);
    }

    // Récupérer toutes les pages avec concepts
    const pagesWithConcepts = await prisma.pageConcepts.findMany({
      where: { pageId: { in: pageIds } },
      include: {
        page: {
          select: { id: true, title: true },
        },
      },
    });

    return pagesWithConcepts.map((pc) => ({
      id: pc.pageId,
      title: pc.page.title,
      keywords: pc.keywords,
      keyPoints: pc.keyPoints,
      topic: pc.topic || "",
      summary: pc.summary || "",
      difficulty: pc.difficulty,
      embedding: pc.embedding,
      wordCount: pc.wordCount,
    }));
  }

  /**
   * Sélectionne l'algorithme optimal selon le nombre de pages
   */
  private static selectAlgorithm(
    pageCount: number,
    requested: "auto" | "kmeans" | "dbscan",
  ): "kmeans" | "dbscan" {
    if (requested !== "auto") return requested;

    // Règles de sélection automatique:
    // - < 5 pages: un seul cluster (géré avant)
    // - 5-20 pages: K-means avec k = ceil(n/4)
    // - > 20 pages: DBSCAN pour détecter automatiquement
    if (pageCount <= 20) {
      return "kmeans";
    }
    return "dbscan";
  }

  /**
   * Construit un cluster à partir des pages
   */
  private static async buildCluster(
    id: string,
    pages: PageWithConcepts[],
    embeddings: number[][],
  ): Promise<ThematicCluster> {
    // Calculer le centroïde
    const centroid = embeddings.length > 0 ? calculateCentroid(embeddings) : [];

    // Fusionner les keywords (fréquence)
    const keywordFreq = new Map<string, number>();
    for (const page of pages) {
      for (const kw of page.keywords) {
        keywordFreq.set(kw, (keywordFreq.get(kw) || 0) + 1);
      }
    }
    const mergedKeywords = [...keywordFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([kw]) => kw);

    // Calculer l'importance (basée sur le volume et la densité)
    const totalWords = pages.reduce((sum, p) => sum + p.wordCount, 0);
    const avgDensity =
      pages.reduce((sum, p) => sum + p.keywords.length, 0) / pages.length;
    const importance = Math.min(1, (totalWords / 5000) * (avgDensity / 10));

    // Déterminer la difficulté moyenne
    const difficultyMap = { easy: 1, medium: 2, hard: 3 };
    const avgDifficulty =
      pages.reduce(
        (sum, p) =>
          sum +
          (difficultyMap[p.difficulty as keyof typeof difficultyMap] || 2),
        0,
      ) / pages.length;
    const difficulty: "easy" | "medium" | "hard" =
      avgDifficulty < 1.5 ? "easy" : avgDifficulty < 2.5 ? "medium" : "hard";

    return {
      id,
      name: `Thème ${id.replace("cluster-", "")}`,
      description: "",
      pages,
      centroid,
      importance,
      suggestedQuestionCount: 0, // Sera calculé après
      keywords: mergedKeywords,
      difficulty,
    };
  }

  /**
   * Crée un cluster unique pour toutes les pages
   */
  private static async createSingleCluster(
    pages: PageWithConcepts[],
  ): Promise<ThematicCluster> {
    const embeddings = pages
      .filter((p) => p.embedding.length > 0)
      .map((p) => p.embedding);

    const cluster = await this.buildCluster("cluster-1", pages, embeddings);
    cluster.name = "Contenu principal";
    cluster.description = "Ensemble du contenu sélectionné";
    cluster.suggestedQuestionCount = 20;
    return cluster;
  }

  /**
   * Génère les noms des clusters avec AI
   */
  private static async generateClusterNames(
    clusters: ThematicCluster[],
  ): Promise<ThematicCluster[]> {
    console.log(
      `🏷️ [ThematicClusterer] Génération des noms pour ${clusters.length} clusters...`,
    );

    const openai = getOpenAI();

    for (const cluster of clusters) {
      if (cluster.id === "cluster-misc") continue; // Skip le cluster divers

      const context = `Keywords: ${cluster.keywords.slice(0, 15).join(", ")}
Topics: ${[...new Set(cluster.pages.map((p) => p.topic))].join(", ")}
Page titles: ${cluster.pages
        .map((p) => p.title)
        .slice(0, 5)
        .join(", ")}`;

      try {
        const response = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: CLUSTER_NAMING_PROMPT },
            { role: "user", content: context },
          ],
          temperature: 0.5,
          max_tokens: 100,
          response_format: { type: "json_object" },
        });

        const result = response.choices[0]?.message?.content;
        if (result) {
          const parsed = JSON.parse(result);
          cluster.name = parsed.name || cluster.name;
          cluster.description = parsed.description || cluster.description;
        }
      } catch (error) {
        console.warn(
          `⚠️ [ThematicClusterer] Erreur naming cluster ${cluster.id}:`,
          error,
        );
      }

      // Pause pour éviter le rate limiting
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return clusters;
  }

  /**
   * Calcule les quotas de questions par cluster
   */
  private static calculateQuestionQuotas(
    clusters: ThematicCluster[],
    totalQuestions: number,
  ): ThematicCluster[] {
    if (clusters.length === 0) return clusters;

    // Calculer l'importance totale
    const totalImportance = clusters.reduce((sum, c) => sum + c.importance, 0);

    // Distribuer proportionnellement
    let remaining = totalQuestions;
    for (let i = 0; i < clusters.length; i++) {
      const cluster = clusters[i];
      const ratio =
        totalImportance > 0
          ? cluster.importance / totalImportance
          : 1 / clusters.length;

      // Minimum 2 questions par cluster
      const quota = Math.max(2, Math.round(totalQuestions * ratio));
      cluster.suggestedQuestionCount = Math.min(quota, remaining);
      remaining -= cluster.suggestedQuestionCount;
    }

    // Distribuer le reste au premier cluster
    if (remaining > 0 && clusters.length > 0) {
      clusters[0].suggestedQuestionCount += remaining;
    }

    return clusters;
  }

  /**
   * Calcule les quotas de questions (version standalone)
   */
  static calculateQuestionDistribution(
    clusters: ThematicCluster[],
    totalQuestions: number,
  ): Map<string, number> {
    const distribution = new Map<string, number>();
    const updated = this.calculateQuestionQuotas([...clusters], totalQuestions);

    for (const cluster of updated) {
      distribution.set(cluster.id, cluster.suggestedQuestionCount);
    }

    return distribution;
  }

  /**
   * Trouve le cluster le plus similaire pour une page
   */
  static findNearestCluster(
    embedding: number[],
    clusters: ThematicCluster[],
  ): ThematicCluster | null {
    if (clusters.length === 0 || embedding.length === 0) return null;

    let nearestCluster: ThematicCluster | null = null;
    let maxSimilarity = -1;

    for (const cluster of clusters) {
      if (cluster.centroid.length === 0) continue;

      const similarity = cosineSimilarity(embedding, cluster.centroid);
      if (similarity > maxSimilarity) {
        maxSimilarity = similarity;
        nearestCluster = cluster;
      }
    }

    return nearestCluster;
  }

  /**
   * Cluster les pages d'un workspace entier
   */
  static async clusterWorkspace(
    workspaceId: string,
    options: ClusterOptions = {},
  ): Promise<ClusterResult> {
    console.log(
      `🎯 [ThematicClusterer] Clustering du workspace ${workspaceId}...`,
    );

    // Récupérer toutes les pages du workspace
    const pages = await prisma.page.findMany({
      where: {
        project: { workspaceId },
        isArchived: false,
        blockNoteContent: { not: undefined },
      },
      select: { id: true },
    });

    const pageIds = pages.map((p) => p.id);
    console.log(`📄 [ThematicClusterer] ${pageIds.length} pages trouvées`);

    return this.clusterPages(pageIds, options);
  }
}
