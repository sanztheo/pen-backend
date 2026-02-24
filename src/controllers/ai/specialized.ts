import { Request, Response } from "express";
import { z } from "zod";
import { AIService } from "../../services/ai/index.js";
import { secureError } from "../../lib/secureLogging.js";

// 🛡️ Fonction utilitaire pour échapper/nettoyer le contenu utilisateur
const sanitizeUserContent = (content: string): string => {
  return (
    content
      // Enlever les instructions potentiellement dangereuses
      .replace(
        /(?:ignore|disregard|forget)[\s\w]*(?:previous|above|system|instructions|prompt)/gi,
        "[contenu filtré]",
      )
      // Enlever les tentatives d'injection de rôle
      .replace(
        /(?:you are|act as|behave like|pretend to be)[\s\w]*(?:assistant|ai|system|admin)/gi,
        "[contenu filtré]",
      )
      // Enlever les demandes de révélation de prompt
      .replace(
        /(?:show|tell|reveal|display)[\s\w]*(?:system|prompt|instructions)/gi,
        "[contenu filtré]",
      )
      // Limiter la longueur pour éviter les attaques de déni de service
      .substring(0, 8000)
      // Nettoyer les caractères spéciaux potentiellement problématiques
      .replace(/[<>{}]/g, "")
      .trim()
  );
};

// Schémas de validation
const generateBlockSchema = z.object({
  type: z.enum(["text", "heading2", "heading3", "list", "quote", "code"]),
  prompt: z.string().min(1, "Le prompt est requis"),
  context: z.string().optional(),
});

const summarizeContentSchema = z.object({
  content: z.string().min(1, "Le contenu est requis"),
  style: z.enum(["bullet", "paragraph"]).optional(),
});

const generateIdeasSchema = z.object({
  topic: z.string().min(1, "Le sujet est requis"),
  count: z.number().int().min(1).max(20).optional(),
});

const translateContentSchema = z.object({
  content: z.string().min(1, "Le contenu est requis"),
  targetLanguage: z.string().min(1, "La langue cible est requise"),
});

// 🚀 NOUVEAUX SCHÉMAS pour les fonctionnalités IA avancées
const generatePlanSchema = z.object({
  pageContent: z.string().min(1, "Le contenu de la page est requis"),
  currentContext: z.string().optional(),
  planType: z.enum(["outline", "todo", "structure"]).optional().default("outline"),
});

const generateFromPageSchema = z.object({
  pageContent: z.string().min(1, "Le contenu de la page est requis"),
  prompt: z.string().min(1, "Le prompt est requis"),
  contextRange: z.enum(["page", "around_cursor", "selection"]).optional().default("page"),
  maxTokens: z.number().int().min(1).max(4000).optional(),
});

// Générer un bloc spécifique
export const generateBlock = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    }

    const validatedData = generateBlockSchema.parse(req.body);

    const startTime = Date.now();
    const result = await AIService.generateBlock(
      validatedData.type,
      sanitizeUserContent(validatedData.prompt),
      validatedData.context ? sanitizeUserContent(validatedData.context) : validatedData.context,
    );
    const responseTime = Date.now() - startTime;

    res.json({
      message: `Bloc ${validatedData.type} généré avec succès`,
      result: {
        ...result,
        responseTime,
        blockType: validatedData.type,
        // ✨ Ajouter la détection automatique de langage pour le code
        ...(validatedData.type === "code" &&
          result.detectedLanguage && {
            detectedLanguage: result.detectedLanguage,
          }),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: "Données invalides",
        details: error.errors,
      });
    }

    secureError("Erreur génération bloc", error);
    res.status(500).json({
      error: "Erreur lors de la génération du bloc",
      details: error instanceof Error ? error.message : "Erreur inconnue",
    });
  }
};

// 🚀 NOUVEAU : Générer un plan/structure depuis le contenu de la page
export const generatePlan = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    }

    const validatedData = generatePlanSchema.parse(req.body);

    const startTime = Date.now();

    // Construire le prompt spécialisé pour la génération de plan
    let systemPrompt = "";
    let userPrompt = "";

    switch (validatedData.planType) {
      case "outline":
        systemPrompt = `Tu es un assistant qui crée des plans et structures détaillés. 
        Génère un plan structuré sous forme de liste hiérarchique avec des titres et sous-titres clairs.
        Utilise le format markdown avec des # pour les titres principaux et des - pour les sous-points.
        Réponds uniquement avec le plan structuré.`;
        userPrompt = `Créé un plan détaillé et bien structuré basé sur ce contenu :\n\n${sanitizeUserContent(validatedData.pageContent)}`;
        break;

      case "todo":
        systemPrompt = `Tu es un assistant qui crée des listes de tâches actionables.
        Génère une liste de tâches concrètes sous forme de checkboxes.
        Utilise le format "- [ ] Tâche à faire" pour chaque élément.
        Réponds uniquement avec la liste de tâches.`;
        userPrompt = `Créé une liste de tâches actionables basée sur ce contenu :\n\n${sanitizeUserContent(validatedData.pageContent)}`;
        break;

      case "structure":
        systemPrompt = `Tu es un assistant qui analyse et restructure le contenu.
        Propose une nouvelle organisation du contenu avec des sections logiques.
        Utilise des titres clairs et indique le contenu de chaque section.
        Réponds uniquement avec la structure proposée.`;
        userPrompt = `Propose une meilleure structure pour organiser ce contenu :\n\n${sanitizeUserContent(validatedData.pageContent)}`;
        break;
    }

    // Ajouter le contexte actuel si disponible
    if (validatedData.currentContext) {
      userPrompt += `\n\nContexte actuel :\n${sanitizeUserContent(validatedData.currentContext)}`;
    }

    const result = await AIService.generateContent({
      prompt: userPrompt,
      context: systemPrompt,
      maxTokens: 800,
      temperature: 0.7,
    });

    const responseTime = Date.now() - startTime;

    res.json({
      message: "Plan généré avec succès",
      result: {
        ...result,
        responseTime,
        planType: validatedData.planType,
        originalContentLength: validatedData.pageContent.length,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: "Données invalides",
        details: error.errors,
      });
    }

    secureError("Erreur génération plan", error);
    res.status(500).json({
      error: "Erreur lors de la génération du plan",
      details: error instanceof Error ? error.message : "Erreur inconnue",
    });
  }
};

// 🚀 NOUVEAU : Générer du contenu basé sur la page entière
export const generateFromPage = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    }

    const validatedData = generateFromPageSchema.parse(req.body);

    const startTime = Date.now();

    // Construire le prompt contextualisé
    const systemPrompt = `Tu es un assistant d'écriture intelligent qui génère du contenu basé sur le contexte existant.
    Analyse le contenu fourni et génère du nouveau contenu pertinent, cohérent et de haute qualité.
    Respecte le style et le ton du contenu existant.
    Réponds uniquement avec le nouveau contenu généré, sans introduction ni conclusion.`;

    let contextInfo = "";
    switch (validatedData.contextRange) {
      case "page":
        contextInfo = "Contenu de la page entière";
        break;
      case "around_cursor":
        contextInfo = "Contenu autour de la position actuelle";
        break;
      case "selection":
        contextInfo = "Contenu sélectionné";
        break;
    }

    const userPrompt = `${sanitizeUserContent(validatedData.prompt)}

${contextInfo} :
${sanitizeUserContent(validatedData.pageContent)}

Basé sur ce contexte, génère du contenu approprié et pertinent.`;

    const result = await AIService.generateContent({
      prompt: userPrompt,
      context: systemPrompt,
      maxTokens: validatedData.maxTokens || 1000,
      temperature: 0.8,
    });

    const responseTime = Date.now() - startTime;

    res.json({
      message: "Contenu généré avec succès",
      result: {
        ...result,
        responseTime,
        contextUsed: validatedData.contextRange,
        originalContentLength: validatedData.pageContent.length,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: "Données invalides",
        details: error.errors,
      });
    }

    secureError("Erreur génération depuis page", error);
    res.status(500).json({
      error: "Erreur lors de la génération du contenu",
      details: error instanceof Error ? error.message : "Erreur inconnue",
    });
  }
};

// Résumer du contenu
export const summarizeContent = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    }

    const validatedData = summarizeContentSchema.parse(req.body);

    const startTime = Date.now();
    const result = await AIService.summarizeContent(
      sanitizeUserContent(validatedData.content),
      validatedData.style,
    );
    const responseTime = Date.now() - startTime;

    res.json({
      message: "Contenu résumé avec succès",
      result: {
        ...result,
        responseTime,
        originalLength: validatedData.content.length,
        summaryLength: result.content.length,
        compressionRatio:
          ((result.content.length / validatedData.content.length) * 100).toFixed(1) + "%",
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: "Données invalides",
        details: error.errors,
      });
    }

    secureError("Erreur résumé contenu", error);
    res.status(500).json({
      error: "Erreur lors du résumé du contenu",
      details: error instanceof Error ? error.message : "Erreur inconnue",
    });
  }
};

// Générer des idées
export const generateIdeas = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    }

    const validatedData = generateIdeasSchema.parse(req.body);

    const startTime = Date.now();
    const result = await AIService.generateIdeas(
      sanitizeUserContent(validatedData.topic),
      validatedData.count,
    );
    const responseTime = Date.now() - startTime;

    res.json({
      message: "Idées générées avec succès",
      result: {
        ...result,
        responseTime,
        topic: validatedData.topic,
        requestedCount: validatedData.count || 5,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: "Données invalides",
        details: error.errors,
      });
    }

    secureError("Erreur génération idées", error);
    res.status(500).json({
      error: "Erreur lors de la génération d'idées",
      details: error instanceof Error ? error.message : "Erreur inconnue",
    });
  }
};

// Traduire du contenu
export const translateContent = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    }

    const validatedData = translateContentSchema.parse(req.body);

    const startTime = Date.now();
    const result = await AIService.translateContent(
      sanitizeUserContent(validatedData.content),
      validatedData.targetLanguage,
    );
    const responseTime = Date.now() - startTime;

    res.json({
      message: "Contenu traduit avec succès",
      result: {
        ...result,
        responseTime,
        targetLanguage: validatedData.targetLanguage,
        originalLength: validatedData.content.length,
        translatedLength: result.content.length,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: "Données invalides",
        details: error.errors,
      });
    }

    secureError("Erreur traduction contenu", error);
    res.status(500).json({
      error: "Erreur lors de la traduction du contenu",
      details: error instanceof Error ? error.message : "Erreur inconnue",
    });
  }
};

// Corriger du texte
export const correctText = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    }

    const { content } = req.body;
    if (!content || typeof content !== "string" || content.trim().length === 0) {
      return res.status(400).json({ error: "Contenu requis" });
    }

    const startTime = Date.now();
    const result = await AIService.correctText(sanitizeUserContent(content));
    const responseTime = Date.now() - startTime;

    res.json({
      message: "Texte corrigé avec succès",
      result: {
        ...result,
        responseTime,
        originalLength: content.length,
        correctedLength: result.content.length,
      },
    });
  } catch (error) {
    secureError("Erreur correction texte", error);
    res.status(500).json({
      error: "Erreur lors de la correction du texte",
      details: error instanceof Error ? error.message : "Erreur inconnue",
    });
  }
};
