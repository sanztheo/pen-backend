import { WebSocketServer, WebSocket } from "ws";

/**
 * Service de gestion de la progression des quiz en temps réel via WebSocket
 */
export class ProgressService {
  private static instance: ProgressService;
  private connections: Map<string, WebSocket> = new Map();
  private processOwners: Map<string, string> = new Map();

  private constructor() {}

  static getInstance(): ProgressService {
    if (!ProgressService.instance) {
      ProgressService.instance = new ProgressService();
    }
    return ProgressService.instance;
  }

  /**
   * Enregistre une nouvelle connexion WebSocket pour un processus de génération
   */
  registerProcessOwner(processId: string, userId: string): void {
    this.processOwners.set(processId, userId);
  }

  isProcessOwner(processId: string, userId: string): boolean {
    const owner = this.processOwners.get(processId);
    return owner === userId;
  }

  registerConnection(processId: string, ws: WebSocket): void {
    console.log(
      `[ProgressService] ✅ Connexion enregistrée pour processus: ${processId}`,
    );
    this.connections.set(processId, ws);

    ws.on("close", () => {
      this.connections.delete(processId);
      this.processOwners.delete(processId);
      console.log(
        `[ProgressService] 🔌 Connexion fermée pour processus: ${processId}`,
      );
    });

    ws.on("error", (error) => {
      console.error(
        `[ProgressService] ❌ Erreur WebSocket pour ${processId}:`,
        error,
      );
      this.connections.delete(processId);
      this.processOwners.delete(processId);
    });
  }

  /**
   * Envoie une mise à jour de progression pour un processus donné
   */
  sendProgress(
    processId: string,
    data: {
      percentage: number;
      stage: string;
      message?: string;
      details?: any;
    },
  ): void {
    const ws = this.connections.get(processId);

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn(
        `[ProgressService] ⚠️ Connexion fermée ou indisponible pour: ${processId}`,
      );
      this.connections.delete(processId);
      return;
    }

    try {
      const progressUpdate = {
        type: "progress",
        processId,
        timestamp: Date.now(),
        ...data,
      };

      console.log(
        `[ProgressService] 📊 Progression envoyée pour ${processId}:`,
        progressUpdate,
      );
      ws.send(JSON.stringify(progressUpdate));
    } catch (error) {
      console.error(
        `[ProgressService] ❌ Erreur envoi progression pour ${processId}:`,
        error,
      );
      this.connections.delete(processId);
    }
  }

  /**
   * Marque un processus comme terminé avec succès
   */
  sendSuccess(processId: string, result: any): void {
    const ws = this.connections.get(processId);

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn(
        `[ProgressService] ⚠️ Connexion fermée pour succès: ${processId}`,
      );
      this.connections.delete(processId);
      return;
    }

    try {
      const successUpdate = {
        type: "success",
        processId,
        timestamp: Date.now(),
        percentage: 100,
        result,
      };

      console.log(`[ProgressService] ✅ Succès envoyé pour ${processId}`);
      ws.send(JSON.stringify(successUpdate));

      // Fermer la connexion après un délai
      setTimeout(() => {
        if (this.connections.has(processId)) {
          ws.close();
          this.connections.delete(processId);
        }
      }, 2000);
    } catch (error) {
      console.error(
        `[ProgressService] ❌ Erreur envoi succès pour ${processId}:`,
        error,
      );
      this.connections.delete(processId);
    }
  }

  /**
   * Marque un processus comme échoué
   */
  sendError(processId: string, error: string): void {
    const ws = this.connections.get(processId);

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn(
        `[ProgressService] ⚠️ Connexion fermée pour erreur: ${processId}`,
      );
      this.connections.delete(processId);
      return;
    }

    try {
      const errorUpdate = {
        type: "error",
        processId,
        timestamp: Date.now(),
        percentage: 0,
        error,
      };

      console.log(
        `[ProgressService] ❌ Erreur envoyée pour ${processId}:`,
        error,
      );
      ws.send(JSON.stringify(errorUpdate));

      // Fermer la connexion après un délai
      setTimeout(() => {
        if (this.connections.has(processId)) {
          ws.close();
          this.connections.delete(processId);
        }
      }, 2000);
    } catch (error) {
      console.error(
        `[ProgressService] ❌ Erreur envoi erreur pour ${processId}:`,
        error,
      );
      this.connections.delete(processId);
    }
  }

  /**
   * Vérifie si une connexion est active pour un processus
   */
  hasActiveConnection(processId: string): boolean {
    const ws = this.connections.get(processId);
    return ws !== undefined && ws.readyState === WebSocket.OPEN;
  }

  /**
   * Ferme toutes les connexions actives
   */
  closeAllConnections(): void {
    console.log(
      `[ProgressService] 🔌 Fermeture de ${this.connections.size} connexions...`,
    );

    for (const [processId, ws] of this.connections.entries()) {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      } catch (error) {
        console.error(
          `[ProgressService] ❌ Erreur fermeture connexion ${processId}:`,
          error,
        );
      }
    }

    this.connections.clear();
  }

  /**
   * Obtient le nombre de connexions actives
   */
  getActiveConnectionsCount(): number {
    // Nettoyer les connexions fermées
    for (const [processId, ws] of this.connections.entries()) {
      if (ws.readyState !== WebSocket.OPEN) {
        this.connections.delete(processId);
      }
    }

    return this.connections.size;
  }
}

// Export de l'instance singleton
export const progressService = ProgressService.getInstance();
