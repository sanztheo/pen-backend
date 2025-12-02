import { PrismaClient } from "@prisma/client";

declare global {
  var __prisma: PrismaClient | undefined;
}

// 🎯 Auto-détection environnement (local vs production)
const isProduction =
  process.env.NODE_ENV === "production" ||
  process.env.RAILWAY_ENVIRONMENT === "production";
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
    // 💻 DÉVELOPPEMENT: Configuration légère (augmentée pour streaming + tools)
    params.set("connection_limit", "20"); // 🔥 Augmenté: 20 connexions (streaming SSE + tools + cleanup)
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
        console.log(`✅ Reconnexion réussie après ${attempt} tentatives`);
      }
      return true;
    } catch (error: any) {
      const errorMessage = error.message || String(error);

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
        console.warn(
          `⚠️ [Tentative ${attempt}/${maxRetries}] Erreur connexion DB:`,
          errorMessage,
        );
        console.log(`🔄 Retry dans ${delayMs}ms...`);

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
          console.warn(`⚠️ Échec reconnexion (tentative ${attempt})`);
        }
      } else {
        console.error(
          `❌ Erreur DB définitive après ${attempt} tentatives:`,
          errorMessage,
        );
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
    console.log("⚠️ Keep-alive déjà actif");
    return;
  }

  // Ping la DB toutes les 5 minutes en production, 10 min en dev
  const intervalMs = isProduction ? 5 * 60 * 1000 : 10 * 60 * 1000;

  keepAliveInterval = setInterval(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      console.log(`💓 DB keep-alive [${isProduction ? "PROD" : "DEV"}]`);
    } catch (error: any) {
      console.error("❌ Keep-alive ping failed:", error.message);
      // Tenter une reconnexion automatique
      const reconnected = await ensureConnection(2);
      if (reconnected) {
        console.log("✅ Keep-alive: reconnexion automatique réussie");
      }
    }
  }, intervalMs);

  console.log(
    `✅ DB Keep-alive activé (ping toutes les ${intervalMs / 60000} min)`,
  );
}

export function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
    console.log("🛑 DB Keep-alive désactivé");
  }
}

// 🛡️ Gestion propre de l'arrêt
let isShuttingDown = false;

const gracefulShutdown = async (signal: string) => {
  if (isShuttingDown) {
    console.log(`⚠️ ${signal} déjà en cours, forcer l'arrêt...`);
    process.exit(1);
  }

  isShuttingDown = true;
  console.log(`🔄 ${signal} reçu, fermeture propre...`);

  try {
    // 1. Arrêter le keep-alive
    stopKeepAlive();

    // 2. Attendre un peu pour les dernières requêtes
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 3. Fermer les connexions Prisma
    await prisma.$disconnect();
    console.log("✅ Connexions DB fermées proprement");
  } catch (error) {
    console.error("❌ Erreur lors de la fermeture:", error);
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
    console.log(`🔄 beforeExit (code: ${code}), fermeture connexions...`);
    await prisma
      .$disconnect()
      .catch((err) => console.warn("⚠️ Erreur fermeture beforeExit:", err));
  }
});

// Gérer les erreurs non catchées
process.on("uncaughtException", async (error) => {
  console.error("❌ Exception non gérée:", error);
  if (!isShuttingDown) {
    stopKeepAlive();
    await prisma.$disconnect().catch(() => {});
  }
  process.exit(1);
});

process.on("unhandledRejection", async (reason, promise) => {
  console.error("❌ Promise rejetée non gérée:", reason);
  if (!isShuttingDown) {
    stopKeepAlive();
    await prisma.$disconnect().catch(() => {});
  }
  process.exit(1);
});

// 📊 Afficher la config au démarrage
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("🗄️  CONFIGURATION DATABASE PRISMA");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log(
  `📍 Environnement: ${isProduction ? "🚀 PRODUCTION" : "💻 DEVELOPMENT"}`,
);
console.log(
  `🔗 Connection Pool: ${isProduction ? "50 connexions max" : "30 connexions max"}`,
);
console.log(`⏱️  Timeouts: 30s statement, 60s idle transaction`);
console.log(`🔄 Auto-retry: Activé (3 tentatives max)`);
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

export default prisma;
