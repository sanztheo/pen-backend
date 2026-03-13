import { Router } from "express";
import { authenticateToken } from "../middlewares/auth.js";
import { logger } from "../utils/logger.js";
import { prisma } from "../lib/prisma.js";
const router = Router();

router.use(authenticateToken);

// GET /api/updates - Récupérer les dernières updates
router.get("/", async (req, res) => {
  try {
    const updates = await prisma.update.findMany({
      where: {
        isPublished: true,
      },
      orderBy: {
        date: "desc",
      },
      take: 10,
    });

    res.json({ updates });
  } catch (error) {
    logger.error("Erreur lors de la récupération des updates:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/updates/:id - Récupérer une update spécifique
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const update = await prisma.update.findUnique({
      where: {
        id: id,
        isPublished: true,
      },
    });

    if (!update) {
      return res.status(404).json({ error: "Update non trouvée" });
    }

    res.json({ update });
  } catch (error) {
    logger.error("Erreur lors de la récupération de l'update:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

export { router as updatesRouter };
