import type { Response } from "express";
import type { SSEEventData, SSESender } from "./types.js";

/**
 * Simple SSE sender — writes event + data, calls flush.
 * Flush is called unconditionally when available (required by compression middleware).
 */
export function createSSESender(res: Response): SSESender {
  return (event: string, data: SSEEventData): void => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (typeof (res as unknown as Record<string, unknown>).flush === "function") {
      (res as unknown as { flush: () => void }).flush();
    }
  };
}

/**
 * SSE sender with disconnect tracking.
 * Send becomes a no-op after markDisconnected() is called,
 * preventing writes to a closed connection.
 */
export function createSSESenderWithDisconnect(res: Response): {
  send: SSESender;
  markDisconnected: () => void;
  isDisconnected: () => boolean;
} {
  let disconnected = false;

  const send: SSESender = (event: string, data: SSEEventData): void => {
    if (disconnected) {
      return;
    }
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (typeof (res as unknown as Record<string, unknown>).flush === "function") {
      (res as unknown as { flush: () => void }).flush();
    }
  };

  return {
    send,
    markDisconnected: (): void => {
      disconnected = true;
    },
    isDisconnected: (): boolean => disconnected,
  };
}
