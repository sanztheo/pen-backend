/**
 * 🔧 DEBUG CONFIGURATION SYSTEM
 * Système centralisé de configuration debug pour éviter les logs excessifs
 */

export interface DebugConfig {
  WEB_TRACING: boolean;
  RAG_VERBOSE: boolean;
  PERFORMANCE_TIMING: boolean;
  SESSION_DEBUG: boolean;
  EMBEDDING_DEBUG: boolean;
}

export const DEBUG_CONFIG: DebugConfig = {
  WEB_TRACING: process.env.DEBUG_WEB === "true",
  RAG_VERBOSE: process.env.DEBUG_RAG === "true",
  PERFORMANCE_TIMING: process.env.DEBUG_PERF === "true",
  SESSION_DEBUG: process.env.DEBUG_SESSION === "true",
  EMBEDDING_DEBUG: process.env.DEBUG_EMBEDDING === "true",
};

export class DebugLogger {
  static web(message: string, ...args: any[]) {
    if (DEBUG_CONFIG.WEB_TRACING) {
      console.log(`🌐 [WEB-DEBUG] ${message}`, ...args);
    }
  }

  static rag(message: string, ...args: any[]) {
    if (DEBUG_CONFIG.RAG_VERBOSE) {
      console.log(`🔍 [RAG-DEBUG] ${message}`, ...args);
    }
  }

  static performance(message: string, ...args: any[]) {
    if (DEBUG_CONFIG.PERFORMANCE_TIMING) {
      console.log(`⚡ [PERF-DEBUG] ${message}`, ...args);
    }
  }

  static session(message: string, ...args: any[]) {
    if (DEBUG_CONFIG.SESSION_DEBUG) {
      console.log(`🔍 [SESSION-DEBUG] ${message}`, ...args);
    }
  }

  static embedding(message: string, ...args: any[]) {
    if (DEBUG_CONFIG.EMBEDDING_DEBUG) {
      console.log(`🧠 [EMBEDDING-DEBUG] ${message}`, ...args);
    }
  }
}
