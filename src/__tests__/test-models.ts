/**
 * Quick test: verify all selectable models work with streamText
 * Usage: npx tsx src/__tests__/test-models.ts
 */

import { streamText } from "ai";
import { getProviderInstance } from "../config/providers.js";
import { AGENT_SELECTABLE_MODELS, parseCompositeId } from "../config/models/selectable.js";

async function testModel(
  compositeId: string,
): Promise<{ ok: boolean; error?: string; time?: number; textLen?: number }> {
  const parsed = parseCompositeId(compositeId);
  if (!parsed) return { ok: false, error: "Invalid composite ID" };

  const { modelId, thinkingLevel } = parsed;
  const providerInstance = getProviderInstance(modelId);
  if (!providerInstance) return { ok: false, error: "No API key for provider" };

  const model = providerInstance(modelId);

  // Build providerOptions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const providerOptions: any = {};
  const isOpenAI =
    modelId.includes("gpt") ||
    modelId.includes("codex") ||
    modelId.includes("o3") ||
    modelId.includes("o4");
  const isGoogle = modelId.includes("gemini");

  if (isOpenAI && thinkingLevel !== "none") {
    providerOptions.openai = { reasoningEffort: thinkingLevel, reasoningSummary: "auto" };
  }
  if (isGoogle) {
    providerOptions.google = { thinkingConfig: { thinkingLevel, includeThoughts: true } };
  }

  const start = Date.now();

  try {
    const result = streamText({
      model,
      messages: [{ role: "user", content: "Say 'hello' and nothing else." }],
      maxOutputTokens: 128,
      providerOptions,
    });

    let text = "";
    for await (const chunk of result.textStream) {
      text += chunk;
    }

    const elapsed = Date.now() - start;

    if (!text.trim()) {
      return { ok: false, error: "Empty response", time: elapsed };
    }

    return { ok: true, time: elapsed, textLen: text.length };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg.slice(0, 200), time: Date.now() - start };
  }
}

async function main() {
  console.log("🧪 Testing all selectable models...\n");

  const results: Array<{
    id: string;
    name: string;
    thinking: string;
    ok: boolean;
    error?: string;
    time?: number;
  }> = [];

  for (const model of AGENT_SELECTABLE_MODELS) {
    process.stdout.write(`  ${model.name} (${model.thinkingLevel})... `);
    const result = await testModel(model.id);

    if (result.ok) {
      console.log(`✅ ${result.time}ms (${result.textLen} chars)`);
    } else {
      console.log(`❌ ${result.error}`);
    }

    results.push({ id: model.id, name: model.name, thinking: model.thinkingLevel, ...result });
  }

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  const passed = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  console.log(`✅ Passed: ${passed.length}/${results.length}`);
  if (failed.length > 0) {
    console.log(`❌ Failed: ${failed.length}`);
    for (const f of failed) {
      console.log(`   - ${f.name} (${f.thinking}): ${f.error}`);
    }
  }
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

main().catch(console.error);
