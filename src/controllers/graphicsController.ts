import { Request, Response } from "express";
import { z } from "zod";
import { AIGraphicGenerator } from "../services/quiz/graphics/aiGraphicGenerator.js";
import { secureError } from "../lib/secureLogging.js";
import { logger } from "../utils/logger.js";
import { MODELS } from "../config/models.js";

// 🛡️ Liste des bibliothèques de graphiques supportées
const SUPPORTED_LIBRARIES = [
  "plotly",
  "d3",
  "chart.js",
  "apexcharts",
  "highcharts",
  "matplotlib",
  "seaborn",
  "ggplot2",
] as const;

const generateGraphicSchema = z.object({
  subject: z.string().min(1, "Subject requis").max(100),
  topic: z.string().min(1, "Topic requis").max(200),
  level: z.enum([
    "SIXIEME",
    "CINQUIEME",
    "QUATRIEME",
    "TROISIEME",
    "SECONDE",
    "PREMIERE",
    "TERMINALE",
  ]),
  library: z.enum(SUPPORTED_LIBRARIES).optional(),
  questionContext: z.string().max(500).optional(),
});

export class GraphicsController {
  private aiGraphicGenerator = new AIGraphicGenerator();

  /**
   * Génère un graphique avec l'IA
   * POST /api/quiz/graphics/generate
   */
  async generateGraphic(req: Request, res: Response) {
    try {
      // 🛡️ Validation stricte des paramètres avec Zod
      const validatedData = generateGraphicSchema.parse(req.body);

      logger.log(
        `[GRAPHICS-API] Génération demandée: ${validatedData.subject} - ${validatedData.topic} (${validatedData.level})`,
      );

      // Génération par l'IA
      const graphic = await this.aiGraphicGenerator.generateGraphicWithAI({
        subject: validatedData.subject,
        topic: validatedData.topic,
        level: validatedData.level,
        library: validatedData.library,
        questionContext:
          validatedData.questionContext ||
          `Question de ${validatedData.subject} sur ${validatedData.topic}`,
      });

      logger.log(`[GRAPHICS-API] Graphique généré: ${graphic.type} avec ${graphic.library}`);

      res.json({
        success: true,
        data: graphic,
        metadata: {
          generatedAt: new Date().toISOString(),
          model: MODELS.GRAPHICS,
          subject: validatedData.subject,
          topic: validatedData.topic,
          level: validatedData.level,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: "Paramètres invalides",
          details: error.errors,
        });
      }

      secureError("[GRAPHICS-API] Erreur génération", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Erreur génération graphique",
      });
    }
  }
}
