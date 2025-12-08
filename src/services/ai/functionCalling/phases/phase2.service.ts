/**
 * Phase 2 : Génération de la réponse finale avec les résultats des tools
 *
 * Ce service prend les résultats des tools exécutés en Phase 1 et génère
 * une réponse finale structurée et précise pour l'utilisateur.
 */

import { AIService } from "../../base.js";
import { buildWikipediaLicenseFooter } from "../utils/wikipediaExtractor.js";
import type {
  GenerateWithToolResultsOptions,
  GenerateWithToolResultsResult,
} from "../types/phase2.types.js";

import { buildPersonaXML } from "../../../../controllers/assistant/helpers/personalization.js";

/**
 * Service pour la Phase 2 : Génération de la réponse finale
 */
export class Phase2Service {
  /**
   * 🔥 PHASE 2: Génère réponse finale avec résultats des tools
   */
  static async generateWithToolResults(
    options: GenerateWithToolResultsOptions,
  ): Promise<GenerateWithToolResultsResult> {
    const {
      query,
      toolResults,
      systemPrompt,
      onStream,
      wikipediaSources,
      conversationHistory,
      personalization,
    } = options;

    console.log(`🔧 [PHASE-2] Génération réponse finale`);

    // 🎯 DÉTECTION D'INTENTION : Analyser la query pour adapter la génération
    const intentKeywords = {
      create: [
        "crée",
        "créer",
        "génère",
        "générer",
        "écris",
        "écrire",
        "rédige",
        "rédiger",
        "compose",
        "construis",
        "fais",
        "faire",
      ],
      explain: [
        "explique",
        "expliquer",
        "comment",
        "pourquoi",
        "qu'est-ce",
        "c'est quoi",
      ],
      list: [
        "liste",
        "lister",
        "énumère",
        "énumérer",
        "quels sont",
        "quelles sont",
      ],
    };

    const queryLower = query.toLowerCase();
    let detectedIntent = "explain"; // Par défaut : explication

    if (intentKeywords.create.some((kw) => queryLower.includes(kw))) {
      detectedIntent = "create";
      console.log(`🎨 [PHASE-2] Intention détectée: CREATE`);
    } else if (intentKeywords.list.some((kw) => queryLower.includes(kw))) {
      detectedIntent = "list";
      console.log(`📋 [PHASE-2] Intention détectée: LIST`);
    } else {
      console.log(`📖 [PHASE-2] Intention détectée: EXPLAIN (défaut)`);
    }

    // Adaptive instructions based on detected intent
    let intentSpecificInstructions = "";

    if (detectedIntent === "create") {
      intentSpecificInstructions = `
The user is requesting content CREATION.

CREATION RULES:
- The user request defines WHAT to create (welcome page, email, article, etc.)
- Tool results serve to ENRICH the content with relevant information
- Adopt the appropriate tone and format for what is requested
- Start DIRECTLY with the created content, without meta titles or introductions
- Personalize with the context provided by the user
- Create even if information is limited, use what is available intelligently

EXAMPLES:
- "create a welcome page" -> Start directly with a welcoming message
- "write an email" -> Start with the subject or body of the email
- "write an article" -> Start directly with the first paragraph`;
    } else if (detectedIntent === "list") {
      intentSpecificInstructions = `
The user wants a clear enumeration.

LIST RULES:
- Start directly with the list items
- Use bullets or numbers as appropriate
- Be concise and precise for each item
- Group by categories if it improves clarity`;
    } else {
      // Explain mode (default)
      intentSpecificInstructions = `
The user is seeking to understand a concept or topic.

EXPLANATION RULES:
- Start directly with the explanation, without introductory headings
- Provide a thorough explanation that leverages all available sources
- Develop concepts with concrete examples
- Use sections (##) only if necessary to organize a long response
- Structure naturally: introduction -> development -> synthesis`;
    }

    // User personalization context
    const personalizationContext = personalization 
      ? `\n${buildPersonaXML(personalization)}\n` 
      : "";

    const currentDate = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    const phase2SystemPrompt = `${systemPrompt}

The assistant is Pen Note, created by Pennote.

The current date is ${currentDate}.

${personalizationContext ? `<user_personalization>
${personalizationContext}
The assistant MUST adapt its response based on this user profile. This includes:
- Adjusting complexity and vocabulary to match the user's level (student, professional, expert)
- Respecting specific preferences (short answers, detailed explanations, specific format)
- Using appropriate examples based on the user's domain or interests
- Matching the communication style the user expects
User personalization takes PRIORITY over default behavior.
</user_personalization>` : ""}

<identity>
Pen Note is an advanced AI assistant designed to be accurate, efficient, and intellectually honest.
Pen Note is NOT ChatGPT, Claude, Gemini, or any other generic AI. When asked about its identity, it responds: "I am Pen Note."
Pen Note does not mention OpenAI, Anthropic, Google, or other AI providers.
</identity>

<context>
Tools have collected raw information from various sources. The assistant's mission is to synthesize these results into a comprehensive, accurate response that directly addresses the user's request.
${intentSpecificInstructions}
</context>

<response_format>
The assistant formats responses using Markdown with these rules:
- Never start with a heading (# or ##) on the first line. Begin with prose.
- Use bold for key concepts and important terms.
- Use bullet points for lists, but prefer prose for explanations and reports.
- Structure longer responses with sections using ## headers after the introduction.
- Keep paragraphs well-spaced for readability.
- Do not use emojis in responses.
- Never start responses with flattery like "Great question!" or "That's an excellent point!"
</response_format>

<number_formatting>
CRITICAL: Numbers, statistics, and monetary values must be written as plain text.
PROHIBITED:
- Asterisks around numbers: *5 billion* is WRONG
- Dollar signs as LaTeX delimiters: $125$ is WRONG  
- Italics for figures: *in2025* is WRONG
- Any LaTeX formatting for simple numbers

REQUIRED:
- Plain text: "5 billion dollars", "125 billion", "+16%"
- Spaces between numbers and units: "3.7 billion $" not "3.7B$"
- Years written normally: "in 2025" not "in2025"

LaTeX is ONLY acceptable for actual mathematical formulas: equations, integrals, fractions, summations.
</number_formatting>

<accuracy>
The assistant bases responses ONLY on the tool results and provided context.
If information is missing or uncertain, the assistant states this clearly rather than fabricating content.
The assistant prioritizes accuracy over comprehensiveness.
</accuracy>

<language>
The assistant responds in the same language as the user's query.
Language detection is based on the user's message, not the tool results.
</language>`;

    // Build conversation history context if available
    const historyContext = conversationHistory
      ? `[CONVERSATION HISTORY]

Below is the previous conversation history with the user. Use it to maintain continuity and answer questions that reference this history.

${conversationHistory}

---

`
      : "";

    // Delta approach (Perplexity-style): Enrich Wave 1 instead of regenerating
    const { wave1Response, partialToolCount } = options;
    
    let phase2Prompt: string;
    
    if (wave1Response && partialToolCount) {
      // DELTA MODE: Enrich the partial response with new information
      console.log(`[PHASE-2] Delta mode: Enriching Wave 1 (${partialToolCount} tools) with additional sources`);
      
      phase2Prompt = `${historyContext}[DELTA ENRICHMENT MODE]

You previously generated a PARTIAL response based on ${partialToolCount} sources:

<partial_response>
${wave1Response}
</partial_response>

[NEW INFORMATION]
Additional sources have now been collected:
${toolResults}

[INSTRUCTIONS]
ENRICH and IMPROVE the partial response above with the new information.
- Keep what was correct in the partial response
- Add new details, facts, and context from the additional sources
- Correct any inaccuracies if the new sources contradict the partial response
- Make the response more complete and comprehensive
- Detected intent: ${detectedIntent.toUpperCase()}

Do NOT start over - BUILD UPON the partial response.`;
    } else {
      // NORMAL MODE: Generate from scratch
      phase2Prompt = `${historyContext}[USER REQUEST]
The user's current request is the PRIMARY focus. Generate a response that addresses:
"${query}"

[COLLECTED INFORMATION]
The following information was gathered from various sources to enrich your response:
${toolResults}

[INSTRUCTIONS]
Generate the response now, respecting the detected intent (${detectedIntent.toUpperCase()}).
The user request is the PRIMARY focus. Tool results provide CONTEXT to enrich it.`;
    }

    let fullContent = "";

    await AIService.generateContent({
      prompt: phase2Prompt,
      context: phase2SystemPrompt,
      temperature: 0.3, // 🔥 Légèrement plus créatif pour des réponses plus riches
      maxTokens: 6000, // 🔥 Augmenté pour permettre des réponses détaillées (300-500 mots minimum)
      model: options.model, // 🧠 Passer le modèle spécifique (Grok/OpenAI)
      onStream: (chunk: string) => {
        fullContent += chunk;
        if (onStream) {
          onStream(chunk);
        }
      },
    });

    // 📚 Ajouter le footer de licence Wikipedia si des sources sont présentes
    if (wikipediaSources && wikipediaSources.length > 0) {
      const licenseFooter = buildWikipediaLicenseFooter(wikipediaSources);

      if (licenseFooter) {
        console.log(
          `📚 [PHASE-2] Ajout footer licence Wikipedia (${wikipediaSources.length} sources)`,
        );

        // Streamer le footer si un callback est fourni
        if (onStream) {
          onStream(licenseFooter);
        }

        fullContent += licenseFooter;
      }
    }

    console.log(`✅ [PHASE-2] Réponse générée: ${fullContent.length} chars`);

    return { content: fullContent };
  }
}
