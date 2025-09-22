// assistant/fileManager.ts - Gestionnaire de fichiers pour OpenAI Assistant
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Service de gestion des fichiers pour l'Assistant OpenAI
 * Contourne la limite des Function Calls en uploadant les documents comme fichiers
 */
export class AssistantFileManager {
  private fileCache = new Map<string, string>(); // documentId -> fileId
  private fileMetadata = new Map<string, any>(); // fileId -> metadata

  /**
   * Upload un document Wikipedia comme fichier Assistant
   */
  async uploadDocument(document: {
    id: string;
    title: string;
    content: string;
    topic: string;
    similarity?: number;
    source?: string;
  }): Promise<string> {
    try {
      // Vérifier le cache
      const cacheKey = `${document.id}_${this.getContentHash(document.content)}`;
      if (this.fileCache.has(cacheKey)) {
        console.log(`📋 Document "${document.title}" trouvé en cache`);
        return this.fileCache.get(cacheKey)!;
      }

      // Préparer le contenu du fichier avec métadonnées
      const fileContent = this.formatDocumentForAssistant(document);
      
      // Créer un Blob/Buffer pour l'upload
      const buffer = Buffer.from(fileContent, 'utf-8');
      
      // Upload vers OpenAI
      console.log(`📤 Upload document "${document.title}" (${Math.round(buffer.length / 1024)}KB)...`);
      
      const file = await openai.files.create({
        file: new File([buffer], `${document.title.replace(/[^a-zA-Z0-9]/g, '_')}.txt`, {
          type: 'text/plain'
        }),
        purpose: 'assistants'
      });

      // Sauvegarder en cache
      this.fileCache.set(cacheKey, file.id);
      this.fileMetadata.set(file.id, {
        originalDocument: document,
        uploadedAt: new Date(),
        size: buffer.length
      });

      console.log(`✅ Document uploadé avec ID: ${file.id}`);
      return file.id;

    } catch (error) {
      console.error(`❌ Erreur upload document "${document.title}":`, error);
      throw new Error(`Impossible d'uploader le document: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
    }
  }

  /**
   * Upload plusieurs documents en batch
   */
  async uploadDocuments(documents: any[]): Promise<string[]> {
    console.log(`📤 Upload de ${documents.length} documents Wikipedia...`);
    
    const uploadPromises = documents.map(doc => this.uploadDocument(doc));
    const fileIds = await Promise.all(uploadPromises);
    
    console.log(`✅ ${fileIds.length} documents uploadés avec succès`);
    return fileIds;
  }

  /**
   * Nettoie les fichiers Assistant anciens (appelé périodiquement)
   */
  async cleanupOldFiles(maxAgeHours = 24): Promise<void> {
    console.log(`🧹 Nettoyage des fichiers Assistant plus anciens que ${maxAgeHours}h...`);
    
    try {
      // Lister tous les fichiers Assistant
      const files = await openai.files.list({
        purpose: 'assistants'
      });

      let deletedCount = 0;
      const maxAge = maxAgeHours * 60 * 60 * 1000; // en millisecondes

      for (const file of files.data) {
        const fileAge = Date.now() - (file.created_at * 1000);
        
        if (fileAge > maxAge) {
          try {
            await (openai.files as any).del(file.id);
            
            // Nettoyer le cache local
            for (const [key, cachedFileId] of this.fileCache.entries()) {
              if (cachedFileId === file.id) {
                this.fileCache.delete(key);
                break;
              }
            }
            this.fileMetadata.delete(file.id);
            
            deletedCount++;
            console.log(`🗑️ Fichier supprimé: ${file.id} (${file.filename})`);
          } catch (deleteError) {
            console.warn(`⚠️ Impossible de supprimer ${file.id}:`, deleteError);
          }
        }
      }

      console.log(`✅ Nettoyage terminé: ${deletedCount} fichiers supprimés`);
    } catch (error) {
      console.error('❌ Erreur lors du nettoyage:', error);
    }
  }

  /**
   * Obtient les métadonnées d'un fichier uploadé
   */
  getFileMetadata(fileId: string): any {
    return this.fileMetadata.get(fileId);
  }

  /**
   * Statistiques du gestionnaire de fichiers
   */
  getStats(): {
    cachedFiles: number;
    totalMetadata: number;
    cacheKeys: string[];
  } {
    return {
      cachedFiles: this.fileCache.size,
      totalMetadata: this.fileMetadata.size,
      cacheKeys: Array.from(this.fileCache.keys())
    };
  }

  /**
   * Formate un document Wikipedia pour l'Assistant
   * Structure claire avec métadonnées
   */
  private formatDocumentForAssistant(document: any): string {
    return `DOCUMENT WIKIPEDIA - ${document.title}
=====================================

MÉTADONNÉES:
- Titre: ${document.title}
- Topic: ${document.topic || 'Non spécifié'}
- Source: ${document.source || 'Wikipedia'}
- Similarité: ${document.similarity ? (document.similarity * 100).toFixed(1) + '%' : 'N/A'}
- Taille: ${document.content.length} caractères

CONTENU COMPLET:
================
${document.content}

================
FIN DU DOCUMENT: ${document.title}`;
  }

  /**
   * Génère un hash simple du contenu pour le cache
   */
  private getContentHash(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  }
}

// Instance singleton
export const assistantFileManager = new AssistantFileManager();

// Nettoyage automatique périodique (toutes les 6h)
if (process.env.NODE_ENV !== 'test') {
  setInterval(async () => {
    try {
      await assistantFileManager.cleanupOldFiles(6); // Nettoyer les fichiers > 6h
    } catch (error) {
      console.error('❌ Erreur nettoyage automatique:', error);
    }
  }, 6 * 60 * 60 * 1000); // 6 heures en millisecondes
}