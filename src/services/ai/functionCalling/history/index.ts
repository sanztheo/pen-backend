/**
 * Conversation History Module
 *
 * Exports all history-related services for multi-agent context management.
 */

export { ConversationHistoryService } from "./conversationHistory.service.js";
export type {
  UserMessage,
  AIMessage,
  ConversationMessage,
  ConversationHistory,
} from "./conversationHistory.service.js";

export { TokenCounterService } from "./tokenCounter.service.js";
export type { TokenCount } from "./tokenCounter.service.js";

export { HistoryCompressionService } from "./historyCompression.service.js";
export type { CompressionResult } from "./historyCompression.service.js";
