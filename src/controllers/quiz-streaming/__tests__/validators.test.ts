import { validateGenerateParams, validateCorrectionParams } from "../validators.js";

// ---------------------------------------------------------------------------
// validateGenerateParams
// ---------------------------------------------------------------------------
describe("validateGenerateParams", () => {
  const validBody = {
    schoolLevel: "COLLEGE",
    questionTypes: ["MULTIPLE_CHOICE"],
    questionCount: 10,
  };

  it("returns valid for correct params", () => {
    const result = validateGenerateParams(validBody);
    expect(result).toEqual({ valid: true });
  });

  it("returns valid with all question types", () => {
    const result = validateGenerateParams({
      ...validBody,
      questionTypes: ["MULTIPLE_CHOICE", "TRUE_FALSE", "OPEN_QUESTION", "MATCHING"],
    });
    expect(result).toEqual({ valid: true });
  });

  it("returns valid with all school levels", () => {
    for (const level of [
      "COLLEGE",
      "LYCEE_SECONDE",
      "LYCEE_PREMIERE",
      "LYCEE_TERMINALE",
      "ETUDES_SUPERIEURES",
    ]) {
      const result = validateGenerateParams({ ...validBody, schoolLevel: level });
      expect(result.valid).toBe(true);
    }
  });

  it("rejects missing schoolLevel", () => {
    const { schoolLevel: _, ...body } = validBody;
    const result = validateGenerateParams(body);
    expect(result.valid).toBe(false);
    expect(result.error).toBe(
      "Paramètres manquants: schoolLevel, questionTypes et questionCount sont requis",
    );
  });

  it("rejects missing questionTypes", () => {
    const { questionTypes: _, ...body } = validBody;
    const result = validateGenerateParams(body);
    expect(result.valid).toBe(false);
    expect(result.error).toBe(
      "Paramètres manquants: schoolLevel, questionTypes et questionCount sont requis",
    );
  });

  it("rejects missing questionCount", () => {
    const { questionCount: _, ...body } = validBody;
    const result = validateGenerateParams(body);
    expect(result.valid).toBe(false);
    expect(result.error).toBe(
      "Paramètres manquants: schoolLevel, questionTypes et questionCount sont requis",
    );
  });

  it("rejects invalid schoolLevel", () => {
    const result = validateGenerateParams({ ...validBody, schoolLevel: "PRIMAIRE" });
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Niveau scolaire invalide");
  });

  it("rejects non-string schoolLevel", () => {
    const result = validateGenerateParams({ ...validBody, schoolLevel: 123 });
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Niveau scolaire invalide");
  });

  it("rejects non-array questionTypes", () => {
    const result = validateGenerateParams({ ...validBody, questionTypes: "MULTIPLE_CHOICE" });
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Types de questions invalides");
  });

  it("rejects empty questionTypes array", () => {
    const result = validateGenerateParams({ ...validBody, questionTypes: [] });
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Types de questions invalides");
  });

  it("rejects invalid question type values", () => {
    const result = validateGenerateParams({ ...validBody, questionTypes: ["INVALID_TYPE"] });
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Types de questions invalides");
  });

  it("rejects mixed valid and invalid question types", () => {
    const result = validateGenerateParams({
      ...validBody,
      questionTypes: ["MULTIPLE_CHOICE", "INVALID"],
    });
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Types de questions invalides");
  });

  it("rejects questionCount of 0", () => {
    const result = validateGenerateParams({ ...validBody, questionCount: 0 });
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Le nombre de questions doit être entre 1 et 100");
  });

  it("rejects questionCount of 101", () => {
    const result = validateGenerateParams({ ...validBody, questionCount: 101 });
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Le nombre de questions doit être entre 1 et 100");
  });

  it("rejects negative questionCount", () => {
    const result = validateGenerateParams({ ...validBody, questionCount: -5 });
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Le nombre de questions doit être entre 1 et 100");
  });

  it("rejects non-number questionCount", () => {
    const result = validateGenerateParams({ ...validBody, questionCount: "10" });
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Le nombre de questions doit être entre 1 et 100");
  });

  it("accepts boundary questionCount of 1", () => {
    const result = validateGenerateParams({ ...validBody, questionCount: 1 });
    expect(result.valid).toBe(true);
  });

  it("accepts boundary questionCount of 100", () => {
    const result = validateGenerateParams({ ...validBody, questionCount: 100 });
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateCorrectionParams
// ---------------------------------------------------------------------------
describe("validateCorrectionParams", () => {
  const validBody = {
    quizId: "quiz-123",
    answers: [{ questionId: "q1", answer: "some answer" }],
  };

  it("returns valid for correct params", () => {
    const result = validateCorrectionParams(validBody);
    expect(result).toEqual({ valid: true });
  });

  it("returns valid with empty answers array", () => {
    const result = validateCorrectionParams({ quizId: "quiz-123", answers: [] });
    expect(result).toEqual({ valid: true });
  });

  it("rejects missing quizId", () => {
    const result = validateCorrectionParams({ answers: [] });
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Paramètre manquant: quizId requis");
  });

  it("rejects empty string quizId", () => {
    const result = validateCorrectionParams({ quizId: "", answers: [] });
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Paramètre manquant: quizId requis");
  });

  it("rejects non-array answers", () => {
    const result = validateCorrectionParams({ quizId: "quiz-123", answers: "not-array" });
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Paramètres manquants: quizId et answers requis");
  });

  it("rejects missing answers", () => {
    const result = validateCorrectionParams({ quizId: "quiz-123" });
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Paramètres manquants: quizId et answers requis");
  });

  it("rejects null answers", () => {
    const result = validateCorrectionParams({ quizId: "quiz-123", answers: null });
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Paramètres manquants: quizId et answers requis");
  });
});
