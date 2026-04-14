/**
 * SPIKE: Long Context + Batch vs Current RAG
 *
 * Tests whether quiz question redundancy comes from:
 * (A) The RAG chunking (1200 chars, no overlap, top-K=5-10)
 * (B) The per-question generation approach (same context, growing history)
 *
 * Approach: stuff entire course content into Gemini 3 Flash (1M context),
 * generate 20 questions in ONE call, measure pairwise similarity.
 * If redundancy drops → problem IS the RAG/per-question approach.
 * If redundancy persists → problem is deeper (prompt, model, etc.)
 *
 * DEV ONLY — no auth, reads arbitrary pageIds.
 */

if (process.env.NODE_ENV === "production") {
  throw new Error("[SPIKE] Forbidden in production");
}

import { google } from "@ai-sdk/google";
import { generateText, generateObject } from "ai";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { cosineSimilarity } from "../../src/utils/clustering";

// We need embeddings for similarity — import the RAG system
// (dynamic import to handle module resolution)
let ragSystem: any;
try {
  ragSystem = (await import("../../src/services/rag/index.js")).ragSystem;
} catch {
  ragSystem = (await import("../../src/services/rag")).ragSystem;
}

const prisma = new PrismaClient();

// ── Types ────────────────────────────────────

const QuestionSchema = z.object({
  question: z.string(),
  type: z.enum(["MULTIPLE_CHOICE", "TRUE_FALSE", "OPEN_QUESTION"]),
  options: z.array(z.string()).optional(),
  correctAnswer: z.string(),
  explanation: z.string().optional(),
  topic: z.string().describe("The specific sub-topic this question tests"),
});

const QuizBatchSchema = z.object({
  questions: z.array(QuestionSchema),
});

interface SpikeMetrics {
  approach: string;
  totalQuestions: number;
  semanticMean: number;
  semanticMax: number;
  semanticP75: number;
  pairsAbove085: number;
  pairsAbove080: number;
  pairsAbove070: number;
  latencyMs: number;
  uniqueTopics: number;
}

// ── Helpers ──────────────────────────────────

function extractTextFromBlockNote(blockNoteContent: unknown): string {
  if (!blockNoteContent || !Array.isArray(blockNoteContent)) return "";

  return blockNoteContent
    .filter((block: any) => block?.content)
    .map((block: any) => {
      if (!Array.isArray(block.content)) return "";
      return block.content.map((item: any) => item?.text ?? "").join("");
    })
    .filter((text: string) => text.trim().length > 0)
    .join("\n\n");
}

async function measureSimilarity(
  questions: string[],
): Promise<Omit<SpikeMetrics, "approach" | "latencyMs" | "uniqueTopics">> {
  if (questions.length < 2) {
    return {
      totalQuestions: questions.length,
      semanticMean: 0,
      semanticMax: 0,
      semanticP75: 0,
      pairsAbove085: 0,
      pairsAbove080: 0,
      pairsAbove070: 0,
    };
  }

  // Embed all questions in parallel
  const embeddings = await Promise.all(
    questions.map((q) => ragSystem.embeddingService.generateEmbedding(q)),
  );

  const sims: number[] = [];
  let above085 = 0,
    above080 = 0,
    above070 = 0,
    max = 0;

  for (let i = 0; i < embeddings.length; i++) {
    for (let j = i + 1; j < embeddings.length; j++) {
      const s = cosineSimilarity(embeddings[i], embeddings[j]);
      sims.push(s);
      if (s > max) max = s;
      if (s >= 0.85) above085++;
      if (s >= 0.8) above080++;
      if (s >= 0.7) above070++;
    }
  }

  const sorted = [...sims].sort((a, b) => a - b);
  const mean = sims.reduce((a, b) => a + b, 0) / sims.length;
  const p75 = sorted[Math.floor(sorted.length * 0.75)] ?? 0;

  return {
    totalQuestions: questions.length,
    semanticMean: Number(mean.toFixed(3)),
    semanticMax: Number(max.toFixed(3)),
    semanticP75: Number(p75.toFixed(3)),
    pairsAbove085: above085,
    pairsAbove080: above080,
    pairsAbove070: above070,
  };
}

// ── Approach A: Single batch of 20 ──────────

async function approachA_batch20(courseTitle: string, courseText: string): Promise<SpikeMetrics> {
  console.log("\n━━━ Approach A: Single batch of 20 questions ━━━");

  const t0 = Date.now();

  const { object } = await generateObject({
    model: google("gemini-3-flash-preview"),
    schema: QuizBatchSchema,
    prompt: `
<identity>You are QuizMaster, an expert pedagogist creating quiz questions.</identity>

<source_content>
<title>${courseTitle}</title>
<content>
${courseText}
</content>
</source_content>

<mission>
Generate exactly 20 quiz questions from the source content above.

CRITICAL RULES:
- Each question MUST cover a DIFFERENT sub-topic or concept from the course
- NO two questions should test the same knowledge, even if worded differently
- Vary question types (mix MULTIPLE_CHOICE, TRUE_FALSE, OPEN_QUESTION)
- Vary difficulty levels across the set
- Questions should span the ENTIRE course, not cluster on the first/last sections
- For MULTIPLE_CHOICE: provide exactly 4 options as strings
- The "topic" field should be a short label of the specific concept tested

Before generating, mentally outline the 20 distinct concepts you'll cover, ensuring maximum diversity.
</mission>`,
    maxTokens: 8000,
  });

  const latency = Date.now() - t0;
  const questions = object.questions.map((q) => q.question);
  const topics = new Set(object.questions.map((q) => q.topic));

  console.log(`  Generated ${questions.length} questions in ${latency}ms`);
  console.log(`  Unique topics: ${topics.size}`);
  topics.forEach((t) => console.log(`    - ${t}`));

  const sim = await measureSimilarity(questions);

  return { approach: "batch-20", ...sim, latencyMs: latency, uniqueTopics: topics.size };
}

// ── Approach B: Batch of 5 × 4 ─────────────

async function approachB_batch5x4(courseTitle: string, courseText: string): Promise<SpikeMetrics> {
  console.log("\n━━━ Approach B: 4 batches of 5 questions ━━━");

  const t0 = Date.now();
  const allQuestions: Array<{ question: string; topic: string }> = [];

  for (let batch = 0; batch < 4; batch++) {
    const previousQuestions = allQuestions.map((q) => q.question);
    const previousTopics = allQuestions.map((q) => q.topic);

    const previousSection =
      previousQuestions.length > 0
        ? `
<already_generated count="${previousQuestions.length}">
${previousQuestions.map((q, i) => `<q index="${i + 1}">${q}</q>`).join("\n")}
</already_generated>
<already_covered_topics>
${previousTopics.map((t) => `<topic>${t}</topic>`).join("\n")}
</already_covered_topics>`
        : "";

    const { object } = await generateObject({
      model: google("gemini-3-flash-preview"),
      schema: QuizBatchSchema,
      prompt: `
<identity>You are QuizMaster, an expert pedagogist creating quiz questions.</identity>

<source_content>
<title>${courseTitle}</title>
<content>
${courseText}
</content>
</source_content>

<mission>
Generate exactly 5 NEW quiz questions from the source content.
This is batch ${batch + 1} of 4 (generating 20 questions total).
${previousSection}

CRITICAL RULES:
- Each question MUST cover a DIFFERENT concept not yet covered above
- NO paraphrasing of existing questions — completely new angles
- Vary question types (MULTIPLE_CHOICE, TRUE_FALSE, OPEN_QUESTION)
- For MULTIPLE_CHOICE: provide exactly 4 options as strings
- The "topic" field must differ from all already_covered_topics
</mission>`,
      maxTokens: 3000,
    });

    allQuestions.push(...object.questions.map((q) => ({ question: q.question, topic: q.topic })));
    console.log(
      `  Batch ${batch + 1}: ${object.questions.length} questions (total: ${allQuestions.length})`,
    );
  }

  const latency = Date.now() - t0;
  const questions = allQuestions.map((q) => q.question);
  const topics = new Set(allQuestions.map((q) => q.topic));

  console.log(`  Total: ${questions.length} questions in ${latency}ms`);
  console.log(`  Unique topics: ${topics.size}`);

  const sim = await measureSimilarity(questions);

  return { approach: "batch-5x4", ...sim, latencyMs: latency, uniqueTopics: topics.size };
}

// ── Main ─────────────────────────────────────

async function main(): Promise<void> {
  const pageIds = process.argv.slice(2);
  if (pageIds.length === 0) {
    console.error("Usage: tsx scripts/dev/spikeFileSearchVsRAG.ts <pageId1> [pageId2] ...");
    console.error("  Pass the same pageIds used for the problematic quiz.");
    process.exit(1);
  }

  // Fetch pages from DB
  const pages = await prisma.page.findMany({
    where: { id: { in: pageIds } },
    select: { id: true, title: true, blockNoteContent: true },
  });

  if (pages.length === 0) {
    console.error("No pages found for provided IDs.");
    process.exit(1);
  }

  // Extract full text content
  const courseText = pages
    .map((p) => `## ${p.title}\n\n${extractTextFromBlockNote(p.blockNoteContent)}`)
    .join("\n\n---\n\n");

  const wordCount = courseText.split(/\s+/).length;
  const charCount = courseText.length;
  const estimatedTokens = Math.ceil(wordCount * 1.3);

  console.log("═══════════════════════════════════════════════════");
  console.log("  SPIKE: Long Context + Batch vs Current RAG");
  console.log("═══════════════════════════════════════════════════");
  console.log(`  Pages: ${pages.length} (${pages.map((p) => p.title).join(", ")})`);
  console.log(`  Content: ${charCount} chars, ~${wordCount} words, ~${estimatedTokens} tokens`);
  console.log(`  Model: gemini-3-flash-preview (1M context)`);

  // Run both approaches
  const results: SpikeMetrics[] = [];

  try {
    const a = await approachA_batch20(pages[0].title, courseText);
    results.push(a);
  } catch (err) {
    console.error("Approach A failed:", err);
  }

  try {
    const b = await approachB_batch5x4(pages[0].title, courseText);
    results.push(b);
  } catch (err) {
    console.error("Approach B failed:", err);
  }

  // Print comparison table
  console.log("\n═══════════════════════════════════════════════════");
  console.log("  RESULTS COMPARISON");
  console.log("═══════════════════════════════════════════════════");
  console.log("                    | batch-20    | batch-5x4   |");
  console.log("─────────────────────────────────────────────────");

  for (const metric of [
    "totalQuestions",
    "semanticMean",
    "semanticMax",
    "semanticP75",
    "pairsAbove085",
    "pairsAbove080",
    "pairsAbove070",
    "uniqueTopics",
    "latencyMs",
  ] as (keyof SpikeMetrics)[]) {
    const vals = results.map((r) => String(r[metric]).padStart(10));
    console.log(`  ${String(metric).padEnd(20)}| ${vals.join("  | ")}  |`);
  }

  console.log("═══════════════════════════════════════════════════");
  console.log("\n  Compare with your current RAG baseline (from quizDedupBaseline.ts).");
  console.log("  If pairsAbove080 is near 0, the problem IS the RAG/per-question approach.");
  console.log("  If still high, the problem is deeper (prompt quality, model behavior).\n");

  // Print all questions for manual inspection
  if (results.length > 0) {
    console.log("\n── Questions (Approach A: batch-20) ──────────────");
    const a = results.find((r) => r.approach === "batch-20");
    // Re-generate would be wasteful; questions aren't stored in metrics.
    // The console logs above show them during generation.
  }

  await prisma.$disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("[SPIKE] Fatal:", err);
  process.exit(1);
});
