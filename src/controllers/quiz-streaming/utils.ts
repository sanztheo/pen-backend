import { LyceeSpecialty } from "../../services/quiz/types.js";
import { LYCEE_SPECIALTY_LABELS } from "./constants.js";

/**
 * Returns the French label for a lycee specialty.
 * Falls back to replacing underscores with spaces for unknown specialties.
 */
export function getSpecialtyLabel(specialty: LyceeSpecialty | undefined): string | undefined {
  if (!specialty) {
    return undefined;
  }

  return LYCEE_SPECIALTY_LABELS[specialty] || specialty.replace(/_/g, " ");
}

/**
 * Distributes specialties evenly across questions using round-robin interleaving.
 * First specialties in the list receive the remainder slots.
 */
export function buildSpecialtyDistribution(
  specialties: LyceeSpecialty[] | undefined,
  totalQuestions: number,
): LyceeSpecialty[] {
  if (!specialties || specialties.length === 0 || totalQuestions <= 0) {
    return [];
  }

  const uniqueSpecialties = Array.from(new Set(specialties));
  if (uniqueSpecialties.length === 0) {
    return [];
  }

  const baseCount = Math.floor(totalQuestions / uniqueSpecialties.length);
  const remainder = totalQuestions % uniqueSpecialties.length;
  const counts = uniqueSpecialties.map((_, index) => baseCount + (index < remainder ? 1 : 0));

  const distribution: LyceeSpecialty[] = [];
  let pointer = 0;

  while (distribution.length < totalQuestions) {
    const index = pointer % uniqueSpecialties.length;
    if (counts[index] > 0) {
      distribution.push(uniqueSpecialties[index]);
      counts[index] -= 1;
    }
    pointer += 1;
  }

  return distribution;
}

/**
 * Builds a type distribution for quiz questions.
 * Uses preprocessor distribution if provided, otherwise distributes types evenly.
 * Applies Fisher-Yates shuffle for non-predictable order.
 */
export function buildTypeDistribution(
  questionTypes: string[],
  questionCount: number,
  preprocessorDistribution?: string[] | null,
): string[] {
  let typeDistribution: string[] = [];

  if (preprocessorDistribution && preprocessorDistribution.length > 0) {
    typeDistribution = [...preprocessorDistribution];
  } else if (questionTypes.length === 1) {
    for (let i = 0; i < questionCount; i++) {
      typeDistribution.push(questionTypes[0]);
    }
  } else {
    const basePerType = Math.floor(questionCount / questionTypes.length);
    const remainder = questionCount % questionTypes.length;

    questionTypes.forEach((type: string, typeIndex: number) => {
      const countForThisType = basePerType + (typeIndex < remainder ? 1 : 0);
      for (let i = 0; i < countForThisType; i++) {
        typeDistribution.push(type);
      }
    });
  }

  // Fisher-Yates shuffle
  for (let i = typeDistribution.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [typeDistribution[i], typeDistribution[j]] = [typeDistribution[j], typeDistribution[i]];
  }

  return typeDistribution;
}

/**
 * Maps school level identifiers to human-readable study level labels.
 */
export function mapSchoolLevelToStudyLevel(schoolLevel: string): string {
  if (schoolLevel === "COLLEGE") return "College";
  if (schoolLevel.startsWith("LYCEE_")) return "Lycée";
  if (schoolLevel === "ETUDES_SUPERIEURES") return "Université";
  return "College";
}
