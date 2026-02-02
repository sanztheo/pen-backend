import { Router } from "express";
import { logger } from "../utils/logger.js";
import {
  createWorkspace,
  getWorkspaces,
  getWorkspaceById,
  updateWorkspace,
  deleteWorkspace,
} from "../controllers/workspace.js";
import { Router as _Router } from "express";
import { prisma } from "../lib/prisma.js";
import { authenticateToken, requireUser } from "../middlewares/auth.js";

const router = Router();

// Toutes les routes nécessitent une authentification ET la présence de req.user
router.use(authenticateToken);
router.use(requireUser);

// Routes des workspaces
router.post("/", createWorkspace);
router.get("/", getWorkspaces);
router.get("/:id", getWorkspaceById);
router.put("/:id", updateWorkspace);
router.delete("/:id", deleteWorkspace);

// 🔎 Pages d'un workspace (pour le menu "Toutes les sources")
// 🛡️ SÉCURITÉ: Vérification d'accès au workspace avant de retourner les pages
router.get("/:id/pages", async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    // 🛡️ Vérifier que l'utilisateur a accès au workspace (propriétaire ou membre)
    const workspace = await prisma.workspace.findFirst({
      where: {
        id,
        OR: [
          { ownerId: userId },
          { members: { some: { userId, isActive: true } } },
        ],
      },
    });

    if (!workspace) {
      logger.warn(
        `🚨 [IDOR-BLOCKED] GET /workspaces/:id/pages - userId=${userId}, workspaceId=${id}`,
      );
      return res.status(403).json({
        error: "Accès au workspace refusé",
        code: "WORKSPACE_ACCESS_DENIED",
      });
    }

    const pages = await prisma.page.findMany({
      where: { workspaceId: id, isArchived: false },
      select: {
        id: true,
        title: true,
        projectId: true,
        workspaceId: true,
        updatedAt: true,
        icon: true,
        iconColor: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
    });

    res.json({ pages });
  } catch (error) {
    logger.error("[GET /workspaces/:id/pages] error", error);
    res.status(500).json({ error: "Erreur liste des pages" });
  }
});

export { router as workspaceRouter };
