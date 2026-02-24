import { Request, Response } from "express";
import { AIService } from "../../services/ai/index.js";
import { logger } from "../../utils/logger.js";

// Tester la configuration et connexion IA
export const testAI = async (req: Request, res: Response) => {
  try {
    if (!AIService.isConfigured()) {
      return res.status(503).json({
        error: "Service IA non configuré",
        details: "OPENAI_API_KEY manquante dans les variables d'environnement",
        configured: false,
      });
    }

    const startTime = Date.now();
    const isConnected = await AIService.testConnection();
    const responseTime = Date.now() - startTime;

    if (!isConnected) {
      return res.status(503).json({
        error: "Connexion IA échouée",
        configured: true,
        connected: false,
        responseTime,
      });
    }

    res.json({
      message: "Service IA opérationnel",
      configured: true,
      connected: true,
      responseTime,
      // 🚨 SÉCURITÉ: Ne plus exposer le modèle en production
      ...(process.env.NODE_ENV !== "production" && {
        model: process.env.OPENAI_DASHBOARD_MODEL || process.env.OPENAI_MODEL,
      }),
    });
  } catch (error) {
    logger.error("Erreur test IA:", error);
    res.status(500).json({
      error: "Erreur interne lors du test IA",
      configured: AIService.isConfigured(),
      connected: false,
    });
  }
};
