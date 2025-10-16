/**
 * 🔧 FUNCTION CALLING SERVICE - TWO-PHASE SYSTEM
 * Phase 1: AI décide des tools + stream explication + exécute tools
 * Phase 2: AI génère réponse finale avec résultats des tools
 */

import { AIService } from './base.js';
import { FUNCTION_TOOLS } from './tools/definitions.js';
import { ToolExecutor, type ToolContext } from './tools/executors.js';

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
  onThinking?: (thinking: string) => void;
  onToolCall?: (toolName: string, args: any) => void;
  onToolResult?: (toolName: string, result: string) => void;
}

export interface DecideToolsResult {
  toolCalls: ToolCallRecord[];
  thinking: string;
  shouldUseTools: boolean;
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

export class FunctionCallingService {
  /**
   * 🔥 PHASE 1: Décide des tools + stream explication + exécute tools
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
      onThinking,
      onToolCall,
      onToolResult
    } = options;

    const toolCalls: ToolCallRecord[] = [];
    let thinking = '';
    const context: ToolContext = { userId, workspaceId };

    console.log(`🔧 [PHASE-1] Décision tools avec ${availableSources.length} sources`);

    // Construire le prompt avec infos sur les sources
    const initialPrompt = this.buildInitialPrompt(query, availableSources, useWeb);

    const openai = AIService.getOpenAI();

    const messages: any[] = [
      {
        role: 'system',
        content: systemPrompt + '\n\n🔥 IMPORTANT: Avant d\'utiliser les tools, tu DOIS d\'abord expliquer ton raisonnement en texte libre (ex: "Pour répondre à cette question, je vais d\'abord consulter la source disponible..."). Ensuite seulement, tu utilises les tools pour récupérer les informations nécessaires.'
      },
      { role: 'user', content: initialPrompt }
    ];

    try {
      // 🔥 ÉTAPE 1a: D'abord, demander à l'AI d'expliquer (SANS tools pour forcer le texte)
      console.log(`💭 [PHASE-1a] Génération thinking initial (sans tools)...`);
      
      const thinkingStream = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'Tu es un assistant IA. Explique brièvement (en 1-2 phrases) ce que tu vas faire pour répondre à la question de l\'utilisateur. Ne réponds PAS à la question, explique juste ton plan.'
          },
          { role: 'user', content: `Question: ${query}\n\nSources disponibles: ${availableSources.map(s => s.title).join(', ')}\n\nExplique brièvement ce que tu vas faire:` }
        ],
        temperature: 0.3,
        max_tokens: 100,
        stream: true
      });

      // Streamer le thinking
      for await (const chunk of thinkingStream) {
        const delta = chunk.choices[0]?.delta;
        if (delta?.content) {
          thinking += delta.content;
          if (onThinking) {
            onThinking(delta.content);
          }
        }
      }

      console.log(`✅ [PHASE-1a] Thinking généré: ${thinking.length} chars`);

      // 🔥 ÉTAPE 1b: Maintenant, décider des tools (avec tools disponibles)
      console.log(`🔧 [PHASE-1b] Décision tools...`);
      
      const toolStream = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages,
        tools: FUNCTION_TOOLS as any,
        tool_choice: 'auto',
        temperature: 0.2,
        stream: true
      });

      let toolCallsPartial: any[] = [];
      let currentToolCallIndex = -1;

      // Collecter les tool calls
      for await (const chunk of toolStream) {
        const delta = chunk.choices[0]?.delta;

        // Collecter les tool calls (ils arrivent en morceaux)
        if (delta?.tool_calls) {
          for (const toolCallDelta of delta.tool_calls) {
            const index = toolCallDelta.index;

            // Nouveau tool call
            if (index > currentToolCallIndex) {
              currentToolCallIndex = index;
              toolCallsPartial[index] = {
                id: toolCallDelta.id || '',
                type: 'function',
                function: {
                  name: toolCallDelta.function?.name || '',
                  arguments: toolCallDelta.function?.arguments || ''
                }
              };
            } else {
              // Continuer à accumuler les arguments
              if (toolCallDelta.function?.arguments) {
                toolCallsPartial[index].function.arguments += toolCallDelta.function.arguments;
              }
              if (toolCallDelta.function?.name) {
                toolCallsPartial[index].function.name += toolCallDelta.function.name;
              }
            }
          }
        }
      }

      // Pas de tool calls → retour vide
      if (toolCallsPartial.length === 0) {
        console.log(`✅ [PHASE-1b] Pas de tool calls décidés`);
        return { toolCalls: [], thinking, shouldUseTools: false };
      }

      console.log(`🔧 [PHASE-1b] ${toolCallsPartial.length} tool call(s) à exécuter`);

      // 🔥 Exécuter les tool calls
      for (const toolCall of toolCallsPartial) {
        const toolName = toolCall.function.name;
        const args = JSON.parse(toolCall.function.arguments);

        console.log(`🔧 [PHASE-1] Exécution: ${toolName}`, args);

        if (onToolCall) {
          onToolCall(toolName, args);
        }

        const result = await ToolExecutor.executeToolCall(toolName, args, context);

        if (onToolResult) {
          onToolResult(toolName, result);
        }

        toolCalls.push({
          name: toolName,
          arguments: args,
          result,
          timestamp: Date.now()
        });

        console.log(`✅ [PHASE-1] Tool ${toolName} exécuté`);
      }

      console.log(`✅ [PHASE-1] Terminé: ${toolCalls.length} tools exécutés, thinking: ${thinking.length} chars`);

      return { toolCalls, thinking, shouldUseTools: true };

    } catch (error) {
      console.error(`❌ [PHASE-1] Erreur:`, error);
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
    useWeb: boolean
  ): string {
    let prompt = `Question de l'utilisateur: ${query}\n\n`;

    if (sources.length > 0) {
      prompt += `📚 Sources RAG disponibles (UTILISE les tools pour les lire):\n`;
      sources.forEach((s, i) => {
        prompt += `${i + 1}. "${s.title}" (ID: ${s.id}, Type: ${s.type})\n`;
      });
      prompt += '\n⚠️ IMPORTANT: Tu DOIS utiliser le tool read_rag_source pour lire ces sources avant de répondre.\n\n';
    }

    if (useWeb) {
      prompt += '🌐 Tu peux aussi utiliser le tool search_web si nécessaire pour des informations externes ou récentes.\n\n';
    }

    prompt += 'Maintenant, utilise les tools disponibles pour chercher les informations nécessaires, puis réponds à la question de manière complète et précise.';

    return prompt;
  }

}

