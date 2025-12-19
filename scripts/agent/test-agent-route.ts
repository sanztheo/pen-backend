/**
 * 🤖 AI SDK Phase 1 - Test Route /api/agent/chat
 *
 * Ce script teste la route de l'agent avec streaming SSE.
 * Utilise un utilisateur réel de la base de données avec le mode test auth.
 *
 * Prérequis:
 * 1. Backend en cours d'exécution sur localhost:3001
 * 2. ENABLE_TEST_AUTH=true dans les variables d'environnement du backend
 * 3. NODE_ENV=development sur le backend
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Configuration
const BASE_URL = process.env.API_URL || "http://localhost:3001";

interface TestContext {
  userId: string;
  workspaceId: string;
  userEmail: string;
}

interface TestResult {
  name: string;
  success: boolean;
  skipped?: boolean;
  error?: string;
  duration?: number;
}

const results: TestResult[] = [];

/**
 * Récupère un utilisateur et un workspace depuis la base de données
 */
async function getTestContext(): Promise<TestContext | null> {
  try {
    // Chercher un utilisateur qui a au moins un workspace
    const user = await prisma.user.findFirst({
      where: {
        isActive: true,
        workspaces: {
          some: {},
        },
      },
      include: {
        workspaces: {
          where: { isArchived: false },
          take: 1,
        },
      },
    });

    if (!user || user.workspaces.length === 0) {
      console.error("❌ Aucun utilisateur avec un workspace trouvé dans la DB");
      return null;
    }

    return {
      userId: user.id,
      workspaceId: user.workspaces[0].id,
      userEmail: user.email,
    };
  } catch (error) {
    console.error("❌ Erreur accès base de données:", error);
    return null;
  }
}

/**
 * Helper pour faire des requêtes avec le header de test
 */
async function fetchWithTestAuth(
  endpoint: string,
  userId: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${BASE_URL}${endpoint}`;
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    "X-Test-User-Id": userId,
    ...(options.headers || {}),
  };

  return fetch(url, {
    ...options,
    headers,
  });
}

/**
 * Test 1: GET /api/agent/modes
 */
async function testGetModes(ctx: TestContext): Promise<void> {
  console.log("┌─────────────────────────────────────────────────────────┐");
  console.log("│ Test 1: GET /api/agent/modes                            │");
  console.log("└─────────────────────────────────────────────────────────┘");

  const start = Date.now();

  try {
    const response = await fetchWithTestAuth("/api/agent/modes", ctx.userId);
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
        error: `Status ${response.status}: ${JSON.stringify(data)}`,
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
async function testChatSimple(ctx: TestContext): Promise<void> {
  console.log("\n┌─────────────────────────────────────────────────────────┐");
  console.log("│ Test 2: POST /api/agent/chat/simple                     │");
  console.log("└─────────────────────────────────────────────────────────┘");

  const start = Date.now();

  try {
    const response = await fetchWithTestAuth(
      "/api/agent/chat/simple",
      ctx.userId,
      {
        method: "POST",
        body: JSON.stringify({
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: "Bonjour, qui es-tu ?" }],
            },
          ],
          mode: "ask",
          workspaceId: ctx.workspaceId,
          useWeb: false,
        }),
      },
    );

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
async function testChatStreaming(ctx: TestContext): Promise<void> {
  console.log("\n┌─────────────────────────────────────────────────────────┐");
  console.log("│ Test 3: POST /api/agent/chat (streaming SSE)            │");
  console.log("└─────────────────────────────────────────────────────────┘");

  const start = Date.now();

  try {
    const response = await fetchWithTestAuth("/api/agent/chat", ctx.userId, {
      method: "POST",
      body: JSON.stringify({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Qu'est-ce que l'IA ?" }],
          },
        ],
        mode: "ask",
        workspaceId: ctx.workspaceId,
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
async function testValidationErrors(ctx: TestContext): Promise<void> {
  console.log("\n┌─────────────────────────────────────────────────────────┐");
  console.log("│ Test 4: Validation des erreurs                          │");
  console.log("└─────────────────────────────────────────────────────────┘");

  const start = Date.now();
  let allPassed = true;

  // Test sans messages
  try {
    const response = await fetchWithTestAuth(
      "/api/agent/chat/simple",
      ctx.userId,
      {
        method: "POST",
        body: JSON.stringify({
          mode: "ask",
          workspaceId: ctx.workspaceId,
        }),
      },
    );

    const data = await response.json();
    if (response.status === 400 && data.error === "VALIDATION_ERROR") {
      console.log("✅ Erreur validation sans messages: OK");
    } else {
      console.error(
        "❌ Erreur validation sans messages: attendu 400, reçu",
        response.status,
      );
      allPassed = false;
    }
  } catch (error) {
    console.error("❌ Erreur test validation:", error);
    allPassed = false;
  }

  // Test sans workspaceId
  try {
    const response = await fetchWithTestAuth(
      "/api/agent/chat/simple",
      ctx.userId,
      {
        method: "POST",
        body: JSON.stringify({
          messages: [
            { role: "user", content: [{ type: "text", text: "test" }] },
          ],
          mode: "ask",
        }),
      },
    );

    const data = await response.json();
    if (response.status === 400 && data.error === "VALIDATION_ERROR") {
      console.log("✅ Erreur validation sans workspaceId: OK");
    } else {
      console.error(
        "❌ Erreur validation sans workspaceId: attendu 400, reçu",
        response.status,
      );
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

  // Récupérer un utilisateur et workspace de test
  console.log("🔍 Recherche d'un utilisateur de test dans la DB...");
  const testContext = await getTestContext();

  if (!testContext) {
    console.error("\n❌ Impossible de trouver un utilisateur de test.");
    console.error(
      "   Assurez-vous qu'il existe au moins un utilisateur avec un workspace.",
    );
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(`✅ Utilisateur de test trouvé:`);
  console.log(`   ID: ${testContext.userId}`);
  console.log(`   Email: ${testContext.userEmail}`);
  console.log(`   Workspace: ${testContext.workspaceId}\n`);

  console.log("⚠️  Assurez-vous que le backend a ENABLE_TEST_AUTH=true\n");

  // Exécuter les tests
  await testGetModes(testContext);
  await testChatSimple(testContext);
  await testChatStreaming(testContext);
  await testValidationErrors(testContext);

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
    if (!result.success && result.error) {
      console.log(`      └─ ${result.error}`);
    }
  }

  console.log("───────────────────────────────────────────────────────────");
  console.log(
    `  Total: ${results.length} | ✅ Réussis: ${passed - skipped} | ⏭️ Skipped: ${skipped} | ❌ Échoués: ${failed}`,
  );
  console.log("═══════════════════════════════════════════════════════════");

  // Fermer la connexion Prisma
  await prisma.$disconnect();

  if (failed > 0) {
    console.log("\n🔴 CERTAINS TESTS ONT ÉCHOUÉ");
    process.exit(1);
  } else {
    console.log("\n🟢 TOUS LES TESTS ONT RÉUSSI");
    process.exit(0);
  }
}

main().catch(async (error) => {
  console.error("💥 Erreur fatale:", error);
  await prisma.$disconnect();
  process.exit(1);
});
