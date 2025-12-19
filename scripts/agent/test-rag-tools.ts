/**
 * 🤖 AI SDK Phase 1 - Test RAG Tools
 *
 * Ce script teste les tools RAG :
 * - listAvailableSources
 * - searchRagChunks
 * - readRagSource
 * - checkSourcesRagStatus
 */

import "dotenv/config";
import { createRagTools } from "../../src/services/agent/tools/ragTools.js";

// Context de test - utiliser des UUIDs valides par défaut
// IMPORTANT: Remplacer par de vrais IDs de votre base de données pour tester avec des données réelles
const TEST_USER_ID = process.argv[2] || "00000000-0000-0000-0000-000000000000";
const TEST_WORKSPACE_ID =
  process.argv[3] || "00000000-0000-0000-0000-000000000000";

interface TestResult {
  name: string;
  success: boolean;
  error?: string;
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("🤖 AI SDK Phase 1 - Test RAG Tools");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`📋 User ID: ${TEST_USER_ID}`);
  console.log(`📋 Workspace ID: ${TEST_WORKSPACE_ID}`);
  console.log("═══════════════════════════════════════════════════════════\n");

  const results: TestResult[] = [];

  // Créer les tools avec le contexte
  const ragTools = createRagTools({
    userId: TEST_USER_ID,
    workspaceId: TEST_WORKSPACE_ID,
  });

  // Test 1: listAvailableSources
  console.log("┌─────────────────────────────────────────────────────────┐");
  console.log("│ Test 1: listAvailableSources                            │");
  console.log("└─────────────────────────────────────────────────────────┘");
  try {
    const sources = await ragTools.listAvailableSources.execute(
      { includeGlobal: true },
      { toolCallId: "test-1", abortSignal: new AbortController().signal },
    );
    console.log("✅ Résultat:", JSON.stringify(sources, null, 2));
    results.push({ name: "listAvailableSources", success: true });
  } catch (error) {
    console.error("❌ Erreur:", error);
    results.push({
      name: "listAvailableSources",
      success: false,
      error: String(error),
    });
  }

  console.log("\n");

  // Test 2: searchRagChunks
  console.log("┌─────────────────────────────────────────────────────────┐");
  console.log("│ Test 2: searchRagChunks                                 │");
  console.log("└─────────────────────────────────────────────────────────┘");
  try {
    const chunks = await ragTools.searchRagChunks.execute(
      { query: "test query", limit: 5 },
      { toolCallId: "test-2", abortSignal: new AbortController().signal },
    );
    console.log("✅ Résultat:", JSON.stringify(chunks, null, 2));
    results.push({ name: "searchRagChunks", success: true });
  } catch (error) {
    console.error("❌ Erreur:", error);
    results.push({
      name: "searchRagChunks",
      success: false,
      error: String(error),
    });
  }

  console.log("\n");

  // Test 3: checkSourcesRagStatus
  console.log("┌─────────────────────────────────────────────────────────┐");
  console.log("│ Test 3: checkSourcesRagStatus                           │");
  console.log("└─────────────────────────────────────────────────────────┘");
  try {
    const status = await ragTools.checkSourcesRagStatus.execute(
      { titles: ["Test Document", "Wikipedia Article"] },
      { toolCallId: "test-3", abortSignal: new AbortController().signal },
    );
    console.log("✅ Résultat:", JSON.stringify(status, null, 2));
    results.push({ name: "checkSourcesRagStatus", success: true });
  } catch (error) {
    console.error("❌ Erreur:", error);
    results.push({
      name: "checkSourcesRagStatus",
      success: false,
      error: String(error),
    });
  }

  // Résumé final
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("📊 RÉSUMÉ DES TESTS");
  console.log("═══════════════════════════════════════════════════════════");

  const passed = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  for (const result of results) {
    console.log(`  ${result.success ? "✅" : "❌"} ${result.name}`);
  }

  console.log("───────────────────────────────────────────────────────────");
  console.log(
    `  Total: ${results.length} | ✅ Réussis: ${passed} | ❌ Échoués: ${failed}`,
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
