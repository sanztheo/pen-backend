/**
 * 🎯 COORDINATOR SERVICE
 *
 * Inspired by Cursor's architecture:
 * - Valide la cohérence entre thinking et actions
 * - Détecte les incohérences dans le plan
 * - Propose des corrections automatiques
 * - Empêche l'IA de sauter des étapes sans justification
 * - 🆕 Valide les dépendances entre tools (graphe strict)
 */

import { AIService } from "../base.js";
import { ScoringService } from "./scoring.service.js";
import {
  ToolDependenciesValidator,
  type ToolExecutionContext,
  type DependencyValidationResult,
} from "./toolDependencies.js";

export interface CoordinatorInput {
  thinking: string; // Ce que l'IA dit qu'elle va faire
  nextToolName: string | null; // Le tool qu'elle veut appeler
  toolArguments: any; // Les arguments du tool
  previousToolResults: string[]; // Historique des résultats des tools
  originalPlan: string[]; // Plan initial
  modifiedPlan?: string[]; // Plan modifié (si l'IA veut changer)
  executionContext?: ToolExecutionContext; // 🆕 Contexte d'exécution avec extractedSources
}

export interface CoordinatorOutput {
  isValid: boolean; // Le plan est-il cohérent ?
  correctedToolName?: string; // Tool corrigé si incohérence
  correctedArguments?: any; // Arguments corrigés
  reasoning: string; // Explication de la décision
  shouldBlock: boolean; // Bloquer l'exécution ?
}

export class CoordinatorService {
  /**
   * 🔍 Valide la cohérence entre le thinking et l'action proposée
   */
  static async validateCoherence(
    input: CoordinatorInput,
  ): Promise<CoordinatorOutput> {
    const {
      thinking,
      nextToolName,
      previousToolResults,
      originalPlan,
      toolArguments,
    } = input;

    console.log(`🎯 [COORDINATOR] Validation de cohérence...`);
    console.log(`   Thinking: "${thinking.slice(0, 100)}..."`);
    console.log(`   Tool proposé: ${nextToolName}`);

    // 🆕 ÉTAPE 0 : Valider les DÉPENDANCES entre tools (mode WARNING, pas BLOCKING)
    // Inspiré de Cursor: le coordinator GUIDE, il ne BLOQUE pas systématiquement
    if (nextToolName) {
      const depValidation = await this.validateToolDependencies(
        nextToolName,
        toolArguments || {},
        input,
      );

      if (!depValidation.isValid) {
        console.warn(
          `⚠️ [COORDINATOR] Dépendances suspectes: ${depValidation.reasoning}`,
        );

        // Ne bloquer QUE si c'est une erreur CRITIQUE (pas juste une validation heuristique)
        const isCriticalError =
          depValidation.reasoning.includes("DOIT être appelé") ||
          depValidation.reasoning.includes("aucune source listée") ||
          depValidation.reasoning.includes("CRITIQUE");

        if (isCriticalError && depValidation.shouldBlock) {
          console.error(
            `❌ [COORDINATOR] Erreur CRITIQUE détectée, blocage nécessaire`,
          );
          return {
            isValid: false,
            reasoning: depValidation.reasoning,
            shouldBlock: true,
            correctedArguments: depValidation.suggestedFix?.arguments,
          };
        }

        // Sinon, WARNING seulement (laisser passer mais logger)
        console.log(
          `⚠️ [COORDINATOR] Validation faible mais on continue (coordinator guide, ne bloque pas)`,
        );
      }
    }

    // 🔥 DÉTECTION D'INCOHÉRENCES ÉVIDENTES
    const incoherences = this.detectIncoherences(thinking, nextToolName);

    if (incoherences.length > 0) {
      console.warn(`⚠️ [COORDINATOR] Incohérences détectées:`, incoherences);

      // Appeler l'IA Coordinator pour corriger
      return await this.callCoordinatorAI(input, incoherences);
    }

    // Tout est cohérent
    console.log(`✅ [COORDINATOR] Plan cohérent, validation OK`);
    return {
      isValid: true,
      reasoning: "Plan cohérent avec le thinking",
      shouldBlock: false,
    };
  }

  /**
   * 🔍 Détecte les incohérences évidentes (règles heuristiques)
   */
  private static detectIncoherences(
    thinking: string,
    nextToolName: string | null,
  ): string[] {
    const incoherences: string[] = [];
    const thinkingLower = thinking.toLowerCase();

    // Règle 1: L'IA dit "je vais lire" mais appelle search_web
    if (
      (thinkingLower.includes("je vais lire") ||
        thinkingLower.includes("lire la source") ||
        thinkingLower.includes("lire les sources")) &&
      nextToolName === "search_web"
    ) {
      incoherences.push(
        `Thinking dit "lire les sources" mais appelle "search_web"`,
      );
    }

    // Règle 2: L'IA dit "sélectionner" mais saute à autre chose
    if (
      (thinkingLower.includes("sélectionner") ||
        thinkingLower.includes("choisir les sources")) &&
      nextToolName !== "select_relevant_sources" &&
      nextToolName !== null
    ) {
      incoherences.push(
        `Thinking dit "sélectionner" mais appelle "${nextToolName}"`,
      );
    }

    // Règle 3: L'IA dit "rechercher sur le web" mais appelle autre chose
    if (
      (thinkingLower.includes("rechercher sur le web") ||
        thinkingLower.includes("chercher sur internet") ||
        thinkingLower.includes("web")) &&
      nextToolName !== "search_web" &&
      !thinkingLower.includes("pas besoin")
    ) {
      incoherences.push(
        `Thinking mentionne "web" mais appelle "${nextToolName}"`,
      );
    }

    // Règle 4: L'IA dit avoir trouvé des sources pertinentes mais veut faire search_web
    if (
      thinkingLower.includes("trouvé") &&
      (thinkingLower.includes("source") ||
        thinkingLower.includes("pertinent")) &&
      nextToolName === "search_web" &&
      !thinkingLower.includes("compléter") &&
      !thinkingLower.includes("enrichir")
    ) {
      incoherences.push(
        `Thinking dit avoir trouvé des sources mais appelle "search_web" sans justification`,
      );
    }

    return incoherences;
  }

  /**
   * 🤖 Appelle l'IA Coordinator pour corriger les incohérences
   */
  private static async callCoordinatorAI(
    input: CoordinatorInput,
    incoherences: string[],
  ): Promise<CoordinatorOutput> {
    const openai = AIService.getOpenAI();

    const coordinatorPrompt = `Tu es un Coordinator IA qui vérifie la cohérence des plans d'action.

**INCOHÉRENCES DÉTECTÉES** :
${incoherences.map((inc, i) => `${i + 1}. ${inc}`).join("\n")}

**THINKING DE L'IA** :
"${input.thinking}"

**ACTION PROPOSÉE** :
Tool: ${input.nextToolName}
Arguments: ${JSON.stringify(input.toolArguments)}

**RÉSULTATS PRÉCÉDENTS** :
${input.previousToolResults.slice(-2).join("\n---\n")}

**TA MISSION** :
Analyse l'incohérence et décide :
1. Si l'IA doit CONTINUER avec son plan actuel (justifié)
2. Si l'IA doit être CORRIGÉE (incohérence évidente)

**RÈGLES** :
- Si thinking dit "lire 3 sources" → le prochain tool DOIT être read_rag_source
- Si thinking dit "sélectionner" → le prochain tool DOIT être select_relevant_sources
- Si thinking dit "web" → OK pour search_web
- Si thinking et action sont INCOHÉRENTS → propose une CORRECTION

**RÉPONSE (JSON STRICT)** :
{
  "isValid": boolean,
  "correctedToolName": "nom_tool_corrigé" ou null,
  "correctedArguments": {} ou null,
  "reasoning": "explication courte",
  "shouldBlock": boolean (true SEULEMENT si aucune correction possible)
}

**IMPORTANT** :
- Si tu peux corriger le tool → shouldBlock = false (on appliquera la correction)
- Si aucune correction possible → shouldBlock = true (blocage)`;

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o", // Intelligent model for coherence validation
        messages: [
          {
            role: "system",
            content:
              "You are an expert AI coordinator that validates plan coherence. Return ONLY valid JSON without decorative symbols.",
          },
          {
            role: "user",
            content: coordinatorPrompt,
          },
        ],
        temperature: 0.1, // Very low temperature for consistent validation
        max_tokens: 400, // Increased for detailed reasoning
        response_format: { type: "json_object" },
      });

      const content = response.choices[0]?.message?.content || "{}";
      const result = JSON.parse(content) as CoordinatorOutput;

      console.log(`🎯 [COORDINATOR-AI] Décision:`, result);

      return result;
    } catch (error) {
      console.error(`❌ [COORDINATOR-AI] Erreur:`, error);

      // Fallback: bloquer par sécurité
      return {
        isValid: false,
        shouldBlock: true,
        reasoning: `Erreur Coordinator: ${error instanceof Error ? error.message : "Erreur inconnue"}. Blocage par sécurité.`,
      };
    }
  }

  /**
   * 🎯 Enrichit la validation avec les scores et recommandations de stratégie
   *
   * Cette méthode intègre le feedback loop "observe → adjust → continue"
   * en utilisant les scores pour détecter des patterns problématiques
   */
  static async enrichValidationWithScores(
    input: CoordinatorInput,
    averageScore: number,
    strategyRecommendation: string,
  ): Promise<{ shouldWarn: boolean; warningMessage?: string }> {
    // Si le score moyen est très faible (<0.3), avertir
    if (averageScore < 0.3) {
      return {
        shouldWarn: true,
        warningMessage: `Score moyen très faible (${averageScore.toFixed(2)}). Les résultats précédents sont insuffisants. ${strategyRecommendation}`,
      };
    }

    // Si le score moyen est moyen (<0.6) et que l'IA veut arrêter
    if (averageScore < 0.6 && input.nextToolName === null) {
      return {
        shouldWarn: true,
        warningMessage: `Score moyen moyen (${averageScore.toFixed(2)}). L'IA veut arrêter mais les résultats sont partiels. Recommandation: continuer l'exploration.`,
      };
    }

    // Si le score moyen est bon (>0.7), tout va bien
    if (averageScore > 0.7) {
      return {
        shouldWarn: false,
      };
    }

    return {
      shouldWarn: false,
    };
  }

  /**
   * 🔍 Valide une modification de plan (modifiedToolSequence)
   */
  static async validatePlanModification(
    originalPlan: string[],
    modifiedPlan: string[],
    lastToolResult: string,
    thinking: string,
  ): Promise<{ isValid: boolean; reasoning: string }> {
    console.log(`🔄 [COORDINATOR] Validation modification de plan...`);
    console.log(`   Plan original: ${originalPlan.join(" → ")}`);
    console.log(`   Plan modifié: ${modifiedPlan.join(" → ")}`);

    const openai = AIService.getOpenAI();

    const validationPrompt = `Tu es un Coordinator qui valide les modifications de plan.

**PLAN ORIGINAL** : ${originalPlan.join(" → ")}
**PLAN MODIFIÉ** : ${modifiedPlan.join(" → ")}

**DERNIER RÉSULTAT** :
${lastToolResult.slice(0, 500)}

**THINKING** :
"${thinking}"

**QUESTION** :
La modification de plan est-elle justifiée par le résultat précédent ?

**RÈGLES** :
- Si le résultat indique "aucune source" → OK pour modifier vers search_web
- Si le résultat contient des sources pertinentes → PAS OK de sauter vers search_web sans les lire
- Si l'IA change de plan sans raison liée au résultat → REFUSER

**RÉPONSE (JSON)** :
{
  "isValid": boolean,
  "reasoning": "explication courte"
}`;

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o", // Intelligent model for plan modification validation
        messages: [
          {
            role: "system",
            content:
              "You are an expert plan coherence validator. Return ONLY valid JSON without decorative symbols.",
          },
          {
            role: "user",
            content: validationPrompt,
          },
        ],
        temperature: 0.1, // Very low temperature for consistent validation
        max_tokens: 300, // Increased for detailed reasoning
        response_format: { type: "json_object" },
      });

      const content = response.choices[0]?.message?.content || "{}";
      const result = JSON.parse(content);

      console.log(`🔄 [COORDINATOR] Validation modification:`, result);

      return result;
    } catch (error) {
      console.error(`❌ [COORDINATOR] Erreur validation:`, error);
      return {
        isValid: false,
        reasoning: "Erreur de validation, modification refusée par sécurité",
      };
    }
  }

  /**
   * 🆕 Valide les dépendances d'un tool via ToolDependenciesValidator
   */
  private static async validateToolDependencies(
    toolName: string,
    toolArguments: any,
    input: CoordinatorInput,
  ): Promise<DependencyValidationResult> {
    // Utiliser le contexte d'exécution fourni, sinon créer un contexte vide
    const executionContext: ToolExecutionContext = input.executionContext || {
      executedTools: [],
      extractedSources: [],
    };

    return ToolDependenciesValidator.validateDependencies(
      toolName,
      toolArguments,
      executionContext,
    );
  }

  /**
   * 🆕 Valide un plan complet de tools
   */
  static validateFullPlan(
    toolSequence: Array<{ toolName: string; params?: any }>,
    mode: "ask" | "search" | "create_rapide" | "create_profond",
  ): DependencyValidationResult {
    console.log(
      `🎯 [COORDINATOR] Validation du plan complet (mode: ${mode})...`,
    );

    const validation = ToolDependenciesValidator.validatePlan(
      toolSequence,
      mode,
    );

    if (!validation.isValid) {
      console.error(`❌ [COORDINATOR] Plan invalide: ${validation.reasoning}`);
    } else {
      console.log(`✅ [COORDINATOR] Plan valide: ${validation.reasoning}`);
    }

    return validation;
  }
}
