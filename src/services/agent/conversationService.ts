/**
 * 💬 Conversation Service - Persistance des conversations AI
 *
 * Sauvegarde et chargement des conversations au format UIMessage (Vercel AI SDK v5)
 * Compatible avec useChat() côté frontend.
 *
 * @see https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-message-persistence
 */

import { logger } from "../../utils/logger.js";
import { prisma } from "../../lib/prisma.js";
import type { UIMessage } from "ai";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isUIMessage(value: unknown): value is UIMessage {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string") return false;
  if (typeof value.role !== "string") return false;
  if (!("parts" in value) || !Array.isArray(value.parts)) return false;
  for (const part of value.parts) {
    if (!isRecord(part)) return false;
    if (typeof part.type !== "string") return false;
  }
  return true;
}

/**
 * Sauvegarde les messages d'une conversation
 * Appelé dans onFinish de toUIMessageStreamResponse
 */
export async function saveConversation({
  conversationId,
  userId,
  workspaceId,
  messages,
  mode,
}: {
  conversationId: string;
  userId: string;
  workspaceId: string;
  messages: UIMessage[];
  mode?: string;
}): Promise<void> {
  logger.log(`💾 [CONVERSATION] Sauvegarde: ${conversationId}, ${messages.length} messages`);

  try {
    // Extraire le titre du premier message utilisateur
    const firstUserMessage = messages.find((m) => m.role === "user");
    const title = extractTitle(firstUserMessage);

    // Upsert la conversation
    await prisma.aIConversation.upsert({
      where: { id: conversationId },
      create: {
        id: conversationId,
        userId,
        workspaceId,
        title,
        messageCount: messages.length,
        lastMessageAt: new Date(),
        metadata: { mode },
      },
      update: {
        messageCount: messages.length,
        lastMessageAt: new Date(),
        metadata: { mode },
      },
    });

    // Supprimer les anciens messages et insérer les nouveaux
    // (plus simple que de gérer les diffs pour UIMessage avec parts)
    await prisma.aIMessage.deleteMany({
      where: { conversationId },
    });

    // Insérer tous les messages
    // Note: On ne passe PAS msg.id car ce n'est pas un UUID valide (ex: "msg-abc123")
    // L'ID original est préservé dans le JSON content et restauré au chargement
    for (const msg of messages) {
      await prisma.aIMessage.create({
        data: {
          // Laisser Prisma auto-générer l'UUID (dbgenerated)
          conversationId,
          role: msg.role === "user" ? "USER" : "ASSISTANT",
          // Stocker le message complet en JSON (avec id, parts, toolInvocations, etc.)
          content: JSON.stringify(msg),
          mode: mode || null,
          createdAt: new Date(),
        },
      });
    }

    logger.log(`✅ [CONVERSATION] Sauvegardé: ${conversationId}, ${messages.length} messages`);
  } catch (error) {
    logger.error(`❌ [CONVERSATION] Erreur sauvegarde:`, error);
    // Ne pas throw pour ne pas casser le stream
  }
}

/**
 * Charge les messages d'une conversation
 * Retourne un tableau de UIMessage pour initialMessages de useChat
 */
export async function loadConversation(
  conversationId: string,
  userId: string,
): Promise<UIMessage[] | null> {
  logger.log(`📖 [CONVERSATION] Chargement: ${conversationId}`);

  try {
    // Vérifier que la conversation appartient à l'utilisateur
    const conversation = await prisma.aIConversation.findFirst({
      where: {
        id: conversationId,
        userId,
      },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!conversation) {
      logger.log(`⚠️ [CONVERSATION] Non trouvée: ${conversationId}`);
      return null;
    }

    // Parser les messages JSON vers UIMessage
    const messages: UIMessage[] = conversation.messages.map((msg) => {
      try {
        const parsed: unknown = JSON.parse(msg.content);
        if (isUIMessage(parsed)) return parsed;
        throw new Error("Invalid UIMessage shape");
      } catch {
        // Fallback si le JSON est invalide - construire un UIMessage v5 valide
        return {
          id: msg.id,
          role: msg.role === "USER" ? "user" : "assistant",
          parts: [{ type: "text" as const, text: msg.content }],
        };
      }
    });

    logger.log(`✅ [CONVERSATION] Chargé: ${conversationId}, ${messages.length} messages`);
    return messages;
  } catch (error) {
    logger.error(`❌ [CONVERSATION] Erreur chargement:`, error);
    return null;
  }
}

/**
 * Liste les conversations d'un utilisateur
 */
export async function listConversations(
  userId: string,
  workspaceId?: string,
  limit: number = 50,
): Promise<
  Array<{
    id: string;
    title: string;
    messageCount: number;
    lastMessageAt: Date | null;
    createdAt: Date;
  }>
> {
  const conversations = await prisma.aIConversation.findMany({
    where: {
      userId,
      ...(workspaceId && { workspaceId }),
      isActive: true,
    },
    orderBy: { lastMessageAt: "desc" },
    take: limit,
    select: {
      id: true,
      title: true,
      messageCount: true,
      lastMessageAt: true,
      createdAt: true,
    },
  });

  return conversations;
}

/**
 * Supprime une conversation
 */
export async function deleteConversation(conversationId: string, userId: string): Promise<boolean> {
  try {
    // Soft delete
    const result = await prisma.aIConversation.updateMany({
      where: {
        id: conversationId,
        userId,
      },
      data: {
        isActive: false,
      },
    });

    return result.count > 0;
  } catch (error) {
    logger.error(`❌ [CONVERSATION] Erreur suppression:`, error);
    return false;
  }
}

/**
 * Extrait un titre du premier message (UIMessage v5 - utilise parts)
 */
function extractTitle(message: UIMessage | undefined): string {
  if (!message) return "Nouvelle conversation";

  // Extraire le texte des parts (format UIMessage v5)
  let text = "";
  if (message.parts) {
    for (const part of message.parts) {
      if (part.type === "text" && "text" in part) {
        text = part.text;
        break;
      }
    }
  }

  // Tronquer et nettoyer
  const title = text.replace(/\n/g, " ").trim().slice(0, 100);

  return title || "Nouvelle conversation";
}
