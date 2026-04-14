import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { authenticateToken, requireUser } from "../middlewares/auth.js";
import { conversationsCrudRateLimit } from "../middlewares/rateLimiting.js";
import { logger } from "../utils/logger.js";
import {
  verifyWorkspaceAccess,
  verifyConversationAccess,
  verifyWorkspaceOwnership,
} from "../middlewares/workspaceAccess.js";
import { MODELS } from "../config/models.js";
import { AIService } from "../services/ai/base.js";

// Interface pour les données de création de page dans les messages
interface PageCreationData {
  pageId: string | null;
  status: "created" | "deleted" | "pending";
  deletedAt?: string | null;
  recreatedAt?: string | null;
  [key: string]: unknown;
}

// Type pour les données de mise à jour de message (compatible Prisma)
type MessageUpdateData = {
  pageId?: string | null;
  isPageDeleted?: boolean;
  projectId?: string | null;
  pageCreationData?: Record<string, unknown>;
};

const router = Router();

// Toutes les routes nécessitent une authentification
router.use(authenticateToken);
router.use(requireUser);
router.use(conversationsCrudRateLimit);

// 📋 GET /conversations - Lister les conversations de l'utilisateur
router.get("/", verifyWorkspaceAccess, async (req, res) => {
  try {
    const { workspaceId } = req.query;
    const userId = req.user!.id;

    const conversations = await prisma.aIConversation.findMany({
      where: {
        userId,
        ...(workspaceId ? { workspaceId: workspaceId as string } : {}),
        isActive: true,
      },
      orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
      take: 50,
    });

    res.json({ conversations });
  } catch (error) {
    logger.error("[GET /conversations] error", error);
    res.status(500).json({ error: "Erreur lors de la récupération des conversations" });
  }
});

// 📄 GET /conversations/:id - Récupérer une conversation avec messages paginés (cursor-based)
const MESSAGES_DEFAULT_LIMIT = 50;

router.get("/:id", verifyConversationAccess, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const cursor = req.query.cursor as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || MESSAGES_DEFAULT_LIMIT, 100);

    const conversation = await prisma.aIConversation.findFirst({
      where: { id, userId, isActive: true },
    });

    if (!conversation) {
      return res.status(404).json({ error: "Conversation non trouvée" });
    }

    // Cursor-based pagination: load latest messages, exclude heavy fields
    const messages = await prisma.aIMessage.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: "asc" },
      take: limit,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: {
        id: true,
        role: true,
        content: true,
        createdAt: true,
        mode: true,
        pageId: true,
        pageTitle: true,
        isPageDeleted: true,
        projectId: true,
        pageCreationData: true,
        // Exclude heavy fields: thinking, toolCalls, intermediateThinkingBlocks
      },
    });

    const nextCursor = messages.length === limit ? messages[messages.length - 1]?.id : null;

    res.json({
      conversation: { ...conversation, messages },
      pagination: { nextCursor, limit },
    });
  } catch (error: unknown) {
    logger.error("[GET /conversations/:id] error", error);
    res.status(500).json({ error: "Erreur lors de la récupération de la conversation" });
  }
});

// ➕ POST /conversations - Créer une nouvelle conversation
router.post("/", verifyWorkspaceAccess, async (req, res) => {
  try {
    const { workspaceId, firstMessage } = req.body;
    const userId = req.user!.id;

    if (!firstMessage || !firstMessage.content) {
      return res.status(400).json({ error: "Le premier message est requis" });
    }

    // Créer la conversation avec un titre temporaire
    const conversation = await prisma.aIConversation.create({
      data: {
        userId,
        workspaceId: workspaceId || null,
        title: "Nouvelle conversation", // Titre temporaire
        messageCount: 1,
        lastMessageAt: new Date(),
      },
    });

    // Ajouter le premier message
    await prisma.aIMessage.create({
      data: {
        conversationId: conversation.id,
        role: "USER",
        content: firstMessage.content,
        mentions: firstMessage.mentions || [],
        files: firstMessage.files || [],
        wikipediaSources: firstMessage.wikipediaSources || [],
        mode: firstMessage.mode || null,
        // 🌐 Mapper useWeb vers creditsHasWeb pour persistance
        creditsHasWeb: firstMessage.useWeb || false,
        creditsHasSources:
          firstMessage.mentions?.length > 0 ||
          firstMessage.files?.length > 0 ||
          firstMessage.wikipediaSources?.length > 0 ||
          false,
      },
    });

    try {
      const titleResponse = await AIService.getOpenAICompatibleClient(
        MODELS.CONVERSATION_TITLE,
      ).chat.completions.create({
        model: MODELS.CONVERSATION_TITLE,
        messages: [
          {
            role: "system",
            content:
              "Tu es un assistant qui génère des titres courts et descriptifs pour des conversations. Génère un titre de maximum 6 mots qui résume le sujet de la première question de l'utilisateur. Réponds uniquement avec le titre, sans guillemets ni ponctuation finale.",
          },
          {
            role: "user",
            content: `Génère un titre pour cette question: "${firstMessage.content}"`,
          },
        ],
        max_tokens: 20,
        temperature: 0.7,
      });

      const generatedTitle =
        titleResponse.choices[0]?.message?.content?.trim() || "Nouvelle conversation";

      // Mettre à jour le titre de la conversation
      await prisma.aIConversation.update({
        where: { id: conversation.id },
        data: { title: generatedTitle },
      });

      conversation.title = generatedTitle;
    } catch (titleError) {
      logger.warn("[POST /conversations] Erreur génération titre:", titleError);
      // Continuer même si la génération de titre échoue
    }

    res.status(201).json({ conversation });
  } catch (error) {
    logger.error("[POST /conversations] error", error);
    res.status(500).json({ error: "Erreur lors de la création de la conversation" });
  }
});

// ✏️ PUT /conversations/:id - Mettre à jour une conversation
router.put("/:id", verifyConversationAccess, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, isActive } = req.body;
    const userId = req.user!.id;

    const updatedConversation = await prisma.aIConversation.updateMany({
      where: {
        id,
        userId,
      },
      data: {
        ...(title !== undefined ? { title } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
      },
    });

    if (updatedConversation.count === 0) {
      return res.status(404).json({ error: "Conversation non trouvée" });
    }

    const conversation = await prisma.aIConversation.findUnique({
      where: { id },
    });

    res.json({ conversation });
  } catch (error) {
    logger.error("[PUT /conversations/:id] error", error);
    res.status(500).json({ error: "Erreur lors de la mise à jour de la conversation" });
  }
});

// 🗑️ DELETE /conversations/:id - Supprimer une conversation
router.delete("/:id", verifyConversationAccess, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    const deletedConversation = await prisma.aIConversation.updateMany({
      where: {
        id,
        userId,
      },
      data: {
        isActive: false, // Soft delete
      },
    });

    if (deletedConversation.count === 0) {
      return res.status(404).json({ error: "Conversation non trouvée" });
    }

    res.status(204).send();
  } catch (error) {
    logger.error("[DELETE /conversations/:id] error", error);
    res.status(500).json({ error: "Erreur lors de la suppression de la conversation" });
  }
});

// 📨 GET /conversations/:id/messages - Récupérer les messages d'une conversation
router.get("/:id/messages", verifyConversationAccess, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    // Vérifier que la conversation appartient à l'utilisateur
    const conversation = await prisma.aIConversation.findFirst({
      where: {
        id,
        userId,
        isActive: true,
      },
    });

    if (!conversation) {
      return res.status(404).json({ error: "Conversation non trouvée" });
    }

    // Récupérer les messages avec pagination
    const take = Math.min(Number(req.query.limit) || 100, 200);
    const skip = Number(req.query.offset) || 0;

    const messages = await prisma.aIMessage.findMany({
      where: {
        conversationId: id,
      },
      orderBy: {
        createdAt: "asc",
      },
      take,
      skip,
    });

    res.json({ messages, pagination: { limit: take, offset: skip } });
  } catch (error) {
    logger.error("[GET /conversations/:id/messages] error", error);
    res.status(500).json({ error: "Erreur lors de la récupération des messages" });
  }
});

// 💬 POST /conversations/:id/messages - Ajouter un message à une conversation
router.post("/:id/messages", verifyConversationAccess, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      role,
      content,
      mentions,
      files,
      wikipediaSources,
      useWeb,
      mode,
      pageId,
      pageTitle,
      projectId,
      thinking,
      toolCalls,
      usedFallback,
      intermediateThinkingBlocks,
      pageCreationData,
      creditsMode,
      creditsReflection,
      creditsHasWeb,
      creditsHasSources,
      creditsUsed,
    } = req.body;
    const userId = req.user!.id;

    logger.log("[DEBUG_MODAL] 📥 Backend - Ajout message:", {
      conversationId: id,
      role,
      pageId,
      pageTitle,
      projectId,
      hasPageId: !!pageId,
      hasThinking: !!thinking,
      hasToolCalls: !!(toolCalls && toolCalls.length > 0),
      hasPageCreationData: !!pageCreationData,
    });

    if (!content) {
      return res.status(400).json({ error: "Le contenu du message est requis" });
    }

    // 🛡️ SÉCURITÉ: Validation de la taille du message pour prévenir les attaques DoS
    const MAX_MESSAGE_LENGTH = 50000; // ~50KB, environ 10-15 pages de texte
    if (typeof content === "string" && content.length > MAX_MESSAGE_LENGTH) {
      logger.warn(
        `⚠️ [CONVERSATIONS] Message trop long rejeté: ${content.length} chars (max: ${MAX_MESSAGE_LENGTH}) - userId: ${userId}`,
      );
      return res.status(400).json({
        error: "MESSAGE_TOO_LONG",
        message: `Le message est trop long (${content.length} caractères). Maximum autorisé: ${MAX_MESSAGE_LENGTH} caractères.`,
        maxLength: MAX_MESSAGE_LENGTH,
        actualLength: content.length,
      });
    }

    // Vérifier que la conversation appartient à l'utilisateur
    const conversation = await prisma.aIConversation.findFirst({
      where: {
        id,
        userId,
        isActive: true,
      },
    });

    if (!conversation) {
      return res.status(404).json({ error: "Conversation non trouvée" });
    }

    // Ajouter le message
    const message = await prisma.aIMessage.create({
      data: {
        conversationId: id,
        role,
        content,
        mentions: mentions || [],
        files: files || [],
        wikipediaSources: wikipediaSources || [],
        mode: mode || null,
        pageId: pageId || null,
        pageTitle: pageTitle || null,
        projectId: projectId || null,
        isPageDeleted: false, // 🔥 Initialiser à false lors de la création
        // 🔥 NOUVEAU: Function Calling
        thinking: thinking || null,
        toolCalls: toolCalls || [],
        usedFallback: usedFallback || false,
        intermediateThinkingBlocks: intermediateThinkingBlocks || [],
        // 🔥 NOUVEAU: Données complètes du modal de création
        pageCreationData: pageCreationData || null,
        // 💰 NOUVEAU: Métadonnées de coût en crédits
        creditsMode: creditsMode || null,
        creditsReflection: creditsReflection || null,
        // 🌐 Mapper useWeb vers creditsHasWeb (priorité à creditsHasWeb si fourni pour rétrocompatibilité)
        creditsHasWeb: creditsHasWeb !== undefined ? creditsHasWeb : useWeb || false,
        creditsHasSources:
          creditsHasSources !== undefined
            ? creditsHasSources
            : mentions?.length > 0 || files?.length > 0 || wikipediaSources?.length > 0 || false,
        creditsUsed: creditsUsed || null,
      },
    });

    logger.log("[DEBUG_MODAL] ✅ Message créé dans la DB:", {
      messageId: message.id,
      role: message.role,
      pageId: message.pageId,
      pageTitle: message.pageTitle,
      isPageDeleted: message.isPageDeleted,
    });

    // Mettre à jour les métadonnées de la conversation
    await prisma.aIConversation.update({
      where: { id },
      data: {
        messageCount: {
          increment: 1,
        },
        lastMessageAt: new Date(),
      },
    });

    res.status(201).json({ message });
  } catch (error) {
    logger.error("[POST /conversations/:id/messages] error", error);
    res.status(500).json({ error: "Erreur lors de l'ajout du message" });
  }
});

// 🔄 PATCH /conversations/:conversationId/update-page-status - Mettre à jour le statut de page
router.patch("/:conversationId/update-page-status", verifyConversationAccess, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { oldPageId, pageTitle, newPageId, isPageDeleted, projectId } = req.body;
    const userId = req.user!.id;

    logger.log("[DEBUG_MODAL] 📥 Backend - Requête reçue:", {
      conversationId,
      oldPageId,
      pageTitle,
      newPageId,
      isPageDeleted,
      userId,
    });

    // Vérifier que la conversation appartient à l'utilisateur
    const conversation = await prisma.aIConversation.findFirst({
      where: {
        id: conversationId,
        userId,
        isActive: true,
      },
    });

    if (!conversation) {
      logger.log("[DEBUG_MODAL] ❌ Conversation non trouvée");
      return res.status(404).json({ error: "Conversation non trouvée" });
    }

    logger.log("[DEBUG_MODAL] ✅ Conversation trouvée:", conversation.id);

    // Chercher le message par pageTitle OU oldPageId OU pageCreationData
    const whereConditions = [];

    // Priorité 1: Chercher par pageTitle (ne change jamais)
    if (pageTitle) {
      whereConditions.push({ pageTitle });
    }

    // Priorité 2: Chercher par oldPageId (peut être déjà null)
    if (oldPageId) {
      whereConditions.push({ pageId: oldPageId });
    }

    // Priorité 3: Si on a un oldPageId mais que le message a déjà été supprimé,
    // chercher dans pageCreationData
    if (oldPageId && !pageTitle) {
      whereConditions.push({
        pageCreationData: {
          path: ["pageId"],
          equals: oldPageId,
        },
      });
    }

    if (whereConditions.length === 0) {
      logger.log("[DEBUG_MODAL] ❌ Aucun critère de recherche fourni");
      return res.status(400).json({ error: "oldPageId ou pageTitle requis" });
    }

    logger.log("[DEBUG_MODAL] 🔍 Recherche du message avec:", whereConditions);

    const message = await prisma.aIMessage.findFirst({
      where: {
        conversationId,
        OR: whereConditions,
      },
    });

    if (!message) {
      logger.log("[DEBUG_MODAL] ❌ Message non trouvé dans la conversation");
      return res.status(404).json({ error: "Message non trouvé" });
    }

    logger.log("[DEBUG_MODAL] ✅ Message trouvé:", {
      messageId: message.id,
      currentPageId: message.pageId,
      currentIsPageDeleted: message.isPageDeleted,
    });

    // Mettre à jour
    const updateData: MessageUpdateData = {};
    if (newPageId !== undefined) updateData.pageId = newPageId;
    if (isPageDeleted !== undefined) updateData.isPageDeleted = isPageDeleted;
    if (projectId !== undefined) updateData.projectId = projectId;

    // 🔥 NOUVEAU: Mettre à jour pageCreationData
    if (message.pageCreationData) {
      const currentData = message.pageCreationData as PageCreationData;

      // Cas 1: Suppression de page
      if (isPageDeleted === true) {
        updateData.pageCreationData = {
          ...currentData,
          pageId: null, // Important: pageId devient null
          status: "deleted",
          deletedAt: new Date().toISOString(),
        };
        logger.log("[DEBUG_MODAL] 🗑️ Page supprimée - pageCreationData mis à jour");
      }

      // Cas 2: Recréation de page
      if (newPageId && isPageDeleted === false) {
        updateData.pageCreationData = {
          ...currentData,
          pageId: newPageId,
          status: "created",
          deletedAt: null,
          recreatedAt: new Date().toISOString(),
        };
        logger.log("[DEBUG_MODAL] ✨ Page recréée - pageCreationData mis à jour avec nouveau ID");
      }
    }

    logger.log("[DEBUG_MODAL] 💾 Données à mettre à jour:", updateData);

    const updatedMessage = await prisma.aIMessage.update({
      where: { id: message.id },
      data: updateData as Parameters<typeof prisma.aIMessage.update>[0]["data"],
    });

    logger.log("[DEBUG_MODAL] ✅ Message mis à jour avec succès:", {
      messageId: message.id,
      isPageDeleted: updatedMessage.isPageDeleted,
      pageId: updatedMessage.pageId,
      pageTitle: updatedMessage.pageTitle,
    });

    res.json({ success: true, message: updatedMessage });
  } catch (error) {
    logger.error("[DEBUG_MODAL] ❌ Erreur backend:", error);
    res.status(500).json({ error: "Erreur lors de la mise à jour du message" });
  }
});

// 📊 GET /conversations/tokens/:workspaceId - Récupérer le nombre de tokens de la conversation active
router.get("/tokens/:workspaceId", verifyWorkspaceOwnership, async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const userId = req.user!.id;

    // 🔥 FIX: Récupérer directement la conversation active depuis la table AIConversation
    const conversation = await prisma.aIConversation.findFirst({
      where: {
        userId,
        workspaceId,
        isActive: true,
      },
      orderBy: {
        updatedAt: "desc",
      },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
          select: {
            role: true,
            content: true,
            mentions: true,
            files: true,
            wikipediaSources: true,
            creditsHasWeb: true,
            thinking: true,
            toolCalls: true,
            intermediateThinkingBlocks: true,
          },
        },
      },
    });

    if (!conversation || conversation.messages.length === 0) {
      // Pas de conversation ou pas de messages
      return res.json({
        totalTokens: 0,
        userMessageTokens: 0,
        aiMessageTokens: 0,
        threshold: 200000,
        needsCompression: false,
      });
    }

    // Simple token counter (estimation: 1 token ~ 4 caractères)
    const TokenCounterService = {
      countTokens: (text: string): number => Math.ceil((text || "").length / 4),
    };

    // 🔥 Compter les tokens directement depuis les messages de la conversation
    let totalTokens = 0;
    let userMessageTokens = 0;
    let aiMessageTokens = 0;

    for (const message of conversation.messages) {
      // Estimer les tokens du contenu principal
      const contentTokens = TokenCounterService.countTokens(message.content || "");

      if (message.role === "USER") {
        // Ajouter les tokens des paramètres (mentions, sources, etc.)
        const paramsTokens = TokenCounterService.countTokens(
          JSON.stringify({
            mentions: message.mentions || [],
            files: message.files || [],
            wikipediaSources: message.wikipediaSources || [],
            useWeb: message.creditsHasWeb || false,
          }),
        );
        const messageTokens = contentTokens + paramsTokens;
        userMessageTokens += messageTokens;
        totalTokens += messageTokens;
      } else {
        // Pour les messages assistant, compter thinking + toolCalls + content
        const thinkingTokens = message.thinking
          ? TokenCounterService.countTokens(message.thinking)
          : 0;
        const toolCallsTokens = message.toolCalls
          ? TokenCounterService.countTokens(JSON.stringify(message.toolCalls))
          : 0;
        const intermediateTokens = message.intermediateThinkingBlocks
          ? TokenCounterService.countTokens(JSON.stringify(message.intermediateThinkingBlocks))
          : 0;

        const messageTokens = contentTokens + thinkingTokens + toolCallsTokens + intermediateTokens;
        aiMessageTokens += messageTokens;
        totalTokens += messageTokens;
      }
    }

    const needsCompression = totalTokens > 4000;

    logger.log(`📊 [TOKEN-COUNTER] Conversation ${conversation.id}:`);
    logger.log(`   Total tokens: ${totalTokens}`);
    logger.log(`   User messages: ${userMessageTokens} tokens`);
    logger.log(`   AI messages: ${aiMessageTokens} tokens`);
    logger.log(`   Messages count: ${conversation.messages.length}`);

    res.json({
      totalTokens,
      userMessageTokens,
      aiMessageTokens,
      threshold: 200000,
      needsCompression,
    });
  } catch (error) {
    logger.error("[GET /conversations/tokens/:workspaceId] error", error);
    res.status(500).json({ error: "Erreur lors de la récupération du nombre de tokens" });
  }
});

// 📊 GET /conversations/tokens/conversation/:conversationId - Obtenir le nombre de tokens d'une conversation par son ID
router.get("/tokens/conversation/:conversationId", verifyConversationAccess, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user!.id;

    logger.log(`📊 [GET /conversations/tokens/conversation/${conversationId}] user: ${userId}`);

    // Récupérer la conversation par son ID (pas par workspaceId)
    const conversation = await prisma.aIConversation.findFirst({
      where: {
        id: conversationId,
        userId,
      },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
          select: {
            role: true,
            content: true,
            mentions: true,
            files: true,
            wikipediaSources: true,
            creditsHasWeb: true,
            thinking: true,
            toolCalls: true,
            intermediateThinkingBlocks: true,
          },
        },
      },
    });

    if (!conversation || conversation.messages.length === 0) {
      // Pas de conversation ou pas de messages
      return res.json({
        totalTokens: 0,
        userMessageTokens: 0,
        aiMessageTokens: 0,
        threshold: 200000,
        needsCompression: false,
      });
    }

    // Simple token counter (estimation: 1 token ~ 4 caractères)
    const TokenCounterService = {
      countTokens: (text: string): number => Math.ceil((text || "").length / 4),
    };

    // 🔥 Compter les tokens directement depuis les messages de la conversation
    let totalTokens = 0;
    let userMessageTokens = 0;
    let aiMessageTokens = 0;

    for (const message of conversation.messages) {
      // Estimer les tokens du contenu principal
      const contentTokens = TokenCounterService.countTokens(message.content || "");

      if (message.role === "USER") {
        // Ajouter les tokens des paramètres (mentions, sources, etc.)
        const paramsTokens = TokenCounterService.countTokens(
          JSON.stringify({
            mentions: message.mentions || [],
            files: message.files || [],
            wikipediaSources: message.wikipediaSources || [],
            useWeb: message.creditsHasWeb || false,
          }),
        );
        const messageTokens = contentTokens + paramsTokens;
        userMessageTokens += messageTokens;
        totalTokens += messageTokens;
      } else {
        // Pour les messages assistant, compter thinking + toolCalls + content
        const thinkingTokens = message.thinking
          ? TokenCounterService.countTokens(message.thinking)
          : 0;
        const toolCallsTokens = message.toolCalls
          ? TokenCounterService.countTokens(JSON.stringify(message.toolCalls))
          : 0;
        const intermediateTokens = message.intermediateThinkingBlocks
          ? TokenCounterService.countTokens(JSON.stringify(message.intermediateThinkingBlocks))
          : 0;

        const messageTokens = contentTokens + thinkingTokens + toolCallsTokens + intermediateTokens;
        aiMessageTokens += messageTokens;
        totalTokens += messageTokens;
      }
    }

    const needsCompression = totalTokens > 4000;

    logger.log(`📊 [TOKEN-COUNTER] Conversation ${conversation.id}:`);
    logger.log(`   Total tokens: ${totalTokens}`);
    logger.log(`   User messages: ${userMessageTokens} tokens`);
    logger.log(`   AI messages: ${aiMessageTokens} tokens`);
    logger.log(`   Messages count: ${conversation.messages.length}`);

    res.json({
      totalTokens,
      userMessageTokens,
      aiMessageTokens,
      threshold: 200000,
      needsCompression,
    });
  } catch (error) {
    logger.error("[GET /conversations/tokens/conversation/:conversationId] error", error);
    res.status(500).json({ error: "Erreur lors de la récupération du nombre de tokens" });
  }
});

// 🔄 POST /conversations/:id/generate-title - Générer un nouveau titre
router.post("/:id/generate-title", verifyConversationAccess, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    // Récupérer la conversation avec le premier message
    const conversation = await prisma.aIConversation.findFirst({
      where: {
        id,
        userId,
        isActive: true,
      },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
          take: 1,
        },
      },
    });

    if (!conversation || !conversation.messages[0]) {
      return res.status(404).json({ error: "Conversation non trouvée" });
    }

    const firstMessage = conversation.messages[0];

    // Générer le nouveau titre
    const titleResponse = await AIService.getOpenAICompatibleClient(
      MODELS.CONVERSATION_TITLE,
    ).chat.completions.create({
      model: MODELS.CONVERSATION_TITLE,
      messages: [
        {
          role: "system",
          content:
            "Tu es un assistant qui génère des titres courts et descriptifs pour des conversations. Génère un titre de maximum 6 mots qui résume le sujet de la première question de l'utilisateur. Réponds uniquement avec le titre, sans guillemets ni ponctuation finale.",
        },
        {
          role: "user",
          content: `Génère un titre pour cette question: "${firstMessage.content}"`,
        },
      ],
      max_tokens: 20,
      temperature: 0.7,
    });

    const generatedTitle = titleResponse.choices[0]?.message?.content?.trim() || "Conversation";

    // Mettre à jour le titre
    await prisma.aIConversation.update({
      where: { id },
      data: { title: generatedTitle },
    });

    res.json({ title: generatedTitle });
  } catch (error) {
    logger.error("[POST /conversations/:id/generate-title] error", error);
    res.status(500).json({ error: "Erreur lors de la génération du titre" });
  }
});

export { router as conversationsRouter };
