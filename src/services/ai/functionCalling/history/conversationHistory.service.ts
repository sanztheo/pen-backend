/**
 * Conversation History Service
 *
 * Manages conversation history for multi-agent systems.
 * Stores user messages (with parameters like web, sources) and AI responses
 * (including thinking, tools used, and final response).
 */

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
 * Service for managing conversation history with multi-agent context
 */
export class ConversationHistoryService {
  private static histories: Map<string, ConversationHistory> = new Map();

  /**
   * Génère une clé unique pour l'historique basée sur userId et workspaceId
   */
  private static getHistoryKey(userId: string, workspaceId: string): string {
    return `${userId}:${workspaceId}`;
  }

  /**
   * Récupère l'historique d'une conversation
   */
  static getHistory(
    userId: string,
    workspaceId: string,
  ): ConversationHistory | undefined {
    const key = this.getHistoryKey(userId, workspaceId);
    return this.histories.get(key);
  }

  /**
   * Ajoute un message utilisateur à l'historique
   */
  static addUserMessage(
    userId: string,
    workspaceId: string,
    content: string,
    parameters: UserMessage["parameters"],
  ): void {
    const key = this.getHistoryKey(userId, workspaceId);
    let history = this.histories.get(key);

    if (!history) {
      history = {
        userId,
        workspaceId,
        messages: [],
        totalTokens: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.histories.set(key, history);
    }

    const userMessage: UserMessage = {
      role: "user",
      content,
      timestamp: Date.now(),
      parameters,
    };

    history.messages.push(userMessage);
    history.updatedAt = Date.now();

    console.log(
      `📝 [HISTORY] Message utilisateur ajouté (${history.messages.length} messages totaux)`,
    );
  }

  /**
   * Ajoute une réponse AI à l'historique
   */
  static addAIMessage(
    userId: string,
    workspaceId: string,
    firstThinking: string,
    tools: AIMessage["tools"],
    finalResponse: string,
    intermediateThinkingBlocks?: any[],
  ): void {
    const key = this.getHistoryKey(userId, workspaceId);
    const history = this.histories.get(key);

    if (!history) {
      console.warn(
        `⚠️ [HISTORY] Tentative d'ajout de réponse AI sans historique existant`,
      );
      return;
    }

    const aiMessage: AIMessage = {
      role: "assistant",
      timestamp: Date.now(),
      firstThinking,
      tools,
      finalResponse,
      intermediateThinkingBlocks,
    };

    history.messages.push(aiMessage);
    history.updatedAt = Date.now();

    console.log(
      `📝 [HISTORY] Réponse AI ajoutée (${tools.length} tools utilisés, ${history.messages.length} messages totaux)`,
    );
  }

  /**
   * Formate l'historique pour l'envoyer au brain (PlannerService)
   *
   * Format:
   * USER: [query] (web: true, sources: "Source1, Source2")
   * ASSISTANT: [thinking] → [tools] → [response]
   */
  static formatHistoryForBrain(
    userId: string,
    workspaceId: string,
  ): string | null {
    const history = this.getHistory(userId, workspaceId);

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
   * Efface l'historique d'une conversation
   */
  static clearHistory(userId: string, workspaceId: string): void {
    const key = this.getHistoryKey(userId, workspaceId);
    this.histories.delete(key);
    console.log(`🗑️ [HISTORY] Historique effacé pour ${key}`);
  }

  /**
   * Met à jour le nombre total de tokens de l'historique
   */
  static updateTotalTokens(
    userId: string,
    workspaceId: string,
    tokens: number,
  ): void {
    const key = this.getHistoryKey(userId, workspaceId);
    const history = this.histories.get(key);

    if (history) {
      history.totalTokens = tokens;
      history.updatedAt = Date.now();
    }
  }

  /**
   * Remplace l'historique avec une version compressée
   */
  static replaceWithCompressedHistory(
    userId: string,
    workspaceId: string,
    compressedContent: string,
  ): void {
    const key = this.getHistoryKey(userId, workspaceId);

    // Créer un historique simplifié avec juste le résumé compressé
    const compressedHistory: ConversationHistory = {
      userId,
      workspaceId,
      messages: [
        {
          role: "assistant",
          timestamp: Date.now(),
          firstThinking: "",
          tools: [],
          finalResponse: compressedContent,
          intermediateThinkingBlocks: [],
        },
      ],
      totalTokens: 0, // Sera recalculé par TokenCounterService
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.histories.set(key, compressedHistory);

    console.log(
      `🗜️ [HISTORY] Historique remplacé par version compressée pour ${key}`,
    );
  }
}
