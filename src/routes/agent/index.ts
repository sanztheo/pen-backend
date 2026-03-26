/**
 * Agent Routes — Entry point
 *
 * Mounts sub-routers for chat, workflow, and conversations.
 * Applies authenticateToken globally to all agent routes.
 */

import { Router } from "express";
import { authenticateToken } from "../../middlewares/auth.js";
import { chatStreamRouter } from "./chatStream.js";
import { chatRouter } from "./chat.js";
import { chatSimpleRouter } from "./chatSimple.js";
import { workflowRouter } from "./workflow.js";
import { conversationRouter } from "./conversations.js";

const router = Router();

// Authentification requise pour toutes les routes
router.use(authenticateToken);

// chatStreamRouter MUST be mounted before chatRouter (no AI cost middlewares)
router.use(chatStreamRouter);
router.use(chatRouter);
router.use(chatSimpleRouter);
router.use(workflowRouter);
router.use(conversationRouter);

export { router as agentRouter };
