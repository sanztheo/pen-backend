import { SchoolLevel, QuestionType } from "../../services/quiz/types.js";

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

const SCHOOL_LEVELS = new Set<string>(Object.values(SchoolLevel));
const QUESTION_TYPES = new Set<string>(Object.values(QuestionType));

export function validateGenerateParams(body: Record<string, unknown>): ValidationResult {
  const { schoolLevel, questionTypes, questionCount } = body;

  // 1. Required fields
  if (!schoolLevel || !questionTypes || questionCount === undefined || questionCount === null) {
    return {
      valid: false,
      error: "Paramètres manquants: schoolLevel, questionTypes et questionCount sont requis",
    };
  }

  // 2. Valid SchoolLevel enum
  if (typeof schoolLevel !== "string" || !SCHOOL_LEVELS.has(schoolLevel)) {
    return { valid: false, error: "Niveau scolaire invalide" };
  }

  // 3. questionTypes must be a non-empty array of valid QuestionType values
  if (
    !Array.isArray(questionTypes) ||
    questionTypes.length === 0 ||
    !questionTypes.every((t: unknown) => typeof t === "string" && QUESTION_TYPES.has(t))
  ) {
    return { valid: false, error: "Types de questions invalides" };
  }

  // 4. questionCount between 1 and 100
  if (typeof questionCount !== "number" || questionCount < 1 || questionCount > 100) {
    return { valid: false, error: "Le nombre de questions doit être entre 1 et 100" };
  }

  // 5. subject: optional string, max 500 chars, strip newlines
  const { subject } = body;
  if (subject !== undefined && subject !== null) {
    if (typeof subject !== "string") {
      return { valid: false, error: "Le sujet doit être une chaîne de caractères" };
    }
    const trimmed = subject.replace(/[\r\n]/g, " ").trim();
    if (trimmed.length > 500) {
      return { valid: false, error: "Le sujet ne doit pas dépasser 500 caractères" };
    }
  }

  return { valid: true };
}

export function validateCorrectionParams(body: Record<string, unknown>): ValidationResult {
  const { quizId, answers } = body;

  // 1. quizId required
  if (!quizId) {
    return { valid: false, error: "Paramètre manquant: quizId requis" };
  }

  // 2. answers must be an array
  if (!Array.isArray(answers)) {
    return { valid: false, error: "Paramètres manquants: quizId et answers requis" };
  }

  return { valid: true };
}
