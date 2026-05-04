/**
 * Tool result cache key factory.
 *
 * Why this exists (PRE-MORTEM #11):
 * Agent tools are closures that capture `ctx = { userId, workspaceId }` at
 * creation time. The captured context guards EXECUTION but does NOT mark
 * the RESULT — so any cache layered on top of a tool that omits the user
 * or workspace from the key will leak content cross-tenant the moment two
 * users issue similar inputs (e.g. RAG chunks, page summaries).
 *
 * As of today there is no tool-result cache in `services/agent/`. This
 * factory exists so that the FIRST cache PR can only fail closed: every
 * key MUST include `userId` and `workspaceId` or the helper throws at
 * call time.
 *
 * Convention: `tool:<toolName>:<userId>:<workspaceId>:<suffix>`.
 * Use the suffix to encode the tool inputs (hash of params, query, etc.).
 *
 * Do NOT add a cache here. Build the cache where it is needed, but build
 * its keys exclusively through `toolCacheKey()`.
 */

export interface ToolContext {
  userId: string;
  workspaceId: string;
}

export function toolCacheKey(ctx: ToolContext, toolName: string, suffix: string): string {
  if (!ctx.userId) throw new Error("toolCacheKey: missing userId in ctx");
  if (!ctx.workspaceId) throw new Error("toolCacheKey: missing workspaceId in ctx");
  if (!toolName) throw new Error("toolCacheKey: missing toolName");
  if (!suffix) throw new Error("toolCacheKey: missing suffix");
  return `tool:${toolName}:${ctx.userId}:${ctx.workspaceId}:${suffix}`;
}
