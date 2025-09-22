import { Request, Response } from 'express';
import { z } from 'zod';
import { AIService } from '../../services/ai/index.js';
import { secureError } from '../../lib/secureLogging.js';

// Utilitaire pour timeout
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Timeout après ${ms}ms`)), ms)
  );
  return Promise.race([promise, timeout]);
}

const AI_TIMEOUT_MS = process.env.AI_TIMEOUT_MS ? parseInt(process.env.AI_TIMEOUT_MS, 10) : 60000; // 60s par défaut

// 🛡️ Liste des modèles OpenAI supportés, chargée depuis l'environnement
const modelsFromEnv = process.env.AI_SUPPORTED_MODELS?.split(',').map(m => m.trim()).filter(Boolean);
const SUPPORTED_MODELS = (modelsFromEnv && modelsFromEnv.length > 0
  ? modelsFromEnv
  : ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo']
) as [string, ...string[]];

// Schémas de validation
const generateContentSchema = z.object({
  prompt: z.string().min(1, 'Le prompt est requis'),
  maxTokens: z.number().int().min(1).max(8000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  model: z.enum(SUPPORTED_MODELS).optional(),
  context: z.string().optional()
});

const improveContentSchema = z.object({
  content: z.string().min(1, 'Le contenu est requis'),
  instructions: z.string().optional()
});

const continueContentSchema = z.object({
  content: z.string().min(1, 'Le contenu est requis'),
  length: z.enum(['court', 'moyen', 'long']).optional()
});

// Générer du contenu avec l'IA
export const generateContent = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Utilisateur non authentifié' });
    }

    const validatedData = generateContentSchema.parse(req.body);

    const startTime = Date.now();
    const result = await withTimeout(AIService.generateContent(validatedData), AI_TIMEOUT_MS);
    const responseTime = Date.now() - startTime;

    res.json({
      message: 'Contenu généré avec succès',
      result: { ...result, responseTime }
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Données invalides', details: error.errors });
    }
    secureError('Erreur génération contenu', error);
    res.status(500).json({
      error: 'Erreur lors de la génération de contenu',
      details: error instanceof Error ? error.message : 'Erreur inconnue'
    });
  }
};

// Améliorer du contenu existant
export const improveContent = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Utilisateur non authentifié' });
    }

    const validatedData = improveContentSchema.parse(req.body);

    const startTime = Date.now();
    const result = await withTimeout(AIService.improveContent(validatedData.content, validatedData.instructions), AI_TIMEOUT_MS);
    const responseTime = Date.now() - startTime;

    res.json({
      message: 'Contenu amélioré avec succès',
      result: { ...result, responseTime }
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Données invalides', details: error.errors });
    }
    secureError('Erreur amélioration contenu', error);
    res.status(500).json({
      error: 'Erreur lors de l\'amélioration du contenu',
      details: error instanceof Error ? error.message : 'Erreur inconnue'
    });
  }
};

// Continuer du contenu
export const continueContent = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Utilisateur non authentifié' });
    }

    const validatedData = continueContentSchema.parse(req.body);

    const startTime = Date.now();
    const result = await withTimeout(AIService.continueContent(validatedData.content, validatedData.length), AI_TIMEOUT_MS);
    const responseTime = Date.now() - startTime;

    res.json({
      message: 'Contenu continué avec succès',
      result: { ...result, responseTime }
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Données invalides', details: error.errors });
    }
    secureError('Erreur continuation contenu', error);
    res.status(500).json({
      error: 'Erreur lors de la continuation du contenu',
      details: error instanceof Error ? error.message : 'Erreur inconnue'
    });
  }
};
 