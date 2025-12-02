// 🚀 RAG System - Service Principal
import { prismaEmbeddings } from "../../lib/prismaEmbeddings.js";
import type { RAGSourceType } from "../../../node_modules/.prisma/client-embeddings/index.js";

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
  cleanContent?: string;
  tokenCount?: number;
  language?: string;
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
    mimeType: string,
  ): Promise<string> {
    try {
      // 1. Créer la source RAG
      const source = await prismaEmbeddings.rAGSource.create({
        data: {
          userId,
          workspaceId,
          sourceType: "PDF",
          title: fileName.replace(/\.[^/.]+$/, ""), // Nom sans extension
          fileName,
          fileSize: file.length,
          mimeType,
          status: "PROCESSING",
        },
      });

      // 2. Extraction du contenu PDF
      const pdfContent = await this.extractPDFContent(file);

      // 3. Chunking intelligent
      const chunks = await this.intelligentChunking(pdfContent, {
        maxSize: 1000,
        overlap: 200,
        respectSentences: true,
        respectParagraphs: true,
      });

      // 4. Génération des embeddings et sauvegarde
      await this.processChunks(source.id, chunks);

      // 5. Mettre à jour le statut
      await prismaEmbeddings.rAGSource.update({
        where: { id: source.id },
        data: {
          status: "COMPLETED",
          totalChunks: chunks.length,
          totalPages: pdfContent.totalPages,
        },
      });

      return source.id;
    } catch (error) {
      console.error("Erreur traitement PDF:", error);
      throw new Error(
        `Échec du traitement PDF: ${error instanceof Error ? error.message : "Erreur inconnue"}`,
      );
    }
  }

  // 🧠 Intelligence de requête NotebookLM-style avec GPT-4.1-nano
  async shouldUseRAG(
    query: string,
    availableSources?: Array<{ title: string; type: string }>,
  ): Promise<boolean> {
    const normalizedQuery = query.toLowerCase().trim();

    // Cas évidents - pas besoin d'appeler GPT
    if (normalizedQuery.length <= 2) {
      return false;
    }

    try {
      let prompt = `Analyse cette requête utilisateur et détermine si elle nécessite une recherche dans des documents (RAG).

RÈGLES :
- Salutations/politesses (salut, bonjour, merci) = NON RAG
- Questions sur l'IA elle-même (qui es-tu, comment tu fonctionnes) = NON RAG  
- Commandes système (aide, help, quit) = NON RAG
- Questions générales de culture générale = NON RAG (sauf si des sources pertinentes sont disponibles)
- Questions nécessitant des informations spécifiques = OUI RAG
- Questions de résumé de contenu = OUI RAG

Requête: "${query}"`;

      // 🎯 NOUVEAU: Si des sources sont disponibles, vérifier leur pertinence
      if (availableSources && availableSources.length > 0) {
        const sourcesList = availableSources
          .map((s) => `- ${s.title} (${s.type})`)
          .join("\n");
        prompt += `

Sources disponibles dans la session active:
${sourcesList}

⚠️ IMPORTANT: Utilise le RAG UNIQUEMENT si au moins UNE source est pertinente pour répondre à la requête.
Si AUCUNE source n'est pertinente (ex: sources sur "Caca" pour une question sur "Python"), réponds NON.`;
      }

      prompt += `\n\nRéponds uniquement "OUI" ou "NON"`;

      const response = await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: process.env.OPENAI_DETECTION_MODEL || "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            temperature: 0,
            max_tokens: 10,
          }),
        },
      );

      const result = (await response.json()) as OpenAIChatCompletion;
      const decision = result.choices?.[0]?.message?.content
        ?.trim()
        ?.toUpperCase();

      if (availableSources && availableSources.length > 0) {
        console.log(
          `🧠 [RAG-DETECTION-SMART] Query: "${query}" | Sources: [${availableSources.map((s) => s.title).join(", ")}] → Decision: ${decision}`,
        );
      } else {
        console.log(
          `🧠 [RAG-DETECTION] Query: "${query}" → Decision: ${decision}`,
        );
      }

      return decision === "OUI";
    } catch (error) {
      console.error("Erreur détection RAG, fallback to false:", error);
      return false; // 🔧 FIX: En cas d'erreur, ne PAS forcer le RAG avec des sources non pertinentes
    }
  }

  // 🔍 Recherche RAG intelligente NotebookLM-style avec GPT-4.1-nano
  async intelligentSearch(
    query: string,
    options: RAGSearchOptions = {},
  ): Promise<RAGSearchResult[]> {
    try {
      const questionType = await this.detectQuestionType(query);
      console.log(
        `🔍 [RAG-NOTEBOOKLM] Type de question détecté: ${questionType}`,
      );

      switch (questionType) {
        case "RESUME":
          console.log(
            `🔍 [RAG-NOTEBOOKLM] Question de résumé → meilleurs chunks par qualité`,
          );
          return await this.getBestQualityChunks(options);

        case "EXPLICATION":
          console.log(
            `🔍 [RAG-NOTEBOOKLM] Question d'explication → recherche vectorielle optimisée`,
          );
          return await this.search(query, {
            ...options,
            threshold: 0.15,
            limit: 8,
          });

        case "FACTUELLE":
        default:
          console.log(
            `🔍 [RAG-NOTEBOOKLM] Question factuelle → recherche vectorielle standard`,
          );
          return await this.search(query, options);
      }
    } catch (error) {
      console.error(
        "Erreur détection type question, fallback recherche standard:",
        error,
      );
      return await this.search(query, options);
    }
  }

  // 🎯 Détection du type de question avec GPT-4.1-nano
  private async detectQuestionType(
    query: string,
  ): Promise<"RESUME" | "EXPLICATION" | "FACTUELLE"> {
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
      const isGpt5Nano =
        process.env.OPENAI_DETECTION_MODEL?.includes("gpt-5-nano");
      console.log(
        `🔑 [API-DEBUG] OPENAI_API_KEY présente: ${!!process.env.OPENAI_API_KEY}`,
      );
      console.log(
        `🤖 [API-DEBUG] Model utilisé: ${process.env.OPENAI_DETECTION_MODEL || "gpt-4o-mini"}`,
      );
      console.log(`⚙️ [API-DEBUG] Mode gpt-5-nano détecté: ${isGpt5Nano}`);

      const response = await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: process.env.OPENAI_DETECTION_MODEL || "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            // 🔧 Fix température pour gpt-5-nano-2025-08-07 (seul default=1 supporté)
            ...(process.env.OPENAI_DETECTION_MODEL?.includes("gpt-5-nano")
              ? {} // Pas de température pour gpt-5-nano (utilise default=1)
              : { temperature: 0 }), // temperature=0 pour autres modèles
            // 🔧 Fix max_tokens pour gpt-5-nano-2025-08-07
            ...(process.env.OPENAI_DETECTION_MODEL?.includes("gpt-5-nano")
              ? { max_completion_tokens: 30 }
              : { max_tokens: 30 }),
            response_format: { type: "json_object" }, // 🚀 Force JSON strict
          }),
        },
      );

      console.log(
        `🌐 [API-DEBUG] Response status: ${response.status} ${response.statusText}`,
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          `❌ [API-ERROR] OpenAI API Error: ${response.status} - ${errorText}`,
        );
        return "RESUME"; // Fallback intelligent pour "Résumé"
      }

      const result = (await response.json()) as OpenAIChatCompletion;
      const rawResponse = result.choices?.[0]?.message?.content?.trim();

      console.log(`📤 [API-DEBUG] Raw JSON response: "${rawResponse}"`);

      try {
        // 🚀 Parse du JSON strict
        const jsonResponse = JSON.parse(rawResponse || "{}");
        const questionType = jsonResponse.type?.toUpperCase();

        console.log(
          `🎯 [DETECT-JSON-2025] Query: "${query}" → JSON: ${rawResponse} → Type: ${questionType}`,
        );

        if (["RESUME", "EXPLICATION", "FACTUELLE"].includes(questionType)) {
          return questionType as "RESUME" | "EXPLICATION" | "FACTUELLE";
        }

        console.warn(
          `⚠️ [JSON-ERROR] Type invalide dans JSON: "${questionType}"`,
        );
      } catch (parseError) {
        console.error(
          `❌ [JSON-PARSE-ERROR] JSON invalide: "${rawResponse}"`,
          parseError,
        );
      }

      // Fallback intelligent si JSON échoue
      console.warn(`🔄 [JSON-FALLBACK] Utilisation du fallback déterministe`);
      return this.detectQuestionTypeFallback(query);
    } catch (error) {
      console.error("❌ [API-ERROR] Erreur détection type question:", error);

      return this.detectQuestionTypeFallback(query);
    }
  }

  // 🔄 Fallback déterministe pour détection de type question (si OpenAI échoue)
  private detectQuestionTypeFallback(
    query: string,
  ): "RESUME" | "EXPLICATION" | "FACTUELLE" {
    const queryLower = query.toLowerCase().trim();

    // Mots-clés RESUME (requêtes de synthèse)
    const resumeKeywords = [
      "résumé",
      "resume",
      "synthèse",
      "synthese",
      "contenu",
      "parle de quoi",
      "global",
      "général",
      "vue d'ensemble",
      "essentiel",
      "principal",
    ];

    // Mots-clés EXPLICATION
    const explanationKeywords = [
      "comment",
      "pourquoi",
      "explique",
      "explication",
      "principe",
      "fonctionnement",
      "mécanisme",
      "processus",
    ];

    if (resumeKeywords.some((keyword) => queryLower.includes(keyword))) {
      console.log(`🔄 [FALLBACK] "${query}" → RESUME (mot-clé détecté)`);
      return "RESUME";
    }

    if (explanationKeywords.some((keyword) => queryLower.includes(keyword))) {
      console.log(`🔄 [FALLBACK] "${query}" → EXPLICATION (mot-clé détecté)`);
      return "EXPLICATION";
    }

    console.log(`🔄 [FALLBACK] "${query}" → FACTUELLE (défaut)`);
    return "FACTUELLE";
  }

  // 📊 Récupération des chunks de meilleure qualité avec diversification (pour questions générales)
  private async getBestQualityChunks(
    options: RAGSearchOptions = {},
  ): Promise<RAGSearchResult[]> {
    const {
      limit = 10, // Augmenté pour avoir plus de variété
      workspaceId,
      userId,
      specificPageIds, // 🆕 Pages spécifiques à utiliser
      specificSourceIds, // 🆕 Sources RAG spécifiques à utiliser
    } = options;

    try {
      let whereClause: any = {
        source: {
          status: "COMPLETED",
        },
      };

      // 🆕 Si des sources RAG spécifiques sont demandées, filtrer par ces sources
      if (specificSourceIds && specificSourceIds.length > 0) {
        whereClause = {
          sourceId: { in: specificSourceIds }, // Filtrer les chunks par ID de source RAG
          source: {
            status: "COMPLETED",
          },
        };
        console.log(
          `🔍 [RAG-QUALITY] Filtrage par sources RAG spécifiques: ${specificSourceIds.join(", ")}`,
        );
      }
      // 🆕 Sinon, si des pages spécifiques sont demandées, filtrer par ces pages
      else if (specificPageIds && specificPageIds.length > 0) {
        // Filtrer directement par l'ID des sources (qui correspondent aux IDs des pages)
        whereClause = {
          sourceId: { in: specificPageIds }, // Filtrer les chunks par ID de source
          source: {
            status: "COMPLETED",
            userId: userId,
            workspaceId: workspaceId,
            isGlobal: false,
          },
        };
        console.log(
          `🔍 [RAG-QUALITY] Filtrage par pages spécifiques: ${specificPageIds.join(", ")}`,
        );
      } else {
        whereClause.source.OR = [
          // 🌍 Sources globales (Wikipedia) - accessibles à tous
          { isGlobal: true },
          // 🔒 Sources privées de l'utilisateur
          ...(userId && workspaceId
            ? [
                {
                  AND: [
                    { userId: userId },
                    { workspaceId: workspaceId },
                    { isGlobal: false },
                  ],
                },
              ]
            : []),
        ];
      }

      // 🎯 STRATÉGIE DE DIVERSIFICATION :
      // 1. Récupérer plus de chunks par source
      // 2. Appliquer un algorithme de diversification

      console.log(
        "📊 [RAG-QUALITY] Stratégie de diversification pour résumé...",
      );

      // Récupération d'un pool plus large de chunks de qualité
      const allChunks = await prismaEmbeddings.rAGChunk.findMany({
        where: whereClause,
        include: {
          source: {
            select: {
              id: true,
              title: true,
              sourceType: true,
              fileName: true,
            },
          },
        },
        orderBy: [{ quality: "desc" }, { tokenCount: "desc" }],
        take: limit * 3, // Pool 3x plus large pour diversifier
      });

      // 🔥 EARLY RETURN: Si aucun chunk trouvé, retourner immédiatement
      if (allChunks.length === 0) {
        console.log(
          `⚠️ [RAG-QUALITY] Aucun chunk trouvé pour les critères donnés`,
        );
        return [];
      }

      // 🎯 ALGORITHME DE DIVERSIFICATION
      const diversifiedChunks = this.diversifyBySource(allChunks, limit);

      console.log(
        `📊 [RAG-QUALITY] Chunks sélectionnés par source:`,
        this.getSourceStats(diversifiedChunks),
      );

      return diversifiedChunks.map((chunk: any) => ({
        id: chunk.id,
        content: chunk.cleanContent,
        source: chunk.source,
        similarity: 1.0, // Score artificiel élevé car c'est du contenu de qualité
        pageNumber: chunk.pageNumber,
        sectionTitle: chunk.sectionTitle,
      }));
    } catch (error) {
      console.error("Erreur getBestQualityChunks:", error);
      throw new Error(
        `Échec de la récupération: ${error instanceof Error ? error.message : "Erreur inconnue"}`,
      );
    }
  }

  // 🎯 Algorithme de diversification des chunks par source
  private diversifyBySource(chunks: any[], targetLimit: number): any[] {
    // 🔥 EARLY RETURN: Si aucun chunk, retourner immédiatement
    if (chunks.length === 0) {
      console.log(`⚠️ [DIVERSIFICATION] Aucun chunk à diversifier`);
      return [];
    }

    // Grouper les chunks par source
    const chunksBySource = new Map<string, any[]>();

    chunks.forEach((chunk) => {
      const sourceId = chunk.source.id;
      if (!chunksBySource.has(sourceId)) {
        chunksBySource.set(sourceId, []);
      }
      chunksBySource.get(sourceId)!.push(chunk);
    });

    console.log(
      `📊 [DIVERSIFICATION] ${chunksBySource.size} sources disponibles, cible: ${targetLimit} chunks`,
    );

    // 🔥 SAFETY CHECK: Si aucune source, retourner immédiatement (évite division par zéro)
    if (chunksBySource.size === 0) {
      console.log(
        `⚠️ [DIVERSIFICATION] Aucune source disponible après groupement`,
      );
      return [];
    }

    // Stratégie : maximum 2-3 chunks par source pour équilibrer
    const maxChunksPerSource = Math.max(
      2,
      Math.floor(targetLimit / chunksBySource.size) + 1,
    );
    const diversifiedChunks: any[] = [];

    // Round-robin pour équilibrer les sources
    let round = 0;
    const sourceEntries = Array.from(chunksBySource.entries());

    while (
      diversifiedChunks.length < targetLimit &&
      round < maxChunksPerSource
    ) {
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
    chunks.forEach((chunk) => {
      const title = chunk.source.title;
      stats[title] = (stats[title] || 0) + 1;
    });
    return stats;
  }

  // 🔍 Recherche vectorielle intelligente
  async search(
    query: string,
    options: RAGSearchOptions = {},
  ): Promise<RAGSearchResult[]> {
    const {
      limit = 10,
      threshold = 0.2, // Threshold plus réaliste pour RAG
      sources = [],
      workspaceId,
      userId,
      specificPageIds, // 🆕 Ajouter le support des pages spécifiques
      specificSourceIds, // 🆕 Ajouter le support des sources RAG spécifiques
    } = options;

    try {
      console.log(
        `🔍 [RAG-SEARCH] Début recherche: query="${query}", userId="${userId}", workspaceId="${workspaceId}"`,
      );

      // 1. Génération embedding de la question
      const queryEmbedding =
        await this.embeddingService.generateEmbedding(query);
      console.log(
        `🔍 [RAG-SEARCH] Embedding généré: ${JSON.stringify(queryEmbedding).length} chars`,
      );

      // 2. Construction de la requête avec filtres
      let whereClause: any;

      // 🆕 Si des sources RAG spécifiques sont demandées, filtrer par ces sources
      if (specificSourceIds && specificSourceIds.length > 0) {
        console.log(
          `🔍 [RAG-SEARCH] Filtrage par sources RAG spécifiques: ${specificSourceIds.join(", ")}`,
        );
        whereClause = {
          sourceId: { in: specificSourceIds },
          source: {
            status: "COMPLETED",
          },
        };
      }
      // 🆕 Sinon, si des pages spécifiques sont demandées, filtrer par ces pages
      else if (specificPageIds && specificPageIds.length > 0) {
        console.log(
          `🔍 [RAG-SEARCH] Filtrage par pages spécifiques: ${specificPageIds.join(", ")}`,
        );
        whereClause = {
          sourceId: { in: specificPageIds },
          source: {
            status: "COMPLETED",
            userId: userId,
            workspaceId: workspaceId,
            isGlobal: false,
          },
        };
      } else {
        whereClause = {
          source: {
            status: "COMPLETED",
            OR: [
              // 🌍 Sources globales (Wikipedia) - accessibles à tous
              { isGlobal: true },
              // 🔒 Sources privées de l'utilisateur
              ...(userId && workspaceId
                ? [
                    {
                      AND: [
                        { userId: userId },
                        { workspaceId: workspaceId },
                        { isGlobal: false },
                      ],
                    },
                  ]
                : []),
            ],
          },
        };
      }

      // Filtre par sources spécifiques si demandé (seulement si pas déjà filtré par pages spécifiques)
      if (
        sources.length > 0 &&
        !(specificPageIds && specificPageIds.length > 0)
      ) {
        whereClause.source.id = { in: sources };
      }

      console.log(
        `🔍 [RAG-SEARCH] WhereClause:`,
        JSON.stringify(whereClause, null, 2),
      );

      // 3. 🚀 Recherche vectorielle avec pgvector (native PostgreSQL)
      // Construire la clause WHERE SQL à partir du whereClause
      let sqlWhere = "WHERE c.source_id = s.id AND s.status = 'COMPLETED'";

      if (specificSourceIds && specificSourceIds.length > 0) {
        sqlWhere += ` AND c.source_id IN (${specificSourceIds.map((id) => `'${id}'`).join(",")})`;
      } else if (specificPageIds && specificPageIds.length > 0) {
        sqlWhere += ` AND c.source_id IN (${specificPageIds.map((id) => `'${id}'`).join(",")})`;
        if (userId && workspaceId) {
          sqlWhere += ` AND s.user_id = '${userId}' AND s.workspace_id = '${workspaceId}' AND s.is_global = false`;
        }
      } else {
        if (userId && workspaceId) {
          sqlWhere += ` AND (s.is_global = true OR (s.user_id = '${userId}' AND s.workspace_id = '${workspaceId}' AND s.is_global = false))`;
        } else {
          sqlWhere += ` AND s.is_global = true`;
        }
      }

      if (
        sources.length > 0 &&
        !(specificPageIds && specificPageIds.length > 0)
      ) {
        sqlWhere += ` AND s.id IN (${sources.map((id) => `'${id}'`).join(",")})`;
      }

      // 🚀 Requête pgvector avec opérateur de distance cosinus (<=>)
      // 1 - cosine_distance = cosine_similarity
      const embeddingStr = `[${queryEmbedding.join(",")}]`;
      const sql = `
        SELECT
          c.id,
          c.clean_content,
          c.page_number,
          c.section_title,
          s.id as source_id,
          s.title as source_title,
          s.source_type,
          s.file_name,
          1 - (c.embedding <=> '${embeddingStr}'::vector) as similarity
        FROM rag_chunks c
        JOIN rag_sources s ON c.source_id = s.id
        ${sqlWhere}
        ORDER BY c.embedding <=> '${embeddingStr}'::vector
        LIMIT ${limit * 2}
      `;

      console.log(`🚀 [PGVECTOR] Executing vector similarity search...`);
      const rawResults = await prismaEmbeddings.$queryRawUnsafe<any[]>(sql);

      console.log(
        `🚀 [PGVECTOR] Found ${rawResults.length} chunks (top 3 similarities):`,
        rawResults
          .slice(0, 3)
          .map((r) => ({ similarity: r.similarity, threshold })),
      );

      // 4. Filtrer par threshold et formater les résultats
      const results = rawResults
        .filter((row: any) => row.similarity >= threshold)
        .slice(0, limit)
        .map((row: any) => ({
          id: row.id,
          content: row.clean_content,
          source: {
            id: row.source_id,
            title: row.source_title,
            sourceType: row.source_type,
            fileName: row.file_name,
          },
          similarity: row.similarity,
          pageNumber: row.page_number,
          sectionTitle: row.section_title,
        }));

      console.log(
        `🔍 [RAG-SEARCH] Résultats finaux après filtrage par threshold ${threshold}: ${results.length}`,
      );

      // 📊 Mettre à jour lastUsedAt pour les sources utilisées
      if (results.length > 0) {
        const { cleanupService } = await import("./cleanup.js");
        const usedSourceIds = [...new Set(results.map((r) => r.source.id))];
        await cleanupService.updateLastUsedBatch(usedSourceIds);

        // 🔄 Mise à jour spéciale pour les pages utilisateur
        if (userId) {
          try {
            const { userPagesRAG } = await import("./userPages.js");
            const userPageSourceIds = results
              .filter((r) => r.source.sourceType === "WORKSPACE_PAGE")
              .map((r) => r.source.id);

            if (userPageSourceIds.length > 0) {
              await userPagesRAG.updateLastUsed(userPageSourceIds, userId);
            }
          } catch (error) {
            console.error(
              "🔄 [RAG] Erreur mise à jour pages utilisateur:",
              error,
            );
          }
        }
      }

      return results;
    } catch (error) {
      console.error("Erreur recherche RAG:", error);
      throw new Error(
        `Échec de la recherche: ${error instanceof Error ? error.message : "Erreur inconnue"}`,
      );
    }
  }

  // 🎯 Construction du contexte optimisé
  async buildOptimizedContext(
    query: string,
    searchResults: RAGSearchResult[],
  ): Promise<string> {
    const contextParts = [`Question: ${query}`, "", "Sources pertinentes:"];

    searchResults.forEach((result, index) => {
      contextParts.push(
        `## Source ${index + 1}: ${result.source.title}`,
        result.sectionTitle ? `### ${result.sectionTitle}` : "",
        result.pageNumber ? `*Page ${result.pageNumber}*` : "",
        result.content,
        "",
      );
    });

    return contextParts.filter(Boolean).join("\n");
  }

  // 🔧 Méthodes privées
  private async extractPDFContent(file: Buffer): Promise<{
    text: string;
    totalPages: number;
    pages: { pageNumber: number; content: string }[];
  }> {
    // À implémenter avec pdf-parse ou similaire
    const PDF = require("pdf-parse");
    const pdfData = await PDF(file);

    return {
      text: pdfData.text,
      totalPages: pdfData.numpages,
      pages: [], // À enrichir avec l'extraction par page
    };
  }

  private async intelligentChunking(
    pdfContent: { text: string; totalPages: number; pages: any[] },
    options: {
      maxSize: number;
      overlap: number;
      respectSentences: boolean;
      respectParagraphs: boolean;
    },
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
        const lastPeriod = text.lastIndexOf(".", end);
        if (lastPeriod > start + maxSize * 0.5) {
          end = lastPeriod + 1;
        }
      }

      const content = text.slice(start, end);
      const cleanContent = this.cleanContent(content);

      if (cleanContent.trim().length > 50) {
        // Ignorer les chunks trop petits
        chunks.push({
          content: content,
          quality: this.assessChunkQuality(cleanContent),
          startOffset: start,
          endOffset: end,
        });
      }

      start = Math.max(start + maxSize - overlap, end);
      chunkIndex++;
    }

    return chunks;
  }

  private async processChunks(
    sourceId: string,
    chunks: RAGChunkInput[],
  ): Promise<void> {
    const { mapWithConcurrency, chunkArray } =
      await import("../../utils/concurrency.js");
    const concurrency = Math.max(
      1,
      parseInt(process.env.RAG_EMBEDDING_CONCURRENCY || "10", 10),
    );
    const batchSize = Math.max(
      1,
      parseInt(process.env.RAG_DB_BATCH_SIZE || "100", 10),
    );

    const t0 = Date.now();
    console.log(
      `⚙️  [RAG] Embedding ${chunks.length} chunks avec parallélisation x${concurrency}…`,
    );

    // Calculer les embeddings en parallèle (limité)
    const prepared = await mapWithConcurrency(
      chunks,
      concurrency,
      async (chunk, i) => {
        const embedding = await this.embeddingService.generateEmbedding(
          chunk.content,
        );
        return {
          sourceId,
          chunkIndex: i,
          content: chunk.content,
          cleanContent: this.cleanContent(chunk.content),
          embedding: `[${embedding.join(",")}]`, // Format pgvector: '[0.1, 0.2, ...]'
          tokenCount: this.countTokens(chunk.content),
          pageNumber: chunk.pageNumber,
          sectionTitle: chunk.sectionTitle,
          startOffset: chunk.startOffset,
          endOffset: chunk.endOffset,
          quality: chunk.quality || 1.0,
        } as any;
      },
    );

    // Insérer en batch pour réduire les allers-retours DB
    let inserted = 0;
    for (const batch of chunkArray(prepared, batchSize)) {
      // Utiliser SQL brut pour insérer les embeddings (Prisma ne supporte pas vector nativement)
      for (const chunk of batch) {
        await prismaEmbeddings.$executeRaw`
          INSERT INTO "rag_chunks" (
            "id", "source_id", "chunk_index", "content", "clean_content",
            "embedding", "token_count", "page_number", "section_title",
            "start_offset", "end_offset", "quality", "created_at"
          )
          VALUES (
            gen_random_uuid(),
            ${chunk.sourceId}::uuid,
            ${chunk.chunkIndex},
            ${chunk.content},
            ${chunk.cleanContent},
            ${chunk.embedding}::vector,
            ${chunk.tokenCount},
            ${chunk.pageNumber},
            ${chunk.sectionTitle},
            ${chunk.startOffset},
            ${chunk.endOffset},
            ${chunk.quality},
            NOW()
          )
          ON CONFLICT DO NOTHING
        `;
        inserted++;
      }
      console.log(`💾 [RAG] Inséré ${inserted}/${prepared.length} chunks…`);
    }

    console.log(
      `✅ [RAG] Embedding + insertion terminés en ${Date.now() - t0} ms`,
    );
  }

  private cleanContent(content: string): string {
    return content
      .replace(/\s+/g, " ") // Normaliser les espaces
      .replace(/[^\w\s\-.,;:!?()]/g, "") // Garder seulement les caractères utiles
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
    const sentences = content
      .split(/[.!?]+/)
      .filter((s) => s.trim().length > 20);
    if (sentences.length >= 2) quality *= 1.2;

    return Math.min(quality, 1.0);
  }

  private countTokens(text: string): number {
    // Approximation simple (à remplacer par un vrai tokenizer)
    return Math.ceil(text.split(/\s+/).length * 1.3);
  }

  private calculateSimilarity(
    embedding1: number[] | string | null,
    embedding2: string | null,
  ): number {
    // Implémentation temporaire - sera remplacée par pgvector
    if (!embedding1 || !embedding2) return 0;

    try {
      // 🚀 FIX: Support both array and string embeddings
      const vec1 = Array.isArray(embedding1)
        ? embedding1
        : JSON.parse(embedding1);
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

      // 🚀 FIX: Éviter division par zéro qui cause NaN
      const norm1Sqrt = Math.sqrt(norm1);
      const norm2Sqrt = Math.sqrt(norm2);

      if (norm1Sqrt === 0 || norm2Sqrt === 0) {
        console.log(
          `⚠️ [SIMILARITY] Vector normalization is zero - returning 0`,
        );
        return 0;
      }

      const similarity = dotProduct / (norm1Sqrt * norm2Sqrt);

      // 🚀 FIX: Valider que le résultat n'est pas NaN
      if (isNaN(similarity)) {
        console.log(`⚠️ [SIMILARITY] NaN detected - vectors:`, {
          vec1Length: vec1.length,
          vec2Length: vec2.length,
        });
        return 0;
      }

      return similarity;
    } catch {
      return 0;
    }
  }
}

// 🚀 Service d'embeddings optimisé - OpenAI text-embedding-3-small
class EmbeddingService {
  private static readonly OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
  private static readonly OPENAI_API_URL =
    "https://api.openai.com/v1/embeddings";

  constructor() {
    // Vérifier que la clé API OpenAI est configurée
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY manquante pour le service d'embeddings");
    }
  }

  async generateEmbedding(text: string): Promise<number[]> {
    try {
      console.log(
        `🚀 [EMBEDDING-FAST] Génération OpenAI pour: "${text.slice(0, 50)}..."`,
      );
      const startTime = Date.now();

      const response = await fetch(EmbeddingService.OPENAI_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: EmbeddingService.OPENAI_EMBEDDING_MODEL,
          input: text,
          encoding_format: "float",
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API erreur (${response.status}): ${errorText}`);
      }

      const data = (await response.json()) as {
        data?: Array<{ embedding?: number[] }>;
      };
      const embedding = data.data?.[0]?.embedding;

      if (!embedding || !Array.isArray(embedding)) {
        throw new Error("Format de réponse OpenAI invalide");
      }

      const duration = Date.now() - startTime;
      console.log(
        `✅ [EMBEDDING-FAST] Embedding généré en ${duration}ms: ${embedding.length} dimensions`,
      );
      return embedding;
    } catch (error) {
      console.error("❌ [EMBEDDING-FAST] Erreur génération embedding:", error);
      throw error;
    }
  }

  // 🚀 BONUS: Méthode batch pour traiter plusieurs chunks d'un coup (future optimisation)
  async generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
    try {
      console.log(
        `🚀 [EMBEDDING-BATCH] Génération batch de ${texts.length} embeddings...`,
      );
      const startTime = Date.now();

      const response = await fetch(EmbeddingService.OPENAI_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: EmbeddingService.OPENAI_EMBEDDING_MODEL,
          input: texts,
          encoding_format: "float",
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API erreur (${response.status}): ${errorText}`);
      }

      const data = (await response.json()) as {
        data?: Array<{ embedding?: number[] }>;
      };
      const embeddings =
        data.data
          ?.map((item) => item.embedding)
          .filter((emb): emb is number[] => !!emb) || [];

      if (embeddings.length !== texts.length) {
        throw new Error(
          `Nombre d'embeddings reçus (${embeddings.length}) != textes envoyés (${texts.length})`,
        );
      }

      const duration = Date.now() - startTime;
      console.log(
        `✅ [EMBEDDING-BATCH] ${embeddings.length} embeddings générés en ${duration}ms (${Math.round(duration / embeddings.length)}ms/embedding)`,
      );
      return embeddings;
    } catch (error) {
      console.error("❌ [EMBEDDING-BATCH] Erreur génération batch:", error);
      throw error;
    }
  }
}

export const ragSystem = new RAGSystem();
