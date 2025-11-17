/**
 * Conversation History Service - PERSISTENT VERSION
 *
 * Manages conversation history for multi-agent systems using Prisma.
 * Stores user messages (with parameters like web, sources) and AI responses
 * (including thinking, tools used, and final response) in the database.
 */

import { prisma } from '../../../../lib/prisma.js';
import type { AIConversation, AIMessage as PrismaAIMessage } from '@prisma/client';

export interface UserMessage {
  role: "user";
  content: string;
  timestamp: number;
  parameters: {
    web?: boolean;
    all?: boolean;
    sources?: Array<{ id: string; title: string; type: string }>;
  };
}

export interface AIMessage {
  role: "assistant";
  timestamp: number;
  firstThinking: string;
  tools: Array<{
    name: string;
    arguments: any;
    result: string;
    thinking?: string;
    timestamp: number;
  }>;
  finalResponse: string;
  intermediateThinkingBlocks?: any[];
}

export type ConversationMessage = UserMessage | AIMessage;

export interface ConversationHistory {
  userId: string;
  workspaceId: string;
  messages: ConversationMessage[];
  totalTokens: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Service for managing conversation history with multi-agent context (database-backed)
 */
export class ConversationHistoryService {
  /**
   * 🔥 NOUVEAU: Trouve ou crée une conversation active pour userId + workspaceId
   */
  private static async findOrCreateConversation(
    userId: string,
    workspaceId: string,
  ): Promise<AIConversation> {
    // Chercher la conversation active la plus récente pour cet utilisateur + workspace
    let conversation = await prisma.aIConversation.findFirst({
      where: {
        userId,
        workspaceId,
        isActive: true,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    // Si aucune conversation n'existe, en créer une nouvelle
    if (!conversation) {
      console.log(`🆕 [HISTORY-DB] Création d'une nouvelle conversation pour ${userId}:${workspaceId}`);
      conversation = await prisma.aIConversation.create({
        data: {
          userId,
          workspaceId,
          title: 'Nouvelle conversation',
          messageCount: 0,
          lastMessageAt: new Date(),
        },
      });
    }

    return conversation;
  }

  /**
   * Récupère l'historique d'une conversation depuis la base de données
   */
  static async getHistory(
    userId: string,
    workspaceId: string,
  ): Promise<ConversationHistory | undefined> {
    try {
      // Trouver la conversation active la plus récente
      const conversation = await prisma.aIConversation.findFirst({
        where: {
          userId,
          workspaceId,
          isActive: true,
        },
        orderBy: {
          updatedAt: 'desc',
        },
        include: {
          messages: {
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      if (!conversation) {
        return undefined;
      }

      // Convertir les messages Prisma en format ConversationMessage
      const messages: ConversationMessage[] = conversation.messages.map((msg) => {
        if (msg.role === 'USER') {
          const userMsg: UserMessage = {
            role: 'user',
            content: msg.content,
            timestamp: msg.createdAt.getTime(),
            parameters: {
              web: msg.creditsHasWeb ?? false,
              all: false, // Pas stocké directement, mais on peut déduire des mentions
              sources: (msg.mentions as any[]) || [],
            },
          };
          return userMsg;
        } else {
          const aiMsg: AIMessage = {
            role: 'assistant',
            timestamp: msg.createdAt.getTime(),
            firstThinking: msg.thinking || '',
            tools: (msg.toolCalls as any[]) || [],
            finalResponse: msg.content,
            intermediateThinkingBlocks: (msg.intermediateThinkingBlocks as any[]) || [],
          };
          return aiMsg;
        }
      });

      return {
        userId,
        workspaceId,
        messages,
        totalTokens: 0, // Sera calculé par TokenCounterService si nécessaire
        createdAt: conversation.createdAt.getTime(),
        updatedAt: conversation.updatedAt.getTime(),
      };
    } catch (error) {
      console.error('[HISTORY-DB] Erreur lors de la récupération:', error);
      return undefined;
    }
  }

  /**
   * Ajoute un message utilisateur à l'historique dans la base de données
   */
  static async addUserMessage(
    userId: string,
    workspaceId: string,
    content: string,
    parameters: UserMessage["parameters"],
  ): Promise<void> {
    try {
      // Trouver ou créer la conversation
      const conversation = await this.findOrCreateConversation(userId, workspaceId);

      // Créer le message utilisateur
      await prisma.aIMessage.create({
        data: {
          conversationId: conversation.id,
          role: 'USER',
          content,
          mentions: parameters.sources || [],
          creditsHasWeb: parameters.web || false,
          creditsHasSources: (parameters.sources && parameters.sources.length > 0) || false,
        },
      });

      // Mettre à jour la conversation
      await prisma.aIConversation.update({
        where: { id: conversation.id },
        data: {
          messageCount: { increment: 1 },
          lastMessageAt: new Date(),
        },
      });

      const messageCount = conversation.messageCount + 1;
      console.log(
        `📝 [HISTORY-DB] Message utilisateur ajouté à conversation ${conversation.id} (${messageCount} messages totaux)`,
      );
    } catch (error) {
      console.error('[HISTORY-DB] Erreur lors de l\'ajout du message utilisateur:', error);
      throw error;
    }
  }

  /**
   * Ajoute une réponse AI à l'historique dans la base de données
   */
  static async addAIMessage(
    userId: string,
    workspaceId: string,
    firstThinking: string,
    tools: AIMessage["tools"],
    finalResponse: string,
    intermediateThinkingBlocks?: any[],
  ): Promise<void> {
    try {
      // Trouver la conversation (devrait exister car addUserMessage a été appelé avant)
      const conversation = await prisma.aIConversation.findFirst({
        where: {
          userId,
          workspaceId,
          isActive: true,
        },
        orderBy: {
          updatedAt: 'desc',
        },
      });

      if (!conversation) {
        console.warn(
          `⚠️ [HISTORY-DB] Tentative d'ajout de réponse AI sans conversation existante`,
        );
        return;
      }

      // Créer le message AI
      await prisma.aIMessage.create({
        data: {
          conversationId: conversation.id,
          role: 'ASSISTANT',
          content: finalResponse,
          thinking: firstThinking,
          toolCalls: tools,
          intermediateThinkingBlocks: intermediateThinkingBlocks || [],
        },
      });

      // Mettre à jour la conversation
      await prisma.aIConversation.update({
        where: { id: conversation.id },
        data: {
          messageCount: { increment: 1 },
          lastMessageAt: new Date(),
        },
      });

      console.log(
        `📝 [HISTORY-DB] Réponse AI ajoutée (${tools.length} tools utilisés, conversation ${conversation.id})`,
      );
    } catch (error) {
      console.error('[HISTORY-DB] Erreur lors de l\'ajout de la réponse AI:', error);
      throw error;
    }
  }

  /**
   * Formate l'historique pour l'envoyer au brain (PlannerService)
   *
   * Format:
   * USER: [query] (web: true, sources: "Source1, Source2")
   * ASSISTANT: [thinking] → [tools] → [response]
   */
  static async formatHistoryForBrain(
    userId: string,
    workspaceId: string,
  ): Promise<string | null> {
    const history = await this.getHistory(userId, workspaceId);

    if (!history || history.messages.length === 0) {
      return null;
    }

    const formatted = history.messages.map((msg) => {
      if (msg.role === "user") {
        const params = msg.parameters;
        const paramsStr = [
          params.web ? "web: true" : "",
          params.all ? "all: true" : "",
          params.sources && params.sources.length > 0
            ? `sources: "${params.sources.map((s) => s.title).join(", ")}"`
            : "",
        ]
          .filter(Boolean)
          .join(", ");

        return `USER: ${msg.content}${paramsStr ? ` (${paramsStr})` : ""}`;
      } else {
        const toolsSummary =
          msg.tools.length > 0
            ? msg.tools.map((t) => t.name).join(" → ")
            : "no tools";
        return `ASSISTANT: [thinking] ${msg.firstThinking.slice(0, 100)}... → [tools] ${toolsSummary} → [response] ${msg.finalResponse.slice(0, 100)}...`;
      }
    });

    return formatted.join("\n\n");
  }

  /**
   * Efface l'historique d'une conversation (soft delete)
   */
  static async clearHistory(userId: string, workspaceId: string): Promise<void> {
    try {
      // Marquer toutes les conversations actives comme inactives
      await prisma.aIConversation.updateMany({
        where: {
          userId,
          workspaceId,
          isActive: true,
        },
        data: {
          isActive: false,
        },
      });

      console.log(`🗑️ [HISTORY-DB] Historique effacé (soft delete) pour ${userId}:${workspaceId}`);
    } catch (error) {
      console.error('[HISTORY-DB] Erreur lors de l\'effacement:', error);
      throw error;
    }
  }

  /**
   * Met à jour le nombre total de tokens de l'historique (stocké dans metadata)
   */
  static async updateTotalTokens(
    userId: string,
    workspaceId: string,
    tokens: number,
  ): Promise<void> {
    try {
      const conversation = await prisma.aIConversation.findFirst({
        where: {
          userId,
          workspaceId,
          isActive: true,
        },
        orderBy: {
          updatedAt: 'desc',
        },
      });

      if (conversation) {
        await prisma.aIConversation.update({
          where: { id: conversation.id },
          data: {
            metadata: {
              ...(conversation.metadata as any),
              totalTokens: tokens,
            },
          },
        });
      }
    } catch (error) {
      console.error('[HISTORY-DB] Erreur lors de la mise à jour des tokens:', error);
      throw error;
    }
  }

  /**
   * Remplace l'historique avec une version compressée
   */
  static async replaceWithCompressedHistory(
    userId: string,
    workspaceId: string,
    compressedContent: string,
  ): Promise<void> {
    try {
      // Trouver la conversation actuelle
      const conversation = await prisma.aIConversation.findFirst({
        where: {
          userId,
          workspaceId,
          isActive: true,
        },
        orderBy: {
          updatedAt: 'desc',
        },
      });

      if (!conversation) {
        console.warn(`⚠️ [HISTORY-DB] Aucune conversation à compresser`);
        return;
      }

      // Supprimer tous les anciens messages
      await prisma.aIMessage.deleteMany({
        where: {
          conversationId: conversation.id,
        },
      });

      // Créer un message unique avec le contenu compressé
      await prisma.aIMessage.create({
        data: {
          conversationId: conversation.id,
          role: 'ASSISTANT',
          content: compressedContent,
          thinking: '📦 Historique compressé',
          toolCalls: [],
          intermediateThinkingBlocks: [],
        },
      });

      // Mettre à jour la conversation
      await prisma.aIConversation.update({
        where: { id: conversation.id },
        data: {
          messageCount: 1,
          lastMessageAt: new Date(),
          metadata: {
            ...(conversation.metadata as any),
            compressed: true,
            compressedAt: new Date().toISOString(),
          },
        },
      });

      console.log(
        `🗜️ [HISTORY-DB] Historique remplacé par version compressée (conversation ${conversation.id})`,
      );
    } catch (error) {
      console.error('[HISTORY-DB] Erreur lors de la compression:', error);
      throw error;
    }
  }
}
