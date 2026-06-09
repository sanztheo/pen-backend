/**
 * Lightweight debug logger for the assistant controllers.
 *
 * Logs are gated behind the DEBUG env var so production stays quiet by default.
 * Enable with DEBUG=true (or any non-"false" value) to surface RAG / web /
 * performance traces from the assistant pipeline.
 */

const DEBUG_ENABLED = Boolean(process.env.DEBUG && process.env.DEBUG !== "false");

function log(prefix: string, message: unknown, ...args: unknown[]): void {
  if (!DEBUG_ENABLED) return;
  console.log(prefix, message, ...args);
}

export const DebugLogger = {
  rag(message: unknown, ...args: unknown[]): void {
    log("[RAG]", message, ...args);
  },
  web(message: unknown, ...args: unknown[]): void {
    log("[WEB]", message, ...args);
  },
  performance(message: unknown, ...args: unknown[]): void {
    log("[PERF]", message, ...args);
  },
};
