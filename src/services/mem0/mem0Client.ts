/**
 * Mem0 REST API Client
 *
 * Thin wrapper around Mem0 Platform API — no SDK dependency.
 * All calls are non-blocking with timeouts to never slow down chat.
 *
 * IMPORTANT: Mem0 add() is async by design — it returns "pending" immediately
 * while an internal LLM extracts declarative facts from messages. If the content
 * is too short/technical, the LLM may decide there's nothing to memorize
 * (status: "No Memory Changes"). This is expected behavior, not an error.
 *
 * @see https://docs.mem0.ai/api-reference
 * @see https://docs.mem0.ai/core-concepts/memory-operations/add
 */

import { logger } from "../../utils/logger.js";

// ── Config ──────────────────────────────────────────────────────────────────

const MEM0_BASE_URL = "https://api.mem0.ai/v1";
const MEM0_SEARCH_URL = "https://api.mem0.ai/v2/memories/search/";
const MEM0_TIMEOUT_MS = 5_000;

/**
 * Custom extraction instructions — tells Mem0's internal LLM to be more
 * aggressive about what it memorizes from student conversations.
 */
const EXTRACTION_INSTRUCTIONS =
  "Extract ALL personal facts from the conversation: name, age, school level, " +
  "field of study, interests, learning preferences, language, goals, struggles, " +
  "and any topic the user mentions studying or being curious about. " +
  "Even short or casual mentions count — e.g. 'I have a math exam' → user is studying math. " +
  "Prefer storing more memories rather than fewer.";

function getApiKey(): string | undefined {
  return process.env.MEMO;
}

function isEnabled(): boolean {
  return !!getApiKey();
}

/** Log Mem0 status at startup */
export function logMem0Status(): void {
  if (isEnabled()) {
    logger.log("[MEM0] ✅ Memory layer enabled (MEMO key found)");
  } else {
    logger.warn("[MEM0] ⚠️ Memory layer disabled — MEMO env var not set");
  }
}

function getHeaders(): Record<string, string> {
  const key = getApiKey();
  if (!key) {
    throw new Error("[MEM0] MEMO env var is not set");
  }
  return {
    Authorization: `Token ${key}`,
    "Content-Type": "application/json",
  };
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface Mem0Memory {
  id: string;
  memory: string;
  user_id: string;
  categories?: string[];
  created_at: string;
  updated_at: string;
}

interface Mem0AddResponse {
  id: string;
  event: string;
  data: { memory: string };
}

interface ChatMessage {
  role: string;
  content: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Namespace userId to prevent cross-tenant collisions at scale */
function namespacedUserId(userId: string): string {
  return `pennote:${userId}`;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Search user memories relevant to a query.
 * Returns empty array on failure — never throws.
 */
export async function searchMemories(
  userId: string,
  query: string,
  topK = 5,
): Promise<Mem0Memory[]> {
  if (!isEnabled() || !query.trim()) {
    return [];
  }

  try {
    const response = await fetch(MEM0_SEARCH_URL, {
      method: "POST",
      headers: getHeaders(),
      signal: AbortSignal.timeout(MEM0_TIMEOUT_MS),
      body: JSON.stringify({
        query,
        filters: { user_id: namespacedUserId(userId) },
        top_k: topK,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      logger.warn(`[MEM0] Search failed: ${response.status} ${response.statusText} — ${errorBody}`);
      return [];
    }

    const results = (await response.json()) as Mem0Memory[];
    logger.log(`[MEM0] Found ${results.length} memories for user ${userId}`);
    return results;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn(`[MEM0] Search error (non-blocking): ${msg}`);
    return [];
  }
}

/**
 * Store conversation messages as user memories.
 * Fire-and-forget — never throws.
 */
export async function addMemories(
  userId: string,
  messages: ChatMessage[],
): Promise<Mem0AddResponse[] | null> {
  if (!isEnabled() || messages.length === 0) {
    return null;
  }

  try {
    const response = await fetch(`${MEM0_BASE_URL}/memories/`, {
      method: "POST",
      headers: getHeaders(),
      signal: AbortSignal.timeout(MEM0_TIMEOUT_MS),
      body: JSON.stringify({
        messages,
        user_id: namespacedUserId(userId),
        infer: true,
        output_format: "v1.1",
        custom_instructions: EXTRACTION_INSTRUCTIONS,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      logger.warn(`[MEM0] Add failed: ${response.status} ${response.statusText} — ${errorBody}`);
      return null;
    }

    const result = (await response.json()) as Mem0AddResponse[];
    logger.log(`[MEM0] Add response for user ${userId}:`, JSON.stringify(result));
    return result;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn(`[MEM0] Add error (non-blocking): ${msg}`);
    return null;
  }
}
