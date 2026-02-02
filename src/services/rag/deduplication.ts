// 🔄 RAG Deduplication System - Évite les doublons d'embeddings
import { prismaEmbeddings as prisma } from "../../lib/prismaEmbeddings.js";
import { Prisma } from "../../../node_modules/.prisma/client-embeddings/index.js";
import type { RAGSourceType } from "../../../node_modules/.prisma/client-embeddings/index.js";

type RAGSourceWithChunkCount = Prisma.RAGSourceGetPayload<{
  include: { _count: { select: { chunks: true } } };
}>;

export interface DeduplicationResult {
  exists: boolean;
  sourceId?: string;
  chunksCount?: number;
  lastUpdated?: Date;
  shouldUpdate?: boolean;
}

export interface SourceFingerprint {
  title: string;
  sourceType: RAGSourceType;
  contentHash?: string;
  originalUrl?: string;
}

export class RAGDeduplicationService {
  /**
   * 🔍 Vérifie si une source Wikipedia existe déjà
   * @param userId - ID de l'utilisateur
   * @param workspaceId - ID du workspace (optionnel)
   * @param title - Titre exact de l'article Wikipedia
   * @returns Résultat de déduplication
   */
  async checkWikipediaExists(
    userId: string,
    workspaceId: string | null,
    title: string,
  ): Promise<DeduplicationResult> {
    // 🌍 ÉTAPE 1: Rechercher d'abord dans les sources GLOBALES partagées
    const globalSource: RAGSourceWithChunkCount | null =
      await prisma.rAGSource.findFirst({
      where: {
        isGlobal: true,
        sourceType: "WIKIPEDIA",
        title: {
          equals: title,
          mode: Prisma.QueryMode.insensitive,
        },
      },
      include: {
        _count: {
          select: { chunks: true },
        },
      },
    });

    if (globalSource && globalSource._count.chunks > 0) {
      console.log(
        `🌍 [DEDUP-GLOBAL] Source Wikipedia globale trouvée: "${title}" (${globalSource._count.chunks} chunks)`,
      );
      return {
        exists: true,
        sourceId: globalSource.id,
        chunksCount: globalSource._count.chunks,
        lastUpdated: globalSource.updatedAt,
        shouldUpdate: false, // Source globale complète, pas besoin de mise à jour
      };
    }

    // 👤 ÉTAPE 2: Si pas de source globale, rechercher dans les sources USER
    const userSource: RAGSourceWithChunkCount | null =
      await prisma.rAGSource.findFirst({
      where: {
        userId,
        workspaceId,
        sourceType: "WIKIPEDIA",
        isGlobal: false,
        title: {
          equals: title,
          mode: Prisma.QueryMode.insensitive,
        },
      },
      include: {
        _count: {
          select: { chunks: true },
        },
      },
    });

    if (!userSource) {
      return { exists: false };
    }

    // Vérifier si l'embedding est complet (au moins 1 chunk)
    const hasChunks = userSource._count.chunks > 0;

    return {
      exists: true,
      sourceId: userSource.id,
      chunksCount: userSource._count.chunks,
      lastUpdated: userSource.updatedAt,
      shouldUpdate: !hasChunks,
    };
  }

  /**
   * 🔍 Vérifie si plusieurs sources Wikipedia existent déjà
   * @param userId - ID de l'utilisateur
   * @param workspaceId - ID du workspace (optionnel)
   * @param titles - Liste des titres à vérifier
   * @returns Map des résultats de déduplication
   */
  async checkMultipleWikipedia(
    userId: string,
    workspaceId: string | null,
    titles: string[],
  ): Promise<Map<string, DeduplicationResult>> {
    const results = new Map<string, DeduplicationResult>();

    // 🌍 ÉTAPE 1: Recherche en batch des sources GLOBALES
    const globalSources: RAGSourceWithChunkCount[] = await prisma.rAGSource.findMany(
      {
      where: {
        isGlobal: true,
        sourceType: "WIKIPEDIA",
        title: {
          in: titles,
          mode: Prisma.QueryMode.insensitive,
        },
      },
      include: {
        _count: {
          select: { chunks: true },
        },
      },
      },
    );

    // 👤 ÉTAPE 2: Recherche en batch des sources USER (pour les titres non trouvés en global)
    const globalTitles = globalSources.map((s) => s.title.toLowerCase());
    const remainingTitles = titles.filter(
      (t) => !globalTitles.includes(t.toLowerCase()),
    );

    const userSources: RAGSourceWithChunkCount[] =
      remainingTitles.length > 0
        ? await prisma.rAGSource.findMany({
            where: {
              userId,
              workspaceId,
              sourceType: "WIKIPEDIA",
              isGlobal: false,
              title: {
                in: remainingTitles,
                mode: Prisma.QueryMode.insensitive,
              },
            },
            include: {
              _count: {
                select: { chunks: true },
              },
            },
          })
        : [];

    // Combiner les sources globales et utilisateur
    const existingSources = [...globalSources, ...userSources];

    // Créer un map des sources existantes (insensible à la casse)
    const existingMap = new Map<string, RAGSourceWithChunkCount>();
    existingSources.forEach((source) => {
      existingMap.set(source.title.toLowerCase(), source);
    });

    // Analyser chaque titre
    titles.forEach((title) => {
      const existing = existingMap.get(title.toLowerCase());

      if (!existing) {
        results.set(title, { exists: false });
      } else {
        const hasChunks = existing._count.chunks > 0;
        results.set(title, {
          exists: true,
          sourceId: existing.id,
          chunksCount: existing._count.chunks,
          lastUpdated: existing.updatedAt,
          shouldUpdate: !hasChunks,
        });
      }
    });

    return results;
  }

  /**
   * 🔍 Vérifie si une source PDF/fichier existe (par hash de contenu)
   * @param userId - ID de l'utilisateur
   * @param workspaceId - ID du workspace (optionnel)
   * @param contentHash - Hash du contenu
   * @param fileName - Nom du fichier (optionnel)
   * @returns Résultat de déduplication
   */
  async checkPDFExists(
    userId: string,
    workspaceId: string | null,
    contentHash: string,
    fileName?: string,
  ): Promise<DeduplicationResult> {
    // Recherche par hash de contenu (plus fiable que le nom)
    const existingSource: RAGSourceWithChunkCount | null =
      await prisma.rAGSource.findFirst({
      where: {
        userId,
        workspaceId,
        sourceType: "PDF",
        OR: [
          {
            metadata: {
              path: ["contentHash"],
              equals: contentHash,
            },
          },
          ...(fileName
            ? [
                {
                  title: {
                    equals: fileName,
                    mode: Prisma.QueryMode.insensitive,
                  },
                },
              ]
            : []),
        ],
      },
      include: {
        _count: {
          select: { chunks: true },
        },
      },
    });

    if (!existingSource) {
      return { exists: false };
    }

    const hasChunks = existingSource._count.chunks > 0;

    return {
      exists: true,
      sourceId: existingSource.id,
      chunksCount: existingSource._count.chunks,
      lastUpdated: existingSource.updatedAt,
      shouldUpdate: !hasChunks,
    };
  }

  /**
   * 📊 Obtient les statistiques de déduplication
   * @param userId - ID de l'utilisateur
   * @param workspaceId - ID du workspace (optionnel)
   * @returns Statistiques détaillées
   */
  async getDeduplicationStats(userId: string, workspaceId: string | null) {
    const stats = await prisma.rAGSource.groupBy({
      by: ["sourceType"],
      where: {
        userId,
        workspaceId,
      },
      _count: {
        id: true,
      },
    });

    return {
      totalSources: await prisma.rAGSource.count({
        where: { userId, workspaceId },
      }),
      byType: stats.reduce(
        (acc, stat) => {
          acc[stat.sourceType] = {
            count: stat._count?.id || 0,
          };
          return acc;
        },
        {} as Record<string, { count: number }>,
      ),
      lastUpdated: new Date(),
    };
  }

  /**
   * 🧹 Nettoie les sources sans chunks (embedding incomplet)
   * @param userId - ID de l'utilisateur
   * @param workspaceId - ID du workspace (optionnel)
   * @param maxAge - Âge maximum en heures (défaut: 24h)
   * @returns Nombre de sources nettoyées
   */
  async cleanupIncompleteEmbeddings(
    userId: string,
    workspaceId: string | null,
    maxAge: number = 24,
  ): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setHours(cutoffDate.getHours() - maxAge);

    // Supprimer les sources sans chunks et anciennes
    const result = await prisma.rAGSource.deleteMany({
      where: {
        userId,
        workspaceId,
        createdAt: {
          lt: cutoffDate,
        },
        chunks: {
          none: {}, // Aucun chunk associé
        },
      },
    });

    return result.count;
  }

  /**
   * 🔄 Force la mise à jour d'une source existante
   * @param sourceId - ID de la source à mettre à jour
   * @returns True si la suppression des chunks a réussi
   */
  async forceUpdate(sourceId: string): Promise<boolean> {
    try {
      // Supprimer tous les chunks existants
      await prisma.rAGChunk.deleteMany({
        where: { sourceId },
      });

      // Marquer la source comme à jour
      await prisma.rAGSource.update({
        where: { id: sourceId },
        data: { updatedAt: new Date() },
      });

      return true;
    } catch (error) {
      console.error("🚨 Erreur lors de la mise à jour forcée:", error);
      return false;
    }
  }
}

// Instance globale
export const deduplicationService = new RAGDeduplicationService();
