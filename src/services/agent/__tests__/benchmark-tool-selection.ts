/**
 * Benchmark: AI Tool Selection — Observe & Analyze
 *
 * Sends realistic user scenarios to the AI with the real system prompt + all tools.
 * Writes a detailed .md report with: thinking, tool calls, args, text response.
 * No hardcoded expected values — a human/LLM judge analyzes the report.
 *
 * Reports saved to: docs/plans/benchmarks/bench-{timestamp}-{model}.md
 *
 * Run all models:  npx tsx src/services/agent/__tests__/benchmark-tool-selection.ts
 * Single model:    npx tsx ... --model=gpt-5.4-nano --reasoning=high
 */

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { buildSystemPrompt } from "../systemPrompts.js";

// =====================================================
// Configuration
// =====================================================

const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

if (!GEMINI_KEY && !OPENAI_KEY) {
  console.error("ERROR: Set GEMINI_API_KEY or OPENAI_API_KEY to run this benchmark.");
  process.exit(1);
}

const googleProvider = GEMINI_KEY ? createGoogleGenerativeAI({ apiKey: GEMINI_KEY }) : undefined;
const openaiProvider = OPENAI_KEY ? createOpenAI({ apiKey: OPENAI_KEY }) : undefined;

const cliModel = process.argv.find((a) => a.startsWith("--model="))?.split("=")[1];
const cliReasoning = process.argv.find((a) => a.startsWith("--reasoning="))?.split("=")[1];

const BENCH_DIR = join(process.cwd(), "..", "docs", "plans", "benchmarks");

interface ModelConfig {
  id: string;
  label: string;
  provider: ReturnType<typeof createGoogleGenerativeAI> | ReturnType<typeof createOpenAI>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  providerOptions?: any;
}

function buildModelConfigs(): ModelConfig[] {
  if (cliModel) {
    const isOpenAI = cliModel.startsWith("gpt-") || cliModel.startsWith("o");
    const prov = isOpenAI ? openaiProvider : googleProvider;
    if (!prov) {
      console.error(`No API key for ${cliModel}`);
      process.exit(1);
    }
    return [
      {
        id: cliModel,
        label: cliReasoning ? `${cliModel} (${cliReasoning})` : cliModel,
        provider: prov,
        providerOptions:
          cliReasoning && isOpenAI
            ? { openai: { reasoning: { effort: cliReasoning } } }
            : undefined,
      },
    ];
  }
  const configs: ModelConfig[] = [];
  if (googleProvider)
    configs.push({
      id: "gemini-3-flash-preview",
      label: "gemini-3-flash-preview",
      provider: googleProvider,
    });
  if (openaiProvider)
    configs.push({
      id: "gpt-5.4-nano",
      label: "gpt-5.4-nano (high)",
      provider: openaiProvider,
      providerOptions: { openai: { reasoning: { effort: "high" } } },
    });
  return configs;
}

// =====================================================
// Mock tools — all 22
// =====================================================

const PID = "00000000-0000-0000-0000-000000000001";
const PAGE_CONTENT = `# Les Guerres Puniques

## Introduction

Les guerres puniques sont une série de trois conflits entre Rome et Carthage.

## Première Guerre Punique (264-241 av. J.-C.)

La première guerre punique débute en 264 av. J.-C. lorsque Rome intervient en Sicile. Le conflit dure 23 ans et se termine par la victoire de Rome.

## Deuxième Guerre Punique (218-201 av. J.-C.)

Hannibal Barca traverse les Alpes avec ses éléphants en 218 av. J.-C. Il remporte plusieurs batailles mais ne parvient pas à prendre Rome.

## Conclusion

Les guerres puniques ont transformé Rome en puissance méditerranéenne.`;

const allTools = {
  listAvailableSources: tool({
    description: "Lists all available RAG sources.",
    inputSchema: z.object({ workspaceId: z.string().optional() }),
    execute: async () => ({ success: true, sources: [] }),
  }),
  searchRagChunks: tool({
    description: "Semantic search across indexed RAG sources.",
    inputSchema: z.object({ query: z.string(), sourceIds: z.array(z.string()).optional() }),
    execute: async () => ({ success: true, chunks: [] }),
  }),
  readRagSource: tool({
    description: "Retrieves all chunks from a specific RAG source.",
    inputSchema: z.object({ sourceId: z.string() }),
    execute: async () => ({ success: true, sections: [] }),
  }),
  checkSourcesRagStatus: tool({
    description: "Checks whether sources are indexed for RAG.",
    inputSchema: z.object({ sourceIds: z.array(z.string()) }),
    execute: async () => ({ success: true, statuses: [] }),
  }),
  listWorkspacePages: tool({
    description: "Lists pages in the workspace.",
    inputSchema: z.object({}),
    execute: async () => ({
      success: true,
      pages: [
        { id: PID, title: "Les Guerres Puniques" },
        { id: "page-2", title: "La Révolution Française" },
      ],
    }),
  }),
  getPageOutline: tool({
    description:
      "Returns the outline (headings, structure) of a workspace page. Call this first, then use readPageSection to read specific sections.",
    inputSchema: z.object({ pageId: z.string() }),
    execute: async () => ({
      success: true,
      pageId: PID,
      title: "Les Guerres Puniques",
      outline: [
        { heading: "Introduction", level: 1 },
        { heading: "Première guerre punique", level: 2 },
      ],
    }),
  }),
  readPageSection: tool({
    description:
      "Reads the content of a specific section of a workspace page as markdown. Call getPageOutline first to see available sections.",
    inputSchema: z.object({ pageId: z.string(), sectionHeading: z.string().optional() }),
    execute: async () => ({
      success: true,
      pageId: PID,
      title: "Les Guerres Puniques",
      content: PAGE_CONTENT,
    }),
  }),
  searchPageContent: tool({
    description: "Search for text within a workspace page. Returns matching sections with context.",
    inputSchema: z.object({ pageId: z.string(), query: z.string() }),
    execute: async () => ({
      success: true,
      pageId: PID,
      matches: [{ heading: "Introduction", snippet: "Les guerres puniques..." }],
    }),
  }),
  listWorkspaceProjects: tool({
    description: "Lists projects (folders) in the workspace.",
    inputSchema: z.object({}),
    execute: async () => ({
      success: true,
      projects: [{ id: "proj-1", name: "Histoire", pageCount: 5 }],
    }),
  }),
  searchWeb: tool({
    description: "Searches the web for current information.",
    inputSchema: z.object({ query: z.string() }),
    execute: async () => ({
      success: true,
      results: [{ title: "Result", url: "https://example.com", snippet: "Relevant info..." }],
    }),
  }),
  searchWikipedia: tool({
    description: "Searches Wikipedia articles.",
    inputSchema: z.object({ query: z.string() }),
    execute: async () => ({
      success: true,
      results: [{ pageid: 123, title: "Punic Wars", snippet: "The Punic Wars were..." }],
    }),
  }),
  getWikipediaArticle: tool({
    description: "Retrieves full content of a Wikipedia article.",
    inputSchema: z.object({ title: z.string().optional(), pageid: z.number().optional() }),
    execute: async () => ({
      success: true,
      title: "Punic Wars",
      content: "The Punic Wars were a series of three wars...",
    }),
  }),
  createPage: tool({
    description: "Creates a new page in the workspace with content.",
    inputSchema: z.object({ title: z.string(), content: z.string().optional() }),
    execute: async () => ({ success: true, pageId: "new-page-id" }),
  }),
  checkPageExists: tool({
    description: "Checks if a page exists.",
    inputSchema: z.object({ pageId: z.string() }),
    execute: async () => ({ success: true, exists: true }),
  }),
  getQuizStats: tool({
    description: "Retrieves quiz performance statistics.",
    inputSchema: z.object({}),
    execute: async () => ({
      success: true,
      totalQuizzes: 10,
      averageScore: 75,
      weakTopics: ["Carthage", "Chronologie"],
    }),
  }),
  getRecentQuizResults: tool({
    description: "Retrieves recent quiz results.",
    inputSchema: z.object({ limit: z.number().optional() }),
    execute: async () => ({ success: true, results: [{ subject: "Histoire", score: 80 }] }),
  }),
  editPageContent: tool({
    description: `Replace a specific piece of text in a page. This is the default tool for targeted changes — a few words, a sentence, or a paragraph.

Precondition: call getPageOutline then readPageSection first, then call this tool immediately. Do not search the web or Wikipedia before editing.

When to use:
- "corrige X par Y", "change X to Y", "remplace X par Y" → this tool
- "corrige les fautes", "fix the typos" → this tool (call multiple times if needed)
- "supprime cette phrase" → this tool with empty newText
- Small, targeted changes: a few words to a paragraph

When NOT to use:
- "complète", "ajoute", "continue", "add" → use insertInPage instead
- "traduis toute la page" → use rewritePageContent instead
- "refais l'introduction" → use replacePageSection instead
- If the user wants NEW content added, not existing text changed → use insertInPage

Copy oldText EXACTLY from readPageSection output — do not paraphrase or approximate.`,
    inputSchema: z.object({ pageId: z.string(), oldText: z.string(), newText: z.string() }),
    execute: async () => ({ success: true, pageId: PID }),
  }),
  insertInPage: tool({
    description: `Add new content to a page without removing or replacing anything. This is the right tool whenever the user wants to add, complete, continue, or expand a page. Existing page content stays untouched.

Precondition: call getPageOutline then readPageSection first, then call this tool immediately. Do not search the web or Wikipedia before editing.

When to use — this is the default for adding content:
- "complète cette page", "complete this page" → this tool with position "end"
- "ajoute un paragraphe", "add a section" → this tool
- "continue", "expand", "développe" → this tool
- "ajoute après [heading]" → this tool with afterHeading
- Any request to ADD new content without replacing existing text → this tool

When NOT to use:
- Replacing existing text (use editPageContent)
- Rewriting a section (use replacePageSection)
- Rewriting the entire page (use rewritePageContent)

Supports positions: 'start', 'end', or { afterHeading: 'Section Title' }. Use getPageOutline to see existing headings when using afterHeading.`,
    inputSchema: z.object({
      pageId: z.string(),
      content: z.string(),
      position: z.union([
        z.literal("start"),
        z.literal("end"),
        z.object({ afterHeading: z.string() }),
      ]),
    }),
    execute: async () => ({ success: true, pageId: PID }),
  }),
  replacePageSection: tool({
    description: `Replace everything under a specific heading in a page. Finds the heading (case-insensitive), replaces all blocks between it and the next same-or-higher-level heading. The heading itself is preserved.

Precondition: call getPageOutline then readPageSection first, then call this tool immediately. Do not search the web or Wikipedia before editing.

When to use:
- "refais l'introduction", "rewrite the conclusion" → this tool
- "traduis cette section", "translate this section" → this tool
- Replacing outdated content under a specific heading

When NOT to use:
- Changing a few words or sentences (use editPageContent)
- Rewriting the entire page (use rewritePageContent)
- Adding new content without replacing existing text (use insertInPage)
- "corrige les fautes" (targeted fixes → use editPageContent)`,
    inputSchema: z.object({
      pageId: z.string(),
      sectionHeading: z.string(),
      newContent: z.string(),
    }),
    execute: async () => ({ success: true, pageId: PID }),
  }),
  rewritePageContent: tool({
    description: `Replace the entire content of a page. All existing content is permanently lost. Only use this when the user explicitly asks for a full page rewrite or full page translation.

Precondition: call getPageOutline then readPageSection first, then call this tool immediately. Do not search the web or Wikipedia before editing.

When to use (only these cases):
- "traduis toute la page", "translate the entire page"
- "refais TOUT", "rewrite the whole page from scratch"
- The user explicitly says "rewrite everything" or "recommence tout"

When NOT to use:
- "complète", "ajoute", "continue", "add" → use insertInPage
- "corrige", "fix", "change X to Y" → use editPageContent
- "refais la conclusion" (one section → use replacePageSection)
- "améliore cette page" (vague → use editPageContent or replacePageSection on specific parts)
- If unsure which tool to use → do not use this tool. Choose editPageContent or insertInPage instead.

This is the most destructive editing tool. Prefer smaller-scope alternatives.`,
    inputSchema: z.object({ pageId: z.string(), content: z.string() }),
    execute: async () => ({ success: true, pageId: PID }),
  }),
};

// =====================================================
// Scenarios
// =====================================================

interface Scenario {
  name: string;
  category: string;
  userMessage: string;
  intent: string;
}

const SCENARIOS: Scenario[] = [
  // EDIT
  {
    category: "EDIT",
    name: "Fix typo FR",
    userMessage: `Corrige "débute en 264" par "commence en 264" dans ma page ${PID}`,
    intent: "Replace exact text in page",
  },
  {
    category: "EDIT",
    name: "Change word",
    userMessage: `Dans ma page ${PID}, remplace "éléphants" par "éléphants de guerre"`,
    intent: "Replace exact word",
  },
  {
    category: "EDIT",
    name: "Fix grammar EN",
    userMessage: `Fix the sentence about Hannibal in page ${PID} — it should say "crossed the Alps"`,
    intent: "Edit specific sentence",
  },
  {
    category: "EDIT",
    name: "Corrige fautes",
    userMessage: `Corrige les fautes d'orthographe dans ma page ${PID}`,
    intent: "Find and fix spelling errors",
  },
  {
    category: "EDIT",
    name: "Delete sentence",
    userMessage: `Supprime la phrase "Le conflit dure 23 ans" de ma page ${PID}`,
    intent: "Remove specific text",
  },
  // INSERT
  {
    category: "INSERT",
    name: "Complète section",
    userMessage: `Complète ma page ${PID} avec une section sur la Troisième Guerre Punique`,
    intent: "Add new section without replacing",
  },
  {
    category: "INSERT",
    name: "Ajoute biblio",
    userMessage: `Ajoute une bibliographie à la fin de ma page ${PID}`,
    intent: "Append at end",
  },
  {
    category: "INSERT",
    name: "Continue writing",
    userMessage: `Continue d'écrire ma page ${PID}, il manque la troisième guerre`,
    intent: "Add missing content",
  },
  {
    category: "INSERT",
    name: "Expand section",
    userMessage: `Développe la partie sur Hannibal dans ma page ${PID}, ajoute plus de détails après cette section`,
    intent: "Add more after existing section",
  },
  {
    category: "INSERT",
    name: "Add at start",
    userMessage: `Ajoute un résumé au début de ma page ${PID}`,
    intent: "Prepend content",
  },
  {
    category: "INSERT",
    name: "Complète simple",
    userMessage: `Complète ma page ${PID}`,
    intent: "Add missing content",
  },
  // SECTION
  {
    category: "SECTION",
    name: "Rewrite intro",
    userMessage: `Refais l'introduction de ma page ${PID}, elle est trop courte`,
    intent: "Replace introduction section",
  },
  {
    category: "SECTION",
    name: "Redo specific section",
    userMessage: `Réécris la section "Deuxième Guerre Punique" dans ma page ${PID}`,
    intent: "Replace named section",
  },
  {
    category: "SECTION",
    name: "Replace conclusion",
    userMessage: `La conclusion de ma page ${PID} est nulle, refais-la complètement`,
    intent: "Replace conclusion section",
  },
  {
    category: "SECTION",
    name: "Translate one section",
    userMessage: `Traduis seulement l'introduction de ma page ${PID} en anglais`,
    intent: "Translate one section only",
  },
  // REWRITE
  {
    category: "REWRITE",
    name: "Translate full page",
    userMessage: `Traduis toute ma page ${PID} en anglais`,
    intent: "Full page translation",
  },
  {
    category: "REWRITE",
    name: "Full rewrite FR",
    userMessage: `Réécris entièrement ma page ${PID}, je veux tout refaire de zéro`,
    intent: "Complete page rewrite",
  },
  {
    category: "REWRITE",
    name: "Academic format",
    userMessage: `Refais tout le contenu de ma page ${PID} en format plus académique`,
    intent: "Rewrite all in different style",
  },
  {
    category: "REWRITE",
    name: "Translate EN→FR",
    userMessage: `Translate my entire page ${PID} to French`,
    intent: "Full page translation",
  },
  // EDGE
  {
    category: "EDGE",
    name: "Améliore (vague)",
    userMessage: `Améliore ma page ${PID}`,
    intent: "Vague — should NOT rewrite everything",
  },
  {
    category: "EDGE",
    name: "Résume (no edit)",
    userMessage: `Résume ma page ${PID} en 3 phrases`,
    intent: "Summarize in chat — should NOT edit the page",
  },
  {
    category: "EDGE",
    name: "Explain (no edit)",
    userMessage: `Explique-moi le contenu de ma page ${PID}`,
    intent: "Explain in chat — should NOT edit",
  },
  // WORKSPACE
  {
    category: "WORKSPACE",
    name: "List pages",
    userMessage: "Montre-moi toutes mes pages",
    intent: "List workspace pages",
  },
  {
    category: "WORKSPACE",
    name: "List projects",
    userMessage: "Quels sont mes dossiers ?",
    intent: "List folders",
  },
  {
    category: "WORKSPACE",
    name: "Read a page",
    userMessage: `Lis ma page ${PID}`,
    intent: "Read page content",
  },
  // WEB
  {
    category: "WEB",
    name: "Current events",
    userMessage: "Quelles sont les dernières nouvelles sur l'IA ?",
    intent: "Search web",
  },
  {
    category: "WEB",
    name: "Factual question",
    userMessage: "Quel est le PIB de la France en 2025 ?",
    intent: "Search web for data",
  },
  // WIKIPEDIA
  {
    category: "WIKI",
    name: "Search topic",
    userMessage: "Cherche sur Wikipédia des infos sur la Révolution française",
    intent: "Search Wikipedia",
  },
  // CREATE
  {
    category: "CREATE",
    name: "New page",
    userMessage: "Crée-moi une page sur la photosynthèse",
    intent: "Create new page",
  },
  {
    category: "CREATE",
    name: "Study note",
    userMessage: "Fais-moi une fiche de révision sur les guerres puniques",
    intent: "Research then create page",
  },
  // QUIZ
  {
    category: "QUIZ",
    name: "Progress check",
    userMessage: "Comment je progresse dans mes quiz ?",
    intent: "Show quiz stats",
  },
  {
    category: "QUIZ",
    name: "Recent results",
    userMessage: "Montre-moi mes derniers résultats de quiz",
    intent: "Show recent quiz results",
  },
  // COMPLEX
  {
    category: "COMPLEX",
    name: "Fix + add",
    userMessage: `Dans ma page ${PID}, corrige "débute en 264" par "commence en 264" et ajoute une section sur la troisième guerre à la fin`,
    intent: "Two edits: fix text + insert section",
  },
  {
    category: "COMPLEX",
    name: "Multi-section rewrite",
    userMessage: `Réécris les sections "Introduction" et "Conclusion" de ma page ${PID}`,
    intent: "Replace two sections",
  },
  {
    category: "COMPLEX",
    name: "Create from existing",
    userMessage: `À partir de ma page ${PID}, crée une fiche résumée dans une nouvelle page`,
    intent: "Read page then create new page",
  },
  {
    category: "COMPLEX",
    name: "Translate section only",
    userMessage: `Traduis uniquement la section "Deuxième Guerre Punique" de ma page ${PID} en espagnol`,
    intent: "Replace one section with translation",
  },
  {
    category: "COMPLEX",
    name: "Quiz-informed edit",
    userMessage: `Regarde mes résultats de quiz et améliore ma page ${PID} en développant les parties où je suis faible`,
    intent: "Check quiz stats then edit weak areas",
  },
  {
    category: "COMPLEX",
    name: "Compare with web",
    userMessage: `Compare le contenu de ma page ${PID} avec ce qu'on trouve sur le web`,
    intent: "Read page + search web + respond",
  },
  {
    category: "COMPLEX",
    name: "Replace conclusion",
    userMessage: `Supprime la conclusion actuelle de ma page ${PID} et remplace-la par une analyse plus approfondie`,
    intent: "Replace conclusion section",
  },
  // CHAT
  { category: "CHAT", name: "Greeting", userMessage: "Salut !", intent: "Greet — no tool" },
  { category: "CHAT", name: "Thanks", userMessage: "Merci beaucoup !", intent: "Thank — no tool" },
  {
    category: "CHAT",
    name: "General question",
    userMessage: "C'est quoi la différence entre mitose et méiose ?",
    intent: "Answer from knowledge — tools optional",
  },
];

// =====================================================
// Prompt Modes
// =====================================================

interface PromptMode {
  label: string;
  systemPrompt: string;
}

const cliMode = process.argv.find((a) => a.startsWith("--prompt-mode="))?.split("=")[1];

function buildPromptModes(): PromptMode[] {
  const opts = { workspaceId: "bench-workspace-id" };

  if (cliMode === "fast") {
    return [
      { label: "fast-conversation", systemPrompt: buildSystemPrompt("fast", "conversation", opts) },
    ];
  }
  if (cliMode === "deep") {
    return [
      { label: "deep-conversation", systemPrompt: buildSystemPrompt("deep", "conversation", opts) },
    ];
  }

  // Default: test both modes
  return [
    { label: "fast-conversation", systemPrompt: buildSystemPrompt("fast", "conversation", opts) },
    { label: "deep-conversation", systemPrompt: buildSystemPrompt("deep", "conversation", opts) },
  ];
}

// =====================================================
// Runner — writes .md report
// =====================================================

interface StepDetail {
  stepIndex: number;
  thinking?: string;
  toolCalls: Array<{
    toolName: string;
    args: string;
    result: string;
  }>;
  text?: string;
}

interface ScenarioResult {
  scenario: Scenario;
  steps: StepDetail[];
  finalText: string;
  durationMs: number;
  error?: string;
}

async function runScenario(
  scenario: Scenario,
  config: ModelConfig,
  systemPrompt: string,
): Promise<ScenarioResult> {
  const start = Date.now();

  try {
    const result = await generateText({
      model: config.provider(config.id),
      system: systemPrompt,
      messages: [{ role: "user", content: scenario.userMessage }],
      tools: allTools,
      stopWhen: stepCountIs(8),
      toolChoice: "auto",
      maxOutputTokens: 4096,
      providerOptions: config.providerOptions,
    });

    const durationMs = Date.now() - start;

    const steps: StepDetail[] = result.steps.map((step, i) => {
      const detail: StepDetail = { stepIndex: i, toolCalls: [] };

      // Extract reasoning/thinking from step
      if ("reasoning" in step && step.reasoning) {
        const r = step.reasoning as unknown;
        detail.thinking = (typeof r === "string" ? r : JSON.stringify(r)).slice(0, 500);
      }

      // Extract tool calls with args and results
      for (let j = 0; j < step.toolCalls.length; j++) {
        const tc = step.toolCalls[j];
        const tr = step.toolResults[j];
        detail.toolCalls.push({
          toolName: tc.toolName,
          args: JSON.stringify("args" in tc ? tc.args : {}).slice(0, 300),
          result: tr
            ? JSON.stringify("result" in tr ? tr.result : tr).slice(0, 200)
            : "(no result)",
        });
      }

      // Extract text output from step
      if (step.text && step.text.trim()) {
        detail.text = step.text.slice(0, 300);
      }

      return detail;
    });

    return { scenario, steps, finalText: result.text.slice(0, 500), durationMs };
  } catch (error) {
    const durationMs = Date.now() - start;
    const errMsg = error instanceof Error ? error.message : String(error);
    return { scenario, steps: [], finalText: "", durationMs, error: errMsg.slice(0, 200) };
  }
}

function buildReport(
  config: ModelConfig,
  results: ScenarioResult[],
  promptModeLabel: string,
): string {
  const lines: string[] = [];

  lines.push(`# Benchmark Report — ${config.label}`);
  lines.push(`> Generated: ${new Date().toISOString()}`);
  lines.push(`> Model: \`${config.id}\` | Scenarios: ${results.length}`);
  lines.push(`> System prompt: ${promptModeLabel}`);
  lines.push("");

  // Summary table
  lines.push("## Summary");
  lines.push("");
  lines.push("| # | Category | Scenario | Tool Chain | Duration |");
  lines.push("|---|----------|----------|------------|----------|");

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const chain = r.error
      ? `ERROR`
      : r.steps.flatMap((s) => s.toolCalls.map((tc) => tc.toolName)).join(" → ") || "(no tools)";
    lines.push(
      `| ${i + 1} | ${r.scenario.category} | ${r.scenario.name} | ${chain} | ${r.durationMs}ms |`,
    );
  }

  lines.push("");

  // Per-category summary
  lines.push("## Per-Category Stats");
  lines.push("");
  const byCat = new Map<string, { count: number; avgMs: number; toolUsage: Map<string, number> }>();
  for (const r of results) {
    const cat = r.scenario.category;
    const entry = byCat.get(cat) || { count: 0, avgMs: 0, toolUsage: new Map() };
    entry.count++;
    entry.avgMs += r.durationMs;
    for (const s of r.steps) {
      for (const tc of s.toolCalls) {
        entry.toolUsage.set(tc.toolName, (entry.toolUsage.get(tc.toolName) || 0) + 1);
      }
    }
    byCat.set(cat, entry);
  }
  for (const [cat, entry] of byCat) {
    const avg = Math.round(entry.avgMs / entry.count);
    const tools = [...entry.toolUsage.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([t, c]) => `${t}(${c})`)
      .join(", ");
    lines.push(`- **${cat}** (${entry.count} scenarios, avg ${avg}ms): ${tools || "no tools"}`);
  }

  lines.push("");

  // Detailed results
  lines.push("## Detailed Results");
  lines.push("");

  let lastCat = "";
  for (let i = 0; i < results.length; i++) {
    const r = results[i];

    if (r.scenario.category !== lastCat) {
      lastCat = r.scenario.category;
      lines.push(`### ${lastCat}`);
      lines.push("");
    }

    lines.push(`#### ${i + 1}. ${r.scenario.name} (${r.durationMs}ms)`);
    lines.push("");
    lines.push(`- **User:** \`${r.scenario.userMessage.slice(0, 120)}\``);
    lines.push(`- **Intent:** ${r.scenario.intent}`);

    if (r.error) {
      lines.push(`- **ERROR:** ${r.error}`);
      lines.push("");
      continue;
    }

    for (const step of r.steps) {
      if (step.thinking) {
        lines.push(`- **Thinking (step ${step.stepIndex}):**`);
        lines.push("  ```");
        lines.push(`  ${step.thinking.replace(/\n/g, "\n  ")}`);
        lines.push("  ```");
      }

      for (const tc of step.toolCalls) {
        lines.push(`- **Tool:** \`${tc.toolName}\``);
        lines.push(`  - Args: \`${tc.args}\``);
        lines.push(`  - Result: \`${tc.result}\``);
      }

      if (step.text) {
        lines.push(`- **Text (step ${step.stepIndex}):** ${step.text.slice(0, 200)}`);
      }
    }

    if (r.finalText) {
      lines.push(`- **Final response:** ${r.finalText.slice(0, 300)}`);
    }

    lines.push("");
  }

  // Global stats
  const totalMs = results.reduce((s, r) => s + r.durationMs, 0);
  const avgMs = Math.round(totalMs / results.length);
  const errors = results.filter((r) => r.error).length;
  lines.push("## Stats");
  lines.push("");
  lines.push(`- Total time: ${Math.round(totalMs / 1000)}s`);
  lines.push(`- Average per scenario: ${avgMs}ms`);
  lines.push(`- Errors: ${errors}/${results.length}`);

  return lines.join("\n");
}

async function main(): Promise<void> {
  mkdirSync(BENCH_DIR, { recursive: true });
  const models = buildModelConfigs();
  const promptModes = buildPromptModes();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

  for (const promptMode of promptModes) {
    for (const config of models) {
      console.log(`\n${"═".repeat(70)}`);
      console.log(
        `  Model: ${config.label} | Mode: ${promptMode.label} | ${SCENARIOS.length} scenarios`,
      );
      console.log(`${"═".repeat(70)}`);

      const results: ScenarioResult[] = [];
      let cat = "";

      for (const scenario of SCENARIOS) {
        if (scenario.category !== cat) {
          cat = scenario.category;
          console.log(`\n  ── ${cat} ──`);
        }

        process.stdout.write(`  ${scenario.name}... `);
        const r = await runScenario(scenario, config, promptMode.systemPrompt);
        results.push(r);

        if (r.error) {
          console.log(`💥 ERROR (${r.durationMs}ms)`);
        } else {
          const chain =
            r.steps.flatMap((s) => s.toolCalls.map((tc) => tc.toolName)).join(" → ") ||
            "(no tools)";
          console.log(`${chain} (${r.durationMs}ms)`);
        }
      }

      // Write report
      const report = buildReport(config, results, promptMode.label);
      const modeSlug = promptMode.label.replace(/[^a-zA-Z0-9.-]/g, "-");
      const modelSlug = config.label.replace(/[^a-zA-Z0-9.-]/g, "-").toLowerCase();
      const filename = `bench-${timestamp}-${modeSlug}-${modelSlug}.md`;
      const filepath = join(BENCH_DIR, filename);
      writeFileSync(filepath, report, "utf-8");
      console.log(`\n  📄 Report saved: ${filepath}`);

      // Console summary
      const avgMs = Math.round(results.reduce((s, r) => s + r.durationMs, 0) / results.length);
      const errors = results.filter((r) => r.error).length;
      console.log(`  ${results.length} scenarios | ${errors} errors | avg ${avgMs}ms`);
    }
  }
}

main().catch((err) => {
  console.error("Benchmark crashed:", err);
  process.exit(2);
});
