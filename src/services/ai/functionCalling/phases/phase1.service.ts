/**
 * Phase 1 : Décision et exécution des tools
 *
 * Ce service implémente une boucle agentic avec un système de thinking basé sur JSON :
 * - First thinking : génère un plan JSON avec la séquence de tools
 * - Intermediate thinking : génère du JSON avec les arguments pour chaque tool
 * - Les tools s'exécutent avec les arguments dérivés du thinking intermédiaire
 */

import { AIService } from "../../base.js";
import { ToolExecutor, type ToolContext } from "../../tools/executors.js";
import {
  isFirstThinkingPlan,
  isIntermediateThinkingOutput,
  IntermediateThinkingBlock,
} from "../../../../types/ragThinking.js";
import { parseJSONFromStream } from "../utils/jsonParser.js";
import { ToolCallRecord } from "../types/common.types.js";
import type {
  DecideToolsOptions,
  DecideToolsResult,
} from "../types/phase1.types.js";
import { CoordinatorService } from "../coordinator.service.js";
import { ScoringService, type ToolResultScore } from "../scoring.service.js";

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
    options: DecideToolsOptions,
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
      onIntermediateThinking,
    } = options;

    const toolCalls: ToolCallRecord[] = [];
    const intermediateThinkingBlocks: IntermediateThinkingBlock[] = [];
    let thinking = "";
    const context: ToolContext = { userId, workspaceId };

    console.log(
      `🔧 [PHASE-1] Boucle agentic refactorisée avec ${availableSources.length} sources disponibles`,
    );

    const openai = AIService.getOpenAI();
    const sleep = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));

    try {
      // 🔥 ÉTAPE 1: First Thinking - Generate JSON plan with tool sequence
      console.log(`💭 [PHASE-1] Génération first thinking avec plan JSON...`);

      const sourcesContext =
        availableSources.length > 0
          ? `Sources disponibles:\n${availableSources.map((s, i) => `${i + 1}. "${s.title}" (ID: ${s.id}, Type: ${s.type})`).join("\n")}`
          : "Aucune source spécifique disponible";

      // 🎯 CONTEXTE ADAPTATIF: Détecter le scénario pour adapter les instructions
      const hasWorkspacePages = availableSources.some(
        (s) => s.type === "WORKSPACE_PAGE",
      );
      const hasSpecificSources = availableSources.length > 0;
      const isAllSourceMode = !hasSpecificSources; // Mode all_source si aucune source spécifique
      const isWebOnlyMode = useWeb && !hasSpecificSources; // 🔥 NEW: Mode web uniquement

      let contextualInstructions = "";

      // 🎯 SCÉNARIO 0: Web uniquement (pas de sources locales)
      if (isWebOnlyMode) {
        contextualInstructions = `\n\n📌 CONTEXTE: MODE WEB UNIQUEMENT activé.

🌐 STRATÉGIE WEB ONLY (exploration web profonde) :
1. **MULTI-RECHERCHE WEB** : Utilise "search_web" PLUSIEURS FOIS avec des angles différents
   - Première recherche : Query générale/large sur le sujet
   - Deuxième recherche : Aspect spécifique ou angle différent
   - Troisième recherche (optionnel) : Approfondissement ou détails techniques
2. **ANGLES DIFFÉRENTS** : Varie les queries pour obtenir des perspectives complémentaires
3. **EXPLORATION PROFONDE** : Ne te limite pas à 1 seul appel web, explore le sujet sous plusieurs angles

🎯 EXEMPLES DE MULTI-RECHERCHE :
Query user: "Parle-moi de Y Combinator"
→ search_web 1: "Y Combinator startup accelerator history"
→ search_web 2: "Y Combinator portfolio companies success stories"
→ search_web 3: "Y Combinator application process requirements"

Query user: "Théorème de Pythagore"
→ search_web 1: "Pythagoras theorem definition proof"
→ search_web 2: "Pythagoras theorem real world applications"
→ search_web 3: "Pythagoras theorem history origin"

⚠️ IMPORTANT :
- NE LISTE PAS les sources locales (aucune source locale disponible)
- NE SÉLECTIONNE PAS de sources (tu n'en as pas)
- CONCENTRE-TOI sur le web avec plusieurs angles d'exploration
- Chaque appel search_web doit avoir une query différente et complémentaire`;
      }
      // 🎯 SCÉNARIO 1: Page/source unique spécifique
      else if (hasSpecificSources && availableSources.length === 1) {
        contextualInstructions = `\n\n📌 CONTEXTE: Une source spécifique a été sélectionnée par l'utilisateur.

🎯 STRATÉGIE RECOMMANDÉE (ADAPTATIVE) :
1. **PRIORITÉ**: Commence par lire cette source avec "read_rag_source" (ID: ${availableSources[0].id})
2. **ÉVALUATION**: Après lecture, évalue si l'information est suffisante
3. **SI INSUFFISANT**: Tu peux explorer d'autres sources avec "list_available_sources" ou "search_web" (si activé)
4. **FLEXIBILITÉ**: La source sélectionnée est prioritaire mais pas exclusive si elle est incomplète

⚠️ NOTE: L'utilisateur a choisi cette source, mais tu peux la compléter si nécessaire.`;
      }
      // 🎯 SCÉNARIO 2: Multiple sources spécifiques
      else if (hasSpecificSources && availableSources.length > 1) {
        contextualInstructions = `\n\n📌 CONTEXTE: ${availableSources.length} sources spécifiques ont été sélectionnées.

🎯 STRATÉGIE RECOMMANDÉE (ADAPTATIVE) :
1. **PRIORITÉ**: Lis ces sources sélectionnées avec "read_rag_source" ou "select_relevant_sources"
2. **OPTIMISATION**: Choisis les plus pertinentes (2-3 max) plutôt que tout lire
3. **ÉVALUATION**: Après lecture, évalue si l'information couvre la question
4. **SI INSUFFISANT**: Tu peux compléter avec "search_web" (si activé) ou chercher d'autres sources

⚠️ NOTE: Les sources sélectionnées sont prioritaires mais explorables si incomplètes.`;
      }
      // 🎯 SCÉNARIO 3: all_source (exploration libre)
      else if (isAllSourceMode) {
        contextualInstructions = `\n\n📌 CONTEXTE: Mode exploration libre (all_source) - Aucune source spécifique.

🎯 STRATÉGIE RECOMMANDÉE (EXPLORATION COMPLÈTE) :
1. **DÉCOUVERTE**: Commence par lister TOUTES les sources disponibles
   - Appelle "list_available_sources" pour les sources personnelles
   - Appelle "list_global_wikipedia_sources" pour les sources Wikipedia globales
2. **SÉLECTION**: Identifie les sources les plus pertinentes pour la question
3. **LECTURE**: Lis les 2-3 meilleures sources avec "read_rag_source"
4. **ENRICHISSEMENT**: Si ${useWeb ? 'web activé, utilise "search_web" pour compléter' : "besoin, cherche dans d'autres sources"}

⚠️ NOTE: Mode exploration complète - explore toutes les options disponibles.`;
      }

      // 🔥 NEW: Add useWeb instruction with adaptive priority
      const useWebStr = useWeb
        ? `\n\n🌐 RECHERCHE WEB ACTIVÉE:
${
  hasSpecificSources
    ? 'Tu PEUX utiliser "search_web" pour ENRICHIR les sources sélectionnées si nécessaire.'
    : 'Tu PEUX utiliser "search_web" après avoir exploré les sources locales, ou AVANT si tu penses que le web sera plus pertinent.'
}

📊 APPROCHE ADAPTATIVE (basée sur les scores) :
- Si les sources locales donnent un bon score (>0.7) → Web OPTIONNEL
- Si les sources locales donnent un score moyen (0.4-0.7) → Web RECOMMANDÉ
- Si les sources locales donnent un score faible (<0.4) → Web FORTEMENT RECOMMANDÉ`
        : "";

      const firstThinkingPrompt = isSearch
        ? `Tu dois créer un plan JSON structuré pour explorer un sujet en profondeur.

🚨 **DÉTECTION SMALL TALK** (PRIORITÉ ABSOLUE) :
Avant TOUTE planification, analyse si la question est une simple conversation sociale :
- Salutations : "salut", "bonjour", "hello", "hi", "hey", "coucou"
- Remerciements : "merci", "thanks", "thx", "ok merci"
- Politesse : "au revoir", "bye", "à plus", "bonne journée"
- Confirmation : "ok", "d'accord", "compris"

⚠️ **SI SMALL TALK DÉTECTÉ** :
→ Retourne IMMÉDIATEMENT un plan avec totalIterations: 0 et toolSequence: []
→ La réponse sera générée SANS utiliser de tools et SANS déduire de crédits
→ Exemple de réponse JSON :
\`\`\`json
{
  "plan": {
    "totalIterations": 0,
    "reasoning": "Question conversationnelle détectée (salutation/politesse), aucun tool nécessaire",
    "optimizedQuery": "",
    "toolSequence": []
  }
}
\`\`\`

# OUTILS DISPONIBLES (par catégorie)

## 📋 LISTER LES SOURCES
- \`list_available_sources\` : Liste TOUTES les sources disponibles (pages, fichiers, Wikipedia personnelles)
- \`list_global_wikipedia_sources\` : Liste les sources Wikipedia GLOBALES partagées (avant \`search_web\` !)
- \`list_workspace_pages\` : Liste les pages du workspace

## 🔍 LIRE/CHERCHER DANS LES SOURCES
- \`read_rag_source\` : Lit le contenu complet d'UNE source RAG
- \`select_relevant_sources\` : Sélectionne les sources pertinentes pour la question
- \`search_rag_chunks\` : Recherche sémantique DANS les sources RAG
- \`read_workspace_page\` : Lit une page spécifique du workspace

## 🌐 EXTERNES
- \`check_sources_rag_status\` : Vérifie le statut RAG des sources (nécessite des IDs de source)
- \`search_web\` : Recherche web ${isWebOnlyMode ? "(OUTIL PRINCIPAL - utilise-le PLUSIEURS FOIS avec des angles différents)" : "(dernier recours)"}

# STRATÉGIE RECOMMANDÉE (Search Mode - exploration profonde)
${
  isWebOnlyMode
    ? `
🌐 **MODE WEB ONLY DÉTECTÉ** : Aucune source locale sélectionnée
→ UTILISE "search_web" PLUSIEURS FOIS (2-4 appels) avec des angles différents pour explorer le sujet en profondeur
→ Varie les queries pour obtenir des perspectives complémentaires
→ NE perds PAS de temps à lister les sources (aucune source locale disponible)

Exemple de plan pour "Parle-moi de Y Combinator" :
1. search_web: "Y Combinator startup accelerator history founders"
2. search_web: "Y Combinator portfolio companies unicorns success"
3. search_web: "Y Combinator application process funding model"
4. search_web (optionnel): "Y Combinator Demo Day investor network"
`
    : `
1. Appelle \`list_available_sources\`, puis \`list_global_wikipedia_sources\` → obtenez la liste complète des sources (personnelles + globales)
2. Utilise \`select_relevant_sources\` OU \`read_rag_source\` pour explorer les sources pertinentes
3. Utilise \`search_rag_chunks\` pour chercher des informations précises dans les sources
4. Si l'information reste insuffisante, utilise \`search_web\` OU \`check_sources_rag_status\`
`
}

🔥 **IMPORTANT :**
${
  isWebOnlyMode
    ? `
- MODE WEB ONLY : Saute directement aux appels "search_web" multiples
- N'appelle PAS list_available_sources ou list_global_wikipedia_sources (aucune source locale)
- Concentre-toi sur 2-4 appels search_web avec des queries complémentaires
- Chaque search_web doit explorer un angle différent du sujet
`
    : `
- Appelle TOUJOURS \`list_available_sources\` PUIS \`list_global_wikipedia_sources\` au début, dans cet ordre.
- Si \`list_available_sources\` retourne vide, appelle quand même \`list_global_wikipedia_sources\` pour vérifier les Wikipedia globales.
- N'appelle JAMAIS \`read_rag_source\` avec un ID vide ! Vérifie toujours les sources listées avant.
- Si aucune source n'est trouvée nulle part, utilise \`search_web\`.
`
}

# PLANIFICATION
Commence par un court checklist (3-7 étapes conceptuelles) de ce que tu vas faire pour organiser la séquence de résolution avant d'établir la séquence des outils.

# RÈGLES ABSOLUES
${
  isWebOnlyMode
    ? `
🌐 **MODE WEB ONLY ACTIVÉ** (aucune source locale sélectionnée) :
- ❌ N'appelle JAMAIS list_available_sources, list_global_wikipedia_sources, select_relevant_sources
- ✅ Utilise UNIQUEMENT search_web (2-4 appels avec queries variées)
- ✅ Chaque search_web doit explorer un angle différent du sujet
- ✅ Commence DIRECTEMENT par search_web à l'étape 1
`
    : `
📚 **MODE HYBRIDE** (sources locales disponibles) :
- ✅ Commence TOUJOURS par list_available_sources PUIS list_global_wikipedia_sources
- ✅ Ensuite select_relevant_sources OU read_rag_source pour explorer
- ✅ search_web seulement si sources locales insuffisantes${useWebStr}
`
}
- 🎯 **IMPÉRATIF**: Reformule SYSTÉMATIQUEMENT la query utilisateur pour TOUS les outils qui acceptent "query" ou "question"
- 🎯 **OPTIMISATION QUERIES**: Corrige orthographe, enrichis avec mots-clés, rends précis ce qui est vague
- CHAQUE outil doit être différent et complémentaire à chaque étape
- \`totalIterations\` : valeur entre ${isWebOnlyMode ? "2 et 5 (focus multi-recherches web)" : "1 et 8"}
- Si tu utilises \`check_sources_rag_status\`, récupère d'abord les IDs des sources
- Utilise uniquement les outils listés ci-dessus; pour les opérations de lecture et de consultation, tu peux appeler automatiquement; pour tout changement d'état ou opération destructrice, requiers une confirmation explicite avant exécution.
- Avant d'appeler tout outil important, indique brièvement pourquoi tu l'appelles et les paramètres minimaux utilisés.

# STRUCTURE STRICTE DU JSON (tous les champs sont obligatoires)

\`\`\`json
{
  "plan": {
    "totalIterations": <entier entre 1 et 8>,
    "reasoning": "<courte explication du choix de séquence>",
    "optimizedQuery": "<🎯 REFORMULATION OBLIGATOIRE de la query utilisateur pour améliorer les résultats>",
    "toolSequence": [
      {
        "step": <entier>,
        "toolName": "<nom de l'outil>",
        "description": "<brève description de l'action>",
        "params": {
          // Facultatif : paramètres comme sourceId (si requis par l'outil)
        }
      }
      // ...autres étapes, toujours dans l'ordre prescrit (démarre par \`list_available_sources\` puis \`list_global_wikipedia_sources\`)
    ],
    "errorHandling": {
      "emptySourceId": "Ne jamais appeler read_rag_source avec un ID vide. Vérifie d'abord les sources listées.",
      "noSourcesFound": "Si aucune source trouvée dans toutes les listes, utilise search_web."
    }
  }
}
\`\`\`

🎯 **CHAMP OBLIGATOIRE - optimizedQuery** :
Ce champ DOIT contenir une version reformulée et optimisée de la query utilisateur.
Cette query optimisée sera utilisée automatiquement pour les premiers tools (list_available_sources, select_relevant_sources, etc.).

Exemple de reformulation :
- Query utilisateur: "fait une analyse sur le web sur pythagore"
- optimizedQuery: "Théorème de Pythagore: définition, démonstration mathématique et applications géométriques"

Après avoir réalisé la planification et la séquence, valide que chaque outil est bien justifié dans la séquence et que le schéma de sortie est strictement respecté.

${sourcesContext}${contextualInstructions}${useWebStr}

Question : "${query}"

GÉNÈRE le plan JSON MAINTENANT. Aucun texte avant ou après le JSON.

## Format de sortie
- Le plan JSON doit respecter strictement le schéma ci-dessus.
- Outils toujours dans l'ordre prescrit au début : \`list_available_sources\`, puis \`list_global_wikipedia_sources\`.
- \`totalIterations\` DOIT être précisé et compris entre 1 et 8 selon le mode.
- N'utilise pas \`read_rag_source\` sans ID validé.
- Si aucune source trouvée, inclure obligatoirement \`search_web\` en fallback dans la séquence.`
        : `Tu dois créer un plan JSON SIMPLE pour mode ASK RAPIDE (1-3 tools maximum).

🚨 **DÉTECTION SMALL TALK** (PRIORITÉ ABSOLUE) :
Avant TOUTE planification, analyse si la question est une simple conversation sociale :
- Salutations : "salut", "bonjour", "hello", "hi", "hey", "coucou"
- Remerciements : "merci", "thanks", "thx", "ok merci"
- Politesse : "au revoir", "bye", "à plus", "bonne journée"
- Confirmation : "ok", "d'accord", "compris"

⚠️ **SI SMALL TALK DÉTECTÉ** :
→ Retourne IMMÉDIATEMENT un plan avec totalIterations: 0 et toolSequence: []
→ La réponse sera générée SANS utiliser de tools et SANS déduire de crédits
→ Exemple de réponse JSON :
\`\`\`json
{
  "plan": {
    "totalIterations": 0,
    "reasoning": "Question conversationnelle détectée (salutation/politesse), aucun tool nécessaire",
    "optimizedQuery": "",
    "toolSequence": []
  }
}
\`\`\`

# OUTILS DISPONIBLES SIMPLIFIÉS

## 📋 EXPLORATION BASIQUE
- \`list_available_sources\` : Liste les sources disponibles
- \`search_rag_chunks\` : Recherche rapide dans les sources

## 🌐 WEB (SI ACTIVÉ)
- \`search_web\` : Recherche web rapide

# STRATÉGIE MODE RAPIDE (1-3 outils max)
${
  hasSpecificSources
    ? `Sources spécifiques fournies → Appelle \`search_rag_chunks\` avec la query pour trouver l'info rapidement`
    : useWeb && availableSources.length === 0
      ? `🌐 MODE RAPIDE + WEB ONLY DÉTECTÉ
→ AUCUNE source locale disponible, utilise DIRECTEMENT \`search_web\` (NE PAS lister les sources)
→ Focus rapidité : 1 seul \`search_web\` suffit pour récupérer les infos essentielles
→ Si user demande "look on the web" ou "recherche web", utilise \`search_web\` en PREMIER tool

⚡ Exemple pour "Create welcome page for Y Combinator, look on the web":
{
  "toolSequence": [
    {
      "step": 1,
      "toolName": "search_web",
      "description": "Rechercher qui est Y Combinator et leur mission"
    }
  ]
}`
      : useWeb
        ? `Pas de sources spécifiques → Commence par \`list_available_sources\` puis \`search_web\` si nécessaire`
        : `Pas de sources spécifiques, pas de web → Appelle \`list_available_sources\` puis \`search_rag_chunks\``
}

🔥 **MODE RAPIDE** : Maximum 3 tools, privilégie la rapidité sur l'exhaustivité.

## Schema JSON (OBLIGATOIRE)

\`\`\`json
{
  "plan": {
    "totalIterations": <1 à 3>,
    "reasoning": "<courte explication>",
    "optimizedQuery": "<reformulation de la query pour meilleurs résultats>",
    "toolSequence": [
      {
        "step": 1,
        "toolName": "<nom_outil>",
        "description": "<action>"
      }
    ]
  }
}
\`\`\`

${sourcesContext}${contextualInstructions}${useWebStr}

Question : "${query}"

GÉNÈRE le plan JSON MAINTENANT. Maximum 3 tools. Aucun texte avant ou après le JSON.`;

      let firstThinkingContent = "";
      const firstThinkingStream = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "Tu es un expert en structuration de requêtes. Tu génères UNIQUEMENT du JSON valide, sans texte additionnel.",
          },
          {
            role: "user",
            content: firstThinkingPrompt,
          },
        ],
        temperature: 0.3,
        max_tokens: 800, // 🎯 Augmenté pour permettre optimizedQuery + plan complet
        stream: true,
        response_format: { type: "json_object" } as any, // 🔥 JSON MODE STRICT
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

      console.log(
        `✅ [PHASE-1] First thinking généré: ${firstThinkingContent.length} chars`,
      );

      // Parse first thinking JSON
      const firstThinkingPlan = parseJSONFromStream(firstThinkingContent);
      if (!isFirstThinkingPlan(firstThinkingPlan)) {
        console.warn(
          "⚠️ First thinking plan invalid, falling back to no tools",
        );
        // 🔥 FIX: En mode rapide (isSearch=false), accepter un plan vide et continuer sans tools
        if (!isSearch) {
          console.log(
            "🔧 [PHASE-1] Mode rapide détecté, continuing sans tools",
          );
          return {
            shouldUseTools: false,
            toolCalls: [],
            thinking: firstThinkingContent,
            intermediateThinkingBlocks: [],
          };
        }
        // En mode search, un plan invalide est une erreur
        throw new Error("Invalid first thinking plan format");
      }

      const { totalIterations, toolSequence, optimizedQuery } =
        firstThinkingPlan.plan;

      // 🚨 SMALL TALK DETECTION: Si totalIterations === 0, c'est du small talk
      if (totalIterations === 0 || toolSequence.length === 0) {
        console.log(`💬 [PHASE-1] Small talk détecté: "${query}" - Skip tools`);
        return {
          shouldUseTools: false,
          toolCalls: [],
          thinking: firstThinkingContent,
          intermediateThinkingBlocks: [],
        };
      }

      // 🎯 Extraire la query optimisée du plan (ou fallback sur query originale)
      const queryToUse =
        optimizedQuery &&
        typeof optimizedQuery === "string" &&
        optimizedQuery.trim().length > 0
          ? optimizedQuery
          : query;

      if (optimizedQuery && optimizedQuery !== query) {
        console.log(`🎯 [QUERY-OPTIMIZATION] Query reformulée:`);
        console.log(`   Original: "${query.slice(0, 100)}"`);
        console.log(`   Optimisée: "${optimizedQuery.slice(0, 100)}"`);
      }

      // 🔥 Valider les tools: ne garder que les tools valides
      const VALID_TOOLS = [
        "list_available_sources",
        "select_relevant_sources",
        "check_sources_rag_status",
        "read_rag_source",
        "search_rag_chunks",
        "search_web",
        "read_workspace_page",
        "list_workspace_pages",
      ];
      const validatedToolSequence = toolSequence.filter((t) =>
        VALID_TOOLS.includes(t.toolName),
      );

      if (validatedToolSequence.length === 0) {
        console.warn("⚠️ Aucun tool valide dans le plan");
        throw new Error("No valid tools in plan");
      }

      console.log(
        `🔧 [PHASE-1] Plan validé: ${validatedToolSequence.length} tools valides, tools: ${validatedToolSequence.map((t) => t.toolName).join(" → ")}`,
      );

      await sleep(150);

      // 🔥 ÉTAPE 2: Agentic loop - Execute tools with arguments from intermediate thinking
      const initialMessages: any[] = [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: `${sourcesContext}${contextualInstructions}\n\nQuestion: "${query}"`,
        },
      ];

      // 🔥 Déclarer toolArgs AVANT la boucle pour garder les arguments du thinking intermédiaire
      let toolArgs: any = {};
      // 🔥 NEW: Store extracted sources from tool results for reuse
      let extractedSources: any[] = [];

      // Exécuter chaque tool selon le plan (la séquence peut grandir dynamiquement via improvement logic)
      for (
        let iterationIdx = 0;
        iterationIdx < validatedToolSequence.length;
        iterationIdx++
      ) {
        const toolStep = validatedToolSequence[iterationIdx];
        if (!toolStep) break;

        console.log(
          `🔧 [PHASE-1-ITER-${iterationIdx + 1}/${validatedToolSequence.length}] Exécution: ${toolStep.toolName} - ${toolStep.description}`,
        );

        // 🔥 RÉINITIALISER toolArgs SEULEMENT pour le premier tool
        if (iterationIdx === 0) {
          // 🔥 Premier tool: utiliser la query optimisée du plan
          toolArgs = { query: queryToUse };

          // Si c'est read_rag_source et que des sources sont disponibles, passer le premier sourceId
          if (
            toolStep.toolName === "read_rag_source" &&
            availableSources.length > 0
          ) {
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
        const result = await ToolExecutor.executeToolCall(
          toolStep.toolName,
          toolArgs,
          context,
        );

        // 🔥 NEW: Extract available sources from list_available_sources or list_global_wikipedia_sources results
        if (
          (toolStep.toolName === "list_available_sources" ||
            toolStep.toolName === "list_global_wikipedia_sources") &&
          result &&
          !result.startsWith("❌") &&
          !result.startsWith("Aucune")
        ) {
          try {
            // Parse source listings from the result (format: "ID: XXX")
            const sourceMatches = result.match(/ID: ([a-f0-9\-]+)/g);
            if (sourceMatches) {
              sourceMatches.forEach((match: string) => {
                const id = match.replace("ID: ", "");
                // Parse the title from the line above
                const lines = result.split("\n");
                const matchIdx = lines.findIndex((line) =>
                  line.includes(match),
                );
                if (matchIdx > 0) {
                  const titleLine = lines[matchIdx - 3] || "";
                  const titleMatch = titleLine.match(/\d+\.\s*\[.+?\]\s*(.+)/);
                  const title = titleMatch ? titleMatch[1] : "Unknown";

                  const typeLineIdx = lines.findIndex(
                    (line, idx) =>
                      idx > matchIdx - 3 && line.startsWith("   Type:"),
                  );
                  const typeMatch =
                    typeLineIdx >= 0
                      ? lines[typeLineIdx].match(/Type:\s*(.+)/)
                      : null;
                  const sourceType = typeMatch
                    ? typeMatch[1].trim()
                    : "WIKIPEDIA";

                  if (!extractedSources.find((s) => s.id === id)) {
                    extractedSources.push({ id, title, sourceType });
                  }
                }
              });
              console.log(
                `🔄 [PHASE-1] Extracted ${extractedSources.length} sources from ${toolStep.toolName}`,
              );
            }
          } catch (parseError) {
            console.warn(
              `⚠️ [PHASE-1] Failed to extract sources from ${toolStep.toolName} result:`,
              parseError,
            );
          }
        }

        // Stream tool result
        if (onToolResult) {
          onToolResult(toolStep.toolName, result);
        }

        await sleep(50);

        // 🎯 SCORING: Évaluer la qualité du résultat (observe → adjust → continue)
        const resultScore = await ScoringService.scoreToolResult({
          toolName: toolStep.toolName,
          result,
          query: queryToUse,
          expectedInfo: toolStep.description,
          context: {
            previousScores: toolCalls
              .map((tc) => tc.score)
              .filter((s) => s !== undefined) as ToolResultScore[],
            useWeb,
            hasSpecificSource: availableSources.length > 0,
            mode: isSearch ? "search" : "ask",
          },
        });

        console.log(
          `📊 [PHASE-1-SCORE] ${toolStep.toolName}: ${resultScore.overallScore.toFixed(2)} (conf=${resultScore.confidence.toFixed(2)}, rel=${resultScore.relevance.toFixed(2)}, comp=${resultScore.completeness.toFixed(2)})`,
        );
        if (resultScore.suggestions.length > 0) {
          console.log(`💡 [PHASE-1-SUGGESTIONS]:`, resultScore.suggestions);
        }

        // Enregistrer le tool call avec son score
        toolCalls.push({
          name: toolStep.toolName,
          arguments: toolArgs,
          result,
          score: resultScore, // 🆕 NOUVEAU : score pour audit
          timestamp: Date.now(),
        });

        // Ajouter à l'historique des messages
        initialMessages.push({
          role: "user",
          content: `Tool ${toolStep.toolName} résultat:\n${result}`,
        });

        console.log(
          `✅ [PHASE-1-ITER-${iterationIdx + 1}] Complété: ${toolStep.toolName}`,
        );

        // 🔄 FEEDBACK LOOP: Ajuster la stratégie en fonction des scores (observe → adjust → continue)
        const strategyAdjustment = await ScoringService.adjustStrategy(
          toolCalls.map((tc) => ({
            name: tc.name,
            score: tc.score,
            result: tc.result,
          })),
          queryToUse,
          {
            useWeb,
            availableSourcesCount: availableSources.length,
            hasSpecificSource: availableSources.length > 0,
            mode: isSearch ? "search" : "ask",
          },
        );

        console.log(`🔄 [STRATEGY-ADJUST] ${strategyAdjustment.reasoning}`);
        console.log(
          `   shouldExploreMore: ${strategyAdjustment.shouldExploreMore}, shouldUseWeb: ${strategyAdjustment.shouldUseWeb}, shouldStop: ${strategyAdjustment.shouldStop}`,
        );
        console.log(
          `   Priority: ${strategyAdjustment.priority}, Confidence: ${strategyAdjustment.confidence.toFixed(2)}`,
        );

        // 🔥 NOUVEAU: CURSOR-LIKE IMPROVEMENT - Agir sur les scores faibles (pas juste logger)
        // ⚠️ LIMITES: Max 10 iterations totales, max 2 tools ajoutés, respecter mode Web Only
        const MAX_ITERATIONS = 10;
        const MAX_IMPROVEMENTS = 2;
        const RECENT_TOOL_WINDOW = 3;

        // Compter combien de tools ont été ajoutés via IMPROVEMENT
        const improvementsAdded = validatedToolSequence.filter((t) =>
          t.description?.includes("Amélioration qualité"),
        ).length;

        // 🔥 FIX: En mode Web Only, BLOQUER les suggestions de tools locaux
        const allowedToolsInWebOnly = ["search_web"];
        let filteredSuggestedTools = strategyAdjustment.suggestedTools;

        if (isWebOnlyMode) {
          filteredSuggestedTools = strategyAdjustment.suggestedTools.filter(
            (toolName) => allowedToolsInWebOnly.includes(toolName),
          );

          if (
            filteredSuggestedTools.length <
            strategyAdjustment.suggestedTools.length
          ) {
            console.log(
              `🌐 [WEB-ONLY] Filtrage des tools locaux: ${strategyAdjustment.suggestedTools.join(", ")} → ${filteredSuggestedTools.join(", ")}`,
            );
          }
        }

        // Si les scores sont faibles ET que la stratégie recommande fortement d'explorer
        if (
          (strategyAdjustment.priority === "high" ||
            strategyAdjustment.priority === "critical") &&
          filteredSuggestedTools.length > 0 &&
          resultScore.overallScore < 0.6 &&
          validatedToolSequence.length < MAX_ITERATIONS &&
          improvementsAdded < MAX_IMPROVEMENTS // 🔥 FIX: Limite d'améliorations
        ) {
          console.log(
            `🔥 [IMPROVEMENT] Score faible détecté (${resultScore.overallScore.toFixed(2)}), ajout de tools pour amélioration (${improvementsAdded}/${MAX_IMPROVEMENTS})...`,
          );

          // Dynamiquement ajouter les tools suggérés à la fin du plan
          for (const suggestedToolName of filteredSuggestedTools) {
            if (improvementsAdded >= MAX_IMPROVEMENTS) {
              console.log(
                `⏹️ [IMPROVEMENT] Limite MAX_IMPROVEMENTS (${MAX_IMPROVEMENTS}) atteinte`,
              );
              break;
            }

            // 🔥 FIX: Vérifier si le tool n'est pas dans le plan restant OU dans les N dernières itérations
            const alreadyPlanned = validatedToolSequence
              .slice(iterationIdx + 1)
              .some((t) => t.toolName === suggestedToolName);

            const recentlyExecuted = validatedToolSequence
              .slice(
                Math.max(0, iterationIdx - RECENT_TOOL_WINDOW + 1),
                iterationIdx + 1,
              )
              .some((t) => t.toolName === suggestedToolName);

            if (
              !alreadyPlanned &&
              !recentlyExecuted &&
              validatedToolSequence.length < MAX_ITERATIONS
            ) {
              validatedToolSequence.push({
                step: validatedToolSequence.length + 1,
                toolName: suggestedToolName,
                description: `Amélioration qualité: ${strategyAdjustment.reasoning}`,
              });
              console.log(
                `✅ [IMPROVEMENT] Ajout de "${suggestedToolName}" pour améliorer la qualité (${improvementsAdded + 1}/${MAX_IMPROVEMENTS})`,
              );
            } else if (recentlyExecuted) {
              console.log(
                `⏭️ [IMPROVEMENT] Skip "${suggestedToolName}" (exécuté récemment dans les ${RECENT_TOOL_WINDOW} dernières iters)`,
              );
            }
          }

          // Augmenter totalIterations pour prendre en compte les nouveaux tools
          console.log(
            `🔄 [IMPROVEMENT] Nouvelle séquence: ${validatedToolSequence.map((t) => t.toolName).join(" → ")}`,
          );
        } else if (validatedToolSequence.length >= MAX_ITERATIONS) {
          console.log(
            `⏹️ [IMPROVEMENT] Limite MAX_ITERATIONS (${MAX_ITERATIONS}) atteinte, arrêt de l'amélioration`,
          );
        } else if (improvementsAdded >= MAX_IMPROVEMENTS) {
          console.log(
            `⏹️ [IMPROVEMENT] Limite MAX_IMPROVEMENTS (${MAX_IMPROVEMENTS}) atteinte`,
          );
        }

        // Si la stratégie suggère d'arrêter et qu'on a assez d'informations
        if (
          strategyAdjustment.shouldStop &&
          strategyAdjustment.confidence > 0.8
        ) {
          console.log(
            `⏹️ [STRATEGY-ADJUST] Arrêt recommandé: informations suffisantes (score: ${resultScore.overallScore.toFixed(2)})`,
          );
          // Ne pas arrêter brutalement, laisser l'IA décider dans le thinking intermédiaire
        }

        // 🔥 ÉTAPE 2D: Générer les arguments du tool SUIVANT via intermediate thinking (après exécution du tool actuel)
        const nextIterationIdx = iterationIdx + 1;
        if (
          nextIterationIdx < validatedToolSequence.length &&
          onIntermediateThinking
        ) {
          const nextToolStep = validatedToolSequence[nextIterationIdx];

          // 🔥 CRITICAL: Si nextToolStep n'existe pas (plan a été modifié), arrêter la boucle
          if (!nextToolStep) {
            console.log(
              `⏹️ [PHASE-1-ITER-${iterationIdx + 1}] Pas de tool suivant après modification du plan, fin de la boucle`,
            );
            break;
          }

          console.log(
            `🧠 [INTERMEDIATE-THINKING-AFTER-${iterationIdx}] Génération des arguments pour ${nextToolStep.toolName}...`,
          );

          try {
            // 🔥 NEW: Build tool execution history with scores + track search_web queries
            const previousWebQueries = toolCalls
              .filter((tc) => tc.name === "search_web")
              .map((tc) => tc.arguments?.query || "")
              .filter((q) => q.length > 0);

            const executedTools = toolCalls
              .map((tc, idx) => {
                const score = tc.score
                  ? ` (score: ${tc.score.overallScore.toFixed(2)})`
                  : "";
                const args =
                  tc.name === "search_web" && tc.arguments?.query
                    ? ` avec query: "${tc.arguments.query}"`
                    : "";
                return `${idx + 1}. ${tc.name}${score}${args}`;
              })
              .join("\n");
            const remainingTools = validatedToolSequence
              .slice(iterationIdx + 1)
              .map((t) => `- ${t.toolName}`)
              .join("\n");

            // 🎯 FEEDBACK LOOP: Intégrer les recommandations stratégiques dans le prompt
            const strategyRecommendation = `
📊 ÉVALUATION DE LA STRATÉGIE ACTUELLE (basée sur les scores) :
${strategyAdjustment.reasoning}

🎯 RECOMMANDATIONS ADAPTATIVES :
- Explorer d'autres sources ? ${strategyAdjustment.shouldExploreMore ? "✅ OUI" : "❌ NON"}
- Utiliser search_web ? ${strategyAdjustment.shouldUseWeb ? "✅ OUI (priorité: " + strategyAdjustment.priority + ")" : "❌ NON"}
- Arrêter (info suffisante) ? ${strategyAdjustment.shouldStop ? "✅ OUI (confiance: " + strategyAdjustment.confidence.toFixed(2) + ")" : "❌ NON"}
${strategyAdjustment.suggestedTools.length > 0 ? "- Outils suggérés: " + strategyAdjustment.suggestedTools.join(", ") : ""}

⚠️ NOTE: Ces recommandations sont basées sur l'analyse des résultats. Tu peux les suivre ou les adapter selon le contexte de la question.`;

            // 🔥 NEW: Add useWeb flag and web instruction with adaptive priority
            const webInstruction = useWeb
              ? `\n🌐 RECHERCHE WEB ACTIVÉE: ${
                  strategyAdjustment.shouldUseWeb
                    ? `La stratégie recommande FORTEMENT d'utiliser search_web (priorité: ${strategyAdjustment.priority})`
                    : "La recherche web est disponible si nécessaire pour enrichir"
                }`
              : "";

            const intermediateThinkingPrompt = `Tu as reçu des résultats. Analyse-les et détermine la prochaine étape.

${strategyRecommendation}

Avant toute décision, commence par une checklist concise (3-7 points conceptuels) décrivant les étapes à envisager selon les données reçues.

📝 QUESTION ORIGINALE : "${query}"

📋 OUTILS DÉJÀ EXÉCUTÉS :
${executedTools || "Aucun"}

${
  previousWebQueries.length > 0
    ? `
🚨 QUERIES WEB DÉJÀ UTILISÉES (NE PAS RÉPÉTER) :
${previousWebQueries.map((q, i) => `${i + 1}. "${q}"`).join("\n")}

⚠️ IMPORTANT pour le prochain search_web :
Tu DOIS explorer un angle TOTALEMENT DIFFÉRENT. Exemples d'angles alternatifs :
- Si déjà cherché "histoire" → cherche "portfolio companies" ou "funding model"
- Si déjà cherché "overview" → cherche "success stories" ou "application process"
- Si déjà cherché "founders" → cherche "Demo Day" ou "notable alumni"
`
    : ""
}

📋 OUTILS RESTANTS DANS LE PLAN :
${remainingTools || "Aucun"}

⚠️ IMPORTANT - LIRE LES RÉSULTATS RÉELS :
Les résultats précédents sont consignés dans le contexte ci-dessus (résultat de Tool X).
- Si un outil retourne "Aucune source" → C'EST RÉEL, il n'y a pas de sources de ce type !
- Si un outil retourne une liste → COMPTE les sources et sélectionne les MEILLEURES
- N'INVENTE JAMAIS de sources ! Utilise UNIQUEMENT celles listées dans les résultats précédents
- Si AUCUN outil n'a trouvé de sources → Tu DOIS appeler l'outil SUIVANT dans le plan

🧠 STRATÉGIE INTELLIGENTE (PAS STRICTE) :

🎯 **RÈGLE D'OR - OPTIMISATION DES REQUÊTES** :
   → N'utilise JAMAIS directement la question brute de l'utilisateur si elle est mal formulée
   → CORRIGE les fautes ("parle mo ide theoremes" → "théorèmes mathématiques")
   → AMÉLIORE la clarté ("expliquer" → "définition propriétés applications")
   → AJOUTE des mots-clés pertinents pour de meilleurs résultats

1️⃣ SI des sources Wikipedia GLOBALES ont été LISTÉES mais PAS ENCORE LUES :
   → 🎯 SÉLECTIONNE LES MEILLEURES (2-3 max) pertinentes pour la question
   → ❌ N'essaie PAS de tout lire ! (ex : si 1000 sources, choisis les 3 les plus pertinentes)
   → 📖 LIS-LES pour extraire les informations clés avec une query OPTIMISÉE
   → APRÈS la lecture : décide si tu as besoin du web pour compléter

2️⃣ COMMENT CHOISIR LES MEILLEURES SOURCES ?
   - Lis les TITRES des sources listées
   - Sélectionne celles qui CORRESPONDENT LE PLUS à ta question
   - Utilise read_rag_source avec les MEILLEURES IDs (pas tous les IDs !)
   - Exemple pour "parle-moi des théorèmes" :
     ✅ "Théorème de Thalès" (très pertinent)
     ✅ "Théorème de Pythagore" (pertinent)
     ⚠️ "Loi des cosinus" (pertinent mais secondaire - à évaluer)

3️⃣ SI tu as DÉJÀ LU des sources sélectionnées :
   → Évalue si la réponse est SUFFISANTE pour la question
   → ✅ Suffisant ? → shouldContinue: false (l'IA générera la réponse finale)
   → ❌ Incomplet ? → Tu peux compléter OPTIONNELLEMENT avec search_web si le web est activé

4️⃣ PHILOSOPHIE :
   - Les sources locales (Wikipedia globales) = PRIORITÉ (c'est gratuit + rapide)
   - SÉLECTION INTELLIGENTE : Choisis 2-3 sources max, pas tout
   - Le web = POUR ENRICHIR, pas remplacer les sources locales
   - Exemple : Lire les 2 principaux théorèmes dans Wikipedia, puis chercher des cas d'usage modernes sur le web

🌐 STRATÉGIE WEB :
- ${useWeb ? "✅ WEB ACTIVÉ : Tu peux utiliser search_web pour COMPLÉTER les sources existantes" : "❌ WEB DÉSACTIVÉ : Reste uniquement sur les sources locales"}
- search_web ne doit pas être la première option, mais un enrichissement optionnel
- Si les sources locales couvrent la question : pas besoin du web !

🛠️ ARGUMENTS PAR OUTIL :

🎯 **RÈGLE D'OR - OPTIMISATION OBLIGATOIRE DES QUERIES** :
Pour TOUS les outils qui acceptent "query" ou "question", tu DOIS systématiquement améliorer/reformuler la requête utilisateur pour maximiser la pertinence des résultats :
  ✅ Corriger les fautes d'orthographe et de grammaire
  ✅ Rendre les requêtes vagues plus précises et ciblées
  ✅ Ajouter des mots-clés pertinents et contextuels
  ✅ Structurer la query pour optimiser la recherche sémantique
  ✅ Traduire ou clarifier les termes ambigus

Exemples de reformulation :
  ❌ "fait une analyse sur le web sur pythagore"
  ✅ "Théorème de Pythagore: définition, démonstration mathématique et applications"

  ❌ "parle mo ide theoremes"
  ✅ "théorèmes mathématiques fondamentaux géométrie algèbre"

  ❌ "c koi la loi newton"
  ✅ "Lois de Newton mécanique classique physique principes fondamentaux"

Pour list_available_sources :
  - Inclure : "query": "${query}" (REFORMULÉE ET OPTIMISÉE)
  - 🔥 IMPÉRATIF: Reformule TOUJOURS la query utilisateur pour améliorer les résultats de recherche
  - Exemple : {"query": "Théorème de Pythagore applications mathématiques géométrie"}

Pour select_relevant_sources :
  - TOUJOURS inclure : "question": "${query}" (REFORMULÉE ET OPTIMISÉE)
  - TOUJOURS inclure : "availableSources": Tableau d'objets {id, title, sourceType} EXTRATS des résultats précédents
  - 🔥 IMPÉRATIF: Optimise la question pour une meilleure sélection de sources
  - Exemple : {"question": "définition et preuves mathématiques du théorème de Pythagore", "availableSources": [{"id": "123", "title": "...", "sourceType": "WIKIPEDIA"}]}

Pour read_rag_source :
  - Inclure : "sourceId" : L'ID d'une source trouvée
  - Inclure : "query" : Requête de recherche dans la source (string REFORMULÉE)
  - 🔥 IMPÉRATIF: Reformule pour cibler précisément les informations recherchées dans la source
  - Exemple : {"sourceId": "123", "query": "démonstration mathématique et cas d'usage du théorème"}

Pour search_rag_chunks :
  - Inclure : "query": Requête de recherche sémantique (string REFORMULÉE ET OPTIMISÉE)
  - 🔥 IMPÉRATIF: Optimise pour une recherche sémantique vectorielle efficace
  - Inclure optionnellement : "sourceIds": Tableau d'IDs si tu veux chercher dans des sources spécifiques
  - Exemple : {"query": "preuves géométriques triangle rectangle Pythagore", "sourceIds": ["123"]}

Pour search_web :
  - 🔥 ATTENTION: Ce tool prend UNIQUEMENT "query" (string), PAS "question" ni "availableSources" ni "maxResults" !
  - Inclure : "query": "chaîne de recherche web" (string REFORMULÉE ET ENRICHIE)
  - 🔥 IMPÉRATIF: Reformule et enrichis la query avec mots-clés pertinents pour le web
  - 🚨 MULTI-RECHERCHE: Si tu as DÉJÀ appelé search_web, tu DOIS explorer un ANGLE TOTALEMENT DIFFÉRENT
  - 🚨 INTERDICTION: Ne jamais répéter la même query ou des variantes similaires
  - Exemple première recherche : {"query": "Y Combinator startup accelerator history founders"}
  - Exemple deuxième recherche : {"query": "Y Combinator portfolio companies unicorns Airbnb Dropbox Stripe"}
  - Exemple troisième recherche : {"query": "Y Combinator application process Demo Day funding model"}

📊 DÉCISION :
Après chaque appel d'outil ou édition, valide en 1 à 2 lignes l'adéquation du résultat avec l'étape attendue, et décide si une correction est nécessaire ou si tu poursuis la séquence.
Retourne STRICTEMENT un objet JSON ayant la structure suivante (les clés doivent être dans l'ordre exact ci-dessous) :
- "thinking" : Ta réflexion sur les résultats et la prochaine étape (string)
- "shouldContinue" : true ou false (boolean)
- "nextToolName" : Indique le prochain outil si shouldContinue est true (string ou null)
- "toolArguments" : Spécifie les arguments à fournir au prochain outil (objet, structure spécifique selon chaque outil)
- "modifiedToolSequence" (optionnel) : Tableau avec la séquence d'outils modifiée si tu veux changer le plan (array)

🔥 **RÈGLE DE COHÉRENCE CRITIQUE** :
- Si ton "thinking" dit "je vais lire les sources" → "nextToolName" DOIT être "read_rag_source"
- Si ton "thinking" dit "je vais sélectionner" → "nextToolName" DOIT être "select_relevant_sources"
- Si ton "thinking" dit "je vais chercher sur le web" → "nextToolName" DOIT être "search_web"
- **INTERDICTION ABSOLUE** de dire une chose dans thinking et faire autre chose dans nextToolName
- Un Coordinator vérifiera la cohérence et BLOQUERA les incohérences

EXEMPLES DE DÉCISIONS :

Exemple 1 - Wikipedia listée avec select_relevant_sources (AVEC REFORMULATION) :
{
  "thinking": "J'ai trouvé 3 sources Wikipedia. Je reformule 'parle-moi des théorèmes' en 'théorèmes mathématiques fondamentaux définitions et applications' pour une meilleure sélection.",
  "shouldContinue": true,
  "nextToolName": "select_relevant_sources",
  "toolArguments": {
    "question": "théorèmes mathématiques fondamentaux définitions et applications",
    "availableSources": [
      {"id": "id1", "title": "Théorème de Thalès", "sourceType": "WIKIPEDIA"},
      {"id": "id2", "title": "Théorème de Pythagore", "sourceType": "WIKIPEDIA"},
      {"id": "id3", "title": "Loi des cosinus", "sourceType": "WIKIPEDIA"}
    ]
  }
}

Exemple 2 - Wikipedia listée, lire la meilleure (AVEC REFORMULATION) :
{
  "thinking": "J'ai listé les sources. Je lis Pythagore avec une query optimisée pour cibler les informations clés.",
  "shouldContinue": true,
  "nextToolName": "read_rag_source",
  "toolArguments": {"sourceId": "6f9280e9-a4ba-43ae-8372-698efd22fa84", "query": "démonstration mathématique triangle rectangle applications géométriques"}
}

Exemple 3 - Wikipedia lue, info suffisante :
{
  "thinking": "J'ai lu les 2 principaux théorèmes (Thalès et Pythagore). Ils couvrent bien les concepts fondamentaux demandés.",
  "shouldContinue": false,
  "modifiedToolSequence": []
}

Exemple 4 - Wikipedia lue partiellement, veut enrichir avec web (AVEC REFORMULATION ENRICHIE) :
{
  "thinking": "J'ai lu Thalès et Pythagore. Je cherche sur le web avec une query enrichie de mots-clés pour trouver d'autres théorèmes fondamentaux.",
  "shouldContinue": true,
  "nextToolName": "search_web",
  "toolArguments": {"query": "théorèmes mathématiques fondamentaux géométrie algèbre cours démonstrations"}
}

Exemple 5 - Correction d'une requête mal formulée (REFORMULATION OBLIGATOIRE) :
{
  "thinking": "La question 'parle mo ide theoremes' est mal formulée. Je la corrige en 'théorèmes mathématiques fondamentaux' pour une recherche efficace.",
  "shouldContinue": true,
  "nextToolName": "read_rag_source",
  "toolArguments": {"sourceId": "abc-123", "query": "définition propriétés applications théorèmes mathématiques"}
}

## Format de sortie

La réponse doit être STRICTEMENT un objet JSON ayant les clés SUIVANTES, dans cet ordre (toutes sauf modifiedToolSequence sont requises) :
1. "thinking" (string)
2. "shouldContinue" (boolean)
3. "nextToolName" (string ou null)
4. "toolArguments" (objet, type dépendant de l'outil)
5. "modifiedToolSequence" (optionnel, array)

Schéma d'exemple :
{
  "thinking": "<raisonnement>",
  "shouldContinue": true,
  "nextToolName": "<nom_tool>",
  "toolArguments": { ... },
  "modifiedToolSequence": [ ... ]
}

Le champ "toolArguments" doit correspondre à la structure attendue par l'outil (cf. exemples plus haut). Tous les champs, sauf "modifiedToolSequence", sont OBLIGATOIRES dans chaque réponse sauf si shouldContinue vaut false : dans ce cas, "nextToolName" et "toolArguments" peuvent être omis ou nuls. La sortie NE DOIT contenir AUCUN texte hors de l'objet JSON.${webInstruction}`; //

            let intermediateThinkingContent = "";
            const intermediateStream = await openai.chat.completions.create({
              model: "gpt-4o-mini",
              messages: [
                ...initialMessages,
                {
                  role: "user",
                  content: intermediateThinkingPrompt,
                },
              ],
              temperature: 0.3,
              max_tokens: 400,
              stream: true,
              response_format: { type: "json_object" } as any, // 🔥 JSON MODE STRICT
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
            const intermediateParsed = parseJSONFromStream(
              intermediateThinkingContent,
            );
            if (isIntermediateThinkingOutput(intermediateParsed)) {
              // 🔥 NEW: Check if AI wants to modify the plan
              if (
                intermediateParsed.modifiedToolSequence &&
                intermediateParsed.modifiedToolSequence.length > 0
              ) {
                console.log(
                  `🔄 [INTERMEDIATE-THINKING-AFTER-${iterationIdx}] Plan modifié! Nouvelle séquence:`,
                  intermediateParsed.modifiedToolSequence
                    .map((t: any) => t.toolName)
                    .join(" → "),
                );

                // 🎯 COORDINATOR: Valider la modification de plan
                const originalPlanNames = validatedToolSequence
                  .slice(iterationIdx + 1)
                  .map((t) => t.toolName);
                const modifiedPlanNames =
                  intermediateParsed.modifiedToolSequence.map(
                    (t: any) => t.toolName,
                  );
                const lastResult =
                  toolCalls[toolCalls.length - 1]?.result || "";

                const planValidation =
                  await CoordinatorService.validatePlanModification(
                    originalPlanNames,
                    modifiedPlanNames,
                    lastResult,
                    intermediateParsed.thinking,
                  );

                if (!planValidation.isValid) {
                  console.warn(
                    `❌ [COORDINATOR] Modification de plan REFUSÉE: ${planValidation.reasoning}`,
                  );
                  console.log(
                    `🔄 [COORDINATOR] Poursuite avec le plan original`,
                  );
                  // Ne pas modifier le plan, continuer avec le plan original
                } else {
                  console.log(
                    `✅ [COORDINATOR] Modification de plan VALIDÉE: ${planValidation.reasoning}`,
                  );
                  // Remplacer le reste du plan avec le nouveau plan
                  const newSequence = intermediateParsed.modifiedToolSequence;
                  // Supprimer les tools déjà exécutés du nouveau plan
                  for (
                    let i = validatedToolSequence.length - 1;
                    i > iterationIdx;
                    i--
                  ) {
                    validatedToolSequence.pop();
                  }
                  // Ajouter les nouveaux tools
                  for (const newTool of newSequence) {
                    validatedToolSequence.push(newTool);
                  }
                  console.log(
                    `✅ Nouveau nombre total d'itérations: ${validatedToolSequence.length}`,
                  );
                }

                // 🔥 IMPORTANT: Si on a modifié le plan, on doit CONTINUER même si shouldContinue est false
                // Sinon on ne va jamais exécuter le nouveau plan!
              } else if (intermediateParsed.shouldContinue === false) {
                // 🔥 NEW: Check if AI wants to stop the loop (SEULEMENT si pas de modifiedToolSequence)
                console.log(
                  `⏹️ [INTERMEDIATE-THINKING-AFTER-${iterationIdx}] IA a décidé d'arrêter la boucle`,
                );
                intermediateThinkingBlocks.push({
                  iteration: iterationIdx,
                  thinking: intermediateParsed.thinking,
                  toolArguments: {},
                  generatedAt: new Date().toISOString(),
                  nextToolName: "STOP",
                  score: resultScore, // 🆕 Score du résultat du dernier tool
                  strategyAdjustment: strategyAdjustment.reasoning, // 🆕 Raison de l'arrêt
                });
                break; // Arrêter la boucle agentic
              }

              toolArgs = intermediateParsed.toolArguments || {};

              // 🎯 COORDINATOR: Valider la cohérence thinking/action AVANT d'exécuter
              const previousResults = toolCalls.map((tc) => tc.result);
              const coordinatorValidation =
                await CoordinatorService.validateCoherence({
                  thinking: intermediateParsed.thinking,
                  nextToolName: nextToolStep.toolName,
                  toolArguments: toolArgs,
                  previousToolResults: previousResults,
                  originalPlan: validatedToolSequence.map((t) => t.toolName),
                });

              if (!coordinatorValidation.isValid) {
                console.warn(
                  `❌ [COORDINATOR] Incohérence détectée: ${coordinatorValidation.reasoning}`,
                );

                // 🔥 PRIORISATION: Si une correction est disponible, l'appliquer au lieu de bloquer
                if (coordinatorValidation.correctedToolName) {
                  console.log(
                    `🔧 [COORDINATOR] Correction AUTO appliquée (type Cursor): ${nextToolStep.toolName} → ${coordinatorValidation.correctedToolName}`,
                  );

                  // Créer un nouveau step avec le tool corrigé
                  nextToolStep.toolName =
                    coordinatorValidation.correctedToolName;
                  nextToolStep.description = `Correction auto: ${coordinatorValidation.reasoning}`;

                  if (coordinatorValidation.correctedArguments) {
                    toolArgs = coordinatorValidation.correctedArguments;
                    console.log(
                      `🔧 [COORDINATOR] Arguments corrigés:`,
                      toolArgs,
                    );
                  }

                  // 🔥 Si le tool corrigé est read_rag_source, vérifier que query est fourni
                  if (
                    coordinatorValidation.correctedToolName ===
                      "read_rag_source" &&
                    !toolArgs.query
                  ) {
                    toolArgs.query = query; // Utiliser la query originale
                    console.log(
                      `🔧 [COORDINATOR] Query ajoutée pour read_rag_source: ${query}`,
                    );
                  }
                } else if (coordinatorValidation.shouldBlock) {
                  // Bloquer SEULEMENT si aucune correction n'est possible
                  console.error(
                    `🚫 [COORDINATOR] Exécution BLOQUÉE (aucune correction disponible)`,
                  );
                  intermediateThinkingBlocks.push({
                    iteration: iterationIdx,
                    thinking: `[COORDINATOR BLOCK] ${coordinatorValidation.reasoning}`,
                    toolArguments: {},
                    generatedAt: new Date().toISOString(),
                    nextToolName: "BLOCKED",
                    score: resultScore, // 🆕 Score du résultat du dernier tool
                    strategyAdjustment: "Exécution bloquée par le Coordinator", // 🆕 Raison du blocage
                  });
                  break; // Arrêter la boucle
                } else {
                  console.warn(
                    `⚠️ [COORDINATOR] Incohérence détectée mais pas de correction - poursuite`,
                  );
                }
              } else {
                console.log(
                  `✅ [COORDINATOR] Plan cohérent: ${coordinatorValidation.reasoning}`,
                );
              }

              // Sauvegarder le bloc avec l'itération du TOOL ACTUELLEMENT EXÉCUTÉ
              intermediateThinkingBlocks.push({
                iteration: iterationIdx, // 🔥 Itération du tool ACTUEL (après lequel ce thinking est généré)
                thinking: intermediateParsed.thinking,
                toolArguments: toolArgs,
                generatedAt: new Date().toISOString(),
                nextToolName: nextToolStep.toolName, // 🔥 Le PROCHAIN tool
                score: resultScore, // 🆕 Score du résultat du tool actuel
                strategyAdjustment: strategyAdjustment.reasoning, // 🆕 Recommandations de stratégie
              });

              // 🔥 NEW: Ensure select_relevant_sources has required arguments
              if (nextToolStep.toolName === "select_relevant_sources") {
                // Add question if missing
                if (!toolArgs.question) {
                  toolArgs.question = query;
                  console.log(
                    `🔧 [INTERMEDIATE-THINKING] Added missing 'question' to select_relevant_sources`,
                  );
                }

                // Add availableSources if missing
                if (
                  !toolArgs.availableSources ||
                  !Array.isArray(toolArgs.availableSources) ||
                  toolArgs.availableSources.length === 0
                ) {
                  if (extractedSources.length > 0) {
                    toolArgs.availableSources = extractedSources;
                    console.log(
                      `🔧 [INTERMEDIATE-THINKING] Added extracted sources (${extractedSources.length}) to select_relevant_sources`,
                    );
                  } else {
                    console.warn(
                      `⚠️ [INTERMEDIATE-THINKING] No extracted sources available for select_relevant_sources`,
                    );
                  }
                }
              }

              // 🔥 NEW: Ensure search_web has required 'query' argument (string) - NO maxResults (controlled by OpenAI)
              if (nextToolStep.toolName === "search_web") {
                // Validation: search_web needs 'query' (string), not 'question' or 'availableSources' or 'maxResults'
                if (!toolArgs.query || typeof toolArgs.query !== "string") {
                  // If IA provided wrong arguments (like 'question' or 'availableSources'), fix it
                  if (
                    toolArgs.question &&
                    typeof toolArgs.question === "string"
                  ) {
                    toolArgs = { query: toolArgs.question };
                    console.log(
                      `🔧 [INTERMEDIATE-THINKING] Fixed search_web arguments: converted 'question' to 'query'`,
                    );
                  } else {
                    // Fallback: use original query
                    toolArgs = { query };
                    console.log(
                      `🔧 [INTERMEDIATE-THINKING] Fixed search_web arguments: using original query`,
                    );
                  }
                } else {
                  // Clean up any extra fields that don't belong to search_web (including maxResults)
                  toolArgs = { query: toolArgs.query };
                  console.log(
                    `🔧 [INTERMEDIATE-THINKING] Cleaned search_web arguments`,
                  );
                }
              }

              console.log(
                `✅ [INTERMEDIATE-THINKING-AFTER-${iterationIdx}] Arguments extraits:`,
                toolArgs,
              );
            } else {
              console.warn(
                `⚠️ Invalid intermediate thinking format after iteration ${iterationIdx}`,
              );
            }
          } catch (error) {
            console.warn(
              `⚠️ [INTERMEDIATE-THINKING-AFTER-${iterationIdx}] Erreur:`,
              error,
            );
            // Fallback: utiliser la description comme query
            toolArgs = { query: nextToolStep.description };
          }

          await sleep(50);
        }
      }

      console.log(
        `✅ [PHASE-1] Tous les tools exécutés: ${toolCalls.length} total`,
      );

      return {
        toolCalls,
        thinking,
        shouldUseTools: toolCalls.length > 0,
        intermediateThinkingBlocks,
      };
    } catch (error) {
      console.error(`❌ [PHASE-1] Erreur boucle agentic:`, error);
      throw error;
    }
  }
}
