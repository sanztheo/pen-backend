/**
 * 🔧 FUNCTION CALLING SERVICE - TWO-PHASE SYSTEM
 * Phase 1: AI décide des tools + stream explication + exécute tools
 * Phase 2: AI génère réponse finale avec résultats des tools
 */

import { AIService } from './base.js';
import { FUNCTION_TOOLS } from './tools/definitions.js';
import { ToolExecutor, type ToolContext } from './tools/executors.js';
import { 
  FirstThinkingPlan, 
  IntermediateThinkingOutput,
  IntermediateThinkingBlock,
  isFirstThinkingPlan, 
  isIntermediateThinkingOutput 
} from '../../types/ragThinking.js';

export interface ToolCallRecord {
  name: string;
  arguments: any;
  result: string;
  timestamp: number;
}

// 🔥 PHASE 1: Décision et exécution des tools
export interface DecideToolsOptions {
  query: string;
  availableSources: Array<{ id: string; title: string; type: string }>;
  workspaceId: string;
  userId: string;
  useWeb: boolean;
  systemPrompt: string;
  isSearch?: boolean;  // 🔥 Flag pour Search mode - permet plus de tools
  onThinking?: (thinking: string) => void;
  onToolCall?: (toolName: string, args: any) => void;
  onToolResult?: (toolName: string, result: string) => void;
  onIntermediateThinking?: (chunk: string) => void; // 🔥 NEW: Thinking entre les tools
}

export interface DecideToolsResult {
  toolCalls: ToolCallRecord[];
  thinking: string;
  shouldUseTools: boolean;
  intermediateThinkingBlocks: IntermediateThinkingBlock[]; // 🔥 NEW: Store all intermediate thinking
}

// 🔥 PHASE 2: Génération finale avec résultats
export interface GenerateWithToolResultsOptions {
  query: string;
  toolResults: string;
  systemPrompt: string;
  onStream?: (chunk: string) => void;
}

export interface GenerateWithToolResultsResult {
  content: string;
}

// Legacy interface (deprecated, kept for backward compatibility)
export interface FunctionCallingOptions {
  query: string;
  availableSources: Array<{ id: string; title: string; type: string }>;
  workspaceId: string;
  userId: string;
  useWeb: boolean;
  systemPrompt: string;
  isSearch?: boolean;  // 🔥 Flag pour Search mode
  onThinking?: (thinking: string) => void;
  onToolCall?: (toolName: string, args: any) => void;
  onToolResult?: (toolName: string, result: string) => void;
  timeoutMs?: number;
}

export interface FunctionCallingResult {
  content: string;
  toolCalls: ToolCallRecord[];
  thinking: string;
  usedFallback: boolean;
}

// 🔥 Helper: Parse JSON safely from streamed content
const parseJSONFromStream = (content: string): any => {
  try {
    return JSON.parse(content);
  } catch (e) {
    console.warn('⚠️ Failed to parse JSON:', content.slice(0, 100));
    return null;
  }
};

export class FunctionCallingService {
  /**
   * 🔥 REFACTORED: Agentic loop with JSON-based thinking system
   * - First thinking generates a JSON plan with tool sequence
   * - Each intermediate thinking generates JSON with tool arguments
   * - Tools execute with arguments derived from intermediate thinking
   */
  static async decideAndExecuteTools(
    options: DecideToolsOptions
  ): Promise<DecideToolsResult> {
    const {
      query,
      availableSources,
      workspaceId,
      userId,
      useWeb,
      systemPrompt,
      isSearch = false,
      onThinking,
      onToolCall,
      onToolResult,
      onIntermediateThinking
    } = options;

    const toolCalls: ToolCallRecord[] = [];
    const intermediateThinkingBlocks: IntermediateThinkingBlock[] = [];
    let thinking = '';
    const context: ToolContext = { userId, workspaceId };

    console.log(`🔧 [PHASE-1] Boucle agentic refactorisée avec ${availableSources.length} sources disponibles`);

    const openai = AIService.getOpenAI();
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    try {
      // 🔥 ÉTAPE 1: First Thinking - Generate JSON plan with tool sequence
      console.log(`💭 [PHASE-1] Génération first thinking avec plan JSON...`);
      
      const sourcesContext = availableSources.length > 0 
        ? `Sources disponibles:\n${availableSources.map((s, i) => `${i+1}. "${s.title}" (ID: ${s.id}, Type: ${s.type})`).join('\n')}`
        : 'Aucune source spécifique disponible';

      const hasWorkspacePages = availableSources.some(s => s.type === 'WORKSPACE_PAGE');
      const workspacePagesStr = hasWorkspacePages 
        ? '\n\n⚠️ IMPORTANT: Tu DOIS utiliser le tool "read_rag_source" pour lire les pages mentionnées AVANT de répondre!'
        : '';

      const firstThinkingPrompt = isSearch
        ? `Tu dois créer un plan JSON structuré pour explorer un sujet en profondeur.

TOOLS VALIDES DISPONIBLES:
- read_rag_source: Lire le contenu complet d'une source RAG
- search_rag_chunks: Chercher des chunks spécifiques dans une source par similarité
- search_web: Rechercher sur le web (UNIQUEMENT si pas de sources spécifiques mentionnées)

RÈGLES IMPORTANTES:
- CHAQUE TOOL DOIT ÊTRE DIFFÉRENT ET COMPLÉMENTAIRE
- Si des sources spécifiques sont mentionnées: N'UTILISE QUE read_rag_source et search_rag_chunks
- N'utilise search_web QUE si aucune source spécifique n'est fournie
- totalIterations DOIT être entre 1 et 8

Le JSON DOIT avoir cette structure EXACTE:
{
  "plan": {
    "totalIterations": <nombre>,
    "reasoning": "<ta logique en 1-2 phrases>",
    "toolSequence": [
      {"step": 1, "toolName": "read_rag_source", "description": "..."},
      {"step": 2, "toolName": "search_rag_chunks", "description": "..."}
    ]
  }
}

${sourcesContext}${workspacePagesStr}

Question: "${query}"

Génère le plan JSON MAINTENANT. AUCUN texte avant ou après le JSON.`
        : `Tu dois créer un plan JSON structuré pour répondre à une question.

TOOLS VALIDES DISPONIBLES:
- read_rag_source: Lire le contenu complet d'une source RAG
- search_rag_chunks: Chercher des chunks spécifiques dans une source par similarité
- search_web: Rechercher sur le web (UNIQUEMENT si pas de sources spécifiques mentionnées)

RÈGLES IMPORTANTES:
- En mode Ask, totalIterations DOIT être 1
- Utilise UNIQUEMENT les tools disponibles ci-dessus
- Si des sources spécifiques sont mentionnées: N'UTILISE QUE read_rag_source
- N'utilise search_web QUE si aucune source spécifique n'est fournie

Le JSON DOIT avoir cette structure EXACTE:
{
  "plan": {
    "totalIterations": 1,
    "reasoning": "<ta logique en 1-2 phrases>",
    "toolSequence": [
      {"step": 1, "toolName": "read_rag_source", "description": "Lire la source pour répondre"}
    ]
  }
}

${sourcesContext}${workspacePagesStr}

Question: "${query}"

Génère le plan JSON MAINTENANT. AUCUN texte avant ou après le JSON.`;

      let firstThinkingContent = '';
      const firstThinkingStream = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'Tu es un expert en structuration de requêtes. Tu génères UNIQUEMENT du JSON valide, sans texte additionnel.'
          },
          {
            role: 'user',
            content: firstThinkingPrompt
          }
        ],
        temperature: 0.3,
        max_tokens: 500,
        stream: true,
        response_format: { type: 'json_object' } as any  // 🔥 JSON MODE STRICT
      });

      // Collecter le contenu du premier thinking
      for await (const chunk of firstThinkingStream) {
        const delta = chunk.choices[0]?.delta;
        if (delta?.content) {
          firstThinkingContent += delta.content;
          thinking += delta.content;
          if (onThinking) {
            onThinking(delta.content);
          }
        }
      }

      console.log(`✅ [PHASE-1] First thinking généré: ${firstThinkingContent.length} chars`);

      // Parse first thinking JSON
      const firstThinkingPlan = parseJSONFromStream(firstThinkingContent);
      if (!isFirstThinkingPlan(firstThinkingPlan)) {
        console.warn('⚠️ First thinking plan invalid, falling back to ask mode');
        // Fallback: utiliser 1 itération simple
        throw new Error('Invalid first thinking plan format');
      }

      const { totalIterations, toolSequence } = firstThinkingPlan.plan;
      
      // 🔥 Valider les tools: ne garder que les tools valides
      const VALID_TOOLS = ['read_rag_source', 'search_rag_chunks', 'search_web'];
      const validatedToolSequence = toolSequence.filter((t) => VALID_TOOLS.includes(t.toolName));
      
      if (validatedToolSequence.length === 0) {
        console.warn('⚠️ Aucun tool valide dans le plan');
        throw new Error('No valid tools in plan');
      }
      
      console.log(`🔧 [PHASE-1] Plan validé: ${validatedToolSequence.length} tools valides, tools: ${validatedToolSequence.map(t => t.toolName).join(' → ')}`);

      await sleep(150);

      // 🔥 ÉTAPE 2: Agentic loop - Execute tools with arguments from intermediate thinking
      const initialMessages: any[] = [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: `${sourcesContext}${workspacePagesStr}\n\nQuestion: "${query}"`
        }
      ];

      // Exécuter chaque tool selon le plan
      for (let iterationIdx = 0; iterationIdx < totalIterations; iterationIdx++) {
        const toolStep = validatedToolSequence[iterationIdx];
        if (!toolStep) break;

        console.log(`🔧 [PHASE-1-ITER-${iterationIdx + 1}/${totalIterations}] Exécution: ${toolStep.toolName} - ${toolStep.description}`);

        let toolArgs: any = {};

        // 🔥 ÉTAPE 2A: Générer les arguments du tool via intermediate thinking (sauf pour le premier)
        if (iterationIdx > 0 && onIntermediateThinking) {
          console.log(`🧠 [INTERMEDIATE-THINKING-${iterationIdx}] Génération des arguments pour ${toolStep.toolName}...`);
          
          try {
            const intermediateThinkingPrompt = `Basé sur les résultats précédents et ta stratégie, décide maintenant de la requête pour l'étape ${iterationIdx + 1}.

Tu DOIS répondre en JSON STRICT sans texte additionnel:
{
  "thinking": "<ta réflexion sur ce qu'il faut chercher ensuite>",
  "toolArguments": {
    "query": "<la requête spécifique pour ${toolStep.toolName}>",
    "sourceId": "<optionnel>"
  },
  "nextToolName": "${toolStep.toolName}"
}

Sois spécifique et basé sur les résultats précédents.`;

            let intermediateThinkingContent = '';
            const intermediateStream = await openai.chat.completions.create({
              model: 'gpt-4o-mini',
              messages: [
                ...initialMessages,
                {
                  role: 'user',
                  content: intermediateThinkingPrompt
                }
              ],
              temperature: 0.3,
              max_tokens: 400,
              stream: true,
              response_format: { type: 'json_object' } as any  // 🔥 JSON MODE STRICT
            });

            // Streamer le thinking intermédiaire
            for await (const chunk of intermediateStream) {
              const delta = chunk.choices[0]?.delta;
              if (delta?.content) {
                intermediateThinkingContent += delta.content;
                onIntermediateThinking(delta.content);
              }
            }

            // Parser intermediate thinking JSON
            const intermediateParsed = parseJSONFromStream(intermediateThinkingContent);
            if (isIntermediateThinkingOutput(intermediateParsed)) {
              toolArgs = intermediateParsed.toolArguments || {};
              
              // Sauvegarder le bloc
              intermediateThinkingBlocks.push({
                iteration: iterationIdx,
                thinking: intermediateParsed.thinking,
                toolArguments: toolArgs,
                generatedAt: new Date().toISOString(),
                nextToolName: toolStep.toolName
              });

              console.log(`✅ [INTERMEDIATE-THINKING-${iterationIdx}] Arguments extraits:`, toolArgs);
            } else {
              console.warn(`⚠️ Invalid intermediate thinking format at iteration ${iterationIdx}`);
            }
          } catch (error) {
            console.warn(`⚠️ [INTERMEDIATE-THINKING-${iterationIdx}] Erreur:`, error);
            // Fallback: utiliser la description comme query
            toolArgs = { query: toolStep.description };
          }

          await sleep(50);
        } else if (iterationIdx === 0) {
          // 🔥 Premier tool: utiliser la question originale + les sources disponibles
          toolArgs = { query };
          
          // Si c'est read_rag_source et que des sources sont disponibles, passer le premier sourceId
          if (toolStep.toolName === 'read_rag_source' && availableSources.length > 0) {
            toolArgs.sourceId = availableSources[0].id;
          }
        }

        // 🔥 ÉTAPE 2B: Stream the tool call
        if (onToolCall) {
          onToolCall(toolStep.toolName, toolArgs);
        }

        await sleep(50);

        // 🔥 ÉTAPE 2C: Execute tool
        const result = await ToolExecutor.executeToolCall(toolStep.toolName, toolArgs, context);

        // Stream tool result
        if (onToolResult) {
          onToolResult(toolStep.toolName, result);
        }

        await sleep(50);

        // Enregistrer le tool call
        toolCalls.push({
          name: toolStep.toolName,
          arguments: toolArgs,
          result,
          timestamp: Date.now()
        });

        // Ajouter à l'historique des messages
        initialMessages.push({
          role: 'user',
          content: `Tool ${toolStep.toolName} résultat:\n${result}`
        });

        console.log(`✅ [PHASE-1-ITER-${iterationIdx + 1}] Complété: ${toolStep.toolName}`);
      }

      console.log(`✅ [PHASE-1] Tous les tools exécutés: ${toolCalls.length} total`);

      return { 
        toolCalls, 
        thinking, 
        shouldUseTools: toolCalls.length > 0,
        intermediateThinkingBlocks
      };

    } catch (error) {
      console.error(`❌ [PHASE-1] Erreur boucle agentic:`, error);
      throw error;
    }
  }

  /**
   * 🔥 PHASE 2: Génère réponse finale avec résultats des tools
   */
  static async generateWithToolResults(
    options: GenerateWithToolResultsOptions
  ): Promise<GenerateWithToolResultsResult> {
    const { query, toolResults, systemPrompt, onStream } = options;

    console.log(`🔧 [PHASE-2] Génération réponse finale`);

    const phase2SystemPrompt = `${systemPrompt}

Les outils ont déjà été utilisés pour répondre à la question. Leurs résultats sont fournis ci-dessous. Utilise ces résultats pour répondre à la question de l'utilisateur de manière claire, structurée et précise.`;

    const phase2Prompt = `${toolResults}

Question de l'utilisateur: ${query}

Réponds maintenant à la question en utilisant les résultats des outils ci-dessus.`;

    let fullContent = '';

    await AIService.generateContent({
      prompt: phase2Prompt,
      context: phase2SystemPrompt,
      temperature: 0.2,
      maxTokens: 4000,
      onStream: (chunk: string) => {
        fullContent += chunk;
        if (onStream) {
          onStream(chunk);
        }
      }
    });

    console.log(`✅ [PHASE-2] Réponse générée: ${fullContent.length} chars`);

    return { content: fullContent };
  }

  /**
   * @deprecated Use decideAndExecuteTools + generateWithToolResults instead
   * Legacy method kept for backward compatibility
   */
  static async generateWithTools(
    options: FunctionCallingOptions
  ): Promise<FunctionCallingResult> {
    console.warn('[DEPRECATED] generateWithTools() is deprecated. Use two-phase system instead.');
    
    const {
      query,
      availableSources,
      workspaceId,
      userId,
      useWeb,
      systemPrompt,
      onThinking,
      onToolCall,
      onToolResult
    } = options;

    // Phase 1: Decide and execute tools
    const toolDecision = await this.decideAndExecuteTools({
      query,
      availableSources,
      workspaceId,
      userId,
      useWeb,
      systemPrompt,
      onThinking,
      onToolCall,
      onToolResult
    });

    // Phase 2: Generate with tool results
    if (toolDecision.shouldUseTools) {
      const toolResults = this.buildContextFromToolResults(toolDecision.toolCalls);
      const finalResponse = await this.generateWithToolResults({
        query,
        toolResults,
        systemPrompt,
        onStream: () => {} // No streaming in legacy mode
      });

      return {
        content: finalResponse.content,
        toolCalls: toolDecision.toolCalls,
        thinking: toolDecision.thinking,
        usedFallback: false
      };
    }

    // No tools used, generate directly
    const fallbackContent = await AIService.generateContent({
      prompt: query,
      context: systemPrompt,
      temperature: 0.2,
      maxTokens: 4000
    });

    return {
      content: fallbackContent.content,
      toolCalls: [],
      thinking: toolDecision.thinking,
      usedFallback: true
    };
  }

  /**
   * 🔥 Helper: Construit le contexte pour Phase 2 à partir des résultats des tools
   */
  static buildContextFromToolResults(toolCalls: ToolCallRecord[]): string {
    if (toolCalls.length === 0) {
      return '';
    }

    let context = '📚 Résultats des outils utilisés:\n\n';
    
    toolCalls.forEach((tc, i) => {
      context += `### Outil ${i + 1}: ${tc.name}\n`;
      context += `**Arguments**: ${JSON.stringify(tc.arguments, null, 2)}\n\n`;
      context += `**Résultat**:\n${tc.result}\n\n`;
      context += '---\n\n';
    });

    return context;
  }

  /**
   * Construit le prompt initial avec la liste des sources disponibles
   */
  private static buildInitialPrompt(
    query: string,
    sources: Array<{ id: string; title: string; type: string }>,
    useWeb: boolean,
    isSearch: boolean = false
  ): string {
    let prompt = `Question de l'utilisateur: ${query}\n\n`;

    if (sources.length > 0) {
      prompt += `📚 Sources RAG disponibles (UTILISE les tools pour les lire):\n`;
      sources.forEach((s, i) => {
        prompt += `${i + 1}. "${s.title}" (ID: ${s.id}, Type: ${s.type})\n`;
      });
      
      if (isSearch) {
        prompt += '\n⚠️ IMPORTANT MODE RECHERCHE APPROFONDIE:\n';
        prompt += '- Tu peux utiliser le tool read_rag_source PLUSIEURS FOIS pour lire différents passages d\'une même source\n';
        prompt += '- Cherche à comprendre le sujet en profondeur et varié\n';
        prompt += '- Tu peux consulter la tool list_available_sources pour explorer toutes les options\n\n';
      } else {
        prompt += '\n⚠️ IMPORTANT: Tu DOIS utiliser le tool read_rag_source pour lire ces sources avant de répondre.\n\n';
      }
    }

    if (useWeb) {
      prompt += '🌐 Tu peux aussi utiliser le tool search_web si nécessaire pour des informations externes ou récentes.\n\n';
    }

    prompt += isSearch 
      ? 'Fais une recherche APPROFONDIE en utilisant les tools disponibles pour chercher les informations les plus complètes et détaillées, puis réponds de manière exhaustive.'
      : 'Maintenant, utilise les tools disponibles pour chercher les informations nécessaires, puis réponds à la question de manière complète et précise.';

    return prompt;
  }

}

