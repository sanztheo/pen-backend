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

export class FunctionCallingService {
  /**
   * 🔥 PHASE 1: Boucle agentic - L'IA décide quels tools utiliser
   * Streaming progressif de chaque tool call et résultat
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
    let thinking = '';
    const context: ToolContext = { userId, workspaceId };

    console.log(`🔧 [PHASE-1] Boucle agentic avec ${availableSources.length} sources disponibles`);

    const openai = AIService.getOpenAI();
    
    // Petite pause pour laisser les événements SSE se propager
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    try {
      // 🔥 ÉTAPE 1: D'abord, demander à l'AI d'expliquer son plan (thinking)
      console.log(`💭 [PHASE-1] Génération thinking initial...`);
      
      const sourcesContext = availableSources.length > 0 
        ? `Sources disponibles:\n${availableSources.map((s, i) => `${i+1}. "${s.title}" (ID: ${s.id}, Type: ${s.type})`).join('\n')}`
        : 'Aucune source spécifique disponible';

      // 🔥 Vérifier s'il y a des pages workspace mentionnées
      const hasWorkspacePages = availableSources.some(s => s.type === 'WORKSPACE_PAGE');
      const workspacePagesStr = hasWorkspacePages 
        ? '\n\n⚠️ IMPORTANT: Tu DOIS utiliser le tool "read_rag_source" pour lire les pages mentionnées AVANT de répondre!'
        : '';

      const thinkingStream = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'Tu es un assistant IA expert. Explique brièvement (en 1-2 phrases) ta stratégie pour répondre à la question en utilisant les outils disponibles.'
          },
          {
            role: 'user',
            content: `Question: "${query}"\n\n${sourcesContext}${workspacePagesStr}\n\nQuelle est ta stratégie?`
          }
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

      console.log(`✅ [PHASE-1] Thinking généré: ${thinking.length} chars`);
      
      // Attendre un peu avant la boucle de tools
      await sleep(150);

      // 🔥 ÉTAPE 2: Boucle agentic - L'IA décide les tools à utiliser
      const initialMessages: any[] = [
        {
          role: 'system',
          content: systemPrompt + (isSearch 
            ? '\n\n🔧 MODE RECHERCHE APPROFONDIE:\nTu DOIS utiliser "read_rag_source" PLUSIEURS FOIS avec des REQUÊTES DIFFÉRENTES pour explorer le sujet en détail.\n\nExemples de requêtes variées:\n- Première: Question générale ou résumé\n- Deuxième: Détails spécifiques, exemples, ou contexte historique\n- Troisième: Cas d\'usage, applications, ou implications\n- Etc.\n\nNE FAIS PAS deux fois la même requête. À chaque appel, pose une question NOUVELLE et COMPLÉMENTAIRE.\n\nRécupère des informations complètes et variées AVANT de répondre.\nN\'utilise tes connaissances que pour compléter les informations, pas pour remplacer les sources.'
            : '\n\n🔧 IMPORTANT: Tu as accès à plusieurs tools. Tu DOIS les utiliser pour lire les sources et pages mentionnées.\n\nPour chaque source/page, appelle "read_rag_source" une seule fois avec une question claire et pertinente.\n\nN\'utilise tes connaissances que pour compléter les informations, pas pour remplacer les sources.')
        },
        {
          role: 'user',
          content: `${sourcesContext}${workspacePagesStr}\n\nQuestion de l'utilisateur: "${query}"\n\n${isSearch 
            ? 'MODE RECHERCHE: Explore le sujet en profondeur. Appelle "read_rag_source" PLUSIEURS FOIS avec des questions DIFFÉRENTES et VARIÉES pour chaque source. Récupère des informations sous différents angles. Puis réponds de manière exhaustive et détaillée.'
            : 'Utilise les tools disponibles pour lire les sources/pages mentionnées, puis réponds à la question.'}`
        }
      ];

      let continueLoop = true;
      let toolLoopCount = 0;
      const maxToolLoops = isSearch ? 8 : 5; // Plus de loops pour Search (recherche approfondie)

      while (continueLoop && toolLoopCount < maxToolLoops) {
        toolLoopCount++;
        console.log(`🔧 [PHASE-1-LOOP-${toolLoopCount}] Appel OpenAI avec tools...`);

        // Appeler OpenAI pour décider les tools
        const toolStream = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: initialMessages,
          tools: FUNCTION_TOOLS as any,
          tool_choice: 'auto',
          temperature: 0.2,
          stream: true
        });

        let toolCallsForThisLoop: any[] = [];
        let currentToolCallIndex = -1;
        let assistantContent = '';

        // Collecter les tool calls et contenu du streaming
        for await (const chunk of toolStream) {
          const delta = chunk.choices[0]?.delta;
          
          if (delta?.content) {
            assistantContent += delta.content;
          }

          // Collecter les tool calls (ils arrivent en morceaux)
          if (delta?.tool_calls) {
            for (const toolCallDelta of delta.tool_calls) {
              const index = toolCallDelta.index;

              // Nouveau tool call
              if (index > currentToolCallIndex) {
                currentToolCallIndex = index;
                toolCallsForThisLoop[index] = {
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
                  toolCallsForThisLoop[index].function.arguments += toolCallDelta.function.arguments;
                }
                if (toolCallDelta.function?.name) {
                  toolCallsForThisLoop[index].function.name += toolCallDelta.function.name;
                }
              }
            }
          }
        }

        // 🔧 Modifier les tool calls pour le mode SEARCH: forcer UN SEUL tool par itération
        let toolCallsForThisIteration = toolCallsForThisLoop;
        
        if (isSearch && toolCallsForThisLoop.length > 1) {
          console.log(`🔧 [SEARCH-MODE] Limitation à 1 tool au lieu de ${toolCallsForThisLoop.length}`);
          // En mode Search, prendre seulement le PREMIER tool et ignorer les autres pour cette itération
          // Les autres seront décidés dans les itérations suivantes
          toolCallsForThisIteration = [toolCallsForThisLoop[0]];
        }

        console.log(`🔧 [PHASE-1-LOOP-${toolLoopCount}] ${toolCallsForThisIteration.length} tool call(s) à exécuter`);

        // Pas de tool calls → fin de la boucle
        if (toolCallsForThisIteration.length === 0) {
          console.log(`✅ [PHASE-1-LOOP-${toolLoopCount}] Aucun tool call, fin de la boucle agentic`);
          continueLoop = false;
          break;
        }

        // Ajouter le message de l'assistant à l'historique
        initialMessages.push({
          role: 'assistant',
          content: assistantContent || null,
          tool_calls: toolCallsForThisIteration
        });

        // 🔥 Exécuter chaque tool call ET stream progressivement
        for (const toolCall of toolCallsForThisIteration) {
          const toolName = toolCall.function.name;
          const args = JSON.parse(toolCall.function.arguments);

          console.log(`🔧 [PHASE-1-LOOP-${toolLoopCount}] Exécution: ${toolName}`);

          // Stream l'appel du tool
          if (onToolCall) {
            onToolCall(toolName, args);
          }
          
          // Attendre un peu pour que l'événement tool_call soit bien reçu
          await sleep(50);

          // Exécuter le tool
          const result = await ToolExecutor.executeToolCall(toolName, args, context);

          // Stream le résultat du tool
          if (onToolResult) {
            onToolResult(toolName, result);
          }
          
          // Attendre un peu après chaque résultat
          await sleep(50);

          toolCalls.push({
            name: toolName,
            arguments: args,
            result,
            timestamp: Date.now()
          });

          // ✅ AJOUTER le résultat aux messages IMMÉDIATEMENT (un par un)
          initialMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: result
          });

          console.log(`✅ [PHASE-1-LOOP-${toolLoopCount}] Tool ${toolName} exécuté`);

          // 🔥 MODE SEARCH: Générer THINKING intermédiaire APRÈS CHAQUE tool individuellement
          if (isSearch && onIntermediateThinking && toolLoopCount < maxToolLoops) {
            console.log(`🔧 [INTERMEDIATE-THINKING] Génération après tool: ${toolName}...`);
            try {
              // Les messages incluent déjà le résultat du tool courant
              const intermediateThinkingStream = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                  ...initialMessages,
                  {
                    role: 'user',
                    content: 'Réfléchis à ta prochaine requête COMPLÈTEMENT DIFFÉRENTE pour continuer l\'exploration. Qu\'est-ce que tu dois chercher ensuite?'
                  }
                ],
                temperature: 0.3,
                stream: true
              });

              for await (const chunk of intermediateThinkingStream) {
                const delta = chunk.choices[0]?.delta;
                if (delta?.content) {
                  onIntermediateThinking(delta.content);
                }
              }

              console.log(`✅ [INTERMEDIATE-THINKING] Généré après: ${toolName}`);
            } catch (error) {
              console.warn(`⚠️ [INTERMEDIATE-THINKING] Erreur après ${toolName}:`, error);
            }
          }
        }

        // ✅ Les résultats sont déjà ajoutés individuellement dans la boucle ci-dessus

        console.log(`✅ [PHASE-1-LOOP-${toolLoopCount}] Fin de la boucle, révision si plus de tools nécessaires...`);
      }

      console.log(`✅ [PHASE-1] Boucle agentic terminée: ${toolCalls.length} tools exécutés au total`);

      return { toolCalls, thinking, shouldUseTools: toolCalls.length > 0 };

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

