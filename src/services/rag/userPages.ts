// 📄 User Pages RAG System - Traitement intelligent des pages workspace
import { prismaEmbeddings as prisma, Prisma } from "../../lib/prismaEmbeddings.js";
import type { RAGChunkInput } from "./index.js";
import { logger } from "../../utils/logger.js";

type PreparedRAGChunkRow = {
  sourceId: string;
  chunkIndex: number;
  content: string;
  cleanContent: string;
  embedding: string;
  tokenCount: number;
  sectionTitle: string | null;
  quality: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export interface UserPageContent {
  id: string;
  title: string;
  content: string;
  userId: string;
  workspaceId: string;
  updatedAt: Date;
}

export class UserPagesRAGSystem {
  /**
   * 🔍 Trouve une source RAG existante pour une page utilisateur
   * @param pageId - ID de la page
   * @param userId - ID de l'utilisateur
   * @param workspaceId - ID du workspace
   * @returns Source RAG existante ou null
   */
  async findExistingSource(
    pageId: string,
    userId: string,
    workspaceId: string,
  ): Promise<{
    id: string;
    updatedAt: Date;
    status: string;
  } | null> {
    try {
      const existingSource = await prisma.rAGSource.findFirst({
        where: {
          sourceType: "WORKSPACE_PAGE",
          userId: userId,
          workspaceId: workspaceId,
          metadata: {
            path: ["pageId"],
            equals: pageId,
          },
        },
        select: {
          id: true,
          updatedAt: true,
          status: true,
        },
      });

      return existingSource;
    } catch (error) {
      logger.error(`❌ [USER-PAGE] Erreur recherche source existante pour page ${pageId}:`, error);
      return null;
    }
  }

  /**
   * 📄 Traite une page utilisateur pour l'embedding RAG
   * @param page - Données de la page
   * @returns ID de la source RAG créée
   */
  async processUserPage(page: UserPageContent): Promise<string | null> {
    try {
      logger.log(`📄 [USER-PAGE] Traitement: "${page.title}" (${page.id})`);

      // 🔍 Vérifier si la page a déjà une source RAG
      const existingSource = await prisma.rAGSource.findFirst({
        where: {
          sourceType: "WORKSPACE_PAGE",
          userId: page.userId,
          workspaceId: page.workspaceId,
          metadata: {
            path: ["pageId"],
            equals: page.id,
          },
        },
      });

      let source;
      if (existingSource) {
        // Vérifier si la page a vraiment changé depuis la dernière fois
        const pageLastModified = page.updatedAt.toISOString();
        const existingLastModified =
          isRecord(existingSource.metadata) &&
          typeof existingSource.metadata["lastModified"] === "string"
            ? existingSource.metadata["lastModified"]
            : undefined;

        if (existingLastModified === pageLastModified && existingSource.status === "COMPLETED") {
          // ✅ Page déjà à jour, juste marquer comme utilisée
          logger.log(`✅ [USER-PAGE] Page "${page.title}" déjà à jour, pas de retraitement`);

          await prisma.rAGSource.update({
            where: { id: existingSource.id },
            data: { lastUsedAt: new Date() },
          });

          return existingSource.id;
        }

        // ♻️ Mise à jour nécessaire de la source existante
        logger.log(`♻️ [USER-PAGE] Mise à jour: "${page.title}"`);

        // Supprimer les anciens chunks
        await prisma.rAGChunk.deleteMany({
          where: { sourceId: existingSource.id },
        });

        // Mettre à jour la source
        source = await prisma.rAGSource.update({
          where: { id: existingSource.id },
          data: {
            title: page.title,
            status: "PROCESSING",
            lastUsedAt: new Date(), // 🔥 Marquer comme utilisée
            updatedAt: new Date(),
            metadata: {
              pageId: page.id,
              contentLength: page.content.length,
              lastModified: page.updatedAt.toISOString(),
            },
          },
        });
      } else {
        // 🆕 Création d'une nouvelle source
        logger.log(`🆕 [USER-PAGE] Nouvelle source: "${page.title}"`);

        source = await prisma.rAGSource.create({
          data: {
            userId: page.userId,
            workspaceId: page.workspaceId,
            sourceType: "WORKSPACE_PAGE",
            title: page.title,
            isGlobal: false, // 🔒 Sources utilisateur privées
            status: "PROCESSING",
            lastUsedAt: new Date(),
            metadata: {
              pageId: page.id,
              contentLength: page.content.length,
              lastModified: page.updatedAt.toISOString(),
            },
          },
        });
      }

      // 📦 Chunking du contenu
      const chunks = await this.chunkUserPageContent(page);

      if (chunks.length === 0) {
        logger.log(`⚠️ [USER-PAGE] Aucun chunk généré pour: "${page.title}"`);

        // Marquer comme failed si pas de contenu utilisable
        await prisma.rAGSource.update({
          where: { id: source.id },
          data: {
            status: "FAILED",
            errorMessage: "Contenu insuffisant pour génération de chunks",
          },
        });

        return null;
      }

      // 🧠 Traitement des chunks avec embeddings
      await this.processUserPageChunks(source.id, chunks);

      // ✅ Finalisation
      await prisma.rAGSource.update({
        where: { id: source.id },
        data: {
          status: "COMPLETED",
          totalChunks: chunks.length,
        },
      });

      logger.log(`✅ [USER-PAGE] Terminé: "${page.title}" (${chunks.length} chunks)`);
      return source.id;
    } catch (error) {
      logger.error(`❌ [USER-PAGE] Erreur traitement "${page.title}":`, error);
      return null;
    }
  }

  /**
   * 🗑️ Supprime la source RAG d'une page utilisateur
   * @param pageId - ID de la page à supprimer
   * @param userId - ID du propriétaire
   * @param workspaceId - ID du workspace
   */
  async removeUserPage(pageId: string, userId: string, workspaceId: string): Promise<boolean> {
    try {
      logger.log(`🗑️ [USER-PAGE] Suppression RAG pour page: ${pageId}`);

      // Supprimer TOUTES les sources RAG liées à cette page (au cas où plusieurs versions existent)
      const result = await prisma.rAGSource.deleteMany({
        where: {
          sourceType: "WORKSPACE_PAGE",
          userId: userId,
          workspaceId: workspaceId,
          metadata: {
            path: ["pageId"],
            equals: pageId,
          },
        },
      });

      logger.log(`✅ [USER-PAGE] Sources RAG supprimées pour page ${pageId}: ${result.count}`);
      return true;
    } catch (error) {
      logger.error(`❌ [USER-PAGE] Erreur suppression:`, error);
      return false;
    }
  }

  /**
   * 🔄 Met à jour le lastUsedAt lors d'une recherche RAG
   * @param sourceIds - IDs des sources RAG utilisées
   * @param userId - ID de l'utilisateur
   */
  async updateLastUsed(sourceIds: string[], userId: string): Promise<void> {
    try {
      await prisma.rAGSource.updateMany({
        where: {
          id: { in: sourceIds },
          sourceType: "WORKSPACE_PAGE",
          userId: userId,
        },
        data: {
          lastUsedAt: new Date(),
        },
      });
    } catch (error) {
      logger.error("❌ [USER-PAGE] Erreur mise à jour lastUsedAt:", error);
    }
  }

  // 📦 Chunking intelligent du contenu utilisateur
  private async chunkUserPageContent(page: UserPageContent): Promise<RAGChunkInput[]> {
    const chunks: RAGChunkInput[] = [];

    // Nettoyer le contenu (markdown → texte)
    const cleanContent = this.cleanMarkdownContent(page.content);

    if (cleanContent.length < 50) {
      logger.log(
        `⚠️ [USER-PAGE] Contenu trop court: "${page.title}" (${cleanContent.length} chars)`,
      );
      return chunks;
    }

    // Diviser par sections si possible (headers markdown)
    const sections = this.extractSections(cleanContent);

    if (sections.length > 1) {
      // Chunking par sections
      for (const section of sections) {
        if (section.content.length > 1500) {
          // Section trop longue → sous-chunks
          const subChunks = this.chunkLongText(section.content);
          chunks.push(
            ...subChunks.map((content) => ({
              content,
              sectionTitle: section.title,
              quality: this.assessContentQuality(content),
            })),
          );
        } else if (section.content.length >= 100) {
          // Section normale
          chunks.push({
            content: section.content,
            sectionTitle: section.title,
            quality: this.assessContentQuality(section.content),
          });
        }
      }
    } else {
      // Pas de sections → chunking par taille
      const textChunks = this.chunkLongText(cleanContent);
      chunks.push(
        ...textChunks.map((content) => ({
          content,
          sectionTitle: page.title,
          quality: this.assessContentQuality(content),
        })),
      );
    }

    return chunks.filter((chunk) => chunk.content.length >= 50);
  }

  // 🧹 Nettoyage du contenu markdown
  private cleanMarkdownContent(content: string): string {
    return (
      content
        // Supprimer les balises HTML
        .replace(/<[^>]+>/g, "")
        // Supprimer les liens markdown [text](url)
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        // Supprimer les images ![alt](url)
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
        // Supprimer le formatting markdown (**, __, etc.)
        .replace(/[*_`]+([^*_`]+)[*_`]+/g, "$1")
        // Nettoyer les headers markdown
        .replace(/^#+\s+/gm, "")
        // Supprimer les lignes vides multiples
        .replace(/\n\s*\n\s*\n/g, "\n\n")
        // Trim global
        .trim()
    );
  }

  // 📚 Extraction des sections depuis markdown
  private extractSections(content: string): Array<{ title: string; content: string }> {
    const sections: Array<{ title: string; content: string }> = [];
    const lines = content.split("\n");

    let currentSection = { title: "Introduction", content: "" };

    for (const line of lines) {
      // Détecter les headers markdown (# ## ###)
      const headerMatch = line.match(/^#+\s+(.+)$/);

      if (headerMatch) {
        // Sauvegarder la section précédente
        if (currentSection.content.trim()) {
          sections.push({
            title: currentSection.title,
            content: currentSection.content.trim(),
          });
        }

        // Nouvelle section
        currentSection = {
          title: headerMatch[1].trim(),
          content: "",
        };
      } else {
        // Contenu de la section
        currentSection.content += line + "\n";
      }
    }

    // Ajouter la dernière section
    if (currentSection.content.trim()) {
      sections.push({
        title: currentSection.title,
        content: currentSection.content.trim(),
      });
    }

    return sections.filter((section) => section.content.length >= 100);
  }

  // ✂️ Découpage de texte long en chunks
  private chunkLongText(text: string): string[] {
    const chunks: string[] = [];
    const maxChunkSize = 1200;
    const paragraphs = text.split("\n\n").filter((p) => p.trim());

    let currentChunk = "";

    for (const paragraph of paragraphs) {
      if (currentChunk.length + paragraph.length > maxChunkSize) {
        // Sauvegarder le chunk actuel
        if (currentChunk.trim()) {
          chunks.push(currentChunk.trim());
        }
        currentChunk = paragraph;
      } else {
        currentChunk += (currentChunk ? "\n\n" : "") + paragraph;
      }
    }

    // Dernier chunk
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  // 🏆 Évaluation de la qualité du contenu
  private assessContentQuality(content: string): number {
    let quality = 1.0;

    // Longueur optimale
    if (content.length >= 200 && content.length <= 1200) {
      quality *= 1.1;
    }

    // Pénalité contenu trop court
    if (content.length < 100) quality *= 0.6;

    // Pénalité contenu trop long
    if (content.length > 2000) quality *= 0.8;

    // Bonus phrases complètes
    const sentences = content.split(/[.!?]+/).filter((s) => s.trim().length > 10);
    if (sentences.length >= 3) quality *= 1.05;

    return Math.min(quality, 1.0);
  }

  // 🧠 Traitement des chunks avec embeddings
  private async processUserPageChunks(sourceId: string, chunks: RAGChunkInput[]): Promise<void> {
    const { mapWithConcurrency, chunkArray } = await import("../../utils/concurrency.js");
    const concurrency = Math.max(1, parseInt(process.env.RAG_EMBEDDING_CONCURRENCY || "2", 10));
    const batchSize = Math.max(1, parseInt(process.env.RAG_DB_BATCH_SIZE || "100", 10));

    const t0 = Date.now();
    logger.log(`⚙️  [USER-PAGE] Embedding ${chunks.length} chunks (x${concurrency})…`);

    const prepared = await mapWithConcurrency(chunks, concurrency, async (chunk, i) => {
      try {
        const embedding = await this.generateEmbedding(chunk.content);
        return {
          sourceId,
          chunkIndex: i,
          content: chunk.content,
          cleanContent: this.cleanContent(chunk.content),
          embedding: JSON.stringify(embedding),
          tokenCount: this.estimateTokens(chunk.content),
          sectionTitle: chunk.sectionTitle ?? null,
          quality: chunk.quality ?? 1.0,
        } satisfies PreparedRAGChunkRow;
      } catch (error) {
        logger.error(`❌ [USER-PAGE] Erreur embedding chunk ${i}:`, error);
        // On ignore ce chunk en cas d'erreur individuelle
        return null;
      }
    });

    const filtered = prepared.filter((row): row is PreparedRAGChunkRow => row !== null);
    let inserted = 0;
    for (const batch of chunkArray(filtered, batchSize)) {
      const values = batch.map(
        (chunk) => Prisma.sql`(
          gen_random_uuid(),
          ${chunk.sourceId}::uuid,
          ${chunk.chunkIndex},
          ${chunk.content},
          ${chunk.cleanContent},
          ${chunk.embedding}::vector,
          ${chunk.tokenCount},
          ${chunk.sectionTitle},
          ${chunk.quality},
          NOW()
        )`,
      );

      await prisma.$executeRaw`
        INSERT INTO "rag_chunks" (
          "id", "source_id", "chunk_index", "content", "clean_content",
          "embedding", "token_count", "section_title", "quality",
          "created_at"
        )
        VALUES ${Prisma.join(values)}
        ON CONFLICT DO NOTHING
      `;
      inserted += batch.length;
      logger.log(`💾 [USER-PAGE] Inséré ${inserted}/${filtered.length} chunks…`);
    }

    logger.log(`✅ [USER-PAGE] Terminé en ${Date.now() - t0} ms`);
  }

  // 🔧 Méthodes utilitaires
  private async generateEmbedding(text: string): Promise<number[]> {
    try {
      // Utilise le service RAG principal
      const { ragSystem } = await import("./index.js");
      return await ragSystem.embeddingService.generateEmbedding(text);
    } catch (error) {
      logger.error("❌ [USER-PAGE] Erreur génération embedding:", error);
      throw error;
    }
  }

  private cleanContent(content: string): string {
    return content
      .replace(/\s+/g, " ")
      .replace(/[^\w\s\-.,;:!?()]/g, "")
      .trim();
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.split(/\s+/).length * 1.3);
  }
}

export const userPagesRAG = new UserPagesRAGSystem();
