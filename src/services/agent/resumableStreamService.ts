/**
 * 🔄 Resumable Stream Service
 *
 * Wrapper autour de `resumable-stream/ioredis` pour permettre
 * la reprise de streams SSE après un refresh du navigateur.
 *
 * Architecture:
 * - Express est un serveur long-running (pas serverless)
 * - waitUntil = null (pas besoin de maintenir le process vivant)
 * - Redis pub/sub créé automatiquement par le package via REDIS_URL
 *
 * @see https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-resume-streams
 */

import { createResumableStreamContext } from "resumable-stream/ioredis";

let streamContext: ReturnType<typeof createResumableStreamContext> | null = null;

export function getStreamContext(): ReturnType<typeof createResumableStreamContext> {
  if (!streamContext) {
    streamContext = createResumableStreamContext({
      // Express ne s'éteint jamais — pas besoin de waitUntil
      waitUntil: null,
    });
  }
  return streamContext;
}
