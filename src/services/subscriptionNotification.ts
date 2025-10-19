import { WebSocket } from 'ws';

/**
 * 🔔 Service de notification de changement de subscription
 * 
 * Permet de notifier les clients connectés quand leur subscription change
 * (upgrade, downgrade, activation, annulation, etc.)
 */
export class SubscriptionNotificationService {
  private static instance: SubscriptionNotificationService;
  private connections = new Map<string, WebSocket[]>(); // userId → [websockets]

  private constructor() {}

  static getInstance(): SubscriptionNotificationService {
    if (!SubscriptionNotificationService.instance) {
      SubscriptionNotificationService.instance = new SubscriptionNotificationService();
    }
    return SubscriptionNotificationService.instance;
  }

  /**
   * Enregistrer une connexion WebSocket pour un utilisateur
   */
  registerConnection(userId: string, ws: WebSocket): void {
    if (!userId) {
      console.warn('[SubscriptionNotification] ⚠️ userId manquant');
      return;
    }

    if (!this.connections.has(userId)) {
      this.connections.set(userId, []);
    }
    
    this.connections.get(userId)!.push(ws);
    console.log(`[SubscriptionNotification] ✅ Connexion enregistrée pour ${userId} (total: ${this.connections.get(userId)!.length})`);

    // Nettoyer la connexion quand elle se ferme
    ws.on('close', () => {
      const userConnections = this.connections.get(userId);
      if (userConnections) {
        const index = userConnections.indexOf(ws);
        if (index > -1) {
          userConnections.splice(index, 1);
        }
        if (userConnections.length === 0) {
          this.connections.delete(userId);
        }
      }
    });

    ws.on('error', (error) => {
      console.error(`[SubscriptionNotification] ❌ Erreur WebSocket pour ${userId}:`, error);
      const userConnections = this.connections.get(userId);
      if (userConnections) {
        const index = userConnections.indexOf(ws);
        if (index > -1) {
          userConnections.splice(index, 1);
        }
      }
    });
  }

  /**
   * Notifier un utilisateur que sa subscription a changé
   */
  notifySubscriptionChange(userId: string, data: {
    oldPlan: string;
    newPlan: string;
    status: string;
    reason: 'upgrade' | 'downgrade' | 'activation' | 'cancellation' | 'ended';
  }): void {
    const userConnections = this.connections.get(userId);
    
    if (!userConnections || userConnections.length === 0) {
      console.log(`[SubscriptionNotification] ℹ️ Aucune connexion active pour ${userId}`);
      return;
    }

    const message = {
      type: 'subscription_changed',
      timestamp: new Date().toISOString(),
      userId,
      ...data
    };

    console.log(`[SubscriptionNotification] 📢 Notification envoyée à ${userId}:`, message);

    // Envoyer à toutes les connexions de cet utilisateur
    for (const ws of userConnections) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify(message));
        } catch (error) {
          console.error(`[SubscriptionNotification] ❌ Erreur lors de l'envoi à ${userId}:`, error);
        }
      }
    }
  }

  /**
   * Obtenir le nombre de connexions pour un utilisateur
   */
  getConnectionCount(userId: string): number {
    return this.connections.get(userId)?.length || 0;
  }
}
