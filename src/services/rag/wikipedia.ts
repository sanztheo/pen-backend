// 🌐 Wikipedia RAG System - Traitement intelligent des articles
import { prismaEmbeddings as prisma } from "../../lib/prismaEmbeddings.js";
import { deduplicationService } from "./deduplication.js";
import type { RAGChunkInput } from "./index.js";

export interface WikipediaArticle {
  pageid: number;
  title: string;
  extract: string;
  fullContent?: string;
  categories?: string[];
  url?: string;
  sections?: WikipediaSection[];
}

export interface WikipediaSection {
  title: string;
  content: string;
  level: number;
  index: number;
}

export class WikipediaRAGSystem {
  // 📖 Traitement intelligent des articles Wikipedia avec déduplication
  async processWikipediaArticles(
    userId: string,
    workspaceId: string | null,
    articles: WikipediaArticle[],
  ): Promise<string[]> {
    const processedSources: string[] = [];

    // 🔍 Étape 1: Vérification en batch des doublons
    const titles = articles.map((a) => a.title);
    const deduplicationResults =
      await deduplicationService.checkMultipleWikipedia(
        userId,
        workspaceId,
        titles,
      );

    console.log(
      `🔄 [DEDUP] Vérification de ${titles.length} articles Wikipedia`,
    );

    for (const article of articles) {
      try {
        const dedupResult = deduplicationResults.get(article.title);

        // 🔄 Si la source existe déjà et a des chunks, la réutiliser
        if (dedupResult?.exists && !dedupResult.shouldUpdate) {
          console.log(
            `♻️ [DEDUP] Réutilisation: "${article.title}" (${dedupResult.chunksCount} chunks existants)`,
          );
          processedSources.push(dedupResult.sourceId!);
          continue;
        }

        // 🔄 Si existe mais sans chunks, nettoyer et recréer
        if (dedupResult?.exists && dedupResult.shouldUpdate) {
          console.log(
            `🧹 [DEDUP] Nettoyage et re-embedding: "${article.title}"`,
          );
          await deduplicationService.forceUpdate(dedupResult.sourceId!);
          // Continuer avec l'embedding normal en utilisant l'ID existant
        }

        // 📖 Récupération du contenu complet (uniquement si nécessaire)
        const fullArticle = await this.getWikipediaFullContent(article.pageid);

        let source;
        if (dedupResult?.exists && dedupResult.shouldUpdate) {
          // Mettre à jour la source existante
          source = await prisma.rAGSource.update({
            where: { id: dedupResult.sourceId },
            data: {
              originalUrl:
                fullArticle.url ||
                `https://fr.wikipedia.org/wiki/${encodeURIComponent(article.title)}`,
              metadata: {
                pageid: article.pageid,
                categories: fullArticle.categories || [],
                extract: article.extract,
                totalSections: fullArticle.sections?.length || 0,
              },
              status: "PROCESSING",
              updatedAt: new Date(),
            },
          });
        } else {
          // 🌍 Créer une nouvelle source GLOBALE (partagée entre tous les utilisateurs)
          source = await prisma.rAGSource.create({
            data: {
              userId: null, // 🔥 NULL pour source globale
              workspaceId: null, // 🔥 NULL pour source globale
              sourceType: "WIKIPEDIA",
              title: article.title,
              originalUrl:
                fullArticle.url ||
                `https://fr.wikipedia.org/wiki/${encodeURIComponent(article.title)}`,
              metadata: {
                pageid: article.pageid,
                categories: fullArticle.categories || [],
                extract: article.extract,
                totalSections: fullArticle.sections?.length || 0,
                createdByUser: userId, // 🔥 Traçabilité: qui a créé cette source globale
              },
              status: "PROCESSING",
              isGlobal: true, // 🔥 Source globale partagée
            },
          });
          console.log(
            `🌍 [WIKIPEDIA-GLOBAL] Source globale créée: "${article.title}" (ID: ${source.id})`,
          );
        }

        // 3. Chunking par sections logiques
        const chunks = await this.chunkWikipediaContent(fullArticle);

        // 4. Traitement des chunks
        await this.processWikipediaChunks(source.id, chunks);

        // 5. Finalisation
        await prisma.rAGSource.update({
          where: { id: source.id },
          data: {
            status: "COMPLETED",
            totalChunks: chunks.length,
          },
        });

        processedSources.push(source.id);
      } catch (error) {
        console.error(`Erreur traitement article ${article.title}:`, error);
        // Continuer avec les autres articles
      }
    }

    return processedSources;
  }

  // 🔍 Enrichissement contextuel d'articles Wikipedia
  async enrichWikipediaContent(
    pageIds: number[],
    query: string,
    mode: "ask" | "search" | "create",
    reflection: "rapide" | "profond",
  ): Promise<{
    articles: Array<{
      title: string;
      url: string;
      fullContent: string;
      categories: string[];
      relevantSections: string[];
    }>;
    totalTokens: number;
  }> {
    const enrichedArticles = [];
    let totalTokens = 0;

    for (const pageid of pageIds) {
      try {
        // 1. Récupération complète
        const fullArticle = await this.getWikipediaFullContent(pageid);

        // 2. Sélection intelligente des sections pertinentes
        const relevantSections = await this.selectRelevantSections(
          fullArticle,
          query,
          mode,
          reflection,
        );

        // 3. Construction du contenu enrichi
        const enrichedContent = this.buildEnrichedContent(
          fullArticle,
          relevantSections,
        );

        enrichedArticles.push({
          title: fullArticle.title,
          url:
            fullArticle.url ||
            `https://fr.wikipedia.org/wiki/${encodeURIComponent(fullArticle.title)}`,
          fullContent: enrichedContent,
          categories: fullArticle.categories || [],
          relevantSections: relevantSections.map((s) => s.title),
        });

        totalTokens += this.estimateTokens(enrichedContent);
      } catch (error) {
        console.error(`Erreur enrichissement article ${pageid}:`, error);
      }
    }

    return { articles: enrichedArticles, totalTokens };
  }

  // 🧠 Sélection intelligente des sections pertinentes
  private async selectRelevantSections(
    article: WikipediaArticle,
    query: string,
    mode: "ask" | "search" | "create",
    reflection: "rapide" | "profond",
  ): Promise<WikipediaSection[]> {
    if (!article.sections) return [];

    // Configuration selon le mode et la réflexion
    const config = this.getSelectionConfig(mode, reflection);

    // 1. Scoring des sections par pertinence
    const scoredSections = await Promise.all(
      article.sections.map(async (section) => {
        const relevanceScore = await this.calculateSectionRelevance(
          section,
          query,
        );
        const qualityScore = this.assessSectionQuality(section);

        return {
          section,
          score: relevanceScore * 0.7 + qualityScore * 0.3,
        };
      }),
    );

    // 2. Sélection selon les critères
    const selectedSections = scoredSections
      .filter((item) => item.score >= config.minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, config.maxSections)
      .map((item) => item.section);

    return selectedSections;
  }

  // ⚙️ Configuration de sélection selon le mode
  private getSelectionConfig(
    mode: "ask" | "search" | "create",
    reflection: "rapide" | "profond",
  ): { maxSections: number; minScore: number } {
    const configs = {
      ask: {
        rapide: { maxSections: 3, minScore: 0.6 },
        profond: { maxSections: 5, minScore: 0.5 },
      },
      search: {
        rapide: { maxSections: 4, minScore: 0.5 },
        profond: { maxSections: 7, minScore: 0.4 },
      },
      create: {
        rapide: { maxSections: 5, minScore: 0.4 },
        profond: { maxSections: 8, minScore: 0.3 },
      },
    };

    return configs[mode][reflection];
  }

  // 🔧 Méthodes utilitaires
  private async getWikipediaFullContent(
    pageid: number,
  ): Promise<WikipediaArticle> {
    try {
      // Types pour les réponses de l'API Wikipedia
      interface WikipediaQueryInfo {
        query?: {
          pages?: {
            [pageid: string]: {
              title: string;
              canonicalurl?: string;
              fullurl?: string;
              missing?: boolean;
            };
          };
        };
      }
      interface WikipediaParseSections {
        parse?: { wikitext?: { "*"?: string } };
      }
      interface WikipediaQueryExtract {
        query?: { pages?: { [pageid: string]: { extract?: string } } };
      }

      // D'abord récupérer les infos de base avec l'API standard
      const infoResponse = await fetch(
        `https://fr.wikipedia.org/w/api.php?action=query&format=json&pageids=${pageid}&prop=info&inprop=url&origin=*`,
      );
      const infoData = (await infoResponse.json()) as WikipediaQueryInfo;
      const pageInfo = infoData.query?.pages?.[pageid.toString()];

      if (!pageInfo || pageInfo.missing) {
        throw new Error(`Page Wikipedia ${pageid} introuvable`);
      }

      const title = pageInfo.title;
      const canonicalUrl = pageInfo.canonicalurl || pageInfo.fullurl;

      // Récupération des sections avec wikitext complet
      const sectionsResponse = await fetch(
        `https://fr.wikipedia.org/w/api.php?action=parse&format=json&pageid=${pageid}&prop=sections|wikitext&origin=*`,
      );
      const sectionsData =
        (await sectionsResponse.json()) as WikipediaParseSections;

      // Traitement des sections
      const sections = await this.parseSections(
        sectionsData.parse?.wikitext?.["*"] || "",
      );

      // Récupération de l'extrait via API query pour cohérence
      const extractResponse = await fetch(
        `https://fr.wikipedia.org/w/api.php?action=query&format=json&pageids=${pageid}&prop=extracts&exintro=1&explaintext=1&exchars=500&origin=*`,
      );
      const extractData =
        (await extractResponse.json()) as WikipediaQueryExtract;
      const extract =
        extractData.query?.pages?.[pageid.toString()]?.extract || "";

      return {
        pageid,
        title,
        extract,
        fullContent: sectionsData.parse?.wikitext?.["*"] || "",
        categories: [], // On récupérera les catégories si nécessaire
        url: canonicalUrl,
        sections,
      };
    } catch (error) {
      console.error(`Erreur récupération Wikipedia ${pageid}:`, error);
      throw error;
    }
  }

  private async parseSections(wikitext: string): Promise<WikipediaSection[]> {
    const sections: WikipediaSection[] = [];
    const lines = wikitext.split("\n");

    let currentSection: Partial<WikipediaSection> = {};
    let sectionIndex = 0;

    for (const line of lines) {
      // Détection des titres de section (== Titre ==)
      const sectionMatch = line.match(/^(={2,6})\s*(.*?)\s*\1$/);

      if (sectionMatch) {
        // Sauvegarder la section précédente
        if (currentSection.title && currentSection.content) {
          sections.push({
            ...currentSection,
            index: sectionIndex++,
          } as WikipediaSection);
        }

        // Nouvelle section
        currentSection = {
          title: sectionMatch[2].trim(),
          content: "",
          level: sectionMatch[1].length - 1,
        };
      } else if (currentSection.title) {
        // Contenu de la section
        const cleanLine = this.cleanWikitextLine(line);
        if (cleanLine.trim()) {
          currentSection.content += cleanLine + "\n";
        }
      }
    }

    // Ajouter la dernière section
    if (currentSection.title && currentSection.content) {
      sections.push({
        ...currentSection,
        index: sectionIndex,
      } as WikipediaSection);
    }

    return sections.filter((section) => section.content.length > 100); // Ignorer sections trop courtes
  }

  private cleanWikitextLine(line: string): string {
    return line
      .replace(/\[\[([^|]+\|)?([^\]]+)\]\]/g, "$2") // Liens [[lien|texte]] → texte
      .replace(/'''([^']+)'''/g, "$1") // Gras
      .replace(/''([^']+)''/g, "$1") // Italique
      .replace(/<[^>]+>/g, "") // Tags HTML
      .replace(/\{\{[^}]+\}\}/g, "") // Templates
      .trim();
  }

  private async chunkWikipediaContent(
    article: WikipediaArticle,
  ): Promise<RAGChunkInput[]> {
    const chunks: RAGChunkInput[] = [];

    if (!article.sections) return chunks;

    for (const section of article.sections) {
      // Chunker chaque section si trop longue
      if (section.content.length > 1500) {
        const sectionChunks = await this.chunkLongSection(section);
        chunks.push(...sectionChunks);
      } else {
        chunks.push({
          content: section.content,
          sectionTitle: section.title,
          quality: this.assessSectionQuality(section),
        });
      }
    }

    return chunks;
  }

  private async chunkLongSection(
    section: WikipediaSection,
  ): Promise<RAGChunkInput[]> {
    const chunks: RAGChunkInput[] = [];
    const paragraphs = section.content.split("\n\n").filter((p) => p.trim());

    let currentChunk = "";

    for (const paragraph of paragraphs) {
      if (currentChunk.length + paragraph.length > 1200) {
        // Sauvegarder le chunk actuel
        if (currentChunk.trim()) {
          chunks.push({
            content: currentChunk.trim(),
            sectionTitle: section.title,
            quality: this.assessSectionQuality(section),
          });
        }
        currentChunk = paragraph;
      } else {
        currentChunk += (currentChunk ? "\n\n" : "") + paragraph;
      }
    }

    // Dernier chunk
    if (currentChunk.trim()) {
      chunks.push({
        content: currentChunk.trim(),
        sectionTitle: section.title,
        quality: this.assessSectionQuality(section),
      });
    }

    return chunks;
  }

  private async processWikipediaChunks(
    sourceId: string,
    chunks: RAGChunkInput[],
  ): Promise<void> {
    const { mapWithConcurrency, chunkArray } =
      await import("../../utils/concurrency.js");
    const concurrency = Math.max(
      1,
      parseInt(process.env.RAG_EMBEDDING_CONCURRENCY || "2", 10),
    );
    const batchSize = Math.max(
      1,
      parseInt(process.env.RAG_DB_BATCH_SIZE || "100", 10),
    );

    const t0 = Date.now();
    console.log(
      `⚙️  [WIKIPEDIA] Embedding ${chunks.length} chunks (x${concurrency})…`,
    );

    const prepared = await mapWithConcurrency(
      chunks,
      concurrency,
      async (chunk, i) => {
        const embedding = await this.generateEmbedding(chunk.content);
        return {
          sourceId,
          chunkIndex: i,
          content: chunk.content,
          cleanContent: this.cleanContent(chunk.content),
          embedding: JSON.stringify(embedding),
          tokenCount: this.estimateTokens(chunk.content),
          sectionTitle: chunk.sectionTitle,
          quality: chunk.quality || 1.0,
        } as any;
      },
    );

    let inserted = 0;
    for (const batch of chunkArray(prepared, batchSize)) {
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
      console.log(
        `💾 [WIKIPEDIA] Inséré ${inserted}/${prepared.length} chunks…`,
      );
    }

    console.log(`✅ [WIKIPEDIA] Terminé en ${Date.now() - t0} ms`);
  }

  private async calculateSectionRelevance(
    section: WikipediaSection,
    query: string,
  ): Promise<number> {
    // Calcul simple de pertinence (à améliorer avec embeddings)
    const queryWords = query.toLowerCase().split(/\s+/);
    const sectionText = (section.title + " " + section.content).toLowerCase();

    let matches = 0;
    for (const word of queryWords) {
      if (sectionText.includes(word)) {
        matches++;
      }
    }

    return matches / queryWords.length;
  }

  private assessSectionQuality(section: WikipediaSection): number {
    let quality = 1.0;

    // Bonus sections importantes
    if (section.level <= 2) quality *= 1.2;

    // Bonus longueur optimale
    if (section.content.length >= 200 && section.content.length <= 2000) {
      quality *= 1.1;
    }

    // Pénalité sections trop courtes ou trop longues
    if (section.content.length < 100) quality *= 0.5;
    if (section.content.length > 3000) quality *= 0.8;

    return Math.min(quality, 1.0);
  }

  private buildEnrichedContent(
    article: WikipediaArticle,
    sections: WikipediaSection[],
  ): string {
    const parts = [
      `# ${article.title}`,
      "",
      article.categories?.length
        ? `**Catégories:** ${article.categories.join(", ")}`
        : "",
      "",
      ...sections
        .map((section) => [`## ${section.title}`, section.content, ""])
        .flat(),
    ];

    return parts.filter(Boolean).join("\n");
  }

  // Méthodes utilitaires réutilisées
  private async generateEmbedding(text: string): Promise<number[]> {
    try {
      // Utilise le service RAG principal
      const { ragSystem } = await import("./index.js");
      return await ragSystem.embeddingService.generateEmbedding(text);
    } catch (error) {
      console.error("Erreur génération embedding Wikipedia:", error);
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

export const wikipediaRAG = new WikipediaRAGSystem();
