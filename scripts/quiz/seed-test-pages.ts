/**
 * 🌱 Seed Script - Créer des pages de test pour Quiz Intelligence
 * Crée des pages avec du contenu éducatif pour tester les services PEN-14 à PEN-18
 *
 * Usage:
 *   infisical run --env=dev --path=/Backend -- npx tsx scripts/quiz/seed-test-pages.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Contenu de test - pages éducatives variées
// Format BlockNote: tableau de blocs avec props (pas ProseMirror avec attrs)
const TEST_PAGES = [
  {
    title: "Les équations du second degré",
    icon: "📐",
    content: [
      {
        id: "h1-eq2",
        type: "heading",
        props: { level: 1 },
        content: [{ type: "text", text: "Équations du second degré" }],
        children: [],
      },
      {
        id: "p1-eq2",
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Une équation du second degré est une équation de la forme ax² + bx + c = 0 où a ≠ 0. Ces équations sont fondamentales en algèbre et apparaissent dans de nombreux problèmes de physique et d'ingénierie.",
          },
        ],
        children: [],
      },
      {
        id: "h2-disc",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "Le discriminant" }],
        children: [],
      },
      {
        id: "p2-disc",
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Le discriminant est défini par Δ = b² - 4ac. Cette valeur détermine le nombre et la nature des solutions.",
          },
        ],
        children: [],
      },
      {
        id: "p3-sol1",
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Si Δ > 0 : l'équation admet deux solutions réelles distinctes x₁ = (-b - √Δ) / 2a et x₂ = (-b + √Δ) / 2a",
          },
        ],
        children: [],
      },
      {
        id: "p4-sol2",
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Si Δ = 0 : l'équation admet une solution double x = -b / 2a",
          },
        ],
        children: [],
      },
      {
        id: "p5-sol3",
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Si Δ < 0 : l'équation n'admet pas de solution réelle, mais deux solutions complexes conjuguées.",
          },
        ],
        children: [],
      },
      {
        id: "h3-canon",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "Forme canonique" }],
        children: [],
      },
      {
        id: "p6-canon",
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Toute fonction polynôme du second degré peut s'écrire sous forme canonique : f(x) = a(x - α)² + β où α = -b/2a est l'abscisse du sommet et β = f(α) est l'ordonnée du sommet.",
          },
        ],
        children: [],
      },
    ],
  },
  {
    title: "Les fonctions dérivées",
    icon: "📈",
    content: [
      {
        id: "h1-deriv",
        type: "heading",
        props: { level: 1 },
        content: [{ type: "text", text: "Dérivation des fonctions" }],
        children: [],
      },
      {
        id: "p1-deriv",
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "La dérivée d'une fonction mesure son taux de variation instantané. Elle est fondamentale en analyse et en physique pour étudier les vitesses et les optimisations.",
          },
        ],
        children: [],
      },
      {
        id: "h2-def",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "Définition" }],
        children: [],
      },
      {
        id: "p2-def",
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "La dérivée de f en a est définie comme la limite : f'(a) = lim(h→0) [f(a+h) - f(a)] / h, lorsque cette limite existe.",
          },
        ],
        children: [],
      },
      {
        id: "h3-formules",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "Formules fondamentales" }],
        children: [],
      },
      {
        id: "p3-xn",
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Dérivée de xⁿ = n × xⁿ⁻¹ (formule de puissance)",
          },
        ],
        children: [],
      },
      {
        id: "p4-sin",
        type: "paragraph",
        content: [{ type: "text", text: "Dérivée de sin(x) = cos(x)" }],
        children: [],
      },
      {
        id: "p5-cos",
        type: "paragraph",
        content: [{ type: "text", text: "Dérivée de cos(x) = -sin(x)" }],
        children: [],
      },
      {
        id: "p6-exp",
        type: "paragraph",
        content: [{ type: "text", text: "Dérivée de eˣ = eˣ" }],
        children: [],
      },
      {
        id: "p7-ln",
        type: "paragraph",
        content: [{ type: "text", text: "Dérivée de ln(x) = 1/x" }],
        children: [],
      },
      {
        id: "h4-regles",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "Règles de calcul" }],
        children: [],
      },
      {
        id: "p8-regles",
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Règle du produit : (fg)' = f'g + fg'. Règle du quotient : (f/g)' = (f'g - fg') / g². Règle de la chaîne : (f∘g)' = (f'∘g) × g'",
          },
        ],
        children: [],
      },
    ],
  },
  {
    title: "La photosynthèse",
    icon: "🌿",
    content: [
      {
        id: "h1-photo",
        type: "heading",
        props: { level: 1 },
        content: [{ type: "text", text: "La photosynthèse" }],
        children: [],
      },
      {
        id: "p1-photo",
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "La photosynthèse est le processus biochimique par lequel les organismes photosynthétiques (plantes, algues, cyanobactéries) convertissent l'énergie lumineuse en énergie chimique.",
          },
        ],
        children: [],
      },
      {
        id: "h2-bilan",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "Équation bilan" }],
        children: [],
      },
      {
        id: "p2-bilan",
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "6 CO₂ + 6 H₂O + énergie lumineuse → C₆H₁₂O₆ + 6 O₂",
          },
        ],
        children: [],
      },
      {
        id: "p3-chloro",
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Cette réaction se déroule dans les chloroplastes, organites cellulaires contenant la chlorophylle.",
          },
        ],
        children: [],
      },
      {
        id: "h3-lum",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "Phase lumineuse" }],
        children: [],
      },
      {
        id: "p4-lum",
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "La phase lumineuse se déroule dans les thylakoïdes. La chlorophylle absorbe les photons et déclenche une chaîne de transport d'électrons qui produit de l'ATP et du NADPH.",
          },
        ],
        children: [],
      },
      {
        id: "h4-calvin",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "Cycle de Calvin" }],
        children: [],
      },
      {
        id: "p5-calvin",
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Le cycle de Calvin (phase sombre) se déroule dans le stroma. Il utilise l'ATP et le NADPH pour fixer le CO₂ et produire des glucides via l'enzyme RuBisCO.",
          },
        ],
        children: [],
      },
    ],
  },
  {
    title: "La respiration cellulaire",
    icon: "🔬",
    content: [
      {
        id: "h1-resp",
        type: "heading",
        props: { level: 1 },
        content: [{ type: "text", text: "Respiration cellulaire" }],
        children: [],
      },
      {
        id: "p1-resp",
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "La respiration cellulaire est un processus métabolique qui permet aux cellules de produire de l'énergie (ATP) à partir de molécules organiques, principalement le glucose.",
          },
        ],
        children: [],
      },
      {
        id: "h2-glyco",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "La glycolyse" }],
        children: [],
      },
      {
        id: "p2-glyco",
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "La glycolyse se déroule dans le cytoplasme. Une molécule de glucose (6 carbones) est convertie en deux molécules de pyruvate (3 carbones), produisant 2 ATP et 2 NADH.",
          },
        ],
        children: [],
      },
      {
        id: "h3-krebs",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "Cycle de Krebs" }],
        children: [],
      },
      {
        id: "p3-krebs",
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Le cycle de Krebs (ou cycle de l'acide citrique) se déroule dans la matrice mitochondriale. Il produit des coenzymes réduits (NADH, FADH₂) et du CO₂.",
          },
        ],
        children: [],
      },
      {
        id: "h4-chaine",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "Chaîne respiratoire" }],
        children: [],
      },
      {
        id: "p4-chaine",
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "La phosphorylation oxydative se déroule dans la membrane interne mitochondriale. Les électrons des coenzymes réduits passent par une chaîne de transporteurs, créant un gradient de protons qui permet la synthèse de 34-36 ATP.",
          },
        ],
        children: [],
      },
      {
        id: "p5-bilan",
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Bilan total : 1 glucose → 36-38 ATP + 6 CO₂ + 6 H₂O",
          },
        ],
        children: [],
      },
    ],
  },
  {
    title: "Les lois de Newton",
    icon: "🍎",
    content: [
      {
        id: "h1-newton",
        type: "heading",
        props: { level: 1 },
        content: [{ type: "text", text: "Les trois lois de Newton" }],
        children: [],
      },
      {
        id: "p1-newton",
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Les lois de Newton sont les trois lois fondamentales de la mécanique classique, énoncées par Isaac Newton en 1687 dans les Principia Mathematica.",
          },
        ],
        children: [],
      },
      {
        id: "h2-loi1",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "Première loi : Principe d'inertie" }],
        children: [],
      },
      {
        id: "p2-loi1",
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Un corps persévère dans son état de repos ou de mouvement rectiligne uniforme si et seulement si la somme des forces qui s'exercent sur lui est nulle (ΣF = 0).",
          },
        ],
        children: [],
      },
      {
        id: "h3-loi2",
        type: "heading",
        props: { level: 2 },
        content: [
          {
            type: "text",
            text: "Deuxième loi : Principe fondamental de la dynamique",
          },
        ],
        children: [],
      },
      {
        id: "p3-loi2",
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "L'accélération d'un corps est proportionnelle à la force résultante et inversement proportionnelle à sa masse : ΣF = m × a. Cette loi relie force, masse et accélération.",
          },
        ],
        children: [],
      },
      {
        id: "h4-loi3",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "Troisième loi : Action-réaction" }],
        children: [],
      },
      {
        id: "p4-loi3",
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Toute action entraîne une réaction égale et opposée : si un corps A exerce une force sur un corps B, alors B exerce sur A une force de même intensité, de même direction, mais de sens opposé.",
          },
        ],
        children: [],
      },
    ],
  },
];

async function main() {
  console.log("🌱 Seed Pages de Test - Quiz Intelligence\n");
  console.log("=".repeat(60));

  // 1. Connexion
  console.log("\n📡 1. Connexion à la base de données...");
  try {
    await prisma.$connect();
    console.log("   ✅ Connexion OK");
  } catch (error) {
    console.error("   ❌ Erreur connexion:", error);
    process.exit(1);
  }

  // 2. Trouver un utilisateur existant
  console.log("\n👤 2. Recherche d'un utilisateur...");
  const user = await prisma.user.findFirst();
  if (!user) {
    console.log("   ❌ Aucun utilisateur trouvé. Créez un compte d'abord.");
    process.exit(1);
  }
  console.log(`   ✅ Utilisateur: ${user.email || user.id}`);

  // 3. Trouver ou créer un workspace
  console.log("\n📁 3. Recherche/création du workspace...");
  let workspace = await prisma.workspace.findFirst({
    where: { ownerId: user.id },
  });

  if (!workspace) {
    workspace = await prisma.workspace.create({
      data: {
        name: "Test Intelligence",
        ownerId: user.id,
        icon: "🧪",
      },
    });
    console.log(`   ✅ Workspace créé: ${workspace.name}`);
  } else {
    console.log(`   ✅ Workspace existant: ${workspace.name}`);
  }

  // 4. Trouver ou créer un projet
  console.log("\n📚 4. Recherche/création du projet...");
  let project = await prisma.project.findFirst({
    where: { workspaceId: workspace.id },
  });

  if (!project) {
    project = await prisma.project.create({
      data: {
        name: "Cours de Sciences",
        workspace: { connect: { id: workspace.id } },
        owner: { connect: { id: user.id } },
      },
    });
    console.log(`   ✅ Projet créé: ${project.name}`);
  } else {
    console.log(`   ✅ Projet existant: ${project.name}`);
  }

  // 5. Créer les pages
  console.log("\n📄 5. Création des pages de test...");
  let created = 0;
  let skipped = 0;

  for (const pageData of TEST_PAGES) {
    const existing = await prisma.page.findFirst({
      where: {
        title: pageData.title,
        projectId: project.id,
      },
    });

    if (existing) {
      console.log(`   ⏭️ ${pageData.icon} ${pageData.title} (existe déjà)`);
      skipped++;
    } else {
      await prisma.page.create({
        data: {
          title: pageData.title,
          project: { connect: { id: project.id } },
          workspace: { connect: { id: workspace.id } },
          author: { connect: { id: user.id } },
          blockNoteContent: pageData.content,
          icon: pageData.icon,
        },
      });
      console.log(`   ✅ ${pageData.icon} ${pageData.title}`);
      created++;
    }
  }

  // 6. Résumé
  console.log("\n" + "=".repeat(60));
  console.log("📊 RÉSUMÉ");
  console.log("=".repeat(60));
  console.log(`   • Workspace: ${workspace.name} (${workspace.id})`);
  console.log(`   • Projet: ${project.name}`);
  console.log(`   • Pages créées: ${created}`);
  console.log(`   • Pages existantes: ${skipped}`);

  // 7. Vérification
  const totalPages = await prisma.page.count({
    where: {
      projectId: project.id,
      blockNoteContent: { not: undefined },
    },
  });
  console.log(`\n   📄 Total pages avec contenu: ${totalPages}`);

  console.log("\n" + "=".repeat(60));
  console.log("✅ SEED TERMINÉ");
  console.log("=".repeat(60));
  console.log("\n💡 Pour tester l'intégration:");
  console.log(`   npx tsx scripts/quiz/test-streaming-integration.ts ${workspace.id}`);
}

main()
  .catch((error) => {
    console.error("\n❌ ERREUR:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
