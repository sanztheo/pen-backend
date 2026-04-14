import { describe, expect, it } from "@jest/globals";
import { buildBatchQuestionPrompt } from "../questionPrompt.js";

describe("buildBatchQuestionPrompt", () => {
  it("injects the user note as an explicit generation constraint", () => {
    const prompt = buildBatchQuestionPrompt({
      courseText: "Le theoreme de Pythagore relie les longueurs des cotes d'un triangle rectangle.",
      plannedQuestions: [
        {
          index: 1,
          targetConcept: "Théorème de Pythagore",
          questionType: "MULTIPLE_CHOICE",
          difficulty: "facile",
          bloomLevel: "recall",
          angle: "Ask for the direct statement of the theorem",
        },
      ],
      previousQuestions: [],
      schoolLevel: "LYCEE_TERMINALE",
      specificSubject: "Mathématiques",
      coursesOnly: true,
      generationNote: "Je veux des questions plus courtes",
    } as Parameters<typeof buildBatchQuestionPrompt>[0]);

    expect(prompt).toContain("<user_note");
    expect(prompt).toContain("Je veux des questions plus courtes");
    expect(prompt).toContain("Treat this note as an additional generation constraint");
  });
});
