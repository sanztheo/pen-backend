import { LyceeSpecialty } from "../../../services/quiz/types.js";
import {
  getSpecialtyLabel,
  buildSpecialtyDistribution,
  buildTypeDistribution,
  mapSchoolLevelToStudyLevel,
} from "../utils.js";

// ---------------------------------------------------------------------------
// getSpecialtyLabel
// ---------------------------------------------------------------------------
describe("getSpecialtyLabel", () => {
  it("returns the correct French label for a known specialty", () => {
    expect(getSpecialtyLabel(LyceeSpecialty.MATHEMATIQUES)).toBe("Mathématiques");
    expect(getSpecialtyLabel(LyceeSpecialty.PHYSIQUE_CHIMIE)).toBe("Physique-Chimie");
    expect(getSpecialtyLabel(LyceeSpecialty.NSI)).toBe("Numérique et Sciences Informatiques");
  });

  it("returns undefined for undefined input", () => {
    expect(getSpecialtyLabel(undefined)).toBeUndefined();
  });

  it("returns formatted string (underscores replaced with spaces) for unknown specialty", () => {
    const unknown = "SOME_UNKNOWN_SPECIALTY" as LyceeSpecialty;
    expect(getSpecialtyLabel(unknown)).toBe("SOME UNKNOWN SPECIALTY");
  });
});

// ---------------------------------------------------------------------------
// buildSpecialtyDistribution
// ---------------------------------------------------------------------------
describe("buildSpecialtyDistribution", () => {
  it("returns empty array for undefined specialties", () => {
    expect(buildSpecialtyDistribution(undefined, 5)).toEqual([]);
  });

  it("returns empty array for empty specialties array", () => {
    expect(buildSpecialtyDistribution([], 5)).toEqual([]);
  });

  it("returns empty array for zero totalQuestions", () => {
    expect(buildSpecialtyDistribution([LyceeSpecialty.MATHEMATIQUES], 0)).toEqual([]);
  });

  it("returns empty array for negative totalQuestions", () => {
    expect(buildSpecialtyDistribution([LyceeSpecialty.MATHEMATIQUES], -3)).toEqual([]);
  });

  it("distributes evenly across specialties", () => {
    const result = buildSpecialtyDistribution(
      [LyceeSpecialty.MATHEMATIQUES, LyceeSpecialty.PHYSIQUE_CHIMIE],
      4,
    );
    expect(result).toHaveLength(4);
    const mathCount = result.filter((s) => s === LyceeSpecialty.MATHEMATIQUES).length;
    const physCount = result.filter((s) => s === LyceeSpecialty.PHYSIQUE_CHIMIE).length;
    expect(mathCount).toBe(2);
    expect(physCount).toBe(2);
  });

  it("handles remainder correctly — first specialties get extra", () => {
    const result = buildSpecialtyDistribution(
      [LyceeSpecialty.MATHEMATIQUES, LyceeSpecialty.PHYSIQUE_CHIMIE],
      5,
    );
    expect(result).toHaveLength(5);
    const mathCount = result.filter((s) => s === LyceeSpecialty.MATHEMATIQUES).length;
    const physCount = result.filter((s) => s === LyceeSpecialty.PHYSIQUE_CHIMIE).length;
    expect(mathCount).toBe(3);
    expect(physCount).toBe(2);
  });

  it("deduplicates specialties", () => {
    const result = buildSpecialtyDistribution(
      [LyceeSpecialty.MATHEMATIQUES, LyceeSpecialty.MATHEMATIQUES, LyceeSpecialty.PHYSIQUE_CHIMIE],
      4,
    );
    expect(result).toHaveLength(4);
    const mathCount = result.filter((s) => s === LyceeSpecialty.MATHEMATIQUES).length;
    const physCount = result.filter((s) => s === LyceeSpecialty.PHYSIQUE_CHIMIE).length;
    expect(mathCount).toBe(2);
    expect(physCount).toBe(2);
  });

  it("uses round-robin interleaving", () => {
    const result = buildSpecialtyDistribution(
      [LyceeSpecialty.MATHEMATIQUES, LyceeSpecialty.PHYSIQUE_CHIMIE],
      4,
    );
    // Round-robin: MATH, PHYS, MATH, PHYS
    expect(result[0]).toBe(LyceeSpecialty.MATHEMATIQUES);
    expect(result[1]).toBe(LyceeSpecialty.PHYSIQUE_CHIMIE);
    expect(result[2]).toBe(LyceeSpecialty.MATHEMATIQUES);
    expect(result[3]).toBe(LyceeSpecialty.PHYSIQUE_CHIMIE);
  });
});

// ---------------------------------------------------------------------------
// buildTypeDistribution
// ---------------------------------------------------------------------------
describe("buildTypeDistribution", () => {
  it("fills all slots with a single type", () => {
    const result = buildTypeDistribution(["MULTIPLE_CHOICE"], 5);
    expect(result).toHaveLength(5);
    expect(result.every((t) => t === "MULTIPLE_CHOICE")).toBe(true);
  });

  it("distributes multiple types evenly (correct counts despite shuffle)", () => {
    const result = buildTypeDistribution(["MULTIPLE_CHOICE", "TRUE_FALSE"], 6);
    expect(result).toHaveLength(6);
    const mcCount = result.filter((t) => t === "MULTIPLE_CHOICE").length;
    const tfCount = result.filter((t) => t === "TRUE_FALSE").length;
    expect(mcCount).toBe(3);
    expect(tfCount).toBe(3);
  });

  it("handles remainder correctly — first types get extra", () => {
    const result = buildTypeDistribution(["MULTIPLE_CHOICE", "TRUE_FALSE", "OPEN_QUESTION"], 7);
    expect(result).toHaveLength(7);
    const mcCount = result.filter((t) => t === "MULTIPLE_CHOICE").length;
    const tfCount = result.filter((t) => t === "TRUE_FALSE").length;
    const oqCount = result.filter((t) => t === "OPEN_QUESTION").length;
    // 7 / 3 = 2 base + 1 remainder for first type
    expect(mcCount).toBe(3);
    expect(tfCount).toBe(2);
    expect(oqCount).toBe(2);
  });

  it("uses preprocessor distribution when provided (ignores questionTypes)", () => {
    const preprocessor = ["A", "B", "A", "C"];
    const result = buildTypeDistribution(["MULTIPLE_CHOICE"], 10, preprocessor);
    // Should use preprocessor distribution, so length matches preprocessor
    expect(result).toHaveLength(4);
    expect(result.filter((t) => t === "A").length).toBe(2);
    expect(result.filter((t) => t === "B").length).toBe(1);
    expect(result.filter((t) => t === "C").length).toBe(1);
  });

  it("ignores null preprocessor distribution", () => {
    const result = buildTypeDistribution(["MULTIPLE_CHOICE"], 3, null);
    expect(result).toHaveLength(3);
    expect(result.every((t) => t === "MULTIPLE_CHOICE")).toBe(true);
  });

  it("ignores empty preprocessor distribution", () => {
    const result = buildTypeDistribution(["MULTIPLE_CHOICE"], 3, []);
    expect(result).toHaveLength(3);
    expect(result.every((t) => t === "MULTIPLE_CHOICE")).toBe(true);
  });

  it("shuffles the result (total count preserved)", () => {
    // Run multiple times — at least one should differ in order from sorted
    const types = ["A", "B", "C"];
    const sorted = ["A", "A", "B", "B", "C", "C"];
    let sawDifferentOrder = false;

    for (let attempt = 0; attempt < 20; attempt++) {
      const result = buildTypeDistribution(types, 6);
      expect(result).toHaveLength(6);
      expect(result.filter((t) => t === "A").length).toBe(2);
      expect(result.filter((t) => t === "B").length).toBe(2);
      expect(result.filter((t) => t === "C").length).toBe(2);

      if (result.join(",") !== sorted.join(",")) {
        sawDifferentOrder = true;
        break;
      }
    }

    expect(sawDifferentOrder).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mapSchoolLevelToStudyLevel
// ---------------------------------------------------------------------------
describe("mapSchoolLevelToStudyLevel", () => {
  it("maps COLLEGE to College", () => {
    expect(mapSchoolLevelToStudyLevel("COLLEGE")).toBe("College");
  });

  it("maps LYCEE_ prefix to Lycée", () => {
    expect(mapSchoolLevelToStudyLevel("LYCEE_GENERALE")).toBe("Lycée");
    expect(mapSchoolLevelToStudyLevel("LYCEE_TECHNOLOGIQUE")).toBe("Lycée");
    expect(mapSchoolLevelToStudyLevel("LYCEE_PRO")).toBe("Lycée");
  });

  it("maps ETUDES_SUPERIEURES to Université", () => {
    expect(mapSchoolLevelToStudyLevel("ETUDES_SUPERIEURES")).toBe("Université");
  });

  it("defaults unknown values to College", () => {
    expect(mapSchoolLevelToStudyLevel("PRIMAIRE")).toBe("College");
    expect(mapSchoolLevelToStudyLevel("")).toBe("College");
    expect(mapSchoolLevelToStudyLevel("UNKNOWN_LEVEL")).toBe("College");
  });
});
