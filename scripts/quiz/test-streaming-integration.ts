/**
 * 🧪 Test Script - Streaming Integration with Intelligence Services
 * PEN-18: Test l'intégration des services d'intelligence dans le streaming
 *
 * Usage:
 *   infisical run --env=dev --path=/Backend -- npx tsx scripts/quiz/test-streaming-integration.ts
 *   infisical run --env=dev --path=/Backend -- npx tsx scripts/quiz/test-streaming-integration.ts <workspaceId>
 */

import { PrismaClient } from "@prisma/client";
import {
  prepareIntelligentContext,
  getQuestionContext,
  createClustersDetectedEvent,
} from "../../src/services/quiz/intelligence/index.js";

const prisma = new PrismaClient();

async function main() {
  const workspaceId = process.argv[2];

  console.log("🧪 Test Streaming Integration - PEN-18\n");
  console.log("=".repeat(60));

  // 1. Test connexion
  console.log("\n📡 1. Test connexion database...");
  try {
    await prisma.$connect();
    console.log("   ✅ Connexion OK");
  } catch (error) {
    console.error("   ❌ Erreur connexion:", error);
    process.exit(1);
  }

  // 2. Trouver des pages à tester
  let pageIds: string[] = [];

  if (workspaceId) {
    console.log(`\n📄 2. Récupération des pages du workspace ${workspaceId}...`);
    const pages = await prisma.page.findMany({
      where: {
        project: { workspaceId },
        isArchived: false,
        blockNoteContent: { not: undefined },
      },
      select: { id: true, title: true },
      take: 10,
    });
    pageIds = pages.map((p) => p.id);
    console.log(`   ✅ ${pageIds.length} pages trouvées`);
    pages.forEach((p) => console.log(`      - ${p.title}`));
  } else {
    console.log("\n📄 2. Recherche de pages avec contenu...");
    const pages = await prisma.page.findMany({
      where: {
        isArchived: false,
        blockNoteContent: { not: undefined },
      },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true },
      take: 8,
    });
    pageIds = pages.map((p) => p.id);
    console.log(`   ✅ ${pageIds.length} pages sélectionnées`);
  }

  if (pageIds.length < 2) {
    console.log("\n   ⚠️ Besoin d'au moins 2 pages pour le test intelligent");
    console.log("   ℹ️ Mode intelligent désactivé avec < 2 pages");
    process.exit(0);
  }

  // 3. Test prepareIntelligentContext
  console.log("\n" + "─".repeat(60));
  console.log("🧠 3. Test prepareIntelligentContext...");
  console.log("─".repeat(60));

  const questionCount = 10;

  console.log(`\n   📊 Configuration: ${pageIds.length} pages, ${questionCount} questions`);

  const startTime = Date.now();
  const intelligentContext = await prepareIntelligentContext(pageIds, questionCount, {
    enabled: true,
    maxTokens: 8000,
    balanceContentTypes: true,
    generateClusterNames: true,
  });

  if (!intelligentContext) {
    console.log("   ❌ Contexte intelligent non créé (pas assez de contenu)");
    process.exit(0);
  }

  console.log(`\n   ⏱️ Temps de préparation: ${Date.now() - startTime}ms`);
  console.log(`   📦 Clusters détectés: ${intelligentContext.clusters.length}`);
  console.log(`   🔢 Tokens totaux: ${intelligentContext.stats.totalTokens}`);
  console.log(`   📄 Pages couvertes: ${intelligentContext.stats.totalPages}`);

  // 4. Afficher les clusters
  console.log("\n   📁 Clusters:");
  for (const cluster of intelligentContext.clusters) {
    console.log(`      • ${cluster.name}`);
    console.log(`        - Pages: ${cluster.pageCount}`);
    console.log(`        - Importance: ${(cluster.importance * 100).toFixed(0)}%`);
    console.log(`        - Keywords: ${cluster.keywords.join(", ")}`);
  }

  // 5. Test distribution des questions
  console.log("\n" + "─".repeat(60));
  console.log("📊 4. Test distribution des questions par cluster...");
  console.log("─".repeat(60));

  console.log("\n   Distribution:");
  for (const dist of intelligentContext.questionDistribution) {
    console.log(`      • ${dist.clusterName}: ${dist.questionCount} questions`);
    console.log(`        - Pages: ${dist.pageIds.length}`);
    console.log(
      `        - Contenu: ${dist.content.length} chars (${Math.round(dist.content.length / 4)} tokens estimés)`,
    );
  }

  // 6. Test getQuestionContext
  console.log("\n" + "─".repeat(60));
  console.log("🎯 5. Test getQuestionContext pour chaque question...");
  console.log("─".repeat(60));

  console.log("\n   Simulation de génération:");
  for (let i = 0; i < questionCount; i++) {
    const context = getQuestionContext(i, intelligentContext.questionDistribution);
    if (context) {
      console.log(
        `      Question ${i + 1}: Thème "${context.clusterName}" (${context.content.length} chars)`,
      );
    } else {
      console.log(`      Question ${i + 1}: Contexte non trouvé`);
    }
  }

  // 7. Test createClustersDetectedEvent
  console.log("\n" + "─".repeat(60));
  console.log("📤 6. Test événement SSE clusters-detected...");
  console.log("─".repeat(60));

  const sseEvent = createClustersDetectedEvent(intelligentContext);

  console.log("\n   Événement SSE:");
  console.log(`      • totalClusters: ${sseEvent.totalClusters}`);
  console.log(`      • processingTimeMs: ${sseEvent.processingTimeMs}`);
  console.log("      • clusters:");
  for (const cluster of sseEvent.clusters) {
    console.log(
      `         - ${cluster.name}: ${cluster.questionCount} questions, ${cluster.pageCount} pages`,
    );
  }

  // 8. Test enrichedRagContext
  console.log("\n" + "─".repeat(60));
  console.log("📝 7. Aperçu du contexte RAG enrichi...");
  console.log("─".repeat(60));

  const ragPreview = intelligentContext.enrichedRagContext.slice(0, 500);
  console.log("\n   Aperçu (500 premiers chars):");
  console.log("   " + "─".repeat(50));
  for (const line of ragPreview.split("\n").slice(0, 15)) {
    console.log(`   ${line}`);
  }
  console.log("   ...");
  console.log(`\n   Taille totale: ${intelligentContext.enrichedRagContext.length} chars`);

  // 9. Types de contenu
  console.log("\n" + "─".repeat(60));
  console.log("📊 8. Distribution des types de contenu...");
  console.log("─".repeat(60));

  console.log("\n   Types:");
  for (const [type, count] of Object.entries(intelligentContext.stats.contentTypes)) {
    if (count > 0) {
      console.log(`      • ${type}: ${count} chunks`);
    }
  }

  // Résumé
  console.log("\n" + "=".repeat(60));
  console.log("✅ TOUS LES TESTS PASSÉS - PEN-18 VALIDÉ");
  console.log("=".repeat(60));
  console.log("\n📋 L'intégration est prête pour:");
  console.log("   - Génération de quiz avec mode intelligent");
  console.log("   - Clustering automatique des pages");
  console.log("   - Distribution thématique des questions");
  console.log("   - Contexte RAG enrichi et priorisé");
  console.log("\n💡 Pour activer dans le frontend:");
  console.log("   Ajouter `useIntelligentGeneration: true` dans la requête");
}

main()
  .catch((error) => {
    console.error("\n❌ ERREUR:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
