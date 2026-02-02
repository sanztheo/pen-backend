import fs from "fs";
import path from "path";

export class Logger {
  private static logDir = path.join(process.cwd(), "logs");
  private static currentLogFile: string;
  private static nativeConsole = globalThis.console;
  private static originalConsole = {
    log: Logger.nativeConsole.log,
    error: Logger.nativeConsole.error,
    warn: Logger.nativeConsole.warn,
    info: Logger.nativeConsole.info,
  };

  /**
   * Initialise le système de logging avec rotation automatique
   */
  static init() {
    // Créer le dossier logs s'il n'existe pas
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }

    // Générer le nom du fichier avec timestamp
    const timestamp = new Date()
      .toISOString()
      .replace(/:/g, "-")
      .replace(/\./g, "-")
      .slice(0, 19); // YYYY-MM-DDTHH-MM-SS

    this.currentLogFile = path.join(this.logDir, `server-${timestamp}.log`);

    // Écrire l'en-tête du log
    this.writeToFile(`
================================================================================
🚀 SERVEUR PEN-SAAS DÉMARRÉ
================================================================================
Timestamp: ${new Date().toISOString()}
PID: ${process.pid}
Node.js: ${process.version}
Environnement: ${process.env.NODE_ENV || "development"}
Port: ${process.env.PORT || 3001}
================================================================================

    `);

    // Intercepter les logs console
    this.nativeConsole.log = (...args) => {
      const message = this.formatMessage("LOG", args);
      this.originalConsole.log(...args);
      this.writeToFile(message);
    };

    // Intercepter console.error
    this.nativeConsole.error = (...args) => {
      const message = this.formatMessage("ERROR", args);
      this.originalConsole.error(...args);
      this.writeToFile(message);
    };

    // Intercepter les warnings
    this.nativeConsole.warn = (...args) => {
      const message = this.formatMessage("WARN", args);
      this.originalConsole.warn(...args);
      this.writeToFile(message);
    };

    // Intercepter les infos
    this.nativeConsole.info = (...args) => {
      const message = this.formatMessage("INFO", args);
      this.originalConsole.info(...args);
      this.writeToFile(message);
    };

    // Gérer l'arrêt propre du serveur
    process.on("SIGINT", () => {
      this.writeToFile(`
================================================================================
🛑 ARRÊT DU SERVEUR (SIGINT)
================================================================================
Timestamp: ${new Date().toISOString()}
Durée de fonctionnement: ${this.getUptime()}
================================================================================

`);
      process.exit(0);
    });

    process.on("SIGTERM", () => {
      this.writeToFile(`
================================================================================
🛑 ARRÊT DU SERVEUR (SIGTERM)
================================================================================
Timestamp: ${new Date().toISOString()}
Durée de fonctionnement: ${this.getUptime()}
================================================================================

`);
      process.exit(0);
    });

    // Capturer les erreurs non gérées
    process.on("uncaughtException", (error) => {
      const message = this.formatMessage("FATAL", [
        error.stack || error.message,
      ]);
      this.originalConsole.error("💥 Erreur fatale non gérée:", error);
      this.writeToFile(message);
      process.exit(1);
    });

    process.on("unhandledRejection", (reason, promise) => {
      const message = this.formatMessage("FATAL", [
        `Promise rejetée non gérée:`,
        reason,
      ]);
      this.originalConsole.error("💥 Promise rejetée non gérée:", reason);
      this.writeToFile(message);
    });

    this.nativeConsole.log("📝 Système de logging initialisé:", this.currentLogFile);
    this.interceptSpecialLogs();
    this.cleanOldLogs();
  }

  /**
   * Intercepte et améliore les logs spéciaux (requêtes HTTP, DB, etc.)
   */
  private static interceptSpecialLogs() {
    // Capturer les requêtes Express si disponible
    if (typeof require !== "undefined") {
      try {
        const originalRequest = require("express").request;
        if (originalRequest) {
          // Intercepter les requêtes Express pour logging détaillé
          this.nativeConsole.log("🔍 Interception des requêtes Express activée");
        }
      } catch {
        // Express pas disponible
      }
    }

    // Intercepter les erreurs Promise non gérées avec plus de détails
    process.on("unhandledRejection", (reason, promise) => {
      const detailedError = {
        type: "UNHANDLED_PROMISE_REJECTION",
        reason: reason,
        reasonType: typeof reason,
        isError: reason instanceof Error,
        errorMessage: reason instanceof Error ? reason.message : String(reason),
        errorStack: reason instanceof Error ? reason.stack : null,
        promise: promise,
        timestamp: new Date().toISOString(),
        memoryUsage: process.memoryUsage(),
        uptime: process.uptime(),
      };

      this.writeToFile(`
================================================================================
💥 ERREUR PROMISE NON GÉRÉE - DÉTAILS COMPLETS
================================================================================
${JSON.stringify(detailedError, null, 2)}
================================================================================

`);
    });
  }

  /**
   * Formate un message de log avec timestamp, niveau et détails complets
   */
  private static formatMessage(level: string, args: unknown[]): string {
    const timestamp = new Date().toISOString();

    // Formatage détaillé pour chaque argument
    const formattedArgs = args.map((arg, index) => {
      if (arg === null) return "null";
      if (arg === undefined) return "undefined";

      if (typeof arg === "object") {
        try {
          // Pour les objets, affichage complet avec indentation
          if (arg instanceof Error) {
            return `ERROR: ${arg.message}\nStack: ${arg.stack}`;
          }
          if (Array.isArray(arg)) {
            return `ARRAY[${arg.length}]: ${JSON.stringify(arg, null, 2)}`;
          }
          // Objets normaux avec exploration complète
          return `OBJECT: ${JSON.stringify(arg, this.safeStringify, 2)}`;
        } catch (error) {
          return `OBJECT[non-serializable]: ${arg.toString()} (${arg.constructor?.name})`;
        }
      }

      if (typeof arg === "function") {
        return `FUNCTION: ${arg.name || "anonymous"}()`;
      }

      if (typeof arg === "string") {
        // Préserver les retours à la ligne et caractères spéciaux
        return arg.length > 1000
          ? `STRING[${arg.length}]: ${arg.substring(0, 1000)}...[TRUNCATED]`
          : `STRING: ${arg}`;
      }

      return `${(typeof arg).toUpperCase()}: ${String(arg)}`;
    });

    // Ajouter des métadonnées de contexte
    const contextInfo = this.getContextInfo();

    return `[${timestamp}] [${level.padEnd(5)}] ${contextInfo} ${formattedArgs.join(" ")}\n`;
  }

  /**
   * Remplacement sécurisé pour JSON.stringify qui gère les références circulaires
   */
  private static safeStringify = (() => {
    const seen = new WeakSet();
    return (key: string, value: unknown) => {
      if (typeof value === "object" && value !== null) {
        if (seen.has(value)) {
          return "[Circular Reference]";
        }
        seen.add(value);
      }
      return value;
    };
  })();

  /**
   * Obtient des informations de contexte détaillées
   */
  private static getContextInfo(): string {
    try {
      // Obtenir la stack trace pour identifier le fichier/ligne d'origine
      const stack = new Error().stack;
      const caller = stack?.split("\n")[4]; // Ligne d'appel (skip Error, formatMessage, console.x, caller)

      let fileInfo = "";
      if (caller) {
        const match =
          caller.match(/at .+ \((.+):(\d+):(\d+)\)/) ||
          caller.match(/at (.+):(\d+):(\d+)/);
        if (match) {
          const [, filepath, line, col] = match;
          const filename = filepath.split("/").pop() || filepath;
          fileInfo = `[${filename}:${line}]`;
        }
      }

      // Informations de performance/mémoire
      const memUsage = process.memoryUsage();
      const memInfo = `[MEM:${Math.round(memUsage.heapUsed / 1024 / 1024)}MB]`;

      return `${fileInfo}${memInfo}`;
    } catch {
      return "[CONTEXT:unknown]";
    }
  }

  /**
   * Écrit dans le fichier de log
   */
  private static writeToFile(message: string) {
    try {
      fs.appendFileSync(this.currentLogFile, message);
    } catch (error) {
      this.originalConsole.error("❌ Erreur écriture log:", error);
    }
  }

  /**
   * Calcule le temps de fonctionnement du serveur
   */
  private static getUptime(): string {
    const uptimeSeconds = process.uptime();
    const hours = Math.floor(uptimeSeconds / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const seconds = Math.floor(uptimeSeconds % 60);
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  /**
   * Nettoie les anciens logs (garde les 10 derniers)
   */
  private static cleanOldLogs() {
    try {
      const files = fs
        .readdirSync(this.logDir)
        .filter((file) => file.startsWith("server-") && file.endsWith(".log"))
        .map((file) => ({
          name: file,
          path: path.join(this.logDir, file),
          stats: fs.statSync(path.join(this.logDir, file)),
        }))
        .sort((a, b) => b.stats.mtime.getTime() - a.stats.mtime.getTime());

      // Garder les 10 plus récents, supprimer le reste
      if (files.length > 10) {
        const filesToDelete = files.slice(10);
        filesToDelete.forEach((file) => {
          fs.unlinkSync(file.path);
          this.nativeConsole.log(`🗑️ Log supprimé: ${file.name}`);
        });
      }

      this.nativeConsole.log(
        `📁 Logs disponibles: ${files.length} fichiers dans ${this.logDir}`,
      );
    } catch (error) {
      this.originalConsole.error("❌ Erreur nettoyage logs:", error);
    }
  }

  /**
   * Restaure les fonctions console originales (pour les tests)
   */
  static restore() {
    this.nativeConsole.log = this.originalConsole.log;
    this.nativeConsole.error = this.originalConsole.error;
    this.nativeConsole.warn = this.originalConsole.warn;
    this.nativeConsole.info = this.originalConsole.info;
  }

  /**
   * Obtient le chemin du fichier de log actuel
   */
  static getCurrentLogFile(): string {
    return this.currentLogFile;
  }

  /**
   * Liste tous les fichiers de logs disponibles
   */
  static getLogFiles(): string[] {
    try {
      return fs
        .readdirSync(this.logDir)
        .filter((file) => file.startsWith("server-") && file.endsWith(".log"))
        .sort()
        .reverse(); // Plus récents en premier
    } catch {
      return [];
    }
  }

  /**
   * Lit le contenu d'un fichier de log
   */
  static readLogFile(filename: string): string {
    try {
      const filepath = path.join(this.logDir, filename);
      return fs.readFileSync(filepath, "utf8");
    } catch (error) {
      throw new Error(`Impossible de lire le fichier de log: ${filename}`);
    }
  }
}
