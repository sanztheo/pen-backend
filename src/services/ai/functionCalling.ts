/**
 * 🔧 FUNCTION CALLING SERVICE
 * Service principal pour gérer les appels OpenAI avec Function Calling
 * Inclut fallback automatique après timeout et callbacks pour streaming temps réel
 */

import { AIService } from './base.js';
import { FUNCTION_TOOLS } from './tools/definitions.js';
import { ToolExecutor, type ToolContext } from './tools/executors.js';

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
  timeoutMs?: number; // Timeout pour fallback (défaut: 5000ms)
}

export interface ToolCallRecord {
  name: string;
  arguments: any;
  result: string;
  timestamp: number;
}

export interface FunctionCallingResult {
  content: string;
  toolCalls: ToolCallRecord[];
  thinking: string;
  usedFallback: boolean;
}

export class FunctionCallingService {
  /**
   * Génère une réponse en utilisant Function Calling avec tools dynamiques
   * Fallback automatique vers système classique si timeout dépassé
   */
  static async generateWithTools(
    options: FunctionCallingOptions
  ): Promise<FunctionCallingResult> {
    const {
      query,
      availableSources,
      workspaceId,
      userId,
      useWeb,
      systemPrompt,
      onThinking,
      onToolCall,
      onToolResult,
      timeoutMs = 5000
    } = options;

    const toolCalls: ToolCallRecord[] = [];
    let thinking = '';
    const context: ToolContext = { userId, workspaceId };

    // Construire le prompt initial avec infos sur les sources disponibles
    const initialPrompt = this.buildInitialPrompt(query, availableSources, useWeb);

    console.log(`🔧 [FUNCTION-CALLING] Démarrage avec ${availableSources.length} sources, timeout: ${timeoutMs}ms`);

    try {
      // Démarrer avec timeout pour fallback
      const resultPromise = this.runWithTools(
        initialPrompt,
        systemPrompt,
        context,
        toolCalls,
        (t) => {
          thinking = t;
          if (onThinking) onThinking(t);
        },
        onToolCall,
        onToolResult
      );

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs)
      );

      const content = await Promise.race([resultPromise, timeoutPromise]);

      console.log(`✅ [FUNCTION-CALLING] Terminé avec ${toolCalls.length} tool calls`);

      return { content, toolCalls, thinking, usedFallback: false };

    } catch (error: any) {
      if (error.message === 'TIMEOUT') {
        console.log(`⏰ [FUNCTION-CALLING] Timeout ${timeoutMs}ms dépassé → Fallback contexte complet`);

        // FALLBACK: Construire contexte traditionnel
        const fallbackContext = await this.buildFallbackContext(
          query,
          availableSources,
          context
        );

        const fallbackContent = await AIService.generateContent({
          prompt: query,
          context: fallbackContext,
          temperature: 0.2,
          maxTokens: 4000
        });

        console.log(`✅ [FUNCTION-CALLING] Fallback réussi avec ${toolCalls.length} tool calls préservés`);

        return {
          content: fallbackContent.content,
          toolCalls, // 🔥 PRÉSERVER les tool calls déjà exécutés
          thinking, // 🔥 PRÉSERVER le thinking déjà capturé
          usedFallback: true
        };
      }

      // Autre erreur → propager
      console.error(`❌ [FUNCTION-CALLING] Erreur:`, error);
      throw error;
    }
  }

  /**
   * Exécute la boucle d'interaction avec l'IA et les tools
   */
  private static async runWithTools(
    prompt: string,
    systemPrompt: string,
    context: ToolContext,
    toolCalls: ToolCallRecord[],
    onThinking?: (thinking: string) => void,
    onToolCall?: (toolName: string, args: any) => void,
    onToolResult?: (toolName: string, result: string) => void
  ): Promise<string> {
    const openai = AIService.getOpenAI();

    const messages: any[] = [
      {
        role: 'system',
        content: systemPrompt + '\n\nTu as accès à des tools pour chercher des informations. UTILISE-LES systématiquement quand des sources sont disponibles ou quand tu as besoin d\'informations spécifiques. Ne réponds JAMAIS sans avoir d\'abord consulté les sources disponibles via les tools.'
      },
      { role: 'user', content: prompt }
    ];

    let iterations = 0;
    const MAX_ITERATIONS = 5;

    console.log(`🔄 [FUNCTION-CALLING] Démarrage boucle d'interaction (max ${MAX_ITERATIONS} iterations)`);

    while (iterations < MAX_ITERATIONS) {
      iterations++;
      console.log(`🔄 [FUNCTION-CALLING] Iteration ${iterations}/${MAX_ITERATIONS}`);

      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages,
        tools: FUNCTION_TOOLS as any,
        tool_choice: 'auto', // L'IA décide
        temperature: 0.2
      });

      const message = response.choices[0].message;
      messages.push(message);

      // 🔥 NOUVEAU : Si tool calls détectés → envoyer thinking IMMÉDIAT
      if (message.tool_calls && message.tool_calls.length > 0) {
        console.log(`🔧 [FUNCTION-CALLING] ${message.tool_calls.length} tool call(s) à exécuter`);
        
        // 🔥 Générer thinking AVANT l'exécution des tools
        if (onThinking && iterations === 1) {
          const thinkingMsg = `🤔 Je vais analyser la source pour répondre à votre question...`;
          console.log(`💭 [FUNCTION-CALLING] Envoi thinking initial: ${thinkingMsg}`);
          onThinking(thinkingMsg);
        }
      }

      // Si thinking/content présent, le capturer (réponse finale)
      if (message.content) {
        console.log(`💭 [FUNCTION-CALLING] Contenu final reçu: ${message.content.slice(0, 100)}...`);
        // Ne pas appeler onThinking ici, c'est la réponse finale
      }

      // Si pas de tool calls, on a la réponse finale
      if (!message.tool_calls || message.tool_calls.length === 0) {
        console.log(`✅ [FUNCTION-CALLING] Réponse finale générée (${iterations} iterations)`);
        return message.content || 'Pas de réponse générée';
      }

      for (const toolCall of message.tool_calls) {
        // TypeScript workaround pour accéder à toolCall.function
        const toolCallAny = toolCall as any;
        const toolName = toolCallAny.function.name;
        const args = JSON.parse(toolCallAny.function.arguments);

        console.log(`🔧 [FUNCTION-CALLING] Exécution: ${toolName}`, args);

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

        // Ajouter le résultat du tool à la conversation
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: result
        });

        console.log(`✅ [FUNCTION-CALLING] Tool ${toolName} exécuté, résultat: ${result.slice(0, 100)}...`);
      }
    }

    // Si MAX_ITERATIONS atteintes, erreur
    console.error(`❌ [FUNCTION-CALLING] MAX_ITERATIONS (${MAX_ITERATIONS}) atteintes sans réponse finale`);
    throw new Error('MAX_ITERATIONS atteintes sans réponse finale');
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

  /**
   * Construit le contexte de fallback (système classique)
   */
  private static async buildFallbackContext(
    query: string,
    sources: Array<{ id: string }>,
    context: ToolContext
  ): Promise<string> {
    console.log(`🔄 [FALLBACK] Construction contexte RAG classique pour ${sources.length} sources`);

    // Construction contexte RAG classique
    const { ragSystem } = await import('../rag/index.js');

    const chunks = await ragSystem.intelligentSearch(query, {
      userId: context.userId,
      workspaceId: context.workspaceId,
      limit: 10,
      specificSourceIds: sources.map(s => s.id)
    });

    if (chunks.length === 0) {
      return '';
    }

    let ragContext = '📚 Sources pertinentes:\n\n';
    chunks.forEach((chunk, i) => {
      ragContext += `## Source ${i + 1}: ${chunk.source.title}\n`;
      ragContext += `${chunk.content}\n\n`;
    });

    console.log(`✅ [FALLBACK] Contexte RAG construit: ${chunks.length} chunks`);

    return ragContext;
  }
}

