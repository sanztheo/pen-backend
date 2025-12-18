/**
 * 🤖 AI SDK Phase 1 - Test Route /api/agent/chat
 *
 * Ce script teste la route de l'agent avec streaming SSE.
 * Nécessite que le backend soit en cours d'exécution sur localhost:3001
 */

import "dotenv/config";

// Configuration
const BASE_URL = process.env.API_URL || "http://localhost:3001";
const TEST_TOKEN = process.env.TEST_AUTH_TOKEN || "";

// En dev, on peut utiliser un token factice ou récupérer un vrai token
// Pour les tests manuels, vous pouvez obtenir un token via l'app frontend

interface TestResult {
  name: string;
  success: boolean;
  skipped?: boolean;
  error?: string;
  duration?: number;
}

const results: TestResult[] = [];

/**
 * Helper pour faire des requêtes authentifiées
 */
async function fetchWithAuth(
  endpoint: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${BASE_URL}${endpoint}`;
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (TEST_TOKEN) {
    (headers as Record<string, string>)["Authorization"] =
      `Bearer ${TEST_TOKEN}`;
  }

  return fetch(url, {
    ...options,
    headers,
  });
}

/**
 * Test 1: GET /api/agent/modes
 */
async function testGetModes(): Promise<void> {
  console.log("┌─────────────────────────────────────────────────────────┐");
  console.log("│ Test 1: GET /api/agent/modes                            │");
  console.log("└─────────────────────────────────────────────────────────┘");

  const start = Date.now();

  try {
    const response = await fetchWithAuth("/api/agent/modes");
    const data = await response.json();

    if (response.ok && data.modes && Array.isArray(data.modes)) {
      console.log("✅ Modes disponibles:");
      for (const mode of data.modes) {
        console.log(
          `   - ${mode.id}: ${mode.name} (${mode.credits} crédits, ${mode.maxSteps} steps)`,
        );
      }
      results.push({
        name: "GET /api/agent/modes",
        success: true,
        duration: Date.now() - start,
      });
    } else {
      console.error("❌ Réponse invalide:", data);
      results.push({
        name: "GET /api/agent/modes",
        success: false,
        error: `Status ${response.status}`,
        duration: Date.now() - start,
      });
    }
  } catch (error) {
    console.error("❌ Erreur:", error);
    results.push({
      name: "GET /api/agent/modes",
      success: false,
      error: String(error),
      duration: Date.now() - start,
    });
  }
}

/**
 * Test 2: POST /api/agent/chat/simple (sans streaming)
 */
async function testChatSimple(): Promise<void> {
  console.log("\n┌─────────────────────────────────────────────────────────┐");
  console.log("│ Test 2: POST /api/agent/chat/simple                     │");
  console.log("└─────────────────────────────────────────────────────────┘");

  if (!TEST_TOKEN) {
    console.log("⚠️  Skipped: TEST_AUTH_TOKEN non configuré");
    results.push({
      name: "POST /api/agent/chat/simple",
      success: true,
      skipped: true,
    });
    return;
  }

  const start = Date.now();

  try {
    const response = await fetchWithAuth("/api/agent/chat/simple", {
      method: "POST",
      body: JSON.stringify({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Bonjour, qui es-tu ?" }],
          },
        ],
        mode: "ask",
        workspaceId: "00000000-0000-0000-0000-000000000000",
        useWeb: false,
      }),
    });

    const data = await response.json();

    if (response.ok && data.success) {
      console.log("✅ Réponse reçue:");
      console.log(`   Texte: ${data.text?.slice(0, 100)}...`);
      console.log(`   Tool calls: ${data.toolCalls?.length || 0}`);
      console.log(`   Tokens: ${data.usage?.totalTokens || "N/A"}`);
      results.push({
        name: "POST /api/agent/chat/simple",
        success: true,
        duration: Date.now() - start,
      });
    } else {
      console.error("❌ Erreur:", data);
      results.push({
        name: "POST /api/agent/chat/simple",
        success: false,
        error: data.error || data.message || `Status ${response.status}`,
        duration: Date.now() - start,
      });
    }
  } catch (error) {
    console.error("❌ Erreur:", error);
    results.push({
      name: "POST /api/agent/chat/simple",
      success: false,
      error: String(error),
      duration: Date.now() - start,
    });
  }
}

/**
 * Test 3: POST /api/agent/chat (avec streaming SSE)
 */
async function testChatStreaming(): Promise<void> {
  console.log("\n┌─────────────────────────────────────────────────────────┐");
  console.log("│ Test 3: POST /api/agent/chat (streaming SSE)            │");
  console.log("└─────────────────────────────────────────────────────────┘");

  if (!TEST_TOKEN) {
    console.log("⚠️  Skipped: TEST_AUTH_TOKEN non configuré");
    results.push({
      name: "POST /api/agent/chat (streaming)",
      success: true,
      skipped: true,
    });
    return;
  }

  const start = Date.now();

  try {
    const response = await fetchWithAuth("/api/agent/chat", {
      method: "POST",
      body: JSON.stringify({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Qu'est-ce que l'IA ?" }],
          },
        ],
        mode: "ask",
        workspaceId: "00000000-0000-0000-0000-000000000000",
        useWeb: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Erreur HTTP ${response.status}:`, errorText);
      results.push({
        name: "POST /api/agent/chat (streaming)",
        success: false,
        error: `HTTP ${response.status}: ${errorText}`,
        duration: Date.now() - start,
      });
      return;
    }

    // Vérifier les headers SSE
    const contentType = response.headers.get("content-type");
    console.log(`📡 Content-Type: ${contentType}`);

    // Lire le stream SSE
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Pas de body dans la réponse");
    }

    const decoder = new TextDecoder();
    let fullText = "";
    let chunkCount = 0;

    console.log("📡 Lecture du stream...");

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      fullText += chunk;
      chunkCount++;

      // Afficher les premiers chunks pour debug
      if (chunkCount <= 3) {
        console.log(`   Chunk ${chunkCount}: ${chunk.slice(0, 80)}...`);
      }
    }

    console.log(`\n✅ Stream terminé:`);
    console.log(`   Chunks reçus: ${chunkCount}`);
    console.log(`   Taille totale: ${fullText.length} caractères`);
    console.log(`   Durée: ${Date.now() - start}ms`);

    // Vérifier le format (devrait contenir des events SSE)
    const hasSSEFormat =
      fullText.includes("data:") || fullText.includes('"type"');
    console.log(`   Format SSE valide: ${hasSSEFormat ? "✅" : "⚠️"}`);

    results.push({
      name: "POST /api/agent/chat (streaming)",
      success: true,
      duration: Date.now() - start,
    });
  } catch (error) {
    console.error("❌ Erreur:", error);
    results.push({
      name: "POST /api/agent/chat (streaming)",
      success: false,
      error: String(error),
      duration: Date.now() - start,
    });
  }
}

/**
 * Test 4: Validation des erreurs
 */
async function testValidationErrors(): Promise<void> {
  console.log("\n┌─────────────────────────────────────────────────────────┐");
  console.log("│ Test 4: Validation des erreurs                          │");
  console.log("└─────────────────────────────────────────────────────────┘");

  const start = Date.now();
  let allPassed = true;

  // Test sans messages
  try {
    const response = await fetchWithAuth("/api/agent/chat/simple", {
      method: "POST",
      body: JSON.stringify({
        mode: "ask",
        workspaceId: "test",
      }),
    });

    const data = await response.json();
    if (response.status === 400 && data.error === "VALIDATION_ERROR") {
      console.log("✅ Erreur validation sans messages: OK");
    } else {
      console.error("❌ Erreur validation sans messages: attendu 400");
      allPassed = false;
    }
  } catch (error) {
    console.error("❌ Erreur test validation:", error);
    allPassed = false;
  }

  // Test sans workspaceId
  try {
    const response = await fetchWithAuth("/api/agent/chat/simple", {
      method: "POST",
      body: JSON.stringify({
        messages: [{ role: "user", content: [{ type: "text", text: "test" }] }],
        mode: "ask",
      }),
    });

    const data = await response.json();
    if (response.status === 400 && data.error === "VALIDATION_ERROR") {
      console.log("✅ Erreur validation sans workspaceId: OK");
    } else {
      console.error("❌ Erreur validation sans workspaceId: attendu 400");
      allPassed = false;
    }
  } catch (error) {
    console.error("❌ Erreur test validation:", error);
    allPassed = false;
  }

  results.push({
    name: "Validation des erreurs",
    success: allPassed,
    duration: Date.now() - start,
  });
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("🤖 AI SDK Phase 1 - Test Route /api/agent/chat");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`📋 Backend URL: ${BASE_URL}`);
  console.log(
    `📋 Auth Token: ${TEST_TOKEN ? "✅ Configuré" : "❌ Non configuré (tests limités)"}`,
  );
  console.log("═══════════════════════════════════════════════════════════\n");

  // Vérifier que le backend est accessible
  try {
    const healthCheck = await fetch(`${BASE_URL}/health`);
    if (!healthCheck.ok) {
      console.error("❌ Backend non accessible sur", BASE_URL);
      console.error("   Lancez le backend avec: npm run dev");
      process.exit(1);
    }
    console.log("✅ Backend accessible\n");
  } catch (error) {
    console.error("❌ Backend non accessible sur", BASE_URL);
    console.error("   Lancez le backend avec: npm run dev");
    process.exit(1);
  }

  // Exécuter les tests
  await testGetModes();
  await testChatSimple();
  await testChatStreaming();
  await testValidationErrors();

  // Résumé final
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("📊 RÉSUMÉ DES TESTS");
  console.log("═══════════════════════════════════════════════════════════");

  const passed = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  const skipped = results.filter((r) => r.skipped).length;

  for (const result of results) {
    const icon = result.skipped ? "⏭️" : result.success ? "✅" : "❌";
    const suffix = result.skipped
      ? " (skipped)"
      : result.duration
        ? ` (${result.duration}ms)`
        : "";
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
