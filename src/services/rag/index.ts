// 🚀 RAG System - Service Principal
import { prisma } from '../../lib/prisma.js';
import type { RAGSourceType } from '@prisma/client';

// Type pour la réponse de l'API OpenAI
interface OpenAIChatCompletion {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

// Types principaux
export interface RAGChunkInput {
  content: string;
  pageNumber?: number;
  sectionTitle?: string;
  startOffset?: number;
  endOffset?: number;
  quality?: number;
}

export interface RAGSearchOptions {
  limit?: number;
  threshold?: number;
  sources?: string[];
  workspaceId?: string;
  userId?: string;
  includeUserSources?: boolean;
  specificPageIds?: string[]; // 🆕 IDs des pages spécifiques à utiliser
  specificSourceIds?: string[]; // 🆕 IDs des sources RAG spécifiques à utiliser
}

export interface RAGSearchResult {
  id: string;
  content: string;
  source: {
    id: string;
    title: string;
    sourceType: RAGSourceType;
    fileName?: string;
    type?: string;
  };
  similarity: number;
  pageNumber?: number;
  sectionTitle?: string;
}

export class RAGSystem {
  public embeddingService: EmbeddingService;

  constructor() {
    this.embeddingService = new EmbeddingService();
  }

  // 📄 Traitement PDFs avec chunking intelligent
  async processPDF(
    userId: string,
    workspaceId: string | null,
    file: Buffer,
    fileName: string,
    mimeType: string
  ): Promise<string> {
    try {
      // 1. Créer la source RAG
      const source = await prisma.rAGSource.create({
        data: {
          userId,
          workspaceId,
          sourceType: 'PDF',
          title: fileName.replace(/\.[^/.]+$/, ''), // Nom sans extension
          fileName,
          fileSize: file.length,
          mimeType,
          status: 'PROCESSING'
        }
      });

      // 2. Extraction du contenu PDF
      const pdfContent = await this.extractPDFContent(file);
      
      // 3. Chunking intelligent
      const chunks = await this.intelligentChunking(pdfContent, {
        maxSize: 1000,
        overlap: 200,
        respectSentences: true,
        respectParagraphs: true
      });

      // 4. Génération des embeddings et sauvegarde
      await this.processChunks(source.id, chunks);

      // 5. Mettre à jour le statut
      await prisma.rAGSource.update({
        where: { id: source.id },
        data: {
          status: 'COMPLETED',
          totalChunks: chunks.length,
          totalPages: pdfContent.totalPages
        }
      });

      return source.id;
    } catch (error) {
      console.error('Erreur traitement PDF:', error);
      throw new Error(`Échec du traitement PDF: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
    }
  }

  // 🧠 Intelligence de requête NotebookLM-style avec GPT-4.1-nano
  async shouldUseRAG(query: string): Promise<boolean> {
    const normalizedQuery = query.toLowerCase().trim();
    
    // Cas évidents - pas besoin d'appeler GPT
    if (normalizedQuery.length <= 2) {
      return false;
    }
    
    try {
      const prompt = `Analyse cette requête utilisateur et détermine si elle nécessite une recherche dans des documents (RAG).

RÈGLES :
- Salutations/politesses (salut, bonjour, merci) = NON RAG
- Questions sur l'IA elle-même (qui es-tu, comment tu fonctionnes) = NON RAG  
- Commandes système (aide, help, quit) = NON RAG
- Questions nécessitant des informations spécifiques = OUI RAG
- Questions de résumé de contenu = OUI RAG

Requête: "${query}"

Réponds uniquement "OUI" ou "NON"`;

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: process.env.OPENAI_DETECTION_MODEL || 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0,
          max_tokens: 10
        })
      });

      const result = await response.json() as OpenAIChatCompletion;
      const decision = result.choices?.[0]?.message?.content?.trim()?.toUpperCase();
      
      console.log(`🧠 [RAG-DETECTION] Query: "${query}" → Decision: ${decision}`);
      
      return decision === 'OUI';
      
    } catch (error) {
      console.error('Erreur détection RAG, fallback to true:', error);
      return true; // En cas d'erreur, utiliser RAG par sécurité
    }
  }

  // 🔍 Recherche RAG intelligente NotebookLM-style avec GPT-4.1-nano
  async intelligentSearch(query: string, options: RAGSearchOptions = {}): Promise<RAGSearchResult[]> {
    try {
      const questionType = await this.detectQuestionType(query);
      console.log(`🔍 [RAG-NOTEBOOKLM] Type de question détecté: ${questionType}`);
      
      switch (questionType) {
        case 'RESUME':
          console.log(`🔍 [RAG-NOTEBOOKLM] Question de résumé → meilleurs chunks par qualité`);
          return await this.getBestQualityChunks(options);
          
        case 'EXPLICATION':
          console.log(`🔍 [RAG-NOTEBOOKLM] Question d'explication → recherche vectorielle optimisée`);
          return await this.search(query, { ...options, threshold: 0.15, limit: 8 });
          
        case 'FACTUELLE':
        default:
          console.log(`🔍 [RAG-NOTEBOOKLM] Question factuelle → recherche vectorielle standard`);
          return await this.search(query, options);
      }
      
    } catch (error) {
      console.error('Erreur détection type question, fallback recherche standard:', error);
      return await this.search(query, options);
    }
  }

  // 🎯 Détection du type de question avec GPT-4.1-nano
  private async detectQuestionType(query: string): Promise<'RESUME' | 'EXPLICATION' | 'FACTUELLE'> {
    try {
      const prompt = `Classe cette question RAG selon les exemples. Réponds UNIQUEMENT avec le JSON demandé.

EXEMPLES :
"Résumé" → {"type": "RESUME"}
"Que contient ce document ?" → {"type": "RESUME"}
"Comment fonctionne un ordinateur quantique ?" → {"type": "EXPLICATION"}
"Pourquoi John von Neumann est-il important ?" → {"type": "EXPLICATION"}
"Quelle est la date de naissance de John von Neumann ?" → {"type": "FACTUELLE"}
"Qui a inventé l'ordinateur quantique ?" → {"type": "FACTUELLE"}

RÈGLES :
- RESUME : synthèse générale, vue d'ensemble
- EXPLICATION : mécanismes, principes, processus
- FACTUELLE : données précises, chiffres, dates, noms

QUESTION : "${query}"

Réponds avec ce JSON strict : {"type": "RESUME"} OU {"type": "EXPLICATION"} OU {"type": "FACTUELLE"}`;

      // 🔍 Debug complet de l'appel OpenAI
      const isGpt5Nano = process.env.OPENAI_DETECTION_MODEL?.includes('gpt-5-nano');
      console.log(`🔑 [API-DEBUG] OPENAI_API_KEY présente: ${!!process.env.OPENAI_API_KEY}`);
      console.log(`🤖 [API-DEBUG] Model utilisé: ${process.env.OPENAI_DETECTION_MODEL || 'gpt-4o-mini'}`);
      console.log(`⚙️ [API-DEBUG] Mode gpt-5-nano détecté: ${isGpt5Nano}`);

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: process.env.OPENAI_DETECTION_MODEL || 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          // 🔧 Fix température pour gpt-5-nano-2025-08-07 (seul default=1 supporté)
          ...(process.env.OPENAI_DETECTION_MODEL?.includes('gpt-5-nano')
            ? {} // Pas de température pour gpt-5-nano (utilise default=1)
            : { temperature: 0 } // temperature=0 pour autres modèles
          ),
          // 🔧 Fix max_tokens pour gpt-5-nano-2025-08-07
          ...(process.env.OPENAI_DETECTION_MODEL?.includes('gpt-5-nano')
            ? { max_completion_tokens: 30 }
            : { max_tokens: 30 }
          ),
          response_format: { type: "json_object" } // 🚀 Force JSON strict
        })
      });

      console.log(`🌐 [API-DEBUG] Response status: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ [API-ERROR] OpenAI API Error: ${response.status} - ${errorText}`);
        return 'RESUME'; // Fallback intelligent pour "Résumé"
      }

      const result = await response.json() as OpenAIChatCompletion;
      const rawResponse = result.choices?.[0]?.message?.content?.trim();

      console.log(`📤 [API-DEBUG] Raw JSON response: "${rawResponse}"`);

      try {
        // 🚀 Parse du JSON strict
        const jsonResponse = JSON.parse(rawResponse || '{}');
        const questionType = jsonResponse.type?.toUpperCase();

        console.log(`🎯 [DETECT-JSON-2025] Query: "${query}" → JSON: ${rawResponse} → Type: ${questionType}`);

        if (['RESUME', 'EXPLICATION', 'FACTUELLE'].includes(questionType)) {
          return questionType as 'RESUME' | 'EXPLICATION' | 'FACTUELLE';
        }

        console.warn(`⚠️ [JSON-ERROR] Type invalide dans JSON: "${questionType}"`);

      } catch (parseError) {
        console.error(`❌ [JSON-PARSE-ERROR] JSON invalide: "${rawResponse}"`, parseError);
      }

      // Fallback intelligent si JSON échoue
      console.warn(`🔄 [JSON-FALLBACK] Utilisation du fallback déterministe`);
      return this.detectQuestionTypeFallback(query);
      
    } catch (error) {
      console.error('❌ [API-ERROR] Erreur détection type question:', error);

      return this.detectQuestionTypeFallback(query);
    }
  }

  // 🔄 Fallback déterministe pour détection de type question (si OpenAI échoue)
  private detectQuestionTypeFallback(query: string): 'RESUME' | 'EXPLICATION' | 'FACTUELLE' {
    const queryLower = query.toLowerCase().trim();

    // Mots-clés RESUME (requêtes de synthèse)
    const resumeKeywords = ['résumé', 'resume', 'synthèse', 'synthese', 'contenu', 'parle de quoi',
                          'global', 'général', 'vue d\'ensemble', 'essentiel', 'principal'];

    // Mots-clés EXPLICATION
    const explanationKeywords = ['comment', 'pourquoi', 'explique', 'explication', 'principe',
                               'fonctionnement', 'mécanisme', 'processus'];

    if (resumeKeywords.some(keyword => queryLower.includes(keyword))) {
      console.log(`🔄 [FALLBACK] "${query}" → RESUME (mot-clé détecté)`);
      return 'RESUME';
    }

    if (explanationKeywords.some(keyword => queryLower.includes(keyword))) {
      console.log(`🔄 [FALLBACK] "${query}" → EXPLICATION (mot-clé détecté)`);
      return 'EXPLICATION';
    }

    console.log(`🔄 [FALLBACK] "${query}" → FACTUELLE (défaut)`);
    return 'FACTUELLE';
  }

  // 📊 Récupération des chunks de meilleure qualité avec diversification (pour questions générales)
  private async getBestQualityChunks(options: RAGSearchOptions = {}): Promise<RAGSearchResult[]> {
    const {
      limit = 10, // Augmenté pour avoir plus de variété
      workspaceId,
      userId,
      specificPageIds, // 🆕 Pages spécifiques à utiliser  
      specificSourceIds // 🆕 Sources RAG spécifiques à utiliser
    } = options;

    try {
      let whereClause: any = {
        source: {
          status: 'COMPLETED'
        }
      };

      // 🆕 Si des sources RAG spécifiques sont demandées, filtrer par ces sources
      if (specificSourceIds && specificSourceIds.length > 0) {
        whereClause = {
          sourceId: { in: specificSourceIds }, // Filtrer les chunks par ID de source RAG
          source: {
            status: 'COMPLETED'
          }
        };
        console.log(`🔍 [RAG-QUALITY] Filtrage par sources RAG spécifiques: ${specificSourceIds.join(', ')}`);
      }
      // 🆕 Sinon, si des pages spécifiques sont demandées, filtrer par ces pages  
      else if (specificPageIds && specificPageIds.length > 0) {
        // Filtrer directement par l'ID des sources (qui correspondent aux IDs des pages)
        whereClause = {
          sourceId: { in: specificPageIds }, // Filtrer les chunks par ID de source
          source: {
            status: 'COMPLETED',
            userId: userId,
            workspaceId: workspaceId,
            isGlobal: false
          }
        };
        console.log(`🔍 [RAG-QUALITY] Filtrage par pages spécifiques: ${specificPageIds.join(', ')}`);
      } else {
        whereClause.source.OR = [
          // 🌍 Sources globales (Wikipedia) - accessibles à tous
          { isGlobal: true },
          // 🔒 Sources privées de l'utilisateur
          ...(userId && workspaceId ? [{
            AND: [
              { userId: userId },
              { workspaceId: workspaceId },
              { isGlobal: false }
            ]
          }] : [])
        ];
      }

      // 🎯 STRATÉGIE DE DIVERSIFICATION : 
      // 1. Récupérer plus de chunks par source
      // 2. Appliquer un algorithme de diversification

      console.log('📊 [RAG-QUALITY] Stratégie de diversification pour résumé...');

      // Récupération d'un pool plus large de chunks de qualité
      const allChunks = await prisma.rAGChunk.findMany({
        where: whereClause,
        include: {
          source: {
            select: {
              id: true,
              title: true,
              sourceType: true,
              fileName: true
            }
          }
        },
        orderBy: [
          { quality: 'desc' },
          { tokenCount: 'desc' }
        ],
        take: limit * 3 // Pool 3x plus large pour diversifier
      });

      // 🎯 ALGORITHME DE DIVERSIFICATION
      const diversifiedChunks = this.diversifyBySource(allChunks, limit);

      console.log(`📊 [RAG-QUALITY] Chunks sélectionnés par source:`, 
        this.getSourceStats(diversifiedChunks)
      );

      return diversifiedChunks.map((chunk: any) => ({
        id: chunk.id,
        content: chunk.cleanContent,
        source: chunk.source,
        similarity: 1.0, // Score artificiel élevé car c'est du contenu de qualité
        pageNumber: chunk.pageNumber,
        sectionTitle: chunk.sectionTitle
      }));

    } catch (error) {
      console.error('Erreur getBestQualityChunks:', error);
      throw new Error(`Échec de la récupération: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
    }
  }

  // 🎯 Algorithme de diversification des chunks par source
  private diversifyBySource(chunks: any[], targetLimit: number): any[] {
    // Grouper les chunks par source
    const chunksBySource = new Map<string, any[]>();
    
    chunks.forEach(chunk => {
      const sourceId = chunk.source.id;
      if (!chunksBySource.has(sourceId)) {
        chunksBySource.set(sourceId, []);
      }
      chunksBySource.get(sourceId)!.push(chunk);
    });

    console.log(`📊 [DIVERSIFICATION] ${chunksBySource.size} sources disponibles, cible: ${targetLimit} chunks`);

    // Stratégie : maximum 2-3 chunks par source pour équilibrer
    const maxChunksPerSource = Math.max(2, Math.floor(targetLimit / chunksBySource.size) + 1);
    const diversifiedChunks: any[] = [];

    // Round-robin pour équilibrer les sources
    let round = 0;
    const sourceEntries = Array.from(chunksBySource.entries());
    
    while (diversifiedChunks.length < targetLimit && round < maxChunksPerSource) {
      sourceEntries.forEach(([, sourceChunks]) => {
        if (diversifiedChunks.length >= targetLimit) return;
        if (sourceChunks[round]) {
          diversifiedChunks.push(sourceChunks[round]);
        }
      });
      round++;
    }

    return diversifiedChunks;
  }

  // 📊 Stats des sources pour debugging
  private getSourceStats(chunks: any[]): Record<string, number> {
    const stats: Record<string, number> = {};
    chunks.forEach(chunk => {
      const title = chunk.source.title;
      stats[title] = (stats[title] || 0) + 1;
    });
    return stats;
  }

  // 🔍 Recherche vectorielle intelligente
  async search(query: string, options: RAGSearchOptions = {}): Promise<RAGSearchResult[]> {
    const {
      limit = 10,
      threshold = 0.2, // Threshold plus réaliste pour RAG
      sources = [],
      workspaceId,
      userId,
      specificPageIds, // 🆕 Ajouter le support des pages spécifiques
      specificSourceIds // 🆕 Ajouter le support des sources RAG spécifiques
    } = options;

    try {
      console.log(`🔍 [RAG-SEARCH] Début recherche: query="${query}", userId="${userId}", workspaceId="${workspaceId}"`);
      
      // 1. Génération embedding de la question
      const queryEmbedding = await this.embeddingService.generateEmbedding(query);
      console.log(`🔍 [RAG-SEARCH] Embedding généré: ${JSON.stringify(queryEmbedding).length} chars`);

      // 2. Construction de la requête avec filtres
      let whereClause: any;
      
      // 🆕 Si des sources RAG spécifiques sont demandées, filtrer par ces sources
      if (specificSourceIds && specificSourceIds.length > 0) {
        console.log(`🔍 [RAG-SEARCH] Filtrage par sources RAG spécifiques: ${specificSourceIds.join(', ')}`);
        whereClause = {
          sourceId: { in: specificSourceIds },
          source: {
            status: 'COMPLETED'
          }
        };
      }
      // 🆕 Sinon, si des pages spécifiques sont demandées, filtrer par ces pages
      else if (specificPageIds && specificPageIds.length > 0) {
        console.log(`🔍 [RAG-SEARCH] Filtrage par pages spécifiques: ${specificPageIds.join(', ')}`);
        whereClause = {
          sourceId: { in: specificPageIds },
          source: {
            status: 'COMPLETED',
            userId: userId,
            workspaceId: workspaceId,
            isGlobal: false
          }
        };
      } else {
        whereClause = {
          source: {
            status: 'COMPLETED',
            OR: [
              // 🌍 Sources globales (Wikipedia) - accessibles à tous
              { isGlobal: true },
              // 🔒 Sources privées de l'utilisateur
              ...(userId && workspaceId ? [{
                AND: [
                  { userId: userId },
                  { workspaceId: workspaceId },
                  { isGlobal: false }
                ]
              }] : [])
            ]
          }
        };
      }

      // Filtre par sources spécifiques si demandé (seulement si pas déjà filtré par pages spécifiques)
      if (sources.length > 0 && !(specificPageIds && specificPageIds.length > 0)) {
        whereClause.source.id = { in: sources };
      }

      console.log(`🔍 [RAG-SEARCH] WhereClause:`, JSON.stringify(whereClause, null, 2));
      
      // 3. Recherche avec similarité (simulation - à adapter selon pgvector)
      const chunks = await prisma.rAGChunk.findMany({
        where: whereClause,
        include: {
          source: {
            select: {
              id: true,
              title: true,
              sourceType: true,
              fileName: true
            }
          }
        },
        orderBy: { quality: 'desc' },
        take: limit * 2 // Prendre plus pour filtrer après
      });
      
      console.log(`🔍 [RAG-SEARCH] Chunks trouvés avant filtrage: ${chunks.length}`);

      // 4. Calcul de similarité et tri (temporaire - pgvector fera ça nativement)
      const resultsWithSimilarity = chunks.map((chunk: any) => {
        const similarity = this.calculateSimilarity(JSON.stringify(queryEmbedding), chunk.embedding);
        return {
          id: chunk.id,
          content: chunk.cleanContent,
          source: chunk.source,
          similarity: similarity,
          pageNumber: chunk.pageNumber,
          sectionTitle: chunk.sectionTitle
        };
      });
      
      console.log(`🔍 [RAG-SEARCH] Similarités calculées (top 3):`, 
        resultsWithSimilarity.slice(0, 3).map(r => ({ similarity: r.similarity, threshold }))
      );
      
      const results = resultsWithSimilarity
        .filter((result: any) => result.similarity >= threshold)
        .sort((a: any, b: any) => b.similarity - a.similarity)
        .slice(0, limit);
        
      console.log(`🔍 [RAG-SEARCH] Résultats finaux après filtrage par threshold ${threshold}: ${results.length}`);

      // 📊 Mettre à jour lastUsedAt pour les sources utilisées
      if (results.length > 0) {
        const { cleanupService } = await import('./cleanup.js');
        const usedSourceIds = [...new Set(results.map(r => r.source.id))];
        await cleanupService.updateLastUsedBatch(usedSourceIds);

        // 🔄 Mise à jour spéciale pour les pages utilisateur
        if (userId) {
          try {
            const { userPagesRAG } = await import('./userPages.js');
            const userPageSourceIds = results
              .filter(r => r.source.sourceType === 'WORKSPACE_PAGE')
              .map(r => r.source.id);
            
            if (userPageSourceIds.length > 0) {
              await userPagesRAG.updateLastUsed(userPageSourceIds, userId);
            }
          } catch (error) {
            console.error('🔄 [RAG] Erreur mise à jour pages utilisateur:', error);
          }
        }
      }

      return results;
    } catch (error) {
      console.error('Erreur recherche RAG:', error);
      throw new Error(`Échec de la recherche: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
    }
  }

  // 🎯 Construction du contexte optimisé
  async buildOptimizedContext(query: string, searchResults: RAGSearchResult[]): Promise<string> {
    const contextParts = [
      `Question: ${query}`,
      '',
      'Sources pertinentes:'
    ];

    searchResults.forEach((result, index) => {
      contextParts.push(
        `## Source ${index + 1}: ${result.source.title}`,
        result.sectionTitle ? `### ${result.sectionTitle}` : '',
        result.pageNumber ? `*Page ${result.pageNumber}*` : '',
        result.content,
        ''
      );
    });

    return contextParts.filter(Boolean).join('\n');
  }

  // 🔧 Méthodes privées
  private async extractPDFContent(file: Buffer): Promise<{
    text: string;
    totalPages: number;
    pages: { pageNumber: number; content: string; }[];
  }> {
    // À implémenter avec pdf-parse ou similaire
    const PDF = require('pdf-parse');
    const pdfData = await PDF(file);
    
    return {
      text: pdfData.text,
      totalPages: pdfData.numpages,
      pages: [] // À enrichir avec l'extraction par page
    };
  }

  private async intelligentChunking(
    pdfContent: { text: string; totalPages: number; pages: any[] },
    options: {
      maxSize: number;
      overlap: number;
      respectSentences: boolean;
      respectParagraphs: boolean;
    }
  ): Promise<RAGChunkInput[]> {
    const chunks: RAGChunkInput[] = [];
    const text = pdfContent.text;
    const { maxSize, overlap } = options;
    
    // Chunking simple (à améliorer avec des règles plus sophistiquées)
    let start = 0;
    let chunkIndex = 0;
    
    while (start < text.length) {
      let end = Math.min(start + maxSize, text.length);
      
      // Respecter les phrases si possible
      if (end < text.length && options.respectSentences) {
        const lastPeriod = text.lastIndexOf('.', end);
        if (lastPeriod > start + maxSize * 0.5) {
          end = lastPeriod + 1;
        }
      }
      
      const content = text.slice(start, end);
      const cleanContent = this.cleanContent(content);
      
      if (cleanContent.trim().length > 50) { // Ignorer les chunks trop petits
        chunks.push({
          content: content,
          quality: this.assessChunkQuality(cleanContent),
          startOffset: start,
          endOffset: end
        });
      }
      
      start = Math.max(start + maxSize - overlap, end);
      chunkIndex++;
    }
    
    return chunks;
  }

  private async processChunks(sourceId: string, chunks: RAGChunkInput[]): Promise<void> {
    const { mapWithConcurrency, chunkArray } = await import('../../utils/concurrency.js');
    const concurrency = Math.max(1, parseInt(process.env.RAG_EMBEDDING_CONCURRENCY || '10', 10));
    const batchSize = Math.max(1, parseInt(process.env.RAG_DB_BATCH_SIZE || '100', 10));

    const t0 = Date.now();
    console.log(`⚙️  [RAG] Embedding ${chunks.length} chunks avec parallélisation x${concurrency}…`);

    // Calculer les embeddings en parallèle (limité)
    const prepared = await mapWithConcurrency(chunks, concurrency, async (chunk, i) => {
      const embedding = await this.embeddingService.generateEmbedding(chunk.content);
      return {
        sourceId,
        chunkIndex: i,
        content: chunk.content,
        cleanContent: this.cleanContent(chunk.content),
        embedding: JSON.stringify(embedding),
        tokenCount: this.countTokens(chunk.content),
        pageNumber: chunk.pageNumber,
        sectionTitle: chunk.sectionTitle,
        startOffset: chunk.startOffset,
        endOffset: chunk.endOffset,
        quality: chunk.quality || 1.0
      } as any;
    });

    // Insérer en batch pour réduire les allers-retours DB
    let inserted = 0;
    for (const batch of chunkArray(prepared, batchSize)) {
      await prisma.rAGChunk.createMany({ data: batch, skipDuplicates: true });
      inserted += batch.length;
      console.log(`💾 [RAG] Inséré ${inserted}/${prepared.length} chunks…`);
    }

    console.log(`✅ [RAG] Embedding + insertion terminés en ${Date.now() - t0} ms`);
  }

  private cleanContent(content: string): string {
    return content
      .replace(/\s+/g, ' ') // Normaliser les espaces
      .replace(/[^\w\s\-.,;:!?()]/g, '') // Garder seulement les caractères utiles
      .trim();
  }

  private assessChunkQuality(content: string): number {
    let quality = 1.0;
    
    // Pénaliser les chunks très courts
    if (content.length < 100) quality *= 0.5;
    
    // Pénaliser les chunks avec beaucoup de caractères spéciaux
    const specialChars = content.match(/[^a-zA-Z0-9\s]/g);
    if (specialChars && specialChars.length > content.length * 0.3) {
      quality *= 0.7;
    }
    
    // Bonus pour les chunks avec des phrases complètes
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 20);
    if (sentences.length >= 2) quality *= 1.2;
    
    return Math.min(quality, 1.0);
  }

  private countTokens(text: string): number {
    // Approximation simple (à remplacer par un vrai tokenizer)
    return Math.ceil(text.split(/\s+/).length * 1.3);
  }

  private calculateSimilarity(embedding1: string | null, embedding2: string | null): number {
    // Implémentation temporaire - sera remplacée par pgvector
    if (!embedding1 || !embedding2) return 0;
    
    try {
      const vec1 = JSON.parse(embedding1);
      const vec2 = JSON.parse(embedding2);
      
      // Similarité cosinus simple
      let dotProduct = 0;
      let norm1 = 0;
      let norm2 = 0;
      
      for (let i = 0; i < vec1.length; i++) {
        dotProduct += vec1[i] * vec2[i];
        norm1 += vec1[i] * vec1[i];
        norm2 += vec2[i] * vec2[i];
      }
      
      return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
    } catch {
      return 0;
    }
  }
}

// 🚀 Service d'embeddings optimisé - OpenAI text-embedding-3-small
class EmbeddingService {
  private static readonly OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';
  private static readonly OPENAI_API_URL = 'https://api.openai.com/v1/embeddings';

  constructor() {
    // Vérifier que la clé API OpenAI est configurée
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY manquante pour le service d\'embeddings');
    }
  }

  async generateEmbedding(text: string): Promise<number[]> {
    try {
      console.log(`🚀 [EMBEDDING-FAST] Génération OpenAI pour: "${text.slice(0, 50)}..."`);
      const startTime = Date.now();

      const response = await fetch(EmbeddingService.OPENAI_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: EmbeddingService.OPENAI_EMBEDDING_MODEL,
          input: text,
          encoding_format: 'float'
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API erreur (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      const embedding = data.data?.[0]?.embedding;

      if (!embedding || !Array.isArray(embedding)) {
        throw new Error('Format de réponse OpenAI invalide');
      }

      const duration = Date.now() - startTime;
      console.log(`✅ [EMBEDDING-FAST] Embedding généré en ${duration}ms: ${embedding.length} dimensions`);
      return embedding;

    } catch (error) {
      console.error('❌ [EMBEDDING-FAST] Erreur génération embedding:', error);
      throw error;
    }
  }

  // 🚀 BONUS: Méthode batch pour traiter plusieurs chunks d'un coup (future optimisation)
  async generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
    try {
      console.log(`🚀 [EMBEDDING-BATCH] Génération batch de ${texts.length} embeddings...`);
      const startTime = Date.now();

      const response = await fetch(EmbeddingService.OPENAI_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: EmbeddingService.OPENAI_EMBEDDING_MODEL,
          input: texts,
          encoding_format: 'float'
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API erreur (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      const embeddings = data.data?.map((item: any) => item.embedding) || [];

      if (embeddings.length !== texts.length) {
        throw new Error(`Nombre d'embeddings reçus (${embeddings.length}) != textes envoyés (${texts.length})`);
      }

      const duration = Date.now() - startTime;
      console.log(`✅ [EMBEDDING-BATCH] ${embeddings.length} embeddings générés en ${duration}ms (${Math.round(duration/embeddings.length)}ms/embedding)`);
      return embeddings;

    } catch (error) {
      console.error('❌ [EMBEDDING-BATCH] Erreur génération batch:', error);
      throw error;
    }
  }
}

export const ragSystem = new RAGSystem();
