import { Response } from "express";

type SSEHeaderOverrides = Record<string, string>;

/**
 * Sets the standard SSE response headers and flushes them with writeHead(200).
 * Pass `overrides` to add or replace individual headers (e.g. CORS, AI SDK).
 *
 * Usage:
 *   setupSSEHeaders(res);
 *   setupSSEHeaders(res, { "Access-Control-Allow-Origin": origin });
 */
export function setupSSEHeaders(res: Response, overrides?: SSEHeaderOverrides): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    ...overrides,
  });
}
