import { Router, Request } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { generateText } from "ai";
import { prisma } from "../lib/prisma.js";
import { authenticateToken, requireUser } from "../middlewares/auth.js";
import { agentsCrudRateLimit } from "../middlewares/rateLimiting.js";
import { PRESET_AGENTS } from "../services/agent/presetAgents.js";
import { google } from "../config/providers.js";
import { logger } from "../utils/logger.js";
import { getRateLimitStoreWithFallback } from "../config/rateLimitStore.js";

const generatePromptRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) =>
    (req as Request & { user?: { id: string } }).user?.id ?? "unknown",
  message: { error: "Trop de requêtes de génération. Réessayez dans 1 minute." },
  store: getRateLimitStoreWithFallback("agent-generate-prompt"),
});

const router = Router();

router.use(authenticateToken);
router.use(requireUser);
router.use(agentsCrudRateLimit);

// ============================================================================
// MAX CUSTOM AGENTS PER USER
// ============================================================================

const MAX_CUSTOM_AGENTS_PER_USER = 50;

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

const createAgentSchema = z.object({
  name: z.string().min(1).max(50),
  emoji: z.string().min(1).max(10),
  description: z.string().min(1).max(200),
  systemPrompt: z.string().min(1).max(2000),
});

const updateAgentSchema = createAgentSchema.partial();

// ============================================================================
// PRESET AGENTS
// ============================================================================

/** GET /agents/presets — List all preset agents (no system prompts exposed) */
router.get("/presets", (_req, res) => {
  const presets = PRESET_AGENTS.map(({ systemPrompt: _, ...agent }) => agent);
  res.json({ success: true, data: presets });
});

// ============================================================================
// CUSTOM AGENTS CRUD
// ============================================================================

/** GET /agents/custom — List user's custom agents */
router.get("/custom", async (req, res) => {
  try {
    const userId = req.user!.id;

    const agents = await prisma.customAgent.findMany({
      where: { userId, isActive: true },
      take: 50,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        emoji: true,
        description: true,
        systemPrompt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.json({ success: true, data: agents });
  } catch (error) {
    logger.error("[AGENTS] Error listing custom agents:", error);
    res.status(500).json({ success: false, error: "INTERNAL_ERROR" });
  }
});

/** POST /agents/custom — Create a custom agent */
router.post("/custom", async (req, res) => {
  try {
    const userId = req.user!.id;
    const parsed = createAgentSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: "VALIDATION_ERROR",
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    // Check max agents per user limit
    const existingCount = await prisma.customAgent.count({
      where: { userId, isActive: true },
    });

    if (existingCount >= MAX_CUSTOM_AGENTS_PER_USER) {
      logger.warn("[AGENTS] Max custom agents limit reached:", { userId, existingCount });
      res.status(403).json({
        success: false,
        error: "MAX_AGENTS_REACHED",
        message: `Vous avez atteint la limite de ${MAX_CUSTOM_AGENTS_PER_USER} agents personnalisés.`,
        limits: { used: existingCount, max: MAX_CUSTOM_AGENTS_PER_USER },
      });
      return;
    }

    const agent = await prisma.customAgent.create({
      data: { userId, ...parsed.data },
      select: {
        id: true,
        name: true,
        emoji: true,
        description: true,
        systemPrompt: true,
        createdAt: true,
      },
    });

    logger.log("[AGENTS] Custom agent created:", { userId, agentId: agent.id, name: agent.name });
    res.status(201).json({ success: true, data: agent });
  } catch (error) {
    logger.error("[AGENTS] Error creating custom agent:", error);
    res.status(500).json({ success: false, error: "INTERNAL_ERROR" });
  }
});

/** PUT /agents/custom/:id — Update a custom agent */
router.put("/custom/:id", async (req, res) => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;
    const parsed = updateAgentSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: "VALIDATION_ERROR",
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const existing = await prisma.customAgent.findFirst({
      where: { id, userId, isActive: true },
    });

    if (!existing) {
      res.status(404).json({ success: false, error: "AGENT_NOT_FOUND" });
      return;
    }

    const agent = await prisma.customAgent.update({
      where: { id },
      data: parsed.data,
      select: {
        id: true,
        name: true,
        emoji: true,
        description: true,
        systemPrompt: true,
        updatedAt: true,
      },
    });

    logger.log("[AGENTS] Custom agent updated:", { userId, agentId: id });
    res.json({ success: true, data: agent });
  } catch (error) {
    logger.error("[AGENTS] Error updating custom agent:", error);
    res.status(500).json({ success: false, error: "INTERNAL_ERROR" });
  }
});

/** DELETE /agents/custom/:id — Soft delete a custom agent */
router.delete("/custom/:id", async (req, res) => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;

    const existing = await prisma.customAgent.findFirst({
      where: { id, userId, isActive: true },
    });

    if (!existing) {
      res.status(404).json({ success: false, error: "AGENT_NOT_FOUND" });
      return;
    }

    await prisma.customAgent.update({
      where: { id },
      data: { isActive: false },
    });

    logger.log("[AGENTS] Custom agent deleted:", { userId, agentId: id });
    res.json({ success: true });
  } catch (error) {
    logger.error("[AGENTS] Error deleting custom agent:", error);
    res.status(500).json({ success: false, error: "INTERNAL_ERROR" });
  }
});

// ============================================================================
// FAVORITES
// ============================================================================

/** GET /agents/favorites — List user's favorite/recent agents */
router.get("/favorites", async (req, res) => {
  try {
    const userId = req.user!.id;

    const favorites = await prisma.agentFavorite.findMany({
      where: { userId },
      orderBy: { usedAt: "desc" },
      take: 20,
    });

    res.json({ success: true, data: favorites });
  } catch (error) {
    logger.error("[AGENTS] Error listing favorites:", error);
    res.status(500).json({ success: false, error: "INTERNAL_ERROR" });
  }
});

/** POST /agents/favorites — Add/update a favorite (upsert on use) */
const favoriteSchema = z.object({
  agentId: z.string().min(1).max(100),
  agentType: z.enum(["preset", "custom"]),
});

router.post("/favorites", async (req, res) => {
  try {
    const userId = req.user!.id;
    const parsed = favoriteSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: "VALIDATION_ERROR",
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const { agentId, agentType } = parsed.data;

    const favorite = await prisma.agentFavorite.upsert({
      where: {
        userId_agentId_agentType: { userId, agentId, agentType },
      },
      create: { userId, agentId, agentType },
      update: { usedAt: new Date() },
    });

    res.json({ success: true, data: favorite });
  } catch (error) {
    logger.error("[AGENTS] Error upserting favorite:", error);
    res.status(500).json({ success: false, error: "INTERNAL_ERROR" });
  }
});

/** DELETE /agents/favorites/:agentId — Remove a favorite */
router.delete("/favorites/:agentId", async (req, res) => {
  try {
    const userId = req.user!.id;
    const { agentId } = req.params;
    const agentType = req.query.type as string;

    if (!["preset", "custom"].includes(agentType)) {
      res.status(400).json({ success: false, error: "VALIDATION_ERROR" });
      return;
    }

    await prisma.agentFavorite.deleteMany({
      where: { userId, agentId, agentType },
    });

    res.json({ success: true });
  } catch (error) {
    logger.error("[AGENTS] Error deleting favorite:", error);
    res.status(500).json({ success: false, error: "INTERNAL_ERROR" });
  }
});

// ============================================================================
// PROMPT GENERATION (Gemini 3 Flash Preview)
// ============================================================================

const generatePromptSchema = z.object({
  description: z.string().min(5).max(500),
});

/** POST /agents/generate-prompt — AI-assisted prompt generation */
router.post("/generate-prompt", generatePromptRateLimit, async (req, res) => {
  try {
    const userId = req.user!.id;
    const parsed = generatePromptSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: "VALIDATION_ERROR",
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    if (!google) {
      res.status(503).json({
        success: false,
        error: "PROVIDER_UNAVAILABLE",
        message: "Gemini provider is not configured",
      });
      return;
    }

    const { text } = await generateText({
      model: google("gemini-2.5-flash-lite"),
      abortSignal: AbortSignal.timeout(60000),
      prompt: `You are an expert prompt engineer specializing in educational AI assistants. Generate a detailed, production-quality system prompt based on this description:

"${parsed.data.description}"

Requirements:
- Written in English
- Use XML tags for clear structure: <role>, <expertise>, <rules>, <guidelines>, <tone>
- Define a rich persona: name-style identity, expertise areas, personality traits
- Include 8-12 specific behavioral rules covering: how to explain, how to handle mistakes, how to encourage, what to avoid
- Add concrete examples of good behavior where relevant
- Include guidelines for tone, formality level, and interaction style
- Focus on educational assistance for students (middle school to university)
- Target length: 1500-1800 characters — be thorough, not minimal

Return ONLY the system prompt text. No explanations, no markdown formatting, no preamble.`,
    });

    logger.log("[AGENTS] Prompt generated via Gemini 2.0 Flash Lite:", { userId });
    res.json({ success: true, data: { prompt: text.trim() } });
  } catch (error) {
    logger.error("[AGENTS] Error generating prompt:", error);
    const isTimeout = error instanceof DOMException && error.name === "TimeoutError";
    res.status(isTimeout ? 504 : 500).json({
      success: false,
      error: isTimeout ? "GENERATION_TIMEOUT" : "GENERATION_FAILED",
      message: isTimeout
        ? "La génération a pris trop de temps. Réessayez."
        : "Erreur lors de la génération. Réessayez.",
    });
  }
});

export { router as agentsRouter };
