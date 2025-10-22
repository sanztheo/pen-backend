/**
 * Phase 1 : Décision et exécution des tools
 *
 * Ce service implémente une boucle agentic avec un système de thinking basé sur JSON :
 * - First thinking : génère un plan JSON avec la séquence de tools
 * - Intermediate thinking : génère du JSON avec les arguments pour chaque tool
 * - Les tools s'exécutent avec les arguments dérivés du thinking intermédiaire
 */

import { AIService } from '../../base.js';
import { ToolExecutor, type ToolContext } from '../../tools/executors.js';
import {
  isFirstThinkingPlan,
  isIntermediateThinkingOutput,
  IntermediateThinkingBlock
} from '../../../../types/ragThinking.js';
import { parseJSONFromStream } from '../utils/jsonParser.js';
import { ToolCallRecord } from '../types/common.types.js';
import type { DecideToolsOptions, DecideToolsResult } from '../types/phase1.types.js';

/**
 * Service pour la Phase 1 : Décision et exécution des tools
 */
export class Phase1Service {
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
      // 🔥 NEW: Store extracted sources from tool results for reuse
      let extractedSources: any[] = [];

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

        // 🔥 NEW: Extract available sources from list_available_sources or list_global_wikipedia_sources results
        if ((toolStep.toolName === 'list_available_sources' || toolStep.toolName === 'list_global_wikipedia_sources') && result && !result.startsWith('❌') && !result.startsWith('Aucune')) {
          try {
            // Parse source listings from the result (format: "ID: XXX")
            const sourceMatches = result.match(/ID: ([a-f0-9\-]+)/g);
            if (sourceMatches) {
              sourceMatches.forEach((match: string) => {
                const id = match.replace('ID: ', '');
                // Parse the title from the line above
                const lines = result.split('\n');
                const matchIdx = lines.findIndex(line => line.includes(match));
                if (matchIdx > 0) {
                  const titleLine = lines[matchIdx - 3] || '';
                  const titleMatch = titleLine.match(/\d+\.\s*\[.+?\]\s*(.+)/);
                  const title = titleMatch ? titleMatch[1] : 'Unknown';
                  
                  const typeLineIdx = lines.findIndex((line, idx) => idx > matchIdx - 3 && line.startsWith('   Type:'));
                  const typeMatch = typeLineIdx >= 0 ? lines[typeLineIdx].match(/Type:\s*(.+)/) : null;
                  const sourceType = typeMatch ? typeMatch[1].trim() : 'WIKIPEDIA';
                  
                  if (!extractedSources.find(s => s.id === id)) {
                    extractedSources.push({ id, title, sourceType });
                  }
                }
              });
              console.log(`🔄 [PHASE-1] Extracted ${extractedSources.length} sources from ${toolStep.toolName}`);
            }
          } catch (parseError) {
            console.warn(`⚠️ [PHASE-1] Failed to extract sources from ${toolStep.toolName} result:`, parseError);
          }
        }

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

🛠️ ARGUMENTS PAR TOOL:

Pour select_relevant_sources:
  - TOUJOURS inclure: "question": "${query}"
  - TOUJOURS inclure: "availableSources": Array d'objets {id, title, sourceType} EXTRAITS des résultats précédents
  - Exemple: {"question": "${query}", "availableSources": [{"id": "123", "title": "...", "sourceType": "WIKIPEDIA"}]}

Pour read_rag_source:
  - Inclure: "sourceId": L'ID d'une source trouvée
  - Inclure: "query": "${query}"
  - Exemple: {"sourceId": "123", "query": "${query}"}

Pour search_rag_chunks:
  - Inclure: "query": "${query}"
  - Inclure optionnellement: "sourceIds": Array d'IDs si tu veux chercher dans des sources spécifiques

📊 DÉCISION:
Retourne un JSON avec:
- "thinking": Ta réflexion sur les résultats et la prochaine étape
- "shouldContinue": true SEULEMENT si tu veux vraiment continuer (false = générer la réponse)
- "modifiedToolSequence": Propose une séquence SEULEMENT si tu veux changer le plan
- "nextToolName": Le prochain tool si tu veux continuer
- "toolArguments": Arguments spécifiques pour le prochain tool

EXEMPLES DE DÉCISIONS:

Exemple 1 - Wikipedia listée avec select_relevant_sources:
{
  "thinking": "J'ai trouvé 3 sources Wikipedia. Je dois les sélectionner intelligemment pour la question 'parle-moi des théorèmes'.",
  "shouldContinue": true,
  "nextToolName": "select_relevant_sources",
  "toolArguments": {
    "question": "${query}",
    "availableSources": [
      {"id": "id1", "title": "Théorème de Thalès", "sourceType": "WIKIPEDIA"},
      {"id": "id2", "title": "Théorème de Pythagore", "sourceType": "WIKIPEDIA"},
      {"id": "id3", "title": "Loi des cosinus", "sourceType": "WIKIPEDIA"}
    ]
  }
}

Exemple 2 - Wikipedia listée, lire la meilleure:
{
  "thinking": "J'ai listé les sources. Maintenant je lis la meilleure pour 'parle-moi des théorèmes'.",
  "shouldContinue": true,
  "nextToolName": "read_rag_source",
  "toolArguments": {"sourceId": "6f9280e9-a4ba-43ae-8372-698efd22fa84", "query": "${query}"}
}

Exemple 3 - Wikipedia lue, info suffisante:
{
  "thinking": "J'ai lu les 2 théorèmes principaux (Thalès et Pythagore). Ils couvrent bien les concepts fondamentaux demandés.",
  "shouldContinue": false,
  "modifiedToolSequence": []
}

Exemple 4 - Wikipedia lue partiellement, veut enrichir avec web:
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

              // 🔥 NEW: Ensure select_relevant_sources has required arguments
              if (nextToolStep.toolName === 'select_relevant_sources') {
                // Add question if missing
                if (!toolArgs.question) {
                  toolArgs.question = query;
                  console.log(`🔧 [INTERMEDIATE-THINKING] Added missing 'question' to select_relevant_sources`);
                }
                
                // Add availableSources if missing
                if (!toolArgs.availableSources || !Array.isArray(toolArgs.availableSources) || toolArgs.availableSources.length === 0) {
                  if (extractedSources.length > 0) {
                    toolArgs.availableSources = extractedSources;
                    console.log(`🔧 [INTERMEDIATE-THINKING] Added extracted sources (${extractedSources.length}) to select_relevant_sources`);
                  } else {
                    console.warn(`⚠️ [INTERMEDIATE-THINKING] No extracted sources available for select_relevant_sources`);
                  }
                }
              }

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
}
