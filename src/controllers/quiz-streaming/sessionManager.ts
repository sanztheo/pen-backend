import { v4 as uuidv4 } from "uuid";
import type { StreamingSession, StreamingSessionRequest } from "./types.js";

const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export const MAX_TOTAL_SESSIONS = 10000;
export const MAX_SESSIONS_PER_USER = 5;

const sessions = new Map<string, StreamingSession>();
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

export const SessionManager = {
  create(userId: string, request: StreamingSessionRequest): string {
    // Global session limit — attempt cleanup before rejecting
    if (sessions.size >= MAX_TOTAL_SESSIONS) {
      SessionManager.cleanupExpired();
      if (sessions.size >= MAX_TOTAL_SESSIONS) {
        throw new Error("Server session capacity reached. Try again later.");
      }
    }

    // Per-user session limit
    let userSessionCount = 0;
    for (const session of sessions.values()) {
      if (session.userId === userId) {
        userSessionCount++;
      }
    }
    if (userSessionCount >= MAX_SESSIONS_PER_USER) {
      throw new Error(
        `Session limit reached for user. Max ${MAX_SESSIONS_PER_USER} concurrent sessions.`,
      );
    }

    const sessionId = uuidv4();
    sessions.set(sessionId, { userId, request, createdAt: new Date() });
    return sessionId;
  },

  get(sessionId: string): StreamingSession | undefined {
    return sessions.get(sessionId);
  },

  delete(sessionId: string): void {
    sessions.delete(sessionId);
  },

  clear(): void {
    sessions.clear();
  },

  size(): number {
    return sessions.size;
  },

  cleanupExpired(): void {
    const now = Date.now();
    for (const [sessionId, session] of sessions.entries()) {
      if (now - session.createdAt.getTime() > SESSION_TTL_MS) {
        sessions.delete(sessionId);
      }
    }
  },

  startCleanup(): void {
    if (cleanupTimer !== null) return;
    cleanupTimer = setInterval(() => SessionManager.cleanupExpired(), CLEANUP_INTERVAL_MS);
  },

  stopCleanup(): void {
    if (cleanupTimer !== null) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
  },
};

// Auto-start cleanup on module load
SessionManager.startCleanup();
