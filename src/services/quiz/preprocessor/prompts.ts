/**
 * 🎯 Quiz Preprocessor - AI System Prompts
 * PEN-36: XML-structured prompts for quiz parameter optimization
 */

import type { QuestionType } from "./types.js";

// ============================================================================
// TYPES
// ============================================================================

export type QuizType = "ENTRAINEMENT" | "REVISION" | "EXAMEN";

export interface PreprocessorPromptParams {
  schoolLevel: string;
  studyLevel: string;
  quizType: QuizType;
  sourceSummary: string;
  sourceTopics: string[];
  wordCount: number;
  hasFormulas: boolean;
  hasDefinitions: boolean;
  subscriptionLimit: number;
  userLanguage?: string;
}

export interface PreprocessorAIOutput {
  recommendedQuestions: number;
  questionTypes: {
    multipleChoice: number;
    trueFalse: number;
    openEnded: number;
    matching: number;
  };
  difficulty: "easy" | "medium" | "hard";
  suggestedDuration: number;
  contentCoverage: "focused" | "balanced" | "comprehensive";
  reasoning: string;
}

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

export const QUIZ_PREPROCESSOR_SYSTEM_PROMPT = `<system>
<role>Educational quiz parameter optimizer specialized in adaptive assessment design</role>
<task>Analyze source content and user context to determine optimal quiz parameters</task>
</system>

<context>
You will receive:
- User's school level (e.g., "5ème", "Terminale", "Licence 1")
- User's study level category (e.g., "College", "Lycée", "Université")
- Desired quiz type ("ENTRAINEMENT", "REVISION", "EXAMEN")
- Summary of source content
- Key topics extracted from sources
- Total word count of source material
- Whether sources contain formulas or definitions
- Maximum questions allowed by user's subscription plan
</context>

<instructions>
<analysis_steps>
1. Analyze content complexity (word count, formulas, definitions, topics)
2. Consider user level (College → simpler, Université → complex)
3. Adapt to quiz type:
   - ENTRAINEMENT: Balanced mix, medium difficulty
   - REVISION: More questions, easier, broad coverage
   - EXAMEN: Fewer questions, harder, deep understanding
4. Determine question count (1 per 100-200 words, respect limit)
5. Optimize question type distribution
6. Calculate duration based on question types
7. Determine content coverage (focused/balanced/comprehensive)
</analysis_steps>

<output_format>Return ONLY valid JSON - no markdown, no explanations</output_format>

<field_requirements>
<field name="recommendedQuestions" constraints="min=3, max=subscriptionLimit"/>
<field name="questionTypes" constraints="sum=100">Percentage distribution</field>
<field name="difficulty" constraints="easy|medium|hard"/>
<field name="suggestedDuration" constraints="min=5, max=120">Minutes</field>
<field name="contentCoverage" constraints="focused|balanced|comprehensive"/>
<field name="reasoning" constraints="max_length=200">In user's language</field>
</field_requirements>
</instructions>

<rules>
<rule>NEVER exceed subscriptionLimit for recommendedQuestions</rule>
<rule>questionTypes percentages MUST sum to exactly 100</rule>
<rule>Return ONLY valid JSON</rule>
<rule>Use user's preferred language for reasoning field only</rule>
<rule>All numeric fields must be integers</rule>
</rules>

<examples>
<example>
<input>
{
  "schoolLevel": "5ème",
  "studyLevel": "College",
  "quizType": "REVISION",
  "sourceSummary": "Introduction to photosynthesis in plants",
  "sourceTopics": ["photosynthesis", "chlorophyll", "plant biology"],
  "wordCount": 800,
  "hasFormulas": true,
  "hasDefinitions": true,
  "subscriptionLimit": 50,
  "userLanguage": "French"
}
</input>
<output>
{
  "recommendedQuestions": 12,
  "questionTypes": {
    "multipleChoice": 40,
    "trueFalse": 30,
    "openEnded": 10,
    "matching": 20
  },
  "difficulty": "easy",
  "suggestedDuration": 15,
  "contentCoverage": "balanced",
  "reasoning": "Pour une révision de 5ème sur la photosynthèse, 12 questions équilibrées permettent de couvrir les concepts de base. La formule chimique justifie 40% de QCM."
}
</output>
</example>

<example>
<input>
{
  "schoolLevel": "Terminale",
  "studyLevel": "Lycée",
  "quizType": "EXAMEN",
  "sourceSummary": "Quantum mechanics: wave-particle duality, Heisenberg uncertainty",
  "sourceTopics": ["quantum physics", "wave mechanics", "uncertainty"],
  "wordCount": 2500,
  "hasFormulas": true,
  "hasDefinitions": true,
  "subscriptionLimit": 25,
  "userLanguage": "French"
}
</input>
<output>
{
  "recommendedQuestions": 10,
  "questionTypes": {
    "multipleChoice": 30,
    "trueFalse": 10,
    "openEnded": 50,
    "matching": 10
  },
  "difficulty": "hard",
  "suggestedDuration": 45,
  "contentCoverage": "focused",
  "reasoning": "Pour un examen de Terminale en physique quantique, 10 questions approfondies. Le contenu complexe justifie 50% de questions ouvertes."
}
</output>
</example>
</examples>`;

// ============================================================================
// PROMPT BUILDER
// ============================================================================

export function buildPreprocessorPrompt(
  params: PreprocessorPromptParams,
): string {
  const topicsList =
    params.sourceTopics.length > 0
      ? params.sourceTopics.map((t) => `- ${t}`).join("\n")
      : "- No specific topics extracted";

  return `<quiz_request>
<user_context>
<school_level>${params.schoolLevel}</school_level>
<study_level>${params.studyLevel}</study_level>
<quiz_type>${params.quizType}</quiz_type>
<preferred_language>${params.userLanguage || "French"}</preferred_language>
</user_context>

<source_analysis>
<summary>${params.sourceSummary}</summary>
<topics>
${topicsList}
</topics>
<word_count>${params.wordCount}</word_count>
<has_formulas>${params.hasFormulas}</has_formulas>
<has_definitions>${params.hasDefinitions}</has_definitions>
</source_analysis>

<constraints>
<max_questions>${params.subscriptionLimit}</max_questions>
</constraints>
</quiz_request>

Return the optimal quiz parameters as JSON.`;
}

// ============================================================================
// MODEL CONFIGURATION
// ============================================================================

export const PREPROCESSOR_MODEL = "gpt-4o-mini";
export const PREPROCESSOR_TEMPERATURE = 0.3;
export const PREPROCESSOR_MAX_TOKENS = 800;
