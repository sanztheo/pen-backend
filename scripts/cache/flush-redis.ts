/**
 * Script pour vider complètement le cache Redis
 * Usage: npx tsx scripts/cache/flush-redis.ts [--force]
 *
 * Options:
 *   --force    Supprime tout sans confirmation (inclut les clés BullMQ)
 *   --cache    Supprime uniquement les clés de cache (pas BullMQ)
 */

import "dotenv/config";
import { Redis } from "ioredis";
import * as readline from "readline";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
console.log(`🔗 Connexion à: ${REDIS_URL.replace(/:[^:@]+@/, ":***@")}`);

const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  connectTimeout: 10000,
});

// Patterns de clés de cache applicatif
const CACHE_PATTERNS = [
  "limits:*",
  "workspace:*",
  "project:*",
  "default-workspace:*",
  "blocknote:*",
  "rag-session:*",
  "quota-usage:*",
  "sidebar:*",
  "quiz-history:*",
  "pennote:*",
  "rate-limit:*",
];

// Patterns BullMQ (queues de jobs)
const BULLMQ_PATTERNS = ["bull:*"];

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

const getKeysInfo = async (
  patterns: string[],
): Promise<{ keys: string[]; count: number }> => {
  const allKeys: string[] = [];

  for (const pattern of patterns) {
    const keys = await redis.keys(pattern);
    allKeys.push(...keys);
  }

  // Dédupliquer
  const uniqueKeys = [...new Set(allKeys)];
  return { keys: uniqueKeys, count: uniqueKeys.length };
};

const deleteKeys = async (keys: string[]): Promise<number> => {
  if (keys.length === 0) return 0;

  // Supprimer par batch de 100 pour éviter les timeouts
  let deleted = 0;
  const batchSize = 100;

  for (let i = 0; i < keys.length; i += batchSize) {
    const batch = keys.slice(i, i + batchSize);
    const result = await redis.del(...batch);
    deleted += result;
    process.stdout.write(`\r  Suppression: ${deleted}/${keys.length} clés...`);
  }

  console.log(); // Nouvelle ligne
  return deleted;
};

const confirm = async (message: string): Promise<boolean> => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${message} (y/N): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
};

const main = async () => {
  const args = process.argv.slice(2);
  const forceMode = args.includes("--force");
  const cacheOnly = args.includes("--cache");

  console.log("\n========================================");
  console.log("        REDIS CACHE FLUSH TOOL");
  console.log("========================================\n");

  try {
    // Test connexion
    const pong = await redis.ping();
    if (pong !== "PONG") {
      throw new Error("Redis ne répond pas correctement");
    }
    console.log("✅ Connexion Redis établie\n");

    // Récupérer les infos
    const dbSize = await redis.dbsize();
    const info = await redis.info("memory");
    const memoryMatch = info.match(/used_memory_human:(\S+)/);
    const memoryUsed = memoryMatch ? memoryMatch[1] : "N/A";

    console.log(`📊 Statistiques Redis:`);
    console.log(`   - Total clés: ${dbSize}`);
    console.log(`   - Mémoire utilisée: ${memoryUsed}\n`);

    // Analyser les clés par catégorie
    const cacheInfo = await getKeysInfo(CACHE_PATTERNS);
    const bullmqInfo = await getKeysInfo(BULLMQ_PATTERNS);

    console.log(`📦 Clés de cache applicatif: ${cacheInfo.count}`);
    console.log(`📦 Clés BullMQ (queues): ${bullmqInfo.count}\n`);

    if (cacheOnly) {
      // Mode cache uniquement
      if (cacheInfo.count === 0) {
        console.log("✨ Aucune clé de cache à supprimer");
        await redis.quit();
        process.exit(0);
      }

      if (!forceMode) {
        const shouldProceed = await confirm(
          `Supprimer ${cacheInfo.count} clés de cache?`,
        );
        if (!shouldProceed) {
          console.log("❌ Opération annulée");
          await redis.quit();
          process.exit(0);
        }
      }

      console.log("\n🗑️  Suppression des clés de cache...");
      const deleted = await deleteKeys(cacheInfo.keys);
      console.log(`✅ ${deleted} clés supprimées\n`);
    } else {
      // Mode complet (FLUSHALL)
      if (dbSize === 0) {
        console.log("✨ Redis est déjà vide");
        await redis.quit();
        process.exit(0);
      }

      if (!forceMode) {
        console.log(
          "⚠️  ATTENTION: Cette action va supprimer TOUTES les clés Redis!",
        );
        console.log("   Cela inclut les jobs BullMQ en attente.\n");
        const shouldProceed = await confirm(
          `Supprimer ${dbSize} clés (FLUSHALL)?`,
        );
        if (!shouldProceed) {
          console.log("❌ Opération annulée");
          await redis.quit();
          process.exit(0);
        }
      }

      console.log("\n🗑️  Exécution de FLUSHALL...");
      await redis.flushall();
      console.log("✅ Toutes les clés ont été supprimées\n");
    }

    // Vérification finale
    const finalSize = await redis.dbsize();
    console.log(`📊 État final: ${finalSize} clés restantes`);
    console.log("\n========================================");
    console.log("        NETTOYAGE TERMINÉ");
    console.log("========================================\n");
  } catch (error) {
    console.error("❌ Erreur:", error);
    process.exit(1);
  } finally {
    await redis.quit();
  }
};

main();
