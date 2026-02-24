/**
 * 🛡️ RATE LIMITING POUR WEBSOCKET
 * Protection contre spam de connexions WebSocket
 *
 * LIMITES:
 * - Max 10 nouvelles connexions par minute par IP
 * - Max 100 messages par minute par connexion
 * - Reset automatique toutes les minutes
 */

import { logger } from "../utils/logger.js";
import { WebSocket } from "ws";
import { SecureLogger } from "./secureLogging.js";

function getWebSocketId(ws: WebSocket): string {
  const id = (ws as unknown as { id?: unknown }).id;
  return typeof id === "string" && id.trim() ? id : "unknown";
}

/**
 * Tracker de connexions WebSocket par IP
 */
interface ConnectionTracker {
  count: number;
  lastReset: number;
}

/**
 * Tracker de messages par connexion WebSocket
 */
interface MessageTracker {
  count: number;
  lastReset: number;
}

// Stockage des compteurs en mémoire
const wsConnections = new Map<string, ConnectionTracker>();
const wsMessages = new Map<WebSocket, MessageTracker>();

// Configuration du rate limiting WebSocket
const WS_RATE_LIMIT = {
  connectionsPerMinute: parseInt(process.env.RATE_LIMIT_WS_CONNECTIONS || "10"),
  messagesPerMinute: parseInt(process.env.RATE_LIMIT_WS_MESSAGES || "100"),
  windowMs: 60000, // 1 minute
};

/**
 * Vérifie si une IP peut établir une nouvelle connexion WebSocket
 * @param ip - Adresse IP du client
 * @returns true si autorisé, false si limite atteinte
 */
export const checkWebSocketConnectionLimit = (ip: string): boolean => {
  const now = Date.now();
  const tracker = wsConnections.get(ip) || { count: 0, lastReset: now };

  // Reset le compteur si la fenêtre est passée
  if (now - tracker.lastReset > WS_RATE_LIMIT.windowMs) {
    tracker.count = 0;
    tracker.lastReset = now;
  }

  // Vérifier la limite
  if (tracker.count >= WS_RATE_LIMIT.connectionsPerMinute) {
    SecureLogger.warn("🚨 [WS-RATE-LIMIT] Limite de connexions atteinte", {
      ip,
      count: tracker.count,
      limit: WS_RATE_LIMIT.connectionsPerMinute,
    });
    return false;
  }

  // Incrémenter le compteur
  tracker.count++;
  wsConnections.set(ip, tracker);

  return true;
};

/**
 * Vérifie si une connexion WebSocket peut envoyer un nouveau message
 * @param ws - Instance WebSocket
 * @returns true si autorisé, false si limite atteinte
 */
export const checkWebSocketMessageLimit = (ws: WebSocket): boolean => {
  const now = Date.now();
  const tracker = wsMessages.get(ws) || { count: 0, lastReset: now };

  // Reset le compteur si la fenêtre est passée
  if (now - tracker.lastReset > WS_RATE_LIMIT.windowMs) {
    tracker.count = 0;
    tracker.lastReset = now;
  }

  // Vérifier la limite
  if (tracker.count >= WS_RATE_LIMIT.messagesPerMinute) {
    SecureLogger.warn("🚨 [WS-RATE-LIMIT] Limite de messages atteinte", {
      wsId: getWebSocketId(ws),
      count: tracker.count,
      limit: WS_RATE_LIMIT.messagesPerMinute,
    });
    return false;
  }

  // Incrémenter le compteur
  tracker.count++;
  wsMessages.set(ws, tracker);

  return true;
};

/**
 * Nettoie les trackers d'une connexion fermée
 * @param ws - Instance WebSocket
 */
export const cleanupWebSocketTrackers = (ws: WebSocket) => {
  wsMessages.delete(ws);
};

/**
 * Nettoie périodiquement les anciens trackers (garbage collection)
 * Devrait être appelé régulièrement (ex: toutes les 5 minutes)
 */
export const cleanupStaleTrackers = () => {
  const now = Date.now();
  const staleThreshold = WS_RATE_LIMIT.windowMs * 2; // 2 minutes

  // Nettoyer les connexions obsolètes
  for (const [ip, tracker] of wsConnections.entries()) {
    if (now - tracker.lastReset > staleThreshold) {
      wsConnections.delete(ip);
    }
  }

  SecureLogger.debug("🧹 [WS-RATE-LIMIT] Nettoyage trackers obsolètes", {
    remainingConnections: wsConnections.size,
    remainingMessages: wsMessages.size,
  });
};

/**
 * Démarrer le nettoyage périodique des trackers
 * À appeler au démarrage du serveur
 */
export const startWebSocketCleanup = () => {
  // Nettoyer toutes les 5 minutes
  setInterval(cleanupStaleTrackers, 5 * 60 * 1000);
  logger.log("🧹 [WS-RATE-LIMIT] Nettoyage automatique activé (toutes les 5 minutes)");
};

/**
 * Obtenir les statistiques actuelles du rate limiting WebSocket
 */
export const getWebSocketRateLimitStats = () => {
  return {
    activeIPs: wsConnections.size,
    activeConnections: wsMessages.size,
    config: WS_RATE_LIMIT,
  };
};

/**
 * Log la configuration au démarrage
 */
export const logWebSocketRateLimitConfig = () => {
  logger.log("🛡️  WebSocket Rate Limiting ACTIVÉ:");
  logger.log(`   - Connexions: ${WS_RATE_LIMIT.connectionsPerMinute} par minute par IP`);
  logger.log(`   - Messages:   ${WS_RATE_LIMIT.messagesPerMinute} par minute par connexion`);
};
