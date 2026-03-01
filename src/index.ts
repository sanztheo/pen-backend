import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import http from "http";
import { WebSocketServer } from "ws";
import * as Y from "yjs";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import * as syncProtocol from "y-protocols/sync";

import { authRouter } from "./routes/auth.js";
import { workspaceRouter } from "./routes/workspace.js";
import { projectRouter } from "./routes/project.js";
import { pageRouter } from "./routes/page.js";
import { contentRouter } from "./routes/content.js";
import { aiRouter } from "./routes/ai.js";
import { assistantRouter } from "./routes/assistant.js";
import { conversationsRouter } from "./routes/conversations.js";
import { quizRouter } from "./routes/quiz.js";
import { invalidateBlockNoteCache } from "./lib/redis.js";
import { ContextCacheService } from "./services/quiz/intelligence/index.js";
import { reorderRouter } from "./routes/reorder.js";
import { graphicsRouter } from "./routes/graphics.js";
import { dashboardLayoutRoutesRouter } from "./routes/dashboardLayoutRoutes.js";
import { billingRouter } from "./routes/billing.js";
import { limitsRouter } from "./routes/limits.js";
import { aiCreditsRouter } from "./routes/aiCredits.js";
import { quizLimitsRouter } from "./routes/quizLimits.js";
import { sync_limitsRouter } from "./routes/sync-limits.js";
import { updatesRouter } from "./routes/updates.js";
import { userRouter } from "./routes/user.js";
import { dailyArticleRouter } from "./routes/dailyArticle.js";
import { uploadRouter } from "./routes/upload.js";
import { paddleWebhookHandler } from "./routes/paddleWebhooks.js";
import { jobsRouter } from "./routes/jobs.js";
import { agentRouter } from "./routes/agent.js";
import { adminRouter } from "./routes/admin.js";
import { betaRouter } from "./routes/beta.js";

import { startCronJobs } from "./jobs/cronJobs.js";
import { AuthService } from "./services/auth.js";
import { DatabaseHealthCheck } from "./lib/dbHealthCheck.js";
// import { Logger } from './lib/logger.js'; // ❌ DÉSACTIVÉ - cache les logs console
import { PrismaPersistence } from "./lib/y-prisma.js";
import { prisma, startKeepAlive } from "./lib/prisma.js";
import { progressService } from "./services/progressService.js";
import compression from "compression";
import { backendConfig, CLIENT_URL } from "./utils/config.js";

// 🎯 WORKERS & MONITORING IMPORTS
import { startWorkers, stopWorkers } from "./workers/index.js";
import { closeQueues } from "./lib/queues.js";
import { startMonitoring, stopMonitoring } from "./lib/monitoring.js";
import { logger } from "./utils/logger.js";
import { initFuturaScheduler, stopFuturaScheduler } from "./lib/futuraScheduler.js";
import { startAlertsCron, stopAlertsCron } from "./cron/alertsCron.js";
import { startRetentionCron, stopRetentionCron } from "./cron/retentionCron.js";

// 🛡️ RATE LIMITING IMPORTS
import {
  globalRateLimit,
  authRateLimit,
  aiRateLimit,
  quizRateLimit,
  assistantRateLimit,
  logRateLimitConfig,
} from "./middlewares/rateLimiting.js";
import { aiBurstRateLimit } from "./middlewares/aiBurstLimit.js";
import {
  checkWebSocketConnectionLimit,
  checkWebSocketMessageLimit,
  cleanupWebSocketTrackers,
  startWebSocketCleanup,
  logWebSocketRateLimitConfig,
} from "./middlewares/websocketRateLimit.js";
import { authenticateToken } from "./middlewares/auth.js";

dotenv.config();
// Logger.init(); // ❌ DÉSACTIVÉ - maintenant logger.log s'affiche dans le terminal

/**
 * 🏓 Test automatique de la route webhook Paddle au démarrage
 */
async function testPaddleWebhookRoute(): Promise<void> {
  logger.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  logger.log("🏓 TEST WEBHOOK PADDLE");
  logger.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  try {
    const response = await fetch(`http://localhost:${PORT}/api/webhooks/paddle`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Paddle-Signature": "test-signature",
      },
      body: JSON.stringify({ test: true }),
    });

    if (response.status === 400) {
      // 400 = route accessible, signature invalide (attendu)
      logger.log("✅ Route webhook Paddle: ACCESSIBLE");
      logger.log("   URL: /api/webhooks/paddle");
      logger.log("   Status: Prêt à recevoir les webhooks Paddle");
    } else if (response.status === 500) {
      logger.log("⚠️  Route webhook: ACCESSIBLE mais PADDLE_WEBHOOK_SECRET manquant");
    } else {
      logger.log(`⚠️  Route webhook: Status inattendu (${response.status})`);
    }
  } catch (error: unknown) {
    logger.log("❌ Route webhook Paddle: INACCESSIBLE");
    logger.log(`   Erreur: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Vérifier la config
  const hasSecret = !!process.env.PADDLE_WEBHOOK_SECRET;
  const hasApiKey = !!process.env.PADDLE_API_KEY;
  logger.log(`   PADDLE_API_KEY: ${hasApiKey ? "✅ Configuré" : "❌ Manquant"}`);
  logger.log(`   PADDLE_WEBHOOK_SECRET: ${hasSecret ? "✅ Configuré" : "❌ Manquant"}`);
  logger.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

const app = express();
// Trust first proxy (Railway reverse proxy) so req.ip returns real client IP
app.set("trust proxy", 1);
const server = http.createServer(app);

const PORT = backendConfig.port;
const NODE_ENV = backendConfig.nodeEnv;

app.use(helmet());

// 🛡️ CORS SÉCURISÉ - Configuration restrictive
const allowedOrigins = CLIENT_URL.split(",").map((url) => url.trim());
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        // En production, bloquer les requêtes sans Origin (protection CSRF)
        // Sauf health checks, webhooks et monitoring qui n'envoient pas d'Origin
        if (process.env.NODE_ENV === "production") {
          return callback(null, false);
        }
        return callback(null, true);
      }
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      logger.warn(`🛡️ [CORS] Origine bloquée: ${origin}`);
      return callback(new Error("CORS non autorisé"), false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Accept",
      "Origin",
      "Cache-Control",
    ],
    exposedHeaders: ["Content-Length", "X-Request-Id"],
    maxAge: 86400, // Cache preflight 24h
    optionsSuccessStatus: 204,
  }),
);

// 🔥 Compression - EXCLURE les SSE (text/event-stream) pour permettre le streaming temps réel
app.use(
  compression({
    filter: (req, res) => {
      // Ne pas compresser les SSE (streams agent/chat)
      const contentType = res.getHeader("Content-Type");
      // Content-Type peut être string | number | string[]
      const contentTypeStr = Array.isArray(contentType) ? contentType[0] : contentType;
      if (typeof contentTypeStr === "string" && contentTypeStr.includes("text/event-stream")) {
        return false;
      }
      // Compresser tout le reste normalement
      return compression.filter(req, res);
    },
  }),
);

// 🏓 Paddle webhook - AVANT rate limit et json parser (body brut requis)
app.post(
  "/api/webhooks/paddle",
  express.raw({ type: "application/json" }),
  (_req, _res, next) => {
    logger.log("🏓 [WEBHOOK] Route /api/webhooks/paddle touchée");
    next();
  },
  paddleWebhookHandler,
);

// 🛡️ RATE LIMITING GLOBAL - Appliqué à TOUS les endpoints (après webhooks)
app.use(globalRateLimit);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/health", (_req, res) => res.status(200).json({ status: "ok" }));

// 🛡️ ROUTES AVEC RATE LIMITING SPÉCIFIQUE
app.use("/api/auth", authRateLimit, authRouter); // Protection brute force
app.use("/api/content", contentRouter); // 🏠 Nouvelle API simplifiée
app.use("/api/workspaces", workspaceRouter);
app.use("/api/projects", projectRouter);
app.use("/api/pages", pageRouter);
app.use("/api/ai", aiRateLimit, aiBurstRateLimit, aiRouter); // Protection spam IA + burst

// 🤖 Route spéciale pour BlockNote AI - alias direct vers /api/ai/chat
// BlockNote AI utilise DefaultChatTransport qui appelle /api/chat
app.post("/api/chat", (req, res, next) => {
  // Modifier l'URL pour correspondre à la route du router AI
  req.url = "/chat";
  req.originalUrl = "/api/ai/chat";
  // Passer la requête au router AI
  aiRouter(req, res, next);
});
app.use("/api/assistant", authenticateToken, assistantRateLimit, aiBurstRateLimit, assistantRouter); // Auth + rate limit + burst AVANT routes
app.use("/api/conversations", conversationsRouter);
app.use("/api/quiz", quizRateLimit, quizRouter); // Protection génération quiz
app.use("/api/quiz/graphics", graphicsRouter);
app.use("/api/reorder", reorderRouter);
app.use("/api/dashboard-layout", dashboardLayoutRoutesRouter);
// 🛡️ Admin Dashboard (auth + isAdmin required + rate limited)
app.use("/api/admin", aiRateLimit, adminRouter);
app.use("/api/billing", billingRouter);
app.use("/api/limits", limitsRouter);
app.use("/api/ai-credits", aiCreditsRouter);
app.use("/api/quiz-limits", quizLimitsRouter);
app.use("/api/sync-limits", sync_limitsRouter);
app.use("/api/updates", updatesRouter);
app.use("/api/upload", uploadRouter);
app.use("/api/daily-article", dailyArticleRouter);
app.use("/api/user", userRouter);
app.use("/api/jobs", jobsRouter); // 🎯 Récupération résultats jobs BullMQ
app.use("/api/agent", aiRateLimit, aiBurstRateLimit, agentRouter); // 🤖 Agent Pennote + burst protection
app.use("/api/beta", betaRouter); // 🎯 Beta management

app.use("*", (_req, res) => res.status(404).json({ error: "Route non trouvée" }));
app.use(
  (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error("❌ Erreur non gérée:", error);
    res.status(500).json({ error: "Erreur interne du serveur" });
  },
);

const authenticateTokenWS = async (token: string) => {
  try {
    // Utiliser la vérification de token Clerk pour WebSocket
    return await AuthService.verifyToken(token);
  } catch (error) {
    logger.error("Erreur authentification WebSocket:", error);
    return null;
  }
};

const setupYjsWebSocket = (server: http.Server) => {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 }); // 1 MB
  const persistence = new PrismaPersistence();
  const docs = new Map<string, Y.Doc>();
  const connections = new Map<string, number>(); // Compteur de connexions par document
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  wss.on("connection", async (ws, req) => {
    const url = req.url?.split("?")[0] || "";
    const pathSegments = url.split("/").filter(Boolean);
    // Récupérer l'utilisateur authentifié (ajouté par authenticateTokenWS)
    const user = (req as http.IncomingMessage & { user?: { id: string; email: string } }).user;

    if (!user) {
      ws.close(1008, "Utilisateur non authentifié");
      return;
    }

    ws.on("error", (err) => {
      if (err.message.includes("payload")) {
        logger.error(
          `[WS] ❌ Message trop volumineux reçu de l'utilisateur ${user?.id || "UNDEFINED"}. Fermeture de la connexion.`,
        );
        ws.close(1009, "Message trop volumineux");
      }
    });

    // Déterminer le type de connexion
    if (pathSegments.includes("save")) {
      // Route de sauvegarde rapide
      const saveIndex = pathSegments.indexOf("save");
      const pageId =
        saveIndex >= 0 && saveIndex + 1 < pathSegments.length ? pathSegments[saveIndex + 1] : null;

      if (!pageId) {
        ws.close(1008, "ID de page manquant pour sauvegarde");
        return;
      }

      // Valider le format UUID du pageId
      if (!uuidRegex.test(pageId)) {
        ws.close(1008, "Format UUID de page invalide");
        return;
      }

      logger.log(
        `[WS] 💾 Connexion sauvegarde pour page: ${pageId} - User défini: ${!!user} (${user?.id || "UNDEFINED"})`,
      );

      ws.on("message", async (message) => {
        try {
          // 🛡️ RATE LIMITING - Vérifier limite de messages AVANT traitement
          if (!checkWebSocketMessageLimit(ws)) {
            logger.log(`[WS] ❌ Rate limit messages dépassé pour page ${pageId}, message ignoré`);
            ws.send(
              JSON.stringify({
                type: "save-error",
                error: "Trop de messages, veuillez ralentir",
              }),
            );
            return;
          }

          const data = JSON.parse(message.toString());
          if (data.type === "save" && data.content) {
            logger.log(
              `[WS] 💾 Sauvegarde reçue pour ${pageId} par user: ${user?.id || "UNDEFINED"}`,
            );

            if (!user) {
              logger.error(`[WS] ❌ SÉCURITÉ: Utilisateur non défini pour page ${pageId}`);
              ws.send(
                JSON.stringify({
                  type: "save-error",
                  error: "Utilisateur non authentifié",
                }),
              );
              return;
            }

            try {
              // SÉCURITÉ: Vérifier l'accès à la page avant sauvegarde
              const pageAccess = await prisma.page.findFirst({
                where: {
                  id: pageId,
                  workspace: {
                    OR: [
                      { ownerId: user.id }, // Utilisateur est propriétaire du workspace
                      {
                        members: {
                          some: {
                            userId: user.id,
                            isActive: true,
                          },
                        },
                      },
                    ],
                  },
                },
                select: { id: true },
              });

              if (!pageAccess) {
                logger.error(
                  `[WS] ❌ SÉCURITÉ: Accès refusé pour user ${user.id} sur page ${pageId}`,
                );
                ws.send(
                  JSON.stringify({
                    type: "save-error",
                    error: "Accès refusé à cette page",
                  }),
                );
                return;
              }

              logger.log(
                `[WS] ✅ SÉCURITÉ: Accès autorisé pour user ${user.id} sur page ${pageId}`,
              );

              // Sauvegarder le contenu BlockNote en base
              await prisma.page.update({
                where: { id: pageId },
                data: {
                  blockNoteContent: data.content, // JSON direct, pas de stringify
                  updatedAt: new Date(),
                },
              });

              logger.log(
                `[WS] ✅ SAUVEGARDE DB RÉUSSIE: Page ${pageId} écrite en base de données par user ${user.id}`,
              );

              // 🗑️ INVALIDATION CACHE REDIS: Invalider le cache pour forcer rechargement depuis DB
              await invalidateBlockNoteCache(pageId);
              logger.log(`[WS] 🗑️ Cache Redis invalidé pour page ${pageId}`);

              // 🧠 PEN-20: Invalider le cache de contexte quiz si cette page est utilisée
              ContextCacheService.invalidateForPages([pageId]).catch((err) =>
                logger.warn(`[WS] ⚠️ Erreur invalidation cache quiz:`, err),
              );

              ws.send(JSON.stringify({ type: "save-success", timestamp: Date.now() }));
            } catch (dbError) {
              logger.error(`[WS] ❌ Erreur sauvegarde DB pour ${pageId}:`, dbError);
              ws.send(
                JSON.stringify({
                  type: "save-error",
                  error: "Erreur base de données",
                }),
              );
            }
          }
        } catch (error) {
          logger.error("[WS] Erreur sauvegarde:", error);
          ws.send(JSON.stringify({ type: "save-error", error: "Format invalide" }));
        }
      });

      return;
    }

    // Le pageId est après 'collaboration' dans l'URL (code existant)
    const collaborationIndex = pathSegments.indexOf("collaboration");
    const pageId =
      collaborationIndex >= 0 && collaborationIndex + 1 < pathSegments.length
        ? pathSegments[collaborationIndex + 1]
        : null;

    if (!pageId || pageId === "collaboration") {
      ws.close(1008, "ID de page manquant");
      logger.log(`[WS] ❌ ID de page manquant dans l'URL: ${url}`);
      return;
    }

    // Valider que c'est un UUID valide
    if (!uuidRegex.test(pageId)) {
      ws.close(1008, "Format UUID invalide");
      return;
    }

    // SÉCURITÉ: Vérifier l'accès à la page avant collaboration
    const pageAccess = await prisma.page.findFirst({
      where: {
        id: pageId,
        workspace: {
          OR: [
            { ownerId: user.id }, // Utilisateur est propriétaire du workspace
            {
              members: {
                some: {
                  userId: user.id,
                  isActive: true,
                },
              },
            },
          ],
        },
      },
      select: { id: true },
    });

    if (!pageAccess) {
      logger.error(
        `[WS] ❌ SÉCURITÉ: Accès refusé pour user ${user.id} sur page collaboration ${pageId}`,
      );
      ws.close(1008, "Accès refusé à cette page");
      return;
    }

    logger.log(`[WS] ✅ Accès collaboration autorisé pour user ${user.id} sur page ${pageId}`);

    // Obtenir ou créer le document Yjs
    let doc = docs.get(pageId);
    if (!doc) {
      doc = await persistence.getYDoc(pageId);
      docs.set(pageId, doc);
    }

    // Configuration des listeners pour la persistance
    const updateHandler = (update: Uint8Array, origin: unknown) => {
      if (origin !== ws) {
        persistence.storeUpdate(pageId, update);
      }
    };
    doc.on("update", updateHandler);

    // Envoyer le state initial - protocole y-websocket standard
    const syncEncoder = encoding.createEncoder();
    encoding.writeVarUint(syncEncoder, 0); // messageType: sync
    syncProtocol.writeSyncStep1(syncEncoder, doc);
    ws.send(encoding.toUint8Array(syncEncoder));

    // Gérer les messages WebSocket selon le protocole y-websocket
    ws.on("message", (message: Buffer) => {
      try {
        // 🛡️ RATE LIMITING WEBSOCKET - Vérifier limite de messages
        if (!checkWebSocketMessageLimit(ws)) {
          logger.log("[WS] ❌ Rate limit messages dépassé, fermeture connexion");
          ws.close(1008, "Trop de messages");
          return;
        }

        const decoder = decoding.createDecoder(new Uint8Array(message));
        const messageType = decoding.readVarUint(decoder);

        switch (messageType) {
          case 0: // sync message
            const responseEncoder = encoding.createEncoder();
            encoding.writeVarUint(responseEncoder, 0);
            syncProtocol.readSyncMessage(decoder, responseEncoder, doc!, ws);

            if (encoding.length(responseEncoder) > 1) {
              ws.send(encoding.toUint8Array(responseEncoder));
            }
            break;

          case 1: // awareness message - just broadcast to other clients
            // Pour l'instant, on ignore les awareness messages
            break;
        }
      } catch (error) {
        logger.error("[Yjs] Erreur traitement message:", error);
      }
    });

    // Incrémenter le compteur de connexions
    connections.set(pageId, (connections.get(pageId) || 0) + 1);
    logger.log(
      `[Yjs] Connexion établie pour la page: ${pageId} (total: ${connections.get(pageId)})`,
    );

    // Nettoyage à la déconnexion
    ws.on("close", () => {
      // 🛡️ RATE LIMITING WEBSOCKET - Nettoyer les trackers
      cleanupWebSocketTrackers(ws);

      if (doc) {
        doc.off("update", updateHandler);
      }

      // Décrémenter le compteur de connexions
      const connectionCount = (connections.get(pageId) || 1) - 1;
      connections.set(pageId, connectionCount);

      logger.log(`[Yjs] Déconnexion pour la page: ${pageId} (restant: ${connectionCount})`);

      // Si plus personne n'est connecté, supprimer le document de la mémoire
      if (connectionCount <= 0) {
        if (doc) {
          // Persister les dernières modifications avant suppression
          persistence.flushDocument(pageId);
          doc.destroy();
        }
        docs.delete(pageId);
        connections.delete(pageId);
        logger.log(`[Yjs] Document supprimé de la mémoire pour la page: ${pageId}`);
      }
    });

    logger.log(`[Yjs] Connexion établie pour la page: ${pageId}`);
  });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url || "", `http://${request.headers.host}`);
    const token = url.searchParams.get("token");
    const clientIp = request.socket.remoteAddress || "unknown";

    logger.log(`[WS] Tentative de connexion: ${url.pathname}`);
    logger.log(`[WS] Token présent: ${!!token}`);

    // 🛡️ RATE LIMITING WEBSOCKET - Vérifier limite de connexions par IP
    if (!checkWebSocketConnectionLimit(clientIp)) {
      logger.log(`[WS] ❌ Rate limit dépassé pour IP: ${clientIp}`);
      socket.write("HTTP/1.1 429 Too Many Requests\r\n\r\n");
      socket.destroy();
      return;
    }

    if (url.pathname.startsWith("/ws/save/")) {
      // Route de sauvegarde rapide
      if (!token) {
        logger.log("[WS] ❌ Token manquant pour sauvegarde - connexion rejetée");
        socket.destroy();
        return;
      }
      void (async () => {
        try {
          const user = await authenticateTokenWS(token);
          if (user) {
            logger.log(`[WS] ✅ Sauvegarde WebSocket - user: ${user.id}`);
            // Stocker l'utilisateur dans la request pour l'utiliser dans la connexion
            (request as unknown as { user: typeof user }).user = user;
            wss.handleUpgrade(request, socket, head, (ws) => {
              wss.emit("connection", ws, request);
            });
          } else {
            logger.log("[WS] ❌ Authentication sauvegarde échouée");
            socket.destroy();
          }
        } catch (error) {
          logger.log("[WS] ❌ Erreur auth sauvegarde:", error);
          socket.destroy();
        }
      })();
    } else if (url.pathname.startsWith("/ws/collaboration/")) {
      if (!token) {
        logger.log("[WS] ❌ Token manquant - connexion rejetée");
        socket.destroy();
        return;
      }
      void (async () => {
        try {
          const user = await authenticateTokenWS(token);
          if (user) {
            logger.log(`[WS] ✅ Authentication réussie pour user: ${user.id}`);
            // Stocker l'utilisateur dans la request pour l'utiliser dans la connexion
            (request as unknown as { user: typeof user }).user = user;
            wss.handleUpgrade(request, socket, head, (ws) => {
              wss.emit("connection", ws, request);
            });
          } else {
            logger.log("[WS] ❌ Authentication échouée - connexion rejetée");
            socket.destroy();
          }
        } catch (error) {
          logger.log("[WS] ❌ Erreur lors de l'authentication:", error);
          socket.destroy();
        }
      })();
    } else if (url.pathname.startsWith("/ws/quiz-progress/")) {
      // Route pour les mises à jour de progression de quiz
      if (!token) {
        logger.log("[WS] ❌ Token manquant pour progression - connexion rejetée");
        socket.destroy();
        return;
      }

      // Extraire l'ID du processus depuis l'URL
      const pathSegments = url.pathname.split("/").filter(Boolean);
      const progressIndex = pathSegments.indexOf("quiz-progress");
      const processId =
        progressIndex >= 0 && progressIndex + 1 < pathSegments.length
          ? pathSegments[progressIndex + 1]
          : null;

      if (!processId) {
        logger.log("[WS] ❌ ID de processus manquant pour progression");
        socket.destroy();
        return;
      }

      // SEC-04: Validation UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(processId)) {
        logger.log("[WS] ❌ Format processId invalide");
        socket.destroy();
        return;
      }

      void (async () => {
        try {
          const user = await authenticateTokenWS(token);
          if (user) {
            // SEC-04: Vérification ownership du processId
            if (!progressService.isProcessOwner(processId, user.id)) {
              logger.warn(`[WS] ❌ processId ${processId} n'appartient pas à ${user.id}`);
              socket.destroy();
              return;
            }

            logger.log(`[WS] ✅ Progression WebSocket - user: ${user.id}, processus: ${processId}`);
            wss.handleUpgrade(request, socket, head, (ws) => {
              // Enregistrer la connexion dans le service de progression
              progressService.registerConnection(processId, ws);

              // Envoyer confirmation de connexion
              ws.send(
                JSON.stringify({
                  type: "connected",
                  processId,
                  timestamp: Date.now(),
                  message: "Connexion progression établie",
                }),
              );
            });
          } else {
            logger.log("[WS] ❌ Authentication progression échouée");
            socket.destroy();
          }
        } catch (error) {
          logger.log("[WS] ❌ Erreur auth progression:", error);
          socket.destroy();
        }
      })();
    } else {
      logger.log(`[WS] ❌ Chemin non autorisé: ${url.pathname}`);
      socket.destroy();
    }
  });

  logger.log("🚀 Serveur WebSocket configuré :");
  logger.log("   - /ws/collaboration/ (Yjs)");
  logger.log("   - /ws/save/ (Sauvegarde)");
  logger.log("   - /ws/quiz-progress/ (Progression quiz)");
};

server.listen(PORT, async () => {
  logger.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  logger.log(`🚀 Serveur Pen SaaS démarré sur le port ${PORT} en mode ${NODE_ENV}`);
  logger.log(`✨ VERSION: RATE-LIMITED-SECURE - ${new Date().toISOString()}`);
  logger.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  // 🛡️ Afficher la configuration du rate limiting
  logRateLimitConfig();
  logWebSocketRateLimitConfig();

  // 🛡️ Démarrer le nettoyage périodique des trackers WebSocket
  startWebSocketCleanup();

  setupYjsWebSocket(server);

  try {
    await DatabaseHealthCheck.displayDiagnostic();
    const connectionOk = await DatabaseHealthCheck.testConnectionWithRetry(3);
    if (connectionOk) {
      logger.log("🎯 Démarrage des tâches automatiques...");
      startCronJobs();

      // 💓 Activer le keep-alive DB pour éviter les timeouts
      startKeepAlive();

      // 🎯 Démarrer les workers BullMQ pour jobs asynchrones
      startWorkers();

      // 📅 Initialiser le planificateur d'articles Futura (rafraîchissement hebdomadaire)
      await initFuturaScheduler();

      // 📊 Démarrer le monitoring système (toutes les 5 minutes)
      startMonitoring(5);

      // 🔔 Démarrer le CRON des alertes admin (toutes les 5 minutes)
      startAlertsCron();

      // 📊 Démarrer le CRON de calcul des cohortes de rétention (dimanche minuit)
      startRetentionCron();

      // 🏓 Test automatique du webhook Paddle
      await testPaddleWebhookRoute();
    } else {
      logger.error("⚠️ Tâches automatiques désactivées - BDD inaccessible");
    }
  } catch (error: unknown) {
    logger.error(
      "❌ Erreur lors du diagnostic de BDD:",
      error instanceof Error ? error.message : String(error),
    );
  }
});

// 🧹 Graceful shutdown - Arrêter proprement les workers et queues
process.on("SIGTERM", async () => {
  logger.log("🛑 [SHUTDOWN] Signal SIGTERM reçu, arrêt gracieux...");
  stopMonitoring();
  stopAlertsCron();
  stopRetentionCron();
  await stopFuturaScheduler();
  await stopWorkers();
  await closeQueues();
  process.exit(0);
});

process.on("SIGINT", async () => {
  logger.log("🛑 [SHUTDOWN] Signal SIGINT reçu, arrêt gracieux...");
  stopMonitoring();
  stopAlertsCron();
  stopRetentionCron();
  await stopFuturaScheduler();
  await stopWorkers();
  await closeQueues();
  process.exit(0);
});
