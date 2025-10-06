import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import http from 'http';
import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';

import authRoutes from './routes/auth.js';
import workspaceRoutes from './routes/workspace.js';
import projectRoutes from './routes/project.js';
import pageRoutes from './routes/page.js';
import contentRoutes from './routes/content.js';
import aiRoutes from './routes/ai.js';
import assistantRoutes from './routes/assistant.js';
import conversationsRoutes from './routes/conversations.js';
import quizRoutes from './routes/quiz.js';
import reorderRoutes from './routes/reorder.js';
import graphicsRoutes from './routes/graphics.js';
import billingRoutes from './routes/billing.js';
import limitsRoutes from './routes/limits.js';
import aiCreditsRoutes from './routes/aiCredits.js';
import quizLimitsRoutes from './routes/quizLimits.js';
import syncLimitsRoutes from './routes/sync-limits.js';
import updatesRoutes from './routes/updates.js';
import dailyArticleRoutes from './routes/dailyArticle.js';
import { clerkWebhookHandler } from './routes/webhooks.js';

import { startCronJobs } from './jobs/cronJobs.js';
import { AuthService } from './services/auth.js';
import { DatabaseHealthCheck } from './lib/dbHealthCheck.js';
// import { Logger } from './lib/logger.js'; // ❌ DÉSACTIVÉ - cache les logs console
import { PrismaPersistence } from './lib/y-prisma.js';
import { prisma } from './lib/prisma.js';
import { progressService } from './services/progressService.js';
import compression from 'compression';
import { backendConfig, CLIENT_URL } from './utils/config.js';

dotenv.config();
// Logger.init(); // ❌ DÉSACTIVÉ - maintenant console.log s'affiche dans le terminal

const app = express();
const server = http.createServer(app);

const PORT = backendConfig.port;
const NODE_ENV = backendConfig.nodeEnv;

app.use(helmet());
app.use(cors({
  origin: CLIENT_URL.split(',').map(url => url.trim()),
  credentials: true
}));
app.use(compression());
// Clerk webhook avant json pour body brut
app.post('/api/webhooks/clerk', express.raw({ type: 'application/json' }), clerkWebhookHandler);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));
app.use('/api/auth', authRoutes);
app.use('/api/content', contentRoutes); // 🏠 Nouvelle API simplifiée
app.use('/api/workspaces', workspaceRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/pages', pageRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/assistant', assistantRoutes);
app.use('/api/conversations', conversationsRoutes);
app.use('/api/quiz', quizRoutes);
app.use('/api/quiz/graphics', graphicsRoutes);
app.use('/api/reorder', reorderRoutes);
// 🛡️ SÉCURITÉ: Routes admin supprimées pour éviter les vulnérabilités
app.use('/api/billing', billingRoutes);
app.use('/api/limits', limitsRoutes);
app.use('/api/ai-credits', aiCreditsRoutes);
app.use('/api/quiz-limits', quizLimitsRoutes);
app.use('/api/sync-limits', syncLimitsRoutes);
app.use('/api/updates', updatesRoutes);
app.use('/api/daily-article', dailyArticleRoutes);

app.use('*', (req, res) => res.status(404).json({ error: 'Route non trouvée' }));
app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('❌ Erreur non gérée:', error);
  res.status(500).json({ error: 'Erreur interne du serveur' });
});

const authenticateTokenWS = async (token: string) => {
  try {
    // Utiliser la vérification de token Clerk pour WebSocket
    return await AuthService.verifyToken(token);
  } catch (error) {
    console.error('Erreur authentification WebSocket:', error);
    return null;
  }
};

const setupYjsWebSocket = (server: http.Server) => {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 }); // 1 MB
  const persistence = new PrismaPersistence();
  const docs = new Map<string, Y.Doc>();
  const connections = new Map<string, number>(); // Compteur de connexions par document
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  wss.on('connection', async (ws, req) => {
    const url = req.url?.split('?')[0] || '';
    const pathSegments = url.split('/').filter(Boolean);
    const user = (req as any).user; // Récupérer l'utilisateur authentifié
    
    if (!user) {
      ws.close(1008, 'Utilisateur non authentifié');
      return;
    }

    ws.on('error', (err) => {
      if (err.message.includes('payload')) {
        console.error(`[WS] ❌ Message trop volumineux reçu de l'utilisateur ${user?.id || 'UNDEFINED'}. Fermeture de la connexion.`);
        ws.close(1009, 'Message trop volumineux');
      }
    });
    
    // Déterminer le type de connexion
    if (pathSegments.includes('save')) {
      // Route de sauvegarde rapide
      const saveIndex = pathSegments.indexOf('save');
      const pageId = saveIndex >= 0 && saveIndex + 1 < pathSegments.length 
        ? pathSegments[saveIndex + 1] 
        : null;

      if (!pageId) {
        ws.close(1008, 'ID de page manquant pour sauvegarde');
        return;
      }

      // Valider le format UUID du pageId
      if (!uuidRegex.test(pageId)) {
        ws.close(1008, 'Format UUID de page invalide');
        return;
      }

      console.log(`[WS] 💾 Connexion sauvegarde pour page: ${pageId} - User défini: ${!!user} (${user?.id || 'UNDEFINED'})`);
      
      ws.on('message', async (message) => {
        try {
          const data = JSON.parse(message.toString());
          if (data.type === 'save' && data.content) {
            console.log(`[WS] 💾 Sauvegarde reçue pour ${pageId} par user: ${user?.id || 'UNDEFINED'}`);
            
            if (!user) {
              console.error(`[WS] ❌ SÉCURITÉ: Utilisateur non défini pour page ${pageId}`);
              ws.send(JSON.stringify({ 
                type: 'save-error', 
                error: 'Utilisateur non authentifié' 
              }));
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
                            isActive: true
                          }
                        }
                      }
                    ]
                  }
                },
                select: { id: true }
              });

              if (!pageAccess) {
                console.error(`[WS] ❌ SÉCURITÉ: Accès refusé pour user ${user.id} sur page ${pageId}`);
                ws.send(JSON.stringify({ 
                  type: 'save-error', 
                  error: 'Accès refusé à cette page' 
                }));
                return;
              }

              console.log(`[WS] ✅ SÉCURITÉ: Accès autorisé pour user ${user.id} sur page ${pageId}`);

              // Sauvegarder le contenu BlockNote en base
              await prisma.page.update({
                where: { id: pageId },
                data: { 
                  blockNoteContent: data.content, // JSON direct, pas de stringify
                  updatedAt: new Date()
                }
              });
              
              console.log(`[WS] ✅ Page ${pageId} sauvegardée avec succès par user ${user.id}`);
              ws.send(JSON.stringify({ type: 'save-success', timestamp: Date.now() }));
            } catch (dbError) {
              console.error(`[WS] ❌ Erreur sauvegarde DB pour ${pageId}:`, dbError);
              ws.send(JSON.stringify({ type: 'save-error', error: 'Erreur base de données' }));
            }
          }
        } catch (error) {
          console.error('[WS] Erreur sauvegarde:', error);
          ws.send(JSON.stringify({ type: 'save-error', error: 'Format invalide' }));
        }
      });

      return;
    }
    
    // Le pageId est après 'collaboration' dans l'URL (code existant)
    const collaborationIndex = pathSegments.indexOf('collaboration');
    const pageId = collaborationIndex >= 0 && collaborationIndex + 1 < pathSegments.length 
      ? pathSegments[collaborationIndex + 1] 
      : null;
    
    if (!pageId || pageId === 'collaboration') {
      ws.close(1008, 'ID de page manquant');
      console.log(`[WS] ❌ ID de page manquant dans l'URL: ${url}`);
      return;
    }
    
    // Valider que c'est un UUID valide
    if (!uuidRegex.test(pageId)) {
      ws.close(1008, 'Format UUID invalide');
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
                  isActive: true
                }
              }
            }
          ]
        }
      },
      select: { id: true }
    });

    if (!pageAccess) {
      console.error(`[WS] ❌ SÉCURITÉ: Accès refusé pour user ${user.id} sur page collaboration ${pageId}`);
      ws.close(1008, 'Accès refusé à cette page');
      return;
    }

    console.log(`[WS] ✅ Accès collaboration autorisé pour user ${user.id} sur page ${pageId}`);

    // Obtenir ou créer le document Yjs
    let doc = docs.get(pageId);
    if (!doc) {
      doc = await persistence.getYDoc(pageId);
      docs.set(pageId, doc);
    }

    // Configuration des listeners pour la persistance
    const updateHandler = (update: Uint8Array, origin: any) => {
      if (origin !== ws) {
        persistence.storeUpdate(pageId, update);
      }
    };
    doc.on('update', updateHandler);

    // Envoyer le state initial - protocole y-websocket standard
    const syncEncoder = encoding.createEncoder();
    encoding.writeVarUint(syncEncoder, 0); // messageType: sync
    syncProtocol.writeSyncStep1(syncEncoder, doc);
    ws.send(encoding.toUint8Array(syncEncoder));

    // Gérer les messages WebSocket selon le protocole y-websocket
    ws.on('message', (message: Buffer) => {
      try {
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
        console.error('[Yjs] Erreur traitement message:', error);
      }
    });

    // Incrémenter le compteur de connexions
    connections.set(pageId, (connections.get(pageId) || 0) + 1);
    console.log(`[Yjs] Connexion établie pour la page: ${pageId} (total: ${connections.get(pageId)})`);

    // Nettoyage à la déconnexion
    ws.on('close', () => {
      if (doc) {
        doc.off('update', updateHandler);
      }
      
      // Décrémenter le compteur de connexions
      const connectionCount = (connections.get(pageId) || 1) - 1;
      connections.set(pageId, connectionCount);
      
      console.log(`[Yjs] Déconnexion pour la page: ${pageId} (restant: ${connectionCount})`);
      
      // Si plus personne n'est connecté, supprimer le document de la mémoire
      if (connectionCount <= 0) {
        if (doc) {
          // Persister les dernières modifications avant suppression
          persistence.flushDocument(pageId);
          doc.destroy();
        }
        docs.delete(pageId);
        connections.delete(pageId);
        console.log(`[Yjs] Document supprimé de la mémoire pour la page: ${pageId}`);
      }
    });

    console.log(`[Yjs] Connexion établie pour la page: ${pageId}`);
  });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    const token = url.searchParams.get('token');

    console.log(`[WS] Tentative de connexion: ${url.pathname}`);
    console.log(`[WS] Token présent: ${!!token}`);

    if (url.pathname.startsWith('/ws/save/')) {
        // Route de sauvegarde rapide
        if (!token) {
            console.log('[WS] ❌ Token manquant pour sauvegarde - connexion rejetée');
            socket.destroy();
            return;
        }
        authenticateTokenWS(token).then(user => {
            if (user) {
                console.log(`[WS] ✅ Sauvegarde WebSocket - user: ${user.id}`);
                // Stocker l'utilisateur dans la request pour l'utiliser dans la connexion
                (request as any).user = user;
                wss.handleUpgrade(request, socket, head, (ws) => {
                    wss.emit('connection', ws, request);
                });
            } else {
                console.log('[WS] ❌ Authentication sauvegarde échouée');
                socket.destroy();
            }
        }).catch(error => {
            console.log('[WS] ❌ Erreur auth sauvegarde:', error);
            socket.destroy();
        });
    } else if (url.pathname.startsWith('/ws/collaboration/')) {
        if (!token) {
            console.log('[WS] ❌ Token manquant - connexion rejetée');
            socket.destroy();
            return;
        }
        authenticateTokenWS(token).then(user => {
            if (user) {
                console.log(`[WS] ✅ Authentication réussie pour user: ${user.id}`);
                // Stocker l'utilisateur dans la request pour l'utiliser dans la connexion
                (request as any).user = user;
                wss.handleUpgrade(request, socket, head, (ws) => {
                    wss.emit('connection', ws, request);
                });
            } else {
                console.log('[WS] ❌ Authentication échouée - connexion rejetée');
                socket.destroy();
            }
        }).catch(error => {
            console.log('[WS] ❌ Erreur lors de l\'authentication:', error);
            socket.destroy();
        });
    } else if (url.pathname.startsWith('/ws/quiz-progress/')) {
        // Route pour les mises à jour de progression de quiz
        if (!token) {
            console.log('[WS] ❌ Token manquant pour progression - connexion rejetée');
            socket.destroy();
            return;
        }
        
        // Extraire l'ID du processus depuis l'URL
        const pathSegments = url.pathname.split('/').filter(Boolean);
        const progressIndex = pathSegments.indexOf('quiz-progress');
        const processId = progressIndex >= 0 && progressIndex + 1 < pathSegments.length 
            ? pathSegments[progressIndex + 1] 
            : null;
            
        if (!processId) {
            console.log('[WS] ❌ ID de processus manquant pour progression');
            socket.destroy();
            return;
        }
        
        authenticateTokenWS(token).then(user => {
            if (user) {
                console.log(`[WS] ✅ Progression WebSocket - user: ${user.id}, processus: ${processId}`);
                wss.handleUpgrade(request, socket, head, (ws) => {
                    // Enregistrer la connexion dans le service de progression
                    progressService.registerConnection(processId, ws);
                    
                    // Envoyer confirmation de connexion
                    ws.send(JSON.stringify({
                        type: 'connected',
                        processId,
                        timestamp: Date.now(),
                        message: 'Connexion progression établie'
                    }));
                });
            } else {
                console.log('[WS] ❌ Authentication progression échouée');
                socket.destroy();
            }
        }).catch(error => {
            console.log('[WS] ❌ Erreur auth progression:', error);
            socket.destroy();
        });
    } else {
        console.log(`[WS] ❌ Chemin non autorisé: ${url.pathname}`);
        socket.destroy();
    }
  });

  console.log('🚀 Serveur WebSocket configuré :');
  console.log('   - /ws/collaboration/ (Yjs)');  
  console.log('   - /ws/save/ (Sauvegarde)');
  console.log('   - /ws/quiz-progress/ (Progression quiz)');
};

server.listen(PORT, async () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🚀 Serveur Pen SaaS démarré sur le port ${PORT} en mode ${NODE_ENV}`);
  console.log(`✨ VERSION: OPTIMIZED-PERF-LOGS - ${new Date().toISOString()}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  setupYjsWebSocket(server);

  try {
    await DatabaseHealthCheck.displayDiagnostic();
    const connectionOk = await DatabaseHealthCheck.testConnectionWithRetry(3);
    if (connectionOk) {
      console.log('🎯 Démarrage des tâches automatiques...');
      startCronJobs();
    } else {
      console.error('⚠️ Tâches automatiques désactivées - BDD inaccessible');
    }
  } catch (error: any) {
    console.error('❌ Erreur lors du diagnostic de BDD:', error.message);
  }
});
