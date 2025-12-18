/**
 * 🤖 AI SDK Phase 1 - Test PennoteAgent complet
 *
 * Ce script teste l'agent Pennote avec tous les tools :
 * - Mode "ask" avec RAG
 * - Mode "search" avec Web Search
 * - Streaming de la réponse
 */

import "dotenv/config";
import {
  runPennoteAgent,
  runPennoteAgentSimple,
} from "../../src/services/agent/index.js";
import type { ModelMessage } from "ai";

// Context de test - utiliser des UUIDs valides par défaut
// IMPORTANT: Remplacer par de vrais IDs de votre base de données pour tester avec des données réelles
const TEST_USER_ID = process.argv[2] || "00000000-0000-0000-0000-000000000000";
const TEST_WORKSPACE_ID =
  process.argv[3] || "00000000-0000-0000-0000-000000000000";
const TEST_MODE = (process.argv[4] || "ask") as "ask" | "search";

interface TestResult {
  name: string;
  success: boolean;
  skipped?: boolean;
  error?: string;
}

const results: TestResult[] = [];

async function testSimpleMode() {
  console.log("┌─────────────────────────────────────────────────────────┐");
  console.log("│ Test 1: runPennoteAgentSimple (mode: ask)               │");
  console.log("└─────────────────────────────────────────────────────────┘");

  const messages: ModelMessage[] = [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "Bonjour, peux-tu me dire quelles sources sont disponibles ?",
        },
      ],
    },
  ];

  try {
    const result = await runPennoteAgentSimple({
      messages,
      mode: "ask",
      userId: TEST_USER_ID,
      workspaceId: TEST_WORKSPACE_ID,
      useWeb: false,
    });

    console.log("\n📝 Réponse:");
    console.log(result.text);
    console.log("\n🔧 Tool Calls:", result.toolCalls.length);
    for (const tc of result.toolCalls) {
      console.log(`  - ${tc.toolName}:`, tc.args);
    }
    console.log("\n📊 Usage:", result.usage);
    results.push({ name: "runPennoteAgentSimple", success: true });
  } catch (error) {
    console.error("❌ Erreur:", error);
    results.push({
      name: "runPennoteAgentSimple",
      success: false,
      error: String(error),
    });
  }
}

async function testStreamingMode() {
  console.log("\n┌─────────────────────────────────────────────────────────┐");
  console.log("│ Test 2: runPennoteAgent avec streaming                  │");
  console.log("└─────────────────────────────────────────────────────────┘");

  const messages: ModelMessage[] = [
    {
      role: "user",
      content: [
        { type: "text", text: "Recherche les dernières nouvelles sur l'IA" },
      ],
    },
  ];

  try {
    const result = await runPennoteAgent(
      {
        messages,
        mode: "search",
        userId: TEST_USER_ID,
        workspaceId: TEST_WORKSPACE_ID,
        useWeb: true,
      },
      {
        onStepFinish: ({ stepNumber, toolCalls, text }) => {
          console.log(`\n📍 Step ${stepNumber} terminé`);
          if (toolCalls.length > 0) {
            console.log(
              `  🔧 Tools appelés: ${toolCalls.map((tc) => tc.toolName).join(", ")}`,
            );
          }
          if (text) {
            console.log(`  📝 Texte généré (${text.length} chars)`);
          }
        },
        onToolCall: (toolName, args) => {
          console.log(`  ⚡ Appel tool: ${toolName}`);
        },
        onToolResult: (toolName, result) => {
          console.log(`  ✅ Résultat tool: ${toolName}`);
        },
      },
    );

    // Consommer le stream
    console.log("\n📡 Streaming de la réponse...");
    let fullText = "";
    for await (const chunk of result.textStream) {
      process.stdout.write(chunk);
      fullText += chunk;
    }

    console.log("\n\n📊 Réponse complète:", fullText.length, "caractères");
    results.push({ name: "runPennoteAgent (streaming)", success: true });
  } catch (error) {
    console.error("❌ Erreur:", error);
    results.push({
      name: "runPennoteAgent (streaming)",
      success: false,
      error: String(error),
    });
  }
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("🤖 AI SDK Phase 1 - Test PennoteAgent");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`📋 User ID: ${TEST_USER_ID}`);
  console.log(`📋 Workspace ID: ${TEST_WORKSPACE_ID}`);
  console.log(`📋 Mode: ${TEST_MODE}`);
  console.log(`📋 OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? "✅" : "❌"}`);
  console.log("═══════════════════════════════════════════════════════════\n");

  if (!process.env.OPENAI_API_KEY) {
    console.error("❌ OPENAI_API_KEY est requise pour ce test");
    process.exit(1);
  }

  // Test mode simple
  await testSimpleMode();

  // Test mode streaming avec web search
  if (TEST_MODE === "search") {
    await testStreamingMode();
  } else {
    results.push({
      name: "runPennoteAgent (streaming)",
      success: true,
      skipped: true,
    });
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
