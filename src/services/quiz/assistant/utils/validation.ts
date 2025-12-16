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
 * Valide la réponse JSON de l'Assistant
 */
export function validateAssistantResponse(response: any): void {
  if (!response) {
    throw new Error("Réponse Assistant vide");
  }

  // Validation basique du format
  if (typeof response === "string") {
    try {
      JSON.parse(response);
    } catch (error) {
      throw new Error("Réponse Assistant n'est pas un JSON valide");
    }
  }

  // Validation des fonctions attendues
  if (response.tool_calls && Array.isArray(response.tool_calls)) {
    for (const toolCall of response.tool_calls) {
      if (!toolCall.function || !toolCall.function.name) {
        throw new Error(
          "Appel de fonction manquant dans la réponse Assistant",
        );
      }

      // Valider que c'est une de nos 7 fonctions
      if (!VALID_FUNCTIONS.includes(toolCall.function.name)) {
        throw new Error(`Fonction inconnue: ${toolCall.function.name}`);
      }

      // Valider que les arguments sont du JSON
      try {
        JSON.parse(toolCall.function.arguments);
      } catch (error) {
        throw new Error(`Arguments invalides pour ${toolCall.function.name}`);
      }
    }
  }
}

/**
 * Vérifie si une réponse contient des questions valides
 */
export function hasValidQuestions(response: any): boolean {
  return (
    response &&
    response.questions &&
    Array.isArray(response.questions) &&
    response.questions.length > 0
  );
}

/**
 * Vérifie si une réponse contient des corrections valides
 */
export function hasValidCorrections(response: any): boolean {
  return (
    response &&
    response.corrections &&
    Array.isArray(response.corrections)
  );
}
