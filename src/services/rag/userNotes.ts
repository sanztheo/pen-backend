/**
 * 🗒️ USER NOTES RAG SYSTEM
 * Traitement des notes utilisateur pour l'indexation RAG
 */

import { prisma } from '../../lib/prisma.js';
import type { RAGChunkInput } from './index.js';

export interface UserNoteContent {
  userId: string;
  workspaceId: string;
  noteId?: string;
  title: string;
  content: string;
  updatedAt: Date;
}

export class UserNotesRAGSystem {
  /**
   * 🔍 Trouve une source RAG existante pour une note utilisateur
   */
  async findExistingSource(
    userId: string,
    workspaceId: string,
    noteTitle: string
  ): Promise<{
    id: string;
    updatedAt: Date;
    status: string;
  } | null> {
    try {
      const source = await prisma.rAGSource.findFirst({
        where: {
          sourceType: 'USER_NOTES',
          userId,
          workspaceId,
          title: noteTitle
        },
        select: {
          id: true,
          updatedAt: true,
          status: true
        }
      });

      return source || null;
    } catch (error) {
      console.error(`❌ [USER-NOTES] Erreur recherche source existante:`, error);
      return null;
    }
  }

  /**
   * 📝 Traite une note utilisateur pour l'embedding RAG
   */
  async processUserNote(note: UserNoteContent): Promise<string | null> {
    try {
      console.log(`📝 [USER-NOTES] Traitement: "${note.title}"`);

      // Vérifier si la note a déjà une source RAG
      const existingSource = await this.findExistingSource(
        note.userId,
        note.workspaceId,
        note.title
      );

      let source;
      if (existingSource) {
        // Note existe, supprimer les anciens chunks pour la remplacer
        console.log(`♻️ [USER-NOTES] Mise à jour: "${note.title}"`);

        await prisma.rAGChunk.deleteMany({
          where: { sourceId: existingSource.id }
        });

        source = await prisma.rAGSource.update({
          where: { id: existingSource.id },
          data: {
            status: 'PROCESSING',
            lastUsedAt: new Date(),
            updatedAt: new Date(),
            metadata: {
              contentLength: note.content.length,
              lastModified: note.updatedAt.toISOString()
            }
          }
        });
      } else {
        // Création d'une nouvelle source
        console.log(`🆕 [USER-NOTES] Nouvelle source: "${note.title}"`);

        source = await prisma.rAGSource.create({
          data: {
            userId: note.userId,
            workspaceId: note.workspaceId,
            sourceType: 'USER_NOTES',
            title: note.title,
            isGlobal: false,
            status: 'PROCESSING',
            lastUsedAt: new Date(),
            metadata: {
              contentLength: note.content.length,
              lastModified: note.updatedAt.toISOString()
            }
          }
        });
      }

      // Chunking du contenu
      const chunks = await this.chunkUserNoteContent(note);

      if (chunks.length === 0) {
        console.log(`⚠️ [USER-NOTES] Aucun chunk généré pour: "${note.title}"`);

        await prisma.rAGSource.update({
          where: { id: source.id },
          data: {
            status: 'FAILED',
            errorMessage: 'Contenu insuffisant pour génération de chunks'
          }
        });

        return null;
      }

      // Traitement des chunks avec embeddings
      await this.processUserNoteChunks(source.id, chunks);

      // Finalisation
      await prisma.rAGSource.update({
        where: { id: source.id },
        data: {
          status: 'COMPLETED',
          totalChunks: chunks.length
        }
      });

      console.log(`✅ [USER-NOTES] Note indexée avec succès: "${note.title}" (${chunks.length} chunks)`);

      return source.id;
    } catch (error) {
      console.error(`❌ [USER-NOTES] Erreur traitement note:`, error);
      throw error;
    }
  }

  /**
   * 📦 Découpe le contenu des notes en chunks pertinents
   */
  private async chunkUserNoteContent(note: UserNoteContent): Promise<RAGChunkInput[]> {
    const chunks: RAGChunkInput[] = [];

    if (!note.content || note.content.trim().length === 0) {
      return chunks;
    }

    // Chunking simple par paragraphes
    const paragraphs = note.content
      .split('\n\n')
      .map(p => p.trim())
      .filter(p => p.length > 0);

    let offset = 0;

    for (let i = 0; i < paragraphs.length; i++) {
      const paragraph = paragraphs[i];

      if (paragraph.length > 50) {
        // Chunk utile seulement si suffisamment long
        chunks.push({
          content: paragraph,
          cleanContent: paragraph,
          tokenCount: Math.ceil(paragraph.length / 4), // Estimation simple
          pageNumber: Math.floor(i / 10) + 1, // Numéro de "page" estimé
          sectionTitle: note.title,
          startOffset: offset,
          endOffset: offset + paragraph.length,
          quality: 1.0,
          language: 'fr'
        });
      }

      offset += paragraph.length + 2; // +2 pour les newlines
    }

    // Si pas assez de chunks (contenu très court), créer un chunk unique
    if (chunks.length === 0 && note.content.length > 20) {
      chunks.push({
        content: note.content,
        cleanContent: note.content,
        tokenCount: Math.ceil(note.content.length / 4),
        pageNumber: 1,
        sectionTitle: note.title,
        startOffset: 0,
        endOffset: note.content.length,
        quality: 1.0,
        language: 'fr'
      });
    }

    console.log(`📦 [USER-NOTES] ${chunks.length} chunks générés pour: "${note.title}"`);

    return chunks;
  }

  /**
   * 🧠 Traite les chunks avec embeddings
   */
  private async processUserNoteChunks(
    sourceId: string,
    chunks: RAGChunkInput[]
  ): Promise<void> {
    const { ragSystem } = await import('./index.js');

    try {
      console.log(`🧠 [USER-NOTES] Génération embeddings pour ${chunks.length} chunks...`);

      const chunksBatch = [];

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];

        // Générer embedding
        const embedding = await ragSystem.embeddingService.generateEmbedding(chunk.cleanContent || chunk.content);

        chunksBatch.push({
          sourceId,
          chunkIndex: i,
          content: chunk.content,
          cleanContent: chunk.cleanContent || chunk.content,
          embedding: JSON.stringify(embedding),
          tokenCount: chunk.tokenCount || Math.ceil(chunk.content.length / 4),
          pageNumber: chunk.pageNumber,
          sectionTitle: chunk.sectionTitle,
          startOffset: chunk.startOffset,
          endOffset: chunk.endOffset,
          quality: chunk.quality || 1.0,
          language: chunk.language || 'en',
          createdAt: new Date()
        });
      }

      // Insérer tous les chunks
      await prisma.rAGChunk.createMany({
        data: chunksBatch
      });

      console.log(`✅ [USER-NOTES] ${chunks.length} chunks indexés avec embeddings`);
    } catch (error) {
      console.error(`❌ [USER-NOTES] Erreur traitement chunks:`, error);
      throw error;
    }
  }
}

export const userNotesRAGSystem = new UserNotesRAGSystem();
