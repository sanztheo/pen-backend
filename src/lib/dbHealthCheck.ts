import { prisma } from "./prisma.js";
import { logger } from "../utils/logger.js";

export class DatabaseHealthCheck {
  // 🩺 Diagnostic complet de la connexion
  static async runDiagnostic(): Promise<{
    status: "healthy" | "warning" | "error";
    details: {
      connection: boolean;
      latency: number | null;
      poolStatus: unknown;
      serverInfo: unknown;
      timestamp: Date;
    };
    recommendations?: string[];
  }> {
    const startTime = Date.now();
    const result: {
      status: "healthy" | "warning" | "error";
      details: {
        connection: boolean;
        latency: number | null;
        poolStatus: unknown;
        serverInfo: unknown;
        timestamp: Date;
      };
      recommendations: string[];
    } = {
      status: "error",
      details: {
        connection: false,
        latency: null,
        poolStatus: null,
        serverInfo: null,
        timestamp: new Date(),
      },
      recommendations: [],
    };

    try {
      // Test de connexion simple
      logger.log("🩺 [DB-HEALTH] Test de connexion...");
      await prisma.$queryRaw`SELECT 1 as test`;
      result.details.connection = true;
      result.details.latency = Date.now() - startTime;

      // Informations sur le serveur
      try {
        const serverInfo =
          await prisma.$queryRaw`SELECT version() as version, current_database() as database, current_user as user`;
        result.details.serverInfo = serverInfo;
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn("⚠️ Impossible de récupérer les infos serveur:", errorMessage);
      }

      // Évaluation de la santé
      if (result.details.latency < 1000) {
        result.status = "healthy";
      } else if (result.details.latency < 5000) {
        result.status = "warning";
        result.recommendations.push(
          "Latence élevée détectée (>1s), vérifiez votre connexion réseau",
        );
      } else {
        result.status = "warning";
        result.recommendations.push("Latence très élevée (>5s), problème de réseau probable");
      }

      logger.log(`✅ [DB-HEALTH] Connexion OK - Latence: ${result.details.latency}ms`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("❌ [DB-HEALTH] Connexion échouée:", errorMessage);
      result.status = "error";
      result.details.connection = false;

      // Recommandations selon le type d'erreur
      if (errorMessage.includes("Can't reach database server")) {
        result.recommendations.push(
          "Serveur Neon inaccessible - Vérifiez:",
          "1. Votre connexion internet",
          "2. Si Neon est en maintenance",
          "3. Si votre instance Neon est en hibernation (plan gratuit)",
        );
      } else if (errorMessage.includes("timeout")) {
        result.recommendations.push(
          "Timeout de connexion - Essayez:",
          "1. Relancer l'application",
          "2. Vérifier la latence réseau",
          "3. Attendre quelques minutes (réveil Neon)",
        );
      } else {
        result.recommendations.push("Erreur de connexion inconnue:", errorMessage);
      }
    }

    return result;
  }

  // 🔄 Test de connexion avec retry
  static async testConnectionWithRetry(maxRetries: number = 3): Promise<boolean> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.log(`🔄 [DB-HEALTH] Tentative ${attempt}/${maxRetries}...`);
        const diagnostic = await this.runDiagnostic();

        if (diagnostic.status !== "error") {
          logger.log(`✅ [DB-HEALTH] Connexion établie en ${attempt} tentative(s)`);
          return true;
        }

        if (attempt < maxRetries) {
          const delay = 2000 * attempt; // 2s, 4s, 6s...
          logger.log(`⏳ [DB-HEALTH] Attente ${delay}ms avant retry...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`❌ [DB-HEALTH] Tentative ${attempt} échouée:`, errorMessage);
      }
    }

    logger.error(`❌ [DB-HEALTH] Toutes les tentatives ont échoué`);
    return false;
  }

  // 📊 Affichage formaté du diagnostic
  static async displayDiagnostic(): Promise<void> {
    logger.log("\n🩺 ===== DIAGNOSTIC BASE DE DONNÉES =====");

    const diagnostic = await this.runDiagnostic();

    logger.log(`📋 Statut: ${diagnostic.status.toUpperCase()}`);
    logger.log(`🔗 Connexion: ${diagnostic.details.connection ? "✅ OK" : "❌ Échec"}`);

    if (diagnostic.details.latency) {
      const latencyIcon =
        diagnostic.details.latency < 1000 ? "🟢" : diagnostic.details.latency < 5000 ? "🟡" : "🔴";
      logger.log(`⏱️  Latence: ${latencyIcon} ${diagnostic.details.latency}ms`);
    }

    if (diagnostic.details.serverInfo) {
      logger.log(`🖥️  Serveur: ${JSON.stringify(diagnostic.details.serverInfo)}`);
    }

    if (diagnostic.recommendations && diagnostic.recommendations.length > 0) {
      logger.log("\n💡 Recommandations:");
      diagnostic.recommendations.forEach((rec) => logger.log(`   - ${rec}`));
    }

    logger.log("==========================================\n");
  }
}
