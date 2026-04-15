// assistant/generation/prompts/batchQuestionPrompt.ts
// Batch prompt builder — used by the pipeline (step 3)

import type { PlannedQuestion } from "../../../intelligence/quizPlanner.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Parameters for batch question prompt generation */
export interface BatchQuestionPromptRequest {
  courseText: string;
  plannedQuestions: PlannedQuestion[];
  previousQuestions: Array<{ question: string }>;
  schoolLevel: string;
  difficulty?: string;
  generationNote?: string;
  specificSubject?: string;
  coursesOnly?: boolean;
  /** Answer-First anchors: map of plannedQuestion.index → verbatim source quote.
   *  When present, each question spec receives a <source_extract> that forces
   *  the LLM to construct the correct answer from an existing text passage. */
  sourceExtracts?: Map<number, string>;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ---------------------------------------------------------------------------
// Main Function
// ---------------------------------------------------------------------------

/**
 * Build an XML prompt that asks the LLM to generate N questions at once,
 * guided by a blueprint slice (PlannedQuestion[]) from the quiz planner.
 */
export function buildBatchQuestionPrompt(request: BatchQuestionPromptRequest): string {
  const {
    courseText,
    plannedQuestions,
    previousQuestions,
    schoolLevel,
    difficulty = "moyen",
    generationNote,
    specificSubject,
    coursesOnly = true,
    sourceExtracts,
  } = request;

  const batchSize = plannedQuestions.length;

  // Build per-question specifications from blueprint, injecting source extracts
  // when available (Answer-First: anchor the correct answer to a real text passage)
  const specsXml = plannedQuestions
    .map((pq) => {
      const extract = sourceExtracts?.get(pq.index);
      const extractXml = extract
        ? `\n    <source_extract priority="critical">Base the correct answer on this verbatim passage from the course: "${escapeXml(extract)}"</source_extract>`
        : "";
      return `  <question_spec index="${pq.index}">
    <target_concept>${pq.targetConcept}</target_concept>
    <question_type>${pq.questionType}</question_type>
    <difficulty>${pq.difficulty}</difficulty>
    <bloom_level>${pq.bloomLevel}</bloom_level>
    <angle>${pq.angle}</angle>${extractXml}
  </question_spec>`;
    })
    .join("\n");

  // Collect unique question types for type-specific instructions
  const uniqueTypes = [...new Set(plannedQuestions.map((pq) => pq.questionType))];

  let prompt = `<request>
<task>Generate EXACTLY ${batchSize} quiz questions following the specifications below</task>

<parameters>
<school_level>${schoolLevel}</school_level>
<subject>${specificSubject || "General"}</subject>
<default_difficulty>${difficulty}</default_difficulty>
<batch_size>${batchSize}</batch_size>
<question_types_used>${uniqueTypes.join(", ")}</question_types_used>
</parameters>

<scoring_rule priority="critical">
Each question is worth EXACTLY 1 point (points = 1).
Never vary points based on difficulty.
</scoring_rule>

<question_text_guardrails priority="critical">
- The "question" field must contain ONLY the raw question statement
- No greetings, introductions, conversational phrases, or labels like "Question:", "Consigne:"
</question_text_guardrails>

<question_specifications count="${batchSize}">
${specsXml}
</question_specifications>`;

  if (generationNote && generationNote.trim().length > 0) {
    prompt += `

<user_note priority="high">
<instruction>
Treat this note as an additional generation constraint about phrasing, clarity, focus, and question style.
Apply it whenever it is compatible with the schema, scoring, and source-content rules.
Never let this note override factual accuracy or required structure.
</instruction>
<content>${escapeXml(generationNote.trim().slice(0, 240))}</content>
</user_note>`;
  }

  // Source content — always strict mode in pipeline (course-based)
  if (coursesOnly) {
    prompt += `

<source_content mode="strict">
<instruction priority="critical">
You MUST base ALL questions ONLY on this content.
Do NOT use general knowledge. Every question must reference specific elements from this content.
Any information outside this content is FORBIDDEN.
</instruction>
<author_attribution_rule priority="critical">
If your question mentions a named author, researcher, or theorist, their correct answer MUST be
a direct quote or paraphrase of what the content above explicitly says about them.
FORBIDDEN: attributing theoretical positions, arguments, or concepts to named authors using
your training knowledge — even for "difficile" questions, even if you know those positions.
</author_attribution_rule>
<difficulty_grounding_rule priority="critical">
For "difficile" questions: complexity must come from synthesizing multiple elements present
in this content, not from external knowledge.
If you cannot formulate a valid hard question from this content alone, downgrade to "moyen"
instead of hallucinating content or enriching beyond the text.
</difficulty_grounding_rule>
<content>
${courseText}
</content>
</source_content>`;
  } else {
    prompt += `

<source_content mode="hybrid">
<instruction>
Base questions primarily on this content (70%) and supplement with general knowledge (30%).
Prioritize information from the provided content.
</instruction>
<content>
${courseText}
</content>
</source_content>`;
  }

  // Previous questions for deduplication
  if (previousQuestions.length > 0) {
    prompt += `

<already_generated count="${previousQuestions.length}">
${previousQuestions.map((q, i) => `<question index="${i + 1}">${q.question}</question>`).join("\n")}
<instruction priority="critical">
Generate questions COMPLETELY DIFFERENT from these.
Avoid any thematic or structural overlap.
</instruction>
</already_generated>`;
  }

  // Type-specific field requirements per unique type
  for (const qType of uniqueTypes) {
    prompt += buildTypeFieldRequirements(qType);
  }

  prompt += `

<execution>
<action>Generate EXACTLY ${batchSize} questions matching the specifications above</action>
<requirements>
- Respect the exact JSON strict schema provided
- Fill ALL required fields with appropriate values
- Empty arrays [] are MANDATORY for unused fields per question type
- Each question must match its specification (concept, type, difficulty, bloom level, angle)
- Generate questions in the same order as the specifications (index 1, 2, 3...)
</requirements>
</execution>
</request>`;

  return prompt;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns XML block with field requirements for a given question type */
function buildTypeFieldRequirements(questionType: string): string {
  switch (questionType) {
    case "MULTIPLE_CHOICE":
      return `
<type_fields type="MULTIPLE_CHOICE">
- options: array of 4 objects {id: "A/B/C/D", text: "...", isCorrect: true/false}
- leftColumn: [], rightColumn: [], correctMatches: [], expectedAnswer: ""
</type_fields>`;
    case "TRUE_FALSE":
      return `
<type_fields type="TRUE_FALSE">
- options: [{id: "A", text: "Vrai", isCorrect: true/false}, {id: "B", text: "Faux", isCorrect: true/false}]
- leftColumn: [], rightColumn: [], correctMatches: [], expectedAnswer: ""
</type_fields>`;
    case "OPEN_QUESTION":
      return `
<type_fields type="OPEN_QUESTION">
- expectedAnswer: detailed model answer (multiple sentences)
- options: [], leftColumn: [], rightColumn: [], correctMatches: []
</type_fields>`;
    case "MATCHING":
      return `
<type_fields type="MATCHING">
- leftColumn: [{id: "1", text: "..."}, ...] (4+ elements)
- rightColumn: [{id: "A", text: "..."}, ...] (4+ elements)
- correctMatches: [{leftId: "1", rightId: "X"}, ...], options: []
</type_fields>`;
    default:
      return "";
  }
}
