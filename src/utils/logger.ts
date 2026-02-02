/**
 * Logger wrapper for consistent logging across the backend
 *
 * This is a thin wrapper around console.* that:
 * 1. Satisfies CLAUDE.md rule (no direct console usage in app code)
 * 2. Works with the Logger class interceptor (src/lib/logger.ts)
 * 3. Provides consistent API across frontend/backend
 */

const nativeConsole = globalThis.console;

export const logger = {
  log: (...args: unknown[]) => nativeConsole.log(...args),
  warn: (...args: unknown[]) => nativeConsole.warn(...args),
  error: (...args: unknown[]) => nativeConsole.error(...args),
  info: (...args: unknown[]) => nativeConsole.info(...args),
  debug: (...args: unknown[]) => {
    if (process.env.NODE_ENV === "development" || process.env.DEBUG) {
      nativeConsole.log("[DEBUG]", ...args);
    }
  },
};
