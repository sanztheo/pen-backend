/**
 * Test latence brute API Moonshot (kimi-k2.5) vs OpenAI
 * Usage: npx tsx scripts/test-moonshot-latency.ts
 */

import OpenAI from "openai";

const MOONSHOT_API_KEY = process.env.MOONSHOT_API_KEY || process.env.KIMI_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const SIMPLE_PROMPT = `Generate a single multiple choice question about photosynthesis for a middle school student. Return JSON: {"question":"...","options":["A","B","C","D"],"correct":"A"}`;

const QUIZ_PROMPT = `<request>
<task>Generate ONE quiz question</task>
<parameters>
<question_type>MULTIPLE_CHOICE</question_type>
<school_level>COLLEGE</school_level>
<difficulty>moyen</difficulty>
</parameters>
</request>`;

async function testProvider(
  name: string,
  client: OpenAI,
  model: string,
  maxTokens: number,
  prompt: string,
): Promise<void> {
  console.log(`\n${"─".repeat(50)}`);
  console.log(`🧪 ${name} (${model}) | maxTokens=${maxTokens}`);

  const t0 = Date.now();
  try {
    const res = await client.chat.completions.create(
      {
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: maxTokens,
        temperature: 1,
      },
      { signal: AbortSignal.timeout(120_000) },
    );
    const elapsed = Date.now() - t0;
    const usage = res.usage;
    const content = res.choices[0]?.message?.content ?? "";

    console.log(`   ⏱️  Latence: ${elapsed}ms`);
    console.log(
      `   📊 Tokens: ${usage?.prompt_tokens ?? "?"}in / ${usage?.completion_tokens ?? "?"}out / ${usage?.total_tokens ?? "?"}total`,
    );
    console.log(`   📏 Response: ${content.length} chars`);
    console.log(
      `   🚀 Speed: ${usage?.completion_tokens ? Math.round((usage.completion_tokens / elapsed) * 1000) : "?"} tokens/sec`,
    );

    // Vérifier si JSON valide
    try {
      JSON.parse(content);
      console.log(`   ✅ JSON valide`);
    } catch {
      console.log(`   ⚠️  JSON invalide (tronqué?)`);
    }
  } catch (err: unknown) {
    const elapsed = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`   ❌ Erreur après ${elapsed}ms: ${msg}`);
  }
}

async function testJsonStrict(
  name: string,
  client: OpenAI,
  model: string,
  maxTokens: number,
): Promise<void> {
  console.log(`\n${"─".repeat(50)}`);
  console.log(`🧪 ${name} JSON STRICT (${model}) | maxTokens=${maxTokens}`);

  const schema = {
    type: "object" as const,
    properties: {
      question: { type: "string" as const },
      options: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            id: { type: "string" as const },
            text: { type: "string" as const },
            isCorrect: { type: "boolean" as const },
          },
          required: ["id", "text", "isCorrect"] as const,
          additionalProperties: false,
        },
      },
      correctAnswer: { type: "string" as const },
    },
    required: ["question", "options", "correctAnswer"] as const,
    additionalProperties: false,
  };

  const t0 = Date.now();
  try {
    const res = await client.chat.completions.create(
      {
        model,
        messages: [{ role: "user", content: QUIZ_PROMPT }],
        max_tokens: maxTokens,
        temperature: 1,
        response_format: {
          type: "json_schema",
          json_schema: { name: "quiz_question", strict: true, schema },
        },
      },
      { signal: AbortSignal.timeout(120_000) },
    );
    const elapsed = Date.now() - t0;
    const usage = res.usage;
    const content = res.choices[0]?.message?.content ?? "";

    console.log(`   ⏱️  Latence: ${elapsed}ms`);
    console.log(
      `   📊 Tokens: ${usage?.prompt_tokens ?? "?"}in / ${usage?.completion_tokens ?? "?"}out / ${usage?.total_tokens ?? "?"}total`,
    );
    console.log(`   📏 Response: ${content.length} chars`);
    console.log(
      `   🚀 Speed: ${usage?.completion_tokens ? Math.round((usage.completion_tokens / elapsed) * 1000) : "?"} tokens/sec`,
    );

    try {
      JSON.parse(content);
      console.log(`   ✅ JSON valide`);
    } catch {
      console.log(`   ⚠️  JSON invalide (tronqué?)`);
    }
  } catch (err: unknown) {
    const elapsed = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`   ❌ Erreur après ${elapsed}ms: ${msg}`);
  }
}

async function main(): Promise<void> {
  console.log("═".repeat(50));
  console.log("🔬 TEST LATENCE BRUTE — Moonshot vs OpenAI vs Gemini");
  console.log("═".repeat(50));

  // ── Moonshot (kimi-k2.5) ────────────────────────
  if (MOONSHOT_API_KEY) {
    const moonshot = new OpenAI({
      apiKey: MOONSHOT_API_KEY,
      baseURL: "https://api.moonshot.ai/v1",
    });

    // Test simple
    await testProvider("Moonshot SIMPLE", moonshot, "kimi-k2.5", 500, SIMPLE_PROMPT);
    // Test JSON strict
    await testJsonStrict("Moonshot", moonshot, "kimi-k2.5", 1500);
  } else {
    console.log("\n⚠️  MOONSHOT_API_KEY non définie — skip");
  }

  // ── OpenAI (gpt-4o-mini) ─────────────────────────
  if (OPENAI_API_KEY) {
    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

    await testProvider("OpenAI SIMPLE", openai, "gpt-4o-mini", 500, SIMPLE_PROMPT);
    await testJsonStrict("OpenAI", openai, "gpt-4o-mini", 1500);
  } else {
    console.log("\n⚠️  OPENAI_API_KEY non définie — skip");
  }

  // ── Gemini (flash-lite) ──────────────────────────
  if (GEMINI_API_KEY) {
    const gemini = new OpenAI({
      apiKey: GEMINI_API_KEY,
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    });

    await testProvider("Gemini SIMPLE", gemini, "gemini-2.0-flash-lite", 500, SIMPLE_PROMPT);
    await testJsonStrict("Gemini", gemini, "gemini-2.0-flash-lite", 1500);
  } else {
    console.log("\n⚠️  GEMINI_API_KEY non définie — skip");
  }

  console.log(`\n${"═".repeat(50)}`);
  console.log("✅ Tests terminés");
}

main().catch(console.error);
