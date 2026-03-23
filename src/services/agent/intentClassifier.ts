/**
 * Intent Classifier — lightweight regex + heuristics
 *
 * Detects whether the user wants a conversation (Q&A) or content creation.
 * Runs before workflow dispatch to determine the workflow variant.
 */

import type { IntentType } from "./types.js";

// ============================================================================
// CREATION KEYWORDS (multi-language: FR, EN, ES, DE)
// ============================================================================

/**
 * Imperative verbs and phrases that signal content creation intent.
 * Matched case-insensitively at word boundaries.
 */
const CREATION_PATTERNS: RegExp[] = [
  // French creation verbs (imperative + infinitive forms)
  /\b(crée|créer|créé|créez|cree|creer)\b/i,
  /\b(génère|générer|genere|generer|génèr)\b/i,
  /\b(rédige|rédiger|redige|rediger)\b/i,
  /\b(écris|écrire|ecris|ecrire|écrit)\b/i,
  /\b(compose|composer)\b/i,
  /\b(produis|produire|produisez)\b/i,
  /\b(fais|faire)\s+(un|une|le|la|mon|ma|mes|du|des|ce)\s+(cours|résumé|fiche|page|document|article|dissertation|exposé|synthèse|plan|rapport|note|texte|contenu)/i,

  // English creation verbs
  /\b(create|generate|write|draft|compose|produce|make)\b/i,

  // Spanish creation verbs
  /\b(crea|crear|genera|generar|escribe|escribir|redacta|redactar)\b/i,

  // German creation verbs
  /\b(erstelle|erstellen|schreibe|schreiben|verfasse|verfassen|generiere|generieren)\b/i,

  // Direct creation requests (FR)
  /\b(fiche\s+de\s+révision|fiche\s+résumé)/i,
  /\bje\s+(veux|voudrais|souhaite|aimerais)\s+(un|une|des|du|le|la|mon|ma|mes)\s+\w*(page|cours|résumé|fiche|document|article|dissertation|texte|contenu|note|exposé|synthèse|rapport)/i,

  // Direct creation requests (EN)
  /\b(i\s+want|i\s+need|i'd\s+like|can\s+you\s+make|can\s+you\s+create|can\s+you\s+write)\s+(a|an|the|my|some)\s+\w*(page|document|article|summary|essay|report|note|text|content)/i,
];

/**
 * Strong creation signals — patterns that are almost always creation intent.
 * These override conversation signals when present.
 */
const STRONG_CREATION_PATTERNS: RegExp[] = [
  // Explicit page/document creation
  /\b(crée|créer|create)\s+(une?\s+)?(nouvelle?\s+)?page\b/i,
  /\b(nouvelle?\s+page|new\s+page)\b/i,
  /\b(rédige|écris|write|draft)\s+(un|une|a|an|the)\s/i,
];

/**
 * Patterns that indicate the user is asking ABOUT creation, not requesting it.
 * These prevent false positives.
 */
const CONVERSATION_OVERRIDE_PATTERNS: RegExp[] = [
  // Questions about creation
  /\b(comment|how|pourquoi|why|qu'est.?ce)\b.*\b(créer|create|écrire|write|générer|generate)\b/i,
  // Explaining or defining
  /\b(c'est\s+quoi|what\s+is|define|définir|expliqu)/i,
  // Questions with interrogative words at start
  /^(est.?ce\s+que|is\s+it|can\s+i|puis.?je|comment|how|what|quoi|pourquoi|why)\b/i,
];

// ============================================================================
// CLASSIFIER
// ============================================================================

/**
 * Detects user intent from the last message text.
 *
 * @param message - The user's message text
 * @returns "creation" if the user wants content generated, "conversation" otherwise
 */
export function detectIntent(message: string): IntentType {
  const trimmed = message.trim();
  if (trimmed.length === 0) return "conversation";

  // Check conversation overrides first — questions about creation are conversation
  for (const pattern of CONVERSATION_OVERRIDE_PATTERNS) {
    if (pattern.test(trimmed)) {
      // Only override if no strong creation signal is also present
      const hasStrongCreation = STRONG_CREATION_PATTERNS.some((p) => p.test(trimmed));
      if (!hasStrongCreation) {
        return "conversation";
      }
    }
  }

  // Check strong creation patterns
  for (const pattern of STRONG_CREATION_PATTERNS) {
    if (pattern.test(trimmed)) {
      return "creation";
    }
  }

  // Check regular creation patterns
  for (const pattern of CREATION_PATTERNS) {
    if (pattern.test(trimmed)) {
      return "creation";
    }
  }

  // Default: conversation
  return "conversation";
}

/**
 * Extracts the last user message text from a messages array.
 * Handles both string content and structured content arrays.
 */
export function extractLastUserMessage(
  messages: Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>,
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "user") continue;

    if (typeof msg.content === "string") {
      return msg.content;
    }

    if (Array.isArray(msg.content)) {
      const textParts = msg.content
        .filter(
          (part): part is { type: string; text: string } =>
            part.type === "text" && typeof part.text === "string",
        )
        .map((part) => part.text);
      return textParts.join(" ");
    }
  }

  return "";
}
