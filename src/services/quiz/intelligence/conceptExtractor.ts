/**
 * 🧠 Quiz Intelligence - Service d'extraction des concepts
 * PEN-15: Extrait automatiquement les concepts clés des pages
 */

import { logger } from "../../../utils/logger.js";
import OpenAI from "openai";
import { prisma } from "../../../lib/prisma.js";
import { extractTextFromBlockNote } from "../../../controllers/assistant/helpers/blocknote.js";
import { z } from "zod";
import {
  type ExtractedConcepts,
  type Difficulty,
  type ContentStats,
  type ExtractionOptions,
  type ExtractionResult,
  EXTRACTION_PROMPT,
  EXTRACTION_MODEL,
  EMBEDDING_DIMENSION,
} from "./types.js";

// Lazy initialization OpenAI
let openaiClient: OpenAI | null = null;

const ExtractedConceptsSchema = z.object({
  keywords: z.array(z.string()),
  definitions: z.record(z.string()),
  keyPoints: z.array(z.string()),
  formulas: z.array(z.string()),
  topic: z.string(),
  summary: z.string(),
});

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "OPENAI_API_KEY manquant dans les variables d'environnement",
      );
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

/**
 * Service d'extraction des concepts pour le système Quiz Intelligence
 */
export class ConceptExtractorService {
  /**
   * Extrait et stocke les concepts d'une page
   * Point d'entrée principal du service
   */
  static async extractAndStore(
    pageId: string,
    options: ExtractionOptions = {},
  ): Promise<ExtractionResult> {
    const startTime = Date.now();
    const {
      forceRefresh = false,
      generateEmbedding = true,
      skipAI = false,
    } = options;

    logger.log(`🧠 [ConceptExtractor] Extraction pour page ${pageId}...`);

    try {
      // 1. Vérifier si l'extraction existe déjà
      if (!forceRefresh) {
        const existing = await prisma.pageConcepts.findUnique({
          where: { pageId },
        });
        if (existing) {
          logger.log(
            `🧠 [ConceptExtractor] Concepts déjà extraits, skip (use forceRefresh=true)`,
          );
          return {
            success: true,
            pageId,
            concepts: {
              keywords: existing.keywords,
              definitions:
                (existing.definitions as Record<string, string>) || {},
              keyPoints: existing.keyPoints,
              formulas: existing.formulas,
              topic: existing.topic || "",
              summary: existing.summary || "",
            },
            embedding: existing.embedding,
            difficulty: existing.difficulty as Difficulty,
            stats: {
              wordCount: existing.wordCount,
              conceptCount: existing.conceptCount,
              hasFormulas: existing.formulas.length > 0,
              hasDefinitions:
                Object.keys(existing.definitions || {}).length > 0,
            },
            extractedAt: existing.lastExtractedAt,
            processingTimeMs: Date.now() - startTime,
          };
        }
      }

      // 2. Récupérer le contenu de la page
      const page = await prisma.page.findUnique({
        where: { id: pageId },
        select: {
          id: true,
          title: true,
          blockNoteContent: true,
        },
      });

      if (!page) {
        return {
          success: false,
          pageId,
          concepts: null,
          embedding: null,
          difficulty: "medium",
          stats: {
            wordCount: 0,
            conceptCount: 0,
            hasFormulas: false,
            hasDefinitions: false,
          },
          extractedAt: new Date(),
          processingTimeMs: Date.now() - startTime,
          error: "Page non trouvée",
        };
      }

      // 3. Extraire le texte du contenu BlockNote
      const blocks = Array.isArray(page.blockNoteContent)
        ? (page.blockNoteContent as unknown[])
        : null;
      if (!blocks || blocks.length === 0) {
        logger.log(`🧠 [ConceptExtractor] Page vide, skip`);
        return {
          success: false,
          pageId,
          concepts: null,
          embedding: null,
          difficulty: "medium",
          stats: {
            wordCount: 0,
            conceptCount: 0,
            hasFormulas: false,
            hasDefinitions: false,
          },
          extractedAt: new Date(),
          processingTimeMs: Date.now() - startTime,
          error: "Page sans contenu",
        };
      }

      const textContent = extractTextFromBlockNote(blocks);
      const wordCount = textContent
        .split(/\s+/)
        .filter((w) => w.length > 0).length;

      // Minimum de contenu requis
      if (wordCount < 50) {
        logger.log(
          `🧠 [ConceptExtractor] Contenu trop court (${wordCount} mots), skip`,
        );
        return {
          success: false,
          pageId,
          concepts: null,
          embedding: null,
          difficulty: "easy",
          stats: {
            wordCount,
            conceptCount: 0,
            hasFormulas: false,
            hasDefinitions: false,
          },
          extractedAt: new Date(),
          processingTimeMs: Date.now() - startTime,
          error: `Contenu trop court (${wordCount} mots, minimum 50)`,
        };
      }

      // 4. Extraction AI ou basique
      let concepts: ExtractedConcepts;
      if (skipAI) {
        concepts = this.extractBasic(textContent, page.title);
      } else {
        concepts = await this.extractWithAI(textContent);
      }

      // 5. Générer l'embedding
      let embedding: number[] | null = null;
      if (generateEmbedding && !skipAI) {
        const embeddingText = `${page.title}. ${concepts.summary} ${concepts.keyPoints.join(". ")}`;
        embedding = await this.generateEmbedding(embeddingText);
      }

      // 6. Détecter la difficulté
      const difficulty = this.detectDifficulty(textContent, concepts);

      // 7. Calculer les stats
      const stats: ContentStats = {
        wordCount,
        conceptCount: concepts.keywords.length + concepts.keyPoints.length,
        hasFormulas: concepts.formulas.length > 0,
        hasDefinitions: Object.keys(concepts.definitions).length > 0,
      };

      // 8. Sauvegarder en base
      await prisma.pageConcepts.upsert({
        where: { pageId },
        create: {
          pageId,
          keywords: concepts.keywords,
          definitions: concepts.definitions,
          keyPoints: concepts.keyPoints,
          formulas: concepts.formulas,
          summary: concepts.summary,
          topic: concepts.topic,
          embedding: embedding || [],
          difficulty,
          wordCount: stats.wordCount,
          conceptCount: stats.conceptCount,
          lastExtractedAt: new Date(),
        },
        update: {
          keywords: concepts.keywords,
          definitions: concepts.definitions,
          keyPoints: concepts.keyPoints,
          formulas: concepts.formulas,
          summary: concepts.summary,
          topic: concepts.topic,
          embedding: embedding || [],
          difficulty,
          wordCount: stats.wordCount,
          conceptCount: stats.conceptCount,
          lastExtractedAt: new Date(),
        },
      });

      const processingTimeMs = Date.now() - startTime;
      logger.log(
        `✅ [ConceptExtractor] Extraction terminée en ${processingTimeMs}ms`,
      );
      logger.log(
        `   📚 ${concepts.keywords.length} keywords, ${concepts.keyPoints.length} keyPoints`,
      );
      logger.log(
        `   🎯 Topic: "${concepts.topic}", Difficulty: ${difficulty}`,
      );

      return {
        success: true,
        pageId,
        concepts,
        embedding,
        difficulty,
        stats,
        extractedAt: new Date(),
        processingTimeMs,
      };
    } catch (error) {
      logger.error(`❌ [ConceptExtractor] Erreur:`, error);
      return {
        success: false,
        pageId,
        concepts: null,
        embedding: null,
        difficulty: "medium",
        stats: {
          wordCount: 0,
          conceptCount: 0,
          hasFormulas: false,
          hasDefinitions: false,
        },
        extractedAt: new Date(),
        processingTimeMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : "Erreur inconnue",
      };
    }
  }

  /**
   * Extraction AI avec GPT-4o-mini
   */
  private static async extractWithAI(
    content: string,
  ): Promise<ExtractedConcepts> {
    logger.log(`🤖 [ConceptExtractor] Extraction AI (${EXTRACTION_MODEL})...`);

    const openai = getOpenAI();

    // Limiter le contenu pour éviter les dépassements de tokens
    const truncatedContent = content.slice(0, 8000);

    const response = await openai.chat.completions.create({
      model: EXTRACTION_MODEL,
      messages: [
        { role: "system", content: EXTRACTION_PROMPT },
        { role: "user", content: truncatedContent },
      ],
      temperature: 0.3,
      max_tokens: 1500,
      response_format: { type: "json_object" },
    });

    const result = response.choices[0]?.message?.content;
    if (!result) {
      throw new Error("Réponse AI vide");
    }

    try {
      const parsedUnknown: unknown = JSON.parse(result);
      const parsed = ExtractedConceptsSchema.safeParse(parsedUnknown);
      if (!parsed.success) {
        throw new Error("Réponse AI invalide (schema)");
      }
      return parsed.data satisfies ExtractedConcepts;
    } catch {
      logger.error(`❌ [ConceptExtractor] Erreur parsing JSON AI:`, result);
      throw new Error("Réponse AI non parseable");
    }
  }

  /**
   * Extraction basique sans AI (pour tests ou fallback)
   */
  private static extractBasic(
    content: string,
    title: string,
  ): ExtractedConcepts {
    // Extraction simple basée sur la fréquence des mots
    const words = content.toLowerCase().split(/\s+/);
    const wordFreq = new Map<string, number>();

    for (const word of words) {
      if (word.length > 4) {
        wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
      }
    }

    const sortedWords = [...wordFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word]) => word);

    // Détecter les formules LaTeX basiques
    const formulaMatches = content.match(/\$[^$]+\$/g) || [];
    const formulas = formulaMatches.map((f) => f.replace(/\$/g, ""));

    return {
      keywords: sortedWords,
      definitions: {},
      keyPoints: [],
      formulas,
      topic: title.slice(0, 50),
      summary: content.slice(0, 200) + "...",
    };
  }

  /**
   * Génère un embedding avec OpenAI
   */
  private static async generateEmbedding(text: string): Promise<number[]> {
    logger.log(`🔢 [ConceptExtractor] Génération embedding...`);

    const openai = getOpenAI();

    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text.slice(0, 8000), // Limiter la taille
      dimensions: EMBEDDING_DIMENSION,
    });

    const embedding = response.data[0]?.embedding;
    if (!embedding || embedding.length !== EMBEDDING_DIMENSION) {
      throw new Error(`Embedding invalide (dimension: ${embedding?.length})`);
    }

    return embedding;
  }

  /**
   * Détecte la difficulté du contenu
   */
  private static detectDifficulty(
    content: string,
    concepts: ExtractedConcepts,
  ): Difficulty {
    let score = 0;

    // Critères de complexité
    const avgWordLength =
      content.split(/\s+/).reduce((sum, w) => sum + w.length, 0) /
      content.split(/\s+/).length;
    if (avgWordLength > 7) score += 2;
    else if (avgWordLength > 5) score += 1;

    // Présence de formules
    if (concepts.formulas.length > 3) score += 2;
    else if (concepts.formulas.length > 0) score += 1;

    // Nombre de définitions techniques
    if (Object.keys(concepts.definitions).length > 3) score += 2;
    else if (Object.keys(concepts.definitions).length > 0) score += 1;

    // Longueur du contenu
    const wordCount = content.split(/\s+/).length;
    if (wordCount > 1000) score += 1;

    // Classification
    if (score >= 5) return "hard";
    if (score >= 2) return "medium";
    return "easy";
  }

  /**
   * Invalide et rafraîchit les concepts d'une page
   * Utilisé après modification du contenu
   */
  static async invalidateAndRefresh(pageId: string): Promise<ExtractionResult> {
    logger.log(
      `🔄 [ConceptExtractor] Invalidation et refresh pour page ${pageId}`,
    );
    return this.extractAndStore(pageId, { forceRefresh: true });
  }

  /**
   * Supprime les concepts d'une page
   */
  static async deleteConcepts(pageId: string): Promise<boolean> {
    try {
      await prisma.pageConcepts.delete({ where: { pageId } });
      logger.log(
        `🗑️ [ConceptExtractor] Concepts supprimés pour page ${pageId}`,
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Vérifie si une page a des concepts extraits
   */
  static async hasConcepts(pageId: string): Promise<boolean> {
    const count = await prisma.pageConcepts.count({ where: { pageId } });
    return count > 0;
  }

  /**
   * Récupère les concepts d'une page
   */
  static async getConcepts(pageId: string) {
    return prisma.pageConcepts.findUnique({ where: { pageId } });
  }

  /**
   * Extrait les concepts de plusieurs pages en batch
   */
  static async extractBatch(
    pageIds: string[],
    options: ExtractionOptions = {},
  ): Promise<Map<string, ExtractionResult>> {
    logger.log(
      `🧠 [ConceptExtractor] Extraction batch de ${pageIds.length} pages...`,
    );

    const results = new Map<string, ExtractionResult>();

    // Traitement séquentiel pour éviter le rate limiting
    for (const pageId of pageIds) {
      const result = await this.extractAndStore(pageId, options);
      results.set(pageId, result);

      // Petite pause entre les appels AI
      if (!options.skipAI) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    const successCount = [...results.values()].filter((r) => r.success).length;
    logger.log(
      `✅ [ConceptExtractor] Batch terminé: ${successCount}/${pageIds.length} succès`,
    );

    return results;
  }
}
