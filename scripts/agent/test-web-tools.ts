/**
 * 🤖 AI SDK Phase 1 - Test Web Tools (OpenAI Web Search)
 *
 * Ce script teste les tools Web :
 * - searchWeb (OpenAI Responses API)
 * - searchWikipedia
 * - getWikipediaArticle
 */

import "dotenv/config";
import { createWebTools } from "../../src/services/agent/tools/webTools.js";

// Context de test - utiliser des UUIDs valides par défaut
// IMPORTANT: Remplacer par de vrais IDs de votre base de données pour tester avec des données réelles
const TEST_USER_ID = process.argv[2] || "00000000-0000-0000-0000-000000000000";
const TEST_WORKSPACE_ID =
  process.argv[3] || "00000000-0000-0000-0000-000000000000";

interface TestResult {
  name: string;
  success: boolean;
  skipped?: boolean;
  error?: string;
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("🤖 AI SDK Phase 1 - Test Web Tools (OpenAI Web Search)");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(
    `📋 OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? "✅ Configurée" : "❌ Manquante"}`,
  );
  console.log("═══════════════════════════════════════════════════════════\n");

  const results: TestResult[] = [];

  // Créer les tools avec le contexte
  const webTools = createWebTools({
    userId: TEST_USER_ID,
    workspaceId: TEST_WORKSPACE_ID,
  });

  // Test 1: searchWikipedia (gratuit)
  console.log("┌─────────────────────────────────────────────────────────┐");
  console.log("│ Test 1: searchWikipedia                                 │");
  console.log("└─────────────────────────────────────────────────────────┘");
  try {
    const wikiResults = await webTools.searchWikipedia.execute(
      { query: "Intelligence artificielle", limit: 3 },
      { toolCallId: "test-1", abortSignal: new AbortController().signal },
    );
    console.log("✅ Résultat:", JSON.stringify(wikiResults, null, 2));
    results.push({ name: "searchWikipedia", success: true });
  } catch (error) {
    console.error("❌ Erreur:", error);
    results.push({
      name: "searchWikipedia",
      success: false,
      error: String(error),
    });
  }

  console.log("\n");

  // Test 2: getWikipediaArticle (gratuit)
  console.log("┌─────────────────────────────────────────────────────────┐");
  console.log("│ Test 2: getWikipediaArticle                             │");
  console.log("└─────────────────────────────────────────────────────────┘");
  try {
    const article = await webTools.getWikipediaArticle.execute(
      { title: "Intelligence artificielle" },
      { toolCallId: "test-2", abortSignal: new AbortController().signal },
    );
    console.log("✅ Résultat:", JSON.stringify(article, null, 2));
    results.push({ name: "getWikipediaArticle", success: true });
  } catch (error) {
    console.error("❌ Erreur:", error);
    results.push({
      name: "getWikipediaArticle",
      success: false,
      error: String(error),
    });
  }

  console.log("\n");

  // Test 3: searchWeb (OpenAI - coûte des tokens)
  console.log("┌─────────────────────────────────────────────────────────┐");
  console.log("│ Test 3: searchWeb (OpenAI Responses API)                │");
  console.log("└─────────────────────────────────────────────────────────┘");
  if (!process.env.OPENAI_API_KEY) {
    console.log("⚠️  Skipped: OPENAI_API_KEY non configurée");
    results.push({ name: "searchWeb", success: true, skipped: true });
  } else {
    try {
      const webResults = await webTools.searchWeb.execute(
        {
          query: "Dernières actualités IA décembre 2024",
          searchContextSize: "medium",
        },
        { toolCallId: "test-3", abortSignal: new AbortController().signal },
      );
      console.log("✅ Résultat:", JSON.stringify(webResults, null, 2));
      results.push({ name: "searchWeb", success: true });
    } catch (error) {
      console.error("❌ Erreur:", error);
      results.push({ name: "searchWeb", success: false, error: String(error) });
    }
  }

  // Résumé final
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("📊 RÉSUMÉ DES TESTS");
  console.log("═══════════════════════════════════════════════════════════");

  const passed = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  const skipped = results.filter((r) => r.skipped).length;

  for (const result of results) {
    const icon = result.skipped ? "⏭️" : result.success ? "✅" : "❌";
    const suffix = result.skipped ? " (skipped)" : "";
    console.log(`  ${icon} ${result.name}${suffix}`);
  }

  console.log("───────────────────────────────────────────────────────────");
  console.log(
    `  Total: ${results.length} | ✅ Réussis: ${passed - skipped} | ⏭️ Skipped: ${skipped} | ❌ Échoués: ${failed}`,
  );
  console.log("═══════════════════════════════════════════════════════════");

  if (failed > 0) {
    console.log("\n🔴 CERTAINS TESTS ONT ÉCHOUÉ");
    process.exit(1);
  } else {
    console.log("\n🟢 TOUS LES TESTS ONT RÉUSSI");
    process.exit(0);
  }
}

main().catch((error) => {
  console.error("💥 Erreur fatale:", error);
  process.exit(1);
});
