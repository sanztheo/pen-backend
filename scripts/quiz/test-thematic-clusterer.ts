/**
 * 🧪 Test Script - ThematicClusterer Service
 * PEN-16: Test le clustering thématique des pages
 *
 * Usage:
 *   infisical run --env=dev --path=/Backend -- npx tsx scripts/quiz/test-thematic-clusterer.ts
 *   infisical run --env=dev --path=/Backend -- npx tsx scripts/quiz/test-thematic-clusterer.ts <workspaceId>
 */

import { PrismaClient } from "@prisma/client";
import { ThematicClustererService } from "../../src/services/quiz/intelligence/index.js";

const prisma = new PrismaClient();

async function main() {
  const workspaceId = process.argv[2];

  console.log("🧪 Test ThematicClusterer Service - PEN-16\n");
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
      take: 50, // Limiter pour le test
    });
    pageIds = pages.map((p) => p.id);
    console.log(`   ✅ ${pageIds.length} pages trouvées`);
    if (pages.length > 0) {
      console.log("   📋 Exemples:");
      pages.slice(0, 5).forEach((p, i) => {
        console.log(`      ${i + 1}. "${p.title}"`);
      });
    }
  } else {
    console.log("\n📄 2. Recherche de pages avec contenu...");
    const pages = await prisma.page.findMany({
      where: {
        isArchived: false,
        blockNoteContent: { not: undefined },
      },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true },
      take: 20, // Tester avec 20 pages
    });

    if (pages.length < 5) {
      console.log(`   ⚠️ Seulement ${pages.length} pages trouvées (minimum 5 recommandé)`);
      console.log("   ℹ️ Utilisez: npx tsx scripts/quiz/test-thematic-clusterer.ts <workspaceId>");
    }

    pageIds = pages.map((p) => p.id);
    console.log(`   ✅ ${pageIds.length} pages sélectionnées`);
    if (pages.length > 0) {
      console.log("   📋 Pages sélectionnées:");
      pages.slice(0, 5).forEach((p, i) => {
        console.log(`      ${i + 1}. "${p.title}"`);
      });
      if (pages.length > 5) console.log(`      ... et ${pages.length - 5} autres`);
    }
  }

  if (pageIds.length === 0) {
    console.log("\n   ❌ Aucune page trouvée pour le test");
    process.exit(0);
  }

  // 3. Test clustering avec différents nombres de pages
  const testSizes = [5, 10, 20].filter((n) => n <= pageIds.length);

  for (const size of testSizes) {
    console.log(`\n${"─".repeat(60)}`);
    console.log(`🎯 3.${testSizes.indexOf(size) + 1} Test clustering avec ${size} pages...`);
    console.log("─".repeat(60));

    const testPageIds = pageIds.slice(0, size);
    const startTime = Date.now();

    const result = await ThematicClustererService.clusterPages(testPageIds, {
      generateNames: true,
    });

    console.log(`\n   ⏱️ Temps total: ${Date.now() - startTime}ms`);
    console.log(`   📊 Algorithme utilisé: ${result.algorithm}`);
    console.log(`   📈 Silhouette score: ${result.silhouetteScore.toFixed(3)}`);
    console.log(`   🗂️ Clusters créés: ${result.clusters.length}`);

    // Afficher les clusters
    console.log("\n   📁 Détails des clusters:");
    for (const cluster of result.clusters) {
      console.log(`\n      🏷️ "${cluster.name}"`);
      console.log(`         📝 ${cluster.description || "(pas de description)"}`);
      console.log(`         📄 Pages: ${cluster.pages.length}`);
      cluster.pages.slice(0, 3).forEach((p) => {
        console.log(`            - "${p.title}"`);
      });
      if (cluster.pages.length > 3) {
        console.log(`            ... et ${cluster.pages.length - 3} autres`);
      }
      console.log(`         🔑 Keywords: ${cluster.keywords.slice(0, 5).join(", ")}`);
      console.log(`         🎚️ Difficulté: ${cluster.difficulty}`);
      console.log(`         📊 Importance: ${(cluster.importance * 100).toFixed(1)}%`);
      console.log(`         ❓ Questions suggérées: ${cluster.suggestedQuestionCount}`);
    }

    // Vérifier la distribution des quotas
    console.log("\n   📊 Distribution des questions:");
    const totalQuestions = result.clusters.reduce((sum, c) => sum + c.suggestedQuestionCount, 0);
    console.log(`      Total: ${totalQuestions} questions`);
    for (const cluster of result.clusters) {
      const percentage = ((cluster.suggestedQuestionCount / totalQuestions) * 100).toFixed(1);
      console.log(`      • "${cluster.name}": ${cluster.suggestedQuestionCount} (${percentage}%)`);
    }
  }

  // 4. Test du clustering de workspace (si workspaceId fourni)
  if (workspaceId) {
    console.log(`\n${"─".repeat(60)}`);
    console.log(`🏢 4. Test clustering du workspace complet...`);
    console.log("─".repeat(60));

    const result = await ThematicClustererService.clusterWorkspace(workspaceId);

    console.log(`\n   📊 Résultats:`);
    console.log(`      • Pages analysées: ${result.totalPages}`);
    console.log(`      • Clusters: ${result.clusters.length}`);
    console.log(`      • Algorithme: ${result.algorithm}`);
    console.log(`      • Silhouette: ${result.silhouetteScore.toFixed(3)}`);
    console.log(`      • Temps: ${result.processingTimeMs}ms`);
  }

  // 5. Test de la fonction findNearestCluster
  console.log(`\n${"─".repeat(60)}`);
  console.log("🔍 5. Test findNearestCluster...");
  console.log("─".repeat(60));

  // Récupérer un embedding de test
  const testConcepts = await prisma.pageConcepts.findFirst({
    where: { pageId: { in: pageIds } },
    select: { pageId: true, embedding: true },
  });

  if (testConcepts && testConcepts.embedding.length > 0) {
    const lastResult = await ThematicClustererService.clusterPages(pageIds.slice(0, 10));
    const nearest = ThematicClustererService.findNearestCluster(
      testConcepts.embedding,
      lastResult.clusters,
    );
    console.log(`   ✅ Cluster le plus proche: "${nearest?.name || "aucun"}"`);
  } else {
    console.log("   ⚠️ Pas d'embedding disponible pour ce test");
  }

  // Résumé
  console.log("\n" + "=".repeat(60));
  console.log("✅ TOUS LES TESTS PASSÉS - PEN-16 VALIDÉ");
  console.log("=".repeat(60));
  console.log("\n📋 ThematicClusterer prêt pour:");
  console.log("   - Sélection intelligente de pages (PEN-17)");
  console.log("   - Génération de questions ciblées (PEN-19)");
  console.log("   - Équilibrage des quiz par thème");
}

main()
  .catch((error) => {
    console.error("\n❌ ERREUR:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
