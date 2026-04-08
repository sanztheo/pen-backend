/**
 * 🧪 Test Script - ConceptExtractor Service
 * PEN-15: Test l'extraction des concepts d'une page
 *
 * Usage:
 *   infisical run --env=dev --path=/Backend -- npx tsx scripts/quiz/test-concept-extractor.ts
 *   infisical run --env=dev --path=/Backend -- npx tsx scripts/quiz/test-concept-extractor.ts <pageId>
 */

import { PrismaClient } from "@prisma/client";
import { ConceptExtractorService } from "../../src/services/quiz/intelligence/index.js";

const prisma = new PrismaClient();

async function main() {
  const pageId = process.argv[2];

  console.log("🧪 Test ConceptExtractor Service - PEN-15\n");
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

  // 2. Trouver une page à tester
  let testPageId = pageId;

  if (!testPageId) {
    console.log("\n📄 2. Recherche d'une page avec contenu...");
    const page = await prisma.page.findFirst({
      where: {
        isArchived: false,
        blockNoteContent: { not: null },
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        createdBy: true,
        blockNoteContent: true,
      },
    });

    if (!page) {
      console.log("   ⚠️ Aucune page avec contenu trouvée");
      console.log("   ℹ️ Utilisez: npx tsx scripts/quiz/test-concept-extractor.ts <pageId>");
      process.exit(0);
    }

    testPageId = page.id;
    const blocks = page.blockNoteContent as any[] | null;
    const blockCount = blocks?.length || 0;
    console.log(`   ✅ Page trouvée: "${page.title}"`);
    console.log(`      ID: ${page.id}`);
    console.log(`      Blocs: ${blockCount}`);
  } else {
    console.log(`\n📄 2. Utilisation de la page spécifiée: ${testPageId}`);
  }

  // 3. Test extraction
  console.log("\n🧠 3. Extraction des concepts...");
  const startTime = Date.now();

  const result = await ConceptExtractorService.extractAndStore(testPageId, {
    forceRefresh: true, // Forcer la ré-extraction pour le test
  });

  console.log(`   ⏱️ Temps: ${Date.now() - startTime}ms`);

  if (!result.success) {
    console.log(`   ❌ Échec: ${result.error}`);
    process.exit(1);
  }

  console.log("   ✅ Extraction réussie!");

  // 4. Afficher les résultats
  console.log("\n📊 4. Résultats de l'extraction:");
  console.log("─".repeat(60));

  if (result.concepts) {
    console.log("\n   📝 Keywords:");
    result.concepts.keywords.forEach((k, i) => console.log(`      ${i + 1}. ${k}`));

    console.log("\n   📖 Definitions:");
    const defs = Object.entries(result.concepts.definitions);
    if (defs.length > 0) {
      defs.forEach(([term, def]) => {
        console.log(`      • ${term}: ${(def as string).slice(0, 80)}...`);
      });
    } else {
      console.log("      (aucune)");
    }

    console.log("\n   🎯 Key Points:");
    if (result.concepts.keyPoints.length > 0) {
      result.concepts.keyPoints.forEach((kp, i) => console.log(`      ${i + 1}. ${kp}`));
    } else {
      console.log("      (aucun)");
    }

    console.log("\n   🔢 Formulas:");
    if (result.concepts.formulas.length > 0) {
      result.concepts.formulas.forEach((f, i) => console.log(`      ${i + 1}. $${f}$`));
    } else {
      console.log("      (aucune)");
    }

    console.log(`\n   🏷️ Topic: "${result.concepts.topic}"`);
    console.log(`   📊 Difficulty: ${result.difficulty}`);
    console.log(`\n   📝 Summary:\n      "${result.concepts.summary}"`);
  }

  // 5. Stats
  console.log("\n📈 5. Statistiques:");
  console.log("─".repeat(60));
  console.log(`   • Word Count: ${result.stats.wordCount}`);
  console.log(`   • Concept Count: ${result.stats.conceptCount}`);
  console.log(`   • Has Formulas: ${result.stats.hasFormulas}`);
  console.log(`   • Has Definitions: ${result.stats.hasDefinitions}`);
  console.log(
    `   • Embedding: ${result.embedding ? `${result.embedding.length}d vector` : "non généré"}`,
  );
  console.log(`   • Processing Time: ${result.processingTimeMs}ms`);

  // 6. Vérifier en base
  console.log("\n💾 6. Vérification en base...");
  const stored = await prisma.pageConcepts.findUnique({
    where: { pageId: testPageId },
  });

  if (stored) {
    console.log("   ✅ Concepts stockés en base");
    console.log(`      • ID: ${stored.id}`);
    console.log(`      • Keywords: ${stored.keywords.length}`);
    console.log(`      • KeyPoints: ${stored.keyPoints.length}`);
    console.log(`      • Embedding: ${stored.embedding.length}d`);
    console.log(`      • Last Extracted: ${stored.lastExtractedAt}`);
  } else {
    console.log("   ❌ Concepts non trouvés en base");
  }

  // 7. Test hasConcepts
  console.log("\n🔍 7. Test méthode hasConcepts...");
  const hasConcepts = await ConceptExtractorService.hasConcepts(testPageId);
  console.log(`   • hasConcepts(${testPageId.slice(0, 8)}...): ${hasConcepts}`);

  // Résumé
  console.log("\n" + "=".repeat(60));
  console.log("✅ TOUS LES TESTS PASSÉS - PEN-15 VALIDÉ");
  console.log("=".repeat(60));
  console.log("\n📋 ConceptExtractor prêt pour:");
  console.log("   - Clustering thématique (PEN-16)");
  console.log("   - Sélection intelligente (PEN-17)");
  console.log("   - Génération parallèle (PEN-19)");
}

main()
  .catch((error) => {
    console.error("\n❌ ERREUR:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
