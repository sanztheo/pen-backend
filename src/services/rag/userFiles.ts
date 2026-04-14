// 📄 User Files RAG System - Traitement intelligent des fichiers utilisateur
import { prismaEmbeddings as prisma, type Prisma } from "../../lib/prismaEmbeddings.js";
import crypto from "crypto";
import type { RAGChunkInput } from "./index.js";
import { logger } from "../../utils/logger.js";
import { RAG_CONFIG } from "./config.js";
import { extractPdfMarkdown } from "../ocr/mistralOcr.js";

type RAGSourceWithChunkCount = Prisma.RAGSourceGetPayload<{
  include: { _count: { select: { chunks: true } } };
}>;

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

export interface UserFileContent {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  userId: string;
  workspaceId: string;
}

export class UserFilesRAGSystem {
  /**
   * 🔑 Calcule le hash SHA-256 du contenu pour déduplication
   * @param buffer - Buffer du fichier
   * @returns Hash hexadécimal
   */
  private calculateContentHash(buffer: Buffer): string {
    return crypto.createHash("sha256").update(buffer).digest("hex");
  }

  /**
   * 🔍 Trouve une source existante par hash de contenu
   * @param userId - ID de l'utilisateur
   * @param workspaceId - ID du workspace
   * @param contentHash - Hash du contenu
   * @returns Source existante ou null
   */
  async findExistingByHash(
    userId: string,
    workspaceId: string,
    contentHash: string,
  ): Promise<{
    id: string;
    lastUsedAt: Date | null;
    status: string;
    chunksCount: number;
  } | null> {
    try {
      const existingSource: RAGSourceWithChunkCount | null = await prisma.rAGSource.findFirst({
        where: {
          userId,
          workspaceId,
          sourceType: { in: ["PDF", "TEXT_FILE"] },
          isGlobal: false,
          metadata: {
            path: ["contentHash"],
            equals: contentHash,
          },
        },
        include: {
          _count: {
            select: { chunks: true },
          },
        },
      });

      if (!existingSource) return null;

      return {
        id: existingSource.id,
        lastUsedAt: existingSource.lastUsedAt,
        status: existingSource.status,
        chunksCount: existingSource._count.chunks,
      };
    } catch (error) {
      logger.error(`❌ [USER-FILE] Erreur recherche source par hash:`, error);
      return null;
    }
  }

  /**
   * 📄 Extrait le texte d'un fichier selon son type MIME
   * @param buffer - Buffer du fichier
   * @param mimeType - Type MIME
   * @returns Texte extrait
   */
  private async extractFileContent(
    buffer: Buffer,
    mimeType: string,
    fileName: string,
  ): Promise<string> {
    try {
      switch (mimeType) {
        case "application/pdf": {
          // PDF via Mistral OCR (markdown structured output)
          return await extractPdfMarkdown(buffer, fileName);
        }

        case "text/plain":
        case "text/markdown":
          // TXT/MD direct
          return buffer.toString("utf-8");

        case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        case "application/msword": {
          // DOC/DOCX via mammoth
          const mammoth = await import("mammoth");
          const result = await mammoth.extractRawText({ buffer });
          return result.value || "";
        }

        case "text/csv": {
          // CSV via papaparse
          const Papa = await import("papaparse");
          const text = buffer.toString("utf-8");
          const parsed = Papa.default.parse<Record<string, unknown>>(text, {
            header: true,
          });
          // Convertir en texte lisible
          return parsed.data
            .map((row) =>
              Object.entries(row)
                .map(([k, v]) => `${k}: ${String(v)}`)
                .join(", "),
            )
            .join("\n");
        }

        case "application/json": {
          // JSON formaté
          const text = buffer.toString("utf-8");
          const parsed = JSON.parse(text);
          return JSON.stringify(parsed, null, 2);
        }

        case "text/html": {
          // HTML → Markdown via turndown
          // @ts-expect-error - turndown n'a pas de types declares (@types/turndown)
          const TurndownService = (await import("turndown")).default;
          const turndownService = new TurndownService();
          const html = buffer.toString("utf-8");
          return turndownService.turndown(html);
        }

        default:
          logger.warn(`⚠️ [USER-FILE] Type MIME non supporté: ${mimeType}`);
          return buffer.toString("utf-8");
      }
    } catch (error) {
      logger.error(`❌ [USER-FILE] Erreur extraction contenu (${mimeType}):`, error);
      throw new Error(
        `Impossible d'extraire le contenu: ${error instanceof Error ? error.message : "Erreur inconnue"}`,
      );
    }
  }

  /**
   * 🧩 Découpe intelligente du texte en chunks
   * @param text - Texte complet
   * @param fileName - Nom du fichier (pour contexte)
   * @returns Chunks prêts pour embedding
   */
  private intelligentChunking(text: string, fileName: string): RAGChunkInput[] {
    const maxChunkSize = 1000; // tokens approximatifs
    const chunks: RAGChunkInput[] = [];

    // Nettoyage basique
    const cleaned = text
      .replace(/\r\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    if (!cleaned) {
      return [];
    }

    // Découpage par paragraphes si possible
    const paragraphs = cleaned.split(/\n\n+/);
    let currentChunk = "";

    for (const paragraph of paragraphs) {
      const paragraphTokens = this.estimateTokens(paragraph);

      // Si un paragraphe seul dépasse la limite, le découper par phrases
      if (paragraphTokens > maxChunkSize) {
        if (currentChunk) {
          chunks.push({
            content: currentChunk.trim(),
            quality: this.assessContentQuality(currentChunk),
            sectionTitle: fileName,
          });
          currentChunk = "";
        }

        // Découper le gros paragraphe
        const sentences = paragraph.match(/[^.!?]+[.!?]+/g) || [paragraph];
        for (const sentence of sentences) {
          if (this.estimateTokens(currentChunk + sentence) > maxChunkSize) {
            if (currentChunk) {
              chunks.push({
                content: currentChunk.trim(),
                quality: this.assessContentQuality(currentChunk),
                sectionTitle: fileName,
              });
            }
            currentChunk = sentence;
          } else {
            currentChunk += sentence;
          }
        }
      } else {
        // Ajouter le paragraphe au chunk actuel
        if (this.estimateTokens(currentChunk + "\n\n" + paragraph) > maxChunkSize) {
          if (currentChunk) {
            chunks.push({
              content: currentChunk.trim(),
              quality: this.assessContentQuality(currentChunk),
              sectionTitle: fileName,
            });
          }
          currentChunk = paragraph;
        } else {
          currentChunk += (currentChunk ? "\n\n" : "") + paragraph;
        }
      }
    }

    // Ajouter le dernier chunk
    if (currentChunk.trim()) {
      chunks.push({
        content: currentChunk.trim(),
        quality: this.assessContentQuality(currentChunk),
        sectionTitle: fileName,
      });
    }

    logger.log(`🧩 [USER-FILE] Chunking: ${text.length} chars → ${chunks.length} chunks`);
    return chunks;
  }

  /**
   * 📊 Estime le nombre de tokens (approximatif)
   * @param text - Texte à analyser
   * @returns Nombre de tokens estimé
   */
  private estimateTokens(text: string): number {
    // Estimation approximative: ~4 caractères par token en français
    return Math.ceil(text.length / 4);
  }

  /**
   * 🎯 Évalue la qualité d'un chunk
   * @param content - Contenu du chunk
   * @returns Score de qualité (0-1)
   */
  private assessContentQuality(content: string): number {
    let score = 1.0;

    // Pénaliser les chunks trop courts
    if (content.length < 100) score *= 0.5;

    // Pénaliser les chunks avec beaucoup de caractères spéciaux/répétitions
    const specialCharsRatio =
      (content.match(/[^a-zA-Z0-9\sàâäéèêëïîôùûüÿçœæ]/g) || []).length / content.length;
    if (specialCharsRatio > 0.3) score *= 0.7;

    // Bonus si le chunk contient des mots significatifs
    const meaningfulWords = content.match(/\b[a-zA-Zàâäéèêëïîôùûüÿçœæ]{4,}\b/g) || [];
    if (meaningfulWords.length > 10) score *= 1.2;

    return Math.min(1.0, Math.max(0.1, score));
  }

  /**
   * 🧠 Génère un embedding via OpenAI
   * @param text - Texte à embedder
   * @returns Vecteur d'embedding
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    try {
      const { ragSystem } = await import("./index.js");
      const t0 = Date.now();
      logger.log(`🚀 [EMBEDDING-FAST] Génération OpenAI pour: "${text.substring(0, 50)}..."`);

      const embedding = await ragSystem.embeddingService.generateEmbedding(text);

      logger.log(
        `✅ [EMBEDDING-FAST] Embedding généré en ${Date.now() - t0}ms: ${embedding.length} dimensions`,
      );
      return embedding;
    } catch (error) {
      logger.error("❌ [USER-FILE] Erreur génération embedding:", error);
      throw error;
    }
  }

  /**
   * 🔧 Nettoie le contenu pour stockage
   * @param content - Contenu brut
   * @returns Contenu nettoyé
   */
  private cleanContent(content: string): string {
    return content.replace(/\s+/g, " ").replace(/\n+/g, "\n").trim();
  }

  /**
   * ⚙️ Traite les chunks avec embeddings parallèles
   * @param sourceId - ID de la source RAG
   * @param chunks - Chunks à traiter
   */
  private async processFileChunks(sourceId: string, chunks: RAGChunkInput[]): Promise<void> {
    const { mapWithConcurrency, chunkArray } = await import("../../utils/concurrency.js");
    const concurrency = RAG_CONFIG.EMBEDDING_CONCURRENCY;
    const batchSize = RAG_CONFIG.DB_BATCH_SIZE;

    const t0 = Date.now();
    logger.log(`⚙️  [USER-FILE] Embedding ${chunks.length} chunks (x${concurrency})…`);

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
        logger.error(`❌ [USER-FILE] Erreur embedding chunk ${i}:`, error);
        return null;
      }
    });

    const filtered = prepared.filter((row): row is PreparedRAGChunkRow => row !== null);
    let inserted = 0;
    for (const batch of chunkArray(filtered, batchSize)) {
      // Utiliser SQL brut pour insérer les embeddings (Prisma ne supporte pas vector nativement)
      for (const chunk of batch) {
        await prisma.$executeRaw`
          INSERT INTO "rag_chunks" (
            "id", "source_id", "chunk_index", "content", "clean_content",
            "embedding", "token_count", "section_title", "quality",
            "created_at"
          )
          VALUES (
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
          )
          ON CONFLICT DO NOTHING
        `;
        inserted++;
      }
      logger.log(`💾 [USER-FILE] Inséré ${inserted}/${filtered.length} chunks…`);
    }

    logger.log(`✅ [USER-FILE] Terminé en ${Date.now() - t0} ms`);
  }

  /**
   * 📄 Point d'entrée principal: traite un fichier utilisateur
   * @param file - Données du fichier
   * @returns ID de la source RAG créée/réutilisée
   */
  async processUserFile(file: UserFileContent): Promise<string | null> {
    try {
      logger.log(`📄 [USER-FILE] Traitement: "${file.fileName}" (${file.mimeType})`);

      // 1. Calculer le hash du contenu
      const contentHash = this.calculateContentHash(file.buffer);
      logger.log(`🔑 [USER-FILE] Hash: ${contentHash.substring(0, 16)}...`);

      // 2. Vérifier si une source existe déjà avec ce hash
      const existingSource = await this.findExistingByHash(
        file.userId,
        file.workspaceId,
        contentHash,
      );

      // 3. Logique de déduplication
      if (existingSource) {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const lastUsed = existingSource.lastUsedAt ? new Date(existingSource.lastUsedAt) : null;
        const isOlderThan7Days = !lastUsed || lastUsed < sevenDaysAgo;

        // Si hash identique ET moins de 7 jours → réutiliser
        if (
          !isOlderThan7Days &&
          existingSource.status === "COMPLETED" &&
          existingSource.chunksCount > 0
        ) {
          logger.log(
            `♻️ [DEDUP-FILE] Réutilisation: "${file.fileName}" (${existingSource.chunksCount} chunks existants)`,
          );

          await prisma.rAGSource.update({
            where: { id: existingSource.id },
            data: { lastUsedAt: new Date() },
          });

          return existingSource.id;
        }

        // Si > 7 jours OU chunks manquants → ré-embedder
        logger.log(
          `🔄 [DEDUP-FILE] Re-embedding nécessaire: "${file.fileName}" (raison: ${isOlderThan7Days ? ">7 jours" : "chunks manquants"})`,
        );

        // Supprimer les anciens chunks
        await prisma.rAGChunk.deleteMany({
          where: { sourceId: existingSource.id },
        });
      }

      // 4. Extraction du texte
      logger.log(`📝 [USER-FILE] Extraction du contenu...`);
      const extractedText = await this.extractFileContent(
        file.buffer,
        file.mimeType,
        file.fileName,
      );

      if (!extractedText || extractedText.trim().length < 10) {
        throw new Error("Contenu extrait vide ou trop court");
      }

      logger.log(`✅ [USER-FILE] Texte extrait: ${extractedText.length} caractères`);

      // 5. Chunking intelligent
      const chunks = this.intelligentChunking(extractedText, file.fileName);

      if (chunks.length === 0) {
        throw new Error("Aucun chunk généré après découpage");
      }

      // 6. Déterminer le type de source
      const sourceType = file.mimeType === "application/pdf" ? "PDF" : "TEXT_FILE";
      const fileExtension = file.fileName.split(".").pop() || "";

      // 7. Créer ou mettre à jour la source
      let source;
      if (existingSource) {
        source = await prisma.rAGSource.update({
          where: { id: existingSource.id },
          data: {
            title: file.fileName.replace(/\.[^/.]+$/, ""),
            fileName: file.fileName,
            fileSize: file.buffer.length,
            mimeType: file.mimeType,
            metadata: {
              contentHash,
              originalFileName: file.fileName,
              extractedText,
              uploadedAt: new Date().toISOString(),
              fileExtension,
            },
            status: "PROCESSING",
            lastUsedAt: new Date(),
            updatedAt: new Date(),
          },
        });
        logger.log(`🆕 [USER-FILE] Source mise à jour: ${source.id}`);
      } else {
        source = await prisma.rAGSource.create({
          data: {
            userId: file.userId,
            workspaceId: file.workspaceId,
            sourceType,
            title: file.fileName.replace(/\.[^/.]+$/, ""),
            fileName: file.fileName,
            fileSize: file.buffer.length,
            mimeType: file.mimeType,
            metadata: {
              contentHash,
              originalFileName: file.fileName,
              extractedText,
              uploadedAt: new Date().toISOString(),
              fileExtension,
            },
            status: "PROCESSING",
            isGlobal: false,
            lastUsedAt: new Date(),
          },
        });
        logger.log(`🆕 [USER-FILE] Nouvelle source: ${source.id}`);
      }

      // 8. Génération des embeddings et sauvegarde
      await this.processFileChunks(source.id, chunks);

      // 9. Mettre à jour le statut
      await prisma.rAGSource.update({
        where: { id: source.id },
        data: {
          status: "COMPLETED",
          totalChunks: chunks.length,
        },
      });

      logger.log(`✅ [USER-FILE] Terminé: "${file.fileName}" (${chunks.length} chunks)`);
      return source.id;
    } catch (error) {
      logger.error(`❌ [USER-FILE] Erreur traitement fichier "${file.fileName}":`, error);
      throw error;
    }
  }
}

// Instance singleton
export const userFilesRAG = new UserFilesRAGSystem();
