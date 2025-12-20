/**
 * 🧠 Quiz Intelligence - Types pour l'extraction de concepts
 * PEN-15: Types pour le système d'extraction automatique
 */

// Résultat de l'extraction AI
export interface ExtractedConcepts {
  keywords: string[];
  definitions: Record<string, string>; // {term: definition}
  keyPoints: string[];
  formulas: string[];
  topic: string;
  summary: string;
}

// Niveaux de difficulté
export type Difficulty = "easy" | "medium" | "hard";

// Statistiques du contenu
export interface ContentStats {
  wordCount: number;
  conceptCount: number;
  hasFormulas: boolean;
  hasDefinitions: boolean;
}

// Options d'extraction
export interface ExtractionOptions {
  forceRefresh?: boolean; // Force la ré-extraction même si déjà existant
  generateEmbedding?: boolean; // Générer l'embedding (défaut: true)
  skipAI?: boolean; // Extraction basique sans AI (pour tests)
}

// Résultat complet de l'extraction
export interface ExtractionResult {
  success: boolean;
  pageId: string;
  concepts: ExtractedConcepts | null;
  embedding: number[] | null;
  difficulty: Difficulty;
  stats: ContentStats;
  extractedAt: Date;
  processingTimeMs: number;
  error?: string;
}

// Prompt config pour l'extraction (XML format - professional standard)
export const EXTRACTION_PROMPT = `<system>
<role>Educational content analyzer specialized in concept extraction</role>
<task>Extract key concepts from educational content and return structured JSON</task>
</system>

<instructions>
<output_format>JSON only, no surrounding text</output_format>
<fields>
  <field name="keywords" type="string[]" count="5-10">Important keywords summarizing the content</field>
  <field name="definitions" type="object" max="5">Key terms with their definitions as {term: definition}</field>
  <field name="keyPoints" type="string[]" count="3-7">Key takeaways as short sentences</field>
  <field name="formulas" type="string[]">Mathematical or scientific formulas in LaTeX WITHOUT $ delimiters</field>
  <field name="topic" type="string" max_words="3">Main topic/theme</field>
  <field name="summary" type="string" max_sentences="3">Brief summary of the content</field>
</fields>
</instructions>

<rules>
<rule>Return ONLY valid JSON, no markdown or explanations</rule>
<rule>Use empty arrays/objects for missing categories</rule>
<rule>Formulas must be raw LaTeX without $ or $$ delimiters</rule>
<rule>Preserve the original language of the content</rule>
</rules>

<example>
<input>Document about photosynthesis...</input>
<output>
{
  "keywords": ["photosynthesis", "chlorophyll", "glucose", "carbon dioxide"],
  "definitions": {"photosynthesis": "Process by which plants convert light energy..."},
  "keyPoints": ["Light is essential for the process", "CO2 is absorbed through stomata"],
  "formulas": ["6CO_2 + 6H_2O \\to C_6H_{12}O_6 + 6O_2"],
  "topic": "Plant biology",
  "summary": "This document explains the photosynthesis process..."
}
</output>
</example>`;

// Modèle à utiliser pour l'extraction
export const EXTRACTION_MODEL = "gpt-4o-mini";

// Dimension des embeddings OpenAI
export const EMBEDDING_DIMENSION = 1536;
