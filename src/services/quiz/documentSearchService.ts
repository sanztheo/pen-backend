/**
 * Service de recherche documentaire avec embeddings PostgreSQL
 * Permet à l'IA de rechercher dans les documents Wikipedia scrapés
 * Utilise EMBEDDING_DATABASE_URL pour la connexion à la base d'embeddings
 */

import { Pool } from 'pg';
import { AIService } from '../ai/base.js';

// Connexion dédiée à la base d'embeddings
const embeddingPool = new Pool({
  connectionString: process.env.EMBEDDING_DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Topics disponibles dans la base de données (depuis scraper_wikipedia.py)
export const AVAILABLE_TOPICS = [
  'antiquite', 'moyen_age', 'renaissance', 'revolution', 'moderne', 'monde',
  'sciences', 'philosophie', 'arts', 'religions', 'geographie', 'economie',
  'medecine', 'technologie', 'litterature', 'guerre_conflits', 'civilisations',
  'exploration', 'dynasties', 'inventions', 'revolution_sociale', 'architecture',
  'maritime', 'espionnage', 'femmes_histoire', 'biologie', 'physique', 'chimie',
  'mathematiques', 'geologie', 'astronomie', 'philosophie_antique', 'philosophie_moderne',
  'sociologie', 'psychologie', 'linguistique', 'anthropologie', 'ecologie_environnement',
  'informatique', 'droit', 'musique', 'medecine_histoire', 'personnages_contemporains',
  'innovateurs_technologie', 'leaders_mondials_moderne'
] as const;

export type TopicType = typeof AVAILABLE_TOPICS[number];

export interface DocumentChunk {
  id: number;
  doc_id: string;
  parent_id: string | null;
  title: string;
  topic: string;
  extract: string | null;
  content: string;
  source: string | null;
  chunk_index: number;
  total_chunks: number;
  similarity: number;
  word_count: number | null;
  scraped_at: Date | null;
}

export interface SearchRequest {
  query: string;
  limit?: number;
  similarity_threshold?: number;
  topics?: string[];
}

export interface SearchResponse {
  chunks: DocumentChunk[];
  search_strategy: 'topic_based' | 'semantic_search' | 'hybrid';
  detected_topics: string[];
  total_results: number;
  execution_time_ms: number;
}

export interface TopicAnalysisResult {
  detected_topics: string[];
  confidence_scores: Record<string, number>;
  search_strategy: 'topic_based' | 'semantic_search' | 'hybrid';
  reasoning: string;
}

export class DocumentSearchService {
  private static instance: DocumentSearchService;

  static getInstance(): DocumentSearchService {
    if (!DocumentSearchService.instance) {
      DocumentSearchService.instance = new DocumentSearchService();
    }
    return DocumentSearchService.instance;
  }

  /**
   * 🚀 Configuration OpenAI embeddings (remplace Xenova)
   */
  private static readonly OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';
  private static readonly OPENAI_API_URL = 'https://api.openai.com/v1/embeddings';

  private validateOpenAIConfig(): void {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY manquante pour les embeddings');
    }
  }

  /**
   * Normalise les topics générés par l'IA vers les topics disponibles dans la base
   */
  private normalizeAITopics(aiTopics: string[]): string[] {
    const topicMappings: Record<string, string> = {
      'littérature française': 'litterature',
      'littérature': 'litterature',
      'grammaire et syntaxe': 'litterature',
      'histoire de la langue française': 'litterature',
      'genres littéraires': 'litterature',
      'auteurs classiques': 'litterature',
      'français': 'litterature',
      'brevet français': 'litterature',
      'histoire de france': 'moderne',
      'révolution française': 'revolution',
      'première guerre mondiale': 'guerre_conflits',
      'seconde guerre mondiale': 'guerre_conflits',
      'mathématiques': 'sciences',
      'sciences naturelles': 'sciences',
      'philosophie moderne': 'philosophie',
      'art contemporain': 'arts',
      'économie moderne': 'economie'
    };

    const normalizedTopics: string[] = [];
    
    for (const topic of aiTopics) {
      const normalized = topicMappings[topic.toLowerCase()] || topic.toLowerCase();
      
      // Vérifier si le topic normalisé existe dans AVAILABLE_TOPICS
      if (AVAILABLE_TOPICS.includes(normalized as any)) {
        if (!normalizedTopics.includes(normalized)) {
          normalizedTopics.push(normalized);
        }
      } else {
        // Essayer de trouver un topic qui contient le mot-clé
        const matchingTopic = AVAILABLE_TOPICS.find(availableTopic => 
          topic.toLowerCase().includes(availableTopic) || availableTopic.includes(topic.toLowerCase())
        );
        
        if (matchingTopic && !normalizedTopics.includes(matchingTopic)) {
          normalizedTopics.push(matchingTopic);
        }
      }
    }

    console.log(`🔄 Topics normalisés: ${aiTopics.join(', ')} → ${normalizedTopics.join(', ')}`);
    return normalizedTopics;
  }

  /**
   * Analyse intelligente de la requête utilisateur avec GPT-4.1-nano
   */
  async analyzeQueryTopics(query: string): Promise<TopicAnalysisResult> {
    try {
      // Vérifier si l'IA est configurée
      if (!AIService.isConfigured()) {
        console.warn('⚠️ OpenAI non configuré, utilisation de l\'analyse basique');
        return this.fallbackTopicAnalysis(query);
      }

      // Prompt pour GPT-4.1-nano avec sujets détaillés
      const prompt = `Analysez cette requête de recherche et identifiez les topics historiques les plus pertinents.

REQUÊTE: "${query}"

TOPICS DISPONIBLES avec sujets spécifiques:

- antiquite: Empire romain, République romaine, Jules César, Auguste, Civilisation grecque, Alexandre le Grand, Athènes antique, Sparte, Égypte antique, Pharaons, Cléopâtre, Hatshepsout, Empire byzantin, Perse antique

- moyen_age: Charlemagne, Empire carolingien, Féodalité, Croisades, Louis VII, Philippe Auguste, Saint Louis, Guerre de Cent Ans, Jeanne d'Arc, Charles VII, Louis XI, Vikings, Normands, Templiers

- renaissance: François Ier, Henri IV, Louis XIV, Versailles, Richelieu, Mazarin, Guerres de religion, Réforme protestante, Humanisme, Catherine de Médicis, Henri II, Charles IX, Louis XIII, Fronde, Edit de Nantes, Colbert

- revolution: Révolution française, Louis XVI, Marie-Antoinette, Robespierre, Danton, Marat, Révolution de 1789, Terreur, Directoire, Consulat, Napoléon Bonaparte, Empire français, Napoléon III, Restauration, Monarchie de Juillet

- moderne: Première Guerre mondiale, Seconde Guerre mondiale, Résistance française, Charles de Gaulle, Vichy, Libération, IVe République, Ve République, Mai 68, François Mitterrand, Jacques Chirac, Troisième République

- sciences: Galilée, Newton, Darwin, Einstein, Pasteur, Marie Curie, Lavoisier, Révolution scientifique, Copernic, Kepler, Mendel, Watson et Crick, Archimède, Pythagore, Euclide

- philosophie: Socrate, Platon, Aristote, Descartes, Kant, Nietzsche, Voltaire, Rousseau, Diderot, Montesquieu, Hegel, Marx, Freud, Sartre, Beauvoir, Confucius, Lao Tseu, Bouddha

- arts: Léonard de Vinci, Michel-Ange, Raphaël, Impressionnisme, Monet, Renoir, Van Gogh, Picasso, Art gothique, Art roman, Baroque, Donatello, Botticelli, Caravage, Rembrandt

- guerre_conflits: Guerre de Cent Ans, Guerres de Religion, Guerre de Trente Ans, Guerres napoléoniennes, Guerre de Crimée, Guerre franco-prussienne, Bataille de Verdun, Bataille de la Somme, Débarquement de Normandie

- litterature: Homère, Virgile, Dante, Shakespeare, Molière, Racine, Corneille, Victor Hugo, Balzac, Flaubert, Zola, Proust, Camus, Sartre, Cervantes, Goethe, Tolstoï

- technologie: Johannes Gutenberg, James Watt, Thomas Edison, Nikola Tesla, Alexander Graham Bell, Wright Brothers, Henry Ford, Steve Jobs, Bill Gates, Tim Berners-Lee

- medecine: Hippocrate, Galien, Avicenne, Andreas Vesalius, William Harvey, Edward Jenner, Ignaz Semmelweis, Joseph Lister, Louis Pasteur, Robert Koch, Alexander Fleming

- femmes_histoire: Cléopâtre, Aliénor d'Aquitaine, Jeanne d'Arc, Catherine de Médicis, Marie-Antoinette, Olympe de Gouges, George Sand, Marie Curie, Simone de Beauvoir, Rosa Parks

INSTRUCTIONS:
1. Identifiez les 1-3 topics les plus pertinents en analysant les personnages, événements et sujets spécifiques mentionnés
2. Donnez un score de confiance (0.0-1.0) pour chaque topic
3. Recommandez une stratégie: "topic_based" (topic très précis), "semantic_search" (requête ambiguë), ou "hybrid" (mix)

IMPORTANT: Répondez UNIQUEMENT avec un JSON valide, sans texte supplémentaire, sans commentaires, sans formatage markdown.

Format exact attendu:
{
  "topics": [{"name": "revolution", "confidence": 0.95}],
  "strategy": "topic_based",
  "reasoning": "Explication courte"
}`;

      console.log(`🤖 Analyse GPT pour: "${query}"`);
      
      const aiResult = await AIService.generateContent({
        prompt,
        maxTokens: 200,
        temperature: 0.1 // Très peu de créativité pour être précis
      });

      // Parser la réponse JSON avec gestion d'erreur robuste
      let response;
      try {
        // Nettoie la réponse au cas où il y aurait du texte supplémentaire
        let cleanContent = aiResult.content.trim();
        
        // Extrait le JSON si il y a du texte avant/après
        const jsonMatch = cleanContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          cleanContent = jsonMatch[0];
        }
        
        console.log('🔍 Contenu GPT à parser:', cleanContent.substring(0, 200) + (cleanContent.length > 200 ? '...' : ''));
        
        response = JSON.parse(cleanContent);
      } catch (parseError) {
        console.error('❌ Erreur parsing JSON GPT:', parseError);
        console.error('📄 Contenu brut GPT:', aiResult.content);
        console.warn('🔄 Fallback vers analyse basique...');
        return this.fallbackTopicAnalysis(query);
      }
      
      // Valider la réponse
      if (!response.topics || !Array.isArray(response.topics) || !response.strategy) {
        console.warn('⚠️ Réponse GPT invalide, fallback vers analyse basique');
        console.warn('📋 Réponse reçue:', JSON.stringify(response, null, 2));
        return this.fallbackTopicAnalysis(query);
      }

      // Transformer en format attendu avec normalisation
      const rawTopics = response.topics
        .filter((t: any) => t.confidence >= 0.2)
        .slice(0, 3)
        .map((t: any) => t.name);
      
      const detectedTopics = this.normalizeAITopics(rawTopics);

      const confidenceScores: Record<string, number> = {};
      detectedTopics.forEach((normalizedTopic, index) => {
        // Utiliser la confiance du topic original correspondant
        const originalTopic = rawTopics[index];
        const originalConfidence = response.topics.find((t: any) => t.name === originalTopic)?.confidence || 0.8;
        confidenceScores[normalizedTopic] = originalConfidence;
      });

      console.log(`✅ GPT détecte: ${detectedTopics.join(', ')} (stratégie: ${response.strategy})`);

      return {
        detected_topics: detectedTopics,
        confidence_scores: confidenceScores,
        search_strategy: response.strategy,
        reasoning: `GPT-4.1: ${response.reasoning}`
      };

    } catch (error) {
      console.error('❌ Erreur analyse GPT:', error);
      console.log('🔄 Fallback vers analyse basique...');
      return this.fallbackTopicAnalysis(query);
    }
  }

  /**
   * Analyse basique en fallback si GPT ne fonctionne pas
   */
  private fallbackTopicAnalysis(query: string): TopicAnalysisResult {
    // Version enrichie avec personnages et événements spécifiques
    const detailedKeywords: Record<string, string[]> = {
      'antiquite': [
        'rome', 'romain', 'empire romain', 'république romaine', 'jules césar', 'césar', 'auguste',
        'grèce', 'grec', 'grecque', 'alexandre le grand', 'alexandre', 'athènes', 'sparte',
        'égypte', 'pharaon', 'cléopâtre', 'hatshepsout', 'byzantin', 'perse'
      ],
      'moyen_age': [
        'moyen âge', 'médiéval', 'charlemagne', 'carolingien', 'féodalité', 'croisades',
        'louis vii', 'philippe auguste', 'saint louis', 'guerre de cent ans', 'jeanne d\'arc',
        'charles vii', 'louis xi', 'vikings', 'normands', 'templiers', 'capétiens'
      ],
      'renaissance': [
        'renaissance', 'françois ier', 'henri iv', 'louis xiv', 'versailles', 'richelieu',
        'mazarin', 'guerres de religion', 'réforme protestante', 'humanisme',
        'catherine de médicis', 'henri ii', 'charles ix', 'louis xiii', 'fronde', 'edit de nantes', 'colbert'
      ],
      'revolution': [
        'révolution française', 'révolution', 'louis xvi', 'marie-antoinette', 'robespierre',
        'danton', 'marat', '1789', 'terreur', 'directoire', 'consulat', 'napoléon', 'bonaparte',
        'empire français', 'napoléon iii', 'restauration', 'monarchie de juillet'
      ],
      'moderne': [
        'première guerre mondiale', 'seconde guerre mondiale', 'résistance française',
        'charles de gaulle', 'de gaulle', 'vichy', 'libération', 've république', 'mai 68',
        'françois mitterrand', 'jacques chirac', 'troisième république', 'xxe siècle', '20e siècle'
      ],
      'sciences': [
        'galilée', 'newton', 'darwin', 'einstein', 'pasteur', 'marie curie', 'lavoisier',
        'révolution scientifique', 'copernic', 'kepler', 'mendel', 'watson', 'crick',
        'archimède', 'pythagore', 'euclide', 'science', 'scientifique'
      ],
      'philosophie': [
        'socrate', 'platon', 'aristote', 'descartes', 'kant', 'nietzsche', 'voltaire',
        'rousseau', 'diderot', 'montesquieu', 'hegel', 'marx', 'freud', 'sartre',
        'beauvoir', 'confucius', 'lao tseu', 'bouddha', 'philosophie', 'philosophe'
      ],
      'arts': [
        'léonard de vinci', 'vinci', 'michel-ange', 'raphaël', 'impressionnisme', 'monet',
        'renoir', 'van gogh', 'picasso', 'art gothique', 'art roman', 'baroque',
        'donatello', 'botticelli', 'caravage', 'rembrandt', 'art', 'peinture'
      ],
      'guerre_conflits': [
        'guerre de cent ans', 'guerres de religion', 'guerre de trente ans', 'guerres napoléoniennes',
        'guerre de crimée', 'guerre franco-prussienne', 'bataille de verdun', 'verdun',
        'bataille de la somme', 'débarquement de normandie', 'guerre', 'bataille', 'conflit'
      ],
      'litterature': [
        'homère', 'virgile', 'dante', 'shakespeare', 'molière', 'racine', 'corneille',
        'victor hugo', 'hugo', 'balzac', 'flaubert', 'zola', 'proust', 'camus',
        'cervantes', 'goethe', 'tolstoï', 'littérature', 'littérature française', 
        'écrivain', 'poète', 'roman', 'poésie', 'théâtre', 'genres littéraires',
        'auteurs classiques', 'grammaire', 'syntaxe', 'langue française', 
        'histoire de la langue', 'français', 'brevet français'
      ],
      'technologie': [
        'johannes gutenberg', 'gutenberg', 'james watt', 'thomas edison', 'edison',
        'nikola tesla', 'tesla', 'alexander graham bell', 'wright brothers', 'henry ford',
        'steve jobs', 'bill gates', 'tim berners-lee', 'technologie', 'invention'
      ],
      'medecine': [
        'hippocrate', 'galien', 'avicenne', 'andreas vesalius', 'william harvey',
        'edward jenner', 'ignaz semmelweis', 'joseph lister', 'robert koch',
        'alexander fleming', 'médecine', 'médecin', 'chirurgie'
      ],
      'femmes_histoire': [
        'cléopâtre', 'aliénor d\'aquitaine', 'jeanne d\'arc', 'catherine de médicis',
        'marie-antoinette', 'olympe de gouges', 'george sand', 'simone de beauvoir',
        'rosa parks', 'femme', 'féminisme'
      ]
    };

    const queryLower = query.toLowerCase();
    const confidenceScores: Record<string, number> = {};

    for (const [topic, keywords] of Object.entries(detailedKeywords)) {
      let score = 0;
      for (const keyword of keywords) {
        if (queryLower.includes(keyword.toLowerCase())) {
          // Score plus élevé pour les correspondances exactes de personnages
          const isPersonName = keyword.includes(' ') || keyword.includes('\'');
          score += isPersonName ? 0.8 : 0.4;
        }
      }
      if (score > 0) {
        confidenceScores[topic] = Math.min(score, 1.0);
      }
    }

    const detectedTopics = Object.entries(confidenceScores)
      .filter(([, score]) => score > 0.3)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([topic]) => topic);

    return {
      detected_topics: detectedTopics,
      confidence_scores: confidenceScores,
      search_strategy: detectedTopics.length > 0 ? 'topic_based' : 'semantic_search',
      reasoning: 'Analyse basique enrichie (fallback)'
    };
  }

  /**
   * 🚀 Génère l'embedding d'une requête avec OpenAI text-embedding-3-small
   */
  async generateQueryEmbedding(query: string): Promise<number[] | null> {
    try {
      this.validateOpenAIConfig();

      console.log(`🚀 [EMBEDDING-FAST] Génération OpenAI pour: "${query.slice(0, 50)}..."`);
      const startTime = Date.now();

      const response = await fetch(DocumentSearchService.OPENAI_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: DocumentSearchService.OPENAI_EMBEDDING_MODEL,
          input: query,
          encoding_format: 'float'
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ OpenAI API erreur (${response.status}): ${errorText}`);
        return null;
      }

      const data = await response.json();
      const embedding = data.data?.[0]?.embedding;

      if (!embedding || !Array.isArray(embedding)) {
        console.error('❌ Format de réponse OpenAI invalide');
        return null;
      }

      const duration = Date.now() - startTime;
      console.log(`✅ [EMBEDDING-FAST] Embedding généré en ${duration}ms: ${embedding.length} dimensions`);
      return embedding;

    } catch (error) {
      console.error('❌ Erreur génération embedding OpenAI:', error);
      return null;
    }
  }

  /**
   * Recherche par topics spécifiques
   */
  async searchByTopics(query: string, topics: string[], limit: number = 10, threshold: number = 0.7): Promise<DocumentChunk[]> {
    try {
      // Génère l'embedding réel de la requête
      const queryEmbedding = await this.generateQueryEmbedding(query);
      if (!queryEmbedding) {
        console.error('Impossible de générer l\'embedding pour la requête');
        return [];
      }
      
      const embeddingStr = `[${queryEmbedding.join(',')}]`;

      
      const query_sql = `
        SELECT 
          id,
          doc_id,
          parent_id,
          title,
          topic,
          extract,
          content,
          source,
          chunk_index,
          total_chunks,
          1 - (embedding <=> $1::vector) as similarity,
          word_count,
          scraped_at
        FROM historical_documents 
        WHERE embedding IS NOT NULL
          AND topic = ANY($2::text[])
          AND (1 - (embedding <=> $1::vector)) > $3
        ORDER BY embedding <=> $1::vector
        LIMIT $4;
      `;

      const result = await embeddingPool.query(query_sql, [
        embeddingStr,
        topics,
        threshold,
        limit
      ]);

      return result.rows.map(row => ({
        id: row.id,
        doc_id: row.doc_id,
        parent_id: row.parent_id,
        title: row.title,
        topic: row.topic,
        extract: row.extract,
        content: row.content,
        source: row.source,
        chunk_index: row.chunk_index,
        total_chunks: row.total_chunks,
        similarity: parseFloat(row.similarity),
        word_count: row.word_count,
        scraped_at: row.scraped_at
      }));
    } catch (error) {
      console.error('Erreur recherche par topics:', error);
      return [];
    }
  }

  /**
   * Recherche sémantique pure (sans filtre de topics)
   */
  async semanticSearch(query: string, limit: number = 10, threshold: number = 0.6): Promise<DocumentChunk[]> {
    try {
      // Génère l'embedding réel de la requête
      const queryEmbedding = await this.generateQueryEmbedding(query);
      if (!queryEmbedding) {
        console.error('Impossible de générer l\'embedding pour la requête');
        return [];
      }
      
      const embeddingStr = `[${queryEmbedding.join(',')}]`;

      const query_sql = `
        SELECT 
          id,
          doc_id,
          parent_id,
          title,
          topic,
          extract,
          content,
          source,
          chunk_index,
          total_chunks,
          1 - (embedding <=> $1::vector) as similarity,
          word_count,
          scraped_at
        FROM historical_documents 
        WHERE embedding IS NOT NULL
          AND (1 - (embedding <=> $1::vector)) > $2
        ORDER BY embedding <=> $1::vector
        LIMIT $3;
      `;

      const result = await embeddingPool.query(query_sql, [
        embeddingStr,
        threshold,
        limit
      ]);

      return result.rows.map(row => ({
        id: row.id,
        doc_id: row.doc_id,
        parent_id: row.parent_id,
        title: row.title,
        topic: row.topic,
        extract: row.extract,
        content: row.content,
        source: row.source,
        chunk_index: row.chunk_index,
        total_chunks: row.total_chunks,
        similarity: parseFloat(row.similarity),
        word_count: row.word_count,
        scraped_at: row.scraped_at
      }));
    } catch (error) {
      console.error('Erreur recherche sémantique:', error);
      return [];
    }
  }

  /**
   * Recherche hybride (topics + sémantique)
   */
  async hybridSearch(query: string, topics: string[], limit: number = 10): Promise<DocumentChunk[]> {
    // 70% des résultats par topics, 30% par recherche sémantique
    const topicLimit = Math.ceil(limit * 0.7);
    const semanticLimit = limit - topicLimit;

    const [topicResults, semanticResults] = await Promise.all([
      this.searchByTopics(query, topics, topicLimit, 0.6),
      this.semanticSearch(query, semanticLimit, 0.5)
    ]);

    // Combiner et déduper par doc_id pour éviter les doublons
    const combined = [...topicResults, ...semanticResults];
    
    // Déduplication intelligente : garder le chunk avec la meilleure similarité par document
    const docMap = new Map<string, DocumentChunk>();
    
    for (const chunk of combined) {
      const docKey = chunk.parent_id || chunk.doc_id;
      const existing = docMap.get(docKey);
      
      if (!existing || chunk.similarity > existing.similarity) {
        docMap.set(docKey, chunk);
      }
    }

    return Array.from(docMap.values())
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  /**
   * Méthode principale de recherche intelligente
   */
  async searchDocuments(request: SearchRequest): Promise<SearchResponse> {
    const startTime = Date.now();
    const { query, limit = 10, similarity_threshold, topics } = request;

    let searchStrategy: 'topic_based' | 'semantic_search' | 'hybrid';
    let detectedTopics: string[] = [];
    let chunks: DocumentChunk[] = [];

    if (topics && topics.length > 0) {
      // Recherche forcée par topics avec normalisation
      searchStrategy = 'topic_based';
      detectedTopics = this.normalizeAITopics(topics);
      console.log(`🔄 Topics forcés normalisés: ${topics.join(', ')} → ${detectedTopics.join(', ')}`);
      chunks = await this.searchByTopics(query, detectedTopics, limit, similarity_threshold || 0.7);
    } else {
      // Analyse intelligente de la requête
      const analysis = await this.analyzeQueryTopics(query);
      searchStrategy = analysis.search_strategy;
      detectedTopics = analysis.detected_topics;

      console.log(`🧠 Analyse IA: "${query}" → ${analysis.reasoning}`);

      switch (searchStrategy) {
        case 'topic_based':
          // Essaie avec seuil standard puis relaxé si aucun résultat
          chunks = await this.searchByTopics(query, detectedTopics, limit, similarity_threshold || 0.7);
          if (chunks.length === 0) {
            console.log('🔄 Aucun résultat avec seuil 0.7, essai avec 0.5...');
            chunks = await this.searchByTopics(query, detectedTopics, limit, 0.5);
          }
          if (chunks.length === 0) {
            console.log('🔄 Aucun résultat avec seuil 0.5, essai avec 0.3...');
            chunks = await this.searchByTopics(query, detectedTopics, limit, 0.3);
          }
          break;
        case 'hybrid':
          chunks = await this.hybridSearch(query, detectedTopics, limit);
          break;
        case 'semantic_search':
        default:
          chunks = await this.semanticSearch(query, limit, similarity_threshold || 0.6);
          break;
      }
    }

    const endTime = Date.now();

    return {
      chunks,
      search_strategy: searchStrategy,
      detected_topics: detectedTopics,
      total_results: chunks.length,
      execution_time_ms: endTime - startTime
    };
  }

  /**
   * Obtenir des statistiques sur la base de documents
   */
  async getDocumentStats(): Promise<{
    total_documents: number;
    total_chunks: number;
    topics_available: string[];
    documents_with_embeddings: number;
  }> {
    try {
      const statsResult = await embeddingPool.query(`
        SELECT 
          COUNT(DISTINCT parent_id) as total_documents,
          COUNT(*) as total_chunks,
          COUNT(CASE WHEN embedding IS NOT NULL THEN 1 END) as documents_with_embeddings
        FROM historical_documents;
      `);

      const topicsResult = await embeddingPool.query(`
        SELECT DISTINCT topic 
        FROM historical_documents 
        WHERE topic IS NOT NULL
        ORDER BY topic;
      `);

      const stats = statsResult.rows[0];
      
      return {
        total_documents: parseInt(stats.total_documents || '0'),
        total_chunks: parseInt(stats.total_chunks || '0'),
        documents_with_embeddings: parseInt(stats.documents_with_embeddings || '0'),
        topics_available: topicsResult.rows.map(row => row.topic)
      };
    } catch (error) {
      console.error('Erreur récupération statistiques:', error);
      return {
        total_documents: 0,
        total_chunks: 0,
        documents_with_embeddings: 0,
        topics_available: []
      };
    }
  }

  /**
   * Test de connexion à la base d'embeddings
   */
  async testConnection(): Promise<boolean> {
    try {
      const result = await embeddingPool.query('SELECT 1 as test');
      return result.rows.length > 0;
    } catch (error) {
      console.error('Erreur connexion base embeddings:', error);
      return false;
    }
  }
}

export const documentSearchService = DocumentSearchService.getInstance();