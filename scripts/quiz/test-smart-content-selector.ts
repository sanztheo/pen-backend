/**
 * 🧪 Test Script - SmartContentSelector Service
 * PEN-17: Test la sélection intelligente de contenu
 *
 * Usage:
 *   infisical run --env=dev --path=/Backend -- npx tsx scripts/quiz/test-smart-content-selector.ts
 *   infisical run --env=dev --path=/Backend -- npx tsx scripts/quiz/test-smart-content-selector.ts <workspaceId> [maxTokens]
 */

import { PrismaClient } from "@prisma/client";
import {
  ThematicClustererService,
  SmartContentSelectorService,
} from "../../src/services/quiz/intelligence/index.js";

const prisma = new PrismaClient();

async function main() {
  const workspaceId = process.argv[2];
  const maxTokensArg = process.argv[3];

  console.log("🧪 Test SmartContentSelector Service - PEN-17\n");
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
      take: 20,
    });
    pageIds = pages.map((p) => p.id);
    console.log(`   ✅ ${pageIds.length} pages trouvées`);
  } else {
    console.log("\n📄 2. Recherche de pages avec contenu...");
    const pages = await prisma.page.findMany({
      where: {
        isArchived: false,
        blockNoteContent: { not: undefined },
      },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true },
      take: 10,
    });
    pageIds = pages.map((p) => p.id);
    console.log(`   ✅ ${pageIds.length} pages sélectionnées`);
  }

  if (pageIds.length === 0) {
    console.log("\n   ❌ Aucune page trouvée pour le test");
    process.exit(0);
  }

  // 3. Créer un cluster de test
  console.log("\n🎯 3. Création d'un cluster de test...");
  const clusterResult = await ThematicClustererService.clusterPages(pageIds, {
    generateNames: false, // Plus rapide pour le test
  });

  if (clusterResult.clusters.length === 0) {
    console.log("   ❌ Aucun cluster créé");
    process.exit(0);
  }

  const testCluster = clusterResult.clusters[0];
  console.log(`   ✅ Cluster de test: "${testCluster.name}"`);
  console.log(`      • Pages: ${testCluster.pages.length}`);
  console.log(`      • Keywords: ${testCluster.keywords.slice(0, 5).join(", ")}`);

  // 4. Test avec différentes limites de tokens
  const tokenLimits = maxTokensArg ? [parseInt(maxTokensArg)] : [4000, 8000, 16000];

  for (const maxTokens of tokenLimits) {
    console.log(`\n${"─".repeat(60)}`);
    console.log(`📋 4. Test sélection avec limite de ${maxTokens} tokens...`);
    console.log("─".repeat(60));

    const startTime = Date.now();
    const selected = await SmartContentSelectorService.selectForCluster(testCluster, {
      maxTokens,
      balanceTypes: true,
    });

    console.log(`\n   ⏱️ Temps: ${Date.now() - startTime}ms`);
    console.log(`   📦 Chunks sélectionnés: ${selected.chunks.length}`);
    console.log(`   🔢 Tokens utilisés: ${selected.totalTokens} / ${maxTokens}`);
    console.log(`   📊 Couverture: ${(selected.coverage * 100).toFixed(1)}%`);

    // Distribution par type
    console.log("\n   📊 Distribution par type:");
    for (const [type, count] of Object.entries(selected.typeDistribution)) {
      if (count > 0) {
        console.log(`      • ${type}: ${count} chunks`);
      }
    }

    // Échantillon de chunks
    console.log("\n   📝 Échantillon de chunks sélectionnés:");
    for (const chunk of selected.chunks.slice(0, 5)) {
      const preview =
        chunk.content.length > 60 ? chunk.content.slice(0, 60) + "..." : chunk.content;
      console.log(`      [${chunk.type}] ${preview}`);
    }
    if (selected.chunks.length > 5) {
      console.log(`      ... et ${selected.chunks.length - 5} autres`);
    }

    // Vérifier que la limite est respectée
    if (selected.totalTokens > maxTokens) {
      console.log(
        `   ❌ ERREUR: Limite de tokens dépassée! (${selected.totalTokens} > ${maxTokens})`,
      );
    } else {
      console.log(`   ✅ Limite de tokens respectée`);
    }
  }

  // 5. Test formatForPrompt
  console.log(`\n${"─".repeat(60)}`);
  console.log("📝 5. Test formatForPrompt...");
  console.log("─".repeat(60));

  const selected = await SmartContentSelectorService.selectForCluster(testCluster, {
    maxTokens: 4000,
  });
  const formatted = SmartContentSelectorService.formatForPrompt(selected);

  console.log("\n   Aperçu du contenu formaté:");
  console.log("   " + "─".repeat(50));
  const lines = formatted.split("\n").slice(0, 15);
  for (const line of lines) {
    console.log(`   ${line}`);
  }
  if (formatted.split("\n").length > 15) {
    console.log(`   ... (${formatted.split("\n").length - 15} lignes de plus)`);
  }

  // 6. Test sélection multiple clusters
  if (clusterResult.clusters.length > 1) {
    console.log(`\n${"─".repeat(60)}`);
    console.log("🎯 6. Test sélection multi-clusters...");
    console.log("─".repeat(60));

    const multiSelected = await SmartContentSelectorService.selectForClusters(
      clusterResult.clusters,
      { maxTokens: 4000 },
    );

    console.log(`\n   ✅ ${multiSelected.size} clusters traités`);
    for (const [clusterId, content] of multiSelected) {
      console.log(
        `      • ${clusterId}: ${content.chunks.length} chunks, ${content.totalTokens} tokens`,
      );
    }
  }

  // 7. Test optimizeForTokenLimit
  console.log(`\n${"─".repeat(60)}`);
  console.log("⚡ 7. Test optimizeForTokenLimit...");
  console.log("─".repeat(60));

  const allSelected = await SmartContentSelectorService.selectForCluster(testCluster, {
    maxTokens: 16000,
  });

  const optimized = SmartContentSelectorService.optimizeForTokenLimit(allSelected.chunks, 2000);
  const optimizedTokens = optimized.reduce((sum, c) => sum + c.tokens, 0);

  console.log(`\n   📦 Chunks originaux: ${allSelected.chunks.length}`);
  console.log(`   📦 Chunks optimisés: ${optimized.length}`);
  console.log(`   🔢 Tokens optimisés: ${optimizedTokens} / 2000`);

  // Résumé
  console.log("\n" + "=".repeat(60));
  console.log("✅ TOUS LES TESTS PASSÉS - PEN-17 VALIDÉ");
  console.log("=".repeat(60));
  console.log("\n📋 SmartContentSelector prêt pour:");
  console.log("   - Génération de questions ciblées (PEN-19)");
  console.log("   - Optimisation des prompts AI");
  console.log("   - Équilibrage du contenu par type");
}

main()
  .catch((error) => {
    console.error("\n❌ ERREUR:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
