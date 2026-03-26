/**
 * Agent Chat Stream Resumption Route
 *
 * GET /chat/:id/stream — Reprise de stream après refresh
 */

import { logger } from "../../utils/logger.js";
import { Router } from "express";
import type { Request, Response } from "express";
import { updateActiveStreamId } from "../../services/agent/conversationService.js";
import { getStreamContext } from "../../services/agent/resumableStreamService.js";
import { prisma } from "../../lib/prisma.js";

export const chatStreamRouter = Router();

// 🔄 GET /chat/:id/stream — Reprise de stream après refresh
// DOIT être AVANT les middlewares AI (pas de coût AI sur ce endpoint)
chatStreamRouter.get("/chat/:id/stream", async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Non authentifié" });

  const conversation = await prisma.aIConversation.findFirst({
    where: { id: req.params.id, userId },
    select: { activeStreamId: true },
  });

  if (!conversation?.activeStreamId) {
    return res.status(204).end();
  }

  const ctx = getStreamContext();
  const resumed = await ctx.resumeExistingStream(conversation.activeStreamId);

  if (!resumed) {
    await updateActiveStreamId(req.params.id, null, userId);
    return res.status(204).end();
  }

  // Headers SSE standard (même format que le AI SDK)
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Vercel-AI-UI-Message-Stream": "v1",
    "X-Accel-Buffering": "no",
  });

  const reader = resumed.getReader();
  try {
    let chunk = await reader.read();
    while (!chunk.done) {
      res.write(chunk.value);
      chunk = await reader.read();
    }
  } catch (err) {
    logger.error("[RESUME-STREAM] Erreur lecture:", err);
  } finally {
    res.end();
  }
});
