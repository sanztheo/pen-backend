/**
 * Reset complet de la base de donnees Prisma
 *
 * ATTENTION: Supprime TOUTES les donnees!
 *
 * Usage:
 *   npx tsx scripts/db/reset-database.ts          # Dry run (affiche ce qui sera supprime)
 *   npx tsx scripts/db/reset-database.ts --force  # Execute le reset
 */

import dotenv from "dotenv";
dotenv.config();

import { prisma } from "../../src/lib/prisma.js";

const isDryRun = !process.argv.includes("--force");

async function main() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🗑️  RESET DATABASE PRISMA");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(
    `Mode: ${isDryRun ? "🔍 DRY RUN (simulation)" : "⚠️  FORCE (suppression reelle)"}`,
  );
  console.log("");

  // Compter les enregistrements actuels
  console.log("📊 Contenu actuel de la base:");
  console.log("─────────────────────────────────────────────────────────────");

  const counts = {
    users: await prisma.user.count(),
    workspaces: await prisma.workspace.count(),
    projects: await prisma.project.count(),
    pages: await prisma.page.count(),
    userSubscriptions: await prisma.userSubscription.count(),
    userLimits: await prisma.userLimits.count(),
    quizzes: await prisma.quiz.count(),
    conversations: await prisma.aIConversation.count(),
    webhookEvents: await prisma.webhookEvent.count(),
  };

  for (const [table, count] of Object.entries(counts)) {
    console.log(`  ${table}: ${count} enregistrements`);
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log("");
  console.log(`  Total: ${total} enregistrements`);
  console.log("");

  if (isDryRun) {
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("🔍 MODE DRY RUN - Aucune donnee supprimee");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("");
    console.log("Pour executer le reset, relancez avec --force:");
    console.log("  npx tsx scripts/db/reset-database.ts --force");
    console.log("");
    await prisma.$disconnect();
    return;
  }

  // Confirmation pour --force
  console.log("⚠️  ATTENTION: Toutes les donnees vont etre SUPPRIMEES!");
  console.log("");

  // Suppression dans l'ordre (respect des foreign keys)
  console.log("🗑️  Suppression en cours...");
  console.log("─────────────────────────────────────────────────────────────");

  // Tables sans dependances d'abord, puis remonter
  const deletions = [
    { name: "WebhookEvent", fn: () => prisma.webhookEvent.deleteMany() },
    { name: "QuizQuestion", fn: () => prisma.quizQuestion.deleteMany() },
    { name: "QuizAnswer", fn: () => prisma.quizAnswer.deleteMany() },
    { name: "Quiz", fn: () => prisma.quiz.deleteMany() },
    { name: "QuizTemplate", fn: () => prisma.quizTemplate.deleteMany() },
    { name: "QuizSequence", fn: () => prisma.quizSequence.deleteMany() },
    { name: "AIMessage", fn: () => prisma.aIMessage.deleteMany() },
    { name: "AIConversation", fn: () => prisma.aIConversation.deleteMany() },
    { name: "Block", fn: () => prisma.block.deleteMany() },
    { name: "Page", fn: () => prisma.page.deleteMany() },
    { name: "Project", fn: () => prisma.project.deleteMany() },
    { name: "Workspace", fn: () => prisma.workspace.deleteMany() },
    {
      name: "UserSubscription",
      fn: () => prisma.userSubscription.deleteMany(),
    },
    { name: "UserLimits", fn: () => prisma.userLimits.deleteMany() },
    {
      name: "UserDashboardLayout",
      fn: () => prisma.userDashboardLayout.deleteMany(),
    },
    { name: "UserSettings", fn: () => prisma.userSettings.deleteMany() },
    { name: "DailyArticle", fn: () => prisma.dailyArticle.deleteMany() },
    { name: "Update", fn: () => prisma.update.deleteMany() },
    { name: "User", fn: () => prisma.user.deleteMany() },
  ];

  for (const { name, fn } of deletions) {
    try {
      const result = await fn();
      console.log(`  ✅ ${name}: ${result.count} supprime(s)`);
    } catch (error: any) {
      // Ignorer si la table n'existe pas
      if (error.code === "P2021") {
        console.log(`  ⏭️  ${name}: table inexistante`);
      } else {
        console.log(`  ❌ ${name}: ${error.message}`);
      }
    }
  }

  console.log("");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("✅ BASE DE DONNEES VIDEE");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("");
  console.log("Le schema est conserve, seules les donnees ont ete supprimees.");
  console.log("Les utilisateurs devront se reconnecter via Clerk.");
  console.log("");

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("❌ Erreur fatale:", error);
  process.exit(1);
});
