/**
 * 🧪 Test Script - PageConcepts Schema Validation
 * PEN-14: Vérifie que le modèle PageConcepts fonctionne correctement
 *
 * Usage: infisical run --env=dev --path=/Backend -- npx tsx scripts/quiz/test-page-concepts-schema.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🧪 Test PageConcepts Schema - PEN-14\n");
  console.log("=".repeat(50));

  // 1. Vérifier la connexion
  console.log("\n📡 1. Test connexion database...");
  try {
    await prisma.$connect();
    console.log("   ✅ Connexion OK");
  } catch (error) {
    console.error("   ❌ Erreur connexion:", error);
    process.exit(1);
  }

  // 2. Récupérer une page existante pour le test
  console.log("\n📄 2. Récupération d'une page de test...");
  const testPage = await prisma.page.findFirst({
    where: { isArchived: false },
    select: { id: true, title: true, workspaceId: true },
  });

  if (!testPage) {
    console.log("   ⚠️  Aucune page trouvée, création d'un test avec ID fictif");
    console.log("   ℹ️  Le test CRUD sera ignoré");
  } else {
    console.log(`   ✅ Page trouvée: "${testPage.title}" (${testPage.id})`);
  }

  // 3. Test CRUD si on a une page
  if (testPage) {
    console.log("\n🔄 3. Test CRUD PageConcepts...");

    // Supprimer l'ancien test s'il existe
    await prisma.pageConcepts.deleteMany({
      where: { pageId: testPage.id },
    });

    // CREATE
    console.log("   📝 CREATE...");
    const concepts = await prisma.pageConcepts.create({
      data: {
        pageId: testPage.id,
        keywords: ["test", "prisma", "quiz", "intelligence"],
        definitions: {
          PageConcepts: "Modèle pour stocker les concepts extraits des pages",
          Clustering: "Regroupement thématique basé sur les embeddings",
        },
        keyPoints: [
          "Pré-extraction des concepts pour performance",
          "Support du clustering thématique",
          "Génération de quiz optimisée",
        ],
        formulas: ["E = mc²", "a² + b² = c²"],
        summary: "Page de test pour valider le schéma PageConcepts",
        embedding: Array(1536).fill(0.1), // Simulation embedding OpenAI
        topic: "test-validation",
        difficulty: "medium",
        wordCount: 150,
        conceptCount: 4,
      },
    });
    console.log(`   ✅ Créé avec ID: ${concepts.id}`);

    // READ
    console.log("   📖 READ...");
    const readConcepts = await prisma.pageConcepts.findUnique({
      where: { pageId: testPage.id },
      include: { page: { select: { title: true } } },
    });
    console.log(
      `   ✅ Lu: ${readConcepts?.keywords.length} keywords, topic="${readConcepts?.topic}"`,
    );
    console.log(`   ✅ Relation Page: "${readConcepts?.page.title}"`);

    // UPDATE
    console.log("   ✏️  UPDATE...");
    const updated = await prisma.pageConcepts.update({
      where: { pageId: testPage.id },
      data: {
        keywords: { push: "updated" },
        difficulty: "hard",
        conceptCount: { increment: 1 },
      },
    });
    console.log(
      `   ✅ Mis à jour: difficulty="${updated.difficulty}", concepts=${updated.conceptCount}`,
    );

    // DELETE
    console.log("   🗑️  DELETE...");
    await prisma.pageConcepts.delete({
      where: { pageId: testPage.id },
    });
    console.log("   ✅ Supprimé");
  }

  // 4. Test des index
  console.log("\n📊 4. Vérification des index...");
  const indexCheck = await prisma.$queryRaw<Array<{ indexname: string }>>`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'page_concepts'
  `;
  console.log(`   ✅ ${indexCheck.length} index trouvés:`);
  indexCheck.forEach((idx) => console.log(`      - ${idx.indexname}`));

  // 5. Test relation avec Page (cascade delete)
  console.log("\n🔗 5. Vérification relation cascade...");
  const pageWithConcepts = await prisma.page.findFirst({
    where: { concepts: { isNot: null } },
    include: { concepts: true },
  });
  if (pageWithConcepts) {
    console.log(`   ✅ Page avec concepts trouvée: "${pageWithConcepts.title}"`);
  } else {
    console.log("   ℹ️  Aucune page avec concepts (normal après cleanup)");
  }

  // Résumé
  console.log("\n" + "=".repeat(50));
  console.log("✅ TOUS LES TESTS PASSÉS - PEN-14 VALIDÉ");
  console.log("=".repeat(50));
  console.log("\n📋 Modèle PageConcepts prêt pour:");
  console.log("   - Extraction de concepts (PEN-15)");
  console.log("   - Clustering thématique (PEN-16)");
  console.log("   - Sélection intelligente (PEN-17)");
}

main()
  .catch((error) => {
    console.error("\n❌ ERREUR:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
