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
  intermediateThinkingBlocks: IntermediateThinkingBlock[]; // 🔥 NEW: Store blocks
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

      // 🔥 NEW: Add useWeb instruction if user enabled web search
      const useWebStr = useWeb 
        ? '\n\n🌐 IMPORTANT: L\'utilisateur a ACTIVÉ la recherche web. Tu DOIS inclure "search_web" comme dernier tool du plan!'
        : '';

      const firstThinkingPrompt = isSearch
        ? `Tu dois créer un plan JSON structuré pour explorer un sujet en profondeur.

TOOLS DISPONIBLES (par catégorie):
📋 LISTER LES SOURCES:
- list_available_sources: Liste TOUTES les sources disponibles (pages, fichiers, Wikipedia personnelles)
- list_global_wikipedia_sources: Liste les sources Wikipedia GLOBALES partagées (avant search_web!)
- list_workspace_pages: Liste les pages du workspace

🔍 LIRE/CHERCHER DANS LES SOURCES:
- read_rag_source: Lit le contenu complet d'UNE source RAG
- select_relevant_sources: Sélectionne les sources pertinentes pour la question
- search_rag_chunks: Recherche sémantique DANS les sources RAG
- read_workspace_page: Lit une page spécifique du workspace

🌐 EXTERNES:
- check_sources_rag_status: Vérifie le statut RAG des sources
- search_web: Recherche web (dernier recours)

STRATÉGIE RECOMMANDÉE (Search Mode - exploration profonde):
1️⃣ list_available_sources + list_global_wikipedia_sources → Voir TOUTES les sources (personnelles + globales)
2️⃣ select_relevant_sources OU read_rag_source → Explorer les sources pertinentes trouvées
3️⃣ search_rag_chunks → Chercher des chunks spécifiques
4️⃣ search_web OU check_sources_rag_status → Vérifier/compléter l'information

🔥 IMPORTANT:
- Appelle TOUJOURS list_available_sources ET list_global_wikipedia_sources au début (ensemble!)
- Si list_available_sources retourne vide → Tu DOIS appeler list_global_wikipedia_sources pour voir les Wikipedia globales
- N'appelle JAMAIS read_rag_source avec un ID vide! Vérifie d'abord les sources listées.
- Si aucune source trouvée nulle part → Utilise search_web

RÈGLES:
- Commence PAR lister les sources (personnelles ET globales)
- CHAQUE tool doit être différent et complémentaire
- totalIterations: 1-8
- Si tu utilises check_sources_rag_status, tu dois d'abord avoir les IDs des sources
- Seulement search_web si sources RAG insuffisantes${useWebStr}

Le JSON DOIT avoir cette structure EXACTE:
{
  "plan": {
    "totalIterations": <nombre>,
    "reasoning": "<ta logique en 1-2 phrases>",
    "toolSequence": [
      {"step": 1, "toolName": "list_available_sources", "description": "Lister les sources personnelles"},
      {"step": 2, "toolName": "list_global_wikipedia_sources", "description": "Lister les Wikipedia globales"},
      {"step": 3, "toolName": "read_rag_source", "description": "..."},
      {"step": 4, "toolName": "search_rag_chunks", "description": "..."}
    ]
  }
}

${sourcesContext}${workspacePagesStr}

Question: "${query}"

Génère le plan JSON MAINTENANT. AUCUN texte avant ou après le JSON.`
        : `Tu dois créer un plan JSON structuré pour répondre à une question.

TOOLS DISPONIBLES (par catégorie):
📋 LISTER LES SOURCES:
- list_available_sources: Liste TOUTES les sources disponibles (pages, fichiers, Wikipedia)
- list_global_wikipedia_sources: Liste les sources Wikipedia GLOBALES partagées (avant search_web!)
- list_workspace_pages: Liste les pages du workspace

🔍 LIRE/CHERCHER DANS LES SOURCES:
- read_rag_source: Lit le contenu complet d'UNE source RAG
- select_relevant_sources: Sélectionne les sources pertinentes
- search_rag_chunks: Recherche sémantique DANS les sources
- read_workspace_page: Lit une page spécifique

🌐 AUTRES:
- check_sources_rag_status: Vérifie le statut RAG
- search_web: Recherche web (dernier recours)

RÈGLES (Ask Mode - réponse simple):
- totalIterations DOIT être 1
- Si l'utilisateur dit "parle-moi de mes sources" → list_available_sources
- Sinon: Appelle list_available_sources PUIS list_global_wikipedia_sources pour chercher
- N'appelle JAMAIS read_rag_source avec un ID vide! Vérifie d'abord les sources.
- search_web SEULEMENT si aucune source RAG ne correspond${useWebStr}

Le JSON DOIT avoir cette structure EXACTE:
{
  "plan": {
    "totalIterations": 1,
    "reasoning": "<ta logique en 1-2 phrases>",
    "toolSequence": [
      {"step": 1, "toolName": "list_available_sources", "description": "Lister les sources"}
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
      const VALID_TOOLS = ['list_available_sources', 'select_relevant_sources', 'check_sources_rag_status', 'read_rag_source', 'search_rag_chunks', 'search_web', 'read_workspace_page', 'list_workspace_pages'];
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

      // 🔥 Déclarer toolArgs AVANT la boucle pour garder les arguments du thinking intermédiaire
      let toolArgs: any = {};

      // Exécuter chaque tool selon le plan
      for (let iterationIdx = 0; iterationIdx < totalIterations; iterationIdx++) {
        const toolStep = validatedToolSequence[iterationIdx];
        if (!toolStep) break;

        console.log(`🔧 [PHASE-1-ITER-${iterationIdx + 1}/${totalIterations}] Exécution: ${toolStep.toolName} - ${toolStep.description}`);

        // 🔥 RÉINITIALISER toolArgs SEULEMENT pour le premier tool
        if (iterationIdx === 0) {
          // 🔥 Premier tool: utiliser la question originale + les sources disponibles
          toolArgs = { query };
          
          // Si c'est read_rag_source et que des sources sont disponibles, passer le premier sourceId
          if (toolStep.toolName === 'read_rag_source' && availableSources.length > 0) {
            toolArgs.sourceId = availableSources[0].id;
          }
        }
        // Pour les itérations suivantes, toolArgs contient déjà les arguments du thinking précédent

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

        // 🔥 ÉTAPE 2D: Générer les arguments du tool SUIVANT via intermediate thinking (après exécution du tool actuel)
        const nextIterationIdx = iterationIdx + 1;
        if (nextIterationIdx < totalIterations && onIntermediateThinking) {
          const nextToolStep = validatedToolSequence[nextIterationIdx];
          
          // 🔥 CRITICAL: Si nextToolStep n'existe pas (plan a été modifié), arrêter la boucle
          if (!nextToolStep) {
            console.log(`⏹️ [PHASE-1-ITER-${iterationIdx + 1}] Pas de tool suivant après modification du plan, fin de la boucle`);
            break;
          }
          
          console.log(`🧠 [INTERMEDIATE-THINKING-AFTER-${iterationIdx}] Génération des arguments pour ${nextToolStep.toolName}...`);
          
          try {
            // 🔥 NEW: Build tool execution history
            const executedTools = toolCalls.map((tc, idx) => `${idx + 1}. ${tc.name}`).join('\n');
            const remainingTools = validatedToolSequence.slice(iterationIdx + 1).map(t => `- ${t.toolName}`).join('\n');
            
            // 🔥 NEW: Add useWeb flag and web instruction
            const webInstruction = useWeb 
              ? `\n🌐 IMPORTANT: L'utilisateur a ACTIVÉ la recherche web. Si aucun outil n'a encore appelé search_web, tu DOIS le proposer dans "modifiedToolSequence"!`
              : '';
            
            const intermediateThinkingPrompt = `Tu as reçu des résultats. Analyse-les et décide de la prochaine étape.

⚠️ QUESTION ORIGINALE: "${query}"

📋 TOOLS DÉJÀ EXÉCUTÉS:
${executedTools || 'Aucun'}

📋 TOOLS RESTANTS DANS LE PLAN:
${remainingTools || 'Aucun'}

⚠️ CRUCIAL - LIRE LES RÉSULTATS RÉELS:
ATTENTION! Les résultats précédents sont dans le contexte ci-dessus (Tool X résultat).
- Si un tool retourne "Aucune source" → C'est RÉEL, il n'y a pas de sources de ce type!
- Si un tool retourne une liste → COMPTE les sources et sélectionne les MEILLEURES
- N'INVENTE JAMAIS de sources! Utilise SEULEMENT celles listées dans les résultats précédents
- Si AUCUN tool n'a trouvé de sources → Tu DOIS appeler le tool SUIVANT dans le plan

🧠 STRATÉGIE INTELLIGENTE (PAS STRICTE):

1️⃣ SI des sources Wikipedia GLOBALES ont été LISTÉES mais NON ENCORE LUES:
   → 🎯 SÉLECTIONNE LES MEILLEURES (2-3 max) pertinentes pour la question
   → ❌ N'essaie PAS de tout lire! (ex: si 1000 sources, choisis les 3 les plus pertinentes)
   → 📖 LIS-LES pour extraire les informations clés
   → APRÈS avoir lu: décide si tu as besoin du web pour complémenter

2️⃣ COMMENT CHOISIR LES MEILLEURES SOURCES?
   - Lis les TITRES des sources listées
   - Sélectionne celles qui MATCHENT LE PLUS ta question
   - Utilise read_rag_source avec les MEILLEURES IDs (pas tous les IDs!)
   - Par exemple pour "parle-moi des théorèmes":
     ✅ "Théorème de Thalès" (très pertinent)
     ✅ "Théorème de Pythagore" (pertinent)
     ⚠️ "Loi des cosinus" (pertinent mais secondaire - à évaluer)

3️⃣ SI tu as DÉ JÀ LU des sources sélectionnées:
   → Évalue si la réponse est SUFFISANTE pour la question
   → ✅ Suffisant? → shouldContinue: false (l'IA générera la réponse finale)
   → ❌ Incomplet? → Tu peux enrichir OPTIONNELLEMENT avec search_web si web est activé

4️⃣ PHILOSOPHIE:
   - Les sources locales (Wikipedia globales) = PRIORITÉ (c'est gratuit + rapide)
   - SÉLECTION INTELLIGENTE: Choisis 2-3 sources max, pas tout
   - Le web = POUR ENRICHIR, pas remplacer les sources locales
   - Exemple: Lire les 2 théorèmes principaux dans Wikipedia, puis chercher des cas d'usage modernes sur le web

🌐 WEB STRATEGY:
- ${useWeb ? '✅ WEB ACTIVÉ: Tu peux utiliser search_web pour COMPLÉMENTER les sources existantes' : '❌ WEB DÉSACTIVÉ: Reste uniquement sur les sources locales'}
- search_web ne doit pas être la première option, mais un enrichissement optionnel
- Si sources locales couvrent la question: pas besoin de web!

📊 DÉCISION:
Retourne un JSON avec:
- "thinking": Ta réflexion sur les résultats et la prochaine étape
- "shouldContinue": true SEULEMENT si tu veux vraiment continuer (false = générer la réponse)
- "modifiedToolSequence": Propose une séquence SEULEMENT si tu veux changer le plan
- "nextToolName": Le prochain tool si tu veux continuer
- "toolArguments": Arguments spécifiques pour le prochain tool

EXEMPLES DE DÉCISIONS:

Exemple 1 - Wikipedia listée mais non lue (sélection intelligente):
{
  "thinking": "J'ai trouvé 3 sources Wikipedia: 'Théorème de Thalès' (23 chunks), 'Théorème de Pythagore' (38 chunks), 'Loi des cosinus' (19 chunks). Pour 'parle-moi des théorèmes', les 2 premières sont les plus essentielles. Je lis les meilleures.",
  "shouldContinue": true,
  "nextToolName": "read_rag_source",
  "toolArguments": {"sourceId": "6f9280e9-a4ba-43ae-8372-698efd22fa84", "query": "${query}"}
}

Exemple 2 - Wikipedia lue, info suffisante:
{
  "thinking": "J'ai lu les 2 théorèmes principaux (Thalès et Pythagore). Ils couvrent bien les concepts fondamentaux demandés.",
  "shouldContinue": false,
  "modifiedToolSequence": []
}

Exemple 3 - Wikipedia lue partiellement, veut enrichir avec web:
{
  "thinking": "J'ai lu Théorème de Thalès et Pythagore. Pour une réponse plus complète sur tous les théorèmes mathématiques, cherchons du web.",
  "shouldContinue": true,
  "nextToolName": "search_web",
  "toolArguments": {"query": "autres théorèmes mathématiques importants"}
}

Tu DOIS répondre UNIQUEMENT en JSON STRICT:`;

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
              // 🔥 NEW: Check if AI wants to modify the plan
              if (intermediateParsed.modifiedToolSequence && intermediateParsed.modifiedToolSequence.length > 0) {
                console.log(`🔄 [INTERMEDIATE-THINKING-AFTER-${iterationIdx}] Plan modifié! Nouvelle séquence:`, intermediateParsed.modifiedToolSequence.map((t: any) => t.toolName).join(' → '));
                
                // Remplacer le reste du plan avec le nouveau plan
                const newSequence = intermediateParsed.modifiedToolSequence;
                // Supprimer les tools déjà exécutés du nouveau plan
                for (let i = validatedToolSequence.length - 1; i > iterationIdx; i--) {
                  validatedToolSequence.pop();
                }
                // Ajouter les nouveaux tools
                for (const newTool of newSequence) {
                  validatedToolSequence.push(newTool);
                }
                console.log(`✅ Nouveau nombre total d'itérations: ${validatedToolSequence.length}`);
                
                // 🔥 IMPORTANT: Si on a modifié le plan, on doit CONTINUER même si shouldContinue est false
                // Sinon on ne va jamais exécuter le nouveau plan!
              } else if (intermediateParsed.shouldContinue === false) {
                // 🔥 NEW: Check if AI wants to stop the loop (SEULEMENT si pas de modifiedToolSequence)
                console.log(`⏹️ [INTERMEDIATE-THINKING-AFTER-${iterationIdx}] IA a décidé d'arrêter la boucle`);
                intermediateThinkingBlocks.push({
                  iteration: iterationIdx,
                  thinking: intermediateParsed.thinking,
                  toolArguments: {},
                  generatedAt: new Date().toISOString(),
                  nextToolName: 'STOP'
                });
                break; // Arrêter la boucle agentic
              }
              
              toolArgs = intermediateParsed.toolArguments || {};
              
              // Sauvegarder le bloc avec l'itération du TOOL ACTUELLEMENT EXÉCUTÉ
              intermediateThinkingBlocks.push({
                iteration: iterationIdx,  // 🔥 Itération du tool ACTUEL (après lequel ce thinking est généré)
                thinking: intermediateParsed.thinking,
                toolArguments: toolArgs,
                generatedAt: new Date().toISOString(),
                nextToolName: nextToolStep.toolName  // 🔥 Le PROCHAIN tool
              });

              console.log(`✅ [INTERMEDIATE-THINKING-AFTER-${iterationIdx}] Arguments extraits:`, toolArgs);
            } else {
              console.warn(`⚠️ Invalid intermediate thinking format after iteration ${iterationIdx}`);
            }
          } catch (error) {
            console.warn(`⚠️ [INTERMEDIATE-THINKING-AFTER-${iterationIdx}] Erreur:`, error);
            // Fallback: utiliser la description comme query
            toolArgs = { query: nextToolStep.description };
          }

          await sleep(50);
        }
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
        usedFallback: false,
        intermediateThinkingBlocks: toolDecision.intermediateThinkingBlocks // 🔥 NEW: Include blocks
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
      usedFallback: true,
      intermediateThinkingBlocks: [] // 🔥 NEW: Empty array for fallback (no tools used)
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

