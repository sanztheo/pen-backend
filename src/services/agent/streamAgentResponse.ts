/**
 * SSE stream helper — wraps the `pipeUIMessageStreamToResponse + consumeStream`
 * pair so handlers cannot accidentally drop `consumeStream()`.
 *
 * Why this exists: see PRE-MORTEM.md #12. `pipeUIMessageStreamToResponse` does
 * NOT drain the stream itself. Without `consumeStream()`, `onFinish` may never
 * fire and the LLM keeps tokens flowing into a closed socket. Encapsulating
 * the pair here is the only enforcement point — every agent SSE route must go
 * through `streamAgentResponse`.
 */

import type { Response } from "express";
import type { StreamTextResult } from "ai";
import { logger } from "../../utils/logger.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AgentStreamResult = StreamTextResult<any, any>;

/** Options forwarded to `pipeUIMessageStreamToResponse`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PipeOptions = Parameters<AgentStreamResult["pipeUIMessageStreamToResponse"]>[1];

interface StreamAgentResponseOptions {
  /** Forwarded to `pipeUIMessageStreamToResponse` (originalMessages, onFinish, etc.). */
  pipeOptions?: PipeOptions;
  /** Called if `consumeStream()` rejects. Defaults to `logger.error`. */
  onError?: (err: unknown) => void;
}

/**
 * Pipes the agent SSE stream to `res` and ALWAYS calls `consumeStream()` so
 * the underlying generator drains even if the client disconnects.
 */
export function streamAgentResponse(
  res: Response,
  result: AgentStreamResult,
  options: StreamAgentResponseOptions = {},
): void {
  const pipeOptions: PipeOptions = {
    sendReasoning: true,
    ...(options.pipeOptions ?? {}),
  };

  result.pipeUIMessageStreamToResponse(res, pipeOptions);

  // CRITICAL: drain the stream so `onFinish` fires even on client disconnect.
  // Without this, the generator hangs and the conversation stays in STREAMING.
  Promise.resolve(result.consumeStream()).catch(
    options.onError ??
      ((err: unknown) => {
        logger.error("[STREAM_AGENT_RESPONSE] consumeStream error:", err);
      }),
  );
}
