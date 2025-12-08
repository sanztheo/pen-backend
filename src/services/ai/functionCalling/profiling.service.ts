/**
 * Profiling Service - Timestamps pour analyser les performances du flux search
 * 
 * DÉSACTIVÉ EN PRODUCTION - Les méthodes sont des no-ops
 */

// Flag pour activer/désactiver le profiling (mettre à true pour debug local)
const PROFILING_ENABLED = false;

export class ProfilingService {
  /**
   * Démarre une nouvelle session de profiling (no-op en prod)
   */
  static startSession(_sessionId: string, _query: string): void {
    // No-op en production
  }

  /**
   * Ajoute un timestamp à la session (no-op en prod)
   */
  static addTimestamp(_sessionId: string, _event: string): void {
    // No-op en production
  }

  /**
   * Termine une session (no-op en prod)
   */
  static endSession(_sessionId: string): null {
    return null;
  }

  /**
   * Helper pour créer un ID de session unique
   */
  static generateSessionId(): string {
    return PROFILING_ENABLED ? `prof_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` : '';
  }
}
