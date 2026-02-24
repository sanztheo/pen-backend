// assistant/utils/validation.ts - Validation des réponses de l'assistant

// Liste des fonctions valides de l'assistant
const VALID_FUNCTIONS = [
  "generate_graphic",
  "generate_questions_array",
  "generate_subject_with_documents",
  "correct_quiz_standard",
  "correct_quiz_with_graphics",
  "correct_quiz_with_documents",
  "correct_quiz_complete",
];

/**
 * Interface pour un appel de fonction dans la réponse Assistant
 */
interface ToolCallFunction {
  name: string;
  arguments: string;
}

interface ToolCall {
  function?: ToolCallFunction;
}

interface AssistantResponseWithToolCalls {
  tool_calls?: ToolCall[];
}

/**
 * Type guard pour vérifier si l'objet a des tool_calls
 */
function hasToolCalls(response: unknown): response is AssistantResponseWithToolCalls {
  return (
    typeof response === "object" &&
    response !== null &&
    "tool_calls" in response &&
    Array.isArray((response as AssistantResponseWithToolCalls).tool_calls)
  );
}

/**
 * Valide la réponse JSON de l'Assistant
 */
export function validateAssistantResponse(response: unknown): void {
  if (!response) {
    throw new Error("Réponse Assistant vide");
  }

  // Validation basique du format
  if (typeof response === "string") {
    try {
      JSON.parse(response);
    } catch {
      throw new Error("Réponse Assistant n'est pas un JSON valide");
    }
  }

  // Validation des fonctions attendues
  if (hasToolCalls(response) && response.tool_calls) {
    for (const toolCall of response.tool_calls) {
      if (!toolCall.function || !toolCall.function.name) {
        throw new Error("Appel de fonction manquant dans la réponse Assistant");
      }

      // Valider que c'est une de nos 7 fonctions
      if (!VALID_FUNCTIONS.includes(toolCall.function.name)) {
        throw new Error(`Fonction inconnue: ${toolCall.function.name}`);
      }

      // Valider que les arguments sont du JSON
      try {
        JSON.parse(toolCall.function.arguments);
      } catch {
        throw new Error(`Arguments invalides pour ${toolCall.function.name}`);
      }
    }
  }
}

/**
 * Interface pour une réponse contenant des questions
 */
interface ResponseWithQuestions {
  questions: unknown[];
}

/**
 * Type guard pour vérifier si l'objet a des questions
 */
function isResponseWithQuestions(response: unknown): response is ResponseWithQuestions {
  return (
    typeof response === "object" &&
    response !== null &&
    "questions" in response &&
    Array.isArray((response as ResponseWithQuestions).questions)
  );
}

/**
 * Vérifie si une réponse contient des questions valides
 */
export function hasValidQuestions(response: unknown): boolean {
  return isResponseWithQuestions(response) && response.questions.length > 0;
}

/**
 * Interface pour une réponse contenant des corrections
 */
interface ResponseWithCorrections {
  corrections: unknown[];
}

/**
 * Type guard pour vérifier si l'objet a des corrections
 */
function isResponseWithCorrections(response: unknown): response is ResponseWithCorrections {
  return (
    typeof response === "object" &&
    response !== null &&
    "corrections" in response &&
    Array.isArray((response as ResponseWithCorrections).corrections)
  );
}

/**
 * Vérifie si une réponse contient des corrections valides
 */
export function hasValidCorrections(response: unknown): boolean {
  return isResponseWithCorrections(response);
}
