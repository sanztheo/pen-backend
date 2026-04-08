import { Router } from "express";
import { GraphicsController } from "../controllers/graphicsController.js";
import { authenticateToken } from "../middlewares/auth.js";
import { requireAICredits } from "../middlewares/requireAICredits.js";
import { requirePaidPlan } from "../middlewares/requirePaidPlan.js";

const router = Router();
const graphicsController = new GraphicsController();

// 🛡️ ROUTE SÉCURISÉE - Génération de graphiques IA avec vérification premium + crédits IA
router.post(
  "/generate",
  authenticateToken,
  requirePaidPlan(),
  requireAICredits({ cost: 1.0, action: "ai_graphic_generation" }),
  (req, res) => {
    graphicsController.generateGraphic(req, res);
  },
);

export { router as graphicsRouter };
