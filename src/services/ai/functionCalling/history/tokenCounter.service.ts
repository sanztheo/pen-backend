/**
 * Token Counter Service
 *
 * Counts tokens in conversation history to determine when compression is needed.
 * Uses tiktoken library for accurate GPT token counting.
 */

import { encoding_for_model } from "tiktoken";
import type { ConversationHistory } from "./conversationHistory.service.js";

export interface TokenCount {
  totalTokens: number;
  userMessageTokens: number;
  aiMessageTokens: number;
  needsCompression: boolean;
}

/**
 * Service for counting tokens in conversation history
 */
export class TokenCounterService {
  // Seuil de tokens avant compression (200k comme demandé)
  static readonly COMPRESSION_THRESHOLD = 200_000;

  /**
   * Compte les tokens d'un texte en utilisant tiktoken
   *
   * Note: On utilise gpt-4o comme encodage car c'est le modèle le plus proche
   * de gpt-5.1 en termes de tokenization
   */
  static countTokens(text: string): number {
    try {
      // Utiliser l'encodage de gpt-4o (compatible avec gpt-5.1)
      const encoder = encoding_for_model("gpt-4o");
      const tokens = encoder.encode(text);
      const count = tokens.length;
      encoder.free(); // Libérer la mémoire
      return count;
    } catch (error) {
      console.error("❌ [TOKEN-COUNTER] Erreur comptage tokens:", error);
      // Fallback : estimation basique (1 token ≈ 4 caractères)
      return Math.ceil(text.length / 4);
    }
  }

  /**
   * Compte les tokens d'un historique de conversation complet
   */
  static countHistoryTokens(history: ConversationHistory): TokenCount {
    let totalTokens = 0;
    let userMessageTokens = 0;
    let aiMessageTokens = 0;

    for (const message of history.messages) {
      if (message.role === "user") {
        // Compter le message utilisateur + paramètres
        const paramsText = JSON.stringify(message.parameters);
        const messageTokens =
          this.countTokens(message.content) + this.countTokens(paramsText);
        userMessageTokens += messageTokens;
        totalTokens += messageTokens;
      } else {
        // Compter thinking + tools + réponse finale
        const thinkingTokens = this.countTokens(message.firstThinking);
        const toolsTokens = message.tools.reduce((sum, tool) => {
          return (
            sum +
            this.countTokens(JSON.stringify(tool.arguments)) +
            this.countTokens(tool.result) +
            (tool.thinking ? this.countTokens(tool.thinking) : 0)
          );
        }, 0);
        const responseTokens = this.countTokens(message.finalResponse);

        const messageTokens = thinkingTokens + toolsTokens + responseTokens;
        aiMessageTokens += messageTokens;
        totalTokens += messageTokens;
      }
    }

    const needsCompression = totalTokens > this.COMPRESSION_THRESHOLD;

    console.log(`📊 [TOKEN-COUNTER] Historique analysé:`);
    console.log(`   Total tokens: ${totalTokens.toLocaleString()}`);
    console.log(
      `   User messages: ${userMessageTokens.toLocaleString()} tokens`,
    );
    console.log(`   AI messages: ${aiMessageTokens.toLocaleString()} tokens`);
    console.log(
      `   Needs compression: ${needsCompression ? "YES" : "NO"} (threshold: ${this.COMPRESSION_THRESHOLD.toLocaleString()})`,
    );

    return {
      totalTokens,
      userMessageTokens,
      aiMessageTokens,
      needsCompression,
    };
  }

  /**
   * Compte les tokens d'un texte formaté pour le brain
   */
  static countFormattedHistoryTokens(formattedHistory: string): number {
    return this.countTokens(formattedHistory);
  }

  /**
   * Estime le coût de compression en tokens
   *
   * La compression prend l'historique complet en input et génère 3-5k tokens
   * en output.
   */
  static estimateCompressionCost(
    inputTokens: number,
  ): { inputCost: number; outputCost: number; totalCost: number } {
    // Prix GPT-4o-mini : $0.15 per 1M input tokens, $0.6 per 1M output tokens
    const INPUT_PRICE_PER_MILLION = 0.15;
    const OUTPUT_PRICE_PER_MILLION = 0.6;

    // On estime 4k tokens de sortie (moyenne entre 3k et 5k)
    const estimatedOutputTokens = 4000;

    const inputCost = (inputTokens / 1_000_000) * INPUT_PRICE_PER_MILLION;
    const outputCost =
      (estimatedOutputTokens / 1_000_000) * OUTPUT_PRICE_PER_MILLION;
    const totalCost = inputCost + outputCost;

    console.log(`💰 [TOKEN-COUNTER] Estimation coût compression:`);
    console.log(
      `   Input: ${inputTokens.toLocaleString()} tokens = $${inputCost.toFixed(6)}`,
    );
    console.log(
      `   Output: ${estimatedOutputTokens.toLocaleString()} tokens (estimé) = $${outputCost.toFixed(6)}`,
    );
    console.log(`   Total: $${totalCost.toFixed(6)}`);

    return { inputCost, outputCost, totalCost };
  }
}
