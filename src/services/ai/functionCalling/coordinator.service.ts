/**
 * 🎯 COORDINATOR SERVICE
 * 
 * Inspired by Cursor's architecture:
 * - Valide la cohérence entre thinking et actions
 * - Détecte les incohérences dans le plan
 * - Propose des corrections automatiques
 * - Empêche l'IA de sauter des étapes sans justification
 */

import { AIService } from '../base.js';

export interface CoordinatorInput {
  thinking: string;              // Ce que l'IA dit qu'elle va faire
  nextToolName: string | null;   // Le tool qu'elle veut appeler
  toolArguments: any;             // Les arguments du tool
  previousToolResults: string[];  // Historique des résultats des tools
  originalPlan: string[];         // Plan initial
  modifiedPlan?: string[];        // Plan modifié (si l'IA veut changer)
}

export interface CoordinatorOutput {
  isValid: boolean;               // Le plan est-il cohérent ?
  correctedToolName?: string;     // Tool corrigé si incohérence
  correctedArguments?: any;       // Arguments corrigés
  reasoning: string;              // Explication de la décision
  shouldBlock: boolean;           // Bloquer l'exécution ?
}

export class CoordinatorService {
  /**
   * 🔍 Valide la cohérence entre le thinking et l'action proposée
   */
  static async validateCoherence(input: CoordinatorInput): Promise<CoordinatorOutput> {
    const { thinking, nextToolName, previousToolResults, originalPlan } = input;

    console.log(`🎯 [COORDINATOR] Validation de cohérence...`);
    console.log(`   Thinking: "${thinking.slice(0, 100)}..."`);
    console.log(`   Tool proposé: ${nextToolName}`);

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
      reasoning: 'Plan cohérent avec le thinking',
      shouldBlock: false
    };
  }

  /**
   * 🔍 Détecte les incohérences évidentes (règles heuristiques)
   */
  private static detectIncoherences(thinking: string, nextToolName: string | null): string[] {
    const incoherences: string[] = [];
    const thinkingLower = thinking.toLowerCase();

    // Règle 1: L'IA dit "je vais lire" mais appelle search_web
    if (
      (thinkingLower.includes('je vais lire') || 
       thinkingLower.includes('lire la source') ||
       thinkingLower.includes('lire les sources')) &&
      nextToolName === 'search_web'
    ) {
      incoherences.push(`Thinking dit "lire les sources" mais appelle "search_web"`);
    }

    // Règle 2: L'IA dit "sélectionner" mais saute à autre chose
    if (
      (thinkingLower.includes('sélectionner') || 
       thinkingLower.includes('choisir les sources')) &&
      nextToolName !== 'select_relevant_sources' &&
      nextToolName !== null
    ) {
      incoherences.push(`Thinking dit "sélectionner" mais appelle "${nextToolName}"`);
    }

    // Règle 3: L'IA dit "rechercher sur le web" mais appelle autre chose
    if (
      (thinkingLower.includes('rechercher sur le web') || 
       thinkingLower.includes('chercher sur internet') ||
       thinkingLower.includes('web')) &&
      nextToolName !== 'search_web' &&
      !thinkingLower.includes('pas besoin')
    ) {
      incoherences.push(`Thinking mentionne "web" mais appelle "${nextToolName}"`);
    }

    // Règle 4: L'IA dit avoir trouvé des sources pertinentes mais veut faire search_web
    if (
      (thinkingLower.includes('trouvé') && 
       (thinkingLower.includes('source') || thinkingLower.includes('pertinent'))) &&
      nextToolName === 'search_web' &&
      !thinkingLower.includes('compléter') &&
      !thinkingLower.includes('enrichir')
    ) {
      incoherences.push(`Thinking dit avoir trouvé des sources mais appelle "search_web" sans justification`);
    }

    return incoherences;
  }

  /**
   * 🤖 Appelle l'IA Coordinator pour corriger les incohérences
   */
  private static async callCoordinatorAI(
    input: CoordinatorInput,
    incoherences: string[]
  ): Promise<CoordinatorOutput> {
    const openai = AIService.getOpenAI();

    const coordinatorPrompt = `Tu es un Coordinator IA qui vérifie la cohérence des plans d'action.

**INCOHÉRENCES DÉTECTÉES** :
${incoherences.map((inc, i) => `${i + 1}. ${inc}`).join('\n')}

**THINKING DE L'IA** :
"${input.thinking}"

**ACTION PROPOSÉE** :
Tool: ${input.nextToolName}
Arguments: ${JSON.stringify(input.toolArguments)}

**RÉSULTATS PRÉCÉDENTS** :
${input.previousToolResults.slice(-2).join('\n---\n')}

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
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'Tu es un Coordinator expert qui valide la cohérence des plans IA. Tu retournes UNIQUEMENT du JSON.'
          },
          {
            role: 'user',
            content: coordinatorPrompt
          }
        ],
        temperature: 0.2,
        max_tokens: 300,
        response_format: { type: 'json_object' }
      });

      const content = response.choices[0]?.message?.content || '{}';
      const result = JSON.parse(content) as CoordinatorOutput;

      console.log(`🎯 [COORDINATOR-AI] Décision:`, result);

      return result;
    } catch (error) {
      console.error(`❌ [COORDINATOR-AI] Erreur:`, error);
      
      // Fallback: bloquer par sécurité
      return {
        isValid: false,
        shouldBlock: true,
        reasoning: `Erreur Coordinator: ${error instanceof Error ? error.message : 'Erreur inconnue'}. Blocage par sécurité.`
      };
    }
  }

  /**
   * 🔍 Valide une modification de plan (modifiedToolSequence)
   */
  static async validatePlanModification(
    originalPlan: string[],
    modifiedPlan: string[],
    lastToolResult: string,
    thinking: string
  ): Promise<{ isValid: boolean; reasoning: string }> {
    console.log(`🔄 [COORDINATOR] Validation modification de plan...`);
    console.log(`   Plan original: ${originalPlan.join(' → ')}`);
    console.log(`   Plan modifié: ${modifiedPlan.join(' → ')}`);

    const openai = AIService.getOpenAI();

    const validationPrompt = `Tu es un Coordinator qui valide les modifications de plan.

**PLAN ORIGINAL** : ${originalPlan.join(' → ')}
**PLAN MODIFIÉ** : ${modifiedPlan.join(' → ')}

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
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'Tu es un validateur de cohérence de plans. Retourne UNIQUEMENT du JSON.'
          },
          {
            role: 'user',
            content: validationPrompt
          }
        ],
        temperature: 0.2,
        max_tokens: 200,
        response_format: { type: 'json_object' }
      });

      const content = response.choices[0]?.message?.content || '{}';
      const result = JSON.parse(content);

      console.log(`🔄 [COORDINATOR] Validation modification:`, result);

      return result;
    } catch (error) {
      console.error(`❌ [COORDINATOR] Erreur validation:`, error);
      return {
        isValid: false,
        reasoning: 'Erreur de validation, modification refusée par sécurité'
      };
    }
  }
}
