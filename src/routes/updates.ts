import { Router } from "express";
import { authenticateToken } from "../middlewares/auth.js";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { prisma } from "../lib/prisma.js";
const router = Router();

router.use(authenticateToken);

// GET /api/updates - Récupérer les dernières updates
router.get(
  "/",
  asyncHandler(async (_req, res) => {
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
  }),
);

// GET /api/updates/:id - Récupérer une update spécifique
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const update = await prisma.update.findUnique({
      where: {
        id: id,
        isPublished: true,
      },
    });

    if (!update) {
      res.status(404).json({ error: "Update non trouvée" });
      return;
    }

    res.json({ update });
  }),
);

export { router as updatesRouter };
