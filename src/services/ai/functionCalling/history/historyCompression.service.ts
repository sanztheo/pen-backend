/**
 * History Compression Service
 *
 * Compresses conversation history when it exceeds the token threshold (200k tokens).
 * Uses GPT-4o-mini to compress history into 3-5k tokens while preserving key context.
 */

import { AIService } from "../../base.js";
import { TokenCounterService } from "./tokenCounter.service.js";
import type { ConversationHistory } from "./conversationHistory.service.js";

export interface CompressionResult {
  compressedContent: string;
  originalTokens: number;
  compressedTokens: number;
  compressionRatio: number;
  timestamp: number;
}

/**
 * Service for compressing conversation history using GPT-4o-mini
 */
export class HistoryCompressionService {
  // Objectif de compression : 3-5k tokens (on vise 4k en moyenne)
  static readonly TARGET_TOKENS = 4000;

  /**
   * Compresse un historique de conversation en utilisant GPT-4o-mini
   *
   * La compression préserve :
   * - Les sujets principaux discutés
   * - Les sources utilisées
   * - Les insights clés
   * - Le contexte général de la conversation
   */
  static async compressHistory(
    history: ConversationHistory,
  ): Promise<CompressionResult> {
    console.log(
      `🗜️ [COMPRESSION] Début compression historique (${history.messages.length} messages)`,
    );

    // Formater l'historique pour la compression
    const formattedHistory = this.formatHistoryForCompression(history);

    // Compter les tokens originaux
    const originalTokens =
      TokenCounterService.countFormattedHistoryTokens(formattedHistory);

    console.log(
      `📊 [COMPRESSION] Tokens originaux: ${originalTokens.toLocaleString()}`,
    );

    // Estimer le coût
    TokenCounterService.estimateCompressionCost(originalTokens);

    // Appeler GPT-4o-mini pour compresser
    const openai = AIService.getOpenAI();

    const compressionPrompt = `Tu es un expert en compression de conversations. Ton rôle est de résumer un historique de conversation long en préservant UNIQUEMENT les informations essentielles.

OBJECTIF: Compresse cet historique en ~${this.TARGET_TOKENS} tokens (3-5k tokens max).

HISTORIQUE À COMPRESSER:
${formattedHistory}

INSTRUCTIONS DE COMPRESSION:
1. **Sujets principaux**: Liste les thèmes discutés dans l'ordre chronologique
2. **Sources clés**: Mentionne les sources/documents importants utilisés
3. **Insights importants**: Résume les découvertes ou conclusions clés
4. **Contexte utilisateur**: Préserve les préférences ou contraintes mentionnées (web, sources spécifiques, etc.)
5. **Évolution de la conversation**: Note si la conversation a évolué ou changé de direction

FORMAT DE SORTIE:
Structure ton résumé en sections concises:
- **Contexte**: Objectif général de la conversation
- **Sujets traités**: [Sujet 1], [Sujet 2], etc.
- **Sources utilisées**: [Source 1], [Source 2], etc.
- **Insights clés**: Points importants découverts
- **Préférences utilisateur**: web: [oui/non], sources: [spécifiques/toutes], etc.

IMPORTANT:
- Sois ULTRA CONCIS (3-5k tokens max, ~${this.TARGET_TOKENS} tokens idéal)
- Préserve les informations ESSENTIELLES seulement
- Supprime les répétitions et détails superflus
- Utilise des listes à puces pour être concis
- Ne mentionne pas les outils techniques (read_rag_source, etc.), juste le contenu`;

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini", // Modèle économique pour la compression
        messages: [
          {
            role: "system",
            content:
              "You are an expert conversation summarizer. Compress long conversation histories into concise summaries while preserving essential context.",
          },
          {
            role: "user",
            content: compressionPrompt,
          },
        ],
        temperature: 0.3, // Température basse pour cohérence
        max_tokens: 5000, // Maximum 5k tokens (on vise 4k mais on laisse de la marge)
      });

      const compressedContent =
        response.choices[0]?.message?.content || "Erreur de compression";

      // Compter les tokens compressés
      const compressedTokens =
        TokenCounterService.countTokens(compressedContent);
      const compressionRatio = compressedTokens / originalTokens;

      console.log(
        `✅ [COMPRESSION] Compression réussie: ${originalTokens.toLocaleString()} → ${compressedTokens.toLocaleString()} tokens`,
      );
      console.log(
        `📊 [COMPRESSION] Ratio de compression: ${(compressionRatio * 100).toFixed(2)}%`,
      );

      return {
        compressedContent,
        originalTokens,
        compressedTokens,
        compressionRatio,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error("❌ [COMPRESSION] Erreur compression:", error);
      throw new Error(
        `Échec de la compression: ${error instanceof Error ? error.message : "Erreur inconnue"}`,
      );
    }
  }

  /**
   * Formate l'historique pour la compression
   *
   * Structure:
   * ÉCHANGE 1:
   * User: [message] (web: true, sources: "...")
   * AI: Thinking: [...] → Tools: [...] → Response: [...]
   */
  private static formatHistoryForCompression(
    history: ConversationHistory,
  ): string {
    const exchanges: string[] = [];
    let exchangeIndex = 0;

    for (let i = 0; i < history.messages.length; i++) {
      const message = history.messages[i];

      if (message.role === "user") {
        exchangeIndex++;
        const params = message.parameters;
        const paramsStr = [
          params.web ? "web: true" : "",
          params.all ? "all: true" : "",
          params.sources && params.sources.length > 0
            ? `sources: "${params.sources.map((s) => s.title).join(", ")}"`
            : "",
        ]
          .filter(Boolean)
          .join(", ");

        exchanges.push(
          `ÉCHANGE ${exchangeIndex}:\nUser: ${message.content}${paramsStr ? ` (${paramsStr})` : ""}`,
        );
      } else {
        // AI message
        const toolsSummary =
          message.tools.length > 0
            ? message.tools
                .map((t) => `${t.name}(${JSON.stringify(t.arguments)})`)
                .join(", ")
            : "no tools";

        const aiPart = [
          `AI:`,
          `  Thinking: ${message.firstThinking}`,
          `  Tools: ${toolsSummary}`,
          `  Response: ${message.finalResponse}`,
        ].join("\n");

        exchanges[exchanges.length - 1] += "\n" + aiPart;
      }
    }

    return exchanges.join("\n\n");
  }

  /**
   * Vérifie si un historique a besoin de compression
   */
  static needsCompression(totalTokens: number): boolean {
    return totalTokens > TokenCounterService.COMPRESSION_THRESHOLD;
  }
}
