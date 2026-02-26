import { PrismaClient } from "@prisma/client";
import { logger } from "../utils/logger.js";

declare global {
  var __prisma: PrismaClient | undefined;
}

// 🎯 Auto-détection environnement (local vs production)
const isProduction =
  process.env.NODE_ENV === "production" || process.env.RAILWAY_ENVIRONMENT === "production";
const isDevelopment = process.env.NODE_ENV === "development";

// 🔧 Configuration dynamique selon l'environnement
const getDatabaseUrl = (): string => {
  const baseUrl = process.env.DATABASE_URL || "";

  if (!baseUrl) {
    throw new Error("❌ DATABASE_URL manquante dans .env");
  }

  // Paramètres optimisés selon l'environnement
  const params = new URLSearchParams();

  if (isProduction) {
    // 🚀 PRODUCTION: Configuration pour 1000+ utilisateurs simultanés
    params.set("connection_limit", "50"); // Max 50 connexions par instance
    params.set("pool_timeout", "20"); // 20s max d'attente pour connexion
    params.set("connect_timeout", "10"); // 10s timeout connexion initiale
    params.set("statement_timeout", "30000"); // 30s max par requête SQL
    params.set("idle_in_transaction_session_timeout", "60000"); // Ferme transactions inactives après 60s
  } else {
    // 💻 DÉVELOPPEMENT: Configuration optimisée (streaming + tools + workers)
    params.set("connection_limit", "30"); // 🔥 Optimisé: 30 connexions (streaming SSE + tools + workers + cleanup)
    params.set("pool_timeout", "20");
    params.set("connect_timeout", "10");
    params.set("statement_timeout", "30000");
    params.set("idle_in_transaction_session_timeout", "60000");
  }

  // Construire l'URL finale
  const hasParams = baseUrl.includes("?");
  return `${baseUrl}${hasParams ? "&" : "?"}${params.toString()}`;
};

// 📊 Instance singleton de PrismaClient avec configuration optimisée
export const prisma =
  globalThis.__prisma ||
  new PrismaClient({
    log: isProduction
      ? ["error"] // Production: seulement les erreurs
      : ["error", "warn"], // Dev: erreurs et warnings uniquement (queries cachées)

    datasources: {
      db: {
        url: getDatabaseUrl(),
      },
    },

    errorFormat: "minimal",

    // ⚡ Configuration transactions optimisée
    transactionOptions: {
      timeout: 30000, // 30s timeout pour transactions
      maxWait: 20000, // 20s max d'attente avant erreur
      isolationLevel: "ReadCommitted", // Isolation level équilibré
    },
  });

// En développement, éviter les reconnexions multiples lors des hot reloads
if (isDevelopment) {
  globalThis.__prisma = prisma;
}

// 🔄 Fonction de reconnexion intelligente avec retry exponentiel
export async function ensureConnection(maxRetries = 3): Promise<boolean> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      if (attempt > 1) {
        logger.log(`✅ Reconnexion réussie après ${attempt} tentatives`);
      }
      return true;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Détecter les erreurs de connexion
      const isConnectionError =
        errorMessage.includes("terminating connection") ||
        errorMessage.includes("Connection terminated") ||
        errorMessage.includes("ECONNRESET") ||
        errorMessage.includes("Connection closed") ||
        errorMessage.includes("timeout") ||
        errorMessage.includes("ECONNREFUSED");

      if (isConnectionError && attempt < maxRetries) {
        // Backoff exponentiel: 1s, 2s, 4s, etc.
        const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        logger.warn(`⚠️ [Tentative ${attempt}/${maxRetries}] Erreur connexion DB:`, errorMessage);
        logger.log(`🔄 Retry dans ${delayMs}ms...`);

        // Déconnecter proprement
        try {
          await prisma.$disconnect();
        } catch (disconnectError) {
          // Ignorer les erreurs de déconnexion
        }

        // Attendre avant retry
        await new Promise((resolve) => setTimeout(resolve, delayMs));

        // Reconnecter
        try {
          await prisma.$connect();
        } catch (connectError) {
          logger.warn(`⚠️ Échec reconnexion (tentative ${attempt})`);
        }
      } else {
        logger.error(`❌ Erreur DB définitive après ${attempt} tentatives:`, errorMessage);
        return false;
      }
    }
  }

  return false;
}

// 💓 Keep-alive automatique pour éviter les timeouts (important en production)
let keepAliveInterval: NodeJS.Timeout | null = null;

export function startKeepAlive() {
  if (keepAliveInterval) {
    logger.log("⚠️ Keep-alive déjà actif");
    return;
  }

  // Ping la DB toutes les 5 minutes en production, 10 min en dev
  const intervalMs = isProduction ? 5 * 60 * 1000 : 10 * 60 * 1000;

  keepAliveInterval = setInterval(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      logger.log(`💓 DB keep-alive [${isProduction ? "PROD" : "DEV"}]`);
    } catch (error: unknown) {
      logger.error(
        "❌ Keep-alive ping failed:",
        error instanceof Error ? error.message : String(error),
      );
      // Tenter une reconnexion automatique
      const reconnected = await ensureConnection(2);
      if (reconnected) {
        logger.log("✅ Keep-alive: reconnexion automatique réussie");
      }
    }
  }, intervalMs);

  logger.log(`✅ DB Keep-alive activé (ping toutes les ${intervalMs / 60000} min)`);
}

export function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
    logger.log("🛑 DB Keep-alive désactivé");
  }
}

// 🛡️ Gestion propre de l'arrêt
let isShuttingDown = false;

const gracefulShutdown = async (signal: string) => {
  if (isShuttingDown) {
    logger.log(`⚠️ ${signal} déjà en cours, forcer l'arrêt...`);
    process.exit(1);
  }

  isShuttingDown = true;
  logger.log(`🔄 ${signal} reçu, fermeture propre...`);

  try {
    // 1. Arrêter le keep-alive
    stopKeepAlive();

    // 2. Attendre un peu pour les dernières requêtes
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 3. Fermer les connexions Prisma
    await prisma.$disconnect();
    logger.log("✅ Connexions DB fermées proprement");
  } catch (error) {
    logger.error("❌ Erreur lors de la fermeture:", error);
  } finally {
    process.exit(0);
  }
};

// Capturer tous les signaux d'arrêt
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGUSR2", () => gracefulShutdown("SIGUSR2")); // nodemon

process.on("beforeExit", async (code) => {
  if (!isShuttingDown) {
    logger.log(`🔄 beforeExit (code: ${code}), fermeture connexions...`);
    await prisma.$disconnect().catch((err) => logger.warn("⚠️ Erreur fermeture beforeExit:", err));
  }
});

// Gérer les erreurs non catchées
process.on("uncaughtException", async (error) => {
  logger.error("❌ Exception non gérée:", error);
  if (!isShuttingDown) {
    stopKeepAlive();
    await prisma.$disconnect().catch(() => {});
  }
  process.exit(1);
});

process.on("unhandledRejection", async (reason, promise) => {
  logger.error("❌ Promise rejetée non gérée:", reason);
  if (!isShuttingDown) {
    stopKeepAlive();
    await prisma.$disconnect().catch(() => {});
  }
  process.exit(1);
});

// 📊 Afficher la config au démarrage
logger.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
logger.log("🗄️  CONFIGURATION DATABASE PRISMA");
logger.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
logger.log(`📍 Environnement: ${isProduction ? "🚀 PRODUCTION" : "💻 DEVELOPMENT"}`);
logger.log(`🔗 Connection Pool: ${isProduction ? "50 connexions max" : "30 connexions max"}`);
logger.log(`⏱️  Timeouts: 30s statement, 60s idle transaction`);
logger.log(`🔄 Auto-retry: Activé (3 tentatives max)`);
logger.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

// Named export uniquement - voir ligne 46 pour l'export principal
