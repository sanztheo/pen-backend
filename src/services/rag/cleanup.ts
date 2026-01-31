// 🧹 RAG Cleanup Service - Nettoyage automatique des embeddings non utilisés
import { prismaEmbeddings as prisma } from "../../lib/prismaEmbeddings.js";
import { Prisma } from "../../../node_modules/.prisma/client-embeddings/index.js";

// Type pour les sources avec count de chunks
type RAGSourceWithCount = Prisma.RAGSourceGetPayload<{
  include: { _count: { select: { chunks: true } } };
}>;

export interface CleanupStats {
  sourcesDeleted: number;
  chunksDeleted: number;
  spaceFreedMB: number;
  duration: number;
}

export interface CleanupOptions {
  maxAge: number; // en jours
  dryRun?: boolean; // simulation sans suppression
  includeUserSources?: boolean; // inclure les sources utilisateur (par défaut: false, seulement globales)
  batchSize?: number; // taille des lots pour éviter les timeouts
}

export class RAGCleanupService {
  /**
   * 🧹 Nettoie les sources Wikipedia non utilisées depuis X jours
   * @param options - Options de nettoyage
   * @returns Statistiques de nettoyage
   */
  async cleanupUnusedSources(options: CleanupOptions): Promise<CleanupStats> {
    const startTime = Date.now();
    const {
      maxAge = 7,
      dryRun = false,
      includeUserSources = false,
      batchSize = 100,
    } = options;

    console.log(
      `🧹 [CLEANUP] Démarrage nettoyage - Age max: ${maxAge} jours, DryRun: ${dryRun}`,
    );

    // Calculer la date limite
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAge);

    // Trouver les sources candidates au nettoyage
    const candidateSources = await this.findCandidateSources(
      cutoffDate,
      includeUserSources,
    );

    if (candidateSources.length === 0) {
      console.log(`🧹 [CLEANUP] Aucune source à nettoyer`);
      return {
        sourcesDeleted: 0,
        chunksDeleted: 0,
        spaceFreedMB: 0,
        duration: Date.now() - startTime,
      };
    }

    console.log(
      `🧹 [CLEANUP] ${candidateSources.length} sources candidates au nettoyage`,
    );

    let totalSourcesDeleted = 0;
    let totalChunksDeleted = 0;
    let totalSpaceFreed = 0;

    // Traitement par lots pour éviter les timeouts
    for (let i = 0; i < candidateSources.length; i += batchSize) {
      const batch = candidateSources.slice(i, i + batchSize);
      const batchStats = await this.processBatch(batch, dryRun);

      totalSourcesDeleted += batchStats.sourcesDeleted;
      totalChunksDeleted += batchStats.chunksDeleted;
      totalSpaceFreed += batchStats.spaceFreedMB;

      console.log(
        `🧹 [CLEANUP] Lot ${Math.floor(i / batchSize) + 1}/${Math.ceil(candidateSources.length / batchSize)} traité: ${batchStats.sourcesDeleted} sources, ${batchStats.chunksDeleted} chunks`,
      );
    }

    const duration = Date.now() - startTime;

    console.log(
      `🧹 [CLEANUP] Terminé en ${duration}ms - Sources: ${totalSourcesDeleted}, Chunks: ${totalChunksDeleted}, Espace: ${totalSpaceFreed.toFixed(2)}MB`,
    );

    return {
      sourcesDeleted: totalSourcesDeleted,
      chunksDeleted: totalChunksDeleted,
      spaceFreedMB: totalSpaceFreed,
      duration,
    };
  }

  /**
   * 🔍 Trouve les sources candidates au nettoyage
   */
  private async findCandidateSources(
    cutoffDate: Date,
    includeUserSources: boolean,
  ) {
    const whereCondition: Prisma.RAGSourceWhereInput = {
      sourceType: "WIKIPEDIA",
      status: "COMPLETED",
      OR: [
        // Sources jamais utilisées et anciennes
        {
          lastUsedAt: null,
          createdAt: { lt: cutoffDate },
        },
        // Sources utilisées mais pas récemment
        {
          lastUsedAt: { lt: cutoffDate },
        },
      ],
    };

    // Par défaut, seulement les sources globales
    if (!includeUserSources) {
      whereCondition.isGlobal = true;
    }

    return await prisma.rAGSource.findMany({
      where: whereCondition,
      include: {
        _count: {
          select: { chunks: true },
        },
      },
      orderBy: { createdAt: "asc" }, // Plus ancien en premier
    });
  }

  /**
   * 🔄 Traite un lot de sources
   */
  private async processBatch(
    sources: RAGSourceWithCount[],
    dryRun: boolean,
  ): Promise<CleanupStats> {
    let chunksDeleted = 0;
    let sourcesDeleted = 0;
    let spaceFreed = 0;

    for (const source of sources) {
      const chunkCount = source._count.chunks;

      // Estimer l'espace (approximatif: 1KB par chunk)
      const estimatedSizeKB = chunkCount * 1;
      spaceFreed += estimatedSizeKB / 1024; // MB

      chunksDeleted += chunkCount;
      sourcesDeleted += 1;

      if (!dryRun) {
        // Supprimer les chunks d'abord (contrainte de clé étrangère)
        await prisma.rAGChunk.deleteMany({
          where: { sourceId: source.id },
        });

        // Puis supprimer la source
        await prisma.rAGSource.delete({
          where: { id: source.id },
        });
      }

      console.log(
        `${dryRun ? "🔍 [DRY-RUN]" : "🗑️ [DELETE]"} Source: "${source.title}" (${chunkCount} chunks, ${estimatedSizeKB}KB)`,
      );
    }

    return {
      sourcesDeleted,
      chunksDeleted,
      spaceFreedMB: spaceFreed,
      duration: 0,
    };
  }

  /**
   * 📊 Met à jour la date de dernière utilisation d'une source
   * @param sourceId - ID de la source
   */
  async updateLastUsed(sourceId: string): Promise<void> {
    try {
      await prisma.rAGSource.update({
        where: { id: sourceId },
        data: { lastUsedAt: new Date() },
      });
    } catch (error) {
      console.error(
        `🚨 [CLEANUP] Erreur mise à jour lastUsedAt pour ${sourceId}:`,
        error,
      );
    }
  }

  /**
   * 📊 Met à jour la date de dernière utilisation pour plusieurs sources
   * @param sourceIds - IDs des sources
   */
  async updateLastUsedBatch(sourceIds: string[]): Promise<void> {
    if (sourceIds.length === 0) return;

    try {
      await prisma.rAGSource.updateMany({
        where: { id: { in: sourceIds } },
        data: { lastUsedAt: new Date() },
      });
      console.log(
        `📊 [CLEANUP] LastUsedAt mis à jour pour ${sourceIds.length} sources`,
      );
    } catch (error) {
      console.error(`🚨 [CLEANUP] Erreur mise à jour batch lastUsedAt:`, error);
    }
  }

  /**
   * 📈 Obtient les statistiques de stockage RAG
   */
  async getStorageStats() {
    const stats = await prisma.rAGSource.groupBy({
      by: ["sourceType", "isGlobal"],
      _count: { id: true },
      _sum: { totalChunks: true },
    });

    const totalSources = await prisma.rAGSource.count();
    const totalChunks = await prisma.rAGChunk.count();

    return {
      totalSources,
      totalChunks,
      estimatedSizeMB: (totalChunks * 1) / 1024, // 1KB par chunk
      byType: stats.map((stat) => ({
        type: stat.sourceType,
        isGlobal: stat.isGlobal,
        sources: stat._count.id,
        chunks: stat._sum.totalChunks || 0,
      })),
    };
  }

  /**
   * 🔍 Trouve les sources qui seront nettoyées (preview)
   */
  async previewCleanup(
    maxAge: number = 7,
    includeUserSources: boolean = false,
  ) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAge);

    const candidates = await this.findCandidateSources(
      cutoffDate,
      includeUserSources,
    );

    return {
      candidateCount: candidates.length,
      totalChunks: candidates.reduce(
        (sum, s) => sum + ((s as any)._count.chunks || 0),
        0,
      ),
      estimatedSpaceMB: candidates.reduce(
        (sum, s) => sum + ((s as any)._count.chunks || 0) / 1024,
        0,
      ),
      oldestSource: candidates.length > 0 ? candidates[0].createdAt : null,
      sources: candidates.map((s) => ({
        id: s.id,
        title: s.title,
        createdAt: s.createdAt,
        lastUsedAt: s.lastUsedAt,
        chunks: (s as any)._count.chunks,
        isGlobal: s.isGlobal,
      })),
    };
  }

  /**
   * 🧹 Nettoie les fichiers utilisateur non utilisés depuis X jours
   * @param maxAgeDays - Age maximum en jours (défaut: 7)
   * @returns Statistiques de nettoyage
   */
  async cleanupOldUserFiles(
    maxAgeDays: number = 7,
  ): Promise<{ count: number; chunksDeleted: number; spaceFreedMB: number }> {
    const startTime = Date.now();
    console.log(
      `🧹 [CLEANUP-FILE] Démarrage nettoyage fichiers utilisateur (age: ${maxAgeDays} jours)`,
    );

    // Calculer la date limite
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);

    // Trouver les fichiers anciens
    const oldFiles = await prisma.rAGSource.findMany({
      where: {
        sourceType: { in: ["PDF", "TEXT_FILE"] },
        isGlobal: false,
        OR: [
          // Fichiers jamais réutilisés et anciens
          {
            lastUsedAt: null,
            createdAt: { lt: cutoffDate },
          },
          // Fichiers non utilisés depuis X jours
          {
            lastUsedAt: { lt: cutoffDate },
          },
        ],
      },
      include: {
        _count: {
          select: { chunks: true },
        },
      },
    });

    if (oldFiles.length === 0) {
      console.log(`🧹 [CLEANUP-FILE] Aucun fichier à nettoyer`);
      return { count: 0, chunksDeleted: 0, spaceFreedMB: 0 };
    }

    console.log(`🧹 [CLEANUP-FILE] ${oldFiles.length} fichiers à nettoyer`);

    let totalChunksDeleted = 0;
    let totalSpaceFreed = 0;

    // Supprimer les fichiers et leurs chunks
    for (const file of oldFiles) {
      try {
        const chunksCount = (file as any)._count.chunks;

        // Supprimer les chunks
        await prisma.rAGChunk.deleteMany({
          where: { sourceId: file.id },
        });

        // Supprimer la source
        await prisma.rAGSource.delete({
          where: { id: file.id },
        });

        totalChunksDeleted += chunksCount;
        totalSpaceFreed += chunksCount / 1024; // 1KB par chunk approximatif

        console.log(
          `🗑️ [CLEANUP-FILE] Supprimé: "${file.title}" (${chunksCount} chunks)`,
        );
      } catch (error) {
        console.error(
          `❌ [CLEANUP-FILE] Erreur suppression "${file.title}":`,
          error,
        );
      }
    }

    const duration = Date.now() - startTime;
    console.log(
      `✅ [CLEANUP-FILE] Terminé en ${duration}ms - Fichiers: ${oldFiles.length}, Chunks: ${totalChunksDeleted}, Espace: ${totalSpaceFreed.toFixed(2)}MB`,
    );

    return {
      count: oldFiles.length,
      chunksDeleted: totalChunksDeleted,
      spaceFreedMB: totalSpaceFreed,
    };
  }
}

// Instance globale
export const cleanupService = new RAGCleanupService();
