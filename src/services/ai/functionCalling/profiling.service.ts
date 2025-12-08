/**
 * Profiling Service - Timestamps pour analyser les performances du flux search
 * 
 * Sauvegarde les timestamps dans un fichier JSON pour analyse
 */

import fs from 'fs';
import path from 'path';

interface TimestampEntry {
  event: string;
  timestamp: number;
  elapsed: number; // ms depuis le début
  delta: number;   // ms depuis le dernier event
}

interface ProfilingSession {
  sessionId: string;
  query: string;
  startTime: number;
  endTime?: number;
  totalDuration?: number;
  entries: TimestampEntry[];
}

// Stockage global des sessions actives
const activeSessions: Map<string, ProfilingSession> = new Map();

// Chemin du fichier de profiling
const PROFILING_FILE = path.join(process.cwd(), 'profiling_timestamps.json');

export class ProfilingService {
  /**
   * Démarre une nouvelle session de profiling
   */
  static startSession(sessionId: string, query: string): void {
    const session: ProfilingSession = {
      sessionId,
      query: query.slice(0, 100), // Tronquer la query
      startTime: Date.now(),
      entries: [],
    };
    activeSessions.set(sessionId, session);
    
    this.addTimestamp(sessionId, '🚀 SESSION_START');
    console.log(`⏱️ [PROFILING] Session started: ${sessionId}`);
  }

  /**
   * Ajoute un timestamp à la session
   */
  static addTimestamp(sessionId: string, event: string): void {
    const session = activeSessions.get(sessionId);
    if (!session) {
      console.warn(`⏱️ [PROFILING] Session not found: ${sessionId}`);
      return;
    }

    const now = Date.now();
    const elapsed = now - session.startTime;
    const lastEntry = session.entries[session.entries.length - 1];
    const delta = lastEntry ? now - (session.startTime + lastEntry.elapsed) : 0;

    const entry: TimestampEntry = {
      event,
      timestamp: now,
      elapsed,
      delta,
    };

    session.entries.push(entry);
    
    // Log avec format visible
    const elapsedStr = (elapsed / 1000).toFixed(3);
    const deltaStr = delta > 0 ? `+${delta}ms` : '';
    console.log(`⏱️ [${elapsedStr}s] ${deltaStr} ${event}`);
  }

  /**
   * Termine une session et sauvegarde dans le fichier JSON
   */
  static endSession(sessionId: string): ProfilingSession | null {
    const session = activeSessions.get(sessionId);
    if (!session) {
      console.warn(`⏱️ [PROFILING] Session not found: ${sessionId}`);
      return null;
    }

    this.addTimestamp(sessionId, '✅ SESSION_END');
    
    session.endTime = Date.now();
    session.totalDuration = session.endTime - session.startTime;

    // Sauvegarder dans le fichier JSON
    this.saveToFile(session);

    // Nettoyer la session
    activeSessions.delete(sessionId);

    console.log(`⏱️ [PROFILING] Session ended: ${sessionId} (${session.totalDuration}ms total)`);
    return session;
  }

  /**
   * Sauvegarde la session dans un fichier JSON
   */
  private static saveToFile(session: ProfilingSession): void {
    try {
      let data: ProfilingSession[] = [];
      
      // Lire le fichier existant s'il existe
      if (fs.existsSync(PROFILING_FILE)) {
        const content = fs.readFileSync(PROFILING_FILE, 'utf-8');
        data = JSON.parse(content);
      }

      // Ajouter la nouvelle session
      data.push(session);

      // Garder seulement les 50 dernières sessions
      if (data.length > 50) {
        data = data.slice(-50);
      }

      // Sauvegarder
      fs.writeFileSync(PROFILING_FILE, JSON.stringify(data, null, 2));
      console.log(`⏱️ [PROFILING] Saved to ${PROFILING_FILE}`);
    } catch (error) {
      console.error(`⏱️ [PROFILING] Error saving:`, error);
    }
  }

  /**
   * Helper pour créer un ID de session unique
   */
  static generateSessionId(): string {
    return `prof_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
}
