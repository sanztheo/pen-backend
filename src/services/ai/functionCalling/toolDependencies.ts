/**
 * 🎯 TOOL DEPENDENCIES VALIDATOR
 *
 * Module de validation stricte des dépendances entre tools.
 * Principe : un tool ne peut être appelé que si ses prérequis sont satisfaits.
 *
 * Graphe de dépendances :
 *
 * list_global_wikipedia_sources / list_available_sources
 *   ↓
 * select_relevant_sources (DOIT recevoir availableSources du précédent)
 *   ↓
 * read_rag_source (DOIT recevoir sourceId valide du précédent)
 */

export interface ToolExecutionContext {
  executedTools: Array<{
    name: string;
    arguments: any;
    result: string;
  }>;
  extractedSources?: Array<{
    id: string;
    title: string;
    sourceType: string;
  }>;
}

export interface DependencyValidationResult {
  isValid: boolean;
  reasoning: string;
  missingDependencies?: string[];
  suggestedFix?: {
    toolName: string;
    arguments: any;
  };
  shouldBlock: boolean;
}

/**
 * Définition des dépendances entre tools
 */
const TOOL_DEPENDENCIES = {
  // select_relevant_sources DOIT être appelé après un tool de listing
  select_relevant_sources: {
    requiredPrevious: [
      "list_available_sources",
      "list_global_wikipedia_sources",
    ],
    requiredArguments: ["question", "availableSources"],
    argumentSources: {
      availableSources: [
        "list_available_sources",
        "list_global_wikipedia_sources",
      ],
    },
  },

  // read_rag_source DOIT être appelé après avoir des sourceIds valides
  read_rag_source: {
    requiredArguments: ["sourceId", "query"],
    argumentSources: {
      sourceId: [
        "list_available_sources",
        "list_global_wikipedia_sources",
        "select_relevant_sources",
      ],
    },
  },

  // check_sources_rag_status DOIT être appelé avec des sourceIds valides
  check_sources_rag_status: {
    requiredArguments: ["sourceIds"],
    argumentSources: {
      sourceIds: [
        "list_available_sources",
        "list_global_wikipedia_sources",
        "select_relevant_sources",
      ],
    },
  },
};

export class ToolDependenciesValidator {
  /**
   * 🔍 Valide que les dépendances d'un tool sont satisfaites
   */
  static validateDependencies(
    toolName: string,
    toolArguments: any,
    context: ToolExecutionContext,
  ): DependencyValidationResult {
    console.log(`🔍 [DEPENDENCIES] Validation de ${toolName}...`);

    // Si le tool n'a pas de dépendances définies, on accepte
    const dependencies =
      TOOL_DEPENDENCIES[toolName as keyof typeof TOOL_DEPENDENCIES];
    if (!dependencies) {
      return {
        isValid: true,
        reasoning: `${toolName} n'a pas de dépendances définies, validation OK`,
        shouldBlock: false,
      };
    }

    const missingDependencies: string[] = [];

    // RÈGLE 1 : Vérifier que les tools prérequis ont été exécutés
    if ("requiredPrevious" in dependencies && dependencies.requiredPrevious) {
      const hasRequiredPrevious = dependencies.requiredPrevious.some(
        (reqTool: string) =>
          context.executedTools.some((t) => t.name === reqTool),
      );

      if (!hasRequiredPrevious) {
        missingDependencies.push(
          `Aucun tool parmi [${dependencies.requiredPrevious.join(", ")}] n'a été exécuté`,
        );
      }
    }

    // RÈGLE 2 : Vérifier que les arguments requis sont fournis
    if (dependencies.requiredArguments) {
      for (const argName of dependencies.requiredArguments) {
        if (
          !toolArguments ||
          toolArguments[argName] === undefined ||
          toolArguments[argName] === null
        ) {
          missingDependencies.push(`Argument requis "${argName}" manquant`);
        }
      }
    }

    // RÈGLE 3 : Vérifier que les arguments proviennent des bonnes sources
    if (dependencies.argumentSources && toolArguments) {
      for (const [argName] of Object.entries(dependencies.argumentSources)) {
        const argValue = toolArguments[argName];

        // Cas spécial : select_relevant_sources
        if (
          toolName === "select_relevant_sources" &&
          argName === "availableSources"
        ) {
          const validation = this.validateAvailableSources(argValue, context);
          if (!validation.isValid) {
            return validation;
          }
        }

        // Cas spécial : read_rag_source
        if (toolName === "read_rag_source" && argName === "sourceId") {
          const validation = this.validateSourceId(argValue, context);
          if (!validation.isValid) {
            return validation;
          }
        }

        // Cas spécial : check_sources_rag_status
        if (
          toolName === "check_sources_rag_status" &&
          argName === "sourceIds"
        ) {
          const validation = this.validateSourceIds(argValue, context);
          if (!validation.isValid) {
            return validation;
          }
        }
      }
    }

    // Si des dépendances manquent
    if (missingDependencies.length > 0) {
      console.warn(
        `❌ [DEPENDENCIES] ${toolName} a des dépendances manquantes:`,
        missingDependencies,
      );

      return {
        isValid: false,
        reasoning: `Dépendances manquantes pour ${toolName}: ${missingDependencies.join(", ")}`,
        missingDependencies,
        shouldBlock: true,
      };
    }

    console.log(`✅ [DEPENDENCIES] ${toolName} validé`);
    return {
      isValid: true,
      reasoning: `Toutes les dépendances de ${toolName} sont satisfaites`,
      shouldBlock: false,
    };
  }

  /**
   * 🔍 Valide le paramètre availableSources de select_relevant_sources
   */
  private static validateAvailableSources(
    availableSources: any,
    context: ToolExecutionContext,
  ): DependencyValidationResult {
    // RÈGLE : availableSources DOIT être un array non vide
    if (!Array.isArray(availableSources) || availableSources.length === 0) {
      // Essayer de récupérer depuis le contexte
      if (context.extractedSources && context.extractedSources.length > 0) {
        console.log(
          `🔧 [DEPENDENCIES] availableSources vide, correction automatique avec extractedSources`,
        );

        return {
          isValid: true,
          reasoning:
            "availableSources corrigé automatiquement depuis extractedSources",
          suggestedFix: {
            toolName: "select_relevant_sources",
            arguments: {
              availableSources: context.extractedSources,
            },
          },
          shouldBlock: false,
        };
      }

      return {
        isValid: false,
        reasoning:
          "select_relevant_sources requiert availableSources (array non vide). Appeler list_available_sources ou list_global_wikipedia_sources d'abord.",
        missingDependencies: [
          "list_available_sources ou list_global_wikipedia_sources",
        ],
        shouldBlock: true,
      };
    }

    // RÈGLE : Chaque source doit avoir {id, title, sourceType}
    const invalidSources = availableSources.filter(
      (src: any) => !src.id || !src.title || !src.sourceType,
    );

    if (invalidSources.length > 0) {
      return {
        isValid: false,
        reasoning: `${invalidSources.length} sources invalides dans availableSources (doivent avoir id, title, sourceType)`,
        shouldBlock: true,
      };
    }

    return {
      isValid: true,
      reasoning: "availableSources valide",
      shouldBlock: false,
    };
  }

  /**
   * 🔍 Valide le paramètre sourceId de read_rag_source
   */
  private static validateSourceId(
    sourceId: any,
    context: ToolExecutionContext,
  ): DependencyValidationResult {
    // RÈGLE : sourceId DOIT être une string non vide
    if (typeof sourceId !== "string" || sourceId.trim().length === 0) {
      return {
        isValid: false,
        reasoning:
          "read_rag_source requiert sourceId (string non vide). Ne JAMAIS appeler avec un ID vide.",
        shouldBlock: true,
      };
    }

    // RÈGLE ASSOUPLIE : Vérifier sourceId SEULEMENT si extractedSources existe ET a du contenu
    // Si extractedSources est vide, c'est probablement une source pré-sélectionnée par l'utilisateur
    if (context.extractedSources && context.extractedSources.length > 0) {
      const isValidSource = context.extractedSources.some(
        (src) => src.id === sourceId,
      );

      if (!isValidSource) {
        console.warn(
          `⚠️ [DEPENDENCIES] sourceId "${sourceId}" non trouvé dans extractedSources (${context.extractedSources.length} sources)`,
        );
        console.warn(
          `   Sources disponibles: ${context.extractedSources.map((s) => s.id).join(", ")}`,
        );

        // WARNING seulement, pas de blocage strict
        // Le coordinator décidera si c'est critique ou non
        return {
          isValid: false,
          reasoning: `sourceId "${sourceId}" non trouvé dans les sources extraites. Pourrait être une source pré-sélectionnée.`,
          shouldBlock: false, // Ne pas bloquer automatiquement
        };
      }
    }

    return {
      isValid: true,
      reasoning: "sourceId valide",
      shouldBlock: false,
    };
  }

  /**
   * 🔍 Valide le paramètre sourceIds de check_sources_rag_status
   */
  private static validateSourceIds(
    sourceIds: any,
    context: ToolExecutionContext,
  ): DependencyValidationResult {
    // RÈGLE : sourceIds DOIT être un array non vide
    if (!Array.isArray(sourceIds) || sourceIds.length === 0) {
      return {
        isValid: false,
        reasoning:
          "check_sources_rag_status requiert sourceIds (array non vide)",
        shouldBlock: true,
      };
    }

    // RÈGLE : Tous les IDs doivent être des strings non vides
    const invalidIds = sourceIds.filter(
      (id) => typeof id !== "string" || id.trim().length === 0,
    );
    if (invalidIds.length > 0) {
      return {
        isValid: false,
        reasoning: `${invalidIds.length} sourceIds invalides (doivent être des strings non vides)`,
        shouldBlock: true,
      };
    }

    // RÈGLE : Vérifier que les IDs proviennent des sources extraites
    if (context.extractedSources && context.extractedSources.length > 0) {
      const extractedIds = context.extractedSources.map((src) => src.id);
      const unknownIds = sourceIds.filter((id) => !extractedIds.includes(id));

      if (unknownIds.length > 0) {
        console.warn(
          `⚠️ [DEPENDENCIES] ${unknownIds.length} sourceIds inconnus:`,
          unknownIds,
        );

        return {
          isValid: false,
          reasoning: `${unknownIds.length} sourceIds ne correspondent à aucune source listée. IDs inconnus: ${unknownIds.join(", ")}`,
          shouldBlock: true,
        };
      }
    }

    return {
      isValid: true,
      reasoning: "sourceIds valides",
      shouldBlock: false,
    };
  }

  /**
   * 🔍 Détecte le mode à partir de la query et du flag isSearch
   */
  static detectMode(
    query: string,
    isSearch: boolean,
  ): "ask" | "search" | "create_rapide" | "create_profond" {
    const queryLower = query.toLowerCase();

    // Détection de create
    const createKeywords = [
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
    ];
    const isCreate = createKeywords.some((kw) => queryLower.includes(kw));

    if (isCreate) {
      // Détection de profond vs rapide
      const profondKeywords = [
        "détaillé",
        "approfondi",
        "complet",
        "exhaustif",
        "en profondeur",
        "analyse",
      ];
      const isProfond =
        profondKeywords.some((kw) => queryLower.includes(kw)) || isSearch;

      return isProfond ? "create_profond" : "create_rapide";
    }

    // Si pas de create, c'est ask ou search
    return isSearch ? "search" : "ask";
  }

  /**
   * 🔍 Retourne les limites de tools selon le mode
   */
  static getToolLimits(
    mode: "ask" | "search" | "create_rapide" | "create_profond",
  ): {
    minTools: number;
    maxTools: number;
    recommended: number;
  } {
    switch (mode) {
      case "ask":
        return { minTools: 2, maxTools: 8, recommended: 5 };
      case "search":
        return { minTools: 5, maxTools: 15, recommended: 10 };
      case "create_rapide":
        return { minTools: 2, maxTools: 8, recommended: 5 };
      case "create_profond":
        return { minTools: 5, maxTools: 15, recommended: 10 };
    }
  }

  /**
   * 🔍 Valide un plan de tools complet
   */
  static validatePlan(
    toolSequence: Array<{ toolName: string; params?: any }>,
    mode: "ask" | "search" | "create_rapide" | "create_profond",
  ): DependencyValidationResult {
    const limits = this.getToolLimits(mode);

    // RÈGLE 1 : Vérifier le nombre de tools
    if (toolSequence.length < limits.minTools) {
      return {
        isValid: false,
        reasoning: `Mode ${mode} requiert au moins ${limits.minTools} tools, plan en contient ${toolSequence.length}`,
        shouldBlock: true,
      };
    }

    if (toolSequence.length > limits.maxTools) {
      console.warn(
        `⚠️ [DEPENDENCIES] Plan dépasse la limite (${toolSequence.length} > ${limits.maxTools})`,
      );
    }

    // RÈGLE 2 : Vérifier l'ordre des tools (graphe de dépendances)
    const toolNames = toolSequence.map((t) => t.toolName);

    // Si select_relevant_sources est présent, il DOIT être après un listing
    const selectIdx = toolNames.indexOf("select_relevant_sources");
    if (selectIdx !== -1) {
      const hasListingBefore = toolNames
        .slice(0, selectIdx)
        .some(
          (name) =>
            name === "list_available_sources" ||
            name === "list_global_wikipedia_sources",
        );

      if (!hasListingBefore) {
        return {
          isValid: false,
          reasoning:
            "select_relevant_sources DOIT être après list_available_sources ou list_global_wikipedia_sources",
          shouldBlock: true,
        };
      }
    }

    // Si read_rag_source est présent, il DOIT être après un listing ou une sélection
    const readIdx = toolNames.indexOf("read_rag_source");
    if (readIdx !== -1) {
      const hasSourcesBefore = toolNames
        .slice(0, readIdx)
        .some(
          (name) =>
            name === "list_available_sources" ||
            name === "list_global_wikipedia_sources" ||
            name === "select_relevant_sources",
        );

      if (!hasSourcesBefore) {
        return {
          isValid: false,
          reasoning:
            "read_rag_source DOIT être après un tool de listing/sélection de sources",
          shouldBlock: true,
        };
      }
    }

    return {
      isValid: true,
      reasoning: `Plan valide pour mode ${mode} (${toolSequence.length} tools)`,
      shouldBlock: false,
    };
  }
}
